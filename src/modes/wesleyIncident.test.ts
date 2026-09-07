import { describe, expect, it } from "vitest";
import {
  deriveSeed,
  isStackOffCommand,
  type LegalActionSet,
} from "../engine";
import type { Card, Rank, Suit } from "../types/poker";
import {
  calculateReopenPenalty,
  calculateStackExposurePenalty,
  decideRationalAction,
  evaluateRaiseBranchEv,
  quantizeWager,
  type RationalPolicyInput,
} from "./rational";

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

/**
 * Public information immediately before the saved hand's Wesley decision.
 * The hidden opponent card is intentionally omitted; only the viewer's 7s7h
 * is present, matching createInformationSet's privacy boundary.
 */
function wesleyInformation() {
  return {
    handId: "regional-open:career:regional-open:1788553179140:hand-1",
    viewerId: "nash-stone",
    street: "flop" as const,
    board: cards("5c", "8h", "4h"),
    pot: 375,
    currentBet: 150,
    actingPlayerId: "nash-stone",
    buttonSeat: 2,
    players: [
      {
        id: "talia-ibarra",
        name: "Talia Ibarra",
        seat: 1,
        stack: 25_000,
        status: "folded" as const,
        streetCommitted: 0,
        totalCommitted: 0,
      },
      {
        id: "blake-ross",
        name: "Blake Ross",
        seat: 2,
        stack: 25_000,
        status: "folded" as const,
        streetCommitted: 0,
        totalCommitted: 0,
      },
      {
        id: "emmett-calder",
        name: "Emmett Calder",
        seat: 3,
        stack: 24_925,
        status: "folded" as const,
        streetCommitted: 0,
        totalCommitted: 75,
      },
      {
        id: "nash-stone",
        name: "Nash Stone",
        seat: 4,
        stack: 24_925,
        status: "active" as const,
        streetCommitted: 0,
        totalCommitted: 75,
        holeCards: cards("7s", "7h"),
      },
      {
        id: "vaughn-kovač",
        name: "Vaughn Kovač",
        seat: 5,
        stack: 25_000,
        status: "folded" as const,
        streetCommitted: 0,
        totalCommitted: 0,
      },
      {
        id: "hero",
        name: "Player",
        seat: 6,
        stack: 24_775,
        status: "active" as const,
        streetCommitted: 150,
        totalCommitted: 225,
      },
    ],
    actions: [
      { playerId: "emmett-calder", type: "small-blind", amount: 50 },
      { playerId: "nash-stone", type: "big-blind", amount: 75 },
      { playerId: "vaughn-kovač", type: "fold", amount: 0 },
      { playerId: "hero", type: "call", amount: 75 },
      { playerId: "talia-ibarra", type: "fold", amount: 0 },
      { playerId: "blake-ross", type: "fold", amount: 0 },
      { playerId: "emmett-calder", type: "call", amount: 75 },
      { playerId: "nash-stone", type: "check", amount: 75 },
      { playerId: "dealer", type: "flop" },
      { playerId: "emmett-calder", type: "check", amount: 0 },
      { playerId: "nash-stone", type: "check", amount: 0 },
      { playerId: "hero", type: "bet", amount: 150 },
      { playerId: "emmett-calder", type: "fold", amount: 0 },
    ],
  };
}

function wesleyLegal(): LegalActionSet {
  return {
    playerId: "nash-stone",
    toCall: 150,
    check: false,
    fold: true,
    call: true,
    callAmount: 150,
    raise: { minTo: 300, maxTo: 24_925 },
    allIn: true,
    allInTo: 24_925,
    raisingReopened: true,
  };
}

function scaleInformationSet(scale: number) {
  const source = wesleyInformation();
  return {
    ...source,
    pot: source.pot * scale,
    currentBet: source.currentBet * scale,
    players: source.players.map((player) => ({
      ...player,
      stack: player.stack * scale,
      streetCommitted: player.streetCommitted * scale,
      totalCommitted: player.totalCommitted * scale,
    })),
    actions: source.actions.map((action) => ({
      ...action,
      amount: action.amount === undefined ? undefined : action.amount * scale,
    })),
  };
}

