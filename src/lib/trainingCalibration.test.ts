import { describe, expect, it } from "vitest";
import frozenBaseline from "../data/fixtures/training-calibration-v1.json";
import {
  TRAINING_CALIBRATION_VERSION,
  auditTrainingCalibration,
  buildTrainingCalibration,
  type TrainingCalibrationBaseline,
} from "./trainingCalibration";

function cloneBaseline(): TrainingCalibrationBaseline {
  return structuredClone(frozenBaseline) as TrainingCalibrationBaseline;
}

describe("frozen synthetic Training calibration", () => {
  it("matches the checked-in synthetic baseline exactly", () => {
    const audit = auditTrainingCalibration(cloneBaseline());

    expect(audit).toEqual({
      ok: true,
      code: "pass",
      message: `Synthetic Training calibration ${TRAINING_CALIBRATION_VERSION} matches its frozen baseline.`,
    });
  });

  it("covers both score dimensions, every current street, every tag, and all rating bands", () => {
    const result = buildTrainingCalibration();

    expect(result.evidenceKind).toBe("synthetic-regression-only");
    expect(result.reviewStatus).toBe("pending-human-review");
    expect(result.coverage.streets.map(({ value }) => value)).toEqual([
      "flop",
      "preflop",
      "river",
      "turn",
    ]);
    expect(result.coverage.decisionBands.map(({ value }) => value)).toEqual([
      "advanced",
      "expert",
      "foundation",
      "intermediate",
    ]);
    expect(result.coverage.mathBands.map(({ value }) => value)).toEqual([
      "advanced",
      "expert",
      "foundation",
      "intermediate",
    ]);
    expect(result.coverage.tags.length).toBeGreaterThan(20);
    for (const run of result.archetypes) {
      expect(run.attempts).toHaveLength(result.scenarioContracts.length);
      expect(run.action.possible).toBe(result.scenarioContracts.length);
      expect(run.math.possible).toBe(result.scenarioContracts.length);
    }
  });

  it("freezes every near-transfer choice", () => {
    const result = buildTrainingCalibration();

    expect(result.nearTransferPairs).toHaveLength(result.scenarioContracts.length);
    expect(result.nearTransferPairs.every(({ to }) => to !== null)).toBe(true);
    expect(
      result.nearTransferPairs.some(({ from, to }) => {
        const fromScenario = result.scenarioContracts.find(
          (scenario) => scenario.id === from,
        );
        const toScenario = result.scenarioContracts.find(
          (scenario) => scenario.id === to,
        );
        return fromScenario?.street !== toScenario?.street;
      }),
    ).toBe(true);
  });

  it("keeps reference above developing above nonresponse on both synthetic dimensions", () => {
    const runs = new Map(
      buildTrainingCalibration().archetypes.map((run) => [run.id, run]),
    );

    expect(runs.get("reference")!.action.rate).toBeGreaterThan(
      runs.get("developing")!.action.rate,
    );
    expect(runs.get("developing")!.action.rate).toBeGreaterThan(
      runs.get("nonresponse")!.action.rate,
    );
    expect(runs.get("reference")!.math.rate).toBeGreaterThan(
      runs.get("developing")!.math.rate,
    );
    expect(runs.get("developing")!.math.rate).toBeGreaterThan(
      runs.get("nonresponse")!.math.rate,
    );
  });

  it("freezes the legacy TrainingResult projection for historical-score compatibility", () => {
    const current = buildTrainingCalibration();
    const baseline = cloneBaseline();

    expect(
      current.archetypes.map((run) =>
        run.attempts.map((attempt) => attempt.legacyResult),
      ),
    ).toEqual(
      baseline.archetypes.map((run) =>
        run.attempts.map((attempt) => attempt.legacyResult),
      ),
    );
    for (const run of current.archetypes) {
      for (const { legacyResult } of run.attempts) {
        expect(Object.keys(legacyResult).sort()).toEqual([
          "action",
          "actionCorrect",
          "completedAt",
          "elapsedMs",
          "eloDelta",
          "mathAnswer",
          "mathCorrect",
          "scenarioId",
        ]);
      }
    }
  });

  it("rejects a silent scoring or classification change", () => {
    const changed = buildTrainingCalibration();
    changed.scenarioContracts[0].mathTolerance += 0.01;

    expect(auditTrainingCalibration(cloneBaseline(), changed)).toMatchObject({
      ok: false,
      code: "silent-drift",
    });
  });

  it("requires a reviewed baseline refresh after a calibration version change", () => {
    const changed = buildTrainingCalibration();
    changed.calibrationVersion = "training-calibration-2.0.0";

    expect(auditTrainingCalibration(cloneBaseline(), changed)).toMatchObject({
      ok: false,
      code: "baseline-refresh-required",
    });
  });
});
