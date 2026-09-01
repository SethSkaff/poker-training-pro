import { describe, expect, it } from "vitest";
import { summarizeEventTimelines } from "./measure-ai-behavior";

describe("AI behavior event timeline censoring", () => {
  it("does not turn a capped event into a false finish or omit it from coverage", () => {
    const summary = summarizeEventTimelines([
      {
        seed: "complete",
        handsPlayed: 24,
        completionScope: "hero-session",
        termination: "finished",
        fieldFinished: true,
        tournamentPlayersRemainingAtTermination: 1,
        heroFinishPlace: 1,
        handsToFirstElimination: 4,
        fieldHandsToHeadsUp: 18,
        handsToHeadsUp: 18,
        handsToFinish: 24,
      },
      {
        seed: "capped",
        handsPlayed: 400,
        completionScope: "hero-session",
        termination: "hand-cap",
        fieldFinished: false,
        tournamentPlayersRemainingAtTermination: 3,
        handsToFirstElimination: 3,
      },
    ]);

    expect(summary.completedEvents).toBe(1);
    expect(summary.fieldCompletedEvents).toBe(1);
    expect(summary.fieldHandsToHeadsUp).toEqual({ mean: 18, median: 18, samples: 1 });
    expect(summary.cappedEvents).toBe(1);
    expect(summary.handsToHeadsUp).toEqual({ mean: 18, median: 18, samples: 1 });
    expect(summary.handsToFinish).toEqual({ mean: 24, median: 24, samples: 1 });
  });

  it("keeps action-cap outcomes distinct from completed tournaments", () => {
    const summary = summarizeEventTimelines([
      {
        seed: "stalled",
        handsPlayed: 12,
        completionScope: "hero-session",
        termination: "action-cap",
        fieldFinished: false,
        tournamentPlayersRemainingAtTermination: 4,
      },
    ]);
    expect(summary.completedEvents).toBe(0);
    expect(summary.fieldCompletedEvents).toBe(0);
    expect(summary.fieldHandsToHeadsUp.samples).toBe(0);
    expect(summary.cappedEvents).toBe(1);
    expect(summary.handsToFinish.samples).toBe(0);
    expect(summary.handsToHeadsUp.samples).toBe(0);
  });

  it("distinguishes a hero bust from a full-field winner", () => {
    const summary = summarizeEventTimelines([
      {
        seed: "hero-bust",
        handsPlayed: 17,
        completionScope: "hero-session",
        termination: "finished",
        fieldFinished: false,
        tournamentPlayersRemainingAtTermination: 2,
        heroFinishPlace: 3,
        fieldHandsToHeadsUp: 15,
        handsToFinish: 17,
      },
    ]);

    expect(summary.completedEvents).toBe(1);
    expect(summary.fieldCompletedEvents).toBe(0);
    expect(summary.fieldHandsToHeadsUp).toEqual({ mean: 15, median: 15, samples: 1 });
    expect(summary.handsToHeadsUp.samples).toBe(0);
    expect(summary.handsToFinish).toEqual({ mean: 17, median: 17, samples: 1 });
  });
});
