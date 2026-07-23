import type { Card } from "../types/poker";
import type {
  BettingActionCommand,
  BettingActionType,
  LegalActionSet,
} from "../engine/betting";
import {
  cardKey,
  createDeck,
  createSeededRandom,
  deriveSeed,
  type DeckSeed,
  type RandomSource,
} from "../engine/deck";
import {
  compareHandValues,
  evaluateBestHand,
  type HandValue,
} from "../engine/evaluator";
import type {
  HandActionRecord,
  PlayerInformationSet,
} from "../engine/tournament";

export interface RationalTournamentContext {
  playersRemaining: number;
  paidPlaces?: number;
  placesToQualification?: number;
  averageStack?: number;
  handForHand?: boolean;
  /** Explicit chip-EV risk premium, from 0 to 0.3. */
  riskPremium?: number;
}

export interface RationalPolicyInput {
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
  bigBlind: number;
  seed: DeckSeed;
  simulations?: number;
  /** Developer/runtime scheduling control; does not affect sampled outcomes. */
  equitySimulationsPerSlice?: number;
  tournament?: RationalTournamentContext;
  /** Higher values mix more; lower values concentrate on the best EV action. */
  temperature?: number;
}

export interface OpponentRangeSummary {
  opponentId: string;
  publicActions: number;
  aggression: number;
  estimatedTopRangePercent: number;
  weightedCombos: number;
  description: string;
}

export interface EquityEstimate {
  equity: number;
  wins: number;
  ties: number;
  losses: number;
  simulations: number;
  opponentRanges: OpponentRangeSummary[];
  work: EquityWorkMetrics;
}

export interface EquityWorkMetrics {
  workVersion: "range-equity-work-v1";
  requestedSimulations: number;
  completedSimulations: number;
  simulationsPerSlice: number;
  slices: number;
  handEvaluations: number;
  maximumSimulationsPerDecision: number;
  maximumSimulationsPerSlice: number;
  schedulingBasis: "completed-simulation-count";
}

export interface SlicedEquityOptions {
  simulationsPerSlice?: number;
  /**
   * Called only between deterministic simulation-count slices. Elapsed time is
   * never read and never influences the sample stream or policy result.
   */
  yieldControl?: () => Promise<void>;
}

export type RationalActionRole =
  | "fold"
  | "showdown"
  | "value"
  | "semi-bluff"
  | "bluff";

export interface RationalActionOption {
  id: string;
  command: BettingActionCommand;
  probability: number;
  utilityBigBlinds: number;
  foldEquity: number;
  role: RationalActionRole;
  rationale: string;
}

export interface RationalDecisionAudit {
  policyVersion: string;
  informationBoundary: string;
  equityWork: EquityWorkMetrics;
  metrics: {
    equity: number;
    potOdds: number;
    requiredEquity: number;
    equityEdge: number;
    effectiveStack: number;
    effectiveStackBigBlinds: number;
    stackToPotRatio: number;
    positionScore: number;
    inPosition: boolean;
    drawPotential: number;
    blockerScore: number;
  };
  adjustments: {
    tournamentRiskPremium: number;
    positionAdjustment: number;
    stackDepthAdjustment: number;
    sprAdjustment: number;
  };
  opponentRanges: OpponentRangeSummary[];
  actionEvaluations: Array<
    Pick<
      RationalActionOption,
      "id" | "utilityBigBlinds" | "foldEquity" | "role" | "rationale"
    >
  >;
  summary: string;
}

export interface RationalDecision {
  chosen: RationalActionOption;
  distribution: RationalActionOption[];
  audit: RationalDecisionAudit;
}

interface WeightedCombo {
  cards: readonly [Card, Card];
  weight: number;
}

interface CandidateAction {
  id: string;
  command: BettingActionCommand;
  additionalRisk: number;
}

interface PublicOpponent {
  id: string;
  holeCards?: Card[];
  status: "active" | "folded" | "all-in" | "out";
  stack: number;
  seat: number;
}

const POLICY_VERSION = "rational-v1";
const DEFAULT_SIMULATIONS = 700;
export const MAX_EQUITY_SIMULATIONS_PER_DECISION = 1_200;
export const MAX_EQUITY_SIMULATIONS_PER_SLICE = 32;
export const DEFAULT_EQUITY_SIMULATIONS_PER_SLICE = 16;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundChips(value: number, unit: number): number {
  return Math.max(unit, Math.round(value / unit) * unit);
}

