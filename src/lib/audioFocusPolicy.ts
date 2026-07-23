/**
 * Deterministic audio-focus policy.
 *
 * This module deliberately does not own music/effect volumes or the user's
 * mute setting. It only decides whether lifecycle audio must be suppressed.
 * That separation prevents blur, suspend, and device events from overwriting
 * a saved preference.
 */

export type AudioFocusBlocker =
  | "manual-pause"
  | "window-blurred"
  | "document-hidden"
  | "system-suspended"
  | "audio-interrupted";

export type AudioFocusEvent =
  | { type: "user-activated" }
  | { type: "ready-confirmed" }
  | { type: "manual-pause"; active: boolean }
  | { type: "window-focus"; focused: boolean }
  | { type: "document-visibility"; visible: boolean }
  | { type: "system-suspend"; suspended: boolean }
  | { type: "audio-interruption"; interrupted: boolean }
  | { type: "output-availability"; available: boolean }
  | { type: "system-audio"; active: boolean | "unknown" }
  | { type: "audio-failed" };

export type AudioFocusReadiness =
  | "needs-user-activation"
  | "ready"
  | "blocked"
  | "needs-ready-confirmation"
  | "output-unavailable"
  | "failed";

export interface AudioFocusState {
  readonly userActivated: boolean;
  readonly blockers: readonly AudioFocusBlocker[];
  readonly outputAvailable: boolean;
  /**
   * Windows normally mixes this app with other audio sessions. This field is
   * advisory and never changes audibility because Chromium exposes no reliable
   * cross-application activity signal.
   */
  readonly systemAudioActive: boolean | "unknown";
  readonly readiness: AudioFocusReadiness;
  readonly lifecycleMuted: boolean;
  readonly canPlay: boolean;
}

export type AudioFocusEffect =
  | { type: "set-lifecycle-muted"; muted: boolean }
  | { type: "suspend-context" }
  | { type: "resume-context-after-explicit-ready" };

export interface AudioFocusTransition {
  readonly state: AudioFocusState;
  readonly effects: readonly AudioFocusEffect[];
}

const blockerOrder: readonly AudioFocusBlocker[] = [
  "manual-pause",
  "window-blurred",
  "document-hidden",
  "system-suspended",
  "audio-interrupted",
];

export function initialAudioFocusState(): AudioFocusState {
  return Object.freeze({
    userActivated: false,
    blockers: Object.freeze([]),
    outputAvailable: true,
    systemAudioActive: "unknown",
    readiness: "needs-user-activation",
    lifecycleMuted: true,
    canPlay: false,
  });
}

export function transitionAudioFocus(
  previous: AudioFocusState,
  event: AudioFocusEvent,
): AudioFocusTransition {
  let userActivated = previous.userActivated;
  let blockers = [...previous.blockers];
  let outputAvailable = previous.outputAvailable;
  let systemAudioActive = previous.systemAudioActive;
  let explicitlyReady = previous.readiness === "ready";
  let failed = previous.readiness === "failed";
  let requestResume = false;

  switch (event.type) {
    case "user-activated":
      userActivated = true;
      explicitlyReady =
        !failed && outputAvailable && blockers.length === 0;
      requestResume = explicitlyReady;
      break;
    case "ready-confirmed":
      explicitlyReady =
        !failed &&
        userActivated &&
        outputAvailable &&
        blockers.length === 0;
      requestResume = explicitlyReady;
      break;
    case "manual-pause":
      blockers = setBlocker(blockers, "manual-pause", event.active);
      if (event.active) explicitlyReady = false;
      break;
    case "window-focus":
      blockers = setBlocker(blockers, "window-blurred", !event.focused);
      if (!event.focused) explicitlyReady = false;
      break;
    case "document-visibility":
      blockers = setBlocker(blockers, "document-hidden", !event.visible);
      if (!event.visible) explicitlyReady = false;
      break;
    case "system-suspend":
      blockers = setBlocker(
        blockers,
        "system-suspended",
        event.suspended,
      );
      if (event.suspended) explicitlyReady = false;
      break;
    case "audio-interruption":
      blockers = setBlocker(
        blockers,
        "audio-interrupted",
        event.interrupted,
      );
      if (event.interrupted) explicitlyReady = false;
      break;
    case "output-availability":
      outputAvailable = event.available;
      if (!event.available) explicitlyReady = false;
      break;
    case "system-audio":
      systemAudioActive = event.active;
      break;
    case "audio-failed":
      failed = true;
      explicitlyReady = false;
      break;
  }

  const readiness = deriveReadiness({
    userActivated,
    blockers,
    outputAvailable,
    explicitlyReady,
    failed,
  });
  const lifecycleMuted = readiness !== "ready";
  const state = Object.freeze({
    userActivated,
    blockers: Object.freeze(sortBlockers(blockers)),
    outputAvailable,
    systemAudioActive,
    readiness,
    lifecycleMuted,
    canPlay: !lifecycleMuted,
  });

  const effects: AudioFocusEffect[] = [];
  if (lifecycleMuted !== previous.lifecycleMuted) {
    effects.push({ type: "set-lifecycle-muted", muted: lifecycleMuted });
  }
  if (!previous.lifecycleMuted && lifecycleMuted) {
    effects.push({ type: "suspend-context" });
  }
  if (
    requestResume &&
    previous.lifecycleMuted &&
    !lifecycleMuted
  ) {
    effects.push({ type: "resume-context-after-explicit-ready" });
  }

  return { state, effects: Object.freeze(effects) };
}

