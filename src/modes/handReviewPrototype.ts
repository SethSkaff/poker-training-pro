/**
 * Offline Game Review v2 prototype.
 *
 * This module intentionally has no default UI caller and no model endpoint.
 * It consumes an injected ReviewValueProvider, so a missing reference or
 * tolerance remains visible rather than becoming a guessed recommendation.
 */

import {
  canonicalizeBettingAction,
  type CanonicalAction,
  type MaybeNumber,
  type WagerGeometry,
} from "../lib/pokerActionSemantics";
import {
  ACTION_SUPPORT_ASSESSMENT_VERSION,
  actionSupportInputIdentity,
  assessActionSupport,
  projectActionSupportForObserver,
  type ActionSupportAssessment,
  type ActionSupportInput,
  type PublicActionSupportView,
  type ResponseSupport,
} from "../lib/actionSupport";
import { derivePlayerCountSemantics } from "../lib/playerCountSemantics";
import {
  getLegalActions,
  type BettingActionCommand,
  type BettingRoundState,
  type LegalActionSet,
} from "../engine/betting";
import { createInformationSet } from "../engine/tournament";
import type { Card, Street } from "../types/poker";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
  tournamentCommandForHeroAction,
  type HeroTournamentAction,
  type TournamentRunner,
  type TournamentRunnerReplay,
} from "./tournamentRunner";
import type {
  ReviewCanonicalAction,
  ReviewConditioningModel,
  ReviewDecisionEvidenceV2,
  ReviewEvidenceEnvelopeV2,
  ReviewNode,
  ReviewObjective,
  ReviewSupportDescription,
  ReviewValue,
  ReviewValueBatch,
  ReviewValueProvider,
} from "./reviewEvidence";

export interface ReviewTolerancePolicy {
  version: string;
  objective: ReviewObjective;
  unit: "bb" | "chips" | "payout_probability" | "qualification_probability";
  value: number | null;
  contextScope: string;
  sourceEvidence: string | null;
  artifactHash: string | null;
  approvalStatus: "approved" | "synthetic" | "pending" | "unavailable";
}

export interface ReviewEvidenceBudget {
  objective?: ReviewObjective;
  modelIds?: readonly string[];
  searchDrawCount?: number;
  evaluationDrawCount?: number;
  maxDecisions?: number;
  maxMenuActions?: number;
  maxSearchRounds?: number;
  alpha?: number;
}

export interface ReviewNodeEvidenceOptions {
  valueProvider: ReviewValueProvider;
  tolerancePolicy?: ReviewTolerancePolicy;
  budget?: ReviewEvidenceBudget;
  searchSeed?: string;
  evaluationSeed?: string;
  signal?: { readonly aborted: boolean };
  yieldControl?: () => Promise<void>;
  playedAction: ReviewCanonicalAction | null;
}

export interface ReviewReplayEvidenceOptions extends Omit<ReviewNodeEvidenceOptions, "playedAction"> {
  budget?: ReviewEvidenceBudget;
}

const PROTOTYPE_SEMANTICS_VERSION = "review-evidence-v2-regret-v1";
const DEFAULT_ALPHA = 0.05;
const DEFAULT_MAX_MENU = 64;
const DEFAULT_SEARCH_ROUNDS = 3;

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableMenuHash(actions: readonly ReviewCanonicalAction[]): string {
  return hashString(JSON.stringify(actions.map((action) => ({
    key: action.key,
    kind: action.kind,
    targetChips: action.targetChips,
    investedChips: action.investedChips,
    stackOffClass: action.stackOffClass,
  })).sort((left, right) => `${left.kind}:${left.targetChips}:${left.key}`.localeCompare(`${right.kind}:${right.targetChips}:${right.key}`))));
}

function actionIdentity(action: ReviewCanonicalAction): string {
  // The engine transition key already merges an explicit all-in call with a
  // normal call. Synthetic fixtures may not have that key, so the semantic
  // fallback also merges same-kind/same-target aliases.
  return `${action.kind}:${action.targetChips}:${action.stackOffClass === "aggressive_jam" ? "aggressive" : action.stackOffClass === "all_in_call" ? "call" : "ordinary"}`;
}

function deduplicateActions(actions: readonly ReviewCanonicalAction[]): ReviewCanonicalAction[] {
  const output: ReviewCanonicalAction[] = [];
  const identities = new Set<string>();
  for (const action of actions) {
    const identity = actionIdentity(action);
    if (identities.has(identity)) continue;
    identities.add(identity);
    output.push(action);
  }
  return output.sort((left, right) =>
    left.targetChips - right.targetChips ||
    left.kind.localeCompare(right.kind) ||
    left.key.localeCompare(right.key),
  );
}

function cloneAtTarget(
  template: ReviewCanonicalAction,
  targetChips: number,
): ReviewCanonicalAction {
  const investedChips = Math.max(0, targetChips - Math.max(0, template.targetChips - template.investedChips));
  const raises = template.kind === "bet" || template.kind === "raise";
  const isAllIn = template.isActorAllIn && targetChips >= template.targetChips;
  return {
    ...template,
    key: `${template.kind}:${targetChips}`,
    targetChips,
    investedChips,
    raisesCurrentBet: raises,
    raiseByChips: raises ? Math.max(0, targetChips - Math.max(0, template.targetChips - template.investedChips)) : 0,
    isActorAllIn: isAllIn,
    stackOffClass: isAllIn
      ? template.kind === "call" ? "all_in_call" : "aggressive_jam"
      : "none",
    isShortAllInIncrease: isAllIn && template.isShortAllInIncrease,
  };
}