function scaleLegalActions(source: LegalActionSet, scale: number): LegalActionSet {
  return {
    ...source,
    toCall: source.toCall * scale,
    callAmount: source.callAmount * scale,
    raise: source.raise && {
      minTo: source.raise.minTo * scale,
      maxTo: source.raise.maxTo * scale,
    },
    allInTo: source.allInTo * scale,
    bet: source.bet && {
      min: source.bet.min * scale,
      max: source.bet.max * scale,
    },
  };
}

function wesleyInput(overrides: Partial<RationalPolicyInput> = {}): RationalPolicyInput {
  const informationSet = wesleyInformation();
  return {
    informationSet,
    legalActions: wesleyLegal(),
    bigBlind: 75,
    smallestChip: 25,
    seed: deriveSeed(
      "career:regional-open:1788553179140",
      informationSet.handId,
      informationSet.viewerId,
      "rational-policy",
    ),
    simulations: 60,
    temperature: 0.48,
    tournament: { tournamentPlayersRemaining: 6 },
    ...overrides,
  };
}

function stackOffOption(
  decision: ReturnType<typeof decideRationalAction>,
): ReturnType<typeof decideRationalAction>["distribution"][number] {
  const option = decision.distribution.find(
    (entry) => entry.command.type === "all-in",
  );
  if (!option) throw new Error("Wesley fixture has no all-in candidate");
  return option;
}

