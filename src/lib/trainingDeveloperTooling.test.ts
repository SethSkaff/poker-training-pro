import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import {
  DEVELOPER_ANSWER_KEY_MARKER,
  createTrainingDraft,
  renderTrainingScenarioPreview,
  runTrainingBulkSimulation,
  validateTrainingDraft,
} from "../../scripts/training-tools/core";

describe("developer-only Training scenario tooling", () => {
  it("selects the same draft source for the same explicit seed", () => {
    const first = createTrainingDraft("repeatable-authoring-seed");
    const second = createTrainingDraft("repeatable-authoring-seed");

    expect(first).toEqual(second);
    expect(first.canonicalReplacementAllowed).toBe(false);
    expect(first.seed).toBe("repeatable-authoring-seed");
  });

  it("fails validation without mutating an invalid draft", () => {
    const draft = createTrainingDraft(
      "invalid-draft",
      "preflop-pot-odds-ak",
    );
    const invalid = structuredClone(draft);
    invalid.scenario.board = [invalid.scenario.heroCards[0]];
    const before = structuredClone(invalid);

    const result = validateTrainingDraft(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith("board:"))).toBe(true);
    expect(invalid).toEqual(before);
  });

  it("renders table state, prompt, and an unmistakable developer answer key", () => {
    const scenario = trainingScenarios.find(
      ({ id }) => id === "river-bluff-catch-price",
    )!;
    const preview = renderTrainingScenarioPreview(scenario);

    expect(preview).toContain("TRAINING SCENARIO PREVIEW");
    expect(preview).toContain("Blinds 200/400");
    expect(preview).toContain(scenario.prompt);
    expect(preview).toContain(DEVELOPER_ANSWER_KEY_MARKER);
    expect(preview).toContain("Recommended action: call");
    expect(preview).toContain("Math answer: 25 % ± 1.5");
  });

  it("replays identical seeded bulk simulations and preserves aggregate invariants", () => {
    const first = runTrainingBulkSimulation({
      seed: "bulk-regression-seed",
      trials: 500,
    });
    const second = runTrainingBulkSimulation({
      seed: "bulk-regression-seed",
      trials: 500,
    });

    expect(first).toEqual(second);
    expect(first.attempts).toHaveLength(500);
    expect(
      first.scenarioCounts.reduce((total, item) => total + item.count, 0),
    ).toBe(500);
    expect(first.actionScoreRate).toBeGreaterThanOrEqual(0);
    expect(first.actionScoreRate).toBeLessThanOrEqual(1);
    expect(first.mathScoreRate).toBeGreaterThanOrEqual(0);
    expect(first.mathScoreRate).toBeLessThanOrEqual(1);
    expect(Number.isFinite(first.finalDecisionElo)).toBe(true);
    expect(Number.isFinite(first.finalMathElo)).toBe(true);
    for (const attempt of first.attempts) {
      expect([0, 0.5, 1]).toContain(attempt.actionScore);
      expect([0, 0.5, 1]).toContain(attempt.mathScore);
      expect(
        trainingScenarios.some(({ id }) => id === attempt.scenarioId),
      ).toBe(true);
    }
  });

  it("rejects missing seeds, invalid trial counts, and invalid scenario banks", () => {
    expect(() => createTrainingDraft("")).toThrow(/seed/i);
    expect(() =>
      runTrainingBulkSimulation({ seed: "bounded", trials: 0 }),
    ).toThrow(/trials/i);
    const invalid = structuredClone(trainingScenarios[0]);
    invalid.heroCards[1] = invalid.heroCards[0];
    expect(() =>
      runTrainingBulkSimulation({
        seed: "invalid-bank",
        trials: 1,
        scenarios: [invalid],
      }),
    ).toThrow(/invalid bank/i);
  });

  it("keeps the authoring marker and tool paths outside current dist and ASAR", async () => {
    const module = await import("../../scripts/audit-training-tool-exclusion.mjs");
    const root = resolve(process.cwd());
    const report = module.auditTrainingToolExclusion({ projectRoot: root });

    expect(report.ok, JSON.stringify(report.findings)).toBe(true);
    if (existsSync(resolve(root, "dist"))) {
      const distText = readFileSync(
        resolve(root, "dist", "index.html"),
        "utf8",
      );
      expect(distText).not.toContain(DEVELOPER_ANSWER_KEY_MARKER);
    }
    // The package check is conditional in unit runs; packaged release
    // verification uses --require-asar and therefore fails closed.
    if (report.asarInspected) expect(report.asarEntries).toBeGreaterThan(0);
  });
});
