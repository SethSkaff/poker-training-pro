import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
  TournamentReplayVersionError,
  type TournamentRunnerReplay,
} from "./tournamentRunner";
import { createInformationSet } from "../engine/tournament";
import {
  assertReviewIsRedacted,
  canonicalReviewResult,
  countTournamentPlayersRemaining,
  deriveHandReview,
  filterDecisions,
  HandReviewCancelledError,
  notableDecisions,
  preflopActionFor,
  GOOD_MOVE_MAX_EV_LOSS_BB,
} from "./handReview";

const hero = { id: "hero", name: "Player", rating: 1_000 };

/** Plays a deterministic round and returns its replay. */
function playRound(seed: string, handLimit = 6): TournamentRunnerReplay {
  let runner = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed,
    }),
    { policy: { simulations: 50 } },
  );
  for (let index = 0; index < handLimit; index += 1) {
    if (runner.session.status === "complete") break;
    const legal = heroTournamentLegalActions(runner);
    if (!legal) break;
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action },
      { nowMs: index * 1_000, policy: { simulations: 50 } },
    );
  }
  return createTournamentRunnerReplay(runner, 50);
}

/** Finds an opening postflop bet, which the UI records as a `raise` request. */
function playOpeningBet(seed: string): TournamentRunnerReplay {
  let runner = advanceTournamentRunnerToHero(
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed,
    }),
    { policy: { simulations: 50 } },
  );

  for (let index = 0; index < 80; index += 1) {
    if (runner.session.status === "complete") break;
    const legal = heroTournamentLegalActions(runner);
    if (!legal) break;
    if (legal.bet && legal.bet.max > legal.bet.min) {
      const target = legal.bet.min + 1;
      runner = applyHeroTournamentAction(
        runner,
        { action: "raise", raiseTo: target },
        { nowMs: index * 1_000, policy: { simulations: 50 } },
      );
      return createTournamentRunnerReplay(runner, 50);
    }
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action },
      { nowMs: index * 1_000, policy: { simulations: 50 } },
    );
  }

  throw new Error("Seed did not reach an opening postflop bet");
}

