/**
 * Integration coverage for the exact wiring pattern `App.tsx` uses to connect
 * the (dormant-by-default) music playlist engine to the real `GameAudio`
 * feedback/focus-mute signals. Unlike `musicPlaylist.test.ts` (engine unit
 * tests against a fake sink) and `musicDucking.test.ts` (the ducking bridge in
 * isolation), this file proves the *composition* App.tsx assembles — real
 * `GameAudio`, real `connectFeedbackDucking`, real focus-mute observation, and
 * the deferred-start gate — behaves correctly, both while dormant (production
 * reality today) and once a manifest supplies tracks (a future licensed
 * release), without ever touching a real AudioContext.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameAudio } from "./audio";
import { connectFeedbackDucking } from "./musicDucking";
import {
  createMusicPlaylist,
  type PlaylistAudioSink,
  type PlaylistManifest,
  type PlaylistSource,
  type PlaylistVoice,
} from "./musicPlaylist";
import {
  musicPlaylistAvailable,
  productionMusicManifest,
} from "../data/musicPlaylistManifest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface RecordedVoice extends PlaylistVoice {
  readonly gains: number[];
  stopped: boolean;
}

function spySink(): PlaylistAudioSink & { voices: RecordedVoice[] } {
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

function syntheticManifest(): PlaylistManifest {
  return {
    version: 1,
    crossfadeSec: 4,
    tracks: [
      { id: "a", title: "Track A", durationSec: 100 },
      { id: "b", title: "Track B", durationSec: 100 },
      { id: "c", title: "Track C", durationSec: 100 },
    ],
  };
}

/**
 * Mirrors the wiring block inside `App.tsx`'s music-playlist effect exactly,
 * so a regression there is caught here too. Returns the pieces a test needs to
 * poke at (the real GameAudio instance and the constructed controller) plus a
 * teardown that mirrors the effect's cleanup.
 */
function wireLikeApp(
  manifest: PlaylistManifest,
  sink: PlaylistAudioSink,
  now: () => number,
) {
  const audio = new GameAudio();
  const playlist = createMusicPlaylist(manifest, {
    sink,
    random: { next: () => Math.random() },
    now,
  });
  const disconnectDucking = connectFeedbackDucking(audio, playlist);
  let started = false;
  const unsubscribeFocus = audio.observeFocusMuted((muted) => {
    if (playlist.dormant) return;
    if (muted) {
      playlist.pause();
    } else if (!started) {
      started = true;
      playlist.start();
    } else {
      playlist.resume();
    }
  });
  return {
    audio,
    playlist,
    teardown() {
      unsubscribeFocus();
      disconnectDucking();
      playlist.stop();
    },
  };
}

describe("production and fallback manifests", () => {
  const emptyManifest: PlaylistManifest = { version: 1, crossfadeSec: 0, tracks: [] };

  it("ships a live production library", () => {
    expect(productionMusicManifest.tracks.length).toBeGreaterThan(5);
    expect(musicPlaylistAvailable).toBe(true);
  });

  it("keeps an explicitly empty fallback graph-free", () => {
    const sink = spySink();
    let now = 0;
    const { audio, playlist, teardown } = wireLikeApp(
      emptyManifest,
      sink,
      () => now,
    );

    expect(playlist.dormant).toBe(true);

    // Drive every real signal path the app exercises across a session:
    // feedback cues (which would duck), focus-mute transitions (which would
    // pause/resume/start), settings changes, and time passing.
    audio.play("success");
    audio.play("chip");
    audio.play("fold");
    audio.setFocusMuted(true);
    audio.setFocusMuted(false);
    audio.suspendForLifecycle();
    audio.setFocusMuted(false);
    playlist.setMusicVolume(0.8);
    now = 500_000;
    playlist.tick(now);

    expect(sink.voices).toHaveLength(0);
    expect(playlist.currentTrackId()).toBeUndefined();
    expect(playlist.history).toHaveLength(0);
    expect(() => teardown()).not.toThrow();
  });

  it("never throws across mount/unmount even under rapid focus churn", () => {
    const sink = spySink();
    const { audio, teardown } = wireLikeApp(
      emptyManifest,
      sink,
      () => 0,
    );
    expect(() => {
      for (let i = 0; i < 20; i += 1) {
        audio.setFocusMuted(i % 2 === 0);
      }
      teardown();
    }).not.toThrow();
    expect(sink.voices).toHaveLength(0);
  });
});

