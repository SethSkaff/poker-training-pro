import type {
  MathTopic,
  PokerAction,
  Street,
  TrainingScenario,
} from "../types/poker";

export const TRAINING_SCENARIO_SCHEMA_VERSION = "1.0.0";
export const TRAINING_SCENARIO_CONTENT_VERSION = "2026.07.23.1";

export const TRAINING_SCENARIO_UNITS = [
  "%",
  "chips",
  "outs",
  "ratio",
] as const;

export interface TrainingScenarioMetadata {
  /** Elo-like difficulty ratings are intentionally frozen during a release. */
  decisionDifficulty: number;
  mathDifficulty: number;
  /** Net action EVs in big blinds under the assumptions stated by the scenario. */
  actionEvs: Partial<Record<PokerAction, number>>;
  /** Regret at or below this value receives full decision credit. */
  actionEpsilon: number;
  /** Regret at or below this value receives partial decision credit. */
  partialCreditRegret: number;
  transferGroup: string;
  targetDecisionMs: number;
  targetMathMs: number;
  evaluatorVersion: string;
}

export interface TrainingScenarioSource {
  kind: "internal-analysis" | "published-reference";
  label: string;
  reference: string;
  verificationStatus: "pending-human-review" | "verified";
}

export interface TrainingScenarioReview {
  status: "pending" | "approved" | "changes-requested";
  reviewerId: string | null;
  reviewedAt: string | null;
  notes: string;
}

export type RatedTrainingScenario = TrainingScenario & {
  schemaVersion: typeof TRAINING_SCENARIO_SCHEMA_VERSION;
  contentVersion: string;
  source: TrainingScenarioSource;
  review: TrainingScenarioReview;
  training: TrainingScenarioMetadata;
};

export const PENDING_INTERNAL_SCENARIO_METADATA = Object.freeze({
  schemaVersion: TRAINING_SCENARIO_SCHEMA_VERSION,
  contentVersion: TRAINING_SCENARIO_CONTENT_VERSION,
  source: Object.freeze({
    kind: "internal-analysis" as const,
    label: "Poker Training Pro internal scenario analysis",
    reference: "internal:training-scenarios-v1",
    verificationStatus: "pending-human-review" as const,
  }),
  review: Object.freeze({
    status: "pending" as const,
    reviewerId: null,
    reviewedAt: null,
    notes:
      "Requires independent poker-math and instructional review before release.",
  }),
});

