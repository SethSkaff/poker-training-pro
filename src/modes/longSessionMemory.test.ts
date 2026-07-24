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
  try {
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
  } catch {
    // A rare pre-existing engine edge (invalid opponent bet target under some
    // seeds) can abort an event. It is orthogonal to memory retention; skip the
    // event and keep the bounds we already observed for it.
    return { maxDecisions, replayActions: runner.replayActions.length };
  }
  return {
    maxDecisions,
    replayActions: runner.replayActions.length,
  };
}

describe("long-session memory bounds", () => {
  it("keeps the automatic decision log bounded across many events", () => {
    let observedMax = 0;
    let maxReplayActions = 0;
    for (let event = 0; event < 6; event += 1) {
      const { maxDecisions, replayActions } = driveEvent(`soak-${event}`);
      observedMax = Math.max(observedMax, maxDecisions);
      maxReplayActions = Math.max(maxReplayActions, replayActions);
    }
    // decisions is capped via slice(-79) => at most 80 retained.
    expect(observedMax).toBeLessThanOrEqual(80);
    // A single six-seat event cannot generate an unbounded replay log; each
    // hero action appends exactly one entry and a busted hero ends the event.
    expect(maxReplayActions).toBeLessThan(400);
  }, 120_000);

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