function aggressionFor(actions: readonly HandActionRecord[], playerId: string): number {
  return actions
    .filter((action) => action.playerId === playerId)
    .reduce((score, action) => {
      const type = action.type.toLowerCase();
      if (type.includes("all")) return score + 1;
      if (type.includes("raise")) return score + 0.8;
      if (type.includes("bet")) return score + 0.55;
      if (type.includes("call")) return score + 0.15;
      return score;
    }, 0);
}

function preflopStrength([left, right]: readonly [Card, Card]): number {
  const high = Math.max(RANK_VALUE[left.rank], RANK_VALUE[right.rank]);
  const low = Math.min(RANK_VALUE[left.rank], RANK_VALUE[right.rank]);
  const pair = high === low;
  const suited = left.suit === right.suit;
  const gap = high - low;

  if (pair) return clamp(0.53 + (high / 14) * 0.45, 0, 1);

  let score = (high / 14) * 0.43 + (low / 14) * 0.22;
  if (suited) score += 0.1;
  if (gap === 1) score += 0.1;
  else if (gap === 2) score += 0.06;
  else if (gap === 3) score += 0.025;
  if (high === 14) score += 0.05;
  if (high >= 11 && low >= 10) score += 0.07;
  return clamp(score, 0.02, 0.98);
}

function madeHandStrength(combo: readonly [Card, Card], board: readonly Card[]): number {
  if (board.length < 3) return preflopStrength(combo);
  const value = evaluateBestHand([...combo, ...board]);
  const kicker = (value.tiebreak[0] ?? 0) / 14;
  return clamp(value.category / 8 + kicker * 0.08, 0, 1);
}

function drawPotential(cards: readonly Card[], board: readonly Card[]): number {
  if (board.length >= 5) return 0;
  const available = [...cards, ...board];
  const suitCounts = new Map<Card["suit"], number>();
  for (const card of available) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }
  const flushDraw = Math.max(...suitCounts.values()) >= 4 ? 0.28 : 0;

  const ranks = new Set(available.map((card) => RANK_VALUE[card.rank]));
  if (ranks.has(14)) ranks.add(1);
  let straightDraw = 0;
  for (let low = 1; low <= 10; low += 1) {
    let present = 0;
    for (let rank = low; rank < low + 5; rank += 1) {
      if (ranks.has(rank)) present += 1;
    }
    if (present === 4) straightDraw = Math.max(straightDraw, 0.22);
    else if (present === 3) straightDraw = Math.max(straightDraw, 0.08);
  }

  return clamp(flushDraw + straightDraw, 0, 0.45);
}

function blockerScore(heroCards: readonly Card[], board: readonly Card[]): number {
  const boardSuits = new Map<Card["suit"], number>();
  for (const card of board) {
    boardSuits.set(card.suit, (boardSuits.get(card.suit) ?? 0) + 1);
  }

  let score = 0;
  for (const card of heroCards) {
    const rank = RANK_VALUE[card.rank];
    if ((boardSuits.get(card.suit) ?? 0) >= 2 && rank >= 13) score += 0.18;
    if (rank === 14) score += 0.05;
    else if (rank === 13) score += 0.025;
  }
  return clamp(score, 0, 0.35);
}

function allTwoCardCombos(cards: readonly Card[]): Array<readonly [Card, Card]> {
  const combos: Array<readonly [Card, Card]> = [];
  for (let left = 0; left < cards.length - 1; left += 1) {
    for (let right = left + 1; right < cards.length; right += 1) {
      combos.push([cards[left], cards[right]]);
    }
  }
  return combos;
}

function buildRange(
  opponent: PublicOpponent,
  availableDeck: readonly Card[],
  board: readonly Card[],
  actions: readonly HandActionRecord[],
): { combos: WeightedCombo[]; summary: OpponentRangeSummary } {
  const aggression = aggressionFor(actions, opponent.id);
  const publicActions = actions.filter((action) => action.playerId === opponent.id)
    .length;
  const tightness = clamp(0.8 + aggression * 0.75, 0.8, 3.4);
  const rawCombos = allTwoCardCombos(availableDeck);
  const combos = rawCombos.map((cards) => {
    const starting = preflopStrength(cards);
    const made = madeHandStrength(cards, board);
    const draw = drawPotential(cards, board);
    const strategicStrength =
      board.length >= 3 ? made * 0.62 + starting * 0.18 + draw * 0.2 : starting;
    const valueWeight = Math.exp((strategicStrength - 0.48) * tightness * 2.2);
    // Preserve a low-frequency weak tail so aggression can represent bluffs.
    const bluffTail =
      aggression > 0
        ? 0.08 + draw * 0.5 + (1 - strategicStrength) * 0.04
        : 0.04;
    return { cards, weight: Math.max(0.0001, valueWeight + bluffTail) };
  });

  const topPercent = clamp(62 - aggression * 13 - publicActions * 2, 8, 72);
  return {
    combos,
    summary: {
      opponentId: opponent.id,
      publicActions,
      aggression: Number(aggression.toFixed(3)),
      estimatedTopRangePercent: Number(topPercent.toFixed(1)),
      weightedCombos: combos.length,
      description:
        aggression >= 1.2
          ? "Public aggression weights this range toward made hands, strong draws, and a protected bluff tail."
          : aggression > 0
            ? "Calls and modest aggression retain a medium-width range with value and drawing hands."
            : "With little public action, the estimate remains broad and position-neutral.",
    },
  };
}

