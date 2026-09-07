import {
  BLACKJACK_RULES, cardFromRank, cardValue, getAvailableActions,
  getInsuranceAction, getOptimalAction, handValue, isPair,
  type BlackjackAction, type BlackjackCard, type BlackjackHand,
  type BlackjackRank, type BlackjackSuit, type InsuranceAction,
} from "./engine";

export const TRAINER_REPEAT_WINDOW = 10;
type Lesson = "foundation" | "reinforcement" | "deviation";
export interface TrainerScenario {
  kind: "action" | "insurance";
  hand: BlackjackHand;
  dealerUpcard: BlackjackCard;
  trueCount: number;
  availableActions: BlackjackAction[];
  difficulty: number;
  lesson: Lesson;
  nearThreshold: boolean;
}

// Ignore count, suits, composition and action availability: even a differently
// dressed version of the same decision must sit out the next ten questions.
export function trainerScenarioKey(scenario: Pick<TrainerScenario, "kind" | "hand" | "dealerUpcard">): string {
  if (scenario.kind === "insurance") return "insurance";
  const value = handValue(scenario.hand.cards);
  const type = isPair(scenario.hand.cards)
    ? `pair-${cardValue(scenario.hand.cards[0].rank)}`
    : `${value.soft ? "soft" : "hard"}-${value.total}`;
  return `${type}:dealer-${cardValue(scenario.dealerUpcard.rank)}`;
}

interface HandFamily {
  key: string;
  variants: { hand: BlackjackHand; dealerUpcard: BlackjackCard; availableActions: BlackjackAction[] }[];
}
const ranks: BlackjackRank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];
const suits: BlackjackSuit[] = ["♠", "♥", "♦", "♣"];
const counts = Array.from({ length: 15 }, (_, index) => index - 6);
let families: HandFamily[] | undefined;

// Derive the space of legal decisions from card combinations, not authored
// puzzles. Only structural possibilities are cached; each turn samples a new
// family, composition, count and presentation using the current rating.
function getFamilies(): HandFamily[] {
  if (families) return families;
  const grouped = new Map<string, HandFamily>();
  const add = (cards: BlackjackCard[]) => {
    if (handValue(cards).total >= 21) return;
    for (const rank of ranks) {
      const hand = { cards };
      const dealerUpcard = cardFromRank(rank);
      const key = trainerScenarioKey({ kind: "action", hand, dealerUpcard });
      const family = grouped.get(key) ?? { key, variants: [] };
      family.variants.push({ hand, dealerUpcard, availableActions: getAvailableActions(hand, dealerUpcard) });
      grouped.set(key, family);
    }
  };
  for (let a = 0; a < ranks.length; a++) {
    for (let b = a; b < ranks.length; b++) {
      add([cardFromRank(ranks[a]), cardFromRank(ranks[b])]);
    }
  }
  // Actual three-card hands naturally remove double, split and surrender.
  for (let a = 0; a < ranks.length; a++) {
    for (let b = a; b < ranks.length; b++) {
      for (let c = b; c < ranks.length; c++) {
        add([cardFromRank(ranks[a]), cardFromRank(ranks[b]), cardFromRank(ranks[c])]);
      }
    }
  }
  families = [...grouped.values()];
  return families;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

function weighted<T>(values: readonly T[], weight: (value: T) => number, random: () => number): T {
  const weights = values.map(weight);
  let remaining = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < values.length; i++) {
    remaining -= weights[i];
    if (remaining < 0) return values[i];
  }
  return values[values.length - 1];
}

function ratingLevel(elo: number): number {
  return Math.max(0, Math.min(1, (elo - 900) / 900));
}

export function trainerLevelLabel(elo: number): string {
  return elo < 1100 ? "Foundations" : elo < 1500 ? "Developing" : "Advanced";
}

