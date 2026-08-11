import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import type { LegalActionSet } from "../engine/betting";
import type { PlayerInformationSet } from "../engine/tournament";
import {
  decideRationalAction,
  estimatePublicAllInEquitySliced,
  isPublicAllInEquityCancelled,
  estimateRangeEquity,
  estimateRangeEquitySliced,
  MAX_EQUITY_SIMULATIONS_PER_DECISION,
  MAX_EQUITY_SIMULATIONS_PER_SLICE,
  tournamentPressureAdjustment,
  type RationalPolicyInput,
} from "./rational";

describe("tournament pressure context", () => {
  it("makes an imminent big blind visible without treating it as pure survival risk", () => {
    const adjustment = tournamentPressureAdjustment(
      {
        playersRemaining: 6,
        paidPlaces: 2,
        placesToQualification: 4,
        averageStack: 12_000,
        imminentBigBlind: true,
      },
      3_000,
      2_000,
    );
    expect(adjustment.blindUrgency).toBeGreaterThan(0.8);
    expect(adjustment.tournamentPressure).toBeGreaterThan(0.09);
    expect(adjustment.imminentBigBlind).toBe(true);
    expect(adjustment.riskPremium).toBeGreaterThan(0);
    expect(adjustment.riskPremium).toBeLessThan(0.03);
  });

  it("keeps bubble survival pressure distinct from blind urgency", () => {
    const adjustment = tournamentPressureAdjustment(
      {
        playersRemaining: 3,
        paidPlaces: 2,
        placesToQualification: 1,
        averageStack: 10_000,
        handForHand: true,
      },
      20_000,
      1_000,
    );
    expect(adjustment.riskPremium).toBeGreaterThan(0.1);
    expect(adjustment.blindUrgency).toBe(0);
  });
});

const suits: Record<string, Suit> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

function cards(...values: string[]): Card[] {
  return values.map((value) => ({
    rank: value[0] as Rank,
    suit: suits[value[1]],
  }));
}

interface SpotOptions {
  heroCards?: Card[];
  board?: Card[];
  pot?: number;
  currentBet?: number;
  heroCommitted?: number;
  heroStack?: number;
  villainStack?: number;
  actions?: PlayerInformationSet["actions"];
  buttonSeat?: number;
}

function makeSpot(options: SpotOptions = {}): PlayerInformationSet {
  return {
    handId: "rational-test-hand",
    viewerId: "hero",
    street:
      (options.board?.length ?? 5) === 0
        ? "preflop"
        : (options.board?.length ?? 5) === 3
          ? "flop"
          : (options.board?.length ?? 5) === 4
            ? "turn"
            : "river",
    board: options.board ?? cards("Ah", "7d", "4c", "Js", "2h"),
    pot: options.pot ?? 600,
    currentBet: options.currentBet ?? 200,
    actingPlayerId: "hero",
    buttonSeat: options.buttonSeat ?? 6,
    players: [
      {
        id: "hero",
        name: "Hero",
        seat: 6,
        stack: options.heroStack ?? 4_000,
        status: "active",
        streetCommitted: options.heroCommitted ?? 0,
        totalCommitted: 400,
        holeCards: options.heroCards ?? cards("As", "Kd"),
      },
      {
        id: "villain",
        name: "Villain",
        seat: 2,
        stack: options.villainStack ?? 4_000,
        status: "active",
        streetCommitted: options.currentBet ?? 200,
        totalCommitted: 600,
      },
    ],
    actions:
      options.actions ??
      [{ playerId: "villain", type: "bet", amount: options.currentBet ?? 200 }],
  };
}

function facingBetLegal(
  spot: PlayerInformationSet,
  options: { canRaise?: boolean } = {},
): LegalActionSet {
  const hero = spot.players.find((player) => player.id === "hero");
  if (!hero) throw new Error("Hero missing");
  const toCall = Math.max(0, spot.currentBet - hero.streetCommitted);
  const allInTo = hero.streetCommitted + hero.stack;
  const canRaise = options.canRaise ?? true;
  return {
    playerId: "hero",
    toCall,
    check: toCall === 0,
    fold: true,
    call: toCall > 0,
    callAmount: Math.min(hero.stack, toCall),
    raise:
      toCall > 0 && canRaise && allInTo >= spot.currentBet * 2
        ? { minTo: spot.currentBet * 2, maxTo: allInTo }
        : undefined,
    allIn: toCall === 0 || allInTo <= spot.currentBet || canRaise,
    allInTo,
    raisingReopened: canRaise,
  };
}