function chooseWeightedAvailableCombo(
  combos: readonly WeightedCombo[],
  unavailable: Set<string>,
  random: RandomSource,
): readonly [Card, Card] {
  let total = 0;
  for (const combo of combos) {
    if (
      !unavailable.has(cardKey(combo.cards[0])) &&
      !unavailable.has(cardKey(combo.cards[1]))
    ) {
      total += combo.weight;
    }
  }
  if (total <= 0) throw new Error("No legal opponent combinations remain");

  let needle = random() * total;
  for (const combo of combos) {
    if (
      unavailable.has(cardKey(combo.cards[0])) ||
      unavailable.has(cardKey(combo.cards[1]))
    ) {
      continue;
    }
    needle -= combo.weight;
    if (needle <= 0) return combo.cards;
  }

  const fallback = combos.find(
    (combo) =>
      !unavailable.has(cardKey(combo.cards[0])) &&
      !unavailable.has(cardKey(combo.cards[1])),
  );
  if (!fallback) throw new Error("No legal fallback combination remains");
  return fallback.cards;
}

function sampleWithoutReplacement<T>(
  values: readonly T[],
  count: number,
  random: RandomSource,
): T[] {
  const pool = [...values];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, count);
}

function assertInformationSet(
  informationSet: PlayerInformationSet,
  legalActions: LegalActionSet,
): { heroCards: Card[]; opponents: PublicOpponent[] } {
  if (legalActions.playerId !== informationSet.viewerId) {
    throw new Error("Legal actions must belong to the information-set viewer");
  }
  const hero = informationSet.players.find(
    (player) => player.id === informationSet.viewerId,
  );
  if (!hero?.holeCards || hero.holeCards.length !== 2) {
    throw new Error("Rational policy requires exactly two visible hero cards");
  }
  const knownCards = [
    ...hero.holeCards,
    ...informationSet.board,
    ...informationSet.players.flatMap((player) =>
      player.id !== hero.id && player.revealed && player.holeCards
        ? player.holeCards
        : [],
    ),
  ];
  if (new Set(knownCards.map(cardKey)).size !== knownCards.length) {
    throw new Error("Visible information contains duplicate cards");
  }

  const opponents = informationSet.players
    .filter(
      (player) =>
        player.id !== hero.id &&
        player.status !== "folded" &&
        player.status !== "out",
    )
    .map((player) => ({
      id: player.id,
      status: player.status,
      stack: player.stack,
      seat: player.seat,
      holeCards:
        player.revealed && player.holeCards
          ? player.holeCards.map((card) => ({ ...card }))
          : undefined,
    }));
  if (opponents.length === 0) {
    throw new Error("Rational policy requires at least one live opponent");
  }
  return {
    heroCards: hero.holeCards.map((card) => ({ ...card })),
    opponents,
  };
}

interface RangeEquityWorkState {
  informationSet: PlayerInformationSet;
  heroCards: Card[];
  opponents: PublicOpponent[];
  ranges: Map<
    string,
    { combos: WeightedCombo[]; summary: OpponentRangeSummary }
  >;
  random: RandomSource;
  simulations: number;
  simulationsPerSlice: number;
  completed: number;
  slices: number;
  wins: number;
  ties: number;
  losses: number;
  equityPoints: number;
}

function validateEquityWorkBudget(
  simulations: number,
  simulationsPerSlice: number,
): void {
  if (
    !Number.isInteger(simulations) ||
    simulations < 50 ||
    simulations > MAX_EQUITY_SIMULATIONS_PER_DECISION
  ) {
    throw new Error(
      `Equity simulations must be an integer from 50 to ${MAX_EQUITY_SIMULATIONS_PER_DECISION}`,
    );
  }
  if (
    !Number.isInteger(simulationsPerSlice) ||
    simulationsPerSlice < 1 ||
    simulationsPerSlice > MAX_EQUITY_SIMULATIONS_PER_SLICE
  ) {
    throw new Error(
      `Equity simulations per slice must be an integer from 1 to ${MAX_EQUITY_SIMULATIONS_PER_SLICE}`,
    );
  }
}