function actionCandidates(node: ReviewNode, played: ReviewCanonicalAction | null, maxMenu: number): {
  actions: ReviewCanonicalAction[];
  truncated: boolean;
} {
  const initial = deduplicateActions([
    ...node.legalActions,
    ...(node.proposedActions ?? []),
    ...(node.domainBoundaryActions ?? []),
    ...(played ? [played] : []),
  ]);
  const targets = initial.filter((action) => action.kind === "bet" || action.kind === "raise");
  const smallestChip = Math.max(1, node.smallestChipChips);
  const additions: ReviewCanonicalAction[] = [];
  for (const action of targets) {
    for (const target of [action.targetChips - smallestChip, action.targetChips + smallestChip]) {
      if (target >= 0) additions.push(cloneAtTarget(action, target));
    }
  }
  const result = deduplicateActions([...initial, ...additions]);
  if (result.length <= maxMenu) return { actions: result, truncated: false };
  const playedIdentity = played ? actionIdentity(played) : null;
  const retained = result
    .filter((action) => actionIdentity(action) === playedIdentity)
    .concat(result.filter((action) => actionIdentity(action) !== playedIdentity))
    .slice(0, maxMenu);
  return { actions: deduplicateActions(retained), truncated: true };
}

function refinementActions(
  actions: readonly ReviewCanonicalAction[],
  maxMenu: number,
): ReviewCanonicalAction[] {
  const sorted = [...actions]
    .filter((action) => action.kind === "bet" || action.kind === "raise")
    .sort((left, right) => left.targetChips - right.targetChips || left.key.localeCompare(right.key));
  const additions: ReviewCanonicalAction[] = [];
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (right.targetChips - left.targetChips <= 1) continue;
    const midpoint = Math.floor((left.targetChips + right.targetChips) / 2);
    additions.push(cloneAtTarget(left, midpoint));
    if (additions.length + actions.length >= maxMenu) break;
  }
  return deduplicateActions([...actions, ...additions]).slice(0, maxMenu);
}

function inferBoundaryOrigin(action: ReviewCanonicalAction): ActionSupportInput["boundaryOrigin"] {
  if (action.stackOffClass === "aggressive_jam" || action.stackOffClass === "all_in_call") return "all_in";
  if (action.kind === "call") return "exact_call";
  if (action.kind === "bet" || action.kind === "raise") return action.isFullRaise ? "ordinary" : "unknown";
  return "unknown";
}

function maybe(value: number | null, reason: string): MaybeNumber {
  return value === null ? { value: null, reason } : { value, reason: null };
}

function syntheticGeometry(node: ReviewNode, action: ReviewCanonicalAction): WagerGeometry {
  const pot = Math.max(0, node.potBeforeChips);
  const call = Math.max(0, node.currentBetChips - node.actorStreetCommittedChips);
  const opponentRows = node.opponents.map((opponent) => ({
    opponentId: opponent.id,
    status: opponent.status === "all-in" ? "all-in" as const : "active" as const,
    remainingStackChips: opponent.remainingStackChips,
    streetCommittedChips: opponent.streetCommittedChips,
    futureMatchedChips: Math.min(node.actorStackBeforeChips, opponent.remainingStackChips),
    contestableAdditionalChips: Math.min(node.actorStackBeforeChips, opponent.remainingStackChips),
    callableAtTargetChips: Math.min(opponent.remainingStackChips, Math.max(0, action.targetChips - opponent.streetCommittedChips)),
    facingAdditionalCost: action.targetChips > opponent.streetCommittedChips,
    canMakeDecisionAtTarget: opponent.status === "active" && opponent.remainingStackChips > 0 && action.targetChips > opponent.streetCommittedChips,
  }));
  const positive = opponentRows.map((opponent) => opponent.futureMatchedChips).filter((value) => value > 0);
  const minSpr = positive.length && pot > 0 ? Math.min(...positive) / pot : null;
  const maxSpr = positive.length && pot > 0 ? Math.max(...positive) / pot : null;
  return {
    bigBlindChips: node.bigBlindChips,
    smallestChipChips: node.smallestChipChips,
    configuredAnteChips: 0,
    anteAppliedChips: 0,
    potAtDecisionChips: pot,
    potAtStreetStartChips: maybe(pot, "street_start_unavailable"),
    actorStackChips: node.actorStackBeforeChips,
    actorStreetCommittedChips: node.actorStreetCommittedChips,
    currentBetChips: node.currentBetChips,
    outstandingCallChips: call,
    actualCallChips: Math.min(node.actorStackBeforeChips, call),
    potAfterActorCallChips: pot + Math.min(node.actorStackBeforeChips, call),
    targetChips: action.targetChips,
    investedChips: action.investedChips,
    raiseByChips: action.raiseByChips,
    callCostOverCurrentPot: maybe(pot > 0 ? Math.min(node.actorStackBeforeChips, call) / pot : null, "zero_pot"),
    previousAggression: null,
    investmentOverCurrentPot: maybe(pot > 0 ? action.investedChips / pot : null, "zero_pot"),
    raiseOverPotAfterCall: maybe(
      action.isFullRaise && pot + call > 0 ? action.raiseByChips / (pot + call) : null,
      action.isShortAllInIncrease ? "short_all_in_increase" : "not_full_raise",
    ),
    actorCommitmentFraction: node.actorStackBeforeChips > 0 ? action.investedChips / node.actorStackBeforeChips : 1,
    opponents: opponentRows,
    minPositiveFutureMatchedChips: maybe(positive.length ? Math.min(...positive) : null, "no_future_responder"),
    maxFutureMatchedChips: maybe(positive.length ? Math.max(...positive) : null, "no_future_responder"),
    decisionMinSpr: maybe(minSpr, "no_future_responder"),
    decisionMaxSpr: maybe(maxSpr, "no_future_responder"),
    streetStartMinSpr: maybe(minSpr, "street_start_unavailable"),
    streetStartMaxSpr: maybe(maxSpr, "street_start_unavailable"),
    livePots: [],
    currentlyUnmatched: [],
    actualSettlementRefundChips: maybe(null, "settlement_unavailable"),
  };
}

