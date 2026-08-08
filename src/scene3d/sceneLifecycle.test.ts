import { describe, expect, it } from "vitest";
import {
  createSceneRenderLifecycle,
  type SceneLifecycleHost,
} from "./sceneLifecycle";
import type { VisibilityDocumentLike } from "../lib/visibilityWorkGate";

class FakeDocument implements VisibilityDocumentLike {
  hidden = false;
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeFrames {
  private next = 1;
  private readonly pendingFrames = new Map<number, (timestamp: number) => void>();
  requestFrame = (callback: (timestamp: number) => void): number => {
    const handle = this.next++;
    this.pendingFrames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number): void => {
    this.pendingFrames.delete(handle);
  };
  get pending(): number {
    return this.pendingFrames.size;
  }
  step(timestamp = 10): void {
    const [handle, callback] = this.pendingFrames.entries().next().value ?? [];
    if (handle === undefined) return;
    this.pendingFrames.delete(handle);
    callback?.(timestamp);
  }
}

function makeHost(doc: FakeDocument, frames: FakeFrames): SceneLifecycleHost {
  return { doc, requestFrame: frames.requestFrame, cancelFrame: frames.cancelFrame, now: () => 0 };
}

describe("scene render lifecycle", () => {
  it("renders on demand when static and produces no paused or hidden frames", () => {
    const doc = new FakeDocument();
    const frames = new FakeFrames();
    const draws: number[] = [];
    const lifecycle = createSceneRenderLifecycle((time) => draws.push(time), makeHost(doc, frames));

    lifecycle.update({ suspended: false, reducedMotion: false, needsAnimation: false });
    expect(draws).toEqual([0]);
    expect(frames.pending).toBe(0);

    lifecycle.update({ suspended: false, reducedMotion: false, needsAnimation: true });
    expect(frames.pending).toBe(1);
    frames.step(12);
    expect(draws).toEqual([0, 12]);

    lifecycle.update({ suspended: true, reducedMotion: false, needsAnimation: true });
    expect(frames.pending).toBe(0);
    doc.setHidden(true);
    doc.setHidden(false);
    expect(frames.pending).toBe(0);
    lifecycle.dispose();
  });

  it("uses the visibility gate and draws reduced motion only on meaningful changes", () => {
    const doc = new FakeDocument();
    const frames = new FakeFrames();
    let draws = 0;
    const lifecycle = createSceneRenderLifecycle(() => { draws += 1; }, makeHost(doc, frames));

    lifecycle.update({ suspended: false, reducedMotion: true, needsAnimation: true });
    lifecycle.update({ suspended: false, reducedMotion: true, needsAnimation: true });
    expect(draws).toBe(2);
    expect(frames.pending).toBe(0);

    lifecycle.update({ suspended: false, reducedMotion: false, needsAnimation: true });
    expect(frames.pending).toBe(1);
    doc.setHidden(true);
    expect(frames.pending).toBe(0);
    doc.setHidden(false);
    expect(frames.pending).toBe(1);
    lifecycle.dispose();
    expect(frames.pending).toBe(0);
  });
});
