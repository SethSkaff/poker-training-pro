import {
  buildPots,
  resolvePots,
  type PlayerContribution,
} from "../../src/engine/pots";
import { cardKey } from "../../src/engine/deck";
import type { Card } from "../../src/types/poker";
import {
  type ConditioningEvidence,
  type ResponseSupport,
} from "../../src/lib/actionSupport";
import {
  type ReviewCanonicalAction,
  type ReviewConditioningModel,
  type ReviewContinuationAction,
  type ReviewFiniteWorld,
  type ReviewNode,
  type ReviewObjective,
  type ReviewPayoffRow,
  type ReviewResponseObservation,
  type ReviewSupportDescription,
  type ReviewValue,
  type ReviewValueBatch,
  type ReviewValuePhase,
  type ReviewValueProvider,
} from "../../src/modes/reviewEvidence";

export const REFERENCE_PROVIDER_VERSION = "finite-reference-v1" as const;

export type ReferenceProviderMode = "exact" | "monte_carlo" | "tree" | "auto";

export interface ReferenceProviderOptions {
  mode?: ReferenceProviderMode;
  providerId?: string;
  providerVersion?: string;
  verificationStatus?: "verified_fixture" | "pending_external" | "unverified";
  confidenceLevel?: number;
}

export interface ReferenceComparison {
  supported: boolean;
  actionKey: string;
  referenceMean: number | null;
  policyMean: number | null;
  absoluteError: number | null;
  signedError: number | null;
  decomposedCharges: {
    missingReference: number;
    unsupportedConditioning: number;
    numericalDifference: number | null;
  };
  reason: string | null;
}