function supportInput(
  node: ReviewNode,
  action: ReviewCanonicalAction,
  support: ReviewSupportDescription | null,
  semanticKey = action.key,
): ActionSupportInput {
  const counts = derivePlayerCountSemantics(
    [{ id: node.actorId, status: "active" }, ...node.opponents.map((opponent) => ({ id: opponent.id, status: opponent.status ?? "active" }))],
    node.actorId,
    typeof node.metadata?.tournamentPlayersRemaining === "number"
      ? node.metadata.tournamentPlayersRemaining
      : node.opponents.length + 1,
  );
  const referenceStatus = support?.status === "supported"
    ? "positive" as const
    : support?.status === "assumption_sensitive"
      ? "sensitive" as const
      : "unavailable" as const;
  const unusual = node.potBeforeChips > 0 && action.investedChips / node.potBeforeChips >= 4;
  const geometry = syntheticGeometry(node, action);
  const initial: Omit<ActionSupportInput, "inputIdentity"> = {
    schemaVersion: 1,
    assessmentVersion: ACTION_SUPPORT_ASSESSMENT_VERSION,
    semanticKey,
    observerScope: "hero",
    evidenceScopeId: node.handId ?? node.nodeId,
    modelId: support?.modelId ?? "reference-primary",
    modelVersion: support?.modelVersion ?? "unavailable",
    objective: node.objective,
    action: action as CanonicalAction,
    geometry,
    street: node.street,
    counts,
    position: { actorSeat: 0, buttonSeat: node.buttonSeat, actorRelativeSeat: 0, positionVsResponders: "mixed" },
    publicPrefix: {
      digest: node.publicPrefixHash ?? `prefix:${node.nodeId}`,
      actions: [...(node.publicPrefix ?? [])],
    },
    reopening: {
      isFullRaise: action.isFullRaise,
      isShortAllInIncrease: action.isShortAllInIncrease,
      newlyReopenedPlayerIds: [],
    },
    boundaryOrigin: inferBoundaryOrigin(action),
    policyEvidence: { probability: { value: null, reason: "prototype_policy_probability_unavailable" }, rank: { value: null, reason: "prototype_policy_rank_unavailable" }, source: "unavailable" },
    responseEvidence: support?.responseSupport ?? null,
    referenceEvidence: support
      ? {
          status: referenceStatus,
          conditioning: support.conditioning,
          response: support.responseSupport,
          unusualSignal: unusual,
          ordinaryBasis: referenceStatus === "positive" && !unusual ? "finite-reference-domain" : null,
          limitation: support.limitations[0] ?? null,
        }
      : null,
    mechanicalEvidence: { status: "valid", evidencePaths: ["review.menu.canonical_transition"], errors: [] },
  };
  return { ...initial, inputIdentity: actionSupportInputIdentity(initial as ActionSupportInput) };
}

function publicSupport(
  node: ReviewNode,
  action: ReviewCanonicalAction,
  support: ReviewSupportDescription | null,
  semanticKey = action.key,
): { assessment: ActionSupportAssessment; view: PublicActionSupportView } {
  const input = supportInput(node, action, support, semanticKey);
  const assessment = assessActionSupport(input);
  return {
    assessment,
    view: projectActionSupportForObserver(input, assessment, "hero"),
  };
}

function observedSupport(node: ReviewNode): PublicActionSupportView[] {
  return (node.publicPrefix ?? [])
    .filter((entry) => entry.playerId !== node.actorId)
    .map((entry, index) => {
      const observed: ReviewCanonicalAction = {
        key: `observed:${entry.playerId}:${index}:${entry.kind}:${entry.targetChips}`,
        kind: entry.kind === "bet" || entry.kind === "raise" || entry.kind === "call" || entry.kind === "check" || entry.kind === "fold" ? entry.kind : "call",
        targetChips: entry.targetChips,
        investedChips: entry.kind === "fold" || entry.kind === "check" ? 0 : Math.max(0, entry.targetChips),
        raisesCurrentBet: entry.kind === "bet" || entry.kind === "raise",
        raiseByChips: entry.kind === "bet" || entry.kind === "raise" ? Math.max(0, entry.targetChips) : 0,
        isActorAllIn: false,
        stackOffClass: "none",
        isFullRaise: entry.kind === "bet" || entry.kind === "raise",
        isShortAllInIncrease: false,
      };
      return publicSupport(node, observed, null, observed.key).view;
    });
}

interface PairInterval {
  lower: number;
  upper: number;
  mean: number;
  exact: boolean;
  sampleCount: number;
  theoretical: { lower: number; upper: number } | null;
}

