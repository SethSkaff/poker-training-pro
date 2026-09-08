import { evaluateBestHand, HAND_CATEGORY } from "../../src/engine/evaluator";
import type { PlayerInformationSet } from "../../src/engine/tournament";
import type { Street, Card } from "../../src/types/poker";
import { derivePlayerCountSemantics, type PlayerCountSemantics } from "../../src/lib/playerCountSemantics";
import type { WagerGeometry } from "../../src/lib/pokerActionSemantics";

export type DepthBin = "(0,15]" | "(15,40]" | "(40,100]" | "(100,200]" | "(200,400]" | ">400";
export type SprBin = "[0,1]" | "(1,4]" | "(4,10]" | "(10,20]" | "(20,50]" | ">50";
export type FacingBin = "none" | "small" | "medium" | "large" | "overbet" | "unknown";

export interface BoardFeatures {
  rankMultiplicities: number[];
  maximumSuitCount: number;
  highestRank: number | null;
  distinctRanks: number;
  maximumStraightWindowRanks: number;
  previousStreetChanges: string[];
}

export interface ActorHandFeatures {
  madeHandCategory: number | null;
  pocketPair: boolean;
  preflopRanks: [number, number] | null;
  suited: boolean | null;
  cardsToFlush: number | null;
  straightWindowCounts: number[];
}

export interface DecisionStrata {
  street: Street;
  counts: PlayerCountSemantics;
  playersAbleToAct: number;
  contestants: "heads_up" | "multiway" | "uncontested";
  actorSeat: number;
  buttonSeat: number;
  actorRelativeSeat: number;
  actorDecisionOrder: number;
  positionVsResponders: "in" | "out" | "mixed" | "none";
  actorDepthBb: number;
  pairwiseDepthBb: { min: number | null; max: number | null };
  pairwiseSpr: { min: number | null; max: number | null };
  depthBin: DepthBin;
  sprBin: SprBin;
  facing: FacingBin;
  facingJam: boolean;
  potType: "unopened" | "limped" | "single_raised" | "three_bet" | "four_bet_plus" | "unknown";
  fullPreflopRaises: number;
  shortPreflopIncreases: number;
  board: BoardFeatures;
  actorHandFeatures: { value: ActorHandFeatures; reason: null } | { value: null; reason: string };
  tournamentStage: "early" | "middle" | "late" | "bubble" | "unknown";
  qualificationDistance: number | null;
  tournamentPressure: number | null;
  modelSupportCodes: string[];
}

const RANKS: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

function bin(value: number, thresholds: readonly number[], labels: readonly string[]): string {
  if (!Number.isFinite(value) || value < 0) throw new Error("Stratification values must be non-negative and finite");
  for (let index = 0; index < thresholds.length; index += 1) {
    if (value <= thresholds[index]) return labels[index];
  }
  return labels[labels.length - 1];
}

export function depthBin(value: number): DepthBin {
  return bin(value, [15, 40, 100, 200, 400], ["(0,15]", "(15,40]", "(40,100]", "(100,200]", "(200,400]", ">400"]) as DepthBin;
}

export function sprBin(value: number): SprBin {
  return bin(value, [1, 4, 10, 20, 50], ["[0,1]", "(1,4]", "(4,10]", "(10,20]", "(20,50]", ">50"]) as SprBin;
}

export function facingBin(callCostOverPot: number | null, hasFacingCost: boolean): FacingBin {
  if (!hasFacingCost) return "none";
  if (callCostOverPot === null || !Number.isFinite(callCostOverPot)) return "unknown";
  if (callCostOverPot <= 1 / 3) return "small";
  if (callCostOverPot <= 2 / 3) return "medium";
  if (callCostOverPot <= 1) return "large";
  return "overbet";
}

function boardFeatures(board: readonly Card[]): BoardFeatures {
  const ranks = board.map((card) => RANKS[card.rank]);
  const multiplicities = [...new Set(ranks)].map((rank) => ranks.filter((entry) => entry === rank).length).sort((a, b) => b - a);
  const suits = new Map<string, number>();
  for (const card of board) suits.set(card.suit, (suits.get(card.suit) ?? 0) + 1);
  const values = new Set(ranks);
  if (values.has(14)) values.add(1);
  let maxWindow = 0;
  for (let low = 1; low <= 10; low += 1) {
    let count = 0;
    for (let rank = low; rank < low + 5; rank += 1) if (values.has(rank)) count += 1;
    maxWindow = Math.max(maxWindow, count);
  }
  return {
    rankMultiplicities: multiplicities,
    maximumSuitCount: Math.max(0, ...(suits.values())),
    highestRank: ranks.length ? Math.max(...ranks) : null,
    distinctRanks: values.has(1) ? values.size - (ranks.includes(14) ? 1 : 0) : values.size,
    maximumStraightWindowRanks: maxWindow,
    previousStreetChanges: [],
  };
}

