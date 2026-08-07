import type { Card } from "../types/poker";
import { formatFixedDecimal, formatPercentage } from "../lib/format";
import type {
  BettingActionCommand,
  BettingActionType,
  LegalActionSet,
} from "../engine/betting";
import {
  assertUniqueCards,
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
    /** Public, opportunity-based pressure score used by the action model. */
    pressureOpportunity: number;
    /** Count of aggressive actions already visible on this street. */
    streetAggression: number;
    /** Whether a pure bluff has a public/private-information justification. */
    boundedBluffOpportunity: number;
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

interface PublicPressureContext {
  activeOpponents: number;
  position: number;
  streetAggression: number;
  preflopAggression: number;
  viewerWasPreflopAggressor: boolean;
  opponentsActedThisStreet: number;
  cappedOpponents: number;
  latePositionOpen: number;
  threeBetOpportunity: number;
  squeezeOpportunity: number;
  continuationOpportunity: number;
  delayedProbeOpportunity: number;
  stackPressure: number;
  lowSprValuePressure: number;
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
  // Snap to the requested increment, then force a whole-chip amount. When the
  // sizing unit is fractional (e.g. bigBlind/4 with a 50-chip big blind) the
  // snapped value can be a half-chip like 187.5; the engine only accepts safe
  // integer targets, so an unrounded value would produce an illegal bet/raise
  // that trips `requireTarget`. Rounding here is a no-op whenever `unit` is a
  // whole number (the snapped value is already integral), so decision cells
  // that already used integer sizing — including the frozen bot-league
  // baseline at bigBlind=100 — are bit-for-bit unchanged.
  const snapped = Math.max(unit, Math.round(value / unit) * unit);
  return Math.round(snapped);
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

/** Public, post-reveal all-in equity. Unlike the policy estimator above this
 * has no ranges: it evaluates only hole cards which poker rules have already
 * made public after betting is closed. Keeping it in this module gives the
 * table the same deterministic, sliced work discipline as Rational decisions.
 */
export interface PublicAllInEquityRequest {
  players: readonly { playerId: string; cards: readonly Card[] }[];
  board: readonly Card[];
  seed: DeckSeed;
  simulations?: number;
  simulationsPerSlice?: number;
}

export interface PublicAllInEquityPlayer {
  playerId: string;
  wins: number;
  ties: number;
  losses: number;
  equity: number;
}

export interface PublicAllInEquityEstimate {
  players: readonly PublicAllInEquityPlayer[];
  simulations: number;
  unseenCards: number;
}

function validatePublicAllInEquity(request: PublicAllInEquityRequest): void {
  if (request.players.length < 2) {
    throw new Error("Public all-in equity requires at least two revealed players");
  }
  if (request.board.length > 5) throw new Error("A Hold'em board has at most five cards");
  if (request.players.some((player) => player.cards.length !== 2)) {
    throw new Error("Each public all-in player must have exactly two hole cards");
  }
  assertUniqueCards([
    ...request.board,
    ...request.players.flatMap((player) => player.cards),
  ]);
  const simulations = request.simulations ?? 500;
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 5_000) {
    throw new Error("Public all-in simulations must be an integer from 1 to 5000");
  }
}

/**
 * Thrown when a sliced public-equity run is abandoned at a slice boundary.
 * Callers use the marker to distinguish "this result is stale, drop it" from a
 * genuine validation or evaluation failure that should surface.
 */
export class PublicAllInEquityCancelledError extends Error {
  readonly cancelled = true;
  constructor(message = "Public all-in equity estimation was cancelled") {
    super(message);
    this.name = "PublicAllInEquityCancelledError";
  }
}

export function isPublicAllInEquityCancelled(error: unknown): boolean {
  return error instanceof PublicAllInEquityCancelledError;
}

export interface PublicAllInEquityOptions
  extends Pick<SlicedEquityOptions, "yieldControl"> {
  /**
   * Checked only at deterministic slice boundaries, so cancellation can never
   * change the sample stream of a run that does complete.
   */
  signal?: { readonly aborted: boolean };
}

/**
 * Deterministic Monte Carlo from only publicly known cards. Each slice yields
 * to the event loop and re-checks the caller's cancellation signal, so a board
 * or hand change stops the remaining work instead of merely discarding it. The
 * authoritative tournament engine is never consulted or affected.
 */
export async function estimatePublicAllInEquitySliced(
  request: PublicAllInEquityRequest,
  options: PublicAllInEquityOptions = {},
): Promise<PublicAllInEquityEstimate> {
  validatePublicAllInEquity(request);
  const signal = options.signal;
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new PublicAllInEquityCancelledError();
  };
  throwIfCancelled();
  const simulations = request.simulations ?? 500;
  const simulationsPerSlice = Math.max(1, request.simulationsPerSlice ?? 25);
  const knownKeys = new Set(
    [...request.board, ...request.players.flatMap((player) => player.cards)].map(cardKey),
  );
  const unseen = createDeck().filter((card) => !knownKeys.has(cardKey(card)));
  const runoutCount = 5 - request.board.length;
  const random = createSeededRandom(request.seed);
  const totals = request.players.map(() => ({ wins: 0, ties: 0, losses: 0, equity: 0 }));
  const yieldControl = options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  for (let completed = 0; completed < simulations; completed += 1) {
    const deck = unseen.map((card) => ({ ...card }));
    for (let index = 0; index < runoutCount; index += 1) {
      const target = index + Math.floor(random() * (deck.length - index));
      [deck[index], deck[target]] = [deck[target], deck[index]];
    }
    const board = [...request.board, ...deck.slice(0, runoutCount)];
    const values = request.players.map((player) => evaluateBestHand([...player.cards, ...board]));
    const best = values.reduce((winner, value, index) =>
      compareHandValues(value, values[winner]) > 0 ? index : winner, 0);
    const winners = values
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => compareHandValues(value, values[best]) === 0)
      .map(({ index }) => index);
    totals.forEach((total, index) => {
      if (!winners.includes(index)) total.losses += 1;
      else if (winners.length === 1) {
        total.wins += 1;
        total.equity += 1;
      } else {
        total.ties += 1;
        total.equity += 1 / winners.length;
      }
    });
    if ((completed + 1) % simulationsPerSlice === 0 && completed + 1 < simulations) {
      await yieldControl();
      throwIfCancelled();
    }
  }
  throwIfCancelled();
  return {
    players: request.players.map((player, index) => ({
      playerId: player.playerId,
      ...totals[index],
      equity: totals[index].equity / simulations,
    })),
    simulations,
    unseenCards: unseen.length,
  };
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