const RANKS = new Set([
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
]);
const SUITS = new Set(["clubs", "diamonds", "hearts", "spades"]);
const STREETS = new Set<Street>(["preflop", "flop", "turn", "river"]);
const ACTIONS = new Set<PokerAction>([
  "fold",
  "check",
  "call",
  "raise",
  "all-in",
]);
const TOPICS = new Set<MathTopic>([
  "pot-odds",
  "equity",
  "outs",
  "implied-odds",
  "expected-value",
  "stack-to-pot-ratio",
  "minimum-defense-frequency",
  "tournament-pressure",
]);
const UNITS = new Set<string>(TRAINING_SCENARIO_UNITS);
const PLAYER_STATUSES = new Set(["active", "folded", "all-in", "out"]);
const BOARD_CARD_COUNT: Record<Street, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};
const CONTENT_VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function chipAmount(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown, minimumLength = 1): value is string {
  return typeof value === "string" && value.trim().length >= minimumLength;
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key}: unknown field.`);
  }
}

function validateCard(
  value: unknown,
  path: string,
  errors: string[],
): string | undefined {
  if (!isRecord(value)) {
    errors.push(`${path}: must be a card object.`);
    return undefined;
  }
  validateKnownKeys(value, ["rank", "suit"], path, errors);
  if (!RANKS.has(String(value.rank))) {
    errors.push(`${path}.rank: unknown card rank.`);
  }
  if (!SUITS.has(String(value.suit))) {
    errors.push(`${path}.suit: unknown card suit.`);
  }
  return `${String(value.rank)}-${String(value.suit)}`;
}

function validateText(
  value: unknown,
  path: string,
  errors: string[],
  minimumLength = 1,
): void {
  if (!nonEmpty(value, minimumLength)) {
    errors.push(`${path}: must contain at least ${minimumLength} non-whitespace characters.`);
  }
}

function validateSource(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("source: metadata is required.");
    return;
  }
  validateKnownKeys(
    value,
    ["kind", "label", "reference", "verificationStatus"],
    "source",
    errors,
  );
  if (!["internal-analysis", "published-reference"].includes(String(value.kind))) {
    errors.push("source.kind: must be a known source kind.");
  }
  validateText(value.label, "source.label", errors, 5);
  validateText(value.reference, "source.reference", errors, 5);
  if (!["pending-human-review", "verified"].includes(String(value.verificationStatus))) {
    errors.push("source.verificationStatus: must be pending-human-review or verified.");
  }
}

function validateReview(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("review: metadata is required.");
    return;
  }
  validateKnownKeys(
    value,
    ["status", "reviewerId", "reviewedAt", "notes"],
    "review",
    errors,
  );
  const status = String(value.status);
  if (!["pending", "approved", "changes-requested"].includes(status)) {
    errors.push("review.status: must be pending, approved, or changes-requested.");
  }
  const reviewerValid =
    value.reviewerId === null || nonEmpty(value.reviewerId, 2);
  const reviewedAtValid =
    value.reviewedAt === null ||
    (nonEmpty(value.reviewedAt) &&
      Number.isFinite(Date.parse(value.reviewedAt)));
  if (!reviewerValid) errors.push("review.reviewerId: must be null or a non-empty id.");
  if (!reviewedAtValid) errors.push("review.reviewedAt: must be null or an ISO date.");
  validateText(value.notes, "review.notes", errors, 10);
  if (status === "approved" && (value.reviewerId === null || value.reviewedAt === null)) {
    errors.push("review: approved content requires a reviewer id and review date.");
  }
  if (status === "pending" && (value.reviewerId !== null || value.reviewedAt !== null)) {
    errors.push("review: pending content must not claim a reviewer or review date.");
  }
}

/**
 * `source.verificationStatus` and `review.status` describe the same fact and
 * must not be able to disagree.
 *
 * Each was validated in isolation, so a scenario could claim its analysis was
 * `verified` while its review was still `pending` -- a claim of human sign-off
 * with no reviewer and no date attached to it. That is the one failure mode
 * this metadata exists to prevent, and it is the failure mode a *generator*
 * would produce by default: content with a plausible provenance block and no
 * human in the loop (E15-002).
 *
 * The rule runs one way only. `verified` requires an approved review, but an
 * approved review may sit alongside `pending-human-review` -- an instructional
 * reviewer approving the wording does not by itself verify the mathematics.
 */
function validateReviewProvenanceAgreement(
  source: unknown,
  review: unknown,
  errors: string[],
): void {
  if (!isRecord(source) || !isRecord(review)) return;
  if (
    source.verificationStatus === "verified" &&
    review.status !== "approved"
  ) {
    errors.push(
      "source.verificationStatus: cannot be verified while review.status is " +
        `${JSON.stringify(review.status)}. Verified provenance requires an approved review.`,
    );
  }
}

function legalActionsForScenario(scenario: Record<string, unknown>): Set<PokerAction> {
  const legal = new Set<PokerAction>(["fold"]);
  const call = finite(scenario.amountToCall) ? scenario.amountToCall : 0;
  const minRaise = finite(scenario.minimumRaise) ? scenario.minimumRaise : 0;
  const players = Array.isArray(scenario.players) ? scenario.players : [];
  const hero = players.find(
    (player) =>
      isRecord(player) &&
      player.seat === scenario.heroSeat,
  );
  const heroStack = isRecord(hero) && finite(hero.stack) ? hero.stack : 0;
  if (call === 0) legal.add("check");
  if (call > 0 && heroStack >= call) legal.add("call");
  if (minRaise > 0 && heroStack > call) legal.add("raise");
  if (heroStack > 0) legal.add("all-in");
  return legal;
}

function validateMathQuestion(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("mathQuestion: exactly one math question object is required.");
    return;
  }
  validateKnownKeys(
    value,
    ["topic", "prompt", "unit", "correctValue", "tolerance", "explanation"],
    "mathQuestion",
    errors,
  );
  if (!TOPICS.has(value.topic as MathTopic)) {
    errors.push("mathQuestion.topic: unknown math topic.");
  }
  validateText(value.prompt, "mathQuestion.prompt", errors, 20);
  validateText(value.explanation, "mathQuestion.explanation", errors, 20);
  if (!UNITS.has(String(value.unit))) {
    errors.push("mathQuestion.unit: unknown answer unit.");
  }
  if (!finite(value.correctValue)) {
    errors.push("mathQuestion.correctValue: must be finite.");
  }
  if (!finite(value.tolerance) || value.tolerance < 0) {
    errors.push("mathQuestion.tolerance: must be finite and non-negative.");
  }
  if (value.unit === "%") {
    if (finite(value.correctValue) && (value.correctValue < 0 || value.correctValue > 100)) {
      errors.push("mathQuestion.correctValue: percentage must be between 0 and 100.");
    }
    if (finite(value.tolerance) && value.tolerance > 5) {
      errors.push("mathQuestion.tolerance: percentage tolerance cannot exceed 5 points.");
    }
  } else if (value.unit === "outs") {
    if (
      finite(value.correctValue) &&
      (!Number.isInteger(value.correctValue) ||
        value.correctValue < 0 ||
        value.correctValue > 47)
    ) {
      errors.push("mathQuestion.correctValue: outs must be an integer from 0 through 47.");
    }
  } else if (value.unit === "chips") {
    if (finite(value.correctValue) && !Number.isSafeInteger(value.correctValue)) {
      errors.push("mathQuestion.correctValue: chip answers must be whole chips.");
    }
    if (finite(value.tolerance) && !Number.isSafeInteger(value.tolerance)) {
      errors.push("mathQuestion.tolerance: chip tolerance must be whole chips.");
    }
  } else if (value.unit === "ratio") {
    if (finite(value.correctValue) && value.correctValue < 0) {
      errors.push("mathQuestion.correctValue: ratios cannot be negative.");
    }
    if (finite(value.tolerance) && value.tolerance > 1) {
      errors.push("mathQuestion.tolerance: ratio tolerance cannot exceed 1.");
    }
  }
}

function validateTrainingMetadata(
  value: unknown,
  legalActions: ReadonlySet<PokerAction>,
  recommendedAction: unknown,
  acceptableActions: unknown,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("training: rating metadata is required.");
    return;
  }
  validateKnownKeys(
    value,
    [
      "decisionDifficulty",
      "mathDifficulty",
      "actionEvs",
      "actionEpsilon",
      "partialCreditRegret",
      "transferGroup",
      "targetDecisionMs",
      "targetMathMs",
      "evaluatorVersion",
    ],
    "training",
    errors,
  );
  for (const field of ["decisionDifficulty", "mathDifficulty"] as const) {
    if (!finite(value[field]) || value[field] <= 0) {
      errors.push(`training.${field}: must be finite and positive.`);
    }
  }
  if (!finite(value.actionEpsilon) || value.actionEpsilon < 0) {
    errors.push("training.actionEpsilon: must be finite and non-negative.");
  }
  if (
    !finite(value.partialCreditRegret) ||
    value.partialCreditRegret < 0 ||
    (finite(value.actionEpsilon) &&
      value.partialCreditRegret < value.actionEpsilon)
  ) {
    errors.push(
      "training.partialCreditRegret: must be finite and at least actionEpsilon.",
    );
  }
  for (const field of ["targetDecisionMs", "targetMathMs"] as const) {
    if (!finite(value[field]) || !Number.isSafeInteger(value[field]) || value[field] <= 0) {
      errors.push(`training.${field}: must be a positive whole number of milliseconds.`);
    }
  }
  validateText(value.transferGroup, "training.transferGroup", errors, 3);
  if (
    !nonEmpty(value.evaluatorVersion) ||
    !/^trainer-\d+\.\d+(?:\.\d+)?$/.test(value.evaluatorVersion)
  ) {
    errors.push("training.evaluatorVersion: must use trainer-MAJOR.MINOR[.PATCH].");
  }

  if (!isRecord(value.actionEvs) || Object.keys(value.actionEvs).length === 0) {
    errors.push("training.actionEvs: at least one action EV is required.");
    return;
  }
  const actionEntries: Array<[PokerAction, number]> = [];
  for (const [action, ev] of Object.entries(value.actionEvs)) {
    if (!ACTIONS.has(action as PokerAction)) {
      errors.push(`training.actionEvs.${action}: unknown poker action.`);
    } else if (!legalActions.has(action as PokerAction)) {
      errors.push(`training.actionEvs.${action}: action is illegal in this state.`);
    }
    if (!finite(ev)) {
      errors.push(`training.actionEvs.${action}: EV must be finite.`);
    } else if (ACTIONS.has(action as PokerAction)) {
      actionEntries.push([action as PokerAction, ev]);
    }
  }
  if (actionEntries.length === 0) return;
  const bestEv = Math.max(...actionEntries.map(([, ev]) => ev));
  const epsilon = finite(value.actionEpsilon) ? value.actionEpsilon : 0;
  const checkAccepted = (action: unknown, label: string) => {
    if (!ACTIONS.has(action as PokerAction)) return;
    const ev = isRecord(value.actionEvs) ? value.actionEvs[String(action)] : undefined;
    if (!finite(ev)) {
      errors.push(`${label}: action has no finite EV.`);
    } else if (bestEv - ev > epsilon + Number.EPSILON) {
      errors.push(`${label}: action exceeds the full-credit EV epsilon.`);
    }
  };
  checkAccepted(recommendedAction, "recommendedAction");
  if (Array.isArray(acceptableActions)) {
    for (const action of acceptableActions) {
      checkAccepted(action, `acceptableActions.${String(action)}`);
    }
  }
}

export function validateTrainingScenario(scenario: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(scenario)) return ["Scenario must be an object."];
  validateKnownKeys(
    scenario,
    [
      "id",
      "title",
      "difficulty",
      "street",
      "blinds",
      "ante",
      "heroSeat",
      "buttonSeat",
      "pot",
      "amountToCall",
      "minimumRaise",
      "heroCards",
      "board",
      "players",
      "prompt",
      "recommendedAction",
      "acceptableActions",
      "actionReason",
      "mathQuestion",
      "tags",
      "schemaVersion",
      "contentVersion",
      "source",
      "review",
      "training",
    ],
    "scenario",
    errors,
  );
  if (!nonEmpty(scenario.id) || !SLUG.test(scenario.id)) {
    errors.push("id: must be a non-empty lowercase kebab-case id.");
  }
  validateText(scenario.title, "title", errors, 5);
  validateText(scenario.prompt, "prompt", errors, 20);
  validateText(scenario.actionReason, "actionReason", errors, 20);
  if (
    !finite(scenario.difficulty) ||
    !Number.isInteger(scenario.difficulty) ||
    scenario.difficulty < 1 ||
    scenario.difficulty > 5
  ) {
    errors.push("difficulty: must be an integer from 1 through 5.");
  }
  const street = scenario.street as Street;
  if (!STREETS.has(street)) errors.push("street: unknown poker street.");
  if (scenario.schemaVersion !== TRAINING_SCENARIO_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion: expected supported version ${TRAINING_SCENARIO_SCHEMA_VERSION}.`,
    );
  }
  if (!nonEmpty(scenario.contentVersion) || !CONTENT_VERSION.test(scenario.contentVersion)) {
    errors.push("contentVersion: must use YYYY.MM.DD.REVISION.");
  }
  validateSource(scenario.source, errors);
  validateReview(scenario.review, errors);
  validateReviewProvenanceAgreement(scenario.source, scenario.review, errors);

  if (
    !Array.isArray(scenario.blinds) ||
    scenario.blinds.length !== 2 ||
    !chipAmount(scenario.blinds[0]) ||
    !chipAmount(scenario.blinds[1]) ||
    scenario.blinds[0] <= 0 ||
    scenario.blinds[1] <= scenario.blinds[0]
  ) {
    errors.push("blinds: require positive whole-chip [small, big] blinds with big > small.");
  }
  if (scenario.ante !== undefined && !chipAmount(scenario.ante)) {
    errors.push("ante: must be a non-negative whole-chip amount.");
  }
  for (const field of ["pot", "amountToCall", "minimumRaise"] as const) {
    if (!chipAmount(scenario[field])) {
      errors.push(`${field}: must be a non-negative whole-chip amount.`);
    }
  }

  const cardKeys: string[] = [];
  if (!Array.isArray(scenario.heroCards) || scenario.heroCards.length !== 2) {
    errors.push("heroCards: hero must have exactly two cards.");
  } else {
    scenario.heroCards.forEach((card, index) => {
      const key = validateCard(card, `heroCards.${index}`, errors);
      if (key) cardKeys.push(key);
    });
  }
  const expectedBoardCards = STREETS.has(street)
    ? BOARD_CARD_COUNT[street]
    : undefined;
  if (!Array.isArray(scenario.board)) {
    errors.push("board: must be an array.");
  } else {
    if (
      expectedBoardCards !== undefined &&
      scenario.board.length !== expectedBoardCards
    ) {
      errors.push(
        `board: ${street} scenarios require ${expectedBoardCards} board cards.`,
      );
    }
    scenario.board.forEach((card, index) => {
      const key = validateCard(card, `board.${index}`, errors);
      if (key) cardKeys.push(key);
    });
  }
  if (new Set(cardKeys).size !== cardKeys.length) {
    errors.push("Hero cards and board must not contain duplicate cards.");
  }

  if (
    !Array.isArray(scenario.players) ||
    scenario.players.length < 2 ||
    scenario.players.length > 10
  ) {
    errors.push("players: table must contain 2 through 10 players.");
  } else {
    const ids = new Set<string>();
    const seats = new Set<number>();
    for (const [index, rawPlayer] of scenario.players.entries()) {
      const path = `players.${index}`;
      if (!isRecord(rawPlayer)) {
        errors.push(`${path}: must be a player object.`);
        continue;
      }
      validateKnownKeys(
        rawPlayer,
        ["id", "name", "stack", "seat", "status", "bet", "cards", "personality"],
        path,
        errors,
      );
      if (!nonEmpty(rawPlayer.id) || !SLUG.test(rawPlayer.id)) {
        errors.push(`${path}.id: must be lowercase kebab-case.`);
      } else if (ids.has(rawPlayer.id)) {
        errors.push(`${path}.id: player ids must be unique.`);
      } else {
        ids.add(rawPlayer.id);
      }
      validateText(rawPlayer.name, `${path}.name`, errors, 1);
      if (
        !finite(rawPlayer.seat) ||
        !Number.isInteger(rawPlayer.seat) ||
        rawPlayer.seat < 1 ||
        rawPlayer.seat > 10
      ) {
        errors.push(`${path}.seat: must be an integer from 1 through 10.`);
      } else if (seats.has(rawPlayer.seat)) {
        errors.push(`${path}.seat: player seats must be unique.`);
      } else {
        seats.add(rawPlayer.seat);
      }
      if (!chipAmount(rawPlayer.stack)) {
        errors.push(`${path}.stack: must be a non-negative whole-chip amount.`);
      }
      if (!chipAmount(rawPlayer.bet)) {
        errors.push(`${path}.bet: must be a non-negative whole-chip amount.`);
      }
      if (!PLAYER_STATUSES.has(String(rawPlayer.status))) {
        errors.push(`${path}.status: unknown player status.`);
      }
      if (rawPlayer.status === "all-in" && rawPlayer.stack !== 0) {
        errors.push(`${path}: an all-in player must have zero chips behind.`);
      }
      if (rawPlayer.status === "out" && (rawPlayer.stack !== 0 || rawPlayer.bet !== 0)) {
        errors.push(`${path}: an eliminated player cannot have chips or a live bet.`);
      }
      if (rawPlayer.cards !== undefined) {
        if (!Array.isArray(rawPlayer.cards) || rawPlayer.cards.length !== 2) {
          errors.push(`${path}.cards: visible hole cards require exactly two cards.`);
        } else {
          rawPlayer.cards.forEach((card, cardIndex) => {
            const key = validateCard(card, `${path}.cards.${cardIndex}`, errors);
            if (key) cardKeys.push(key);
          });
        }
      }
    }
    if (!seats.has(Number(scenario.heroSeat))) {
      errors.push("heroSeat: must identify a player at the table.");
    }
    if (!seats.has(Number(scenario.buttonSeat))) {
      errors.push("buttonSeat: must identify a player at the table.");
    }
    const hero = scenario.players.find(
      (player) => isRecord(player) && player.seat === scenario.heroSeat,
    );
    if (isRecord(hero) && hero.status !== "active") {
      errors.push("heroSeat: hero must be active for a one-decision scenario.");
    }
    if (
      isRecord(hero) &&
      chipAmount(hero.stack) &&
      chipAmount(scenario.amountToCall) &&
      scenario.amountToCall > hero.stack
    ) {
      errors.push("amountToCall: cannot exceed the hero stack.");
    }
    if (
      isRecord(hero) &&
      chipAmount(hero.stack) &&
      chipAmount(hero.bet) &&
      chipAmount(scenario.amountToCall)
    ) {
      const highestLiveBet = scenario.players.reduce((highest, player) => {
        if (
          !isRecord(player) ||
          !["active", "all-in"].includes(String(player.status)) ||
          !chipAmount(player.bet)
        ) {
          return highest;
        }
        return Math.max(highest, player.bet);
      }, 0);
      const expectedCall = Math.min(
        hero.stack,
        Math.max(0, highestLiveBet - hero.bet),
      );
      if (scenario.amountToCall !== expectedCall) {
        errors.push(
          `amountToCall: expected ${expectedCall} from the live bets and hero stack.`,
        );
      }
    }
  }
  if (new Set(cardKeys).size !== cardKeys.length) {
    errors.push("cards: all visible cards must be unique.");
  }

  const legalActions = legalActionsForScenario(scenario);
  if (!ACTIONS.has(scenario.recommendedAction as PokerAction)) {
    errors.push("recommendedAction: unknown poker action.");
  } else if (!legalActions.has(scenario.recommendedAction as PokerAction)) {
    errors.push("recommendedAction: action is illegal in this state.");
  }
  if (scenario.acceptableActions !== undefined) {
    if (!Array.isArray(scenario.acceptableActions)) {
      errors.push("acceptableActions: must be an array.");
    } else {
      const accepted = new Set<unknown>();
      for (const action of scenario.acceptableActions) {
        if (!ACTIONS.has(action as PokerAction)) {
          errors.push(`acceptableActions.${String(action)}: unknown poker action.`);
        } else if (!legalActions.has(action as PokerAction)) {
          errors.push(`acceptableActions.${String(action)}: action is illegal in this state.`);
        }
        if (accepted.has(action)) {
          errors.push(`acceptableActions.${String(action)}: duplicate action.`);
        }
        accepted.add(action);
      }
    }
  }

  validateMathQuestion(scenario.mathQuestion, errors);
  if (!Array.isArray(scenario.tags) || scenario.tags.length < 2) {
    errors.push("tags: at least two tags are required.");
  } else {
    const tags = new Set<string>();
    for (const tag of scenario.tags) {
      if (!nonEmpty(tag) || !SLUG.test(tag)) {
        errors.push(`tags.${String(tag)}: tags must be lowercase kebab-case.`);
      }
      if (tags.has(String(tag))) errors.push(`tags.${String(tag)}: duplicate tag.`);
      tags.add(String(tag));
    }
    if (STREETS.has(street) && !tags.has(street)) {
      errors.push(`tags: must include the scenario street "${street}".`);
    }
  }
  validateTrainingMetadata(
    scenario.training,
    legalActions,
    scenario.recommendedAction,
    scenario.acceptableActions,
    errors,
  );
  return [...new Set(errors)];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function trainingScenarioStructuralFingerprint(
  scenario: RatedTrainingScenario,
): string {
  const players = scenario.players
    .map(({ seat, stack, status, bet }) => ({ seat, stack, status, bet }))
    .sort((left, right) => left.seat - right.seat);
  const cards = (scenario.heroCards ?? [])
    .map((card) => `${card.rank}-${card.suit}`)
    .sort();
  const board = (scenario.board ?? [])
    .map((card) => `${card.rank}-${card.suit}`)
    .sort();
  return JSON.stringify(
    stableValue({
      street: scenario.street,
      blinds: scenario.blinds,
      ante: scenario.ante ?? 0,
      heroSeat: scenario.heroSeat,
      buttonSeat: scenario.buttonSeat,
      pot: scenario.pot,
      amountToCall: scenario.amountToCall,
      minimumRaise: scenario.minimumRaise,
      heroCards: cards,
      board,
      players,
    }),
  );
}

