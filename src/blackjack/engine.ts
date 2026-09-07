export const BLACKJACK_RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;

export type BlackjackRank = (typeof BLACKJACK_RANKS)[number];
export type BlackjackSuit = "♠" | "♥" | "♦" | "♣";
export type BlackjackAction =
  | "hit"
  | "stand"
  | "double"
  | "split"
  | "surrender";
export type InsuranceAction = "insurance" | "decline";

export interface BlackjackCard {
  readonly rank: BlackjackRank;
  readonly suit: BlackjackSuit;
  readonly id?: string;
}

export interface BlackjackRules {
  readonly decks: number;
  readonly blackjackPayout: number;
  readonly dealerHitsSoft17: boolean;
  readonly doubleAfterSplit: boolean;
  readonly doubleOnAnyTwo: boolean;
  readonly lateSurrender: boolean;
  readonly dealerHoleCard: boolean;
  readonly dealerPeeks: boolean;
  readonly maxSplitHands: number;
  readonly hitSplitAces: boolean;
  readonly resplitAces: boolean;
  readonly countSystem: "hi-lo";
  readonly playingCountRounding: "floor";
  readonly cutCardCards: number;
}

/** One explicit rules object drives the guide, trainer, and playable table. */
export const BLACKJACK_RULES: BlackjackRules = {
  decks: 6,
  blackjackPayout: 1.5,
  dealerHitsSoft17: false,
  doubleAfterSplit: true,
  doubleOnAnyTwo: true,
  lateSurrender: true,
  dealerHoleCard: true,
  dealerPeeks: true,
  maxSplitHands: 4,
  hitSplitAces: false,
  resplitAces: false,
  countSystem: "hi-lo",
  playingCountRounding: "floor",
  cutCardCards: 52,
};

export interface BlackjackHand {
  readonly cards: readonly BlackjackCard[];
  readonly isSplitHand?: boolean;
}

export interface ActionOptions {
  readonly isSplitHand?: boolean;
  readonly splitHands?: number;
  readonly canSurrender?: boolean;
}

export interface CountDeviation {
  readonly action: BlackjackAction;
  readonly index: number;
  readonly name: string;
  readonly explanation: string;
}

export interface StrategyDecision {
  readonly action: BlackjackAction;
  readonly basicAction: BlackjackAction;
  readonly deviationApplied: boolean;
  readonly index?: number;
  readonly trueCount: number;
  readonly explanation: string;
  readonly deviationName?: string;
}

export interface HandValue {
  readonly total: number;
  readonly soft: boolean;
}

const SUITS: readonly BlackjackSuit[] = ["♠", "♥", "♦", "♣"];

export function cardFromRank(
  rank: BlackjackRank,
  suit: BlackjackSuit = "♠",
): BlackjackCard {
  return { rank, suit };
}

