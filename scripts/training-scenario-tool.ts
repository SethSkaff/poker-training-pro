import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { trainingScenarioById } from "../src/data/trainingScenarios";
import { stableTrainingScenarioJson } from "../src/data/trainingScenarioSchema";
import {
  createTrainingDraft,
  renderTrainingScenarioPreview,
  runTrainingBulkSimulation,
  validateTrainingDraft,
  type TrainingDraftDocument,
} from "./training-tools/core";

const workRoot = resolve(process.cwd(), "work");

function usage(): string {
  return [
    "Developer-only Training scenario tool",
    "",
    "Commands:",
    "  preview --id <scenario-id>",
    "  draft --seed <seed> [--id <scenario-id>] [--output <work-path>]",
    "  validate --input <draft.json>",
    "  export --input <draft.json> [--output <work-path>]",
    "  simulate --seed <seed> --trials <count> [--output <work-path>]",
    "",
    "All writes are restricted to work/. This tool cannot replace canonical scenarios.",
  ].join("\n");
}

function parseOptions(args: readonly string[]): {
  command?: string;
  values: Map<string, string>;
} {
  const [command, ...rest] = args;
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --option value, received ${key ?? "(missing)"}.`);
    }
    values.set(key, value);
  }
  return { command, values };
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function safeName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "seed";
}

function assertWorkOutput(path: string): string {
  const output = resolve(path);
  if (output !== workRoot && !output.startsWith(`${workRoot}\\`)) {
    throw new Error(`Writes are restricted to ${workRoot}.`);
  }
  return output;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function writeJson(path: string, value: unknown): void {
  const output = assertWorkOutput(path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, stableTrainingScenarioJson(value), "utf8");
  process.stdout.write(`Wrote ${output}.\n`);
}

export function runTrainingScenarioTool(args: readonly string[]): number {
  try {
    if (args.length === 0 || args.includes("--help")) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const { command, values } = parseOptions(args);
    if (command === "preview") {
      const id = required(values, "--id");
      const scenario = trainingScenarioById.get(id);
      if (!scenario) throw new Error(`Unknown canonical scenario: ${id}`);
      process.stdout.write(`${renderTrainingScenarioPreview(scenario)}\n`);
      return 0;
    }
    if (command === "draft") {
      const seed = required(values, "--seed");
      const draft = createTrainingDraft(seed, values.get("--id"));
      const output =
        values.get("--output") ??
        `work/training-drafts/${safeName(seed)}.draft.json`;
      writeJson(output, draft);
      return 0;
    }
    if (command === "validate") {
      const result = validateTrainingDraft(readJson(required(values, "--input")));
      if (!result.valid) {
        process.stderr.write(
          `Draft validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`,
        );
        return 1;
      }
      process.stdout.write(
        "Draft is structurally valid. Canonical replacement remains unsupported.\n",
      );
      return 0;
    }
    if (command === "export") {
      const inputPath = required(values, "--input");
      const parsed = readJson(inputPath);
      const result = validateTrainingDraft(parsed);
      if (!result.valid) {
        process.stderr.write(
          `Draft validation failed; no export written:\n${result.errors
            .map((error) => `- ${error}`)
            .join("\n")}\n`,
        );
        return 1;
      }
      const draft = parsed as TrainingDraftDocument;
      const stem = basename(inputPath, extname(inputPath));
      const output =
        values.get("--output") ??
        `work/training-exports/${stem}.validated.json`;
      writeJson(output, {
        exportKind: "validated-developer-candidate",
        canonicalReplacementAllowed: false,
        toolVersion: draft.toolVersion,
        seed: draft.seed,
        scenarios: [draft.scenario],
      });
      return 0;
    }
    if (command === "simulate") {
      const seed = required(values, "--seed");
      const trials = Number(required(values, "--trials"));
      const report = runTrainingBulkSimulation({ seed, trials });
      const output =
        values.get("--output") ??
        `work/training-simulations/${safeName(seed)}-${trials}.json`;
      writeJson(output, report);
      return 0;
    }
    throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
    );
    return 2;
  }
}

process.exitCode = runTrainingScenarioTool(process.argv.slice(2));