function actionsForStreet(
  informationSet: PlayerInformationSet,
  street: "preflop" | "flop" | "turn" | "river",
): PlayerInformationSet["actions"] {
  const markerIndex = informationSet.actions.findIndex(
    (action) => action.type === street,
  );
  if (street === "preflop") {
    return markerIndex < 0
      ? informationSet.actions
      : informationSet.actions.slice(0, markerIndex);
  }
  if (markerIndex < 0) return informationSet.actions;
  return informationSet.actions.slice(markerIndex + 1);
}

function aggressiveActionCount(
  actions: readonly HandActionRecord[],
): number {
  return actions.filter(
    (action) =>
      action.type === "bet" ||
      action.type === "raise" ||
      action.type === "all-in",
  ).length;
}

function publicPressureContext(
  informationSet: PlayerInformationSet,
  position: number,
  effectiveStack: number,
  bigBlind: number,
): PublicPressureContext {
  const preflopActions = actionsForStreet(informationSet, "preflop");
  const currentStreetActions = actionsForStreet(informationSet, informationSet.street);
  const streetAggression = aggressiveActionCount(currentStreetActions);
  const preflopAggression = aggressiveActionCount(preflopActions);
  const viewerWasPreflopAggressor = preflopActions.some(
    (action) =>
      action.playerId === informationSet.viewerId &&
      (action.type === "bet" || action.type === "raise" || action.type === "all-in"),
  );
  const activeOpponents = informationSet.players.filter(
    (player) =>
      player.id !== informationSet.viewerId &&
      player.status !== "folded" &&
      player.status !== "out" &&
      player.status !== "all-in",
  );
  const opponentsActedThisStreet = currentStreetActions.filter(
    (action) => action.playerId !== informationSet.viewerId && action.type !== "pending",
  ).length;
  const cappedOpponents = activeOpponents.filter(
    (opponent) => aggressionFor(informationSet.actions, opponent.id) < 0.65,
  ).length;
  const unopened = streetAggression === 0;
  const latePositionOpen =
    informationSet.street === "preflop" && unopened
      ? clamp((position - 0.45) / 0.55, 0, 1)
      : 0;
  const threeBetOpportunity =
    informationSet.street === "preflop" && preflopAggression === 1
      ? clamp(0.35 + position * 0.45, 0.2, 0.85)
      : 0;
  const squeezeOpportunity =
    informationSet.street === "preflop" &&
    preflopAggression >= 1 &&
    activeOpponents.length >= 2
      ? clamp(0.25 + (activeOpponents.length - 2) * 0.15 + position * 0.2, 0.2, 0.7)
      : 0;
  const continuationOpportunity =
    informationSet.street === "flop" && viewerWasPreflopAggressor && streetAggression === 0
      ? clamp(0.35 + position * 0.35, 0.25, 0.75)
      : 0;
  const delayedProbeOpportunity =
    (informationSet.street === "turn" || informationSet.street === "river") &&
    streetAggression === 0 &&
    !viewerWasPreflopAggressor &&
    opponentsActedThisStreet > 0
      ? clamp(0.18 + (cappedOpponents / Math.max(1, activeOpponents.length)) * 0.32, 0.12, 0.5)
      : 0;
  const stackPressure = clamp((14 - effectiveStack / bigBlind) / 14, 0, 1);
  const lowSprValuePressure = clamp(
    (2.5 - effectiveStack / Math.max(1, informationSet.pot)) / 2.5,
    0,
    1,
  );

  return {
    activeOpponents: activeOpponents.length,
    position,
    streetAggression,
    preflopAggression,
    viewerWasPreflopAggressor,
    opponentsActedThisStreet,
    cappedOpponents,
    latePositionOpen,
    threeBetOpportunity,
    squeezeOpportunity,
    continuationOpportunity,
    delayedProbeOpportunity,
    stackPressure,
    lowSprValuePressure,
  };
}