function checkedToLegal(spot: PlayerInformationSet): LegalActionSet {
  const hero = spot.players.find((player) => player.id === "hero");
  if (!hero) throw new Error("Hero missing");
  return {
    playerId: "hero",
    toCall: 0,
    check: true,
    fold: true,
    call: false,
    callAmount: 0,
    bet: { min: 100, max: hero.stack + hero.streetCommitted },
    allIn: true,
    allInTo: hero.stack + hero.streetCommitted,
    raisingReopened: true,
  };
}

function input(
  informationSet: PlayerInformationSet,
  legalActions: LegalActionSet,
  overrides: Partial<RationalPolicyInput> = {},
): RationalPolicyInput {
  return {
    informationSet,
    legalActions,
    bigBlind: 100,
    seed: "rational-policy-test",
    simulations: 240,
    ...overrides,
  };
}

function probabilityByType(
  decision: ReturnType<typeof decideRationalAction>,
  type: string,
): number {
  return decision.distribution
    .filter((option) => option.command.type === type)
    .reduce((sum, option) => sum + option.probability, 0);
}

describe("rational policy contract", () => {
  it("fails closed when the information set names a different actor", () => {
    const spot = { ...makeSpot(), actingPlayerId: "villain" };
    expect(() =>
      decideRationalAction(input(spot, facingBetLegal(spot))),
    ).toThrow(/may act only for the information-set viewer/);
  });

  it("rejects malformed revealed opponent holdings before equity work", () => {
    const spot = makeSpot();
    spot.players[1] = {
      ...spot.players[1],
      revealed: true,
      holeCards: cards("7s"),
    };
    expect(() =>
      decideRationalAction(input(spot, facingBetLegal(spot))),
    ).toThrow(/exactly two hole cards/);
  });

  it("is deterministic for an identical information set and policy seed", () => {
    const spot = makeSpot();
    const policyInput = input(spot, facingBetLegal(spot));

    expect(decideRationalAction(policyInput)).toEqual(
      decideRationalAction(policyInput),
    );
  });

  it("is invariant to extra hidden-card, deck, and game-RNG fields", () => {
    const spot = makeSpot();
    const polluted = {
      ...spot,
      hiddenOpponentCards: cards("7s", "7c"),
      deck: cards("3s", "4s", "5s"),
      gameRngSeed: "must-not-be-read",
    } as PlayerInformationSet;
    const legal = facingBetLegal(spot);

    expect(
      decideRationalAction(input(polluted, legal, { seed: "same" })),
    ).toEqual(decideRationalAction(input(spot, legal, { seed: "same" })));
  });

  it("produces a normalized distribution containing only legal actions", () => {
    const spot = makeSpot();
    const legal = facingBetLegal(spot);
    const decision = decideRationalAction(input(spot, legal));
    const total = decision.distribution.reduce(
      (sum, option) => sum + option.probability,
      0,
    );

    expect(total).toBeCloseTo(1, 12);
    expect(decision.distribution.every((option) => option.probability > 0)).toBe(
      true,
    );
    for (const option of decision.distribution) {
      if (option.command.type === "raise") {
        expect(option.command.to).toBeGreaterThanOrEqual(legal.raise?.minTo ?? 0);
        expect(option.command.to).toBeLessThanOrEqual(legal.raise?.maxTo ?? 0);
      } else {
        expect(["fold", "call", "all-in"]).toContain(option.command.type);
      }
    }
    expect(
      decision.distribution.some(
        (option) => option.id === decision.chosen.id,
      ),
    ).toBe(true);
  });

  it("exposes a UI-facing audit without hidden opponent holdings", () => {
    const spot = makeSpot({
      actions: [
        { playerId: "villain", type: "raise", amount: 500 },
        { playerId: "villain", type: "bet", amount: 200 },
      ],
    });
    const decision = decideRationalAction(input(spot, facingBetLegal(spot)));
    const serialized = JSON.stringify(decision.audit);

    expect(decision.audit.metrics.equity).toBeGreaterThanOrEqual(0);
    expect(decision.audit.metrics.equity).toBeLessThanOrEqual(1);
    expect(decision.audit.opponentRanges[0].aggression).toBeGreaterThan(1);
    expect(decision.audit.actionEvaluations).toHaveLength(
      decision.distribution.length,
    );
    expect(serialized).not.toContain("holeCards");
    expect(serialized).not.toContain("gameRng");
  });
});

