import { describe, expect, it } from "vitest";
import {
  createMusicPlaylist,
  createPlaylistOrder,
  shuffleTrackIds,
  type PlaylistAudioSink,
  type PlaylistManifest,
  type PlaylistRandom,
  type PlaylistSource,
  type PlaylistVoice,
} from "./musicPlaylist";
import {
  musicPlaylistAvailable,
  productionMusicManifest,
} from "../data/musicPlaylistManifest";

/** Deterministic linear-congruential RNG so shuffles are reproducible. */
function seededRandom(seed: number): PlaylistRandom {
  let state = seed >>> 0 || 1;
  return {
    next() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  };
}

interface RecordedVoice extends PlaylistVoice {
  readonly gains: number[];
  stopped: boolean;
}

function fakeSink(): PlaylistAudioSink & { voices: RecordedVoice[] } {
  const voices: RecordedVoice[] = [];
  return {
    voices,
    createVoice(track: PlaylistSource): PlaylistVoice {
      const voice: RecordedVoice = {
        trackId: track.id,
        gains: [],
        stopped: false,
        setGain(value: number) {
          this.gains.push(value);
        },
        stop() {
          this.stopped = true;
        },
      };
      voices.push(voice);
      return voice;
    },
  };
}

function manifest(count: number, crossfadeSec = 4): PlaylistManifest {
  return {
    version: 1,
    crossfadeSec,
    tracks: Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      title: `Track ${i}`,
      durationSec: 100,
    })),
  };
}

function controllerWithClock(m: PlaylistManifest, seed = 7) {
  let now = 0;
  const sink = fakeSink();
  const controller = createMusicPlaylist(m, {
    sink,
    random: seededRandom(seed),
    now: () => now,
  });
  return {
    controller,
    sink,
    setNow(value: number) {
      now = value;
    },
    get now() {
      return now;
    },
  };
}

describe("shuffleTrackIds", () => {
  it("is a permutation and is deterministic for a fixed seed", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const first = shuffleTrackIds(ids, seededRandom(42));
    const second = shuffleTrackIds(ids, seededRandom(42));
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual([...ids].sort());
  });
});

describe("createPlaylistOrder", () => {
  it("never starts a fresh cycle with the previously played track", () => {
    const ids = ["a", "b", "c", "d"];
    const random = seededRandom(1);
    for (let i = 0; i < 200; i += 1) {
      const previousLast = ids[i % ids.length];
      const order = createPlaylistOrder(ids, random, previousLast);
      expect(order[0]).not.toBe(previousLast);
      expect([...order].sort()).toEqual([...ids].sort());
    }
  });

  it("returns the single track unchanged when only one exists", () => {
    expect(createPlaylistOrder(["solo"], seededRandom(1), "solo")).toEqual([
      "solo",
    ]);
  });
});

describe("production manifest", () => {
  it("ships no licensed tracks and stays dormant", () => {
    expect(productionMusicManifest.tracks).toHaveLength(0);
    expect(musicPlaylistAvailable).toBe(false);
    const { controller, sink } = controllerWithClock(productionMusicManifest);
    expect(controller.dormant).toBe(true);
    controller.start();
    controller.tick(10_000);
    controller.setDucking(true);
    controller.pause();
    controller.resume();
    // Dormant engine constructs no voices at all.
    expect(sink.voices).toHaveLength(0);
    expect(controller.currentTrackId()).toBeUndefined();
    expect(controller.history).toHaveLength(0);
  });
});

