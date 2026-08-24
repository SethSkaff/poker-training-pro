import { describe, expect, it } from "vitest";
import type {
  LegalActionSet,
  PlayerInformationSet,
} from "../engine";
import type { Card } from "../types/poker";
import {
  NORMAL_OPPONENT_PROFILES,
  decideNormalAction,
  derivePublicExploitSignals,
  type NormalActionEvaluation,
  type PublicOpponentHistory,
} from "./normal";

function informationSet(
  opponentHoleCards?: readonly Card[],
  heroCards: readonly Card[] = [
    { rank: "K", suit: "clubs" },
    { rank: "Q", suit: "clubs" },
  ],
  board: readonly Card[] = [
    { rank: "A", suit: "clubs" },
    { rank: "9", suit: "clubs" },
    { rank: "4", suit: "diamonds" },
  ],
): PlayerInformationSet {
  return {
    handId: "normal-policy-hand-17",
    viewerId: "normal-ai",
    street: "flop",
    board: board.map((card) => ({ ...card })),
    pot: 5_400,
    currentBet: 1_200,
    actingPlayerId: "normal-ai",
    buttonSeat: 4,
    players: [
      {
        id: "normal-ai",
        name: "Rafael",
        seat: 0,
        stack: 18_600,
        status: "active",
        streetCommitted: 0,
        totalCommitted: 600,
        holeCards: heroCards.map((card) => ({ ...card })),
      },
      {
        id: "villain",
        name: "Player",
        seat: 4,
        stack: 24_100,
        status: "active",
        streetCommitted: 1_200,
        totalCommitted: 1_800,
        ...(opponentHoleCards
          ? { holeCards: opponentHoleCards.map((card) => ({ ...card })) }
          : {}),
      },
    ],
    actions: [
      { playerId: "villain", type: "raise", amount: 1_200 },
      { playerId: "normal-ai", type: "pending" },
    ],
  };
}

const legalActions: LegalActionSet = {
  playerId: "normal-ai",
  toCall: 1_200,
  check: false,
  fold: true,
  call: true,
  callAmount: 1_200,
  raise: { minTo: 3_600, maxTo: 18_600 },
  allIn: true,
  allInTo: 18_600,
  raisingReopened: true,
};

