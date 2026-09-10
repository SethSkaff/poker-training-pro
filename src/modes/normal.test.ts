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
  chipStep: 1,
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

/**
 * An unopened-pot shape with the evaluator's own error bars attached, which is
 * what production always supplies. The raise leads the flat by 220 chips while
 * the comparison carries roughly a 990-chip resolution, so the rollout has not
 * separated escalating from simply continuing.
 */
const tiedContinuationInformationSet: PlayerInformationSet = {
  ...informationSet(),
  street: "preflop",
  board: [],
  pot: 1_800,
  actions: [
    { playerId: "villain", type: "raise", amount: 1_200 },
    { playerId: "normal-ai", type: "pending" },
  ],
};

const tiedContinuationEvaluations: readonly NormalActionEvaluation[] = [
  {
    command: { type: "raise", to: 3_600 },
    estimatedEv: 340,
    uncertaintyChips: 820,
    purpose: "value",
  },
  {
    command: { type: "call" },
    estimatedEv: 120,
    uncertaintyChips: 560,
    purpose: "defense",
  },
  { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
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

  it("A12 exposes an exact Normal distribution without changing the selected action", () => {
    const input = {
      informationSet: informationSet(),
      legalActions,
      evaluations: drawEvaluations,
      profile: "pressure" as const,
      bigBlind: 200,
      seed: "selection-distribution-regression",
    };
    const decision = decideNormalAction(input);
    const total = decision.selectionDistribution.entries.reduce((sum, entry) => sum + entry.probability, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(decision.selectionDistribution.entries.map((entry) => entry.key)).toEqual([
      "call:",
      "raise:3600",
      "fold:",
      "all-in:",
    ]);
    expect(decision.selectionDistribution.bestActionKey).toBe("call:");
    expect(decision.selectionDistribution.deviationProbability).toBeGreaterThan(0);
    expect(decision.command).toEqual(decision.selectionDistribution.entries.find((entry) => entry.key === `${decision.command.type}:${decision.command.to ?? ""}`)?.command);
  });

  it("A12 records forced-best control flow as probability one", () => {
    const decision = decideNormalAction({
      informationSet: informationSet(),
      legalActions,
      evaluations: [
        { command: { type: "raise", to: 3_600 }, estimatedEv: 160, purpose: "value" },
        // Resolvably losing, so the tied-continuation mix cannot apply and the
        // high-leverage forcing branch is the only thing under test here.
        {
          command: { type: "call" },
          estimatedEv: -400,
          uncertaintyChips: 40,
          purpose: "defense",
        },
      ],
      profile: "pressure",
      bigBlind: 200,
      seed: "selection-forced-best",
    });
    expect(decision.selectionDistribution.bestForced).toBe(true);
    expect(decision.selectionDistribution.branch).toBe("forced-best");
    expect(decision.selectionDistribution.entries[0].probability).toBe(1);
    expect(decision.selectionDistribution.entries[1].probability).toBe(0);
  });

  it("does not let a display-name change alter the seeded policy result", () => {
    const originalInformation = informationSet();
    const renamedInformation = structuredClone(originalInformation);
    renamedInformation.players = renamedInformation.players.map((player) => ({
      ...player,
      name: player.id === renamedInformation.viewerId ? "Wesley" : "Arbitrary",
    }));
    const common = {
      legalActions,
      evaluations: drawEvaluations,
      profile: "pressure" as const,
      bigBlind: 200,
      seed: "display-name-invariance",
    };

    expect(
      decideNormalAction({ ...common, informationSet: renamedInformation }),
    ).toEqual(
      decideNormalAction({ ...common, informationSet: originalInformation }),
    );
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

  it("mixes a continuation the range model cannot separate from its aggressive best line", () => {
    // Production always supplies the evaluator's own error bar. Here the raise
    // leads the flat by 220 chips while the comparison carries a much larger
    // resolution, so the model has not separated the two lines and taking the
    // flat is a mix rather than a modeled mistake.
    let raises = 0;
    let flats = 0;
    const sampleSize = 4_000;
    for (let index = 0; index < sampleSize; index += 1) {
      const decision = decideNormalAction({
        informationSet: tiedContinuationInformationSet,
        legalActions,
        evaluations: tiedContinuationEvaluations,
        profile: "pressure",
        bigBlind: 200,
        seed: `tied-continuation-${index}`,
      });
      if (decision.command.type === "raise") raises += 1;
      if (decision.command.type === "call") {
        flats += 1;
        expect(decision.usedContinuationMix).toBe(true);
        expect(decision.modelResolution).toBeGreaterThan(0);
      }
      expect(decision.evLoss).toBeLessThanOrEqual(
        decision.evLossBudget + Number.EPSILON,
      );
      expect(decision.evLossBudget).toBeCloseTo(
        decision.profileEvLossBudget + decision.modelResolution,
        9,
      );
    }

    // A pressure profile still escalates the clear majority of the time, but it
    // is no longer a deterministic copy of the point argmax.
    expect(raises / sampleSize).toBeGreaterThan(0.5);
    expect(flats / sampleSize).toBeGreaterThan(0.15);
  });

  it("never mixes into a continuation the model has resolved as losing", () => {
    const evaluations: readonly NormalActionEvaluation[] = [
      {
        command: { type: "raise", to: 3_600 },
        estimatedEv: 380,
        uncertaintyChips: 700,
        purpose: "value",
      },
      // Below a fold's zero by far more than its own error bar: the rollout has
      // established that this call loses money, so no frequency may select it.
      {
        command: { type: "call" },
        estimatedEv: -900,
        uncertaintyChips: 300,
        purpose: "defense",
      },
      { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
    ];
    for (let index = 0; index < 2_000; index += 1) {
      const decision = decideNormalAction({
        informationSet: tiedContinuationInformationSet,
        legalActions,
        evaluations,
        profile: "wideLens",
        bigBlind: 200,
        seed: `resolved-losing-${index}`,
      });
      expect(decision.command.type).not.toBe("call");
      expect(decision.usedContinuationMix).toBe(false);
    }
  });

  it("keeps escalating when the edge is larger than the model can blur", () => {
    const evaluations: readonly NormalActionEvaluation[] = [
      {
        command: { type: "raise", to: 3_600 },
        estimatedEv: 4_000,
        uncertaintyChips: 60,
        purpose: "value",
      },
      {
        command: { type: "call" },
        estimatedEv: 120,
        uncertaintyChips: 60,
        purpose: "defense",
      },
      { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
    ];
    for (let index = 0; index < 2_000; index += 1) {
      const decision = decideNormalAction({
        informationSet: tiedContinuationInformationSet,
        legalActions,
        evaluations,
        profile: "anchor",
        bigBlind: 200,
        seed: `resolved-edge-${index}`,
      });
      expect(decision.command.type).toBe("raise");
    }
  });

  it("lets a patient profile continue more often than a pressure profile on the same tie", () => {
    const flatRate = (profile: "anchor" | "tempo" | "pressure"): number => {
      let flats = 0;
      const sampleSize = 3_000;
      for (let index = 0; index < sampleSize; index += 1) {
        const decision = decideNormalAction({
          informationSet: tiedContinuationInformationSet,
          legalActions,
          evaluations: tiedContinuationEvaluations,
          profile,
          bigBlind: 200,
          seed: `profile-order-${index}`,
        });
        if (decision.command.type === "call") flats += 1;
      }
      return flats / sampleSize;
    };
    const anchor = flatRate("anchor");
    const tempo = flatRate("tempo");
    const pressure = flatRate("pressure");
    expect(anchor).toBeGreaterThan(tempo);
    expect(tempo).toBeGreaterThan(pressure);
    // Every profile still mixes both ways; none of them is a quota.
    expect(pressure).toBeGreaterThan(0);
    expect(anchor).toBeLessThan(1);
  });

  it("keeps push-fold pressure on the aggressive best line even when the continuation ties", () => {
    const shallow: PlayerInformationSet = {
      ...tiedContinuationInformationSet,
      players: tiedContinuationInformationSet.players.map((player) =>
        player.id === tiedContinuationInformationSet.viewerId
          ? { ...player, stack: 4_000 }
          : player,
      ),
    };
    for (let index = 0; index < 500; index += 1) {
      const decision = decideNormalAction({
        informationSet: shallow,
        legalActions,
        evaluations: tiedContinuationEvaluations,
        profile: "anchor",
        bigBlind: 200,
        seed: `short-stack-tie-${index}`,
      });
      expect(decision.command.type).toBe("raise");
      expect(decision.usedContinuationMix).toBe(false);
    }
  });

  it("rejects a negative evaluator error bar before it can widen the tolerance", () => {
    expect(() =>
      decideNormalAction({
        informationSet: tiedContinuationInformationSet,
        legalActions,
        evaluations: [
          { command: { type: "call" }, estimatedEv: 10, uncertaintyChips: -1 },
        ],
        profile: "tempo",
        bigBlind: 200,
        seed: "negative-uncertainty",
      }),
    ).toThrow(/uncertainty/i);
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
