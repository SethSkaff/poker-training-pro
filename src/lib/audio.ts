export type SoundName =
  | "click"
  | "chip"
  | "fold"
  | "success"
  | "error"
  | "deal"
  | "win"
  | "all-in"
  | "eliminated";

export type AudioPreviewResult = "played" | "silenced" | "unavailable";

export class GameAudio {
  private context?: AudioContext;
  private musicGain?: GainNode;
  private effectsGain?: GainNode;
  private musicVolume = 0;
  private effectsVolume = 0.32;
  private masterVolume = 1;
  private muted = false;
  private focusMuted = false;
  private initializationFailed = false;
  private readonly feedbackListeners = new Set<(sound: SoundName) => void>();
  private readonly focusMutedListeners = new Set<(muted: boolean) => void>();

  setMusicVolume(volume: number): void {
    this.musicVolume = percent(volume) * 0.12;
    this.applyVolumes();
    // The temporary oscillator loop stays disabled until licensed masters ship.
    this.stopMusic();
  }

  setEffectsVolume(volume: number): void {
    this.effectsVolume = percent(volume) * 0.32;
    this.applyVolumes();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = percent(volume);
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  /**
   * Window lifecycle code may temporarily silence the graph without replacing
   * the player's saved mute/volume preference.
   */
  setFocusMuted(muted: boolean): void {
    if (this.focusMuted === muted) return;
    this.focusMuted = muted;
    this.applyVolumes();
    this.notifyFocusMuted();
  }

  /**
   * Observe focus-mute transitions so the (dormant) music playlist can freeze
   * or resume its own timeline in lockstep with whichever surface currently
   * owns focus muting (the desktop lifecycle hook off the table, or the table's
   * own pause effect while it is mounted). The listener fires immediately with
   * the current value so subscribing late never misses the state.
   */
  observeFocusMuted(listener: (muted: boolean) => void): () => void {
    this.focusMutedListeners.add(listener);
    try {
      listener(this.focusMuted);
    } catch {
      // Observers are supplementary; a faulty one must never block a sound.
    }
    return () => this.focusMutedListeners.delete(listener);
  }

  private notifyFocusMuted(): void {
    for (const listener of this.focusMutedListeners) {
      try {
        listener(this.focusMuted);
      } catch {
        // Observers are supplementary; a faulty one must never block a sound.
      }
    }
  }

  /**
   * Suspend an existing graph after it has already been muted. This never
   * creates an AudioContext and never changes the player's saved settings.
   */
  suspendForLifecycle(): void {
    const wasMuted = this.focusMuted;
    this.focusMuted = true;
    this.applyVolumes();
    if (!wasMuted) this.notifyFocusMuted();
    if (this.context?.state === "running") {
      void this.context.suspend().catch(() => this.disableAudio());
    }
  }

  /**
   * May only be called after an explicit Ready/user-activation transition.
   * It never constructs a graph; a later user cue may do that.
   */
  resumeAfterExplicitReady(): void {
    if (this.focusMuted || !this.context) return;
    if (
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.hasBeenActive
    ) {
      return;
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch(() => this.disableAudio());
    }
  }

  startMusic(): void {
    // Intentionally silent. The generated placeholder loop was removed.
  }

  stopMusic(): void {
    // No active playlist exists yet.
  }

  play(sound: SoundName): void {
    // Notify observers (e.g. music ducking) before any graph work. This is a
    // pure notification: it never constructs or wakes an audio graph and never
    // discloses information the visual interface does not, so it cannot create
    // a timing tell.
    this.notifyFeedback(sound);
    this.playEffect(sound);
  }

  /**
   * Observe feedback sounds so the (dormant) music bed can duck under card,
   * chip, fold, and result cues. Returns an unsubscribe function.
   */
  observeFeedback(listener: (sound: SoundName) => void): () => void {
    this.feedbackListeners.add(listener);
    return () => this.feedbackListeners.delete(listener);
  }

  private notifyFeedback(sound: SoundName): void {
    for (const listener of this.feedbackListeners) {
      try {
        listener(sound);
      } catch {
        // Observers are supplementary; a faulty one must never block a sound.
      }
    }
  }

  /**
   * Explicit Settings action. Volume setters remain graph-free; only this
   * method may initialize a graph for a preview.
   */
  previewEffect(sound: SoundName): AudioPreviewResult {
    if (
      this.muted ||
      this.focusMuted ||
      this.masterVolume <= 0 ||
      this.effectsVolume <= 0
    ) {
      return "silenced";
    }
    return this.playEffect(sound) ? "played" : "unavailable";
  }

  private playEffect(sound: SoundName): boolean {
    // Lifecycle audio never creates or wakes a graph while the app is paused,
    // hidden, suspended, interrupted, or awaiting an explicit Ready action.
    if (this.focusMuted) return false;
    const context = this.ensureContextAfterUserInput();
    if (!context || !this.effectsGain) return false;

    const profiles: Record<
      SoundName,
      { frequency: number; duration: number; type: OscillatorType }
    > = {
      click: { frequency: 320, duration: 0.045, type: "sine" },
      chip: { frequency: 880, duration: 0.08, type: "triangle" },
      fold: { frequency: 190, duration: 0.12, type: "sine" },
      success: { frequency: 660, duration: 0.2, type: "triangle" },
      error: { frequency: 120, duration: 0.24, type: "sawtooth" },
      deal: { frequency: 420, duration: 0.055, type: "triangle" },
      // These are deliberately keyed only to public presentation events. They
      // communicate a visible result or action, never hand strength.
      win: { frequency: 740, duration: 0.28, type: "triangle" },
      "all-in": { frequency: 260, duration: 0.18, type: "sawtooth" },
      eliminated: { frequency: 150, duration: 0.22, type: "sine" },
    };

    try {
      const profile = profiles[sound];
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = profile.type;
      oscillator.frequency.setValueAtTime(
        profile.frequency,
        context.currentTime,
      );
      if (sound === "success" || sound === "win") {
        oscillator.frequency.exponentialRampToValueAtTime(
          sound === "win" ? 1_110 : 990,
          context.currentTime + profile.duration,
        );
      }
      envelope.gain.setValueAtTime(0.5, context.currentTime);
      envelope.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + profile.duration,
      );
      oscillator.connect(envelope);
      envelope.connect(this.effectsGain);
      oscillator.start();
      oscillator.stop(context.currentTime + profile.duration);
      return true;
    } catch {
      // Audio is supplementary. A device/decoder/graph failure must never block
      // a poker action or reveal different game information.
      this.disableAudio();
      return false;
    }
  }