function createRangeEquityWork(
  informationSet: PlayerInformationSet,
  legalActions: LegalActionSet,
  seed: DeckSeed,
  simulations: number,
  simulationsPerSlice: number,
): RangeEquityWorkState {
  validateEquityWorkBudget(simulations, simulationsPerSlice);
  // An async caller may advance the tournament while work is yielding. Freeze
  // the public information snapshot so external mutation cannot alter later
  // samples in the same seeded request.
  const stableInformationSet = structuredClone(informationSet);
  const { heroCards, opponents } = assertInformationSet(
    stableInformationSet,
    legalActions,
  );
  const known = new Set([
    ...heroCards.map(cardKey),
    ...stableInformationSet.board.map(cardKey),
    ...opponents.flatMap((opponent) =>
      opponent.holeCards?.map(cardKey) ?? [],
    ),
  ]);
  const unknownDeck = createDeck().filter((card) => !known.has(cardKey(card)));
  const ranges = new Map<
    string,
    { combos: WeightedCombo[]; summary: OpponentRangeSummary }
  >();
  for (const opponent of opponents) {
    if (!opponent.holeCards) {
      ranges.set(
        opponent.id,
        buildRange(
          opponent,
          unknownDeck,
          stableInformationSet.board,
          stableInformationSet.actions,
        ),
      );
    }
  }

  return {
    informationSet: stableInformationSet,
    heroCards,
    opponents,
    ranges,
    random: createSeededRandom(
      deriveSeed(seed, POLICY_VERSION, stableInformationSet.handId, "equity"),
    ),
    simulations,
    simulationsPerSlice,
    completed: 0,
    slices: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    equityPoints: 0,
  };
}

function advanceRangeEquityWork(state: RangeEquityWorkState): void {
  if (state.completed >= state.simulations) return;
  const stop = Math.min(
    state.simulations,
    state.completed + state.simulationsPerSlice,
  );
  while (state.completed < stop) {
    const unavailable = new Set([
      ...state.heroCards.map(cardKey),
      ...state.informationSet.board.map(cardKey),
    ]);
    const opponentCards = new Map<string, readonly [Card, Card]>();

    for (const opponent of state.opponents) {
      let combo: readonly [Card, Card];
      if (opponent.holeCards) {
        combo = [opponent.holeCards[0], opponent.holeCards[1]];
      } else {
        const range = state.ranges.get(opponent.id);
        if (!range) throw new Error("Missing opponent range");
        combo = chooseWeightedAvailableCombo(
          range.combos,
          unavailable,
          state.random,
        );
      }
      opponentCards.set(opponent.id, combo);
      unavailable.add(cardKey(combo[0]));
      unavailable.add(cardKey(combo[1]));
    }

    const runout = sampleWithoutReplacement(
      createDeck().filter((card) => !unavailable.has(cardKey(card))),
      5 - state.informationSet.board.length,
      state.random,
    );
    const board = [...state.informationSet.board, ...runout];
    const heroValue = evaluateBestHand([...state.heroCards, ...board]);
    const values: Array<{ id: string; value: HandValue }> = [
      { id: state.informationSet.viewerId, value: heroValue },
      ...state.opponents.map((opponent) => ({
        id: opponent.id,
        value: evaluateBestHand([
          ...(opponentCards.get(opponent.id) as readonly [Card, Card]),
          ...board,
        ]),
      })),
    ];
    const best = values.reduce((leader, candidate) =>
      compareHandValues(candidate.value, leader.value) > 0 ? candidate : leader,
    );
    const winners = values.filter(
      (candidate) => compareHandValues(candidate.value, best.value) === 0,
    );
    if (
      !winners.some(
        (winner) => winner.id === state.informationSet.viewerId,
      )
    ) {
      state.losses += 1;
    } else if (winners.length === 1) {
      state.wins += 1;
      state.equityPoints += 1;
    } else {
      state.ties += 1;
      state.equityPoints += 1 / winners.length;
    }
    state.completed += 1;
  }
  state.slices += 1;
}

