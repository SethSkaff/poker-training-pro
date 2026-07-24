import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { trainingScenarios } from "../src/data/trainingScenarios";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  projectRoot,
  "ios/PokerTrainingPro/Resources/training-scenarios.json",
);
const checkOnly = process.argv.includes("--check");

const payload = {
  schemaVersion: 1,
  scenarios: trainingScenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    prompt: scenario.prompt,
    heroCards: scenario.heroCards,
    board: scenario.board,
    availableActions: Object.keys(scenario.training.actionEvs),
    recommendedAction: scenario.recommendedAction,
    actionReason: scenario.actionReason,
    actionEvs: scenario.training.actionEvs,
    actionEpsilon: scenario.training.actionEpsilon,
    partialCreditRegret: scenario.training.partialCreditRegret,
    acceptableActions: scenario.acceptableActions ?? [],
    decisionDifficulty: scenario.training.decisionDifficulty,
    mathDifficulty: scenario.training.mathDifficulty,
    targetDecisionMs: scenario.training.targetDecisionMs,
    targetMathMs: scenario.training.targetMathMs,
    mathPrompt: scenario.mathQuestion.prompt,
    mathUnit: scenario.mathQuestion.unit,
    correctValue: scenario.mathQuestion.correctValue,
    tolerance: scenario.mathQuestion.tolerance,
    mathExplanation: scenario.mathQuestion.explanation,
  })),
};

const expected = `${JSON.stringify(payload, null, 2)}\n`;

if (checkOnly) {
  const current = await readFile(outputPath, "utf8");
  if (current !== expected) {
    throw new Error(
      "iOS Training scenario resource is stale. Run scripts/export-ios-training-bank.ts before release.",
    );
  }
  process.stdout.write(
    `iOS Training bank is current (${payload.scenarios.length} scenarios).\n`,
  );
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
  process.stdout.write(
    `Exported ${payload.scenarios.length} Training scenarios to ${outputPath}.\n`,
  );
}
