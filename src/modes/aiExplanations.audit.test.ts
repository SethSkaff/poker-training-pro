import { describe, expect, it } from "vitest";
import type {
  LegalActionSet,
  PlayerInformationSet,
} from "../engine";
import type { Card } from "../types/poker";
import {
  decideNormalAction,
  type NormalActionEvaluation,
} from "./normal";
import { decideRationalAction } from "./rational";

const heroCards: readonly Card[] = [
  { rank: "A", suit: "spades" },
  { rank: "K", suit: "hearts" },
];

const board: readonly Card[] = [
  { rank: "A", suit: "diamonds" },
  { rank: "9", suit: "clubs" },
  { rank: "4", suit: "spades" },
  { rank: "J", suit: "hearts" },
  { rank: "2", suit: "diamonds" },
];

function informationSet(
  opponentHoleCards?: readonly Card[],
): PlayerInformationSet {
  return {
    handId: "explanation-audit",
    viewerId: "hero",
    street: "river",
    board: board.map((card) => ({ ...card })),
    pot: 4_000,
    currentBet: 1_000,
    actingPlayerId: "hero",
    buttonSeat: 2,
    players: [
      {
        id: "hero",
        name: "Hero",
        seat: 5,
        stack: 8_000,
        status: "active",
        streetCommitted: 0,
        totalCommitted: 1_000,
        holeCards: heroCards.map((card) => ({ ...card })),
      },
      {
        id: "villain",
        name: "Villain",
        seat: 2,
        stack: 8_000,
        status: "active",
        streetCommitted: 1_000,
        totalCommitted: 2_000,
        ...(opponentHoleCards
          ? {
              holeCards: opponentHoleCards.map((card) => ({ ...card })),
            }
          : {}),
      },
    ],
    actions: [
      { playerId: "villain", type: "bet", amount: 1_000 },
    ],
  };
}

const legalActions: LegalActionSet = {
  playerId: "hero",
  toCall: 1_000,
  check: false,
  fold: true,
  call: true,
  callAmount: 1_000,
  raise: { minTo: 2_000, maxTo: 8_000 },
  allIn: true,
  allInTo: 8_000,
  raisingReopened: true,
};

const normalEvaluations: readonly NormalActionEvaluation[] = [
  { command: { type: "call" }, estimatedEv: 320, purpose: "defense" },
  {
    command: { type: "raise", to: 2_500 },
    estimatedEv: 285,
    purpose: "value",
  },
  { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
];

const categoricalClaims =
  /\b(?:always|certain(?:ly)?|correct move|guarantee(?:d|s)?|never|obviously|perfect play|wrong move)\b/i;

function normalDecision(selectedBestAction: boolean) {
  for (let seed = 0; seed < 500; seed += 1) {
    const decision = decideNormalAction({
      informationSet: informationSet(),
      legalActions,
      evaluations: normalEvaluations,
      profile: "pressure",
      bigBlind: 200,
      seed: `normal-explanation-${selectedBestAction}-${seed}`,
    });
    if (decision.selectedBestAction === selectedBestAction) return decision;
  }
  throw new Error(
    `Could not sample a Normal decision with selectedBestAction=${selectedBestAction}`,
  );
}

describe("AI explanation release-quality audit", () => {
  it("labels Rational output as an estimate and frequency, not certainty", () => {
    const decision = decideRationalAction({
      informationSet: informationSet(),
      legalActions,
      bigBlind: 200,
      seed: "rational-explanation-audit",
      simulations: 80,
    });

    expect(decision.audit.summary).toMatch(/\bestimated equity\b/i);
    expect(decision.audit.summary).toMatch(/\bhighest-frequency action\b/i);
    expect(decision.audit.summary).not.toMatch(categoricalClaims);
  });

  it("keeps Rational audit output free of hidden holdings and future cards", () => {
    const decision = decideRationalAction({
      informationSet: informationSet([
        { rank: "Q", suit: "clubs" },
        { rank: "Q", suit: "hearts" },
      ]),
      legalActions,
      bigBlind: 200,
      seed: "rational-hidden-copy-audit",
      simulations: 80,
    });
    const serialized = JSON.stringify(decision.audit);

    expect(serialized).not.toContain("holeCards");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toMatch(
      /"(?:deck|futureCards|futureDeck|opponentCards)"\s*:/i,
    );
    expect(serialized).not.toMatch(categoricalClaims);
  });

  it("qualifies Normal best actions as modeled range estimates", () => {
    const decision = normalDecision(true);

    expect(decision.reason).toMatch(/\bmodeled-EV\b/i);
    expect(decision.reason).toMatch(/\brange estimate\b/i);
    expect(decision.reason).not.toMatch(categoricalClaims);
  });

  it("attributes deviations only to own cards and public action history", () => {
    const decision = normalDecision(false);

    expect(decision.reason).toMatch(/\bits own hole-card texture\b/i);
    expect(decision.reason).toMatch(/\bpublic action history\b/i);
    expect(decision.reason).not.toMatch(/\bopponent(?:'s)? (?:cards|holding)\b/i);
    expect(decision.reason).not.toMatch(categoricalClaims);
  });
});