describe("wiring with a synthetic (future-licensed) manifest", () => {
  it("defers the very first playback start until focus is unmuted, matching the no-audio-before-input rule", () => {
    const sink = spySink();
    let now = 0;
    const audio = new GameAudio();
    // Start out lifecycle-muted, exactly like a freshly booted app before the
    // audio-focus policy reaches "ready" (needs-user-activation).
    audio.setFocusMuted(true);
    const playlist = createMusicPlaylist(syntheticManifest(), {
      sink,
      random: { next: () => 0.42 },
      now: () => now,
    });
    let started = false;
    audio.observeFocusMuted((muted) => {
      if (playlist.dormant) return;
      if (muted) playlist.pause();
      else if (!started) {
        started = true;
        playlist.start();
      } else playlist.resume();
    });

    // Still muted: no voice constructed yet.
    expect(sink.voices).toHaveLength(0);

    // The user's first input clears the block; the bed may now begin.
    audio.setFocusMuted(false);
    playlist.tick(now);
    expect(sink.voices).toHaveLength(1);
    expect(sink.voices[0].gains.at(-1)).toBe(1);
  });

  it("pauses and resumes the bed in lockstep with GameAudio focus-mute transitions", () => {
    const sink = spySink();
    let now = 0;
    const audio = new GameAudio();
    audio.setFocusMuted(false);
    const controller = createMusicPlaylist(syntheticManifest(), {
      sink,
      random: { next: () => 0.1 },
      now: () => now,
    });
    let started = false;
    audio.observeFocusMuted((muted) => {
      if (controller.dormant) return;
      if (muted) controller.pause();
      else if (!started) {
        started = true;
        controller.start();
      } else controller.resume();
    });

    now = 10_000;
    controller.tick(now);
    expect(sink.voices[0].gains.at(-1)).toBe(1);

    // Table pause / window blur / minimize / suspend all converge on
    // GameAudio.setFocusMuted(true) today; confirm the bed silences with it.
    now = 20_000;
    audio.setFocusMuted(true);
    expect(sink.voices[0].gains.at(-1)).toBe(0);

    // Time passing while focus-muted must not advance the schedule.
    now = 90_000;
    controller.tick(now);
    expect(sink.voices).toHaveLength(1);

    // Refocus resumes from the frozen remainder, not from scratch.
    audio.setFocusMuted(false);
    expect(sink.voices[0].gains.at(-1)).toBe(1);
  });

  it("ducks the bed for real feedback sounds routed through GameAudio.play", () => {
    vi.useFakeTimers();
    const sink = spySink();
    let now = 0;
    const audio = new GameAudio();
    audio.setFocusMuted(false);
    const controller = createMusicPlaylist(syntheticManifest(), {
      sink,
      random: { next: () => 0.7 },
      now: () => now,
    });
    connectFeedbackDucking(audio, controller);
    controller.start();
    now = 5_000;
    controller.tick(now);
    expect(sink.voices[0].gains.at(-1)).toBe(1);

    // A real feedback cue played through GameAudio (as PokerTable does for
    // chip/fold/success/error/deal) must ducken the bed.
    audio.play("chip");
    expect(sink.voices[0].gains.at(-1)).toBeCloseTo(0.32, 5);

    // The click cue is not a ducking cue.
    audio.play("click");
    expect(sink.voices[0].gains.at(-1)).toBeCloseTo(0.32, 5);

    vi.runAllTimers();
    expect(sink.voices[0].gains.at(-1)).toBe(1);
  });

  it("respects the player's saved Music volume and Mute All setting once live", () => {
    const sink = spySink();
    let now = 0;
    const controller = createMusicPlaylist(syntheticManifest(), {
      sink,
      random: { next: () => 0.3 },
      now: () => now,
    });
    controller.start();
    controller.tick(0);

    controller.setMusicVolume(0.35); // e.g. musicVolumeFromSettings(...)
    expect(sink.voices[0].gains.at(-1)).toBeCloseTo(0.35, 5);

    controller.setMusicVolume(0); // Mute All
    expect(sink.voices[0].gains.at(-1)).toBe(0);
  });
});