describe("range-aware equity", () => {
  it("returns deterministic equity accounting for ties", () => {
    const spot = makeSpot({
      heroCards: cards("2c", "3d"),
      board: cards("Ah", "Kh", "Qh", "Jh", "Th"),
      currentBet: 100,
    });
    const legal = facingBetLegal(spot);
    const first = estimateRangeEquity(spot, legal, "equity-seed", 180);
    const replay = estimateRangeEquity(spot, legal, "equity-seed", 180);

    expect(replay).toEqual(first);
    expect(first.losses).toBe(0);
    expect(first.ties).toBe(180);
    expect(first.equity).toBe(0.5);
  });

  it("produces identical samples across deterministic slice sizes", () => {
    const spot = makeSpot({
      heroCards: cards("As", "Kd"),
      board: cards("8h", "7d", "2c"),
    });
    const legal = facingBetLegal(spot);
    const oneAtATime = estimateRangeEquity(
      spot,
      legal,
      "slice-invariance",
      240,
      { simulationsPerSlice: 1 },
    );
    const maximumSlices = estimateRangeEquity(
      spot,
      legal,
      "slice-invariance",
      240,
      { simulationsPerSlice: MAX_EQUITY_SIMULATIONS_PER_SLICE },
    );
    const { work: firstWork, ...firstOutcome } = oneAtATime;
    const { work: secondWork, ...secondOutcome } = maximumSlices;

    expect(secondOutcome).toEqual(firstOutcome);
    expect(firstWork.slices).toBe(240);
    expect(secondWork.slices).toBe(8);
    expect(firstWork.handEvaluations).toBe(secondWork.handEvaluations);
  });

  it("yields only between fixed work-count slices without changing results", async () => {
    const spot = makeSpot({
      heroCards: cards("Qc", "Jc"),
      board: cards("Th", "7d", "2c"),
    });
    const legal = facingBetLegal(spot);
    let yields = 0;
    const synchronous = estimateRangeEquity(
      spot,
      legal,
      "async-slice-invariance",
      180,
      { simulationsPerSlice: 31 },
    );
    const sliced = await estimateRangeEquitySliced(
      spot,
      legal,
      "async-slice-invariance",
      180,
      {
        simulationsPerSlice: 31,
        yieldControl: async () => {
          yields += 1;
          if (yields === 1) {
            spot.board[0] = cards("Ac")[0];
            spot.actions.push({
              playerId: "villain",
              type: "raise",
              amount: 9_999,
            });
          }
        },
      },
    );

    expect(sliced).toEqual(synchronous);
    expect(sliced.work.slices).toBe(6);
    expect(yields).toBe(5);
    expect(sliced.work.schedulingBasis).toBe("completed-simulation-count");
  });

  it("fails closed above the per-decision and per-slice work caps", () => {
    const spot = makeSpot();
    const legal = facingBetLegal(spot);

    expect(() =>
      estimateRangeEquity(
        spot,
        legal,
        "over-budget",
        MAX_EQUITY_SIMULATIONS_PER_DECISION + 1,
      ),
    ).toThrow(
      new RegExp(
        `integer from 50 to ${MAX_EQUITY_SIMULATIONS_PER_DECISION}`,
      ),
    );
    expect(() =>
      estimateRangeEquity(spot, legal, "over-slice", 100, {
        simulationsPerSlice: MAX_EQUITY_SIMULATIONS_PER_SLICE + 1,
      }),
    ).toThrow(
      new RegExp(`per slice.*1 to ${MAX_EQUITY_SIMULATIONS_PER_SLICE}`, "i"),
    );
  });

  it("keeps fixed-seed policy outcomes identical across slice boundaries", () => {
    const spot = makeSpot({
      heroCards: cards("As", "5s"),
      board: cards("Ks", "Qs", "7d", "2c", "3h"),
      currentBet: 0,
      actions: [],
    });
    const legal = checkedToLegal(spot);
    const narrow = decideRationalAction(
      input(spot, legal, {
        seed: "decision-slice-invariance",
        simulations: 300,
        equitySimulationsPerSlice: 1,
      }),
    );
    const wide = decideRationalAction(
      input(spot, legal, {
        seed: "decision-slice-invariance",
        simulations: 300,
        equitySimulationsPerSlice: MAX_EQUITY_SIMULATIONS_PER_SLICE,
      }),
    );

    expect(wide.chosen).toEqual(narrow.chosen);
    expect(wide.distribution).toEqual(narrow.distribution);
    expect(wide.audit.metrics).toEqual(narrow.audit.metrics);
    expect(wide.audit.opponentRanges).toEqual(narrow.audit.opponentRanges);
    expect(wide.audit.summary).toBe(narrow.audit.summary);
    expect(wide.audit.equityWork.slices).toBe(10);
    expect(narrow.audit.equityWork.slices).toBe(300);
  });
});