export function createTrainerScenario(
  elo = 900,
  recentKeys: readonly string[] = [],
  random: () => number = Math.random,
): TrainerScenario {
  const level = ratingLevel(elo);
  const recent = new Set(recentKeys.slice(-TRAINER_REPEAT_WINDOW));
  if (!recent.has("insurance") && random() < 0.06) {
    const trueCount = weighted(counts, (count) => count === 0 ? 6 - 4 * level :
      count === 2 || count === 3 ? 2 + 6 * level : 1, random);
    return {
      kind: "insurance", hand: { cards: [cardFromRank(pick(ranks.slice(0, 8), random), pick(suits, random)), cardFromRank("10", pick(suits, random))] },
      dealerUpcard: cardFromRank("A", pick(suits, random)), trueCount,
      availableActions: [], difficulty: Math.abs(trueCount - 2.5) < 1 ? 1350 : 1050,
      lesson: trueCount >= 3 ? "deviation" : "reinforcement",
      nearThreshold: trueCount === 2 || trueCount === 3,
    };
  }

  const pools: Record<Lesson, TrainerScenario[]> = { foundation: [], reinforcement: [], deviation: [] };
  for (const family of getFamilies()) {
    if (recent.has(family.key)) continue;
    const twoCard = family.variants.filter((variant) => variant.hand.cards.length === 2);
    const multiCard = family.variants.filter((variant) => variant.hand.cards.length > 2);
    const variants = multiCard.length && (!twoCard.length || random() < 0.08 + 0.22 * level)
      ? multiCard : twoCard;
    const variant = pick(variants, random);
    const decisions = counts.map((count) => getOptimalAction(variant.hand, variant.dealerUpcard, count, BLACKJACK_RULES, variant.availableActions));
    const changesWithCount = new Set(decisions.map((decision) => decision.action)).size > 1;
    for (let i = 0; i < counts.length; i++) {
      const decision = decisions[i];
      const nearThreshold = (i > 0 && decisions[i - 1].action !== decision.action) ||
        (i + 1 < counts.length && decisions[i + 1].action !== decision.action);
      const lesson: Lesson = decision.deviationApplied ? "deviation" : changesWithCount ? "reinforcement" : "foundation";
      const value = handValue(variant.hand.cards);
      const foundationDifficulty = isPair(variant.hand.cards) || value.soft ? 1050 : value.total >= 12 && value.total <= 16 ? 900 : 750;
      pools[lesson].push({
        ...variant, kind: "action", trueCount: counts[i], lesson, nearThreshold,
        difficulty: (lesson === "foundation" ? foundationDifficulty : 1200 + (decision.deviationApplied ? 100 : 0) + (nearThreshold ? 150 : 0) + (decision.action === "split" ? 200 : 0)) + (variant.hand.cards.length > 2 ? 75 : 0),
      });
    }
  }
  const proportions: Record<Lesson, number> = {
    foundation: 0.66 - 0.46 * level,
    reinforcement: 0.22 + 0.16 * level,
    deviation: 0.12 + 0.30 * level,
  };
  const lessons = (Object.keys(pools) as Lesson[]).filter((lesson) => pools[lesson].length);
  // Never relax the repeat guard: the generated state space is much larger
  // than the window, including when a particular lesson pool is exhausted.
  const lesson = weighted(lessons, (item) => proportions[item], random);
  const chosen = weighted(pools[lesson], (scenario) => {
    const countWeight = scenario.trueCount === 0 ? 12 - 9 * level :
      Math.abs(scenario.trueCount) <= 2 ? 2 : 0.6 + level;
    const edgeWeight = scenario.nearThreshold ? 0.7 + 4 * level : 1;
    const difficultyWeight = 1 / (1 + Math.abs(scenario.difficulty - elo) / 400);
    return countWeight * edgeWeight * difficultyWeight;
  }, random);
  return {
    ...chosen,
    hand: { cards: chosen.hand.cards.map((card, index) => ({ ...card, suit: pick(suits, random), id: `trainer-card-${index}` })) },
    dealerUpcard: { ...chosen.dealerUpcard, suit: pick(suits, random) },
  };
}

export interface TrainerProgress {
  elo: number;
  answered: number;
  correct: number;
  recentKeys: string[];
}
export const defaultTrainerProgress: TrainerProgress = { elo: 900, answered: 0, correct: 0, recentKeys: [] };

export interface TrainerSession {
  progress: TrainerProgress;
  scenario: TrainerScenario;
  result: { chosen: BlackjackAction | InsuranceAction; correct: boolean; eloDelta: number } | null;
}

export function nextTrainerSession(progress: TrainerProgress, random: () => number = Math.random): TrainerSession {
  const scenario = createTrainerScenario(progress.elo, progress.recentKeys, random);
  return {
    progress: { ...progress, recentKeys: [...progress.recentKeys, trainerScenarioKey(scenario)].slice(-TRAINER_REPEAT_WINDOW) },
    scenario, result: null,
  };
}

export function answerTrainerSession(session: TrainerSession, chosen: BlackjackAction | InsuranceAction): TrainerSession {
  if (session.result) return session;
  const { scenario, progress } = session;
  if (scenario.kind === "action" ? !scenario.availableActions.includes(chosen as BlackjackAction) : !["insurance", "decline"].includes(chosen)) return session;
  const expected = scenario.kind === "insurance" ? getInsuranceAction(scenario.trueCount) :
    getOptimalAction(scenario.hand, scenario.dealerUpcard, scenario.trueCount, BLACKJACK_RULES, scenario.availableActions).action;
  const correct = chosen === expected;
  const expectedScore = 1 / (1 + 10 ** ((scenario.difficulty - progress.elo) / 400));
  const k = progress.answered < 30 ? 40 : 24;
  const elo = Math.max(400, Math.min(2400, progress.elo + Math.round(k * (Number(correct) - expectedScore))));
  return {
    ...session,
    progress: { ...progress, elo, answered: progress.answered + 1, correct: progress.correct + Number(correct) },
    result: { chosen, correct, eloDelta: elo - progress.elo },
  };
}

const STORAGE_KEY = "poker-training-pro:blackjack-trainer:v1";
let memoryProgress = defaultTrainerProgress;

export function loadTrainerProgress(): TrainerProgress {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return memoryProgress;
    const value = parsed as TrainerProgress;
    if (!Number.isInteger(value.elo) || value.elo < 400 || value.elo > 2400 ||
      !Number.isSafeInteger(value.answered) || value.answered < 0 ||
      !Number.isSafeInteger(value.correct) || value.correct < 0 || value.correct > value.answered ||
      !Array.isArray(value.recentKeys) || value.recentKeys.length > TRAINER_REPEAT_WINDOW ||
      value.recentKeys.some((key) => typeof key !== "string" || key.length > 80)) return memoryProgress;
    return { elo: value.elo, answered: value.answered, correct: value.correct, recentKeys: [...value.recentKeys] };
  } catch {
    return memoryProgress;
  }
}

export function saveTrainerProgress(progress: TrainerProgress): boolean {
  memoryProgress = progress;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
