import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { trainingScenarios } from "./trainingScenarios";
import {
  stableTrainingScenarioJson,
  trainingScenarioStructuralFingerprint,
  validateTrainingScenario,
  validateTrainingScenarioBank,
} from "./trainingScenarioSchema";

const temporaryDirectories: string[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "ptp-scenario-schema-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("versioned training scenario schema", () => {
  it("validates the authored bank and honest pending-review metadata", () => {
    expect(validateTrainingScenarioBank(trainingScenarios)).toEqual([]);
    for (const scenario of trainingScenarios) {
      expect(scenario.schemaVersion).toBe("1.0.0");
      expect(scenario.contentVersion).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
      expect(scenario.source.verificationStatus).toBe("pending-human-review");
      expect(scenario.review).toMatchObject({
        status: "pending",
        reviewerId: null,
        reviewedAt: null,
      });
    }
  });

  it("rejects illegal cards, street boards, money, seats, actions, and units", () => {
    const invalid = clone(trainingScenarios[3]) as unknown as Record<
      string,
      unknown
    >;
    invalid.heroCards = [
      { rank: "1", suit: "stars" },
      { rank: "A", suit: "hearts" },
    ];
    invalid.board = [{ rank: "A", suit: "hearts" }];
    invalid.blinds = [200, 100];
    invalid.pot = -1;
    invalid.amountToCall = 100_000;
    invalid.recommendedAction = "teleport";
    const players = clone(trainingScenarios[3].players);
    players.push({
      ...clone(players[0]),
      id: "duplicate-seat-player",
      name: "Duplicate seat",
    });
    invalid.players = players;
    invalid.mathQuestion = {
      ...clone(trainingScenarios[3].mathQuestion),
      unit: "bananas",
      tolerance: -1,
    };

    const errors = validateTrainingScenario(invalid).join("\n");
    expect(errors).toContain("unknown card rank");
    expect(errors).toContain("unknown card suit");
    expect(errors).toContain("require 3 board cards");
    expect(errors).toContain("big > small");
    expect(errors).toContain("pot: must be a non-negative whole-chip amount");
    expect(errors).toContain("amountToCall: cannot exceed the hero stack");
    expect(errors).toContain("player seats must be unique");
    expect(errors).toContain("recommendedAction: unknown poker action");
    expect(errors).toContain("mathQuestion.unit: unknown answer unit");
    expect(errors).toContain(
      "mathQuestion.tolerance: must be finite and non-negative",
    );
  });

  it("requires exactly one fully described math question and content metadata", () => {
    const invalid = clone(trainingScenarios[0]) as unknown as Record<
      string,
      unknown
    >;
    invalid.mathQuestion = [
      clone(trainingScenarios[0].mathQuestion),
      clone(trainingScenarios[0].mathQuestion),
    ];
    invalid.schemaVersion = "2.0.0";
    invalid.contentVersion = "latest";
    invalid.review = {
      status: "approved",
      reviewerId: null,
      reviewedAt: null,
      notes: "No real review.",
    };
    const errors = validateTrainingScenario(invalid).join("\n");
    expect(errors).toContain("exactly one math question object is required");
    expect(errors).toContain("expected supported version 1.0.0");
    expect(errors).toContain("must use YYYY.MM.DD.REVISION");
    expect(errors).toContain(
      "approved content requires a reviewer id and review date",
    );
  });

  it("detects duplicate ids and structurally duplicate renamed scenarios", () => {
    const first = clone(trainingScenarios[0]);
    const duplicateId = { ...clone(trainingScenarios[1]), id: first.id };
    const structuralClone = {
      ...clone(first),
      id: "renamed-structural-clone",
      title: "Renamed structural clone",
    };
    const errors = validateTrainingScenarioBank([
      first,
      duplicateId,
      structuralClone,
    ]).join("\n");
    expect(errors).toContain("duplicate scenario id");
    expect(errors).toContain("structurally duplicates scenario");
    expect(trainingScenarioStructuralFingerprint(first)).toBe(
      trainingScenarioStructuralFingerprint(structuralClone),
    );
  });

  it("serializes object keys deterministically", () => {
    expect(stableTrainingScenarioJson({ zebra: 1, alpha: { z: 2, a: 3 } })).toBe(
      '{\n  "alpha": {\n    "a": 3,\n    "z": 2\n  },\n  "zebra": 1\n}\n',
    );
  });
});

describe("developer scenario CLI", () => {
  const nodeExecutable = process.execPath;
  const viteNode = resolve("node_modules/vite-node/vite-node.mjs");
  const cli = resolve("scripts/validate-training-scenarios.ts");

  it("exports identical canonical bytes across repeated valid runs", () => {
    const directory = temporaryDirectory();
    const firstOutput = join(directory, "first.json");
    const secondOutput = join(directory, "second.json");
    const first = spawnSync(
      nodeExecutable,
      [viteNode, cli, "--output", firstOutput],
      { cwd: resolve("."), encoding: "utf8", timeout: 15_000 },
    );
    const second = spawnSync(
      nodeExecutable,
      [viteNode, cli, "--output", secondOutput],
      { cwd: resolve("."), encoding: "utf8", timeout: 15_000 },
    );
    expect(first.error, first.stderr).toBeUndefined();
    expect(second.error, second.stderr).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(firstOutput)).toEqual(readFileSync(secondOutput));
    const parsed = JSON.parse(readFileSync(firstOutput, "utf8")) as {
      scenarioCount: number;
      scenarios: Array<{ id: string }>;
    };
    expect(parsed.scenarioCount).toBe(trainingScenarios.length);
    expect(parsed.scenarios.map((scenario) => scenario.id)).toEqual(
      [...trainingScenarios]
        .map((scenario) => scenario.id)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  }, 30_000);

  it("exits nonzero and does not export an invalid bank", () => {
    const directory = temporaryDirectory();
    const input = join(directory, "invalid.json");
    const output = join(directory, "must-not-exist.json");
    const invalid = clone(trainingScenarios);
    invalid[0].heroCards[1] = invalid[0].heroCards[0];
    writeFileSync(input, JSON.stringify(invalid), "utf8");

    const result = spawnSync(
      nodeExecutable,
      [viteNode, cli, "--input", input, "--output", output],
      { cwd: resolve("."), encoding: "utf8", timeout: 15_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Training scenario validation failed");
    expect(result.stderr).toContain(
      "Hero cards and board must not contain duplicate cards",
    );
    expect(() => readFileSync(output)).toThrow();
  }, 20_000);
});
