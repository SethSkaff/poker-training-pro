import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TRAINING_SCENARIO_CONTENT_VERSION,
  TRAINING_SCENARIO_SCHEMA_VERSION,
  stableTrainingScenarioJson,
  validateTrainingScenarioBank,
} from "../src/data/trainingScenarioSchema";
import { trainingScenarios } from "../src/data/trainingScenarios";

interface CliOptions {
  input?: string;
  output?: string;
  help: boolean;
}

function usage(): string {
  return [
    "Training scenario bank validator/exporter",
    "",
    "Usage:",
    "  node node_modules/vite-node/vite-node.mjs scripts/validate-training-scenarios.ts [options]",
    "",
    "Options:",
    "  --input <file>   Validate scenarios from a JSON array or exported bank object.",
    "  --output <file>  Write canonical, deterministic JSON instead of stdout.",
    "  --help           Show this help.",
    "",
    "With no --input, the authored TypeScript bank is validated. Invalid content",
    "prints stable error lines to stderr and exits nonzero.",
  ].join("\n");
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--input") {
      const value = args[index + 1];
      if (!value) throw new Error("--input requires a file path.");
      options.input = value;
      index += 1;
    } else if (argument === "--output") {
      const value = args[index + 1];
      if (!value) throw new Error("--output requires a file path.");
      options.output = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function readBank(input: string | undefined): readonly unknown[] {
  if (!input) return trainingScenarios;
  const path = resolve(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${path}: ${detail}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    "scenarios" in parsed &&
    Array.isArray(parsed.scenarios)
  ) {
    return parsed.scenarios;
  }
  throw new Error("Input JSON must be a scenario array or an object with scenarios.");
}

export function createTrainingScenarioExport(scenarios: readonly unknown[]): {
  schemaVersion: string;
  contentVersion: string;
  scenarioCount: number;
  scenarios: readonly unknown[];
} {
  const sorted = [...scenarios].sort((left, right) => {
    const leftId =
      left !== null && typeof left === "object" && "id" in left
        ? String(left.id)
        : "";
    const rightId =
      right !== null && typeof right === "object" && "id" in right
        ? String(right.id)
        : "";
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return {
    schemaVersion: TRAINING_SCENARIO_SCHEMA_VERSION,
    contentVersion: TRAINING_SCENARIO_CONTENT_VERSION,
    scenarioCount: sorted.length,
    scenarios: sorted,
  };
}

export function runTrainingScenarioCli(
  args: readonly string[],
  io: {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  } = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): number {
  let options: CliOptions;
  try {
    options = parseArgs(args);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    io.stderr(`${usage()}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout(`${usage()}\n`);
    return 0;
  }

  let scenarios: readonly unknown[];
  try {
    scenarios = readBank(options.input);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  const errors = validateTrainingScenarioBank(scenarios).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (errors.length > 0) {
    io.stderr(`Training scenario validation failed (${errors.length} error(s)):\n`);
    for (const error of errors) io.stderr(`- ${error}\n`);
    return 1;
  }

  const json = stableTrainingScenarioJson(
    createTrainingScenarioExport(scenarios),
  );
  if (options.output) {
    const output = resolve(options.output);
    try {
      writeFileSync(output, json, "utf8");
    } catch (error) {
      io.stderr(
        `Could not write ${output}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
    io.stdout(
      `Validated and exported ${scenarios.length} scenarios to ${output}.\n`,
    );
  } else {
    io.stdout(json);
  }
  return 0;
}

process.exitCode = runTrainingScenarioCli(process.argv.slice(2));
