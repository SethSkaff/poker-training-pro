import { describe, expect, it, vi } from "vitest";
import {
  AudioFocusController,
  initialAudioFocusState,
  transitionAudioFocus,
  type AudioFocusEvent,
} from "./audioFocusPolicy";

function run(...events: AudioFocusEvent[]) {
  let state = initialAudioFocusState();
  let effects: readonly unknown[] = [];
  for (const event of events) {
    const result = transitionAudioFocus(state, event);
    state = result.state;
    effects = result.effects;
  }
  return { state, effects };
}

describe("audio focus policy", () => {
  it("starts silent and cannot play before user activation", () => {
    expect(initialAudioFocusState()).toMatchObject({
      readiness: "needs-user-activation",
      lifecycleMuted: true,
      canPlay: false,
    });
  });

  it("unmutes and permits context resume on explicit user activation", () => {
    const result = run({ type: "user-activated" });

    expect(result.state).toMatchObject({
      userActivated: true,
      readiness: "ready",
      canPlay: true,
    });
    expect(result.effects).toEqual([
      { type: "set-lifecycle-muted", muted: false },
      { type: "resume-context-after-explicit-ready" },
    ]);
  });

  it.each([
    [{ type: "manual-pause", active: true }, "manual-pause"],
    [{ type: "window-focus", focused: false }, "window-blurred"],
    [
      { type: "document-visibility", visible: false },
      "document-hidden",
    ],
    [{ type: "system-suspend", suspended: true }, "system-suspended"],
    [
      { type: "audio-interruption", interrupted: true },
      "audio-interrupted",
    ],
  ] as const)("blocks immediately for %s", (event, blocker) => {
    const result = run({ type: "user-activated" }, event);

    expect(result.state).toMatchObject({
      readiness: "blocked",
      lifecycleMuted: true,
      canPlay: false,
    });
    expect(result.state.blockers).toContain(blocker);
    expect(result.effects).toEqual([
      { type: "set-lifecycle-muted", muted: true },
      { type: "suspend-context" },
    ]);
  });

  it("does not auto-resume when focus returns", () => {
    const result = run(
      { type: "user-activated" },
      { type: "window-focus", focused: false },
      { type: "window-focus", focused: true },
    );

    expect(result.state).toMatchObject({
      readiness: "needs-ready-confirmation",
      lifecycleMuted: true,
    });
    expect(result.effects).toEqual([]);
  });

  it("resumes only after Ready is confirmed with no blockers", () => {
    const result = run(
      { type: "user-activated" },
      { type: "document-visibility", visible: false },
      { type: "document-visibility", visible: true },
      { type: "ready-confirmed" },
    );

    expect(result.state.readiness).toBe("ready");
    expect(result.effects).toEqual([
      { type: "set-lifecycle-muted", muted: false },
      { type: "resume-context-after-explicit-ready" },
    ]);
  });

  it("keeps blocking until every simultaneous lifecycle reason clears", () => {
    const result = run(
      { type: "user-activated" },
      { type: "window-focus", focused: false },
      { type: "document-visibility", visible: false },
      { type: "system-suspend", suspended: true },
      { type: "window-focus", focused: true },
      { type: "document-visibility", visible: true },
      { type: "ready-confirmed" },
    );

    expect(result.state.blockers).toEqual(["system-suspended"]);
    expect(result.state.readiness).toBe("blocked");
    expect(result.state.canPlay).toBe(false);
  });

  it("requires output recovery and then explicit Ready after disconnect", () => {
    const disconnected = run(
      { type: "user-activated" },
      { type: "output-availability", available: false },
    );
    expect(disconnected.state.readiness).toBe("output-unavailable");

    const reconnected = transitionAudioFocus(disconnected.state, {
      type: "output-availability",
      available: true,
    });
    expect(reconnected.state.readiness).toBe("needs-ready-confirmation");
    expect(reconnected.state.lifecycleMuted).toBe(true);

    const ready = transitionAudioFocus(reconnected.state, {
      type: "ready-confirmed",
    });
    expect(ready.state.readiness).toBe("ready");
  });

  it("does not treat simultaneous system audio as a focus transition", () => {
    const active = run(
      { type: "user-activated" },
      { type: "system-audio", active: true },
    );
    const inactive = transitionAudioFocus(active.state, {
      type: "system-audio",
      active: false,
    });

    expect(active.state.canPlay).toBe(true);
    expect(active.state.systemAudioActive).toBe(true);
    expect(active.effects).toEqual([]);
    expect(inactive.state.canPlay).toBe(true);
    expect(inactive.effects).toEqual([]);
  });

  it("stays terminally silent after an audio failure", () => {
    const failed = run(
      { type: "user-activated" },
      { type: "audio-failed" },
      { type: "ready-confirmed" },
      { type: "output-availability", available: true },
    );

    expect(failed.state).toMatchObject({
      readiness: "failed",
      canPlay: false,
      lifecycleMuted: true,
    });
  });

  it("is idempotent for duplicate events and sorts blockers", () => {
    const result = run(
      { type: "system-suspend", suspended: true },
      { type: "manual-pause", active: true },
      { type: "manual-pause", active: true },
      { type: "window-focus", focused: false },
    );

    expect(result.state.blockers).toEqual([
      "manual-pause",
      "window-blurred",
      "system-suspended",
    ]);
    expect(new Set(result.state.blockers).size).toBe(3);
  });

  it("controller applies effects without exposing preference controls", () => {
    const target = {
      setFocusMuted: vi.fn(),
      suspendForLifecycle: vi.fn(),
      resumeAfterExplicitReady: vi.fn(),
    };
    const controller = new AudioFocusController(target);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.dispatch({ type: "user-activated" });
    controller.dispatch({ type: "manual-pause", active: true });
    controller.dispatch({ type: "manual-pause", active: false });
    controller.dispatch({ type: "ready-confirmed" });

    expect(target.setFocusMuted.mock.calls).toEqual([
      [true],
      [false],
      [true],
      [false],
    ]);
    expect(target.suspendForLifecycle).toHaveBeenCalledTimes(1);
    expect(target.resumeAfterExplicitReady).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("controller contains target failures so audio cannot break gameplay", () => {
    const controller = new AudioFocusController({
      setFocusMuted: vi.fn(() => {
        throw new Error("device lost");
      }),
      suspendForLifecycle: vi.fn(() => Promise.reject(new Error("lost"))),
    });

    expect(() =>
      controller.dispatch({ type: "user-activated" }),
    ).not.toThrow();
    expect(() =>
      controller.dispatch({ type: "system-suspend", suspended: true }),
    ).not.toThrow();
  });
});

