import {
  HAND_CATEGORY,
  createSeededRandom,
  deriveSeed,
  evaluateBestHand,
  type BettingActionCommand,
  type DeckSeed,
  type LegalActionSet,
  type PlayerInformationSet,
} from "../engine";
import type { Card } from "../types/poker";

export type NormalActionPurpose =
  | "value"
  | "thin-value"
  | "semi-bluff"
  | "bluff"
  | "trap"
  | "defense"
  | "neutral";

export interface NormalActionEvaluation {
  command: BettingActionCommand;
  /** Chip EV calculated from the acting player's information set. */
  estimatedEv: number;
  purpose?: NormalActionPurpose;
}

export interface NormalPersonalityVector {
  aggression: number;
  looseness: number;
  riskTolerance: number;
  trapAppetite: number;
  bluffAppetite: number;
}

export interface NormalOpponentProfile {
  id: string;
  name: string;
  description: string;
  personality: NormalPersonalityVector;
  /**
   * Probability of taking the highest-EV action rather than a bounded,
   * strategically coherent personality deviation.
   */
  competenceRate: number;
  /** Hard maximum chip-EV sacrifice expressed in big blinds. */
  maxEvLossBb: number;
}

export interface PublicOpponentHistory {
  playerId: string;
  handsObserved: number;
  voluntaryEntries: number;
  aggressiveActions: number;
  passiveActions: number;
  foldsFacingPressure: number;
  pressureOpportunities: number;
}

export interface PublicExploitSignals {
  foldToPressure: number;
  aggression: number;
  looseness: number;
  confidence: number;
}

export interface NormalDecisionInput {
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
  evaluations: readonly NormalActionEvaluation[];
  profile: NormalOpponentProfile | keyof typeof NORMAL_OPPONENT_PROFILES;
  publicHistory?: readonly PublicOpponentHistory[];
  bigBlind: number;
  seed: DeckSeed;
  /** Defaults to the number of public actions in the information set. */
  decisionIndex?: number;
}