function finishRangeEquityWork(state: RangeEquityWorkState): EquityEstimate {
  if (state.completed !== state.simulations) {
    throw new Error(
      `Equity work is incomplete (${state.completed}/${state.simulations}).`,
    );
  }
  return {
    equity: state.equityPoints / state.simulations,
    wins: state.wins,
    ties: state.ties,
    losses: state.losses,
    simulations: state.simulations,
    opponentRanges: state.opponents.map((opponent) => {
      const range = state.ranges.get(opponent.id);
      return (
        range?.summary ?? {
          opponentId: opponent.id,
          publicActions: state.informationSet.actions.filter(
            (action) => action.playerId === opponent.id,
          ).length,
          aggression: aggressionFor(
            state.informationSet.actions,
            opponent.id,
          ),
          estimatedTopRangePercent: 0,
          weightedCombos: 1,
          description: "The hand is publicly revealed, so no hidden range is inferred.",
        }
      );
    }),
    work: {
      workVersion: "range-equity-work-v1",
      requestedSimulations: state.simulations,
      completedSimulations: state.completed,
      simulationsPerSlice: state.simulationsPerSlice,
      slices: state.slices,
      handEvaluations:
        state.completed * (state.opponents.length + 1),
      maximumSimulationsPerDecision:
        MAX_EQUITY_SIMULATIONS_PER_DECISION,
      maximumSimulationsPerSlice: MAX_EQUITY_SIMULATIONS_PER_SLICE,
      schedulingBasis: "completed-simulation-count",
    },
  };
}

export function estimateRangeEquity(
  informationSet: PlayerInformationSet,
  legalActions: LegalActionSet,
  seed: DeckSeed,
  simulations = DEFAULT_SIMULATIONS,
  options: Pick<SlicedEquityOptions, "simulationsPerSlice"> = {},
): EquityEstimate {
  const state = createRangeEquityWork(
    informationSet,
    legalActions,
    seed,
    simulations,
    options.simulationsPerSlice ?? DEFAULT_EQUITY_SIMULATIONS_PER_SLICE,
  );
  while (state.completed < state.simulations) advanceRangeEquityWork(state);
  return finishRangeEquityWork(state);
}

export async function estimateRangeEquitySliced(
  informationSet: PlayerInformationSet,
  legalActions: LegalActionSet,
  seed: DeckSeed,
  simulations = DEFAULT_SIMULATIONS,
  options: SlicedEquityOptions = {},
): Promise<EquityEstimate> {
  const state = createRangeEquityWork(
    informationSet,
    legalActions,
    seed,
    simulations,
    options.simulationsPerSlice ?? DEFAULT_EQUITY_SIMULATIONS_PER_SLICE,
  );
  const yieldControl =
    options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  while (state.completed < state.simulations) {
    advanceRangeEquityWork(state);
    if (state.completed < state.simulations) await yieldControl();
  }
  return finishRangeEquityWork(state);
}

function positionScore(informationSet: PlayerInformationSet): number {
  const active = informationSet.players.filter(
    (player) => player.status !== "folded" && player.status !== "out",
  );
  if (active.length <= 1) return 1;
  const tableSize = Math.max(
    informationSet.buttonSeat,
    ...informationSet.players.map((player) => player.seat),
  );
  const order = [...active].sort((left, right) => {
    const leftDistance =
      (left.seat - informationSet.buttonSeat + tableSize) % tableSize || tableSize;
    const rightDistance =
      (right.seat - informationSet.buttonSeat + tableSize) % tableSize || tableSize;
    return leftDistance - rightDistance;
  });
  const heroIndex = order.findIndex(
    (player) => player.id === informationSet.viewerId,
  );
  return clamp(heroIndex / (order.length - 1), 0, 1);
}

function tournamentRiskPremium(
  context: RationalTournamentContext | undefined,
  heroStack: number,
): number {
  if (!context) return 0;
  if (context.riskPremium !== undefined) {
    return clamp(context.riskPremium, 0, 0.3);
  }

  let premium = context.handForHand ? 0.055 : 0;
  if (
    context.paidPlaces !== undefined &&
    context.playersRemaining > context.paidPlaces
  ) {
    const bubbleDistance = context.playersRemaining - context.paidPlaces;
    if (bubbleDistance <= 2) premium += 0.07;
    else if (bubbleDistance <= 5) premium += 0.035;
  }
  if (context.placesToQualification !== undefined) {
    if (context.placesToQualification <= 1) premium += 0.07;
    else if (context.placesToQualification <= 3) premium += 0.04;
  }
  if (context.averageStack && heroStack < context.averageStack * 0.6) {
    // Very short stacks cannot wait forever; reduce excessive bubble folding.
    premium *= 0.72;
  }
  return clamp(premium, 0, 0.22);
}