describe("public all-in equity", () => {
  it("uses only legal public cards and produces a known forced winner", async () => {
    const estimate = await estimatePublicAllInEquitySliced({
      players: [
        { playerId: "hero", cards: cards("Th", "2c") },
        { playerId: "villain", cards: cards("9c", "9d") },
      ],
      board: cards("Ah", "Kh", "Qh", "Jh"),
      seed: "public-royal-flush",
      simulations: 100,
      simulationsPerSlice: 11,
    });

    expect(estimate.unseenCards).toBe(44);
    expect(estimate.players).toEqual([
      { playerId: "hero", wins: 100, ties: 0, losses: 0, equity: 1 },
      { playerId: "villain", wins: 0, ties: 0, losses: 100, equity: 0 },
    ]);
  });

  it("is deterministic and yields only between public-work slices", async () => {
    let yields = 0;
    const request = {
      players: [
        { playerId: "hero", cards: cards("As", "Kd") },
        { playerId: "villain", cards: cards("Qh", "Qs") },
      ],
      board: cards("2c", "7d", "Th"),
      seed: "public-sliced",
      simulations: 60,
      simulationsPerSlice: 13,
    };
    const first = await estimatePublicAllInEquitySliced(request, {
      yieldControl: async () => { yields += 1; },
    });
    const second = await estimatePublicAllInEquitySliced(request);
    expect(first).toEqual(second);
    expect(yields).toBe(4);
  });

  it("abandons the remaining work when the caller cancels mid-run", async () => {
    let slices = 0;
    const controller = { aborted: false };
    const request = {
      players: [
        { playerId: "hero", cards: cards("As", "Kd") },
        { playerId: "villain", cards: cards("Qh", "Qs") },
      ],
      board: cards("2c", "7d", "Th"),
      seed: "public-cancelled",
      simulations: 500,
      simulationsPerSlice: 25,
    };

    await expect(
      estimatePublicAllInEquitySliced(request, {
        signal: controller,
        yieldControl: async () => {
          slices += 1;
          if (slices === 2) controller.aborted = true;
        },
      }),
    ).rejects.toSatisfy(isPublicAllInEquityCancelled);

    // Stopped at the boundary that observed the abort rather than running all
    // 19 remaining slices to completion.
    expect(slices).toBe(2);
  });

  it("rejects an already-superseded request before doing any work", async () => {
    let slices = 0;
    await expect(
      estimatePublicAllInEquitySliced(
        {
          players: [
            { playerId: "hero", cards: cards("As", "Kd") },
            { playerId: "villain", cards: cards("Qh", "Qs") },
          ],
          board: cards("2c", "7d", "Th"),
          seed: "public-stale",
          simulations: 500,
          simulationsPerSlice: 25,
        },
        {
          signal: { aborted: true },
          yieldControl: async () => { slices += 1; },
        },
      ),
    ).rejects.toSatisfy(isPublicAllInEquityCancelled);
    expect(slices).toBe(0);
  });

  it("still resolves normally when the signal never aborts", async () => {
    const request = {
      players: [
        { playerId: "hero", cards: cards("As", "Kd") },
        { playerId: "villain", cards: cards("Qh", "Qs") },
      ],
      board: cards("2c", "7d", "Th"),
      seed: "public-sliced",
      simulations: 60,
      simulationsPerSlice: 13,
    };
    const guarded = await estimatePublicAllInEquitySliced(request, {
      signal: { aborted: false },
    });
    const plain = await estimatePublicAllInEquitySliced(request);
    expect(guarded).toEqual(plain);
  });
});

