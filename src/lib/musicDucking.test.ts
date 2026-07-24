import { describe, expect, it } from "vitest";
import { connectFeedbackDucking, type DuckingTimers } from "./musicDucking";
import type { SoundName } from "./audio";

function fakeAudio() {
  const listeners = new Set<(sound: SoundName) => void>();
  return {
    observeFeedback(listener: (sound: SoundName) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(sound: SoundName) {
      for (const listener of listeners) listener(sound);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function manualTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timers: DuckingTimers = {
    setTimer(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    clearTimer(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    fireAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    size() {
      return pending.size;
    },
  };
}

function duckSpy() {
  const calls: boolean[] = [];
  return {
    calls,
    setDucking(active: boolean) {
      calls.push(active);
    },
  };
}

describe("connectFeedbackDucking", () => {
  it("ducks on a feedback cue and releases after the timer fires", () => {
    const audio = fakeAudio();
    const controller = duckSpy();
    const clock = manualTimers();
    connectFeedbackDucking(audio, controller, {
      releaseMs: 500,
      timers: clock.timers,
    });

    audio.emit("success");
    expect(controller.calls).toEqual([true]);
    expect(clock.size()).toBe(1);

    clock.fireAll();
    expect(controller.calls).toEqual([true, false]);
  });

  it("keeps the bed ducked until the last overlapping cue releases", () => {
    const audio = fakeAudio();
    const controller = duckSpy();
    const clock = manualTimers();
    connectFeedbackDucking(audio, controller, {
      releaseMs: 500,
      timers: clock.timers,
    });

    audio.emit("chip");
    audio.emit("chip");
    // The first release timer was cancelled; only one remains.
    expect(clock.size()).toBe(1);
    clock.fireAll();
    expect(controller.calls).toEqual([true, true, false]);
  });

  it("ignores the click cue and only ducks for feedback sounds", () => {
    const audio = fakeAudio();
    const controller = duckSpy();
    const clock = manualTimers();
    connectFeedbackDucking(audio, controller, { timers: clock.timers });

    audio.emit("click");
    expect(controller.calls).toEqual([]);
    expect(clock.size()).toBe(0);
  });

  it("unsubscribes and releases ducking on teardown", () => {
    const audio = fakeAudio();
    const controller = duckSpy();
    const clock = manualTimers();
    const disconnect = connectFeedbackDucking(audio, controller, {
      timers: clock.timers,
    });

    audio.emit("fold");
    disconnect();
    expect(controller.calls.at(-1)).toBe(false);
    expect(audio.listenerCount()).toBe(0);
    // Further cues do nothing once disconnected.
    audio.emit("error");
    expect(controller.calls.at(-1)).toBe(false);
  });
});
