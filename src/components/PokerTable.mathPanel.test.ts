import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { pokerMathQuestionSegments } from "./PokerTable";

describe("compact training math card", () => {
  it("preserves every question while linking at least one useful term", () => {
    for (const scenario of trainingScenarios) {
      const segments = pokerMathQuestionSegments(scenario.mathQuestion.prompt);
      expect(segments.map((segment) => segment.text).join("")).toBe(
        scenario.mathQuestion.prompt,
      );
      expect(
        segments.some((segment) => segment.glossary !== undefined),
        scenario.id,
      ).toBe(true);
    }
  });

  it("keeps vocabulary definitions brief", () => {
    const definitions = trainingScenarios.flatMap((scenario) =>
      pokerMathQuestionSegments(scenario.mathQuestion.prompt)
        .map((segment) => segment.glossary?.definition)
        .filter((definition): definition is string => Boolean(definition)),
    );

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.split(/\s+/).length).toBeLessThanOrEqual(16);
    }
  });

  it("keeps the 3D card above the action lane and below the dock stacking layer", () => {
    const css = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../styles.css"),
      "utf8",
    );

    expect(css).toContain("> .training-panel--math");
    expect(css).toContain("max-height: min(320px, calc(100% - 180px));");
    expect(css).toContain("z-index: 35;");
    expect(css).toContain(".action-dock {");
    expect(css).toContain("z-index: 40;");
  });
});
