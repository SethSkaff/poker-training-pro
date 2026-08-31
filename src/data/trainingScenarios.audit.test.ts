import { describe, expect, it } from "vitest";
import { trainingScenarios } from "./trainingScenarios";
import { validateTrainingScenarioBank } from "../lib/trainingEngine";

const outcomeBiasedLanguage = [
  /\bthe (?:turn|river|runout) (?:was|came|proved)\b/i,
  /\b(?:ended|turned) out\b/i,
  /\byou would have (?:won|lost)\b/i,
  /\bactual (?:cards|hand|holding|result|runout)\b/i,
  /\bresulting (?:board|winner|hand)\b/i,
];

const uncertaintyOrModelingLanguage =
  /\b(?:about|assum(?:e|es|ed|ing|ption)|close|discount(?:ed|ing)?|equity|EV|frequency|may|modeled|range|roughly|slightly|threshold)\b/i;

const contextualTags = {
  "pot-odds": ["pot-odds"],
  equity: ["equity", "draw", "rule-of"],
  outs: ["outs", "draw"],
  "implied-odds": ["implied-odds"],
  "expected-value": ["expected-value", "fold-equity", "semi-bluff"],
  "stack-to-pot-ratio": ["stack-to-pot-ratio", "effective-stack"],
  "minimum-defense-frequency": ["minimum-defense-frequency", "range"],
  "tournament-pressure": ["tournament", "icm", "risk-premium"],
} as const;

describe("training scenario release-quality audit", () => {
  it("passes the structural and EV-regret validator as a complete bank", () => {
    expect(validateTrainingScenarioBank(trainingScenarios)).toEqual([]);
    expect(trainingScenarios.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps the single math question contextual, bounded, and tagged", () => {
    for (const scenario of trainingScenarios) {
      const question = scenario.mathQuestion;

      expect(Array.isArray(question), scenario.id).toBe(false);
      expect(question.prompt.trim().length, scenario.id).toBeGreaterThan(20);
      expect(question.explanation.trim().length, scenario.id).toBeGreaterThan(
        15,
      );
      expect(Number.isFinite(question.correctValue), scenario.id).toBe(true);
      expect(Number.isFinite(question.tolerance), scenario.id).toBe(true);
      expect(question.tolerance, scenario.id).toBeGreaterThanOrEqual(0);
      expect(scenario.tags, scenario.id).toContain(scenario.street);
      expect(
        contextualTags[question.topic].some((context) =>
          scenario.tags.some((tag) => tag.includes(context)),
        ),
        `${scenario.id} has no tag linking its math topic to the scenario`,
      ).toBe(true);

      if (question.unit === "%") {
        expect(question.correctValue, scenario.id).toBeGreaterThanOrEqual(0);
        expect(question.correctValue, scenario.id).toBeLessThanOrEqual(100);
        expect(question.tolerance, scenario.id).toBeLessThanOrEqual(5);
      } else if (question.unit === "outs") {
        expect(Number.isInteger(question.correctValue), scenario.id).toBe(true);
        expect(question.correctValue, scenario.id).toBeGreaterThanOrEqual(0);
        expect(question.correctValue, scenario.id).toBeLessThanOrEqual(47);
      } else {
        expect(question.correctValue, scenario.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not reveal the flush-out count before the player estimates", () => {
    const flushDrawScenarios = trainingScenarios.filter((scenario) =>
      scenario.tags.includes("flush-draw"),
    );

    expect(flushDrawScenarios.length).toBeGreaterThan(0);
    for (const scenario of flushDrawScenarios) {
      const decisionCopy = scenario.prompt;
      const questionCopy = scenario.mathQuestion.prompt;

      expect(decisionCopy, scenario.id).not.toMatch(/\b\d+\s+(?:clean\s+)?outs?\b/i);
      expect(questionCopy, scenario.id).not.toMatch(/\b\d+\s+(?:clean\s+)?outs?\b/i);
      expect(questionCopy, scenario.id).not.toMatch(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:clean\s+)?outs?\b/i);
    }
  });

  it("uses contextual language for the shove math question and evaluates a call", () => {
    const scenario = trainingScenarios.find(
      (item) => item.id === "preflop-button-shove-fold-equity",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.mathQuestion.prompt).toBe(
      "Ignoring showdown equity for this sub-calculation, what fold percentage would you need when going all-in to win the current pot?",
    );
    expect(scenario?.mathQuestion.prompt).not.toMatch(/\d/);
    expect(scenario?.training.actionEvs.call).toBeTypeOf("number");
  });

  it("teaches from the decision-time information rather than the runout", () => {
    for (const scenario of trainingScenarios) {
      const teachingCopy = [
        scenario.prompt,
        scenario.actionReason,
        scenario.mathQuestion.prompt,
        scenario.mathQuestion.explanation,
      ].join(" ");

      for (const pattern of outcomeBiasedLanguage) {
        expect(teachingCopy, `${scenario.id} matched ${pattern}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("qualifies strategic recommendations as estimates or model-dependent", () => {
    for (const scenario of trainingScenarios) {
      expect(
        scenario.actionReason,
        `${scenario.id} presents a categorical recommendation`,
      ).toMatch(uncertaintyOrModelingLanguage);
    }
  });

  it("keeps the evaluator assumptions versioned for reproducible grading", () => {
    for (const scenario of trainingScenarios) {
      expect(scenario.training.evaluatorVersion, scenario.id).toMatch(
        /^trainer-\d+\.\d+$/,
      );
      expect(
        scenario.training.actionEvs[scenario.recommendedAction],
        scenario.id,
      ).toBeTypeOf("number");
    }
  });
});