export function validateTrainingScenarioBank(
  scenarios: readonly unknown[],
): string[] {
  const errors = scenarios.flatMap((scenario, index) => {
    const id = isRecord(scenario) && nonEmpty(scenario.id)
      ? scenario.id
      : `<scenario-${index}>`;
    return validateTrainingScenario(scenario).map(
      (message) => `${id}: ${message}`,
    );
  });
  const ids = new Map<string, number>();
  const structures = new Map<string, string>();
  for (const [index, scenario] of scenarios.entries()) {
    if (!isRecord(scenario) || !nonEmpty(scenario.id)) continue;
    const previousIndex = ids.get(scenario.id);
    if (previousIndex !== undefined) {
      errors.push(
        `${scenario.id}: duplicate scenario id (also at index ${previousIndex}).`,
      );
    } else {
      ids.set(scenario.id, index);
    }
    if (validateTrainingScenario(scenario).length > 0) continue;
    const typed = scenario as unknown as RatedTrainingScenario;
    const fingerprint = trainingScenarioStructuralFingerprint(typed);
    const previousId = structures.get(fingerprint);
    if (previousId !== undefined) {
      errors.push(
        `${typed.id}: structurally duplicates scenario ${previousId}.`,
      );
    } else {
      structures.set(fingerprint, typed.id);
    }
  }
  return [...new Set(errors)];
}

export function stableTrainingScenarioJson(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