function addCandidate(
  map: Map<string, CandidateAction>,
  command: BettingActionCommand,
  additionalRisk: number,
): void {
  const id = command.to === undefined ? command.type : `${command.type}:${command.to}`;
  map.set(id, { id, command, additionalRisk });
}

function buildCandidates(
  informationSet: PlayerInformationSet,
  legal: LegalActionSet,
  bigBlind: number,
): CandidateAction[] {
  const hero = informationSet.players.find(
    (player) => player.id === informationSet.viewerId,
  );
  if (!hero) throw new Error("Hero is missing");
  const candidates = new Map<string, CandidateAction>();

  if (legal.fold) addCandidate(candidates, { type: "fold" }, 0);
  if (legal.check) addCandidate(candidates, { type: "check" }, 0);
  if (legal.call) {
    addCandidate(candidates, { type: "call" }, legal.callAmount);
  }

  if (legal.bet) {
    const desired = [0.33, 0.66, 1].map((fraction) =>
      clamp(
        roundChips(informationSet.pot * fraction, Math.max(1, bigBlind / 4)),
        legal.bet?.min ?? 0,
        legal.bet?.max ?? 0,
      ),
    );
    for (const to of new Set([legal.bet.min, ...desired, legal.bet.max])) {
      addCandidate(
        candidates,
        { type: "bet", to },
        Math.max(0, to - hero.streetCommitted),
      );
    }
  }

  if (legal.raise) {
    const potAfterCall = informationSet.pot + legal.toCall;
    const desired = [0.5, 0.8, 1.1].map((fraction) =>
      clamp(
        roundChips(
          informationSet.currentBet + potAfterCall * fraction,
          Math.max(1, bigBlind / 4),
        ),
        legal.raise?.minTo ?? 0,
        legal.raise?.maxTo ?? 0,
      ),
    );
    for (const to of new Set([legal.raise.minTo, ...desired, legal.raise.maxTo])) {
      addCandidate(
        candidates,
        { type: "raise", to },
        Math.max(0, to - hero.streetCommitted),
      );
    }
  }

  if (legal.allIn) {
    const callConsumesStack = legal.allInTo <= informationSet.currentBet;
    const duplicatesExisting = [...candidates.values()].some(
      (candidate) => candidate.command.to === legal.allInTo,
    );
    if (!callConsumesStack && !duplicatesExisting) {
      addCandidate(
        candidates,
        { type: "all-in" },
        Math.max(0, legal.allInTo - hero.streetCommitted),
      );
    }
  }

  return [...candidates.values()];
}

function foldEquityFor(
  candidate: CandidateAction,
  informationSet: PlayerInformationSet,
  ranges: readonly OpponentRangeSummary[],
  position: number,
): number {
  if (!["bet", "raise", "all-in"].includes(candidate.command.type)) return 0;
  const opponents = informationSet.players.filter(
    (player) =>
      player.id !== informationSet.viewerId &&
      player.status !== "folded" &&
      player.status !== "out" &&
      player.status !== "all-in",
  );
  if (opponents.length === 0) return 0;

  const sizeRatio =
    candidate.additionalRisk /
    Math.max(1, informationSet.pot + candidate.additionalRisk);
  let everyoneFolds = 1;
  for (const opponent of opponents) {
    const range = ranges.find((entry) => entry.opponentId === opponent.id);
    const aggressionResistance = clamp((range?.aggression ?? 0) * 0.045, 0, 0.16);
    const singleFold = clamp(
      0.16 + sizeRatio * 0.62 + position * 0.07 - aggressionResistance,
      0.06,
      0.78,
    );
    everyoneFolds *= singleFold;
  }
  return clamp(everyoneFolds, 0, 0.82);
}

function actionRole(
  candidate: CandidateAction,
  equity: number,
  potOdds: number,
  draw: number,
  blockers: number,
): RationalActionRole {
  if (candidate.command.type === "fold") return "fold";
  if (candidate.command.type === "check" || candidate.command.type === "call") {
    return "showdown";
  }
  if (equity >= Math.max(0.58, potOdds + 0.16)) return "value";
  if (draw >= 0.16) return "semi-bluff";
  if (blockers >= 0.08 || equity < potOdds + 0.08) return "bluff";
  return "value";
}

