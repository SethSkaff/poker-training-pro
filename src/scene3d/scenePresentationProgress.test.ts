import { describe, expect, it } from "vitest";
import {
  sampleScenePresentationProgress,
  scenePresentationProgress,
  type ScenePresentationDelay,
} from "./scenePresentationProgress";

class Frames {
  private next = 1;
  private callbacks = new Map<number, () => void>();

  request(callback: () => void) {
    const id = this.next++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancel(id: number) {
    this.callbacks.delete(id);
  }

  runOne() {
    const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) throw new Error("Expected a frame");
    this.callbacks.delete(entry[0]);
    entry[1]();
  }

  get pending() {
    return this.callbacks.size;
  }
}

describe("scene presentation progress", () => {
  it("clamps the authoritative delay sample without completing it", () => {
    const delay: ScenePresentationDelay = { remaining: 1_500, isPending: true, isFrozen: false };
    expect(scenePresentationProgress(delay, 1_000)).toBe(0);
  });

  it("freezes at the exact sampled remainder and resumes without replay", () => {
    const delay = { remaining: 700, isPending: true, isFrozen: false };
    const frames = new Frames();
    const samples: number[] = [];
    const stop = sampleScenePresentationProgress(delay, 1_000, (progress) => samples.push(progress), frames);

    frames.runOne();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toBeCloseTo(0.3, 12);
    expect(frames.pending).toBe(1);

    delay.isFrozen = true;
    frames.runOne();
    expect(samples).toHaveLength(2);
    expect(samples[1]).toBe(samples[0]);
    expect(frames.pending).toBe(0);

    delay.isFrozen = false;
    const resume = sampleScenePresentationProgress(delay, 1_000, (progress) => samples.push(progress), frames);
    frames.runOne();
    expect(samples).toHaveLength(3);
    expect(samples[2]).toBe(samples[0]);

    delay.remaining = 0;
    delay.isPending = false;
    frames.runOne();
    expect(samples).toHaveLength(4);
    expect(samples[3]).toBe(1);
    expect(frames.pending).toBe(0);
    stop();
    resume();
  });
});
