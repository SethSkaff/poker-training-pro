import { describe, expect, it } from "vitest";
import { evaluateReferenceMenu } from "./referenceValues";
import {
  expectedReferenceValue,
  listReferenceCases,
  loadReferenceCase,
  REFERENCE_CASE_COUNT,
} from "./referenceCases";

describe("reference case bank", () => {
  it("contains the required terminal, side-pot, conditioning, continuation, and unusual-size families", () => {
    expect(REFERENCE_CASE_COUNT).toBeGreaterThanOrEqual(12);
    const ids = new Set(listReferenceCases().map((referenceCase) => referenceCase.id));
    for (const id of [
      "exact-fold-zero",
      "known-river-loss",
      "tie-odd-chip",
      "side-pot-main-award",
      "unequal-stack-call",
      "weighted-hidden-world",
      "conditioned-size-sweep",
      "unsupported-nonterminal",
      "bounded-continuation-tree",
      "unusual-five-x-supported",
      "unusual-ten-x-supported",
    ]) expect(ids.has(id)).toBe(true);
  });

  it("records actual conditioning for every target in the 33/75/150/500/1300 sweep", () => {
    const referenceCase = loadReferenceCase("conditioned-size-sweep");
    const models = referenceCase.node.conditioningModels ?? [];
    expect(models).toHaveLength(5);
    expect(models.map((model) => model.observedSizingSignature)).toEqual([
      "size:33",
      "size:75",
      "size:150",
      "size:500",
      "size:1300",
    ]);
    const batch = evaluateReferenceMenu({
      node: referenceCase.node,
      canonicalActions: referenceCase.actions,
      modelIds: ["size-model"],
      phase: "evaluation",
      seed: "conditioned-sweep",
      drawCount: 1,
      mode: "exact",
    });
    expect(batch.values.map((value) => value.conditioningEvidence?.sizingSignature)).toEqual([
      "size:33",
      "size:75",
      "size:150",
      "size:500",
      "size:1300",
    ]);
    expect(batch.values.every((value) => value.support.status === "supported")).toBe(true);
  });

  it("keeps jam closure exact and identifies equivalent call/all-in-call values", () => {
    const referenceCase = loadReferenceCase("aggressive-jam-no-extra-raise");
    const batch = evaluateReferenceMenu({
      node: referenceCase.node,
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "jam-closure",
      drawCount: 1,
      mode: "exact",
    });
    const call = batch.values.find((value) => value.actionKey === "call:100");
    const allInCall = batch.values.find((value) => value.actionKey === "all-in-call:100");
    expect(call?.mean).toBe(allInCall?.mean);
    expect(call?.exact).toBe(true);
    expect(batch.values.find((value) => value.actionKey === "fold")?.mean).toBe(0);
    expect(expectedReferenceValue(referenceCase.id, "raise:100")).toBe(-100);
  });

  it("rejects overlapping complete worlds before any values are produced", () => {
    const referenceCase = loadReferenceCase("weighted-hidden-world");
    const badNode = {
      ...referenceCase.node,
      worlds: [{
        ...referenceCase.node.worlds?.[0],
        worldId: "bad-overlap",
        opponentCards: { villain: referenceCase.node.heroCards },
      }],
    };
    expect(() => evaluateReferenceMenu({
      node: badNode,
      canonicalActions: referenceCase.actions,
      modelIds: ["reference-primary"],
      phase: "evaluation",
      seed: "bad-overlap",
      drawCount: 1,
      mode: "exact",
    })).toThrow(/overlaps hero/);
  });
});
