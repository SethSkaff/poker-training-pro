import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditTrainingCalibration,
  buildTrainingCalibration,
  type TrainingCalibrationBaseline,
} from "../src/lib/trainingCalibration";

const baselinePath = resolve(
  process.cwd(),
  "src/data/fixtures/training-calibration-v1.json",
);

try {
  const baseline = JSON.parse(
    readFileSync(baselinePath, "utf8"),
  ) as TrainingCalibrationBaseline;
  const current = buildTrainingCalibration();
  const audit = auditTrainingCalibration(baseline, current);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: audit.ok,
        code: audit.code,
        message: audit.message,
        calibrationVersion: current.calibrationVersion,
        scenarioContentVersion: current.scenarioContentVersion,
        scenarios: current.scenarioContracts.length,
        archetypes: current.archetypes.map((run) => ({
          id: run.id,
          actionRate: run.action.rate,
          mathRate: run.math.rate,
          finalDecisionElo: run.finalDecisionElo,
          finalMathElo: run.finalMathElo,
        })),
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = audit.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(
    `Training calibration audit could not run: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 2;
}

