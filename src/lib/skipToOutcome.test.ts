import { expect, it } from "vitest";
import { skipToOutcome } from "./skipToOutcome";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentActionOneStep,
  createCareerTournamentRunner,
} from "../modes/tournamentRunner";
it("retains real board and public reveals at the skipped result without starting the next hand", () => {
  const ready = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero: { id: "hero", name: "Player", rating: 1000 },
      mode: "normal",
      seed: "skip-real-result",
    }),
    { policy: { simulations: 60 } },
  );
  const step = applyHeroTournamentActionOneStep(
    ready,
    { action: "fold" },
    { nowMs: 1000, policy: { simulations: 60 } },
  );
  const skipped = skipToOutcome(ready, step, 1000);
  const event = skipped.step.events[0];
  expect(["showdown", "hand-result"]).toContain(event.kind);
  expect(skipped.source.session.activeHand?.board).toEqual(
    skipped.step.runner.session.lastHand?.board,
  );
  expect(skipped.step.runner.session.activeHand).toBeUndefined();
  expect(
    skipped.step.events
      .filter((e) => e.kind === "pot-awarded")
      .map((e) => [e.playerId, e.amount, e.potId]),
  ).toEqual(
    skipped.step.runner.session.lastHand!.awards.map((a) => [
      a.playerId,
      a.amount,
      a.potId,
    ]),
  );
  if (event.kind === "showdown")
    expect(event.reveals.map((r) => r.playerId)).not.toContain("hero");
  expect(
    advanceTournamentRunnerToHero(skipped.step.runner, {
      nowMs: 1000,
      policy: { simulations: 60 },
    }),
  ).toEqual(
    advanceTournamentRunnerToHero(step.runner, {
      nowMs: 1000,
      policy: { simulations: 60 },
    }),
  );
});