describe("playback scheduling", () => {
  it("starts the first track at full music gain", () => {
    const { controller, sink } = controllerWithClock(manifest(3));
    controller.start();
    controller.tick(0);
    expect(sink.voices).toHaveLength(1);
    expect(sink.voices[0].gains.at(-1)).toBe(1);
    expect(controller.history).toHaveLength(1);
  });

  it("pre-rolls the next track and crossfades gains within the window", () => {
    // duration 100s, crossfade 4s -> window opens at 96s.
    const env = controllerWithClock(manifest(3));
    env.controller.start();
    env.controller.tick(0);
    // Before the window: only one voice.
    env.controller.tick(90_000);
    expect(env.sink.voices).toHaveLength(1);

    // Midway through the crossfade (98s): both voices, equal gains.
    env.controller.tick(98_000);
    expect(env.sink.voices).toHaveLength(2);
    const current = env.sink.voices[0];
    const incoming = env.sink.voices[1];
    expect(current.gains.at(-1)).toBeCloseTo(0.5, 5);
    expect(incoming.gains.at(-1)).toBeCloseTo(0.5, 5);
  });

  it("promotes the next track after the crossfade completes", () => {
    const env = controllerWithClock(manifest(3));
    env.controller.start();
    env.controller.tick(0);
    const firstId = env.controller.currentTrackId();
    env.controller.tick(98_000);
    env.controller.tick(101_000); // past the end of the first track
    expect(env.sink.voices[0].stopped).toBe(true);
    expect(env.controller.currentTrackId()).not.toBe(firstId);
    expect(env.controller.currentTrackId()).toBe(env.sink.voices[1].trackId);
  });

  it("plays a full multi-cycle run with no immediate repeats", () => {
    const env = controllerWithClock(manifest(4), 123);
    env.controller.start();
    // Step through ~12 tracks in coarse ticks.
    for (let t = 0; t <= 12 * 100_000; t += 5_000) {
      env.controller.tick(t);
    }
    const history = env.controller.history;
    expect(history.length).toBeGreaterThan(8);
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i]).not.toBe(history[i - 1]);
    }
  });
});

describe("ducking", () => {
  it("lowers the whole bed while feedback ducks and restores it after", () => {
    const env = controllerWithClock(manifest(2));
    env.controller.start();
    env.controller.tick(10_000);
    env.controller.setDucking(true);
    const ducked = env.sink.voices[0].gains.at(-1)!;
    expect(ducked).toBeGreaterThan(0);
    expect(ducked).toBeLessThan(0.5);
    env.controller.setDucking(false);
    expect(env.sink.voices[0].gains.at(-1)).toBe(1);
  });
});

describe("volume", () => {
  it("scales the current voice by the music volume", () => {
    const env = controllerWithClock(manifest(2));
    env.controller.start();
    env.controller.tick(10_000);
    env.controller.setMusicVolume(0.25);
    expect(env.sink.voices[0].gains.at(-1)).toBeCloseTo(0.25, 5);
  });
});

describe("pause and resume", () => {
  it("silences the bed while paused and continues from the frozen remainder", () => {
    const env = controllerWithClock(manifest(3));
    env.controller.start();
    env.controller.tick(50_000);
    env.setNow(50_000);
    env.controller.pause();
    expect(env.sink.voices[0].gains.at(-1)).toBe(0);

    // 30s of real time pass while paused; ticks do nothing.
    env.setNow(80_000);
    env.controller.tick(80_000);
    expect(env.sink.voices).toHaveLength(1);

    env.controller.resume();
    // Only 50s of *playback* elapsed, so the crossfade (96s) has not started.
    expect(env.sink.voices).toHaveLength(1);
    expect(env.sink.voices[0].gains.at(-1)).toBe(1);

    // Advancing to real-time 126s == 96s of playback opens the crossfade.
    env.controller.tick(126_000);
    expect(env.sink.voices).toHaveLength(2);
  });
});

describe("resilience", () => {
  it("skips a track silently when the sink cannot create a voice", () => {
    const failing: PlaylistAudioSink = { createVoice: () => null };
    let now = 0;
    const controller = createMusicPlaylist(manifest(2), {
      sink: failing,
      random: seededRandom(3),
      now: () => now,
    });
    controller.start();
    now = 200_000;
    expect(() => controller.tick(200_000)).not.toThrow();
    expect(controller.currentTrackId()).toBeUndefined();
  });
});
