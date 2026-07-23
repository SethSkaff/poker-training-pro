import { describe, expect, it } from "vitest";
import {
  calculateAiDecisionTiming,
  type DecisionTimingInput,
} from "./decisionTiming";

const BASE: DecisionTimingInput = {
  seed: "event-7",
  decisionId: "hand-12-seat-4-flop",
  street: "flop",
  action: "call",
  cutoffCloseness: 0.5,
  uncertainty: 0.5,
  tempo: 0,
  presentationRate: 1,
};

describe("AI decision presentation timing", () => {
  it("is deterministic and remains inside the desktop budget", () => {
    const first = calculateAiDecisionTiming(BASE);
    const replay = calculateAiDecisionTiming(BASE);

    expect(replay).toEqual(first);
    expect(first.delayMs).toBeGreaterThanOrEqual(650);
    expect(first.delayMs).toBeLessThanOrEqual(4_300);
  });

  it("honors presentation speed without changing the seeded policy inputs", () => {
    const normal = calculateAiDecisionTiming(BASE);
    const quick = calculateAiDecisionTiming({
      ...BASE,
      presentationRate: 2,
    });

    expect(quick.unscaledDelayMs).toBe(normal.unscaledDelayMs);
    expect(quick.delayMs).toBe(Math.round(normal.delayMs / 2));
  });

  it("uses a shorter capped mobile animation budget", () => {
    const desktop = calculateAiDecisionTiming(BASE);
    const mobile = calculateAiDecisionTiming({ ...BASE, surface: "mobile" });

    expect(mobile.delayMs).toBeLessThan(desktop.delayMs);
    expect(mobile.delayMs).toBeLessThanOrEqual(2_800);
  });

  it("caps the difficulty signal below the anti-tell noise envelope", () => {
    const result = calculateAiDecisionTiming({
      ...BASE,
      cutoffCloseness: 100,
      uncertainty: 100,
    });

    expect(result.boundedDifficultyMs).toBe(300);
    expect(result.antiTellNoiseMs).toBeLessThanOrEqual(2_470);
  });

  it("keeps aggregate timing correlation with cutoff closeness weak", () => {
    const samples = Array.from({ length: 4_000 }, (_, index) => {
      // A deterministic, non-monotonic sweep prevents seed order becoming an
      // accidental proxy for the tested closeness value.
      const closeness = ((index * 977) % 4_001) / 4_000;
      const timing = calculateAiDecisionTiming({
        ...BASE,
        seed: `league-${index * 37 + 11}`,
        decisionId: `decision-${index * 101 + 3}`,
        cutoffCloseness: closeness,
        uncertainty: ((index * 541) % 4_001) / 4_000,
      });
      return [closeness, timing.delayMs] as const;
    });

    expect(Math.abs(pearson(samples))).toBeLessThan(0.18);
  });

  it("rejects missing identity and non-finite timing signals", () => {
    expect(() =>
      calculateAiDecisionTiming({ ...BASE, seed: " " }),
    ).toThrow(/seed/i);
    expect(() =>
      calculateAiDecisionTiming({
        ...BASE,
        cutoffCloseness: Number.NaN,
      }),
    ).toThrow(/finite/i);
  });
});

function pearson(samples: ReadonlyArray<readonly [number, number]>): number {
  const averageX =
    samples.reduce((total, [value]) => total + value, 0) / samples.length;
  const averageY =
    samples.reduce((total, [, value]) => total + value, 0) / samples.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of samples) {
    const offsetX = x - averageX;
    const offsetY = y - averageY;
    covariance += offsetX * offsetY;
    varianceX += offsetX * offsetX;
    varianceY += offsetY * offsetY;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}
