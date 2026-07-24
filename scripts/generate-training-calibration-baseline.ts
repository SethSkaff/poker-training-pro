import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildTrainingCalibration } from "../src/lib/trainingCalibration";

const acknowledgement = "--acknowledge-synthetic-baseline";
const outputFlag = "--output";
const outputIndex = process.argv.indexOf(outputFlag);

if (!process.argv.includes(acknowledgement)) {
  process.stderr.write(
    `Refusing to write a calibration baseline without ${acknowledgement}.\n`,
  );
  process.exitCode = 2;
} else if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  process.stderr.write(`Usage: ${outputFlag} <path> ${acknowledgement}\n`);
  process.exitCode = 2;
} else {
  const outputPath = resolve(process.cwd(), process.argv[outputIndex + 1]);
  const projectFixtureDirectory = resolve(
    process.cwd(),
    "src/data/fixtures",
  );
  if (
    outputPath !== projectFixtureDirectory &&
    !outputPath.startsWith(`${projectFixtureDirectory}\\`)
  ) {
    process.stderr.write(
      `Refusing to write outside ${projectFixtureDirectory}.\n`,
    );
    process.exitCode = 2;
  } else {
    const baseline = buildTrainingCalibration();
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    process.stdout.write(
      `Wrote ${baseline.calibrationVersion} synthetic baseline with ` +
        `${baseline.scenarioContracts.length} scenarios to ${outputPath}.\n`,
    );
  }
}