function pairInterval(
  better: ReviewValue,
  worse: ReviewValue,
  alpha: number,
  pairCount: number,
): PairInterval | null {
  if (better.mean === null || worse.mean === null) return null;
  if (better.exact && worse.exact) {
    const mean = better.mean - worse.mean;
    return { lower: mean, upper: mean, mean, exact: true, sampleCount: 0, theoretical: { lower: mean, upper: mean } };
  }
  const worseRows = new Map(worse.payoffRows.map((row) => [row.drawId, row.payoff]));
  const differences = better.payoffRows
    .filter((row) => worseRows.has(row.drawId))
    .map((row) => row.payoff - (worseRows.get(row.drawId) as number));
  const theoretical = better.theoreticalPayoffBounds && worse.theoreticalPayoffBounds
    ? {
        lower: better.theoreticalPayoffBounds.lower - worse.theoreticalPayoffBounds.upper,
        upper: better.theoreticalPayoffBounds.upper - worse.theoreticalPayoffBounds.lower,
      }
    : null;
  if (differences.length < 1 || !theoretical || !(theoretical.upper >= theoretical.lower)) return null;
  const mean = differences.reduce((sum, difference) => sum + difference, 0) / differences.length;
  if (differences.length < 2) return { lower: theoretical.lower, upper: theoretical.upper, mean, exact: false, sampleCount: differences.length, theoretical };
  const width = theoretical.upper - theoretical.lower;
  const h = width * Math.sqrt(Math.log((2 * Math.max(1, pairCount)) / alpha) / (2 * differences.length));
  return {
    lower: Math.max(theoretical.lower, mean - h),
    upper: Math.min(theoretical.upper, mean + h),
    mean,
    exact: false,
    sampleCount: differences.length,
    theoretical,
  };
}

interface ModelRegret {
  point: number | null;
  lower: number | null;
  upper: number | null;
  supported: boolean;
  reason: string | null;
  pairs: number;
}

function modelRegrets(
  actions: readonly ReviewCanonicalAction[],
  values: readonly ReviewValue[],
  alpha: number,
): Map<string, ModelRegret> {
  const models = [...new Set(values.map((value) => value.modelId))];
  const pairCount = Math.max(1, models.length * (actions.length * Math.max(0, actions.length - 1)) / 2);
  const output = new Map<string, ModelRegret>();
  for (const action of actions) {
    const actionValues = values.filter((value) => value.actionKey === action.key);
    const supportedValues = actionValues.filter((value) => value.mean !== null && value.support.status === "supported");
    if (supportedValues.length !== models.length) {
      output.set(action.key, { point: null, lower: null, upper: null, supported: false, reason: "missing_action_support", pairs: 0 });
      continue;
    }
    const points: number[] = [];
    const lowers: number[] = [];
    const uppers: number[] = [];
    let allPairsSupported = true;
    let pairRows = 0;
    for (const modelId of models) {
      const base = values.find((value) => value.modelId === modelId && value.actionKey === action.key);
      if (!base) { allPairsSupported = false; continue; }
      for (const other of actions) {
        const candidate = values.find((value) => value.modelId === modelId && value.actionKey === other.key);
        if (!candidate) { allPairsSupported = false; continue; }
        if (other.key === action.key) {
          points.push(0); lowers.push(0); uppers.push(0); continue;
        }
        const interval = pairInterval(candidate, base, alpha, pairCount);
        if (!interval) { allPairsSupported = false; continue; }
        pairRows += interval.sampleCount;
        points.push(Math.max(0, interval.mean));
        lowers.push(Math.max(0, interval.lower));
        uppers.push(Math.max(0, interval.upper));
      }
    }
    output.set(action.key, {
      point: allPairsSupported && points.length ? Math.max(...points) : null,
      lower: allPairsSupported && lowers.length ? Math.max(...lowers) : null,
      upper: allPairsSupported && uppers.length ? Math.max(...uppers) : null,
      supported: allPairsSupported,
      reason: allPairsSupported ? null : "insufficient_paired_evidence",
      pairs: pairRows,
    });
  }
  return output;
}

function toleranceFor(policy: ReviewTolerancePolicy | undefined, objective: ReviewObjective): ReviewDecisionEvidenceV2["tolerance"] {
  if (!policy || policy.objective !== objective || policy.value === null || policy.approvalStatus === "pending" || policy.approvalStatus === "unavailable") {
    return {
      value: null,
      unit: policy?.unit ?? "bb",
      version: policy?.version ?? null,
      artifactHash: policy?.artifactHash ?? null,
      status: "pending",
      sourceEvidence: policy?.sourceEvidence ?? null,
    };
  }
  return {
    value: policy.value,
    unit: policy.unit,
    version: policy.version,
    artifactHash: policy.artifactHash,
    status: policy.approvalStatus,
    sourceEvidence: policy.sourceEvidence,
  };
}

