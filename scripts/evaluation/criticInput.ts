import type { Card, Street } from "../../src/types/poker";
import type { ReviewCanonicalAction, ReviewObjective } from "../../src/modes/reviewEvidence";

export const REVIEWER_INPUT_SCHEMA_VERSION = 2 as const;
export const REVIEWER_OUTPUT_SCHEMA_VERSION = 2 as const;

export type ReviewerTask = "decision" | "session_public" | "style" | "diagnosis";

export interface ReviewerRules {
  game: "holdem";
  betting: "no_limit";
  forcedBets: string;
  rack: "smallest_chip" | "medium" | "unknown";
  objective: ReviewObjective;
}

export interface ReviewerPublicAction {
  actorAlias: string;
  street: Street;
  kind: "fold" | "check" | "call" | "bet" | "raise";
  targetChips: number;
}

export interface ReviewerTimeline {
  street: Street;
  board: Card[];
  actions: ReviewerPublicAction[];
}

export interface ReviewerGeometry {
  potBeforeChips: number;
  actualCallChips: number;
  targetChips: number;
  investedChips: number;
  raiseByChips: number;
  investmentOverPot: number | null;
  raiseOverPotAfterCall: number | null;
  actorStackChips: number;
  pairwiseRemainingDepth: number | null;
}

export interface ReviewerInputV2 {
  schemaVersion: typeof REVIEWER_INPUT_SCHEMA_VERSION;
  caseId: string;
  task: ReviewerTask;
  rules: ReviewerRules;
  actorAlias: "P1";
  ownCards?: Card[];
  publicTimeline: ReviewerTimeline;
  selectedAction?: ReviewCanonicalAction;
  legalActions: ReviewCanonicalAction[];
  geometry: ReviewerGeometry;
  observerTendencySummary: Array<{ context: string; counts: Record<string, number> }>;
  styleDescription?: string;
  initialVerdictId?: string;
}

export interface ReviewerDecisionSource {
  opaqueCaseId: string;
  task?: ReviewerTask;
  rules?: Partial<ReviewerRules>;
  actorId: string;
  actorCards: readonly Card[];
  publicPlayers: readonly { id: string; seat: number }[];
  street: Street;
  board: readonly Card[];
  publicActions: readonly { playerId: string; street: Street; kind: string; targetChips: number }[];
  selectedAction?: ReviewCanonicalAction;
  legalActions: readonly ReviewCanonicalAction[];
  geometry: ReviewerGeometry;
  observerTendencySummary?: readonly { context: string; counts: Readonly<Record<string, number>> }[];
  styleDescription?: string;
  initialVerdictId?: string;
}

export type ReviewerStrategicPlausibility = "concern" | "plausible" | "insufficient";
export type ReviewerWagerPlausibility = "concern" | "plausible" | "not_applicable" | "insufficient";
export type ReviewerStyleConsistency = "concern" | "consistent" | "not_provided" | "insufficient";

export type ReviewerFindingCategory =
  | "unsupported_stack_exposure"
  | "escalation_pattern"
  | "candidate_magnitude"
  | "denomination_pattern"
  | "missed_value_hypothesis"
  | "passive_defense_hypothesis"
  | "style_mismatch"
  | "input_inconsistency"
  | "other_hypothesis";

export interface ReviewerFinding {
  category: ReviewerFindingCategory;
  priority: "low" | "medium" | "high";
  evidencePaths: string[];
  claim: string;
  possibleJustification: string;
  requestedCheck: string;
  confidence: "low" | "medium" | "high";
}

export interface ReviewerOutputV2 {
  schemaVersion: typeof REVIEWER_OUTPUT_SCHEMA_VERSION;
  caseId: string;
  assessments: {
    strategicPlausibility: ReviewerStrategicPlausibility;
    wagerNumberPlausibility: ReviewerWagerPlausibility;
    styleConsistency: ReviewerStyleConsistency;
  };
  findings: ReviewerFinding[];
  missingInformation: string[];
  inputContradictions: string[];
  validationStatus: "valid" | "invalid_response" | "unvalidated";
}

function isCard(value: unknown): value is Card {
  return typeof value === "object" && value !== null &&
    typeof (value as { rank?: unknown }).rank === "string" &&
    typeof (value as { suit?: unknown }).suit === "string";
}

const FORBIDDEN_KEYS = new Set([
  "seed", "holeCards", "opponentCards", "hiddenCards", "futureBoard", "futureBoards",
  "outcome", "finalWinnings", "truth", "truthHash", "flags", "signals", "policy",
  "policyId", "modelId", "profile", "profileKey", "reproduction", "sourcePath",
  "sourceFilename", "internalId", "playerId", "opponentId", "deck", "burnCards",
]);