function pressureOpportunity(context: PublicPressureContext): number {
  const cappedShare =
    context.cappedOpponents / Math.max(1, context.activeOpponents);
  const opportunity =
    context.latePositionOpen * 0.95 +
    context.threeBetOpportunity * 0.82 +
    context.squeezeOpportunity * 0.58 +
    context.continuationOpportunity * 0.62 +
    context.delayedProbeOpportunity * 0.42 +
    cappedShare * (context.streetAggression === 0 ? 0.22 : 0);
  return clamp(opportunity, 0, 1.8);
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

/**
 * How many aggressive actions have already been made on the current street.
 *
 * This is the single input that makes an escalating raise war *visible* to the
 * policy. Without it every re-raise is scored as if it were the first bet of
 * the street, which is precisely what let a chain run to 600+ actions: each
 * decision in isolation looked like a fresh, profitable aggression spot.
 *
 * Public information only — it counts the same betting actions any player at
 * the table can see, and never inspects a hand.
 */
export function streetAggressionCount(
  informationSet: PlayerInformationSet,
): number {
  let count = 0;
  for (const action of informationSet.actions) {
    // Street markers are emitted by the dealer and reset the count.
    if (action.type === "flop" || action.type === "turn" || action.type === "river") {
      count = 0;
      continue;
    }
    if (
      action.type === "bet" ||
      action.type === "raise" ||
      action.type === "all-in"
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * The probability that raising again is met by another raise rather than a
 * fold or a call. It climbs with the number of raises already made, because a
 * table that has re-raised four times has demonstrated it will do so again.
 * Capped below 1 so a raise never becomes strictly impossible to justify.
 */
function reRaiseRisk(aggression: number): number {
  if (aggression <= 0) return 0.06;
  // Slope tuned against the measured 4-bet rate: at 0.17 per prior raise the
  // gate still recorded Rational 4-betting 65% of the time facing a 3-bet.
  return Math.min(0.85, 0.06 + aggression * 0.28);
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
    const aggression = streetAggressionCount(informationSet);
    // A re-raise into an escalating war is a larger commitment than an opening
    // raise, both in real poker and in what it signals. Sizing floors rise
    // with the aggression already shown.
    const fractions =
      aggression >= 3
        ? [1.0, 1.4, 2.0]
        : aggression >= 1
          ? [0.75, 1.1, 1.5]
          : [0.5, 0.8, 1.1];
    const desired = fractions.map((fraction) =>
      clamp(
        roundChips(
          informationSet.currentBet + potAfterCall * fraction,
          Math.max(1, bigBlind / 4),
        ),
        legal.raise?.minTo ?? 0,
        legal.raise?.maxTo ?? 0,
      ),
    );
    // The minimum legal raise is deliberately **not** offered as a routine
    // option. It was the cheapest way to stay aggressive, so it dominated the
    // candidate set and produced arithmetic (not geometric) escalation:
    // `lastFullRaise` only ever grew by the previous increment, so a chain of
    // min re-raises needs hundreds of iterations to exhaust a deep stack.
    // It is reinstated only when the stack leaves no larger legal sizing.
    const smallestDesired = Math.min(...desired);
    const sizes = new Set(desired);
    if (legal.raise.maxTo <= smallestDesired) sizes.add(legal.raise.minTo);
    sizes.add(legal.raise.maxTo);

    for (const to of sizes) {
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
      ? `Estimated equity trails the risk-adjusted calling threshold by ${formatFixedDecimal(Math.abs(edge * 100), 1)} points.`
      : "Folding preserves chips, but the modeled equity makes it a low-frequency option.";
  }
  if (candidate.command.type === "check") {
    return "Checking realizes equity without adding chips and protects the checking range.";
  }
  if (candidate.command.type === "call") {
    return `Calling compares ${formatPercentage(equity * 100, undefined, 1)} range equity with a ${formatPercentage(requiredEquity * 100, undefined, 1)} risk-adjusted threshold.`;
  }
  if (role === "value") {
    return `Value aggression leverages the equity edge at ${formatFixedDecimal(spr, 1)} SPR; modeled immediate fold equity is ${formatPercentage(foldEquity * 100, undefined, 1)}.`;
  }
  if (role === "semi-bluff") {
    return `The hand retains draw equity while fold equity of ${formatPercentage(foldEquity * 100, undefined, 1)} can win the pot immediately.`;
  }
  return `This is a mathematically mixed bluff supported by blockers/range pressure and ${formatPercentage(foldEquity * 100, undefined, 1)} modeled fold equity.`;
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
  pressure: PublicPressureContext,
): Array<Omit<RationalActionOption, "probability">> {
  const requiredEquity = clamp(potOdds + riskPremium, 0, 0.98);
  const spr = effectiveStack / Math.max(1, informationSet.pot);
  const equityEdge = equity - requiredEquity;
  const aggression = streetAggressionCount(informationSet);

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

      // Three outcomes, not two. The previous model priced a raise as "they
      // fold, or they call and we see a showdown", which made raising again
      // self-reinforcing: the fold-equity reward scaled with the pot the war
      // itself had created, while the cost grew only by a flat increment. The
      // missing branch is the one that actually happens in a raise war -- the
      // opponent comes back over the top and the chips just wagered are dead.
      const reRaised = reRaiseRisk(aggression);
      const called = Math.max(0, 1 - foldEquity - reRaised * (1 - foldEquity));
      const reRaisedShare = (1 - foldEquity) * reRaised;
      // Facing a re-raise we usually give up the wager; occasionally the hand
      // is strong enough to continue and recover part of it.
      const reRaisedValue = -wager * (1 - clamp(equity - 0.25, 0, 0.55));

      chipUtility =
        foldEquity * informationSet.pot +
        called * (calledEquity * calledPot - wager) +
        reRaisedShare * reRaisedValue;

      chipUtility -= riskPremium * wager * (1.4 + Math.min(1, wager / Math.max(1, effectiveStack)));
      chipUtility += position * bigBlind * 0.1;
      if (role === "bluff") {
        chipUtility += blockers * bigBlind * 0.8 + draw * bigBlind * 0.5;
      }
      // Pressure is paid only for a public opportunity. This keeps late
      // opens, 3-bets, squeezes, and stab/c-bet spots distinct from random
      // aggression when the table has already shown strength.
      const strategicPressure = pressureOpportunity(pressure);
      const pressureMultiplier =
        type === "all-in"
          ? pressure.lowSprValuePressure * 0.72 + pressure.stackPressure * 0.42
          : 0.55 + pressure.position * 0.25;
      chipUtility +=
        strategicPressure * pressureMultiplier * bigBlind *
        (role === "bluff" ? 0.58 : 1);

      // Normalized fold equity is deliberately bounded. A naked bluff needs a
      // meaningful blocker/draw and a capped public range; it cannot become a
      // profitable all-in simply because the pot is large.
      if (role === "bluff") {
        const credibleBluff =
          (draw >= 0.16 || blockers >= 0.1) &&
          foldEquity >= 0.18 &&
          pressure.streetAggression <= 1 &&
          pressure.cappedOpponents > 0;
        if (!credibleBluff) chipUtility -= bigBlind * 1.1;
        if (type === "all-in" && draw < 0.2) chipUtility -= effectiveStack * 0.45;
        if (pressure.streetAggression >= 2) chipUtility -= bigBlind * 0.45;
      }

      if (type === "all-in" && equity < 0.55 && pressure.lowSprValuePressure < 0.35) {
        chipUtility -= bigBlind * 0.8;
      }
      if (spr <= 2 && equity >= 0.55) chipUtility += bigBlind * 0.35;
      if (spr >= 8 && wager > informationSet.pot && equity < 0.7) {
        chipUtility -= bigBlind * 0.5;
      }

      // Stack-preservation brake. Busting out of a tournament is worse than
      // the chip-EV arithmetic says, and the old model had no term at all for
      // it: the risk premium alone computes to 0.04-0.07 in career play, which
      // never restrained a deep-stack shove.
      //
      // It engages only past a threshold share of the effective stack. A
      // brake that applied from zero suppressed ordinary value betting too
      // (measured: Normal's raise rate fell to 2.8%), which is the opposite
      // failure -- the goal is a table that stops shoving 300 BB with a
      // marginal edge, not one that never raises.
      const committedShare = clamp(wager / Math.max(1, effectiveStack), 0, 1);
      const exposure = Math.max(0, committedShare - 0.25) / 0.75;
      const survivalWeight = clamp(0.55 + riskPremium * 3, 0.55, 1.6);
      chipUtility -=
        exposure * exposure *
        effectiveStack * survivalWeight * clamp(0.62 - equity, 0, 0.62);
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

type HeroInformationPlayer = PlayerInformationSet["players"][number];

interface PreparedRationalDecision {
  hero: HeroInformationPlayer;
  heroCards: Card[];
  opponents: PublicOpponent[];
}

function prepareRationalDecision(
  input: RationalPolicyInput,
): PreparedRationalDecision {
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
  return { hero, heroCards, opponents };
}

/**
 * Fully serializable equity request. The async boundary (worker or injected
 * scheduler) receives only public information, the policy seed, and the fixed
 * deterministic work budget — never hidden deck state.
 */
export interface EquityRequest {
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
  seed: DeckSeed;
  simulations: number;
  simulationsPerSlice?: number;
}

/**
 * Produces a range equity estimate for a serialized request. Implementations
 * (synchronous, sliced, or worker-backed) must return the bit-for-bit identical
 * estimate for a fixed request because the sample stream is seed-derived and
 * never reads elapsed time.
 */
export type EquityEstimator = (request: EquityRequest) => Promise<EquityEstimate>;

export function equityRequestFromPolicyInput(
  input: RationalPolicyInput,
): EquityRequest {
  return {
    informationSet: input.informationSet,
    legalActions: input.legalActions,
    seed: input.seed,
    simulations: input.simulations ?? DEFAULT_SIMULATIONS,
    simulationsPerSlice: input.equitySimulationsPerSlice,
  };
}

export function decideRationalAction(input: RationalPolicyInput): RationalDecision {
  const prepared = prepareRationalDecision(input);
  const request = equityRequestFromPolicyInput(input);
  const equity = estimateRangeEquity(
    request.informationSet,
    request.legalActions,
    request.seed,
    request.simulations,
    { simulationsPerSlice: request.simulationsPerSlice },
  );
  return assembleRationalDecision(input, prepared, equity);
}

/**
 * Deterministic async counterpart to {@link decideRationalAction}. It delegates
 * the heavy Monte Carlo work to an injected estimator (typically a worker) and
 * then reconstructs the identical decision from the returned estimate. For a
 * fixed seed and work budget the chosen action, distribution, metrics, ranges,
 * and audit are identical to the synchronous path.
 */
export async function decideRationalActionAsync(
  input: RationalPolicyInput,
  options: { estimateEquity: EquityEstimator },
): Promise<RationalDecision> {
  const prepared = prepareRationalDecision(input);
  const equity = await options.estimateEquity(
    equityRequestFromPolicyInput(input),
  );
  return assembleRationalDecision(input, prepared, equity);
}

function assembleRationalDecision(
  input: RationalPolicyInput,
  prepared: PreparedRationalDecision,
  equity: EquityEstimate,
): RationalDecision {
  const { informationSet, legalActions } = input;
  const { hero, heroCards, opponents } = prepared;
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
  const pressure = publicPressureContext(
    informationSet,
    position,
    effectiveStack,
    input.bigBlind,
  );
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
    pressure,
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
        pressureOpportunity: pressureOpportunity(pressure),
        streetAggression: pressure.streetAggression,
        boundedBluffOpportunity:
          clamp(
            (draw * 0.7 + blockers * 0.8) *
              (pressure.cappedOpponents / Math.max(1, pressure.activeOpponents)),
            0,
            1,
          ),
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
      summary: `${actionLabel(best.command.type)} is the highest-frequency action at ${formatPercentage(best.probability * 100, undefined, 0)}; estimated equity is ${formatPercentage(equity.equity * 100, undefined, 1)} versus a ${formatPercentage(requiredEquity * 100, undefined, 1)} risk-adjusted threshold.`,
    },
  };
}