describe("hand review derivation", () => {
  it("counts zero-stack all-in seats until tournament settlement", () => {
    expect(
      countTournamentPlayersRemaining([
        { status: "active", stack: 0 },
        { status: "active", stack: 125 },
        { status: "eliminated", stack: 0 },
      ]),
    ).toBe(2);
  });

  it("uses context-aware preflop action names for limps, calls, and raises", () => {
    const base = {
      handId: "preflop-semantics",
      viewerId: "hero",
      street: "preflop" as const,
      board: [],
      pot: 300,
      currentBet: 100,
      actingPlayerId: "hero",
      buttonSeat: 1,
      players: [],
      actions: [],
    };
    const unopened = { ...base } as Parameters<typeof preflopActionFor>[0];
    expect(preflopActionFor(unopened, { type: "call" })).toBe("open-limp");
    expect(preflopActionFor(unopened, { type: "raise" })).toBe("open-raise");

    const withLimp = {
      ...base,
      actions: [{ playerId: "villain", type: "call" as const, amount: 100 }],
    } as Parameters<typeof preflopActionFor>[0];
    expect(preflopActionFor(withLimp, { type: "raise" })).toBe(
      "isolation-raise",
    );

    const afterHeroLimp = {
      ...base,
      actions: [
        { playerId: "hero", type: "call" as const, amount: 100 },
        { playerId: "villain", type: "raise" as const, amount: 300 },
      ],
    } as Parameters<typeof preflopActionFor>[0];
    expect(preflopActionFor(afterHeroLimp, { type: "call" })).toBe("limp-call");
    expect(preflopActionFor(afterHeroLimp, { type: "raise" })).toBe(
      "limp-raise",
    );
  });

  it("uses one canonical EV ranking for recommendation, regret, badge, and good score", () => {
    const result = canonicalReviewResult(
      [
        { id: "fold", type: "fold", expectedValueBigBlinds: 0, foldEquity: 0, role: "fold", rationale: "Preserve chips" },
        { id: "raise:900", type: "raise", to: 900, expectedValueBigBlinds: -0.14, foldEquity: 0.3, role: "bluff", rationale: "Pressure" },
        { id: "call", type: "call", expectedValueBigBlinds: -0.6, foldEquity: 0, role: "showdown", rationale: "Defend" },
      ],
      { type: "raise", to: 900 },
    );

    expect(result.best.type).toBe("fold");
    expect(result.best.expectedValueBigBlinds).toBe(0);
    expect(result.played.id).toBe("raise:900");
    expect(result.regretBigBlinds).toBeCloseTo(0.14, 8);
    expect(result.quality).toBe("close");
    expect(result.good).toBe(true);
    expect(result.regretBigBlinds).toBeLessThanOrEqual(GOOD_MOVE_MAX_EV_LOSS_BB);
  });

  it("scores an opening bet using the engine command, not the UI raise label", async () => {
    const replay = playOpeningBet("review-opening-bet");
    const review = await deriveHandReview(replay, {
      simulations: 50,
      yieldControl: async () => undefined,
    });
    const decision = review.decisions.find((entry) => entry.chosen.type === "bet");

    expect(decision).toBeDefined();
    expect(decision?.chosen.to).toBeDefined();
    expect(
      decision?.math.actionValues.some(
        (option) => option.type === "bet" && option.to === decision?.chosen.to,
      ),
    ).toBe(true);
  }, 60_000);

  it("marks a review that reaches its safety ceiling as truncated", async () => {
    const replay = playRound("review-truncated", 6);
    const review = await deriveHandReview(replay, {
      simulations: 50,
      maxDecisions: 1,
      yieldControl: async () => undefined,
    });

    expect(review.decisions).toHaveLength(1);
    expect(review.truncated).toBe(true);
  }, 60_000);

  it("annotates every hero decision in the replay", async () => {
    const replay = playRound("review-basic");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    expect(review.decisions.length).toBeGreaterThan(0);
    expect(review.decisions.length).toBeLessThanOrEqual(replay.actions.length);
    expect(review.eventId).toBe(replay.eventId);
    expect(review.truncated).toBe(false);
    expect(review.goodAccuracy).toBeGreaterThanOrEqual(review.accuracy);
    expect(review.goodAccuracy).toBeLessThanOrEqual(1);
    for (const decision of review.decisions) {
      expect(decision.math.actionValues.length).toBeGreaterThan(0);
      expect(decision.math.evRegretBigBlinds).toBeGreaterThanOrEqual(0);
      expect(decision.math.simulations).toBe(60);
      expect(["preflop", "flop", "turn", "river"]).toContain(decision.street);
      const handNumber = decision.handId.match(/:hand-(\d+)$/)?.[1];
      expect(handNumber).toBe(String(decision.handNumber));
      if (decision.street === "preflop") {
        expect([
          "unopened",
          "facing-open",
          "facing-3bet",
          "facing-4bet-plus",
        ]).toContain(decision.preflopSituation);
      } else {
        expect(decision.preflopSituation).toBeUndefined();
      }
      expect(decision.recommended.type).toBeTruthy();
      const best = [...decision.math.actionValues].sort(
        (left, right) => right.expectedValueBigBlinds - left.expectedValueBigBlinds,
      )[0];
      expect(decision.recommended).toMatchObject({
        type: best.type,
        ...(best.to === undefined ? {} : { to: best.to }),
      });
    }
  }, 60_000);

  it("reconstructs the same state the player actually faced", async () => {
    // The review must not merely be plausible -- it must be the same hand.
    const replay = playRound("review-fidelity");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    // Independently rebuild the round and capture the first hero decision.
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: replay.eventId,
        hero: { ...replay.hero },
        mode: replay.mode,
        seed: replay.seed,
        careerResults: replay.careerResults,
      }),
      { nowMs: replay.actions[0]?.nowMs ?? 0, policy: { simulations: 50 } },
    );
    const hand = runner.session.activeHand;
    if (!hand) throw new Error("Expected an active hand");
    const live = createInformationSet(hand.information, hero.id);

    const first = review.decisions[0];
    expect(first.handId).toBe(hand.handId);
    expect(first.informationSet.pot).toBe(live.pot);
    expect(first.informationSet.board).toEqual(live.board);
    expect(first.math.potBefore).toBe(live.pot);
  }, 60_000);

  it("never exposes a card the hero was not entitled to see", async () => {
    const replay = playRound("review-privacy");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    // The structural assertion...
    expect(() => assertReviewIsRedacted(review, hero.id)).not.toThrow();
    // ...and the blunt one: the serialized review carries exactly the hero's
    // own two cards per decision and no other hole-card data.
    for (const decision of review.decisions) {
      const withCards = decision.informationSet.players.filter(
        (player) => player.holeCards && player.holeCards.length > 0,
      );
      expect(withCards.map((player) => player.id)).toEqual([hero.id]);
    }
  }, 60_000);

  it("does not leak information from later in the hand into an earlier decision", async () => {
    const replay = playRound("review-no-future");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    // Within one hand, the board can only grow. A decision must never carry
    // board cards that had not been dealt when it was made.
    const byHand = new Map<string, typeof review.decisions>();
    for (const decision of review.decisions) {
      byHand.set(decision.handId, [
        ...(byHand.get(decision.handId) ?? []),
        decision,
      ]);
    }
    for (const decisions of byHand.values()) {
      for (let index = 1; index < decisions.length; index += 1) {
        const previous = decisions[index - 1].informationSet.board;
        const current = decisions[index].informationSet.board;
        expect(current.length).toBeGreaterThanOrEqual(previous.length);
        expect(current.slice(0, previous.length)).toEqual(previous);
      }
    }
  }, 60_000);

  it("scores segments and suppresses tiny samples", async () => {
    const replay = playRound("review-segments");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    expect(review.accuracy).toBeGreaterThanOrEqual(0);
    expect(review.accuracy).toBeLessThanOrEqual(1);
    expect(review.segments.street.map((entry) => entry.key)).toEqual([
      "preflop",
      "flop",
      "turn",
      "river",
    ]);
    for (const group of Object.values(review.segments)) {
      for (const entry of group) {
        // An average over fewer than 8 decisions is noise, and the flag is
        // what stops the UI presenting it as a finding.
        expect(entry.reliable).toBe(entry.decisions >= 8);
        if (entry.decisions === 0) expect(entry.accuracy).toBe(0);
      }
    }
    const totalBySegment = review.segments.street.reduce(
      (sum, entry) => sum + entry.decisions,
      0,
    );
    expect(totalBySegment).toBe(review.decisions.length);
  }, 60_000);

  it("filters the timeline without losing decisions", async () => {
    const replay = playRound("review-filters");
    const review = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });

    expect(filterDecisions(review, {})).toHaveLength(review.decisions.length);
    const preflop = filterDecisions(review, { street: "preflop" });
    expect(preflop.every((decision) => decision.street === "preflop")).toBe(true);
    const mistakes = filterDecisions(review, { mistakesOnly: true });
    expect(
      mistakes.every((decision) => decision.quality !== "best" &&
        decision.quality !== "close"),
    ).toBe(true);
    expect(notableDecisions(review).every((decision) => decision.notable)).toBe(
      true,
    );
  }, 60_000);

  it("stops at a decision boundary when cancelled", async () => {
    const replay = playRound("review-cancel");
    const controller = { aborted: false };
    let yields = 0;

    await expect(
      deriveHandReview(replay, {
        simulations: 60,
        signal: controller,
        yieldControl: async () => {
          yields += 1;
          if (yields === 1) controller.aborted = true;
        },
      }),
    ).rejects.toBeInstanceOf(HandReviewCancelledError);

    expect(yields).toBe(1);
  }, 60_000);

  it("rejects a pre-aborted derivation before doing any work", async () => {
    const replay = playRound("review-stale");
    let yields = 0;
    await expect(
      deriveHandReview(replay, {
        signal: { aborted: true },
        yieldControl: async () => { yields += 1; },
      }),
    ).rejects.toBeInstanceOf(HandReviewCancelledError);
    expect(yields).toBe(0);
  }, 60_000);

  it("fails closed on a replay from a different build", async () => {
    const replay = playRound("review-version");
    const drifted = {
      ...replay,
      engineVersion: "tournament-session-v2",
    } as unknown as TournamentRunnerReplay;

    await expect(deriveHandReview(drifted)).rejects.toBeInstanceOf(
      TournamentReplayVersionError,
    );
    // The reconstruction path must fail the same way rather than silently
    // regenerating a different hand.
    expect(() => restoreTournamentRunnerReplay(drifted)).toThrow(
      TournamentReplayVersionError,
    );
  }, 60_000);

  it("derives from the replay alone, with no second history store", async () => {
    // Fidelity check: two derivations of the same replay agree exactly, which
    // they could not if anything outside the replay were feeding the review.
    const replay = playRound("review-deterministic");
    const first = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });
    const second = await deriveHandReview(replay, {
      simulations: 60,
      yieldControl: async () => undefined,
    });
    expect(second.decisions.map((decision) => decision.quality)).toEqual(
      first.decisions.map((decision) => decision.quality),
    );
    expect(second.accuracy).toBe(first.accuracy);
  }, 60_000);
});