  private ensureContextAfterUserInput(): AudioContext | undefined {
    if (this.initializationFailed) return undefined;
    if (
      typeof navigator !== "undefined" &&
      navigator.userActivation &&
      !navigator.userActivation.hasBeenActive
    ) {
      return undefined;
    }
    if (this.context) return this.context;
    if (typeof AudioContext === "undefined") {
      this.initializationFailed = true;
      return undefined;
    }

    try {
      const context = new AudioContext();
      const musicGain = context.createGain();
      const effectsGain = context.createGain();
      musicGain.connect(context.destination);
      effectsGain.connect(context.destination);
      this.context = context;
      this.musicGain = musicGain;
      this.effectsGain = effectsGain;
      this.applyVolumes();
      return context;
    } catch {
      this.disableAudio();
      return undefined;
    }
  }

  private applyVolumes(): void {
    if (!this.context) return;
    const silenced = this.muted || this.focusMuted;
    const master = silenced ? 0 : this.masterVolume;
    try {
      this.musicGain?.gain.setTargetAtTime(
        this.musicVolume * master,
        this.context.currentTime,
        0.08,
      );
      this.effectsGain?.gain.setTargetAtTime(
        this.effectsVolume * master,
        this.context.currentTime,
        0.04,
      );
    } catch {
      this.disableAudio();
    }
  }

  private disableAudio(): void {
    this.initializationFailed = true;
    this.context = undefined;
    this.musicGain = undefined;
    this.effectsGain = undefined;
  }
}

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / 100));
}

export const gameAudio = new GameAudio();