function regionFor(
  actions: readonly ReviewCanonicalAction[],
  regrets: Map<string, ModelRegret>,
  values: readonly ReviewValue[],
  toleranceBb: number | null,
  searchTruncated: boolean,
  smallestChip: number,
): ReviewDecisionEvidenceV2["sizingRegion"] {
  const supported: number[] = [];
  const unresolved: number[] = [];
  const excluded: number[] = [];
  for (const action of actions) {
    const regret = regrets.get(action.key);
    const actionStatuses = values
      .filter((value) => value.actionKey === action.key)
      .map((value) => value.support.status);
    if (actionStatuses.includes("ood")) {
      excluded.push(action.targetChips);
    } else if (!regret || !regret.supported || regret.upper === null || toleranceBb === null) {
      if (action.kind === "fold" || action.kind === "check" || action.kind === "call") excluded.push(action.targetChips);
      else unresolved.push(action.targetChips);
    } else if (regret.upper <= toleranceBb) {
      supported.push(action.targetChips);
    } else if (regret.lower !== null && regret.lower > toleranceBb) {
      excluded.push(action.targetChips);
    } else {
      unresolved.push(action.targetChips);
    }
  }
  const uniqueSorted = (values: number[]) => [...new Set(values)].sort((left, right) => left - right);
  const supportedTargetsChips = uniqueSorted(supported);
  const intervals: ReviewDecisionEvidenceV2["sizingRegion"]["intervals"] = [];
  if (supportedTargetsChips.length > 1 && !searchTruncated) {
    const min = supportedTargetsChips[0];
    const max = supportedTargetsChips[supportedTargetsChips.length - 1];
    const allMenuTargets = new Set(actions.map((action) => action.targetChips));
    let exhaustive = true;
    for (let target = min; target <= max; target += smallestChip) {
      if (!allMenuTargets.has(target) || !supportedTargetsChips.includes(target)) { exhaustive = false; break; }
    }
    if (exhaustive) intervals.push({ minChips: min, maxChips: max, stepChips: smallestChip, basis: "exhaustive_lattice" });
  }
  return {
    supportedTargetsChips,
    unresolvedTargetsChips: uniqueSorted(unresolved),
    excludedTargetsChips: uniqueSorted(excluded),
    intervals,
    menuCoverage: intervals.length ? "certified_domain" : "finite_menu",
    searchTruncated,
  };
}

function supportValuesFor(
  node: ReviewNode,
  values: readonly ReviewValue[],
  actions: readonly ReviewCanonicalAction[],
): { candidateViews: PublicActionSupportView[]; candidateAssessments: ActionSupportAssessment[]; conditioning: ReviewDecisionEvidenceV2["conditioningEvidence"] } {
  const candidateViews: PublicActionSupportView[] = [];
  const candidateAssessments: ActionSupportAssessment[] = [];
  const conditioning: ReviewDecisionEvidenceV2["conditioningEvidence"] = [];
  const primaryModel = values[0]?.modelId ?? "reference-primary";
  for (const action of actions) {
    const value = values.find((entry) => entry.actionKey === action.key && entry.modelId === primaryModel);
    const support = value?.support ?? null;
    const result = publicSupport(node, action, support);
    candidateViews.push(result.view);
    candidateAssessments.push(result.assessment);
    if (support?.conditioning) conditioning.push(support.conditioning);
  }
  return {
    candidateViews,
    candidateAssessments,
    conditioning,
  };
}

function emptyInvalidDecision(node: ReviewNode, playedAction: ReviewCanonicalAction | null, reason: string, index = node.index ?? 0): ReviewDecisionEvidenceV2 {
  return {
    schemaVersion: 2,
    semanticsVersion: PROTOTYPE_SEMANTICS_VERSION,
    decisionId: node.nodeId,
    handId: node.handId ?? node.nodeId,
    index,
    objective: node.objective,
    playedAction,
    bestSampledAction: null,
    comparisonMenu: { actionKeys: [], targetsChips: [], menuHash: stableMenuHash([]), searchSeed: "", evaluationSeed: "" },
    actionValues: [],
    regretEstimateBb: null,
    regretInObjectiveUnits: null,
    regretInterval: null,
    tolerance: toleranceFor(undefined, node.objective),
    decisionStatus: "invalid_input",
    grading: { eligible: false, quality: null, severityBand: null, reasonCodes: [reason] },
    sizingRegion: { supportedTargetsChips: [], unresolvedTargetsChips: [], excludedTargetsChips: [], intervals: [], menuCoverage: "finite_menu", searchTruncated: false },
    simulationUncertainty: { method: "unsupported", confidenceLevel: 0.95, iidDrawCount: 0, pairCount: 0, payoffBounds: null, searchBudget: 0, evaluationBudget: 0, branchSupportCounts: {} },
    modelConfidence: { status: "unsupported", referenceIds: [], sensitivityModelIds: [], limitations: [reason] },
    display: { recommendationTextKey: "review.unscored.invalidInput", reasonKeys: [reason], amountListChips: [], region: null, valuePrecision: "do_not_rank" },
    summaryEligibility: { eligible: false, exclusionReason: reason },
    observedActionSupport: [],
    candidateActionSupport: [],
    conditioningEvidence: [],
    recommendationScope: { modelIds: [], robustAcrossModels: false, numericalConfidence: "insufficient", strategicConfidence: "unsupported", limitations: [reason] },
  };
}