function rationaleFor(
  candidate: CandidateAction,
  role: RationalActionRole,
  equity: number,
  requiredEquity: number,
  foldEquity: number,
  spr: number,
): string {
  const edge = equity - requiredEquity;
  if (role === "fold") {
    return edge < 0
      ? `Estimated equity trails the risk-adjusted calling threshold by ${Math.abs(edge * 100).toFixed(1)} points.`
      : "Folding preserves chips, but the modeled equity makes it a low-frequency option.";
  }
  if (candidate.command.type === "check") {
    return "Checking realizes equity without adding chips and protects the checking range.";
  }
  if (candidate.command.type === "call") {
    return `Calling compares ${(equity * 100).toFixed(1)}% range equity with a ${(requiredEquity * 100).toFixed(1)}% risk-adjusted threshold.`;
  }
  if (role === "value") {
    return `Value aggression leverages the equity edge at ${spr.toFixed(1)} SPR; modeled immediate fold equity is ${(foldEquity * 100).toFixed(1)}%.`;
  }
  if (role === "semi-bluff") {
    return `The hand retains draw equity while fold equity of ${(foldEquity * 100).toFixed(1)}% can win the pot immediately.`;
  }
  return `This is a mathematically mixed bluff supported by blockers/range pressure and ${(foldEquity * 100).toFixed(1)}% modeled fold equity.`;
}

function scoreCandidates(
  candidates: readonly CandidateAction[],
  informationSet: PlayerInformationSet,
  equity: number,
  potOdds: number,
  riskPremium: number,
  effectiveStack: number,
  bigBlind: number,
  position: number,
  draw: number,
  blockers: number,
  ranges: readonly OpponentRangeSummary[],
): Array<Omit<RationalActionOption, "probability">> {
  const requiredEquity = clamp(potOdds + riskPremium, 0, 0.98);
  const spr = effectiveStack / Math.max(1, informationSet.pot);
  const equityEdge = equity - requiredEquity;

  return candidates.map((candidate) => {
    const type = candidate.command.type;
    const foldEquity = foldEquityFor(
      candidate,
      informationSet,
      ranges,
      position,
    );
    const role = actionRole(candidate, equity, potOdds, draw, blockers);
    let chipUtility = 0;

    if (type === "fold") {
      chipUtility = 0;
      if (informationSet.currentBet === 0) chipUtility -= bigBlind * 2;
    } else if (type === "check") {
      chipUtility =
        equity * informationSet.pot +
        position * bigBlind * 0.12 +
        (1 - Math.min(1, draw)) * bigBlind * 0.03;
    } else if (type === "call") {
      const call = candidate.additionalRisk;
      chipUtility =
        equity * (informationSet.pot + call) -
        call -
        riskPremium * call * 1.8 +
        position * bigBlind * 0.08;
    } else {
      const wager = candidate.additionalRisk;
      const calledEquity = clamp(
        equity * (role === "bluff" ? 0.82 : 0.91) + draw * 0.05,
        0,
        1,
      );
      const calledPot = informationSet.pot + wager * 2;
      chipUtility =
        foldEquity * informationSet.pot +
        (1 - foldEquity) * (calledEquity * calledPot - wager);
      chipUtility -= riskPremium * wager * (1.4 + Math.min(1, wager / Math.max(1, effectiveStack)));
      chipUtility += position * bigBlind * 0.1;
      if (role === "bluff") {
        chipUtility += blockers * bigBlind * 0.8 + draw * bigBlind * 0.5;
      }
      if (spr <= 2 && equity >= 0.55) chipUtility += bigBlind * 0.35;
      if (spr >= 8 && wager > informationSet.pot && equity < 0.7) {
        chipUtility -= bigBlind * 0.5;
      }
    }

    // Reward continuing only when range equity clears the relevant threshold.
    if (type === "call") chipUtility += equityEdge * bigBlind * 1.2;
    const utilityBigBlinds = chipUtility / bigBlind;
    return {
      id: candidate.id,
      command: { ...candidate.command },
      utilityBigBlinds,
      foldEquity,
      role,
      rationale: rationaleFor(
        candidate,
        role,
        equity,
        requiredEquity,
        foldEquity,
        spr,
      ),
    };
  });
}