describe("escalating raise wars", () => {
  /** A street whose action list already contains `count` raises. */
  function warActions(count: number): PlayerInformationSet["actions"] {
    const actions: PlayerInformationSet["actions"] = [
      { playerId: "villain", type: "bet", amount: 200 },
    ];
    for (let index = 0; index < count; index += 1) {
      actions.push({
        playerId: index % 2 === 0 ? "hero" : "villain",
        type: "raise",
        amount: 200 * (index + 2),
      });
    }
    return actions;
  }

  it("becomes progressively less willing to re-raise as the war escalates", () => {
    // The measured defect was a 600+ action raise chain: each decision looked
    // like a fresh, profitable aggression spot because nothing in the model
    // could see the war it was already in.
    const aggressionOf = (raisesSoFar: number) => {
      const spot = makeSpot({
        heroCards: cards("Ac", "Qd"),
        board: cards("Kh", "9s", "4d"),
        pot: 1_600,
        currentBet: 400,
        actions: warActions(raisesSoFar),
      });
      const decision = decideRationalAction(
        input(spot, facingBetLegal(spot), { simulations: 200 }),
      );
      return (
        probabilityByType(decision, "raise") +
        probabilityByType(decision, "all-in")
      );
    };

    const opening = aggressionOf(0);
    const deep = aggressionOf(6);
    expect(deep).toBeLessThan(opening);
  });

  it("does not offer the minimum legal raise as a routine candidate", () => {
    // Min-raise was the cheapest way to stay aggressive, and `lastFullRaise`
    // grows only by the previous increment, so a chain of min re-raises
    // escalates arithmetically and needs hundreds of iterations to exhaust a
    // deep stack. Sizing must be pot-relative instead.
    const spot = makeSpot({
      heroCards: cards("As", "Ks"),
      board: cards("Ts", "Js", "Qs", "2d", "3c"),
      pot: 600,
      currentBet: 200,
    });
    const legal = facingBetLegal(spot);
    const decision = decideRationalAction(
      input(spot, legal, { simulations: 160 }),
    );
    const raiseSizes = decision.distribution
      .filter((option) => option.command.type === "raise")
      .map((option) => option.command.to ?? 0);

    expect(raiseSizes.length).toBeGreaterThan(0);
    expect(raiseSizes).not.toContain(legal.raise?.minTo);
    // Every offered size is a real pot-relative commitment.
    for (const size of raiseSizes) {
      expect(size).toBeGreaterThan(legal.raise?.minTo ?? 0);
    }
  });

  it("calls rather than raises when calling strictly dominates", () => {
    // Marginal equity facing a large bet from a deep stack: continuing is
    // defensible, escalating is not.
    const spot = makeSpot({
      heroCards: cards("Ah", "Jd"),
      board: cards("As", "9c", "5d", "3h", "2s"),
      pot: 2_000,
      currentBet: 500,
      heroStack: 12_000,
      villainStack: 12_000,
      actions: warActions(4),
    });
    const decision = decideRationalAction(
      input(spot, facingBetLegal(spot), { simulations: 240, temperature: 0.3 }),
    );
    const aggressive =
      probabilityByType(decision, "raise") +
      probabilityByType(decision, "all-in");

    expect(probabilityByType(decision, "call")).toBeGreaterThan(aggressive);
  });

  it("lets robust value punish committed aggression on a dynamic board", () => {
    const spot = makeSpot({
      heroCards: cards("Ah", "Ad"),
      board: cards("Ac", "Jh", "Th"),
      pot: 2_000,
      currentBet: 500,
      heroStack: 8_000,
      villainStack: 8_000,
      actions: warActions(3),
    });
    const decision = decideRationalAction(
      input(spot, facingBetLegal(spot), { simulations: 240, temperature: 0.3 }),
    );
    const fold = decision.distribution.find((option) => option.command.type === "fold");
    const bestAggression = decision.distribution
      .filter((option) => option.command.type === "raise" || option.command.type === "all-in")
      .sort((left, right) => right.utilityBigBlinds - left.utilityBigBlinds)[0];

    expect(bestAggression).toBeDefined();
    expect(bestAggression?.utilityBigBlinds).toBeGreaterThan(fold?.utilityBigBlinds ?? 0);
    expect(probabilityByType(decision, "fold")).toBeLessThan(0.01);
  });

  it("does not shove a deep stack without a commanding edge", () => {
    // Cause 3: the risk premium alone computes to 0.04-0.07 in career play and
    // never restrained a 300 BB shove with a marginal hand.
    const spot = makeSpot({
      heroCards: cards("Qh", "Qd"),
      board: cards("Ac", "Kd", "7s"),
      pot: 900,
      currentBet: 300,
      heroStack: 30_000,
      villainStack: 30_000,
    });
    const decision = decideRationalAction(
      input(spot, facingBetLegal(spot), { simulations: 240, temperature: 0.3 }),
    );
    expect(probabilityByType(decision, "all-in")).toBeLessThan(0.15);
  });
});

