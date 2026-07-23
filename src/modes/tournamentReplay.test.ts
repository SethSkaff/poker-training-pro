import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
} from "./tournamentRunner";

describe("tournament checkpoint replay", () => {
  it("restores the exact public decision state without serializing hidden cards", () => {
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero: {
          id: "hero",
          name: "Checkpoint Player",
          rating: 1_042,
        },
        mode: "normal",
        seed: "checkpoint-replay-seed",
      }),
      { nowMs: 10_000, policy: { simulations: 60 } },
    );

    for (let index = 0; index < 4; index += 1) {
      if (runner.session.status === "complete") break;
      const legal = heroTournamentLegalActions(runner);
      if (!legal) throw new Error("Runner did not stop for the hero");
      const action = legal.check
        ? "check"
        : legal.call
          ? "call"
          : legal.fold
            ? "fold"
            : "all-in";
      runner = applyHeroTournamentAction(
        runner,
        { action, decisionElapsedMs: 1_250 + index * 100 },
        {
          nowMs: 12_000 + index * 2_000,
          policy: { simulations: 60 },
        },
      );
    }

    const replay = createTournamentRunnerReplay(runner, 60);
    const serialized = JSON.stringify(replay);
    expect(serialized).not.toContain('"holeCards"');
    expect(serialized).not.toContain('"deck"');
    expect(serialized).not.toContain('"hiddenCards"');

    const restored = restoreTournamentRunnerReplay(
      JSON.parse(serialized) as typeof replay,
    );
    expect(restored.session).toEqual(runner.session);
    expect(restored.sequence).toBe(runner.sequence);
    expect(restored.decisions).toEqual(runner.decisions);
    expect(restored.replayActions).toEqual(runner.replayActions);
  });
});