function normalizedDistribution(
  scored: readonly Omit<RationalActionOption, "probability">[],
  temperature: number,
): RationalActionOption[] {
  if (scored.length === 0) throw new Error("No legal rational actions available");
  const maxUtility = Math.max(...scored.map((option) => option.utilityBigBlinds));
  const scale = clamp(temperature, 0.08, 3);
  const weights = scored.map((option) =>
    Math.max(1e-8, Math.exp((option.utilityBigBlinds - maxUtility) / scale)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const distribution = scored.map((option, index) => ({
    ...option,
    probability: weights[index] / total,
  }));
  const correction =
    1 - distribution.reduce((sum, option) => sum + option.probability, 0);
  distribution[distribution.length - 1].probability += correction;
  return distribution;
}

function sampleAction(
  distribution: readonly RationalActionOption[],
  seed: DeckSeed,
  handId: string,
  viewerId: string,
): RationalActionOption {
  const random = createSeededRandom(
    deriveSeed(seed, POLICY_VERSION, handId, viewerId, "action"),
  );
  let needle = random();
  for (const option of distribution) {
    needle -= option.probability;
    if (needle <= 0) return { ...option, command: { ...option.command } };
  }
  const fallback = distribution[distribution.length - 1];
  return { ...fallback, command: { ...fallback.command } };
}

function actionLabel(type: BettingActionType): string {
  return type === "all-in" ? "all-in" : type;
}

export function decideRationalAction(input: RationalPolicyInput): RationalDecision {
  if (!Number.isSafeInteger(input.bigBlind) || input.bigBlind <= 0) {
    throw new Error("Big blind must be a positive safe integer");
  }
  const { informationSet, legalActions } = input;
  const { heroCards, opponents } = assertInformationSet(
    informationSet,
    legalActions,
  );
  const hero = informationSet.players.find(
    (player) => player.id === informationSet.viewerId,
  );
  if (!hero) throw new Error("Hero is missing");
  const equity = estimateRangeEquity(
    informationSet,
    legalActions,
    input.seed,
    input.simulations ?? DEFAULT_SIMULATIONS,
    { simulationsPerSlice: input.equitySimulationsPerSlice },
  );
  const potOdds =
    legalActions.toCall > 0
      ? legalActions.toCall /
        Math.max(1, informationSet.pot + legalActions.toCall)
      : 0;
  const riskPremium = tournamentRiskPremium(input.tournament, hero.stack);
  const requiredEquity = clamp(potOdds + riskPremium, 0, 0.98);
  const effectiveStack = Math.min(
    hero.stack,
    Math.max(...opponents.map((opponent) => opponent.stack)),
  );
  const effectiveStackBigBlinds = effectiveStack / input.bigBlind;
  const spr = effectiveStack / Math.max(1, informationSet.pot);
  const position = positionScore(informationSet);
  const draw = drawPotential(heroCards, informationSet.board);
  const blockers = blockerScore(heroCards, informationSet.board);
  const candidates = buildCandidates(
    informationSet,
    legalActions,
    input.bigBlind,
  );
  const scored = scoreCandidates(
    candidates,
    informationSet,
    equity.equity,
    potOdds,
    riskPremium,
    effectiveStack,
    input.bigBlind,
    position,
    draw,
    blockers,
    equity.opponentRanges,
  );
  const distribution = normalizedDistribution(
    scored,
    input.temperature ?? 0.48,
  );
  const chosen = sampleAction(
    distribution,
    input.seed,
    informationSet.handId,
    informationSet.viewerId,
  );
  const best = [...distribution].sort(
    (left, right) => right.probability - left.probability,
  )[0];

  return {
    chosen,
    distribution,
    audit: {
      policyVersion: POLICY_VERSION,
      informationBoundary:
        "Uses only the viewer's hole cards, public board/actions/stacks, legal actions, and tournament context. Opponent cards and future deck state are not accepted by this policy contract.",
      equityWork: equity.work,
      metrics: {
        equity: equity.equity,
        potOdds,
        requiredEquity,
        equityEdge: equity.equity - requiredEquity,
        effectiveStack,
        effectiveStackBigBlinds,
        stackToPotRatio: spr,
        positionScore: position,
        inPosition: position >= 0.67,
        drawPotential: draw,
        blockerScore: blockers,
      },
      adjustments: {
        tournamentRiskPremium: riskPremium,
        positionAdjustment: (position - 0.5) * 0.04,
        stackDepthAdjustment:
          effectiveStackBigBlinds <= 12
            ? 0.04
            : effectiveStackBigBlinds >= 80
              ? -0.025
              : 0,
        sprAdjustment: spr <= 2 ? 0.04 : spr >= 8 ? -0.025 : 0,
      },
      opponentRanges: equity.opponentRanges,
      actionEvaluations: distribution.map(
        ({ id, utilityBigBlinds, foldEquity, role, rationale }) => ({
          id,
          utilityBigBlinds,
          foldEquity,
          role,
          rationale,
        }),
      ),
      summary: `${actionLabel(best.command.type)} is the highest-frequency action at ${(best.probability * 100).toFixed(0)}%; estimated equity is ${(equity.equity * 100).toFixed(1)}% versus a ${(requiredEquity * 100).toFixed(1)}% risk-adjusted threshold.`,
    },
  };
}