export function cardValue(rank: BlackjackRank): number {
  if (rank === "A") return 11;
  if (rank === "10" || rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}

export function handValue(cards: readonly BlackjackCard[]): HandValue {
  let total = cards.reduce((sum, card) => sum + cardValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: cards.some((card) => card.rank === "A") && aces > 0 };
}

export function isNaturalBlackjack(
  cards: readonly BlackjackCard[],
  isSplitHand = false,
): boolean {
  return !isSplitHand && cards.length === 2 && handValue(cards).total === 21;
}

export function isPair(cards: readonly BlackjackCard[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

export function getHiLoTag(card: BlackjackCard | BlackjackRank): -1 | 0 | 1 {
  const rank = typeof card === "string" ? card : card.rank;
  if (["2", "3", "4", "5", "6"].includes(rank)) return 1;
  if (["7", "8", "9"].includes(rank)) return 0;
  return -1;
}

export function getRunningCount(cards: readonly BlackjackCard[]): number {
  return cards.reduce((count, card) => count + getHiLoTag(card), 0);
}

export function getRawTrueCount(
  runningCount: number,
  decksRemaining: number,
): number {
  return runningCount / Math.max(decksRemaining, Number.EPSILON);
}

/** Playing indices use mathematical floor, including for negative counts. */
export function getPlayingTrueCount(
  runningCount: number,
  decksRemaining: number,
): number {
  return Math.floor(getRawTrueCount(runningCount, decksRemaining));
}

export function formatCount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function createShoe(rules: BlackjackRules = BLACKJACK_RULES): BlackjackCard[] {
  const shoe: BlackjackCard[] = [];
  for (let deck = 0; deck < rules.decks; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of BLACKJACK_RANKS) {
        shoe.push({ rank, suit, id: `${deck}-${suit}-${rank}` });
      }
    }
  }
  return shoe;
}

export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleShoe(
  cards: readonly BlackjackCard[],
  seed = Date.now(),
): BlackjackCard[] {
  const shuffled = [...cards];
  const random = createSeededRng(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hasAction(
  availableActions: readonly BlackjackAction[],
  action: BlackjackAction,
): boolean {
  return availableActions.includes(action);
}

function chooseAction(
  preferred: BlackjackAction,
  fallback: BlackjackAction,
  availableActions: readonly BlackjackAction[],
): BlackjackAction {
  if (hasAction(availableActions, preferred)) return preferred;
  if (hasAction(availableActions, fallback)) return fallback;
  return availableActions[0] ?? "stand";
}

function dealerNumber(dealerUpcard: BlackjackCard): number {
  return dealerUpcard.rank === "A" ? 11 : cardValue(dealerUpcard.rank);
}

function isHardTotal(hand: BlackjackHand): boolean {
  return !handValue(hand.cards).soft;
}

function pairAction(
  rank: BlackjackRank,
  dealer: number,
  availableActions: readonly BlackjackAction[],
): BlackjackAction | null {
  if (!hasAction(availableActions, "split")) return null;
  if (rank === "A" || rank === "8") return "split";
  if (rank === "2" || rank === "3") return dealer >= 2 && dealer <= 7 ? "split" : "hit";
  if (rank === "4") return dealer >= 5 && dealer <= 6 ? "split" : "hit";
  if (rank === "6") return dealer >= 2 && dealer <= 6 ? "split" : "hit";
  if (rank === "7") return dealer >= 2 && dealer <= 7 ? "split" : "hit";
  if (rank === "9") return dealer >= 2 && dealer <= 6 || dealer === 8 || dealer === 9
    ? "split"
    : "stand";
  // 5,5 and T,T are played as hard 10 and hard 20 respectively.
  return null;
}

/**
 * Six-deck, S17, DAS, late-surrender benchmark.  The explicit task
 * acceptance tests treat 15v10 as the Fab 4 threshold rather than a
 * permanently-basic surrender; keeping that threshold in the deviation
 * layer makes the Guide's -1 -> 0 transition observable and testable.
 */
export function getBasicStrategyAction(
  hand: BlackjackHand,
  dealerUpcard: BlackjackCard,
  rules: BlackjackRules = BLACKJACK_RULES,
  availableActions: readonly BlackjackAction[] = getAvailableActions(
    hand,
    dealerUpcard,
    rules,
  ),
): BlackjackAction {
  const dealer = dealerNumber(dealerUpcard);
  const value = handValue(hand.cards);
  const pair = isPair(hand.cards);

  if (pair) {
    const action = pairAction(hand.cards[0].rank, dealer, availableActions);
    if (action) return chooseAction(action, "hit", availableActions);
  }

  // Pair 8s takes precedence over the hard-16 surrender row when splitting is
  // legal.  When split is unavailable, the ordinary hard total rules apply.
  if (
    rules.lateSurrender &&
    !hand.isSplitHand &&
    hand.cards.length === 2 &&
    !value.soft &&
    hasAction(availableActions, "surrender") &&
    value.total === 16 && [9, 10, 11].includes(dealer)
  ) {
    return "surrender";
  }

  if (!value.soft) {
    const total = value.total;
    if (total <= 8) return chooseAction("hit", "stand", availableActions);
    if (total === 9) {
      return chooseAction(dealer >= 3 && dealer <= 6 ? "double" : "hit", "hit", availableActions);
    }
    if (total === 10) {
      return chooseAction(dealer <= 9 ? "double" : "hit", "hit", availableActions);
    }
    if (total === 11) {
      return chooseAction(dealer <= 10 ? "double" : "hit", "hit", availableActions);
    }
    if (total === 12) {
      return chooseAction(dealer >= 4 && dealer <= 6 ? "stand" : "hit", "hit", availableActions);
    }
    if (total >= 13 && total <= 16) {
      return chooseAction(dealer >= 2 && dealer <= 6 ? "stand" : "hit", "hit", availableActions);
    }
    return chooseAction("stand", "hit", availableActions);
  }

  // The soft table is expressed as A,2 through A,9.  For multi-card soft
  // hands the total rules still provide a stable and useful trainer answer.
  if (value.total <= 17) {
    const double =
      (value.total === 13 || value.total === 14) && dealer >= 5 && dealer <= 6 ||
      (value.total === 15 || value.total === 16) && dealer >= 4 && dealer <= 6 ||
      value.total === 17 && dealer >= 3 && dealer <= 6;
    return chooseAction(double ? "double" : "hit", "hit", availableActions);
  }
  if (value.total === 18) {
    return chooseAction(
      dealer >= 3 && dealer <= 6 ? "double" : dealer === 2 || dealer === 7 || dealer === 8 ? "stand" : "hit",
      dealer >= 3 && dealer <= 6 ? "stand" : "hit",
      availableActions,
    );
  }
  return chooseAction("stand", "hit", availableActions);
}

function deviation(
  action: BlackjackAction,
  index: number,
  name: string,
  explanation: string,
): CountDeviation {
  return { action, index, name, explanation };
}

/** Returns only the applicable I18/Fab 4 deviation, before basic fallback. */
export function getCountDeviation(
  hand: BlackjackHand,
  dealerUpcard: BlackjackCard,
  trueCount: number,
  rules: BlackjackRules = BLACKJACK_RULES,
  availableActions: readonly BlackjackAction[] = getAvailableActions(
    hand,
    dealerUpcard,
    rules,
  ),
): CountDeviation | null {
  const total = handValue(hand.cards).total;
  const dealer = dealerNumber(dealerUpcard);
  const pair = isPair(hand.cards);
  const splitAvailable = hasAction(availableActions, "split");
  const surrenderAvailable = hasAction(availableActions, "surrender");

  if (rules.lateSurrender && surrenderAvailable && !hand.isSplitHand && isHardTotal(hand)) {
    if (total === 14 && dealer === 10 && trueCount >= 3) {
      return deviation("surrender", 3, "Fab 4 · 14 vs 10", "Surrender begins at TC +3.");
    }
    if (total === 15 && dealer === 10 && trueCount >= 0) {
      return deviation("surrender", 0, "Fab 4 · 15 vs 10", "Surrender begins at TC 0.");
    }
    if (total === 15 && dealer === 9 && trueCount >= 2) {
      return deviation("surrender", 2, "Fab 4 · 15 vs 9", "Surrender begins at TC +2.");
    }
    if (total === 15 && dealer === 11 && trueCount >= 1) {
      return deviation("surrender", 1, "Fab 4 · 15 vs A", "Surrender begins at TC +1.");
    }
  }

  if (pair && splitAvailable && hand.cards[0].rank === "10") {
    if (dealer === 5 && trueCount >= 5) {
      return deviation("split", 5, "I18 · 10,10 vs 5", "Split at TC +5 or greater.");
    }
    if (dealer === 6 && trueCount >= 4) {
      return deviation("split", 4, "I18 · 10,10 vs 6", "Split at TC +4 or greater.");
    }
  }

  if (!pair && isHardTotal(hand)) {
    if (total === 16 && dealer === 10 && !surrenderAvailable && trueCount >= 0) {
      return deviation("stand", 0, "I18 · 16 vs 10", "Stand at TC 0 or greater.");
    }
    if (total === 15 && dealer === 10 && !surrenderAvailable && trueCount >= 4) {
      return deviation("stand", 4, "I18 · 15 vs 10", "Stand at TC +4 or greater when surrender is unavailable.");
    }
    if (total === 10 && dealer === 10 && trueCount >= 4) {
      return deviation("double", 4, "I18 · 10 vs 10", "Double at TC +4 or greater.");
    }
    if (total === 12 && dealer === 3 && trueCount >= 2) {
      return deviation("stand", 2, "I18 · 12 vs 3", "Stand at TC +2 or greater.");
    }
    if (total === 12 && dealer === 2 && trueCount >= 3) {
      return deviation("stand", 3, "I18 · 12 vs 2", "Stand at TC +3 or greater.");
    }
    if (total === 11 && dealer === 11 && trueCount >= 1) {
      return deviation("double", 1, "I18 · 11 vs A", "Double at TC +1 or greater.");
    }
    if (total === 9 && dealer === 2 && trueCount >= 1) {
      return deviation("double", 1, "I18 · 9 vs 2", "Double at TC +1 or greater.");
    }
    if (total === 10 && dealer === 11 && trueCount >= 4) {
      return deviation("double", 4, "I18 · 10 vs A", "Double at TC +4 or greater.");
    }
    if (total === 9 && dealer === 7 && trueCount >= 3) {
      return deviation("double", 3, "I18 · 9 vs 7", "Double at TC +3 or greater.");
    }
    if (total === 16 && dealer === 9 && !surrenderAvailable && trueCount >= 5) {
      return deviation("stand", 5, "I18 · 16 vs 9", "Stand at TC +5 or greater when surrender is unavailable.");
    }
    if (total === 13 && dealer === 2 && trueCount >= -1) {
      return deviation("stand", -1, "I18 · 13 vs 2", "Stand at TC -1 or greater.");
    }
    if (total === 13 && dealer === 2 && trueCount < -1) {
      return deviation("hit", -1, "I18 · 13 vs 2", "Hit below TC -1.");
    }
    if (total === 12 && dealer === 4 && trueCount >= 0) {
      return deviation("stand", 0, "I18 · 12 vs 4", "Stand at TC 0 or greater.");
    }
    if (total === 12 && dealer === 4 && trueCount < 0) {
      return deviation("hit", 0, "I18 · 12 vs 4", "Hit below TC 0.");
    }
    if (total === 12 && dealer === 5 && trueCount >= -2) {
      return deviation("stand", -2, "I18 · 12 vs 5", "Stand at TC -2 or greater.");
    }
    if (total === 12 && dealer === 5 && trueCount < -2) {
      return deviation("hit", -2, "I18 · 12 vs 5", "Hit below TC -2.");
    }
    if (total === 12 && dealer === 6 && trueCount >= -1) {
      return deviation("stand", -1, "I18 · 12 vs 6", "Stand at TC -1 or greater.");
    }
    if (total === 12 && dealer === 6 && trueCount < -1) {
      return deviation("hit", -1, "I18 · 12 vs 6", "Hit below TC -1.");
    }
    if (total === 13 && dealer === 3 && trueCount >= -2) {
      return deviation("stand", -2, "I18 · 13 vs 3", "Stand at TC -2 or greater.");
    }
    if (total === 13 && dealer === 3 && trueCount < -2) {
      return deviation("hit", -2, "I18 · 13 vs 3", "Hit below TC -2.");
    }
  }

  return null;
}

export function getOptimalAction(
  hand: BlackjackHand,
  dealerUpcard: BlackjackCard,
  trueCount: number,
  rules: BlackjackRules = BLACKJACK_RULES,
  availableActions: readonly BlackjackAction[] = getAvailableActions(
    hand,
    dealerUpcard,
    rules,
  ),
): StrategyDecision {
  const basicAction = getBasicStrategyAction(hand, dealerUpcard, rules, availableActions);
  const candidate = getCountDeviation(
    hand,
    dealerUpcard,
    trueCount,
    rules,
    availableActions,
  );
  const action = candidate && hasAction(availableActions, candidate.action)
    ? candidate.action
    : basicAction;
  const changed = action !== basicAction;

  if (candidate && changed) {
    return {
      action,
      basicAction,
      deviationApplied: true,
      index: candidate.index,
      trueCount,
      deviationName: candidate.name,
      explanation: `${candidate.explanation} Basic strategy would be ${basicAction}.`,
    };
  }
  return {
    action,
    basicAction,
    deviationApplied: false,
    trueCount,
    explanation: `${actionLabel(action)} is the benchmark basic-strategy action at this state.`,
  };
}

export function getAvailableActions(
  hand: BlackjackHand,
  _dealerUpcard: BlackjackCard,
  rules: BlackjackRules = BLACKJACK_RULES,
  options: ActionOptions = {},
): BlackjackAction[] {
  const isSplitHand = options.isSplitHand ?? hand.isSplitHand ?? false;
  const splitHands = options.splitHands ?? 1;
  const actions: BlackjackAction[] = ["hit", "stand"];
  if (hand.cards.length === 2) {
    if ((!isSplitHand || rules.doubleAfterSplit) && rules.doubleOnAnyTwo) {
      actions.push("double");
    }
    if (
      isPair(hand.cards) &&
      splitHands < rules.maxSplitHands &&
      (splitHands === 1 || hand.cards[0].rank !== "A" || rules.resplitAces)
    ) {
      actions.push("split");
    }
    if (
      rules.lateSurrender &&
      !isSplitHand &&
      options.canSurrender !== false
    ) {
      actions.push("surrender");
    }
  }
  return actions;
}

export function getInsuranceAction(trueCount: number): InsuranceAction {
  return trueCount >= 3 ? "insurance" : "decline";
}

function drawFrom(cards: BlackjackCard[], random: () => number): BlackjackCard {
  const index = Math.floor(random() * cards.length);
  return cards.splice(Math.max(0, index), 1)[0];
}

function dealerPlay(
  cards: BlackjackCard[],
  shoe: BlackjackCard[],
  rules: BlackjackRules,
  random: () => number,
): BlackjackCard[] {
  const dealer = [...cards];
  while (true) {
    const value = handValue(dealer);
    if (value.total > 21) break;
    if (value.total > 17) break;
    if (value.total === 17 && (!value.soft || !rules.dealerHitsSoft17)) break;
    dealer.push(drawFrom(shoe, random));
  }
  return dealer;
}

function settleValue(
  player: readonly BlackjackCard[],
  dealer: readonly BlackjackCard[],
  action: BlackjackAction,
  rules: BlackjackRules,
): number {
  if (action === "surrender") return -0.5;
  const playerValue = handValue(player).total;
  const dealerValue = handValue(dealer).total;
  if (playerValue > 21) return -1;
  if (isNaturalBlackjack(dealer) && !isNaturalBlackjack(player)) return -1;
  if (isNaturalBlackjack(player) && !isNaturalBlackjack(dealer)) {
    return rules.blackjackPayout;
  }
  if (dealerValue > 21 || playerValue > dealerValue) return 1;
  if (playerValue === dealerValue) return 0;
  return -1;
}

function playerFinishByBasic(
  hand: BlackjackCard[],
  dealerUpcard: BlackjackCard,
  shoe: BlackjackCard[],
  rules: BlackjackRules,
  random: () => number,
): void {
  for (let guard = 0; guard < 8; guard += 1) {
    const value = handValue(hand);
    if (value.total >= 17 || value.total > 21) return;
    const action = getBasicStrategyAction(
      { cards: hand },
      dealerUpcard,
      rules,
      ["hit", "stand"],
    );
    if (action === "stand") return;
    hand.push(drawFrom(shoe, random));
  }
}

/**
 * A small common-random-number Monte Carlo evaluator. It is intentionally
 * labelled an estimate by callers and returns null for split comparisons,
 * where a one-hand evaluator would be misleading.
 */
export function estimateActionEvLoss({
  hand,
  dealerUpcard,
  action,
  recommendedAction,
  remainingShoe,
  rules = BLACKJACK_RULES,
  seed = 1,
  samples = 160,
}: {
  hand: BlackjackHand;
  dealerUpcard: BlackjackCard;
  action: BlackjackAction;
  recommendedAction: BlackjackAction;
  remainingShoe: readonly BlackjackCard[];
  rules?: BlackjackRules;
  seed?: number;
  samples?: number;
}): number | null {
  if (action === "split" || recommendedAction === "split") return null;
  if (action === recommendedAction) return 0;
  if (remainingShoe.length < 4) return null;

  const evaluate = (candidate: BlackjackAction): number => {
    let total = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const random = createSeededRng(seed + sample * 7919);
      const shoe = [...remainingShoe];
      const player = [...hand.cards];
      const dealerHole = drawFrom(shoe, random);
      if (candidate === "surrender") {
        total -= 0.5;
        continue;
      }
      if (candidate === "hit" || candidate === "double") {
        player.push(drawFrom(shoe, random));
      }
      if (candidate === "hit") {
        playerFinishByBasic(player, dealerUpcard, shoe, rules, random);
      }
      const dealer = dealerPlay([dealerUpcard, dealerHole], shoe, rules, random);
      const value = settleValue(player, dealer, candidate, rules);
      total += candidate === "double" ? value * 2 : value;
    }
    return total / samples;
  };

  return Math.max(0, evaluate(recommendedAction) - evaluate(action));
}

export function actionLabel(action: BlackjackAction | InsuranceAction): string {
  switch (action) {
    case "hit":
      return "Hit";
    case "stand":
      return "Stand";
    case "double":
      return "Double";
    case "split":
      return "Split";
    case "surrender":
      return "Surrender";
    case "insurance":
      return "Take insurance";
    default:
      return "Decline insurance";
  }
}

export function actionCode(action: BlackjackAction): "H" | "S" | "D" | "P" | "R" {
  switch (action) {
    case "hit":
      return "H";
    case "stand":
      return "S";
    case "double":
      return "D";
    case "split":
      return "P";
    case "surrender":
      return "R";
  }
}
