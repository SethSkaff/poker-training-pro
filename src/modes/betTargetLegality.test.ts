import { describe, expect, it } from "vitest";
import { getLegalActions, nextToAct } from "../engine";
import {
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentSession,
} from "./tournamentSession";

const hero = { id: "hero", name: "Player", rating: 1_000 };

// Seeds captured by a seed-sweep harness that previously aborted a career
// event because the Rational sizing helper proposed a fractional bet/raise
// target (e.g. `to: 187.5`) at scaled career blind levels where bigBlind is not
// divisible by four. Each of these must now play to completion with every
// opponent action committing a legal, whole-chip amount.
const REGRESSION_SEEDS = {
  normal: [
    "sweep-normal-6",
    "sweep-normal-9",
    "sweep-normal-12",
    "sweep-normal-18",
    "sweep-normal-23",
  ],
  rational: [
    "sweep-rational-3",
    "sweep-rational-4",
    "sweep-rational-5",
    "sweep-rational-7",
    "sweep-rational-9",
  ],
} as const;

function driveEventToCompletion(
  mode: "normal" | "rational",
  seed: string,
): { completed: boolean; policyDecisions: number } {
  let session: TournamentSession = createTournamentSession({
    eventId: "local-qualifier",
    hero,
    mode,
    seed,
  });
  let policyDecisions = 0;

  for (let step = 0; step < 6_000 && session.status !== "complete"; step += 1) {
    if (!session.activeHand) {
      session = beginTournamentSessionHand(session);
      continue;
    }
    if (session.activeHand.betting.complete) {
      session = progressTournamentSessionHand(session);
      continue;
    }
    const actor = nextToAct(session.activeHand.betting);
    if (!actor) break;

    if (actor === session.heroId) {
      const legal = getLegalActions(session.activeHand.betting, session.heroId);
      // Push chips so the event resolves; mirrors the soak driver.
      const command = legal.allIn
        ? ({ type: "all-in" } as const)
        : legal.call
          ? ({ type: "call" } as const)
          : legal.check
            ? ({ type: "check" } as const)
            : ({ type: "fold" } as const);
      session = applyTournamentSessionAction(session, session.heroId, command);
      continue;
    }

    const policy = chooseTournamentSessionPolicyAction(session, actor, {
      simulations: 50,
    });
    // The policy must never propose a fractional/illegal chip target.
    if (policy.command.to !== undefined) {
      expect(Number.isSafeInteger(policy.command.to)).toBe(true);
    }
    // The engine's strict validation stays strict; this must not throw.
    session = applyTournamentSessionAction(session, actor, policy.command);
    policyDecisions += 1;
  }

  return { completed: session.status === "complete", policyDecisions };
}

/*
  One case per seed rather than a loop inside a single test.

  Each seed is an independent regression, so the assertions are unchanged --
  but driving five whole tournaments in one synchronous `it` blocks the worker
  for the duration of all five, and Vitest cannot interrupt synchronous work.
  A worker blocked past 60 s cannot answer the reporter's `onTaskUpdate` RPC,
  and the run then exits non-zero while reporting every test green. Split, a
  failure also names the seed that caused it instead of the batch it was in.
*/
describe("policy bet/raise targets are always legal whole-chip amounts", () => {
  it.each(REGRESSION_SEEDS.normal)(
    "plays previously-aborting Normal-mode career seed %s to completion",
    (seed) => {
      const { completed, policyDecisions } = driveEventToCompletion(
        "normal",
        seed,
      );
      expect(policyDecisions).toBeGreaterThan(0);
      expect(completed).toBe(true);
    },
    60_000,
  );

  it.each(REGRESSION_SEEDS.rational)(
    "plays previously-aborting Rational-mode career seed %s to completion",
    (seed) => {
      const { completed, policyDecisions } = driveEventToCompletion(
        "rational",
        seed,
      );
      expect(policyDecisions).toBeGreaterThan(0);
      expect(completed).toBe(true);
    },
    60_000,
  );
});

function heroPush(legal: ReturnType<typeof getLegalActions>) {
  if (legal.call) return { type: "call" } as const;
  if (legal.check) return { type: "check" } as const;
  return { type: "fold" } as const;
}

/*
  The wiring half of the Stage 15 fix.

  The rule lives in the betting engine, but the engine only knows the rack if
  the session hands it over. This drives one real career hand -- the same event
  the exploitability gate plays -- and checks the structure's denomination has
  reached the round, so a future refactor that drops the option is caught here
  rather than in a 400-hand tournament.
*/
describe("the session hands its chip rack to the betting engine", () => {
  function firstActor(seed: string) {
    const session = beginTournamentSessionHand(
      createTournamentSession({
        eventId: "local-qualifier",
        hero,
        mode: "rational",
        seed,
      }),
    );
    const betting = session.activeHand?.betting;
    if (!betting) throw new Error("Expected an active hand");
    const actor = nextToAct(betting);
    if (!actor) throw new Error("Expected an actor");
    return { session, betting, actor, legal: getLegalActions(betting, actor) };
  }

  it("advertises the career structure's 25-chip rack on the opening hand", () => {
    const { betting, legal } = firstActor("rack-wiring");
    expect(betting.smallestChip).toBe(25);
    expect(legal.chipStep).toBe(25);
  });

  it("refuses an off-rack raise and accepts the neighbouring rack target", () => {
    const { session, actor, legal } = firstActor("rack-wiring");
    const raise = legal.raise;
    if (!raise) throw new Error("Expected a legal raise");
    const offRack = raise.minTo + 13;
    expect(offRack).toBeLessThan(raise.maxTo);
    expect(offRack % 25).not.toBe(0);
    expect(() =>
      applyTournamentSessionAction(session, actor, {
        type: "raise",
        to: offRack,
      }),
    ).toThrow(/not payable in 25-chip units/);

    const onRack = raise.minTo + 25;
    const played = applyTournamentSessionAction(session, actor, {
      type: "raise",
      to: onRack,
    });
    expect(
      played.activeHand?.betting.players.find((entry) => entry.id === actor)
        ?.totalCommitted,
    ).toBe(onRack);
  });

  it("keeps every commitment of a played-out career event on the rack", () => {
    let session: TournamentSession = createTournamentSession({
      eventId: "local-qualifier",
      hero,
      mode: "rational",
      seed: "rack-sweep",
    });
    let commitments = 0;

    for (let step = 0; step < 6_000 && session.status !== "complete"; step += 1) {
      if (!session.activeHand) {
        session = beginTournamentSessionHand(session);
        continue;
      }
      if (session.activeHand.betting.complete) {
        session = progressTournamentSessionHand(session);
        continue;
      }
      const actor = nextToAct(session.activeHand.betting);
      if (!actor) break;
      const command =
        actor === session.heroId
          ? heroPush(getLegalActions(session.activeHand.betting, actor))
          : chooseTournamentSessionPolicyAction(session, actor, {
              simulations: 50,
            }).command;
      session = applyTournamentSessionAction(session, actor, command);
      for (const entry of session.activeHand?.betting.players ?? []) {
        expect(entry.totalCommitted % 25).toBe(0);
        expect(entry.stack % 25).toBe(0);
        commitments += 1;
      }
    }

    expect(commitments).toBeGreaterThan(0);
    for (const entry of session.tournament.players) {
      expect(entry.stack % 25).toBe(0);
    }
  }, 60_000);
});