describe("highlight density", () => {
  it("flags roughly one decision per few hands, not every decision", async () => {
    // The pacing target is ~1 highlight per 2-4 hands. It is a target, not a
    // quota: most preflop folds teach nothing, and flagging them would bury
    // the decisions that matter. What must hold is that the classifier is
    // selective without being silent.
    let hands = 0;
    let decisions = 0;
    let highlights = 0;

    for (let seedIndex = 0; seedIndex < 4; seedIndex += 1) {
      const replay = playRound(`review-density-${seedIndex}`);
      const review = await deriveHandReview(replay, {
        simulations: 60,
        yieldControl: async () => undefined,
      });
      hands += new Set(review.decisions.map((entry) => entry.handId)).size;
      decisions += review.decisions.length;
      highlights += notableDecisions(review).length;
    }

    expect(decisions).toBeGreaterThan(0);
    expect(hands).toBeGreaterThan(0);
    // Selective: nowhere near every decision is notable.
    expect(highlights).toBeLessThan(decisions);
    // But not silent either -- a review with nothing to look at is useless.
    expect(highlights).toBeGreaterThan(0);
    // Density is reported so drift is visible even when it stays in band.
    const perHand = highlights / hands;
    expect(perHand).toBeLessThanOrEqual(1.5);
  }, 120_000);
});
