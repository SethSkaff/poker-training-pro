import { describe, expect, it } from "vitest";
import { createProductionPolicyAdapter } from "./policyAdapter";
import { createSessionOpponents, createTournamentSession, beginTournamentSessionHand } from "../../src/modes/tournamentSession";

describe("A05 policy adapter", () => {
  it("uses the existing production session decision without relabeling modes", () => {
    const session = beginTournamentSessionHand(createTournamentSession({ eventId: "local-qualifier", hero: { id: "hero", name: "Hero", rating: 1_000 }, mode: "rational", seed: "a05-policy", opponents: createSessionOpponents("a05-policy", "local-qualifier", "rational") }));
    const adapter = createProductionPolicyAdapter("rational", { simulations: 60 });
    const actor = session.activeHand?.betting.pending[0];
    if (!actor) throw new Error("fixture has no actor");
    expect(adapter.choose(session, actor).type).toBeDefined();
    expect(() => createProductionPolicyAdapter("normal").decide?.(session, actor)).toThrow(/cannot relabel/);
  });
});