const drawEvaluations: readonly NormalActionEvaluation[] = [
  { command: { type: "call" }, estimatedEv: 160, purpose: "defense" },
  {
    command: { type: "raise", to: 3_600 },
    estimatedEv: 148,
    purpose: "semi-bluff",
  },
  { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
  {
    command: { type: "all-in" },
    estimatedEv: -500,
    purpose: "bluff",
  },
];

describe("Normal mode policy", () => {
  it("ships stable named personality vectors with 90–95% competence", () => {
    const profiles = Object.values(NORMAL_OPPONENT_PROFILES);

    expect(profiles.map((profile) => profile.id)).toEqual([
      "anchor",
      "tempo",
      "pressure",
      "mirror",
      "wide-lens",
    ]);
    expect(profiles).toHaveLength(5);
    for (const profile of profiles) {
      expect(profile.competenceRate).toBeGreaterThanOrEqual(0.9);
      expect(profile.competenceRate).toBeLessThanOrEqual(0.95);
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.personality)).toBe(true);
      for (const value of Object.values(profile.personality)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("samples actions deterministically from the explicit seed", () => {
    const input = {
      informationSet: informationSet(),
      legalActions,
      evaluations: drawEvaluations,
      profile: "pressure" as const,
      bigBlind: 200,
      seed: "repeatable-decision",
    };

    expect(decideNormalAction(input)).toEqual(decideNormalAction(input));
  });

  it("rejects fractional bet and raise targets before the engine sees them", () => {
    expect(() =>
      decideNormalAction({
        informationSet: informationSet(),
        legalActions,
        profile: "tempo",
        bigBlind: 200,
        seed: "fractional-bet",
        evaluations: [
          { command: { type: "raise", to: 3_600.5 }, estimatedEv: 1 },
        ],
      }),
    ).toThrow(/illegal action raise/);
  });

  it("is invariant to every opponent hidden-card change", () => {
    const first = decideNormalAction({
      informationSet: informationSet([
        { rank: "A", suit: "hearts" },
        { rank: "A", suit: "spades" },
      ]),
      legalActions,
      evaluations: drawEvaluations,
      profile: "mirror",
      bigBlind: 200,
      seed: "hidden-card-invariance",
    });
    const second = decideNormalAction({
      informationSet: informationSet([
        { rank: "7", suit: "diamonds" },
        { rank: "2", suit: "spades" },
      ]),
      legalActions,
      evaluations: drawEvaluations,
      profile: "mirror",
      bigBlind: 200,
      seed: "hidden-card-invariance",
    });

    expect(second).toEqual(first);
  });

  it("keeps every personality deviation inside its hard EV-loss budget", () => {
    let deviations = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const decision = decideNormalAction({
        informationSet: informationSet(),
        legalActions,
        evaluations: drawEvaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: `bounded-${index}`,
      });

      expect(decision.evLoss).toBeLessThanOrEqual(
        decision.evLossBudget + Number.EPSILON,
      );
      expect(decision.command.type).not.toBe("all-in");
      expect(decision.command.type).not.toBe("fold");
      if (decision.usedPersonalityDeviation) deviations += 1;
    }
    expect(deviations).toBeGreaterThan(0);
  });

  it("selects the highest-EV line 90–95% of the time while deviations stay coherent", () => {
    let bestActions = 0;
    let semiBluffs = 0;
    const sampleSize = 4_000;

    for (let index = 0; index < sampleSize; index += 1) {
      const decision = decideNormalAction({
        informationSet: informationSet(),
        legalActions,
        evaluations: drawEvaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: `competence-${index}`,
      });
      if (decision.selectedBestAction) bestActions += 1;
      else {
        semiBluffs += 1;
        expect(decision.purpose).toBe("semi-bluff");
      }
    }

    const bestRate = bestActions / sampleSize;
    expect(bestRate).toBeGreaterThanOrEqual(0.9);
    expect(bestRate).toBeLessThanOrEqual(0.95);
    expect(semiBluffs).toBeGreaterThan(0);
  });

  it("mixes bounded flats instead of automatically 3-betting a close-EV open", () => {
    const preflopInformationSet: PlayerInformationSet = {
      ...informationSet(),
      street: "preflop",
      board: [],
      pot: 1_800,
      actions: [
        { playerId: "villain", type: "raise", amount: 1_200 },
        { playerId: "normal-ai", type: "pending" },
      ],
    };
    const evaluations: readonly NormalActionEvaluation[] = [
      { command: { type: "raise", to: 3_600 }, estimatedEv: 160, purpose: "value" },
      { command: { type: "call" }, estimatedEv: 148, purpose: "defense" },
      { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
    ];
    let raises = 0;
    const sampleSize = 4_000;
    for (let index = 0; index < sampleSize; index += 1) {
      const decision = decideNormalAction({
        informationSet: preflopInformationSet,
        legalActions,
        evaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: `three-bet-mix-${index}`,
      });
      if (decision.command.type === "raise") raises += 1;
      expect(decision.evLoss).toBeLessThanOrEqual(
        decision.evLossBudget + Number.EPSILON,
      );
    }

    expect(raises / sampleSize).toBeGreaterThan(0.88);
    expect(raises / sampleSize).toBeLessThan(0.91);
  });

  it("does not suppress the best aggressive line once its stack reaches push-fold pressure", () => {
    const shallow = informationSet();
    shallow.street = "preflop";
    shallow.board = [];
    shallow.players = shallow.players.map((player) =>
      player.id === shallow.viewerId ? { ...player, stack: 4_000 } : player,
    );
    const evaluations: readonly NormalActionEvaluation[] = [
      { command: { type: "raise", to: 3_600 }, estimatedEv: 160, purpose: "value" },
      { command: { type: "call" }, estimatedEv: 148, purpose: "defense" },
    ];

    for (let index = 0; index < 250; index += 1) {
      const decision = decideNormalAction({
        informationSet: shallow,
        legalActions,
        evaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: `short-stack-pressure-${index}`,
      });
      expect(decision.command.type).toBe("raise");
      expect(decision.evLoss).toBe(0);
    }
  });

  it("does not invent a pure bluff without a draw, blocker, or public fold signal", () => {
    const dryInformationSet = informationSet(
      undefined,
      [
        { rank: "7", suit: "clubs" },
        { rank: "2", suit: "diamonds" },
      ],
      [
        { rank: "K", suit: "hearts" },
        { rank: "9", suit: "spades" },
        { rank: "4", suit: "clubs" },
      ],
    );
    const dryLegal: LegalActionSet = {
      ...legalActions,
      toCall: 0,
      check: true,
      call: false,
      callAmount: 0,
      bet: { min: 200, max: 18_600 },
      raise: undefined,
    };
    const dryEvaluations: readonly NormalActionEvaluation[] = [
      { command: { type: "check" }, estimatedEv: 10, purpose: "neutral" },
      {
        command: { type: "bet", to: 1_800 },
        estimatedEv: 4,
        purpose: "bluff",
      },
    ];

    for (let index = 0; index < 500; index += 1) {
      const decision = decideNormalAction({
        informationSet: dryInformationSet,
        legalActions: dryLegal,
        evaluations: dryEvaluations,
        profile: "mirror",
        bigBlind: 200,
        seed: `no-random-punt-${index}`,
      });
      expect(decision.command.type).toBe("check");
    }
  });

  it("shrinks public-history exploits until the sample is credible", () => {
    const looseFolder: PublicOpponentHistory = {
      playerId: "villain",
      handsObserved: 120,
      voluntaryEntries: 74,
      aggressiveActions: 46,
      passiveActions: 40,
      foldsFacingPressure: 55,
      pressureOpportunities: 72,
    };
    const tinySample: PublicOpponentHistory = {
      ...looseFolder,
      handsObserved: 2,
      voluntaryEntries: 2,
      aggressiveActions: 2,
      passiveActions: 0,
      foldsFacingPressure: 2,
      pressureOpportunities: 2,
    };

    const credible = derivePublicExploitSignals(informationSet(), [looseFolder]);
    const uncertain = derivePublicExploitSignals(informationSet(), [tinySample]);

    expect(credible.foldToPressure).toBeGreaterThan(0.65);
    expect(credible.looseness).toBeGreaterThan(0.55);
    expect(credible.confidence).toBe(1);
    expect(uncertain.confidence).toBeLessThan(0.1);
    expect(uncertain.foldToPressure).toBeLessThan(credible.foldToPressure);
  });

  it("turns credible public fold signals into bounded attack-frequency adaptation", () => {
    const looseFolder: PublicOpponentHistory = {
      playerId: "villain",
      handsObserved: 120,
      voluntaryEntries: 74,
      aggressiveActions: 46,
      passiveActions: 40,
      foldsFacingPressure: 55,
      pressureOpportunities: 72,
    };
    const tinySample: PublicOpponentHistory = {
      ...looseFolder,
      handsObserved: 2,
      voluntaryEntries: 2,
      aggressiveActions: 2,
      passiveActions: 0,
      foldsFacingPressure: 2,
      pressureOpportunities: 2,
    };
    let adaptedDeviations = 0;
    let unadaptedDeviations = 0;
    for (let index = 0; index < 2_000; index += 1) {
      const common = {
        informationSet: informationSet(),
        legalActions,
        evaluations: drawEvaluations,
        profile: "pressure" as const,
        bigBlind: 200,
        seed: `adaptation-${index}`,
      };
      const adapted = decideNormalAction({
        ...common,
        publicHistory: [looseFolder],
      });
      const unadapted = decideNormalAction({
        ...common,
        publicHistory: [tinySample],
      });
      if (adapted.usedPersonalityDeviation) adaptedDeviations += 1;
      if (unadapted.usedPersonalityDeviation) unadaptedDeviations += 1;
      expect(adapted.evLoss).toBeLessThanOrEqual(adapted.evLossBudget + Number.EPSILON);
    }

    expect(adaptedDeviations).toBeGreaterThan(unadaptedDeviations);
    expect(
      decideNormalAction({
        informationSet: informationSet(),
        legalActions,
        evaluations: drawEvaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: "adaptation-metric",
        publicHistory: [looseFolder],
      }).adaptationPressure,
    ).toBeGreaterThan(0.5);
  });
});