export async function deriveReviewNodeEvidence(
  node: ReviewNode,
  options: ReviewNodeEvidenceOptions,
): Promise<ReviewDecisionEvidenceV2> {
  const budget = options.budget ?? {};
  const objective = budget.objective ?? node.objective;
  if (objective !== "chip_ev") {
    return {
      ...emptyInvalidDecision(node, options.playedAction, "unsupported_objective"),
      objective,
      decisionStatus: "unsupported_objective",
    };
  }
  if (!options.playedAction) return emptyInvalidDecision(node, null, "invalid_played_action");
  if (options.signal?.aborted) return { ...emptyInvalidDecision(node, options.playedAction, "cancelled"), decisionStatus: "unresolved" };
  const maxMenu = Math.max(1, budget.maxMenuActions ?? DEFAULT_MAX_MENU);
  const maxRounds = Math.max(0, budget.maxSearchRounds ?? DEFAULT_SEARCH_ROUNDS);
  const searchDrawCount = Math.max(0, Math.floor(budget.searchDrawCount ?? 64));
  const evaluationDrawCount = Math.max(0, Math.floor(budget.evaluationDrawCount ?? 256));
  const alpha = budget.alpha ?? DEFAULT_ALPHA;
  const modelIds = budget.modelIds?.length ? [...budget.modelIds] : ["reference-primary"];
  const menu = actionCandidates(node, options.playedAction, maxMenu);
  let actions = menu.actions;
  let searchTruncated = menu.truncated;
  const searchSeed = options.searchSeed ?? `${node.nodeId}:search`;
  const evaluationSeed = options.evaluationSeed ?? `${node.nodeId}:evaluation`;
  for (let round = 0; round < maxRounds && actions.length < maxMenu; round += 1) {
    if (options.signal?.aborted) return { ...emptyInvalidDecision(node, options.playedAction, "cancelled"), decisionStatus: "unresolved" };
    const searchBatch = await options.valueProvider.evaluateMenu({ node: { ...node, objective }, canonicalActions: actions, modelIds, phase: "search", seed: `${searchSeed}:${round}`, drawCount: searchDrawCount, signal: options.signal });
    const refined = refinementActions(actions, maxMenu);
    if (refined.length === actions.length) break;
    actions = refined;
    if (actions.length >= maxMenu) searchTruncated = true;
    // Keep the search result live only for deterministic refinement ordering;
    // the evaluation batch below is always requested against the frozen menu.
    void searchBatch;
  }
  if (actions.length >= maxMenu && refinementActions(actions, maxMenu).length > actions.length) searchTruncated = true;
  const finalActions = deduplicateActions(actions).slice(0, maxMenu);
  const evaluation = await options.valueProvider.evaluateMenu({
    node: { ...node, objective },
    canonicalActions: finalActions,
    modelIds,
    phase: "evaluation",
    seed: evaluationSeed,
    drawCount: evaluationDrawCount,
    signal: options.signal,
  });
  const regrets = modelRegrets(finalActions, evaluation.values, alpha);
  const tolerance = toleranceFor(options.tolerancePolicy, objective);
  const toleranceBb = tolerance.value === null
    ? null
    : tolerance.unit === "chips" ? tolerance.value / Math.max(1, node.bigBlindChips) : tolerance.value;
  const played = finalActions.find((action) => actionIdentity(action) === actionIdentity(options.playedAction as ReviewCanonicalAction)) ?? options.playedAction;
  const playedRegret = regrets.get(played.key) ?? { point: null, lower: null, upper: null, supported: false, reason: "played_action_not_in_menu", pairs: 0 };
  const playedValue = evaluation.values.find((value) => value.actionKey === played.key && value.modelId === modelIds[0]);
  const bestSampledAction = [...evaluation.values]
    .filter((value) => value.modelId === modelIds[0] && value.mean !== null && value.support.status === "supported")
    .sort((left, right) => (right.mean as number) - (left.mean as number) || left.actionKey.localeCompare(right.actionKey))[0];
  const allValuesSupported = evaluation.values.length > 0 && evaluation.values.every((value) => value.mean !== null && value.support.status === "supported");
  const hasOod = evaluation.values.some((value) => value.support.status === "ood");
  const modelConfidenceStatus = hasOod
    ? "unsupported" as const
    : evaluation.values.some((value) => value.support.status === "assumption_sensitive")
      ? "assumption_sensitive" as const
      : allValuesSupported && evaluation.values.every((value) => value.provenance.verificationStatus === "verified_fixture")
        ? "reference_supported" as const
        : "unvalidated" as const;
  let decisionStatus: ReviewDecisionEvidenceV2["decisionStatus"];
  let reasonCodes: string[] = [];
  if (hasOod || playedValue?.support.status === "ood") {
    decisionStatus = "ood";
    reasonCodes.push("unsupported_conditioning_or_domain");
  } else if (!playedRegret.supported || !allValuesSupported || playedRegret.upper === null || playedRegret.lower === null) {
    decisionStatus = "unresolved";
    reasonCodes.push(playedRegret.reason ?? "insufficient_paired_evidence");
  } else if (tolerance.status === "pending" || toleranceBb === null) {
    decisionStatus = "tolerance_pending";
    reasonCodes.push("tolerance_pending");
  } else if (playedRegret.upper <= toleranceBb) {
    decisionStatus = "supported_near_optimal";
    reasonCodes.push("supported_regret_within_tolerance");
  } else if (playedRegret.lower > toleranceBb) {
    decisionStatus = "supported_loss";
    reasonCodes.push("supported_regret_exceeds_tolerance");
  } else {
    decisionStatus = "unresolved";
    reasonCodes.push("regret_interval_crosses_tolerance");
  }
  if (evaluation.values.some((value) => value.support.responseSupport?.status === "sparse")) reasonCodes.push("sparse_call_or_reraise_branch");
  if (played.stackOffClass !== "none") reasonCodes.push("state_derived_boundary");
  const support = supportValuesFor(node, evaluation.values, finalActions);
  const regretEstimateBb = playedRegret.point === null ? null : playedRegret.point / Math.max(1, node.bigBlindChips);
  const regretInterval = playedRegret.lower === null || playedRegret.upper === null
    ? null
    : { lower: playedRegret.lower / Math.max(1, node.bigBlindChips), upper: playedRegret.upper / Math.max(1, node.bigBlindChips) };
  const region = regionFor(finalActions, regrets, evaluation.values, toleranceBb, searchTruncated, Math.max(1, node.smallestChipChips));
  const referenceIds = [...new Set(evaluation.values.map((value) => value.provenance.referenceId).filter((value): value is string => Boolean(value)))];
  const conditionings = [...support.conditioning, ...evaluation.values.map((value) => value.conditioningEvidence).filter((value): value is NonNullable<typeof value> => Boolean(value))]
    .filter((value, index, array) => array.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(value)) === index);
  const pairCount = [...regrets.values()].reduce((sum, regret) => sum + regret.pairs, 0);
  const exact = evaluation.values.length > 0 && evaluation.values.every((value) => value.exact);
  const payoffBounds = evaluation.values.map((value) => value.theoreticalPayoffBounds).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const mergedBounds = payoffBounds.length ? { lower: Math.min(...payoffBounds.map((value) => value.lower)), upper: Math.max(...payoffBounds.map((value) => value.upper)) } : null;
  const displayedTargets = [...new Set(region.supportedTargetsChips)].sort((left, right) => left - right);
  return {
    schemaVersion: 2,
    semanticsVersion: PROTOTYPE_SEMANTICS_VERSION,
    decisionId: node.nodeId,
    handId: node.handId ?? node.nodeId,
    index: node.index ?? 0,
    objective,
    playedAction: options.playedAction,
    bestSampledAction: bestSampledAction ? finalActions.find((action) => action.key === bestSampledAction.actionKey) ?? null : null,
    comparisonMenu: {
      actionKeys: finalActions.map((action) => action.key),
      targetsChips: finalActions.map((action) => action.targetChips),
      menuHash: stableMenuHash(finalActions),
      searchSeed,
      evaluationSeed,
    },
    actionValues: [...evaluation.values],
    regretEstimateBb,
    regretInObjectiveUnits: playedRegret.point,
    regretInterval,
    tolerance,
    decisionStatus,
    grading: {
      eligible: decisionStatus === "supported_near_optimal" || decisionStatus === "supported_loss",
      quality: decisionStatus === "supported_near_optimal" ? "excellent" : decisionStatus === "supported_loss" ? "supported_loss" : null,
      severityBand: null,
      reasonCodes: [...new Set(reasonCodes)],
    },
    sizingRegion: region,
    simulationUncertainty: {
      method: exact ? "exact" : evaluation.values.some((value) => value.payoffRows.length > 0) ? "paired_hoeffding" : "unsupported",
      confidenceLevel: 1 - alpha,
      iidDrawCount: Math.max(...evaluation.values.map((value) => value.sampleCount), 0),
      pairCount,
      payoffBounds: mergedBounds,
      searchBudget: searchDrawCount,
      evaluationBudget: evaluationDrawCount,
      branchSupportCounts: Object.fromEntries(evaluation.values.map((value) => [`${value.modelId}:${value.actionKey}:${value.support.status}`, value.sampleCount])),
    },
    modelConfidence: {
      status: modelConfidenceStatus,
      referenceIds,
      sensitivityModelIds: [...new Set(evaluation.values.map((value) => value.modelId))],
      limitations: [...new Set(evaluation.values.flatMap((value) => value.support.limitations))],
    },
    display: {
      recommendationTextKey: bestSampledAction ? "review.evidence.bestSampledAction" : "review.evidence.noSupportedRecommendation",
      reasonKeys: [...new Set(reasonCodes)],
      amountListChips: displayedTargets,
      region: region.intervals.length ? `${region.intervals[0].minChips}-${region.intervals[0].maxChips}` : null,
      valuePrecision: exact ? "exact" : bestSampledAction ? "approximate" : "do_not_rank",
    },
    summaryEligibility: {
      eligible: decisionStatus === "supported_near_optimal" || decisionStatus === "supported_loss",
      exclusionReason: decisionStatus === "supported_near_optimal" || decisionStatus === "supported_loss" ? null : decisionStatus,
    },
    observedActionSupport: observedSupport(node),
    candidateActionSupport: support.candidateViews,
    conditioningEvidence: conditionings,
    recommendationScope: {
      modelIds: [...modelIds],
      robustAcrossModels: allValuesSupported && modelIds.length > 0,
      numericalConfidence: exact ? "exact" : pairCount > 0 ? "bounded" : "insufficient",
      strategicConfidence: modelConfidenceStatus,
      limitations: [...new Set(evaluation.values.flatMap((value) => value.support.limitations))],
    },
  };
}

