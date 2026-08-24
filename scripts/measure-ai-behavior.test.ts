import { describe, expect, it } from "vitest";
import { summarizeEventTimelines } from "./measure-ai-behavior";

describe("AI behavior event timeline censoring", () => {
  it("does not turn a capped event into a false finish or omit it from coverage", () => {
    const summary = summarizeEventTimelines([
      {
        seed: "complete",
        handsPlayed: 24,
        termination: "finished",
        handsToFirstElimination: 4,
        handsToHeadsUp: 18,
        handsToFinish: 24,
      },
      {
        seed: "capped",
        handsPlayed: 400,
        termination: "hand-cap",
        handsToFirstElimination: 3,
      },
    ]);

    expect(summary.completedEvents).toBe(1);
    expect(summary.cappedEvents).toBe(1);
    expect(summary.handsToHeadsUp).toEqual({ mean: 18, median: 18, samples: 1 });
    expect(summary.handsToFinish).toEqual({ mean: 24, median: 24, samples: 1 });
  });

  it("keeps action-cap outcomes distinct from completed tournaments", () => {
    const summary = summarizeEventTimelines([
      { seed: "stalled", handsPlayed: 12, termination: "action-cap" },
    ]);
    expect(summary.completedEvents).toBe(0);
    expect(summary.cappedEvents).toBe(1);
    expect(summary.handsToFinish.samples).toBe(0);
    expect(summary.handsToHeadsUp.samples).toBe(0);
  });
});