function actorFeatures(view: PlayerInformationSet): DecisionStrata["actorHandFeatures"] {
  const actor = view.players.find((player) => player.id === view.viewerId);
  const cards = actor?.holeCards ?? [];
  if (cards.length !== 2) return { value: null, reason: "actor_cards_unavailable" };
  const known = [...cards, ...view.board];
  const ranks = cards.map((card) => RANKS[card.rank]).sort((a, b) => b - a) as [number, number];
  const suitCounts = new Map<string, number>();
  for (const card of known) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  const values = new Set(known.map((card) => RANKS[card.rank]));
  if (values.has(14)) values.add(1);
  const windows: number[] = [];
  for (let low = 1; low <= 10; low += 1) {
    let count = 0;
    for (let rank = low; rank < low + 5; rank += 1) if (values.has(rank)) count += 1;
    windows.push(count);
  }
  return {
    value: {
      madeHandCategory: known.length >= 5 ? evaluateBestHand(known).category : null,
      pocketPair: ranks[0] === ranks[1],
      preflopRanks: ranks,
      suited: cards[0].suit === cards[1].suit,
      cardsToFlush: Math.max(0, 5 - Math.max(0, ...(cards.map((card) => suitCounts.get(card.suit) ?? 0)))),
      straightWindowCounts: windows,
    },
    reason: null,
  };
}

function relativeSeat(actorSeat: number, buttonSeat: number, tableSize: number): number {
  return ((actorSeat - buttonSeat + tableSize) % tableSize) || tableSize;
}

function preflopCounts(view: PlayerInformationSet): { full: number; short: number; potType: DecisionStrata["potType"] } {
  const actions = view.actions.filter((action) => action.type !== "small-blind" && action.type !== "big-blind" && action.type !== "big-blind-ante");
  let full = 0;
  let short = 0;
  for (const action of actions) {
    if (action.type === "raise" || action.type === "bet") full += 1;
    if (action.type === "all-in") full += 1;
  }
  const potType = full === 0 ? (actions.some((action) => action.type === "call") ? "limped" : "unopened") : full === 1 ? "single_raised" : full === 2 ? "three_bet" : full >= 3 ? "four_bet_plus" : "unknown";
  return { full, short, potType };
}

export interface StratificationInput {
  informationSet: PlayerInformationSet;
  geometry: WagerGeometry;
  tournamentPlayersRemaining: number;
  actorDecisionOrder?: number;
  modelSupportCodes?: readonly string[];
}

export function stratifyDecision(input: StratificationInput): DecisionStrata {
  const { informationSet: view, geometry } = input;
  const actor = view.players.find((player) => player.id === view.viewerId);
  if (!actor) throw new Error("Stratification actor is missing");
  const counts = derivePlayerCountSemantics(view.players, view.viewerId, input.tournamentPlayersRemaining);
  const contestants = counts.activePlayersInHand <= 1 ? "uncontested" : counts.activePlayersInHand === 2 ? "heads_up" : "multiway";
  const responders = geometry.opponents.filter((opponent) => opponent.canMakeDecisionAtTarget);
  const positionVsResponders = responders.length === 0 ? "none" : responders.every((opponent) => (view.players.find((player) => player.id === opponent.opponentId)?.seat ?? 0) > actor.seat) ? "in" : responders.every((opponent) => (view.players.find((player) => player.id === opponent.opponentId)?.seat ?? 0) < actor.seat) ? "out" : "mixed";
  const actorDepthBb = geometry.bigBlindChips > 0 ? geometry.actorStackChips / geometry.bigBlindChips : 0;
  const decisionSpr = geometry.decisionMinSpr.value ?? 0;
  const countsPreflop = preflopCounts(view);
  const face = facingBin(geometry.callCostOverCurrentPot.value, geometry.outstandingCallChips > 0);
  return {
    street: view.street,
    counts,
    playersAbleToAct: view.players.filter((player) => player.status === "active" && player.stack > 0).length,
    contestants,
    actorSeat: actor.seat,
    buttonSeat: view.buttonSeat,
    actorRelativeSeat: relativeSeat(actor.seat, view.buttonSeat, Math.max(2, view.players.length)),
    actorDecisionOrder: input.actorDecisionOrder ?? view.actions.filter((action) => action.playerId !== "dealer").length,
    positionVsResponders,
    actorDepthBb,
    pairwiseDepthBb: {
      min: geometry.minPositiveFutureMatchedChips.value === null || geometry.bigBlindChips <= 0 ? null : geometry.minPositiveFutureMatchedChips.value / geometry.bigBlindChips,
      max: geometry.maxFutureMatchedChips.value === null || geometry.bigBlindChips <= 0 ? null : geometry.maxFutureMatchedChips.value / geometry.bigBlindChips,
    },
    pairwiseSpr: { min: geometry.decisionMinSpr.value, max: geometry.decisionMaxSpr.value },
    depthBin: depthBin(actorDepthBb),
    sprBin: sprBin(decisionSpr),
    facing: face,
    facingJam: geometry.opponents.some((opponent) => opponent.facingAdditionalCost && opponent.remainingStackChips <= geometry.outstandingCallChips),
    potType: view.street === "preflop" ? countsPreflop.potType : countsPreflop.potType,
    fullPreflopRaises: countsPreflop.full,
    shortPreflopIncreases: countsPreflop.short,
    board: boardFeatures(view.board),
    actorHandFeatures: actorFeatures(view),
    tournamentStage: "unknown",
    qualificationDistance: null,
    tournamentPressure: null,
    modelSupportCodes: [...(input.modelSupportCodes ?? [])],
  };
}
