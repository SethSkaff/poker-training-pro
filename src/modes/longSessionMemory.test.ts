import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  heroTournamentLegalActions,
  type TournamentRunner,
} from "./tournamentRunner";

const hero = { id: "hero", name: "Player", rating: 1_000 };

function driveEvent(seed: string): {
  maxDecisions: number;
  replayActions: number;
  resolved: boolean;
} {
  let runner: TournamentRunner = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed,
    }),
    { policy: { simulations: 50 } },
  );
  let maxDecisions = runner.decisions.length;
  // No abort tolerance: an opponent policy must never propose an illegal bet
  // target, so a scored career event must always advance without throwing.
  for (let step = 0; step < 400 && !runner.session.result; step += 1) {
    const legal = heroTournamentLegalActions(runner);
    if (!legal) {
      runner = advanceTournamentRunnerToHero(runner, {
        policy: { simulations: 50 },
      });
      maxDecisions = Math.max(maxDecisions, runner.decisions.length);
      continue;
    }
    // Push chips aggressively so events resolve quickly.
    const action = legal.allIn
      ? "all-in"
      : legal.call
        ? "call"
        : legal.check
          ? "check"
          : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action, decisionElapsedMs: 200 },
      { policy: { simulations: 50 } },
    );
    maxDecisions = Math.max(maxDecisions, runner.decisions.length);
  }
  return {
    maxDecisions,
    replayActions: runner.replayActions.length,
    resolved: runner.session.result !== undefined,
  };
}

describe("long-session memory bounds", () => {
  /*
    One case per event rather than a loop inside a single test.

    The bounds asserted below are per-event maxima, so checking each event
    separately is exactly as strong -- but driving six whole tournaments inside
    one synchronous `it` blocked the worker for 60-75 s, and Vitest cannot
    interrupt synchronous work. Past 60 s the worker's `onTaskUpdate` RPC to the
    reporter times out, and the run exits non-zero while reporting every test
    green: `npm test` failing with "831 passed" is not a failure anyone can act
    on. Split, each case blocks for roughly ten seconds and the worker stays
    responsive between them.
  */
  it.each([0, 1, 2, 3, 4, 5])(
    "keeps the automatic decision log bounded across event %i of a long session",
    (event) => {
      const { maxDecisions, replayActions, resolved } = driveEvent(
        `soak-${event}`,
      );
      // Every scored event must finish; an opponent policy proposing an illegal
      // bet target would throw in `driveEvent` (no tolerance) or leave the
      // event unresolved.
      expect(resolved).toBe(true);
      // decisions is capped via slice(-79) => at most 80 retained.
      expect(maxDecisions).toBeLessThanOrEqual(80);
      // A single six-seat event cannot generate an unbounded replay log; each
      // hero action appends exactly one entry and a busted hero ends the event.
      expect(replayActions).toBeLessThan(400);
    },
    60_000,
  );

  it("does not grow retained runner state without bound within one event", () => {
    let runner: TournamentRunner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "rational",
        seed: "soak-single",
      }),
      { policy: { simulations: 50 } },
    );
    const sizes: number[] = [];
    for (let step = 0; step < 200 && !runner.session.result; step += 1) {
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
        { action, decisionElapsedMs: 100 },
        { policy: { simulations: 50 } },
      );
      // Serialized decision-log size must stay bounded regardless of hand count.
      sizes.push(JSON.stringify(runner.decisions).length);
    }
    const peak = Math.max(...sizes, 0);
    expect(runner.decisions.length).toBeLessThanOrEqual(80);
    // The decision log never balloons: bounded entries => bounded serialized size.
    expect(peak).toBeLessThan(40_000);
  }, 120_000);
});