describe("saved Wesley incident regression", () => {
  it("reproduces the pre-action geometry and keeps max stack-off scoring conditional", () => {
    const informationSet = wesleyInformation();
    const legal = wesleyLegal();
    const decision = decideRationalAction(wesleyInput());
    const shove = stackOffOption(decision);
    const response = shove.response;

    expect(informationSet.board.map((card) => `${card.rank}${card.suit[0]}`)).toEqual([
      "5c",
      "8h",
      "4h",
    ]);
    expect(informationSet.pot).toBe(375);
    expect(legal).toMatchObject({
      toCall: 150,
      raise: { minTo: 300, maxTo: 24_925 },
      allInTo: 24_925,
    });
    expect(decision.audit.metrics.effectiveStackBigBlinds).toBeCloseTo(330.3333, 3);
    expect(decision.audit.metrics.stackToPotRatio).toBeCloseTo(66.0667, 3);
    expect(response).toBeDefined();
    expect(response?.callProbability).toBeCloseTo(7 / 60, 8);
    expect(response?.callEquity).toBeCloseTo(2 / 7, 8);
    expect(response?.callEquity).not.toBeCloseTo(
      decision.audit.metrics.showdownEquity,
      2,
    );
    const branchUtilityBigBlinds = evaluateRaiseBranchEv({
        pot: informationSet.pot,
        additionalRisk: 24_925,
        allFoldProbability: response?.allFoldProbability ?? 0,
        callProbability: response?.callProbability ?? 0,
        reRaiseProbability: response?.reRaiseProbability ?? 0,
        calledEquity: response?.callEquity ?? 0,
        expectedOpponentContribution: response?.expectedOpponentContribution,
      }) / 75;
    const stackExposurePenaltyBigBlinds =
      calculateStackExposurePenalty({
        additionalRisk: 24_925,
        pot: informationSet.pot,
        effectiveStack: decision.audit.metrics.effectiveStack,
        calledEquity: response?.callEquity ?? 0,
        riskPremium: decision.audit.adjustments.tournamentRiskPremium,
      }) / 75;
    const reopenPenaltyBigBlinds =
      calculateReopenPenalty({
        wager: 24_925,
        streetAggression: decision.audit.metrics.streetAggression,
        reRaisedProbability: response?.reRaiseProbability ?? 0,
        showdownEquity: decision.audit.metrics.showdownEquity,
        requiredEquity: decision.audit.metrics.requiredEquity,
      }) / 75;
    expect(shove.utilityBigBlinds).toBeCloseTo(
      branchUtilityBigBlinds -
        stackExposurePenaltyBigBlinds -
        reopenPenaltyBigBlinds -
        decision.audit.adjustments.tournamentRiskPremium *
          (24_925 / 75),
      8,
    );
    expect(shove.utilityBigBlinds).toBeLessThan(0);
    expect(shove.probability).toBeLessThan(0.01);
    expect(shove.sizing).toBeUndefined();
    expect(decision.chosen.command.type).not.toBe("all-in");
    expect(isStackOffCommand(decision.chosen.command, legal)).toBe(false);
  });

  it("is invariant to the display name used for the same player identity", () => {
    const renamed = wesleyInformation();
    renamed.players = renamed.players.map((player) =>
      player.id === "nash-stone" ? { ...player, name: "Wesley" } : player,
    );
    const original = decideRationalAction(wesleyInput());
    const renamedDecision = decideRationalAction(
      wesleyInput({ informationSet: renamed }),
    );
    expect(renamedDecision).toEqual(original);
  });

  it("preserves decision geometry when every chip quantity is scaled together", () => {
    const original = decideRationalAction(wesleyInput());
    const scale = 10;
    const scaled = decideRationalAction(
      wesleyInput({
        informationSet: scaleInformationSet(scale),
        legalActions: scaleLegalActions(wesleyLegal(), scale),
        bigBlind: 750,
        smallestChip: 250,
      }),
    );

    expect(scaled.audit.metrics.stackToPotRatio).toBeCloseTo(
      original.audit.metrics.stackToPotRatio,
      10,
    );
    expect(scaled.audit.metrics.effectiveStackBigBlinds).toBeCloseTo(
      original.audit.metrics.effectiveStackBigBlinds,
      10,
    );
    expect(scaled.chosen.command.type).toBe(original.chosen.command.type);
    expect(scaled.chosen.command.to === undefined ? undefined :
      scaled.chosen.command.to / scale).toBe(original.chosen.command.to);
    const originalProbabilities = original.distribution.map((option) => option.probability);
    const scaledProbabilities = scaled.distribution.map((option) => option.probability);
    expect(scaledProbabilities).toHaveLength(originalProbabilities.length);
    scaledProbabilities.forEach((probability, index) => {
      expect(probability).toBeCloseTo(originalProbabilities[index], 10);
    });
  });

  it("keeps ordinary regional candidates on the 25-chip rack", () => {
    const decision = decideRationalAction(wesleyInput({
      informationSet: {
        ...wesleyInformation(),
        pot: 1_000,
        currentBet: 0,
        actingPlayerId: "nash-stone",
        players: wesleyInformation().players.map((player) =>
          player.id === "hero"
            ? { ...player, streetCommitted: 0, totalCommitted: 0 }
            : player,
        ),
        actions: [{ playerId: "dealer", type: "flop" }],
      },
      legalActions: {
        playerId: "nash-stone",
        toCall: 0,
        check: true,
        fold: true,
        call: false,
        callAmount: 0,
        bet: { min: 75, max: 24_925 },
        allIn: true,
        allInTo: 24_925,
        raisingReopened: true,
      },
    }));
    for (const option of decision.distribution) {
      if (option.command.type === "bet" && option.command.to !== undefined) {
        expect(option.command.to % 25).toBe(0);
        if (option.sizing) {
          expect(Math.abs(option.sizing.rackAdjustment)).toBeLessThanOrEqual(12.5);
          expect(option.sizing.executedTarget).toBe(option.command.to);
        }
      }
    }
  });

  it("rounds ordinary desired sizes to the configured rack without touching exact all-ins", () => {
    expect(quantizeWager(243, 25)).toBe(250);
    expect(quantizeWager(487, 25)).toBe(475);
    expect(quantizeWager(1_037, 25)).toBe(1_025);
    expect(quantizeWager(2_413, 25)).toBe(2_425);
    expect(quantizeWager(6_243, 25)).toBe(6_250);
    expect(quantizeWager(243, 1)).toBe(243);
    expect(quantizeWager(1_037, 100)).toBe(1_000);
    expect(quantizeWager(6_243, 500)).toBe(6_000);
    expect(24_925 % 25).toBe(0);
  });
});
