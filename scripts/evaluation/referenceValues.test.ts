import { describe, expect, it } from "vitest";
import {
  comparePolicyValues,
  createMonteCarloReferenceProvider,
  evaluateReferenceMenu,
} from "./referenceValues";
import { loadReferenceCase, REFERENCE_CASES } from "./referenceCases";

describe("independent finite reference values", () => {
  it("matches the independently declared known answers for every reference case", () => {
    expect(REFERENCE_CASES.length).toBeGreaterThanOrEqual(12);
    for (const referenceCase of REFERENCE_CASES) {
      const batch = evaluateReferenceMenu({
        node: referenceCase.node,
        canonicalActions: referenceCase.actions,
        modelIds: referenceCase.node.conditioningModels?.length
          ? [...new Set(referenceCase.node.conditioningModels.map((model) => model.modelId))]
          : ["reference-primary"],
        phase: "evaluation",
        seed: `known-answer:${referenceCase.id}`,
        drawCount: 64,
        mode: "exact",
      });
      for (const action of referenceCase.actions) {
        const expected = referenceCase.expected[action.key];
        const expectedModelId = referenceCase.node.conditioningModels?.[0]?.modelId ?? "reference-primary";
        const value = batch.values.find((entry) => entry.actionKey === action.key && entry.modelId === expectedModelId);
        expect(value, `${referenceCase.id}:${action.key}`).toBeDefined();
        expect(value?.mean, `${referenceCase.id}:${action.key}`).toBe(expected.mean);
        expect(value?.exact, `${referenceCase.id}:${action.key}`).toBe(expected.exact);
        expect(value?.support.status, `${referenceCase.id}:${action.key}`).toBe(expected.support);
      }
    }
  });

  it("samples the same finite world and draw ids for every action pair", () => {
    const referenceCase = loadReferenceCase("weighted-hidden-world");
    const foldAction = {
      key: "fold",
      kind: "fold" as const,
      targetChips: 0,
      investedChips: 0,
      raisesCurrentBet: false,
      raiseByChips: 0,
      isActorAllIn: false,
      stackOffClass: "none" as const,
      isFullRaise: false,
      isShortAllInIncrease: false,
    };
    const batch = evaluateReferenceMenu({
      node: referenceCase.node,
      canonicalActions: [...referenceCase.actions, foldAction],
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "paired-worlds",
      drawCount: 32,
      mode: "monte_carlo",
    });
    expect(batch.drawIds).toHaveLength(32);
    const rows = batch.values.map((value) => value.payoffRows.map((row) => row.drawId));
    expect(rows[0]).toEqual(rows[1]);
    expect(batch.values.every((value) => value.sampleCount === 32)).toBe(true);
    expect(batch.values[0].bound?.lower).toBeLessThan(batch.values[0].bound?.upper ?? Infinity);
  });

  it("does not turn an unsupported objective into chip EV", () => {
    const referenceCase = loadReferenceCase("known-river-loss");
    const batch = evaluateReferenceMenu({
      node: { ...referenceCase.node, objective: "payout_ev" },
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "unsupported-objective",
      drawCount: 8,
      mode: "exact",
    });
    expect(batch.values.every((value) => value.mean === null && value.support.status === "unavailable")).toBe(true);
  });

  it("reports independent numerical and reference-support charges", () => {
    const referenceCase = loadReferenceCase("known-river-loss");
    const batch = evaluateReferenceMenu({
      node: referenceCase.node,
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "compare",
      drawCount: 1,
      mode: "exact",
    });
    const byKey = Object.fromEntries(batch.values.map((value) => [value.actionKey, value]));
    const comparison = comparePolicyValues({
      policyValues: { "call:100": -90, fold: 0 },
      referenceValues: byKey,
    });
    expect(comparison.find((entry) => entry.actionKey === "call:100")?.absoluteError).toBe(10);
    expect(comparison.find((entry) => entry.actionKey === "fold")?.supported).toBe(true);
  });

  it("honors cancellation at deterministic draw boundaries", () => {
    const referenceCase = loadReferenceCase("weighted-hidden-world");
    const provider = createMonteCarloReferenceProvider();
    let cancelled = false;
    expect(() => provider.evaluateMenu({
      node: referenceCase.node,
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "cancel",
      drawCount: 12,
      signal: { get aborted() { return cancelled; } },
    })).not.toThrow();
    cancelled = true;
    expect(() => provider.evaluateMenu({
      node: referenceCase.node,
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "cancelled",
      drawCount: 12,
      signal: { aborted: true },
    })).toThrow("cancelled");
  });
});