function deriveReadiness(input: {
  userActivated: boolean;
  blockers: readonly AudioFocusBlocker[];
  outputAvailable: boolean;
  explicitlyReady: boolean;
  failed: boolean;
}): AudioFocusReadiness {
  if (input.failed) return "failed";
  if (!input.outputAvailable) return "output-unavailable";
  if (input.blockers.length > 0) return "blocked";
  if (!input.userActivated) return "needs-user-activation";
  return input.explicitlyReady ? "ready" : "needs-ready-confirmation";
}

function setBlocker(
  blockers: readonly AudioFocusBlocker[],
  blocker: AudioFocusBlocker,
  active: boolean,
): AudioFocusBlocker[] {
  const next = new Set(blockers);
  if (active) next.add(blocker);
  else next.delete(blocker);
  return sortBlockers([...next]);
}

function sortBlockers(
  blockers: readonly AudioFocusBlocker[],
): AudioFocusBlocker[] {
  return [...blockers].sort(
    (left, right) =>
      blockerOrder.indexOf(left) - blockerOrder.indexOf(right),
  );
}

export interface AudioFocusEffectTarget {
  setFocusMuted(muted: boolean): void;
  suspendForLifecycle?(): void | Promise<void>;
  resumeAfterExplicitReady?(): void | Promise<void>;
}

/**
 * Small imperative shell around the pure reducer. Callers may subscribe for a
 * Ready recap and map Electron/native lifecycle signals into dispatch calls.
 */
export class AudioFocusController {
  private current = initialAudioFocusState();
  private readonly listeners = new Set<(state: AudioFocusState) => void>();

  constructor(private readonly target: AudioFocusEffectTarget) {
    try {
      target.setFocusMuted(true);
    } catch {
      // Audio is supplementary; construction must not break gameplay.
    }
  }

  get state(): AudioFocusState {
    return this.current;
  }

  dispatch(event: AudioFocusEvent): AudioFocusState {
    const transition = transitionAudioFocus(this.current, event);
    this.current = transition.state;
    for (const effect of transition.effects) {
      this.applyEffect(effect);
    }
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  subscribe(listener: (state: AudioFocusState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private applyEffect(effect: AudioFocusEffect): void {
    try {
      if (effect.type === "set-lifecycle-muted") {
        this.target.setFocusMuted(effect.muted);
      } else if (effect.type === "suspend-context") {
        void Promise.resolve(this.target.suspendForLifecycle?.()).catch(
          () => undefined,
        );
      } else {
        void Promise.resolve(
          this.target.resumeAfterExplicitReady?.(),
        ).catch(() => undefined);
      }
    } catch {
      // Audio is supplementary; lifecycle policy must not break gameplay.
    }
  }
}