export interface NormalDecision {
  command: BettingActionCommand;
  purpose: NormalActionPurpose;
  estimatedEv: number;
  bestEv: number;
  evLoss: number;
  evLossBudget: number;
  profileId: string;
  selectedBestAction: boolean;
  usedPersonalityDeviation: boolean;
  reason: string;
  publicSignals: PublicExploitSignals;
  adaptationPressure: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function makeProfile(
  profile: NormalOpponentProfile,
): Readonly<NormalOpponentProfile> {
  const vector = profile.personality;
  for (const [name, value] of Object.entries(vector)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Normal profile ${profile.id} has invalid ${name}`);
    }
  }
  if (profile.competenceRate < 0.9 || profile.competenceRate > 0.95) {
    throw new Error(
      `Normal profile ${profile.id} competence must remain between 90% and 95%`,
    );
  }
  if (!Number.isFinite(profile.maxEvLossBb) || profile.maxEvLossBb < 0) {
    throw new Error(`Normal profile ${profile.id} has an invalid EV budget`);
  }
  return Object.freeze({
    ...profile,
    personality: Object.freeze({ ...profile.personality }),
  });
}

/**
 * Stable opponents. Their vectors do not drift hand-to-hand; adaptation comes
 * from public history signals, not from rerolling a personality.
 */
export const NORMAL_OPPONENT_PROFILES = Object.freeze({
  anchor: makeProfile({
    id: "anchor",
    name: "Adrian “Anchor” Cole",
    description:
      "Patient and disciplined. Prefers low-variance defenses and rarely spends EV on a bluff.",
    personality: {
      aggression: 0.3,
      looseness: 0.24,
      riskTolerance: 0.28,
      trapAppetite: 0.36,
      bluffAppetite: 0.14,
    },
    competenceRate: 0.95,
    maxEvLossBb: 0.1,
  }),
  tempo: makeProfile({
    id: "tempo",
    name: "Maya “Tempo” Chen",
    description:
      "Balanced and observant. Changes pace when public frequencies justify it.",
    personality: {
      aggression: 0.56,
      looseness: 0.48,
      riskTolerance: 0.52,
      trapAppetite: 0.42,
      bluffAppetite: 0.4,
    },
    competenceRate: 0.94,
    maxEvLossBb: 0.16,
  }),
  pressure: makeProfile({
    id: "pressure",
    name: "Rafael “Pressure” Torres",
    description:
      "Applies controlled pressure with value and credible semi-bluffs.",
    personality: {
      aggression: 0.86,
      looseness: 0.55,
      riskTolerance: 0.73,
      trapAppetite: 0.18,
      bluffAppetite: 0.62,
    },
    competenceRate: 0.92,
    maxEvLossBb: 0.26,
  }),
  mirror: makeProfile({
    id: "mirror",
    name: "Juno “Mirror” Pike",
    description:
      "Tricky but coherent. Uses blockers, traps, and observed fold pressure.",
    personality: {
      aggression: 0.63,
      looseness: 0.45,
      riskTolerance: 0.58,
      trapAppetite: 0.83,
      bluffAppetite: 0.72,
    },
    competenceRate: 0.91,
    maxEvLossBb: 0.3,
  }),
  wideLens: makeProfile({
    id: "wide-lens",
    name: "Lena “Wide Lens” Ortiz",
    description:
      "Defends wider than the field and realizes equity without punting stacks.",
    personality: {
      aggression: 0.57,
      looseness: 0.82,
      riskTolerance: 0.68,
      trapAppetite: 0.31,
      bluffAppetite: 0.48,
    },
    competenceRate: 0.9,
    maxEvLossBb: 0.32,
  }),
} as const);

function resolveProfile(
  profile: NormalDecisionInput["profile"],
): NormalOpponentProfile {
  return typeof profile === "string"
    ? NORMAL_OPPONENT_PROFILES[profile]
    : profile;
}

function safeRate(numerator: number, denominator: number, prior: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return prior;
  }
  // Twelve pseudo-observations keep tiny public samples from driving exploits.
  return clamp01((Math.max(0, numerator) + prior * 12) / (Math.max(0, denominator) + 12));
}

function historiesFromCurrentHand(
  informationSet: PlayerInformationSet,
): PublicOpponentHistory[] {
  const byPlayer = new Map<string, PublicOpponentHistory>();
  for (const player of informationSet.players) {
    if (player.id === informationSet.viewerId) continue;
    byPlayer.set(player.id, {
      playerId: player.id,
      handsObserved: 1,
      voluntaryEntries: 0,
      aggressiveActions: 0,
      passiveActions: 0,
      foldsFacingPressure: 0,
      pressureOpportunities: 0,
    });
  }

  for (const action of informationSet.actions) {
    const history = byPlayer.get(action.playerId);
    if (!history) continue;
    const type = action.type.toLowerCase();
    if (type === "bet" || type === "raise" || type === "all-in") {
      history.aggressiveActions += 1;
      history.voluntaryEntries += 1;
    } else if (type === "call" || type === "check") {
      history.passiveActions += 1;
      if (type === "call") history.voluntaryEntries += 1;
    } else if (type === "fold") {
      history.foldsFacingPressure += 1;
      history.pressureOpportunities += 1;
    }
  }

  return [...byPlayer.values()];
}

/**
 * Produces Bayesian-shrunk exploit signals from public action history only.
 * Hole cards, the remaining deck, burns, and RNG state are not inputs.
 */
export function derivePublicExploitSignals(
  informationSet: PlayerInformationSet,
  publicHistory?: readonly PublicOpponentHistory[],
): PublicExploitSignals {
  const histories =
    publicHistory && publicHistory.length > 0
      ? publicHistory.filter(
          (entry) => entry.playerId !== informationSet.viewerId,
        )
      : historiesFromCurrentHand(informationSet);

  if (histories.length === 0) {
    return {
      foldToPressure: 0.45,
      aggression: 0.42,
      looseness: 0.38,
      confidence: 0,
    };
  }

  let weightedFold = 0;
  let weightedAggression = 0;
  let weightedLooseness = 0;
  let totalWeight = 0;
  let observedHands = 0;

  for (const history of histories) {
    const hands = Math.max(0, history.handsObserved);
    const actionCount =
      Math.max(0, history.aggressiveActions) +
      Math.max(0, history.passiveActions);
    const weight = Math.max(1, Math.min(40, hands));
    weightedFold +=
      safeRate(
        history.foldsFacingPressure,
        history.pressureOpportunities,
        0.45,
      ) * weight;
    weightedAggression +=
      safeRate(history.aggressiveActions, actionCount, 0.42) * weight;
    weightedLooseness +=
      safeRate(history.voluntaryEntries, Math.max(1, hands), 0.38) * weight;
    totalWeight += weight;
    observedHands += hands;
  }

  return {
    foldToPressure: weightedFold / totalWeight,
    aggression: weightedAggression / totalWeight,
    looseness: weightedLooseness / totalWeight,
    confidence: clamp01(observedHands / (histories.length * 40)),
  };
}

const RANK_VALUE: Readonly<Record<Card["rank"], number>> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

interface PrivateHandSignals {
  showdownStrength: number;
  drawStrength: number;
  blockerStrength: number;
  strongMadeHand: boolean;
}

function straightDrawStrength(cards: readonly Card[]): number {
  const values = new Set(cards.map((card) => RANK_VALUE[card.rank]));
  if (values.has(14)) values.add(1);
  let best = 0;

  for (let low = 1; low <= 10; low += 1) {
    let present = 0;
    for (let rank = low; rank < low + 5; rank += 1) {
      if (values.has(rank)) present += 1;
    }
    if (present >= 4) best = Math.max(best, present === 5 ? 1 : 0.66);
    else if (present === 3) best = Math.max(best, 0.24);
  }
  return best;
}

function analyzePrivateHand(
  informationSet: PlayerInformationSet,
): PrivateHandSignals {
  const viewer = informationSet.players.find(
    (player) => player.id === informationSet.viewerId,
  );
  const holeCards = viewer?.holeCards?.slice(0, 2) ?? [];
  const knownCards = [...holeCards, ...informationSet.board];

  if (holeCards.length !== 2) {
    return {
      showdownStrength: 0,
      drawStrength: 0,
      blockerStrength: 0,
      strongMadeHand: false,
    };
  }

  const holeValues = holeCards
    .map((card) => RANK_VALUE[card.rank])
    .sort((left, right) => right - left);
  const pair = holeValues[0] === holeValues[1];
  const suited = holeCards[0].suit === holeCards[1].suit;
  const connected = Math.abs(holeValues[0] - holeValues[1]) <= 2;

  let showdownStrength = pair
    ? 0.46 + (holeValues[0] / 14) * 0.42
    : (holeValues[0] + holeValues[1]) / 34;
  if (suited) showdownStrength += 0.05;
  if (connected) showdownStrength += 0.04;

  let strongMadeHand = false;
  if (knownCards.length >= 5) {
    const value = evaluateBestHand(knownCards);
    showdownStrength = Math.max(
      showdownStrength,
      (value.category + 0.7) / (HAND_CATEGORY.STRAIGHT_FLUSH + 1),
    );
    strongMadeHand = value.category >= HAND_CATEGORY.TWO_PAIR;
  }

  const suitCounts = new Map<Card["suit"], number>();
  for (const card of knownCards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }
  const relevantSuitCounts = holeCards.map(
    (card) => suitCounts.get(card.suit) ?? 0,
  );
  const flushDraw = relevantSuitCounts.some((count) => count === 4) ? 0.82 : 0;
  const straightDraw = straightDrawStrength(knownCards);
  const drawStrength = Math.max(flushDraw, straightDraw);

  let blockerStrength = 0;
  for (const holeCard of holeCards) {
    const sameSuitOnBoard = informationSet.board.filter(
      (card) => card.suit === holeCard.suit,
    ).length;
    if (holeCard.rank === "A" && sameSuitOnBoard >= 2) blockerStrength = 1;
    else if (holeCard.rank === "K" && sameSuitOnBoard >= 2) {
      blockerStrength = Math.max(blockerStrength, 0.72);
    } else if (RANK_VALUE[holeCard.rank] >= 13) {
      blockerStrength = Math.max(blockerStrength, 0.36);
    }
  }

  return {
    showdownStrength: clamp01(showdownStrength),
    drawStrength,
    blockerStrength,
    strongMadeHand,
  };
}

function commandKey(command: BettingActionCommand): string {
  return `${command.type}:${command.to ?? ""}`;
}

function isAggressive(command: BettingActionCommand): boolean {
  return (
    command.type === "bet" ||
    command.type === "raise" ||
    command.type === "all-in"
  );
}

function assertLegalEvaluation(
  evaluation: NormalActionEvaluation,
  legal: LegalActionSet,
): void {
  if (!Number.isFinite(evaluation.estimatedEv)) {
    throw new Error("Normal action EVs must be finite numbers");
  }

  const { command } = evaluation;
  let valid = false;
  switch (command.type) {
    case "fold":
      valid = legal.fold;
      break;
    case "check":
      valid = legal.check;
      break;
    case "call":
      valid = legal.call;
      break;
    case "bet":
      valid =
        legal.bet !== undefined &&
        command.to !== undefined &&
        command.to >= legal.bet.min &&
        command.to <= legal.bet.max;
      break;
    case "raise":
      valid =
        legal.raise !== undefined &&
        command.to !== undefined &&
        command.to >= legal.raise.minTo &&
        command.to <= legal.raise.maxTo;
      break;
    case "all-in":
      valid =
        legal.allIn &&
        (command.to === undefined || command.to === legal.allInTo);
      break;
  }

  if (!valid) {
    throw new Error(`Evaluation contains illegal action ${commandKey(command)}`);
  }
}

function purposeAllowed(
  evaluation: NormalActionEvaluation,
  hand: PrivateHandSignals,
  publicSignals: PublicExploitSignals,
): boolean {
  const purpose = evaluation.purpose ?? "neutral";
  if (!isAggressive(evaluation.command)) return true;

  if (purpose === "semi-bluff") return hand.drawStrength >= 0.45;
  if (purpose === "bluff") {
    const credibleBlockerBluff =
      hand.blockerStrength >= 0.55 && publicSignals.foldToPressure >= 0.52;
    return hand.drawStrength >= 0.45 || credibleBlockerBluff;
  }
  if (purpose === "trap") {
    return hand.strongMadeHand || hand.showdownStrength >= 0.72;
  }
  if (purpose === "thin-value") return hand.showdownStrength >= 0.42;
  return true;
}

function candidateWeight(
  evaluation: NormalActionEvaluation,
  profile: NormalOpponentProfile,
  hand: PrivateHandSignals,
  signals: PublicExploitSignals,
  legal: LegalActionSet,
): number {
  const vector = profile.personality;
  const purpose = evaluation.purpose ?? "neutral";
  const command = evaluation.command;
  const pressure = clamp01(legal.toCall / Math.max(1, legal.allInTo));

  let weight = 0.2;
  if (command.type === "fold") {
    weight += (1 - vector.looseness) * 0.8 + pressure * (1 - vector.riskTolerance);
  } else if (command.type === "check" || command.type === "call") {
    weight += vector.looseness * 0.55 + (1 - vector.aggression) * 0.35;
  } else {
    weight += vector.aggression * 0.8 + vector.riskTolerance * 0.25;
  }

  if (purpose === "value") weight += vector.aggression * hand.showdownStrength;
  if (purpose === "thin-value") {
    weight += vector.riskTolerance * hand.showdownStrength * 0.7;
  }
  if (purpose === "semi-bluff") {
    weight +=
      vector.bluffAppetite * hand.drawStrength +
      signals.foldToPressure * signals.confidence * 0.45;
  }
  if (purpose === "bluff") {
    weight +=
      vector.bluffAppetite * 0.85 +
      hand.blockerStrength * 0.4 +
      signals.foldToPressure * signals.confidence * 0.65;
  }
  if (purpose === "trap") {
    const passive = command.type === "check" || command.type === "call";
    weight += passive ? vector.trapAppetite : 1 - vector.trapAppetite;
  }
  if (purpose === "defense") weight += vector.looseness * 0.6;

  return Math.max(0.01, weight);
}

function weightedChoice<T>(
  candidates: readonly T[],
  weight: (candidate: T) => number,
  random: () => number,
): T {
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: Math.max(0, weight(candidate)),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return candidates[0];

  let cursor = random() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.candidate;
  }
  return weighted[weighted.length - 1].candidate;
}

function publicDecisionSeed(
  input: NormalDecisionInput,
  profile: NormalOpponentProfile,
): string {
  const board = input.informationSet.board
    .map((card) => `${card.rank}-${card.suit}`)
    .join(",");
  return deriveSeed(
    input.seed,
    "normal-policy-v1",
    input.informationSet.handId,
    input.informationSet.viewerId,
    input.informationSet.street,
    board,
    input.decisionIndex ?? input.informationSet.actions.length,
    profile.id,
  );
}

/**
 * Selects a Normal-mode action from rational EV evaluations.
 *
 * The caller supplies evaluations produced only from the PlayerInformationSet.
 * This policy then adds stable personality and public-history adaptation. It
 * ignores every opponent hole-card property, so even a malformed projected
 * view cannot make the decision depend on hidden cards.
 */
export function decideNormalAction(input: NormalDecisionInput): NormalDecision {
  const profile = resolveProfile(input.profile);
  if (input.legalActions.playerId !== input.informationSet.viewerId) {
    throw new Error("Legal actions must belong to the information-set viewer");
  }
  if (input.informationSet.actingPlayerId !== undefined &&
      input.informationSet.actingPlayerId !== input.informationSet.viewerId) {
    throw new Error("Normal policy may act only for the information-set viewer");
  }
  if (!Number.isSafeInteger(input.bigBlind) || input.bigBlind <= 0) {
    throw new Error("Big blind must be a positive chip amount");
  }
  if (input.evaluations.length === 0) {
    throw new Error("Normal policy requires at least one action evaluation");
  }

  const seen = new Set<string>();
  for (const evaluation of input.evaluations) {
    assertLegalEvaluation(evaluation, input.legalActions);
    const key = commandKey(evaluation.command);
    if (seen.has(key)) throw new Error(`Duplicate action evaluation ${key}`);
    seen.add(key);
  }

  const ranked = [...input.evaluations].sort(
    (left, right) =>
      right.estimatedEv - left.estimatedEv ||
      commandKey(left.command).localeCompare(commandKey(right.command)),
  );
  const best = ranked[0];
  const bestEv = best.estimatedEv;
  // The EV budget bounds how far a personality may stray from the best line.
  //
  // E11-002 named a narrow budget as "Cause 4" -- the personality layer had
  // nothing to choose from. Measurement after fixing Causes 1-3 shows the
  // premise no longer holds the same way: the median gap to the second-best
  // action across the 36 canonical league cells is 1.05 BB, so widening the
  // budget far enough to manufacture deviations also admits genuine blunders
  // (at a 27 BB pot a pot-scaled budget admitted a 3.3 BB EV loss, and
  // profiles began folding and shoving where continuing is clearly right).
  //
  // A skilled professional facing clearly-separated options *should* take the
  // best line. Personality distinctness is therefore enforced directly, by
  // asserting the profiles differ from one another (see botLeague.test.ts),
  // rather than by inflating this budget until they diverge by accident.
  const hardBudget = profile.maxEvLossBb * input.bigBlind;
  const signals = derivePublicExploitSignals(
    input.informationSet,
    input.publicHistory,
  );
  const hand = analyzePrivateHand(input.informationSet);
  const random = createSeededRandom(publicDecisionSeed(input, profile));
  // Adaptation changes the *frequency* of bounded deviations, not the action
  // legality or the EV-loss ceiling. A credible folder/caller creates more
  // pressure opportunities for aggressive profiles; a noisy tiny sample does
  // almost nothing because confidence is Bayesian-shrunk above.
  const adaptationPressure = clamp01(
    signals.confidence *
      (signals.foldToPressure * profile.personality.aggression * 0.9 +
        signals.looseness * profile.personality.aggression * 0.35),
  );
  const deviationProbability = clamp01(
    (1 - profile.competenceRate) * (1 + adaptationPressure) +
      profile.personality.bluffAppetite * 0.025,
  );
  const useBest = random() >= deviationProbability;

  const deviations = ranked.slice(1).filter((evaluation) => {
    const loss = bestEv - evaluation.estimatedEv;
    return (
      loss >= 0 &&
      loss <= hardBudget + Number.EPSILON &&
      purposeAllowed(evaluation, hand, signals)
    );
  });

  const chosen =
    useBest || deviations.length === 0
      ? best
      : weightedChoice(
          deviations,
          (candidate) =>
            candidateWeight(
              candidate,
              profile,
              hand,
              signals,
              input.legalActions,
            ),
          random,
        );
  const evLoss = Math.max(0, bestEv - chosen.estimatedEv);
  const selectedBestAction = commandKey(chosen.command) === commandKey(best.command);
  const purpose = chosen.purpose ?? "neutral";

  return {
    command: { ...chosen.command },
    purpose,
    estimatedEv: chosen.estimatedEv,
    bestEv,
    evLoss,
    evLossBudget: hardBudget,
    profileId: profile.id,
    selectedBestAction,
    usedPersonalityDeviation: !selectedBestAction,
    reason: selectedBestAction
      ? `${profile.name} selected the highest modeled-EV line under its current range estimate.`
      : `${profile.name} used a bounded ${purpose} deviation supported by its own hole-card texture and public action history${adaptationPressure > 0.08 ? "; public pressure signals increased its attack frequency" : ""}.`,
    publicSignals: signals,
    adaptationPressure,
  };
}