function assertNoForbiddenReviewerData(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenReviewerData(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Reviewer input contains forbidden field ${path}.${key}`);
    assertNoForbiddenReviewerData(entry, `${path}.${key}`);
  }
}

function assertFiniteGeometry(geometry: ReviewerGeometry): void {
  for (const [key, value] of Object.entries(geometry)) {
    if (value !== null && !Number.isFinite(value)) throw new Error(`Reviewer geometry field ${key} is not finite`);
  }
}

function normalizeKind(kind: string): ReviewerPublicAction["kind"] {
  if (kind === "fold" || kind === "check" || kind === "call" || kind === "bet" || kind === "raise") return kind;
  if (kind === "all-in") return "raise";
  throw new Error(`Unsupported public action kind ${kind}`);
}

function aliasesFor(source: ReviewerDecisionSource): Map<string, "P1" | "P2" | "P3" | "P4" | "P5" | "P6"> {
  const ids = [...new Set([source.actorId, ...source.publicPlayers.map((player) => player.id)])];
  const actorFirst = [source.actorId, ...ids.filter((id) => id !== source.actorId).sort()];
  if (actorFirst.length > 6) throw new Error("Reviewer input supports at most six public seat aliases");
  return new Map(actorFirst.map((id, index) => [id, `P${index + 1}` as "P1" | "P2" | "P3" | "P4" | "P5" | "P6"]));
}

function cloneAction(action: ReviewCanonicalAction): ReviewCanonicalAction {
  return {
    key: action.key,
    kind: action.kind,
    targetChips: action.targetChips,
    investedChips: action.investedChips,
    raisesCurrentBet: action.raisesCurrentBet,
    raiseByChips: action.raiseByChips,
    isActorAllIn: action.isActorAllIn,
    stackOffClass: action.stackOffClass,
    isFullRaise: action.isFullRaise,
    isShortAllInIncrease: action.isShortAllInIncrease,
  };
}

export function createReviewerInput(source: ReviewerDecisionSource): ReviewerInputV2 {
  if (source.actorCards.length !== 2) throw new Error("Reviewer decision input requires exactly two actor cards");
  if (new Set(source.actorCards.map((card) => `${card.rank}:${card.suit}`)).size !== source.actorCards.length) throw new Error("Reviewer actor cards must be unique");
  if (new Set(source.board.map((card) => `${card.rank}:${card.suit}`)).size !== source.board.length) throw new Error("Reviewer board must be unique");
  assertFiniteGeometry(source.geometry);
  const aliases = aliasesFor(source);
  const publicTimeline: ReviewerTimeline = {
    street: source.street,
    board: source.board.map((card) => ({ ...card })),
    actions: source.publicActions.map((entry) => ({
      actorAlias: aliases.get(entry.playerId) ?? "P6",
      street: entry.street,
      kind: normalizeKind(entry.kind),
      targetChips: entry.targetChips,
    })),
  };
  const input: ReviewerInputV2 = {
    schemaVersion: REVIEWER_INPUT_SCHEMA_VERSION,
    caseId: source.opaqueCaseId,
    task: source.task ?? "decision",
    rules: {
      game: "holdem",
      betting: "no_limit",
      forcedBets: source.rules?.forcedBets ?? "actual_forced_bets_redacted_to_public_amounts",
      rack: source.rules?.rack ?? "medium",
      objective: source.rules?.objective ?? "chip_ev",
    },
    actorAlias: "P1",
    ownCards: source.task === "session_public" || source.task === "style" ? undefined : source.actorCards.map((card) => ({ ...card })),
    publicTimeline,
    selectedAction: source.selectedAction ? cloneAction(source.selectedAction) : undefined,
    legalActions: source.legalActions.map(cloneAction),
    geometry: { ...source.geometry },
    observerTendencySummary: (source.observerTendencySummary ?? []).map((entry) => ({ context: entry.context, counts: { ...entry.counts } })),
    ...(source.task === "style" && source.styleDescription ? { styleDescription: source.styleDescription } : {}),
    ...(source.task === "diagnosis" && source.initialVerdictId ? { initialVerdictId: source.initialVerdictId } : {}),
  };
  assertReviewerInputSafe(input);
  return input;
}

export const buildBlindedCriticInput = createReviewerInput;

export function assertReviewerInputSafe(input: ReviewerInputV2): void {
  if (input.schemaVersion !== REVIEWER_INPUT_SCHEMA_VERSION) throw new Error("Unsupported reviewer input schema");
  if (!/^P1$/.test(input.actorAlias)) throw new Error("Reviewer actor alias must be P1");
  if (input.task === "decision" && (!input.ownCards || input.ownCards.length !== 2)) throw new Error("Decision reviewer input requires actor cards");
  if (input.task === "session_public" && input.ownCards) throw new Error("Session-public input may not include actor cards");
  assertFiniteGeometry(input.geometry);
  for (const action of input.legalActions) {
    if (!Number.isSafeInteger(action.targetChips) || action.targetChips < 0) throw new Error("Reviewer legal action target must be a non-negative integer");
  }
  assertNoForbiddenReviewerData(input);
  const serialized = JSON.stringify(input);
  if (/Wesley|seed|profile|opponent|holeCards|futureBoard|finalWinnings/i.test(serialized)) {
    throw new Error("Reviewer input contains a forbidden sentinel");
  }
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function serializeReviewerInput(input: ReviewerInputV2): string {
  assertReviewerInputSafe(input);
  return stableJson(input);
}

export function reviewerInputHash(input: ReviewerInputV2): string {
  let hash = 0x811c9dc5;
  for (const character of serializeReviewerInput(input)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pointerParts(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Evidence path is not a JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function resolveReviewerEvidencePath(value: unknown, pointer: string): unknown {
  let current = value;
  for (const part of pointerParts(pointer)) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (typeof current === "object" && current !== null) current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

const FINDING_CATEGORIES = new Set<ReviewerFindingCategory>([
  "unsupported_stack_exposure", "escalation_pattern", "candidate_magnitude", "denomination_pattern",
  "missed_value_hypothesis", "passive_defense_hypothesis", "style_mismatch", "input_inconsistency", "other_hypothesis",
]);

export interface ReviewerValidationResult {
  valid: boolean;
  status: "valid" | "invalid_response";
  errors: string[];
}

export function validateReviewerOutput(input: ReviewerInputV2, output: unknown): ReviewerValidationResult {
  const errors: string[] = [];
  if (typeof output !== "object" || output === null) return { valid: false, status: "invalid_response", errors: ["response_not_object"] };
  const candidate = output as Partial<ReviewerOutputV2>;
  if (candidate.schemaVersion !== REVIEWER_OUTPUT_SCHEMA_VERSION) errors.push("schema_version");
  if (candidate.caseId !== input.caseId) errors.push("case_id_mismatch");
  const assessments = candidate.assessments;
  if (!assessments || !["concern", "plausible", "insufficient"].includes(assessments.strategicPlausibility ?? "")) errors.push("strategic_assessment");
  if (!assessments || !["concern", "plausible", "not_applicable", "insufficient"].includes(assessments.wagerNumberPlausibility ?? "")) errors.push("wager_assessment");
  if (!assessments || !["concern", "consistent", "not_provided", "insufficient"].includes(assessments.styleConsistency ?? "")) errors.push("style_assessment");
  if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.missingInformation) || !Array.isArray(candidate.inputContradictions)) errors.push("array_fields");
  for (const [index, finding] of (candidate.findings ?? []).entries()) {
    if (!finding || !FINDING_CATEGORIES.has(finding.category)) errors.push(`finding_${index}_category`);
    if (!finding || !["low", "medium", "high"].includes(finding.priority)) errors.push(`finding_${index}_priority`);
    if (!finding || !Array.isArray(finding.evidencePaths) || finding.evidencePaths.some((pointer) => typeof pointer !== "string" || resolveReviewerEvidencePath(input, pointer) === undefined)) errors.push(`finding_${index}_evidence_path`);
    if (!finding || !finding.claim || !finding.possibleJustification || !finding.requestedCheck) errors.push(`finding_${index}_claim_fields`);
    if (!finding || !["low", "medium", "high"].includes(finding.confidence)) errors.push(`finding_${index}_confidence`);
  }
  if (assessments?.strategicPlausibility === "concern" && (candidate.findings?.length ?? 0) === 0) errors.push("concern_without_finding");
  if (assessments?.strategicPlausibility === "insufficient" && (candidate.missingInformation?.length ?? 0) === 0) errors.push("insufficient_without_missing_information");
  return { valid: errors.length === 0, status: errors.length === 0 ? "valid" : "invalid_response", errors };
}

export const validateCriticOutput = validateReviewerOutput;

export function parseReviewerOutput(input: ReviewerInputV2, raw: unknown): ReviewerOutputV2 {
  const validation = validateReviewerOutput(input, raw);
  if (!validation.valid) throw new Error(`invalid_response:${validation.errors.join(",")}`);
  return { ...(raw as ReviewerOutputV2), validationStatus: "valid" };
}

export function cardLike(value: unknown): boolean {
  return isCard(value);
}
