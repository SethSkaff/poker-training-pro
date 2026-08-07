/**
 * Shuffled background-music playlist engine.
 *
 * This module is deliberately DORMANT in production: it only ever creates audio
 * voices when a manifest with at least one licensed track is supplied. The
 * shipping production manifest (`src/data/musicPlaylistManifest.ts`) is empty
 * because no licensed masters exist yet, so every method below no-ops without a
 * manifest and constructs no audio graph.
 *
 * The engine is pure of any Web Audio dependency: time, randomness, and audio
 * output are injected so the scheduling, shuffle, crossfade, ducking, and
 * pause/focus behaviour can be tested deterministically against fake buffers.
 */

export interface PlaylistSource {
  /** Stable track identity, unique within a manifest. */
  readonly id: string;
  readonly title: string;
  /** Playable master length in seconds. */
  readonly durationSec: number;
  /**
   * Packaged, same-origin audio master. Remote URLs are deliberately not
   * supported: a game soundtrack must remain available offline and its
   * redistribution rights must be auditable with the shipped build.
   */
  readonly assetPath?: string;
}

export interface PlaylistManifest {
  readonly version: number;
  /** Crossfade length in seconds applied between consecutive tracks. */
  readonly crossfadeSec: number;
  readonly tracks: readonly PlaylistSource[];
}

/**
 * One playing instance of a track. The engine only ever asks the sink to change
 * a voice's gain or stop it; it never reaches into a real AudioContext itself.
 */
export interface PlaylistVoice {
  readonly trackId: string;
  setGain(value: number): void;
  stop(): void;
}

export interface PlaylistAudioSink {
  /**
   * Create a voice for a track. Returning `null` (device/decoder failure) makes
   * the engine skip that track silently rather than blocking playback.
   */
  createVoice(track: PlaylistSource): PlaylistVoice | null;
}

export interface PlaylistRandom {
  /** Uniform value in [0, 1). */
  next(): number;
}

/** Multiplier applied to the whole music bed while feedback audio ducks it. */
const DUCK_LEVEL = 0.32;

/**
 * Derives the playlist engine's [0, 1] music gain from the player's saved
 * Settings — the same Master x Music multiplication `GameAudio` applies
 * internally, with Mute All silencing it entirely. Exported so the app-shell
 * wiring and its tests share one definition instead of duplicating the
 * arithmetic.
 */
export function musicVolumeFromSettings(settings: {
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly muted: boolean;
}): number {
  if (settings.muted) return 0;
  const master = Math.max(0, Math.min(100, settings.masterVolume)) / 100;
  const music = Math.max(0, Math.min(100, settings.musicVolume)) / 100;
  return master * music;
}

/**
 * Fisher-Yates shuffle driven by an injected RNG. Pure and non-mutating.
 */
export function shuffleTrackIds(
  ids: readonly string[],
  random: PlaylistRandom,
): string[] {
  const order = [...ids];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random.next() * (index + 1));
    const bounded = swap < 0 ? 0 : swap > index ? index : swap;
    const temporary = order[index];
    order[index] = order[bounded];
    order[bounded] = temporary;
  }
  return order;
}

/**
 * Produce a fresh shuffled cycle. When more than one track exists the first
 * entry is guaranteed to differ from `previousLast`, so a reshuffle never
 * repeats the track that just finished. Bounded retries keep it deterministic.
 */
export function createPlaylistOrder(
  ids: readonly string[],
  random: PlaylistRandom,
  previousLast?: string,
): string[] {
  if (ids.length <= 1) return [...ids];
  let order = shuffleTrackIds(ids, random);
  for (let attempt = 0; attempt < 8 && order[0] === previousLast; attempt += 1) {
    order = shuffleTrackIds(ids, random);
  }
  if (order[0] === previousLast) {
    // Deterministic fallback: rotate the repeated head to the back.
    order = [...order.slice(1), order[0]];
  }
  return order;
}

interface CyclePlan {
  order: string[];
  index: number;
}

interface EngineDeps {
  readonly sink: PlaylistAudioSink;
  readonly random: PlaylistRandom;
  /** Monotonic clock in milliseconds. */
  now(): number;
}

export interface MusicPlaylistController {
  /** True when no manifest track is available; every method is inert. */
  readonly dormant: boolean;
  /** Begin playback from a fresh shuffled cycle. No-op while dormant. */
  start(): void;
  /** Advance scheduling to the supplied time and apply crossfade gains. */
  tick(nowMs?: number): void;
  /** Stop all voices and clear the schedule. */
  stop(): void;
  /** Freeze the timeline (window blur / manual pause). */
  pause(): void;
  /** Continue from the exact frozen remainder after an explicit resume. */
  resume(): void;
  /** Music channel volume in [0, 1]. */
  setMusicVolume(value: number): void;
  /** Duck the whole bed under a feedback sound, then release it. */
  setDucking(active: boolean): void;
  /** Ordered ids of tracks that have begun playing, for diagnostics/tests. */
  readonly history: readonly string[];
  /** Currently sounding track id, if any. */
  currentTrackId(): string | undefined;
}