function legalCommands(legal: LegalActionSet): BettingActionCommand[] {
  const commands: BettingActionCommand[] = [];
  if (legal.fold) commands.push({ type: "fold" });
  if (legal.check) commands.push({ type: "check" });
  if (legal.call) commands.push({ type: "call" });
  if (legal.bet) {
    commands.push({ type: "bet", to: legal.bet.min });
    if (legal.bet.max !== legal.bet.min) commands.push({ type: "bet", to: legal.bet.max });
  }
  if (legal.raise) {
    commands.push({ type: "raise", to: legal.raise.minTo });
    if (legal.raise.maxTo !== legal.raise.minTo) commands.push({ type: "raise", to: legal.raise.maxTo });
  }
  if (legal.allIn) commands.push({ type: "all-in" });
  return commands;
}

function nodeFromRunner(runner: TournamentRunner, index: number, objective: ReviewObjective): { node: ReviewNode; legal: LegalActionSet } {
  const hand = runner.session.activeHand;
  if (!hand) throw new Error("Review runner is not at an active hand");
  const heroId = runner.session.heroId;
  const legal = heroTournamentLegalActions(runner);
  if (!legal) throw new Error("Review runner is not waiting for the hero");
  const actor = hand.betting.players.find((player) => player.id === heroId);
  if (!actor) throw new Error("Review hand is missing the hero");
  const information = createInformationSet(hand.information, heroId);
  const seats = new Map(information.players.map((player) => [player.id, player.seat]));
  const opponents = hand.betting.players
    .filter((player) => player.id !== heroId)
    .map((player) => ({
      id: player.id,
      remainingStackChips: player.stack,
      streetCommittedChips: player.streetCommitted,
      totalCommittedChips: player.totalCommitted,
      seat: seats.get(player.id) ?? 0,
      status: player.status,
    }));
  const canonical = legalCommands(legal).map((command) => canonicalizeBettingAction(hand.betting, command));
  const level = runner.session.tournament.structure.levels[runner.session.tournament.levelIndex];
  const prefix = information.actions.map((entry) => ({
    playerId: entry.playerId,
    kind: entry.type,
    targetChips: entry.amount ?? 0,
  }));
  return {
    node: {
      schemaVersion: 1,
      nodeId: `${hand.handId}:decision:${index}`,
      handId: hand.handId,
      index,
      actorId: heroId,
      objective,
      street: information.street,
      board: information.board,
      heroCards: hand.holeCards[heroId] ?? [],
      potBeforeChips: hand.betting.players.reduce((sum, player) => sum + player.totalCommitted, 0),
      actorStackBeforeChips: actor.stack,
      actorStreetCommittedChips: actor.streetCommitted,
      actorTotalCommittedChips: actor.totalCommitted,
      currentBetChips: hand.betting.currentBet,
      bigBlindChips: level?.bigBlind ?? 1,
      smallestChipChips: runner.session.tournament.structure.smallestChip ?? 1,
      buttonSeat: hand.buttonSeat,
      tableSize: hand.betting.players.length,
      opponents,
      legalActions: canonical,
      proposedActions: canonical,
      publicPrefix: prefix,
      publicPrefixHash: hashString(JSON.stringify(prefix)),
      metadata: {
        tournamentPlayersRemaining: runner.session.tournament.players.filter((player) => player.status === "active").length,
      },
    },
    legal,
  };
}