export interface ReferenceMenuInput {
  node: ReviewNode;
  canonicalActions: readonly ReviewCanonicalAction[];
  modelIds: readonly string[];
  phase: ReviewValuePhase;
  seed: string;
  drawCount: number;
  signal?: { readonly aborted: boolean };
  mode?: ReferenceProviderMode;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function fnv(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unit(seed: string): number {
  return fnv(seed) / 4_294_967_296;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateCards(cards: readonly Card[], label: string): void {
  const keys = cards.map(cardKey);
  if (new Set(keys).size !== keys.length) throw new Error(`${label} contains duplicate cards`);
}

function containsAll(container: readonly Card[], required: readonly Card[]): boolean {
  const keys = new Set(container.map(cardKey));
  return required.every((card) => keys.has(cardKey(card)));
}

function validateWorld(node: ReviewNode, world: ReviewFiniteWorld): void {
  assertFinite(world.weight, `World ${world.worldId} weight`);
  if (world.weight < 0) throw new Error(`World ${world.worldId} has a negative weight`);
  validateCards(node.heroCards, "Hero cards");
  validateCards(node.board, "Board");
  for (const [opponentId, cards] of Object.entries(world.opponentCards)) {
    if (cards.length !== 2) throw new Error(`World ${world.worldId} requires two cards for ${opponentId}`);
    validateCards(cards, `World ${world.worldId} ${opponentId} cards`);
  }
  const fixed = [...node.heroCards, ...node.board];
  const fixedKeys = new Set(fixed.map(cardKey));
  for (const cards of Object.values(world.opponentCards)) {
    for (const card of cards) {
      if (fixedKeys.has(cardKey(card))) throw new Error(`World ${world.worldId} overlaps hero/board cards`);
      fixedKeys.add(cardKey(card));
    }
  }
  for (const runout of world.runouts ?? []) {
    const finalBoard = runout.length >= node.board.length && containsAll(runout, node.board)
      ? runout
      : [...node.board, ...runout];
    if (finalBoard.length !== 5) throw new Error(`World ${world.worldId} runout must produce five board cards`);
    validateCards(finalBoard, `World ${world.worldId} runout`);
    const occupied = new Set([...node.heroCards, ...Object.values(world.opponentCards).flat()].map(cardKey));
    for (const card of finalBoard) {
      if (occupied.has(cardKey(card))) throw new Error(`World ${world.worldId} runout overlaps a hole card`);
    }
  }
}

function normalizedWorlds(node: ReviewNode): ReviewFiniteWorld[] | null {
  if (!node.worlds || node.worlds.length === 0) return null;
  for (const world of node.worlds) validateWorld(node, world);
  const total = node.worlds.reduce((sum, world) => sum + world.weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new Error("Reference world weights must have a positive finite total");
  return node.worlds.map((world) => ({ ...world, weight: world.weight / total }));
}

function weightedIndex(weights: readonly number[], value: number): number {
  let cumulative = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cumulative += weights[index];
    if (value < cumulative || index === weights.length - 1) return index;
  }
  return Math.max(0, weights.length - 1);
}

function finalBoard(node: ReviewNode, runout: readonly Card[] | undefined): Card[] {
  if (!runout) return [...node.board];
  if (runout.length === 5 && containsAll(runout, node.board)) return runout.map((card) => ({ ...card }));
  return [...node.board, ...runout].map((card) => ({ ...card }));
}

function responseFor(
  node: ReviewNode,
  world: ReviewFiniteWorld,
  action: ReviewCanonicalAction,
): Readonly<Record<string, ReviewResponseObservation>> | null {
  const explicit = world.responses?.[action.key];
  if (explicit) return explicit;
  const inferred: Record<string, ReviewResponseObservation> = {};
  for (const opponent of node.opponents) {
    if (opponent.status === "all-in") inferred[opponent.id] = { kind: "all-in" };
    else if (opponent.status === "folded" || opponent.status === "out") inferred[opponent.id] = { kind: "fold" };
    else return null;
  }
  return inferred;
}

function responseTarget(
  node: ReviewNode,
  opponentId: string,
  observation: ReviewResponseObservation,
  action: ReviewCanonicalAction,
): number {
  const opponent = node.opponents.find((entry) => entry.id === opponentId);
  if (!opponent) throw new Error(`Unknown response opponent ${opponentId}`);
  if (observation.kind === "fold") return opponent.streetCommittedChips;
  if (observation.targetChips !== undefined) return observation.targetChips;
  return observation.kind === "raise"
    ? Math.max(action.targetChips, node.currentBetChips + Math.max(1, node.bigBlindChips))
    : action.targetChips;
}

function terminalPayoff(
  node: ReviewNode,
  world: ReviewFiniteWorld,
  action: ReviewCanonicalAction,
  runout: readonly Card[] | undefined,
): number | null {
  if (action.kind === "fold") return 0;
  const responses = responseFor(node, world, action);
  if (!responses) return null;

  const actorStackAfter = node.actorStackBeforeChips - action.investedChips;
  if (actorStackAfter < 0) return null;
  const contributions: PlayerContribution[] = [{
    playerId: node.actorId,
    amount: node.actorTotalCommittedChips + action.investedChips,
    folded: false,
    allIn: action.isActorAllIn || actorStackAfter === 0,
  }];
  const holeCards: Record<string, readonly Card[]> = { [node.actorId]: node.heroCards };
  const seats: Record<string, number> = { [node.actorId]: node.opponents.length ? Math.max(0, node.buttonSeat - 1) : node.buttonSeat };
  for (const opponent of node.opponents) {
    const observation = responses[opponent.id];
    if (!observation) return null;
    const target = responseTarget(node, opponent.id, observation, action);
    const invested = Math.max(0, target - opponent.streetCommittedChips);
    if (invested > opponent.remainingStackChips) return null;
    const remaining = opponent.remainingStackChips - invested;
    contributions.push({
      playerId: opponent.id,
      amount: opponent.totalCommittedChips + invested,
      folded: observation.kind === "fold" || opponent.status === "folded" || opponent.status === "out",
      allIn: observation.kind === "all-in" || remaining === 0 || opponent.status === "all-in",
    });
    const cards = world.opponentCards[opponent.id];
    if (cards) holeCards[opponent.id] = cards;
    seats[opponent.id] = opponent.seat;
  }
  const built = buildPots(contributions);
  const board = finalBoard(node, runout);
  if (board.length < 5) return null;
  const resolved = resolvePots(built.pots, {
    board,
    holeCards,
    seats,
    buttonSeat: node.buttonSeat,
    tableSize: node.tableSize,
    smallestChip: node.smallestChipChips,
  });
  const refund = built.refunds
    .filter((entry) => entry.playerId === node.actorId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const award = resolved.awards
    .filter((entry) => entry.playerId === node.actorId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  return refund + award - action.investedChips;
}

function conditioningModelFor(
  node: ReviewNode,
  modelId: string,
  action?: ReviewCanonicalAction,
): ReviewConditioningModel | null {
  const candidates = node.conditioningModels?.filter((model) => model.modelId === modelId) ?? [];
  if (action) {
    const exact = candidates.find((model) => model.observedSizingSignature === action.key);
    if (exact) return exact;
  }
  return candidates[0] ?? null;
}

function defaultDimensions(node: ReviewNode, action?: ReviewCanonicalAction): ConditioningEvidence["dimensions"] {
  return [
    { dimension: "action_type", observedValue: action?.kind ?? null, usedRepresentation: action?.kind ?? null, status: "conditioned", basis: "canonical-action" },
    { dimension: "raw_target_chips", observedValue: action?.targetChips ?? null, usedRepresentation: String(action?.targetChips ?? ""), status: action ? "conditioned" : "not_applicable", basis: "final-evaluated-target" },
    { dimension: "normalized_sizing", observedValue: action && node.potBeforeChips > 0 ? action.investedChips / node.potBeforeChips : null, usedRepresentation: action && node.potBeforeChips > 0 ? String(action.investedChips / node.potBeforeChips) : null, status: action && node.potBeforeChips > 0 ? "conditioned" : "not_applicable", basis: "pre-action-pot" },
    { dimension: "ordered_prior_sequence", observedValue: node.publicPrefixHash ?? null, usedRepresentation: node.publicPrefixHash ?? null, status: node.publicPrefix ? "conditioned" : "assumed", basis: "public-prefix" },
    { dimension: "street", observedValue: node.street, usedRepresentation: node.street, status: "conditioned", basis: "node" },
    { dimension: "position", observedValue: null, usedRepresentation: null, status: "assumed", basis: "case metadata" },
    { dimension: "depth_matchable_exposure", observedValue: node.actorStackBeforeChips, usedRepresentation: String(node.actorStackBeforeChips), status: "conditioned", basis: "pre-action-stack" },
    { dimension: "tournament_context", observedValue: null, usedRepresentation: null, status: "not_applicable", basis: "chip-EV fixture" },
  ];
}

function conditioningFor(
  node: ReviewNode,
  modelId: string,
  action?: ReviewCanonicalAction,
): ConditioningEvidence {
  const supplied = conditioningModelFor(node, modelId, action);
  const explicitlyActionConditioned = Boolean(action && node.worlds?.some((world) =>
    world.payoffByAction?.[action.key] !== undefined || world.responses?.[action.key] !== undefined));
  const explicitlyTreeConditioned = Boolean(action && node.continuationTree?.actions.some((entry) => entry.actionKey === action.key));
  const missingDeclaredModel = Boolean(node.conditioningModels?.length && !supplied);
  const dimensions = supplied?.dimensions?.length ? supplied.dimensions : defaultDimensions(node, action);
  const status = supplied?.conditioningStatus === "unavailable"
    ? "unsupported"
    : missingDeclaredModel
      ? "unsupported"
      : supplied?.conditioningStatus === "estimated"
      ? "assumed"
      : supplied?.conditioningStatus === "explicit_reference"
        ? "conditioned"
        : supplied
          ? "assumed"
          : explicitlyActionConditioned || explicitlyTreeConditioned
            ? "conditioned"
            : "assumed";
  return {
    modelId,
    conditioningPrefixHash: supplied?.conditioningPrefixHash ?? node.publicPrefixHash ?? `prefix:${node.nodeId}`,
    sizingSignature: supplied?.observedSizingSignature ?? (action ? `${action.kind}:${action.targetChips}` : node.observedSizingSignature ?? null),
    status,
    dimensions: dimensions.map((dimension) => ({ ...dimension })),
    domainEvidence: supplied?.domainEvidence ?? (missingDeclaredModel
      ? {
          status: "unsupported",
          supportedDescription: "The requested model is not declared for this reference case.",
          extrapolation: null,
          basis: "declared-model-set",
        }
      : {
          status: "supported",
          supportedDescription: "Complete finite reference worlds supplied for this case.",
          extrapolation: null,
          basis: "finite-reference-v1",
        }),
    limitations: [...(supplied?.limitations ?? [])],
  };
}

function responseSupportFor(node: ReviewNode, modelId: string): ResponseSupport | null {
  return conditioningModelFor(node, modelId)?.responseSupport ?? null;
}

function supportDescription(
  node: ReviewNode,
  objective: ReviewObjective,
  modelId: string,
  action?: ReviewCanonicalAction,
  referenceId: string | null = null,
  mode: ReferenceProviderMode = "exact",
): ReviewSupportDescription {
  if (objective !== "chip_ev") {
    return {
      status: "unavailable",
      modelId,
      modelVersion: REFERENCE_PROVIDER_VERSION,
      referenceId,
      conditioning: null,
      domainEvidence: { status: "unsupported", supportedDescription: "Only chip EV is implemented by the finite provider.", extrapolation: null, basis: "objective boundary" },
      limitations: ["unsupported_objective"],
      continuationAssumption: "No payout or qualification mapping was supplied.",
      responseSupport: null,
    };
  }
  const conditioning = conditioningFor(node, modelId, action);
  const hasTree = Boolean(node.continuationTree);
  const hasWorlds = Boolean(node.worlds?.length);
  const domainStatus = conditioning.domainEvidence.status;
  const status = domainStatus === "unsupported"
    ? "ood"
    : mode === "tree" && !hasTree
      ? "unavailable"
      : !hasWorlds && !hasTree && action?.kind !== "fold"
        ? "unavailable"
        : conditioning.status === "unsupported"
          ? "ood"
          : conditioning.status === "assumed" && action?.kind !== "fold"
            ? "assumption_sensitive"
            : conditioning.domainEvidence.status === "partial"
              ? "assumption_sensitive"
              : "supported";
  return {
    status,
    modelId,
    modelVersion: conditioningModelFor(node, modelId, action)?.modelVersion ?? REFERENCE_PROVIDER_VERSION,
    referenceId,
    conditioning,
    domainEvidence: conditioning.domainEvidence,
    limitations: [...conditioning.limitations],
    continuationAssumption: hasTree
      ? "Only supplied continuation leaves are evaluated; missing nonterminal branches are unsupported."
      : hasWorlds
        ? "Complete supplied joint worlds and terminal settlement are evaluated."
        : action?.kind === "fold"
          ? "Fold payoff is exactly zero under the incremental convention."
          : "No finite continuation was supplied.",
    responseSupport: responseSupportFor(node, modelId),
  };
}

function payoffBounds(node: ReviewNode): { lower: number; upper: number } {
  const opponentChips = node.opponents.reduce((sum, opponent) => sum + opponent.remainingStackChips, 0);
  return {
    lower: -node.actorStackBeforeChips,
    upper: node.potBeforeChips + opponentChips + node.actorStackBeforeChips,
  };
}

function treeAction(node: ReviewNode, actionKey: string): ReviewContinuationAction | null {
  return node.continuationTree?.actions.find((entry) => entry.actionKey === actionKey) ?? null;
}

function exactTreeValue(
  node: ReviewNode,
  action: ReviewCanonicalAction,
): { mean: number | null; assumption: string; referenceId: string | null } {
  const entry = treeAction(node, action.key);
  if (!entry || !entry.supported || !entry.leaves?.length) return { mean: null, assumption: "Nonterminal action has no supported continuation.", referenceId: node.continuationTree?.treeId ?? null };
  const total = entry.leaves.reduce((sum, leaf) => sum + leaf.probability, 0);
  if (!(total > 0)) return { mean: null, assumption: "Continuation probabilities are empty.", referenceId: node.continuationTree?.treeId ?? null };
  return {
    mean: entry.leaves.reduce((sum, leaf) => sum + (leaf.probability / total) * leaf.payoffChips, 0),
    assumption: entry.assumption,
    referenceId: node.continuationTree?.treeId ?? null,
  };
}

function exactWorldValue(
  node: ReviewNode,
  world: ReviewFiniteWorld,
  action: ReviewCanonicalAction,
  runoutOverride?: readonly Card[],
): number | null {
  if (world.payoffByAction?.[action.key] !== undefined) {
    const value = world.payoffByAction[action.key];
    assertFinite(value, `World ${world.worldId} payoff`);
    return value;
  }
  if (action.kind === "fold") return 0;
  const runouts = runoutOverride ? [runoutOverride] : world.runouts?.length ? world.runouts : [undefined];
  const weights = world.runoutWeights?.length === runouts.length
    ? world.runoutWeights
    : runouts.map(() => 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  let sum = 0;
  for (let index = 0; index < runouts.length; index += 1) {
    const payoff = terminalPayoff(node, world, action, runouts[index]);
    if (payoff === null) return null;
    sum += (weights[index] / total) * payoff;
  }
  return sum;
}

function actionExactValue(
  node: ReviewNode,
  action: ReviewCanonicalAction,
): { mean: number | null; referenceId: string | null; assumption: string } {
  const tree = exactTreeValue(node, action);
  if (node.continuationTree) return tree;
  const worlds = normalizedWorlds(node);
  if (!worlds) {
    if (action.kind === "fold") return { mean: 0, referenceId: null, assumption: "Fold payoff is exactly zero under the incremental convention." };
    return { mean: null, referenceId: null, assumption: "No finite world or continuation table was supplied." };
  }
  const values = worlds.map((world) => exactWorldValue(node, world, action));
  if (values.some((value) => value === null)) return { mean: null, referenceId: null, assumption: "At least one weighted world lacks a terminal continuation for this action." };
  return {
    mean: worlds.reduce((sum, world, index) => sum + world.weight * (values[index] as number), 0),
    referenceId: `worlds:${node.nodeId}`,
    assumption: "Exact expectation over the complete supplied joint world distribution.",
  };
}

function sampledWorld(
  node: ReviewNode,
  seed: string,
  drawIndex: number,
): { world: ReviewFiniteWorld; runout: readonly Card[] | undefined } | null {
  const worlds = normalizedWorlds(node);
  if (!worlds) return null;
  const worldIndex = weightedIndex(worlds.map((world) => world.weight), unit(`${seed}:world:${drawIndex}`));
  const world = worlds[worldIndex];
  const runouts = world.runouts?.length ? world.runouts : [undefined];
  const weights = world.runoutWeights?.length === runouts.length ? world.runoutWeights : runouts.map(() => 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const runout = runouts[weightedIndex(weights.map((value) => value / total), unit(`${seed}:runout:${drawIndex}:${world.worldId}`))];
  return { world, runout };
}

function sampledTree(
  treeActionEntry: ReviewContinuationAction,
  seed: string,
  drawIndex: number,
): number | null {
  if (!treeActionEntry.supported || !treeActionEntry.leaves?.length) return null;
  const total = treeActionEntry.leaves.reduce((sum, leaf) => sum + leaf.probability, 0);
  if (!(total > 0)) return null;
  const index = weightedIndex(treeActionEntry.leaves.map((leaf) => leaf.probability / total), unit(`${seed}:leaf:${drawIndex}`));
  return treeActionEntry.leaves[index].payoffChips;
}

function makeValue(
  node: ReviewNode,
  action: ReviewCanonicalAction,
  modelId: string,
  mean: number | null,
  rows: ReviewPayoffRow[],
  exact: boolean,
  assumption: string,
  referenceId: string | null,
  mode: ReferenceProviderMode,
  verificationStatus: ReferenceProviderOptions["verificationStatus"],
): ReviewValue {
  const support = supportDescription(node, node.objective, modelId, action, referenceId, mode);
  const bounds = payoffBounds(node);
  const safeSupport = mean === null
    ? {
        ...support,
        status: support.status === "ood" ? "ood" as const : "unavailable" as const,
        limitations: [...support.limitations, "unsupported_continuation"],
      }
    : support;
  return {
    actionKey: action.key,
    modelId,
    mean,
    valueUnit: node.objective === "chip_ev" ? "chips" : "qualification_probability",
    bound: mean === null ? null : exact ? { lower: mean, upper: mean } : bounds,
    theoreticalPayoffBounds: bounds,
    exact,
    sampleCount: rows.length,
    payoffRows: rows,
    support: safeSupport,
    continuationAssumption: assumption,
    provenance: {
      referenceId,
      provider: "finite-reference-provider",
      version: REFERENCE_PROVIDER_VERSION,
      verificationStatus: verificationStatus ?? "unverified",
    },
    conditioningEvidence: support.conditioning,
  };
}

function exactBatch(input: ReferenceMenuInput, options: Required<Pick<ReferenceProviderOptions, "providerId" | "providerVersion" | "verificationStatus">>): ReviewValueBatch {
  const modelIds = input.modelIds.length ? input.modelIds : ["reference-primary"];
  const values: ReviewValue[] = [];
  for (const modelId of modelIds) {
    for (const action of input.canonicalActions) {
      if (input.signal?.aborted) throw new Error("Reference evaluation cancelled");
      const result = input.node.objective === "chip_ev"
        ? actionExactValue(input.node, action)
        : { mean: null, referenceId: null, assumption: "Unsupported objective: no payout or qualification mapping was supplied." };
      values.push(makeValue(input.node, action, modelId, result.mean, [], result.mean !== null, result.assumption, result.referenceId, input.mode ?? "exact", options.verificationStatus));
    }
  }
  return {
    schemaVersion: 1,
    nodeId: input.node.nodeId,
    objective: input.node.objective,
    phase: input.phase,
    values,
    drawIds: [],
    pairwiseBounds: payoffBounds(input.node),
    provider: options.providerId,
    providerVersion: options.providerVersion,
    referenceIds: [...new Set(values.map((value) => value.provenance.referenceId).filter((value): value is string => Boolean(value)))],
  };
}

function monteCarloBatch(input: ReferenceMenuInput, options: Required<Pick<ReferenceProviderOptions, "providerId" | "providerVersion" | "verificationStatus">>): ReviewValueBatch {
  const modelIds = input.modelIds.length ? input.modelIds : ["reference-primary"];
  const drawCount = Math.max(0, Math.floor(input.drawCount));
  const rowsByKey = new Map<string, ReviewPayoffRow[]>();
  for (const modelId of modelIds) for (const action of input.canonicalActions) rowsByKey.set(`${modelId}\u0000${action.key}`, []);
  const supported = new Map<string, boolean>();
  for (const key of rowsByKey.keys()) supported.set(key, true);
  const drawIds: string[] = [];
  for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
    if (input.signal?.aborted) throw new Error("Reference evaluation cancelled");
    const draw = sampledWorld(input.node, input.seed, drawIndex);
    const drawId = `${input.seed}:${drawIndex}`;
    drawIds.push(drawId);
    for (const modelId of modelIds) {
      for (const action of input.canonicalActions) {
        const key = `${modelId}\u0000${action.key}`;
        let payoff: number | null = null;
        if (input.node.continuationTree) {
          const entry = treeAction(input.node, action.key);
          payoff = entry ? sampledTree(entry, input.seed, drawIndex) : null;
        } else if (action.kind === "fold") {
          payoff = 0;
        } else if (draw) {
          payoff = exactWorldValue(input.node, draw.world, action, draw.runout);
        }
        if (payoff === null || !Number.isFinite(payoff)) {
          supported.set(key, false);
        } else {
          rowsByKey.get(key)?.push({ drawId, payoff });
        }
      }
    }
  }
  const values: ReviewValue[] = [];
  for (const modelId of modelIds) {
    for (const action of input.canonicalActions) {
      const key = `${modelId}\u0000${action.key}`;
      const rows = rowsByKey.get(key) ?? [];
      const usable = supported.get(key) === true && rows.length === drawCount && drawCount > 0;
      const mean = usable ? rows.reduce((sum, row) => sum + row.payoff, 0) / rows.length : null;
      const result = input.node.objective === "chip_ev"
        ? actionExactValue(input.node, action)
        : { mean: null, referenceId: null, assumption: "Unsupported objective: no payout or qualification mapping was supplied." };
      values.push(makeValue(input.node, action, modelId, mean, rows, false, result.assumption, result.referenceId, input.mode ?? "monte_carlo", options.verificationStatus));
    }
  }
  return {
    schemaVersion: 1,
    nodeId: input.node.nodeId,
    objective: input.node.objective,
    phase: input.phase,
    values,
    drawIds,
    pairwiseBounds: payoffBounds(input.node),
    provider: options.providerId,
    providerVersion: options.providerVersion,
    referenceIds: [...new Set(values.map((value) => value.provenance.referenceId).filter((value): value is string => Boolean(value)))],
  };
}

export function describeReferenceSupport(
  node: ReviewNode,
  objective: ReviewObjective = node.objective,
  modelId = "reference-primary",
  mode: ReferenceProviderMode = "exact",
): ReviewSupportDescription {
  return supportDescription(node, objective, modelId, undefined, `case:${node.nodeId}`, mode);
}

export function evaluateReferenceMenu(input: ReferenceMenuInput): ReviewValueBatch {
  const options = {
    providerId: "finite-reference-provider",
    providerVersion: REFERENCE_PROVIDER_VERSION,
    verificationStatus: "verified_fixture" as const,
  };
  const mode = input.mode ?? "exact";
  if (mode === "monte_carlo") return monteCarloBatch(input, options);
  if (mode === "tree") return exactBatch({ ...input, mode }, options);
  if (mode === "auto") return input.phase === "search" ? exactBatch({ ...input, mode }, options) : monteCarloBatch({ ...input, mode }, options);
  return exactBatch({ ...input, mode }, options);
}

export function createReferenceValueProvider(options: ReferenceProviderOptions = {}): ReviewValueProvider {
  const mode = options.mode ?? "exact";
  const providerId = options.providerId ?? "finite-reference-provider";
  const providerVersion = options.providerVersion ?? REFERENCE_PROVIDER_VERSION;
  const verificationStatus = options.verificationStatus ?? "verified_fixture";
  return {
    describeSupport(node, objective) {
      return supportDescription(node, objective, "reference-primary", undefined, `case:${node.nodeId}`, mode);
    },
    evaluateMenu(input) {
      const batch = evaluateReferenceMenu({ ...input, mode });
      return {
        ...batch,
        provider: providerId,
        providerVersion,
        values: batch.values.map((value) => ({
          ...value,
          provenance: { ...value.provenance, provider: providerId, version: providerVersion, verificationStatus },
        })),
      };
    },
  };
}

export const createExactReferenceProvider = (options: Omit<ReferenceProviderOptions, "mode"> = {}) =>
  createReferenceValueProvider({ ...options, mode: "exact" });

export const createMonteCarloReferenceProvider = (options: Omit<ReferenceProviderOptions, "mode"> = {}) =>
  createReferenceValueProvider({ ...options, mode: "monte_carlo" });

export const createFiniteReferenceProvider = createExactReferenceProvider;

export function comparePolicyValues(input: {
  policyValues: Readonly<Record<string, number>>;
  referenceValues: Readonly<Record<string, ReviewValue | number>>;
}): ReferenceComparison[] {
  const keys = [...new Set([...Object.keys(input.policyValues), ...Object.keys(input.referenceValues)])].sort();
  return keys.map((actionKey) => {
    const policyMean = input.policyValues[actionKey] ?? null;
    const rawReference = input.referenceValues[actionKey];
    const referenceMean = typeof rawReference === "number" ? rawReference : rawReference?.mean ?? null;
    const supported = referenceMean !== null && policyMean !== null && Number.isFinite(referenceMean) && Number.isFinite(policyMean);
    return {
      supported,
      actionKey,
      referenceMean,
      policyMean,
      absoluteError: supported ? Math.abs((policyMean as number) - (referenceMean as number)) : null,
      signedError: supported ? (policyMean as number) - (referenceMean as number) : null,
      decomposedCharges: {
        missingReference: referenceMean === null ? 1 : 0,
        unsupportedConditioning: typeof rawReference === "object" && rawReference?.support.status !== "supported" ? 1 : 0,
        numericalDifference: supported ? (policyMean as number) - (referenceMean as number) : null,
      },
      reason: supported ? null : "reference_value_unavailable",
    };
  });
}

/** Independently computed exact fold convention used by A07/A08 known answers. */
export function exactFoldValue(): number {
  return 0;
}

/** A stable identity for a conditioning payload, useful in receipts and tests. */
export function referenceConditioningFingerprint(value: unknown): string {
  return `conditioning:${fnv(stableJson(value)).toString(16).padStart(8, "0")}`;
}
