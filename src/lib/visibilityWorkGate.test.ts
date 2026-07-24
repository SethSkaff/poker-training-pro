import { describe, expect, it } from "vitest";
import {
  createVisibilityAwareAnimationLoop,
  createVisibilityGate,
  type VisibilityDocumentLike,
} from "./visibilityWorkGate";

class FakeDocument implements VisibilityDocumentLike {
  hidden = false;
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeFrameScheduler {
  private next = 1;
  private readonly frames = new Map<number, (timestamp: number) => void>();
  request = (callback: (timestamp: number) => void): number => {
    const handle = this.next;
    this.next += 1;
    this.frames.set(handle, callback);
    return handle;
  };
  cancel = (handle: number): void => {
    this.frames.delete(handle);
  };
  get pending(): number {
    return this.frames.size;
  }
  /** Runs at most `max` queued frames (each frame may schedule the next one). */
  flush(max = 100): number {
    let ran = 0;
    for (let i = 0; i < max; i += 1) {
      const [handle, callback] = this.frames.entries().next().value ?? [];
      if (handle === undefined) break;
      this.frames.delete(handle);
      callback?.(i);
      ran += 1;
    }
    return ran;
  }
}

describe("createVisibilityGate", () => {
  it("resolves immediately when visible and defers while hidden", async () => {
    const doc = new FakeDocument();
    const gate = createVisibilityGate(doc);
    await expect(gate.whenVisible()).resolves.toBeUndefined();

    doc.setHidden(true);
    expect(gate.isHidden()).toBe(true);
    let resumed = false;
    const pending = gate.whenVisible().then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    doc.setHidden(false);
    await pending;
    expect(resumed).toBe(true);
    gate.dispose();
    expect(doc.listenerCount).toBe(0);
  });

  it("releases pending waiters on dispose", async () => {
    const doc = new FakeDocument();
    const gate = createVisibilityGate(doc);
    doc.setHidden(true);
    const pending = gate.whenVisible();
    gate.dispose();
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("createVisibilityAwareAnimationLoop", () => {
  it("does not schedule frames while hidden and resumes when visible", () => {
    const doc = new FakeDocument();
    const scheduler = new FakeFrameScheduler();
    let steps = 0;
    const loop = createVisibilityAwareAnimationLoop(() => {
      steps += 1;
    }, {
      requestFrame: scheduler.request,
      cancelFrame: scheduler.cancel,
      doc,
    });

    expect(scheduler.pending).toBe(1);
    scheduler.flush(5);
    expect(steps).toBe(5);

    // Hidden: the in-flight frame is cancelled and none are scheduled.
    doc.setHidden(true);
    expect(scheduler.pending).toBe(0);
    const before = steps;
    scheduler.flush(5);
    expect(steps).toBe(before);

    // Visible again: work resumes.
    doc.setHidden(false);
    expect(scheduler.pending).toBe(1);
    scheduler.flush(3);
    expect(steps).toBe(before + 3);

    loop.stop();
    expect(scheduler.pending).toBe(0);
    expect(doc.listenerCount).toBe(0);
  });

  it("stops cleanly with no leaked frame or listener", () => {
    const doc = new FakeDocument();
    const scheduler = new FakeFrameScheduler();
    const loop = createVisibilityAwareAnimationLoop(() => undefined, {
      requestFrame: scheduler.request,
      cancelFrame: scheduler.cancel,
      doc,
    });
    expect(loop.isRunning()).toBe(true);
    loop.stop();
    expect(scheduler.pending).toBe(0);
    expect(doc.listenerCount).toBe(0);
    // Idempotent.
    loop.stop();
  });
});