describe("canonical rational spots", () => {
  it("never meaningfully folds the river nuts", () => {
    const spot = makeSpot({
      heroCards: cards("As", "Ks"),
      board: cards("Ts", "Js", "Qs", "2d", "3c"),
      pot: 600,
      currentBet: 200,
    });
    const decision = decideRationalAction(
      input(spot, facingBetLegal(spot), { simulations: 160 }),
    );

    expect(decision.audit.metrics.equity).toBe(1);
    expect(probabilityByType(decision, "fold")).toBeLessThan(0.001);
    expect(probabilityByType(decision, "call")).toBeGreaterThan(0);
  });

  it("strongly prefers folding a weak river hand to an oversized bet", () => {
    const spot = makeSpot({
      heroCards: cards("7c", "2d"),
      board: cards("Ah", "Kd", "Qs", "Jc", "9h"),
      pot: 200,
      currentBet: 600,
      villainStack: 5_000,
    });
    const decision = decideRationalAction(
      input(spot, facingBetLegal(spot, { canRaise: false }), {
        simulations: 300,
        temperature: 0.3,
      }),
    );

    expect(decision.audit.metrics.potOdds).toBe(0.75);
    expect(probabilityByType(decision, "fold")).toBeGreaterThan(0.75);
  });

  it("value-bets a dominant made hand when checked to", () => {
    const spot = makeSpot({
      heroCards: cards("Ah", "Ad"),
      board: cards("As", "Kc", "7d", "2s", "3h"),
      pot: 400,
      currentBet: 0,
      actions: [],
    });
    const decision = decideRationalAction(
      input(spot, checkedToLegal(spot), { simulations: 220 }),
    );
    const aggressive =
      probabilityByType(decision, "bet") +
      probabilityByType(decision, "all-in");

    expect(decision.audit.metrics.equity).toBeGreaterThan(0.9);
    expect(aggressive).toBeGreaterThan(probabilityByType(decision, "check"));
  });

  it("retains mathematically supported bluff options with blockers", () => {
    const spot = makeSpot({
      heroCards: cards("As", "5s"),
      board: cards("Ks", "Qs", "7d", "2c", "3h"),
      pot: 500,
      currentBet: 0,
      actions: [],
    });
    const decision = decideRationalAction(
      input(spot, checkedToLegal(spot), { simulations: 280 }),
    );
    const bluffs = decision.distribution.filter(
      (option) => option.role === "bluff" || option.role === "semi-bluff",
    );

    expect(decision.audit.metrics.blockerScore).toBeGreaterThan(0);
    expect(bluffs.length).toBeGreaterThan(0);
    expect(bluffs.some((option) => option.foldEquity > 0)).toBe(true);
    expect(
      bluffs.reduce((sum, option) => sum + option.probability, 0),
    ).toBeGreaterThan(0);
  });

  it("raises the continuing threshold near a tournament bubble", () => {
    const spot = makeSpot({
      heroCards: cards("Jh", "Jd"),
      board: cards("Ah", "8d", "4c", "2s", "3h"),
      pot: 600,
      currentBet: 300,
    });
    const legal = facingBetLegal(spot, { canRaise: false });
    const baseline = decideRationalAction(input(spot, legal, { seed: "bubble" }));
    const bubble = decideRationalAction(
      input(spot, legal, {
        seed: "bubble",
        tournament: {
          playersRemaining: 10,
          paidPlaces: 9,
          averageStack: 5_000,
          handForHand: true,
        },
      }),
    );

    expect(bubble.audit.metrics.requiredEquity).toBeGreaterThan(
      baseline.audit.metrics.requiredEquity,
    );
    expect(probabilityByType(bubble, "fold")).toBeGreaterThanOrEqual(
      probabilityByType(baseline, "fold"),
    );
  });
});
