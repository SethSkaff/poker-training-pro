import { expect, it } from "vitest";
import { deriveHandReview } from "./handReview";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
} from "./tournamentRunner";
it("keeps the table, recommendation and inspectable calculations on the same decision", async () => {
  let runner = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero: { id: "hero", name: "Player", rating: 1000 },
      mode: "normal",
      seed: "review-provenance",
    }),
    { policy: { simulations: 60 } },
  );
  for (let i = 0; i < 4 && runner.session.status !== "complete"; i++) {
    const legal = heroTournamentLegalActions(runner)!;
    runner = applyHeroTournamentAction(
      runner,
      { action: legal.check ? "check" : legal.call ? "call" : "fold" },
      { nowMs: 1000 + i, policy: { simulations: 60 } },
    );
  }
  const review = await deriveHandReview(
    createTournamentRunnerReplay(runner, 60),
    { simulations: 60, yieldControl: async () => {} },
  );
  expect(review.decisions.length).toBeGreaterThan(0);
  for (const d of review.decisions) {
    expect(d.tableSnapshot.board).toEqual(d.informationSet.board);
    expect(d.tableSnapshot.pot).toBe(d.math.potBefore);
    expect(
      d.tableSnapshot.players
        .filter((p) => p.id !== "hero")
        .every((p) => !p.cards),
    ).toBe(true);
    for (const p of d.tableSnapshot.players) {
      const info = d.informationSet.players.find((i) => i.id === p.id);
      if (info) {
        expect(p.stack).toBe(info.stack);
        expect(p.bet).toBe(info.streetCommitted);
      }
    }
    for (const [id, audit] of Object.entries(d.math.calculations!))
      expect(audit.result).toBe(d.math[id as keyof typeof d.math]);
    const odds = d.math.calculations!.potOdds;
    expect(odds.result).toBe(
      odds.inputs.call / Math.max(1, odds.inputs.pot + odds.inputs.call),
    );
    const equity = d.math.calculations!.showdownEquity;
    expect(equity.result).toBe(equity.inputs.shares / equity.inputs.samples);
    for (const action of d.math.actionValues) {
      const a = action.calculation!;
      expect(a.result).toBe(action.expectedValueBigBlinds);
      expect(
        (a.inputs.base -
          a.inputs.reopening -
          a.inputs.risk -
          a.inputs.exposure) /
          a.inputs.blind,
      ).toBeCloseTo(a.result, 10);
    }
    const regret = d.math.calculations!.evRegretBigBlinds;
    const r = regret.inputs;
    expect(regret.result).toBe(
      Math.max(
        0,
        r.best - r.played - Math.max(r.bestUncertainty, r.playedUncertainty),
      ),
    );
  }
});
