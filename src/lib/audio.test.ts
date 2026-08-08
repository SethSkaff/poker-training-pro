import { afterEach, describe, expect, it, vi } from "vitest";
import { GameAudio } from "./audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("supplementary game audio", () => {
  it("persists volume values without constructing an audio graph", () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          constructed();
        }
      },
    );
    const audio = new GameAudio();

    audio.setMusicVolume(70);
    audio.setEffectsVolume(55);
    audio.setMasterVolume(80);
    audio.setMuted(true);

    expect(constructed).not.toHaveBeenCalled();
  });

  it("does not initialize before the first browser user activation", () => {
    const constructed = vi.fn();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: false },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          constructed();
        }
      },
    );

    new GameAudio().play("click");

    expect(constructed).not.toHaveBeenCalled();
  });

  it("creates one graph after activation and uses public cue profiles", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);
    const audio = new GameAudio();

    audio.setEffectsVolume(50);
    audio.play("chip");
    audio.play("fold");

    expect(graph.contexts).toHaveLength(1);
    expect(graph.oscillators).toHaveLength(2);
    expect(graph.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(
      880,
      0,
    );
    expect(graph.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
      190,
      0,
    );
  });

  it("provides restrained public win, all-in, and elimination cues", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);
    const audio = new GameAudio();

    audio.play("win");
    audio.play("all-in");
    audio.play("eliminated");

    expect(graph.oscillators.map((oscillator) => oscillator.frequency.setValueAtTime.mock.calls[0]?.[0]))
      .toEqual([740, 260, 150]);
    expect(graph.oscillators[0].frequency.exponentialRampToValueAtTime)
      .toHaveBeenCalledWith(1110, 0.28);
  });

  it("previews only after an explicit call and applies persisted master/effects levels", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);
    const audio = new GameAudio();

    audio.setMasterVolume(25);
    audio.setEffectsVolume(40);
    audio.setMuted(false);
    expect(graph.contexts).toHaveLength(0);

    expect(audio.previewEffect("chip")).toBe("played");
    expect(graph.contexts).toHaveLength(1);
    expect(graph.gains[1].gain.setTargetAtTime).toHaveBeenCalledWith(
      0.032,
      0,
      0.04,
    );
  });

  it("keeps muted and zero-volume previews graph-free", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);

    const muted = new GameAudio();
    muted.setMuted(true);
    expect(muted.previewEffect("success")).toBe("silenced");

    const zeroMaster = new GameAudio();
    zeroMaster.setMasterVolume(0);
    expect(zeroMaster.previewEffect("success")).toBe("silenced");

    const zeroEffects = new GameAudio();
    zeroEffects.setEffectsVolume(0);
    expect(zeroEffects.previewEffect("chip")).toBe("silenced");
    expect(graph.contexts).toHaveLength(0);
  });

  it("falls back silently when audio initialization fails", () => {
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("No output device");
        }
      },
    );
    const audio = new GameAudio();

    expect(() => audio.play("deal")).not.toThrow();
    expect(() => audio.play("success")).not.toThrow();
    expect(audio.previewEffect("chip")).toBe("unavailable");
  });

  it("does not create or resume a graph while lifecycle-muted", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);
    const audio = new GameAudio();

    audio.setFocusMuted(true);
    audio.play("click");

    expect(graph.contexts).toHaveLength(0);
    expect(graph.resume).not.toHaveBeenCalled();
  });

  it("suspends an existing graph and only resumes after explicit Ready", () => {
    const graph = audioGraph();
    vi.stubGlobal("navigator", {
      userActivation: { hasBeenActive: true },
    });
    vi.stubGlobal("AudioContext", graph.Context);
    const audio = new GameAudio();

    audio.play("click");
    audio.suspendForLifecycle();
    audio.resumeAfterExplicitReady();
    expect(graph.suspend).toHaveBeenCalledTimes(1);
    expect(graph.resume).not.toHaveBeenCalled();

    graph.setState("suspended");
    audio.setFocusMuted(false);
    audio.resumeAfterExplicitReady();
    expect(graph.resume).toHaveBeenCalledTimes(1);
  });

  it("notifies focus-mute observers immediately and only on real transitions", () => {
    const audio = new GameAudio();
    const seen: boolean[] = [];
    const unsubscribe = audio.observeFocusMuted((muted) => seen.push(muted));

    // Subscribing fires immediately with the current (unmuted) value.
    expect(seen).toEqual([false]);

    audio.setFocusMuted(true);
    expect(seen).toEqual([false, true]);

    // No duplicate notification when the value does not actually change.
    audio.setFocusMuted(true);
    expect(seen).toEqual([false, true]);

    audio.setFocusMuted(false);
    expect(seen).toEqual([false, true, false]);

    unsubscribe();
    audio.setFocusMuted(true);
    expect(seen).toEqual([false, true, false]);
  });

  it("notifies focus-mute observers via suspendForLifecycle even without an active graph", () => {
    const audio = new GameAudio();
    const seen: boolean[] = [];
    audio.observeFocusMuted((muted) => seen.push(muted));
    expect(seen).toEqual([false]);

    audio.suspendForLifecycle();
    expect(seen).toEqual([false, true]);

    // A second suspend call while already muted must not re-notify.
    audio.suspendForLifecycle();
    expect(seen).toEqual([false, true]);
  });

  it("keeps a faulty focus-mute observer from blocking other observers or the caller", () => {
    const audio = new GameAudio();
    const seen: boolean[] = [];
    audio.observeFocusMuted(() => {
      throw new Error("boom");
    });
    audio.observeFocusMuted((muted) => seen.push(muted));

    expect(() => audio.setFocusMuted(true)).not.toThrow();
    expect(seen).toEqual([false, true]);
  });
});

function audioGraph() {
  const contexts: unknown[] = [];
  const gains: Gain[] = [];
  const oscillators: Array<{
    frequency: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const resume = vi.fn(() => Promise.resolve());
  const suspend = vi.fn(() => Promise.resolve());
  let state: AudioContextState = "running";

  class Gain {
    gain = {
      setTargetAtTime: vi.fn(),
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    connect = vi.fn();

    constructor() {
      gains.push(this);
    }
  }

  class Oscillator {
    type: OscillatorType = "sine";
    frequency = {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    connect = vi.fn();
    start = vi.fn();
    stop = vi.fn();

    constructor() {
      oscillators.push(this);
    }
  }

  class Context {
    currentTime = 0;
    get state(): AudioContextState {
      return state;
    }
    destination = {};
    createGain = () => new Gain();
    createOscillator = () => new Oscillator();
    resume = resume;
    suspend = suspend;

    constructor() {
      contexts.push(this);
    }
  }

  return {
    Context,
    contexts,
    gains,
    oscillators,
    resume,
    suspend,
    setState(next: AudioContextState) {
      state = next;
    },
  };
}
