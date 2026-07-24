import { describe, expect, it } from "vitest";
import {
  createTrainingCheckpoint,
  restoreTrainingCheckpoint,
} from "./trainingCheckpoint";

describe("Training checkpoint", () => {
  const scenarioIds = new Set(["turn-pot-odds", "river-bluff-catch-price"]);

  it("round-trips a known scenario with only player-owned presentation state", () => {
    const checkpoint = createTrainingCheckpoint("turn-pot-odds", {
      cameraPan: -2,
      elapsedMs: 18_450,
      paused: true,
    });
    expect(checkpoint).toEqual({
      format: "poker-training-pro-training-checkpoint",
      version: 2,
      scenarioId: "turn-pot-odds",
      presentation: { cameraPan: -2, elapsedMs: 18_450, paused: true },
    });
    expect(Object.keys(checkpoint)).toEqual([
      "format",
      "version",
      "scenarioId",
      "presentation",
    ]);
    expect(restoreTrainingCheckpoint(checkpoint, scenarioIds)).toEqual(checkpoint);
  });

  it("migrates version-one scenario checkpoints to a safe seated state", () => {
    expect(
      restoreTrainingCheckpoint(
        {
          format: "poker-training-pro-training-checkpoint",
          version: 1,
          scenarioId: "turn-pot-odds",
        },
        scenarioIds,
      ),
    ).toEqual(createTrainingCheckpoint("turn-pot-odds"));
  });

  it("clamps malformed presentation values and excludes answer state", () => {
    const restored = restoreTrainingCheckpoint(
      {
        format: "poker-training-pro-training-checkpoint",
        version: 2,
        scenarioId: "turn-pot-odds",
        presentation: {
          cameraPan: 99,
          elapsedMs: Infinity,
          paused: "yes",
          mathAnswer: "1/3",
          hiddenCards: ["As", "Kh"],
        },
      },
      scenarioIds,
    );

    expect(restored?.presentation).toEqual({
      cameraPan: 2,
      elapsedMs: 0,
      paused: false,
    });
    expect(JSON.stringify(restored)).not.toContain("mathAnswer");
    expect(JSON.stringify(restored)).not.toContain("hiddenCards");
  });

  it("rejects unknown, malformed, and future checkpoint payloads", () => {
    for (const value of [
      null,
      {},
      { format: "poker-training-pro-training-checkpoint", version: 3, scenarioId: "turn-pot-odds" },
      { format: "poker-training-pro-training-checkpoint", version: 1, scenarioId: "unknown" },
      { format: "another-format", version: 1, scenarioId: "turn-pot-odds" },
    ]) {
      expect(restoreTrainingCheckpoint(value, scenarioIds)).toBeUndefined();
    }
  });
});
