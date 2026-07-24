import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  advanceTournamentRunnerToHeroAsync,
  applyHeroTournamentAction,
  applyHeroTournamentActionAsync,
  createCareerTournamentRunner,
  heroTournamentLegalActions,
  TournamentAdvanceAborted,
  type TournamentRunner,
} from "./tournamentRunner";
import { createRationalEquityService } from "./rationalEquityService";

const hero = { id: "hero", name: "Player", rating: 1_000 };

function heroAction(runner: TournamentRunner): "all-in" | "call" | "check" | "fold" {
  const legal = heroTournamentLegalActions(runner);
  if (!legal) throw new Error("Expected a hero decision");
  return legal.check ? "check" : legal.call ? "call" : legal.fold ? "fold" : "all-in";
}

describe("async tournament runner determinism", () => {
  it.each(["normal", "rational"] as const)(
    "async advance matches sync advance for %s mode",
    async (mode) => {
      const options = { policy: { simulations: 60 } } as const;
      const seed = `async-parity-${mode}`;
      const start = createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode,
        seed,
      });
      const service = createRationalEquityService();

      const sync = advanceTournamentRunnerToHero(start, options);
      const async = await advanceTournamentRunnerToHeroAsync(
        start,
        service.estimate,
        options,
      );

      expect(async.session).toEqual(sync.session);
      expect(async.decisions).toEqual(sync.decisions);
      expect(async.sequence).toBe(sync.sequence);
    },
  );

  it("async hero action matches sync hero action bit-for-bit", async () => {
    const options = { policy: { simulations: 60 }, nowMs: 5_000 } as const;
    const start = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "rational",
        seed: "async-hero-parity",
      }),
      options,
    );
    const action = heroAction(start);
    const service = createRationalEquityService();

    const sync = applyHeroTournamentAction(
      start,
      { action, decisionElapsedMs: 1_200 },
      options,
    );
    const async = await applyHeroTournamentActionAsync(
      start,
      { action, decisionElapsedMs: 1_200 },
      service.estimate,
      options,
    );

    expect(async.session).toEqual(sync.session);
    expect(async.decisions).toEqual(sync.decisions);
    expect(async.replayActions).toEqual(sync.replayActions);
  });

  it("aborts the async advance when the signal is set", async () => {
    const start = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "rational",
      seed: "async-abort",
    });
    const service = createRationalEquityService();
    await expect(
      advanceTournamentRunnerToHeroAsync(start, service.estimate, {
        policy: { simulations: 60 },
        signal: { aborted: true },
      }),
    ).rejects.toBeInstanceOf(TournamentAdvanceAborted);
  });
});
