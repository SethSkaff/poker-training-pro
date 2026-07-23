import { describe, expect, it } from "vitest";
import { createPokerTableSnapshot } from "./tournamentSession";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  heroTournamentLegalActions,
} from "./tournamentRunner";

const hero = {
  id: "hero",
  name: "Player",
  rating: 1_000,
};

describe("tournament runner", () => {
  it("automates opponents and pauses only for a legal hero decision", () => {
    const runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-start",
      }),
      { policy: { simulations: 50 } },
    );
    const legal = heroTournamentLegalActions(runner);
    expect(legal?.playerId).toBe(hero.id);
    expect(runner.session.activeHand).toBeDefined();
    expect(runner.decisions.every((entry) => entry.playerId !== hero.id)).toBe(
      true,
    );
  });

  it("accepts a legal hero action and advances to the next hero decision", () => {
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "rational",
        seed: "runner-action",
      }),
      { policy: { simulations: 50 } },
    );
    const legal = heroTournamentLegalActions(runner);
    if (!legal) throw new Error("Expected hero action");
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action, decisionElapsedMs: 2_000 },
      { policy: { simulations: 50 } },
    );
    expect(runner.sequence).toBeGreaterThan(0);
    expect(
      runner.session.status === "complete" ||
        heroTournamentLegalActions(runner)?.playerId === hero.id,
    ).toBe(true);
  });

  it("keeps opponent cards out of the runner's table snapshot", () => {
    const runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-snapshot",
      }),
      { policy: { simulations: 50 } },
    );
    const snapshot = createPokerTableSnapshot(runner.session);
    expect(
      snapshot.players
        .filter((player) => player.id !== hero.id)
        .every((player) => player.cards === undefined),
    ).toBe(true);
  });

  it("uses the timed blind guarantee at the configured deadline", () => {
    const startedAtMs = 10_000;
    const runner = advanceTournamentRunnerToHero(
      createTimedTournamentRunner({
        minutes: 5,
        hero,
        seed: "runner-timed",
        nowMs: startedAtMs,
      }),
      {
        nowMs: startedAtMs + 5 * 60_000,
        policy: { simulations: 50 },
      },
    );
    const stacks = runner.session.tournament.players
      .filter((player) => player.status === "active")
      .map((player) => player.stack)
      .sort((left, right) => right - left);
    expect(runner.timed?.lastBlindDecision?.phase).toBe("deadline");
    expect(runner.timed?.lastBlindDecision?.bigBlind).toBeGreaterThanOrEqual(
      stacks[1],
    );
  });

  it.each(["normal", "rational"] as const)(
    "can complete a scored %s career event through hero decisions",
    (mode) => {
      let runner = advanceTournamentRunnerToHero(
        createCareerTournamentRunner({
          eventId: "local-qualifier",
          hero,
          mode,
          seed: `runner-complete-${mode}`,
        }),
        { policy: { simulations: 50 } },
      );
      for (let step = 0; step < 500 && !runner.session.result; step += 1) {
        const legal = heroTournamentLegalActions(runner);
        if (!legal) {
          runner = advanceTournamentRunnerToHero(runner, {
            policy: { simulations: 50 },
          });
          continue;
        }
        const action = legal.allIn
          ? "all-in"
          : legal.call
            ? "call"
            : legal.check
              ? "check"
              : "fold";
        runner = applyHeroTournamentAction(
          runner,
          { action, decisionElapsedMs: 500 },
          { policy: { simulations: 50 } },
        );
      }
      expect(runner.session.result).toMatchObject({
        eventId: "local-qualifier",
        fieldSize: 6,
      });
      expect(runner.session.result?.tournamentEloDelta).toEqual(
        expect.any(Number),
      );
    },
  );

  it("completes a Timed Table with placement Elo and no career unlocks", () => {
    let runner = advanceTournamentRunnerToHero(
      createTimedTournamentRunner({
        minutes: 5,
        hero,
        seed: "runner-timed-complete",
        nowMs: 10_000,
      }),
      {
        nowMs: 10_000 + 5 * 60_000,
        policy: { simulations: 50 },
      },
    );
    for (let step = 0; step < 100 && !runner.session.result; step += 1) {
      const legal = heroTournamentLegalActions(runner);
      if (!legal) {
        runner = advanceTournamentRunnerToHero(runner, {
          nowMs: 10_000 + 5 * 60_000,
          policy: { simulations: 50 },
        });
        continue;
      }
      const action = legal.allIn
        ? "all-in"
        : legal.call
          ? "call"
          : legal.check
            ? "check"
            : "fold";
      runner = applyHeroTournamentAction(
        runner,
        { action, decisionElapsedMs: 500 },
        {
          nowMs: 10_000 + 5 * 60_000,
          policy: { simulations: 50 },
        },
      );
    }
    expect(runner.session.result).toBeDefined();
    expect(runner.session.result?.eventName).toBe("5-Minute Timed Table");
    expect(runner.session.result?.unlockedEventIds).toEqual([]);
    expect(runner.session.result?.nextEventId).toBeUndefined();
    expect(runner.session.result?.tournamentEloDelta).toEqual(
      expect.any(Number),
    );
  });
});
