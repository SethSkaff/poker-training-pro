import { describe, expect, it } from "vitest";
import {
  initialSceneAvailability,
  startSceneAttempt,
  transitionSceneAvailability,
  type SceneAvailability,
  type SceneFrameCallbacks,
} from "./sceneAvailability";

describe("scene availability state machine", () => {
  it("does not become ready until a first frame succeeds", () => {
    const probing = transitionSceneAvailability(initialSceneAvailability, { type: "begin" });
    const loading = transitionSceneAvailability(probing, { type: "probe-passed" });
    expect(loading).toEqual({ status: "loading" });
    expect(transitionSceneAvailability(loading, { type: "first-frame" })).toEqual({ status: "ready" });
  });

  it("cannot be revived by stale callbacks after disposal", () => {
    const disposed = transitionSceneAvailability(initialSceneAvailability, { type: "dispose" });
    expect(transitionSceneAvailability(disposed, { type: "first-frame" })).toBe(disposed);
    expect(transitionSceneAvailability(disposed, { type: "context-lost" })).toBe(disposed);
  });
});

describe("scene renderer attempt", () => {
  const state = { pot: 120 };

  function run(
    probe: () => "available" | "unsupported" | "blocked",
    create?: (_canvas: object, _state: typeof state, callbacks: SceneFrameCallbacks) => { dispose(): void },
  ) {
    const updates: SceneAvailability[] = [];
    let disposeCount = 0;
    let callbacks: SceneFrameCallbacks | undefined;
    const attempt = startSceneAttempt({
      canvas: {}, state, probe,
      create: create ?? ((_canvas, _state, nextCallbacks) => {
        callbacks = nextCallbacks;
        return { dispose: () => { disposeCount += 1; } };
      }),
      onAvailability: (availability) => updates.push(availability),
    });
    return { attempt, updates, get callbacks() { return callbacks; }, get disposeCount() { return disposeCount; } };
  }

  it("keeps the fallback until an injected renderer reports its first frame", () => {
    const result = run(() => "available");
    expect(result.updates.map((entry) => entry.status)).toEqual(["probing", "loading"]);
    result.callbacks?.onFirstFrame();
    expect(result.updates.at(-1)).toEqual({ status: "ready" });
  });

  it("reports null and blocked probes as stable fallback reasons", () => {
    expect(run(() => "unsupported").updates.at(-1)).toEqual({ status: "failed", reason: "unsupported" });
    expect(run(() => "blocked").updates.at(-1)).toEqual({ status: "failed", reason: "blocked" });
    expect(run((() => { throw new Error("policy"); }) as () => "available").updates.at(-1)).toEqual({ status: "failed", reason: "blocked" });
  });

  it("contains constructor and first-frame failures without exposing a ready scene", () => {
    const constructorFailure = run(() => "available", () => { throw new Error("driver"); });
    expect(constructorFailure.updates.at(-1)).toEqual({ status: "failed", reason: "constructor-failed" });
    const frameFailure = run(() => "available");
    frameFailure.callbacks?.onFrameFailure();
    expect(frameFailure.updates.at(-1)).toEqual({ status: "failed", reason: "first-frame-failed" });
    expect(frameFailure.disposeCount).toBe(1);
  });

  it("disposes once and restores fallback on context loss or unmount", () => {
    const lost = run(() => "available");
    lost.callbacks?.onFirstFrame();
    lost.attempt.contextLost();
    lost.attempt.dispose();
    expect(lost.updates.at(-1)).toEqual({ status: "lost" });
    expect(lost.disposeCount).toBe(1);
    const unmounted = run(() => "available");
    unmounted.attempt.dispose();
    unmounted.attempt.dispose();
    expect(unmounted.updates.at(-1)).toEqual({ status: "disposed" });
    expect(unmounted.disposeCount).toBe(1);
  });

  it("passes an initial pause through to the renderer without delaying readiness state", () => {
    let received: SceneFrameCallbacks | undefined;
    startSceneAttempt({
      canvas: {}, state, probe: () => "available", startSuspended: true,
      create: (_canvas, _state, callbacks) => {
        received = callbacks;
        return { dispose() {} };
      },
      onAvailability: () => {},
    });
    expect(received?.startSuspended).toBe(true);
  });
});