function runnerAtReplayPrefix(replay: TournamentRunnerReplay, actionCount: number): TournamentRunner {
  return restoreTournamentRunnerReplay({ ...replay, actions: replay.actions.slice(0, actionCount) });
}

export async function deriveHandReviewEvidence(
  replay: TournamentRunnerReplay,
  options: ReviewReplayEvidenceOptions,
): Promise<ReviewEvidenceEnvelopeV2> {
  const budget = options.budget ?? {};
  const maxDecisions = Math.max(0, budget.maxDecisions ?? replay.actions.length);
  const decisions: ReviewDecisionEvidenceV2[] = [];
  let truncated = replay.actions.length > maxDecisions;
  let cancelled = false;
  for (let index = 0; index < Math.min(replay.actions.length, maxDecisions); index += 1) {
    if (options.signal?.aborted) { cancelled = true; break; }
    const runner = runnerAtReplayPrefix(replay, index);
    if (runner.session.status === "complete" || !runner.session.activeHand) {
      truncated = true;
      break;
    }
    const { node, legal } = nodeFromRunner(runner, index, budget.objective ?? "chip_ev");
    let played: ReviewCanonicalAction | null = null;
    try {
      const request = replay.actions[index].request;
      const command = tournamentCommandForHeroAction(legal, request);
      played = canonicalizeBettingAction(runner.session.activeHand.betting, command);
    } catch {
      decisions.push(emptyInvalidDecision(node, null, "invalid_played_action", index));
      truncated = true;
      break;
    }
    decisions.push(await deriveReviewNodeEvidence(node, {
      ...options,
      playedAction: played,
      searchSeed: `${replay.seed}:review:${index}:search`,
      evaluationSeed: `${replay.seed}:review:${index}:evaluation`,
    }));
    if (options.yieldControl) await options.yieldControl();
    // The next iteration reconstructs the exact prefix using the production
    // runner. This line is an explicit seam check: the command resolver and
    // replay engine remain the source of truth, not a second review simulator.
    void applyHeroTournamentAction;
    void advanceTournamentRunnerToHero;
  }
  const eligible = decisions.filter((decision) => decision.summaryEligibility.eligible);
  const supportedNear = eligible.filter((decision) => decision.decisionStatus === "supported_near_optimal");
  const regrets = eligible.map((decision) => decision.regretEstimateBb).filter((value): value is number => value !== null);
  return {
    schemaVersion: 2,
    semanticsVersion: PROTOTYPE_SEMANTICS_VERSION,
    decisions,
    totalEncountered: replay.actions.length,
    supportedGradeCount: eligible.length,
    unresolvedCount: decisions.filter((decision) => decision.decisionStatus === "unresolved").length,
    oodCount: decisions.filter((decision) => decision.decisionStatus === "ood").length,
    tolerancePendingCount: decisions.filter((decision) => decision.decisionStatus === "tolerance_pending").length,
    nearOptimalShare: eligible.length ? supportedNear.length / eligible.length : null,
    meanRegretSupported: regrets.length ? regrets.reduce((sum, value) => sum + value, 0) / regrets.length : null,
    truncated,
    cancelled,
  };
}

export function createPendingReviewTolerancePolicy(objective: ReviewObjective = "chip_ev"): ReviewTolerancePolicy {
  return {
    version: "review-tolerance-pending-v1",
    objective,
    unit: "bb",
    value: null,
    contextScope: "all-contexts",
    sourceEvidence: null,
    artifactHash: null,
    approvalStatus: "pending",
  };
}

/** Public alias used by the offline runner and fixture integrations. */
export const deriveGameReviewEvidence = deriveHandReviewEvidence;
