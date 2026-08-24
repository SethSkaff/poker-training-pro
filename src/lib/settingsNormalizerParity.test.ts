import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_ACTION_IDS } from "./actionMap";
import {
  PERSISTED_ACTION_IDS,
  defaultProgress,
  defaultSettings,
  normalizePersistedProgress,
  normalizePersistedSettings,
} from "./persistedDataNormalization";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const require = createRequire(import.meta.url);
const electronContract = require(
  "../../electron/persisted-data-normalization.cjs",
) as {
  defaultProgress: unknown;
  defaultSettings: unknown;
  normalizePersistedProgress(value: unknown): unknown;
  normalizePersistedSettings(value: unknown): unknown;
};

describe("generated Electron persistence contract", () => {
  it("is generated from the checked-in TypeScript authority", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["scripts/generate-persistence-contract.mjs", "--check"],
        { cwd: projectRoot, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("keeps action ids and defaults behaviorally identical", () => {
    expect(PERSISTED_ACTION_IDS).toEqual(ALL_ACTION_IDS);
    expect(electronContract.defaultSettings).toEqual(defaultSettings);
    expect(electronContract.defaultProgress).toEqual(defaultProgress);
  });

  it("normalizes valid, legacy, and hostile values identically", () => {
    const cases: unknown[] = [
      undefined,
      {},
      {
        ...defaultSettings,
        musicVolume: 900,
        spatialScene: true,
        injected: "drop-me",
        controlBindings: {
          version: 1,
          keyboard: {
            "game.fold": ["G", "g", "\u0000bad"],
            "not.an.action": ["x"],
          },
        },
      },
    ];
    for (const value of cases) {
      expect(electronContract.normalizePersistedSettings(value)).toEqual(
        normalizePersistedSettings(value),
      );
    }

    const progressCases: unknown[] = [
      undefined,
      {},
      {
        ...defaultProgress,
        currentStreak: -10,
        playerName: "x".repeat(100),
        injected: { privileged: true },
        results: [
          { scenarioId: "broken", action: "teleport" },
          {
            scenarioId: "valid",
            completedAt: "2026-08-23T00:00:00.000Z",
            action: "fold",
            actionCorrect: true,
            mathCorrect: false,
            elapsedMs: 10,
            eloDelta: -1,
          },
        ],
      },
    ];
    for (const value of progressCases) {
      expect(electronContract.normalizePersistedProgress(value)).toEqual(
        normalizePersistedProgress(value),
      );
    }
  });
});