export function createMusicPlaylist(
  manifest: PlaylistManifest,
  deps: EngineDeps,
): MusicPlaylistController {
  const sources = new Map(manifest.tracks.map((track) => [track.id, track]));
  const ids = manifest.tracks.map((track) => track.id);
  const crossfadeMs = Math.max(0, manifest.crossfadeSec * 1000);
  const dormant = ids.length === 0;

  let playing = false;
  let paused = false;
  let musicVolume = 1;
  let ducking = false;

  let order: string[] = [];
  let index = 0;
  let currentVoice: PlaylistVoice | null = null;
  let currentStartMs = 0;

  let nextVoice: PlaylistVoice | null = null;
  let nextPlan: CyclePlan | null = null;
  let nextStartMs = 0;
  let pausedAt = 0;

  const history: string[] = [];

  function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function bedGain(): number {
    return clamp01(musicVolume) * (ducking ? DUCK_LEVEL : 1);
  }

  function sourceFor(cycle: string[], at: number): PlaylistSource | undefined {
    return sources.get(cycle[at]);
  }

  function planNext(): CyclePlan {
    if (index + 1 < order.length) {
      return { order, index: index + 1 };
    }
    const last = order[index];
    return { order: createPlaylistOrder(ids, deps.random, last), index: 0 };
  }

  function beginTrack(cycle: string[], at: number, startMs: number): void {
    const source = sourceFor(cycle, at);
    order = cycle;
    index = at;
    currentStartMs = startMs;
    currentVoice = source ? deps.sink.createVoice(source) : null;
    if (source) history.push(source.id);
    currentVoice?.setGain(0);
  }

  function startNextVoice(startMs: number): void {
    if (!nextPlan) nextPlan = planNext();
    const source = sourceFor(nextPlan.order, nextPlan.index);
    nextStartMs = startMs;
    nextVoice = source ? deps.sink.createVoice(source) : null;
    nextVoice?.setGain(0);
  }

  function promote(): void {
    currentVoice?.stop();
    if (nextVoice && nextPlan) {
      currentVoice = nextVoice;
      order = nextPlan.order;
      index = nextPlan.index;
      currentStartMs = nextStartMs;
      const promotedId = order[index];
      if (promotedId) history.push(promotedId);
      nextVoice = null;
      nextPlan = null;
    } else {
      const plan = nextPlan ?? planNext();
      nextPlan = null;
      beginTrack(plan.order, plan.index, deps.now());
    }
  }

  function applyGains(elapsed: number, durationMs: number): void {
    const bed = bedGain();
    const inCrossfade =
      crossfadeMs > 0 && elapsed >= durationMs - crossfadeMs && nextVoice;
    if (inCrossfade) {
      const into = clamp01((durationMs - elapsed) / crossfadeMs);
      currentVoice?.setGain(bed * into);
      const nextElapsed = elapsed - (durationMs - crossfadeMs);
      nextVoice?.setGain(bed * clamp01(nextElapsed / crossfadeMs));
    } else {
      currentVoice?.setGain(bed);
      nextVoice?.setGain(0);
    }
  }

  function tick(nowMs?: number): void {
    if (dormant || !playing || paused) return;
    const now = nowMs ?? deps.now();

    // Promote across any track boundaries the clock has passed.
    for (let guard = 0; guard < 64; guard += 1) {
      const source = sourceFor(order, index);
      if (!source) return;
      const durationMs = Math.max(1, source.durationSec * 1000);
      const elapsed = now - currentStartMs;
      if (elapsed < durationMs) {
        // Pre-roll the next voice once inside the crossfade window.
        if (
          crossfadeMs > 0 &&
          elapsed >= durationMs - crossfadeMs &&
          !nextVoice
        ) {
          nextPlan = planNext();
          startNextVoice(currentStartMs + (durationMs - crossfadeMs));
        }
        applyGains(elapsed, durationMs);
        return;
      }
      promote();
    }
  }

  return {
    dormant,
    history,
    start(): void {
      if (dormant || playing) return;
      playing = true;
      paused = false;
      nextVoice = null;
      nextPlan = null;
      beginTrack(createPlaylistOrder(ids, deps.random), 0, deps.now());
      tick(deps.now());
    },
    tick,
    stop(): void {
      playing = false;
      paused = false;
      currentVoice?.stop();
      nextVoice?.stop();
      currentVoice = null;
      nextVoice = null;
      nextPlan = null;
      order = [];
      index = 0;
    },
    pause(): void {
      if (dormant || !playing || paused) return;
      paused = true;
      // Silence the bed while frozen; the timeline resumes from the remainder.
      currentVoice?.setGain(0);
      nextVoice?.setGain(0);
      pausedAt = deps.now();
    },
    resume(): void {
      if (dormant || !playing || !paused) return;
      const frozen = Math.max(0, deps.now() - pausedAt);
      currentStartMs += frozen;
      nextStartMs += frozen;
      paused = false;
      tick(deps.now());
    },
    setMusicVolume(value: number): void {
      musicVolume = clamp01(value);
      if (!dormant && playing && !paused) tick(deps.now());
    },
    setDucking(active: boolean): void {
      if (ducking === active) return;
      ducking = active;
      if (!dormant && playing && !paused) tick(deps.now());
    },
    currentTrackId(): string | undefined {
      return currentVoice?.trackId;
    },
  };
}
