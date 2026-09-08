import { createFiniteReferenceProvider } from "./referenceValues";
import { createObserverHistoryStore, observePublicEvent, type ObserverHistoryStore } from "./observerHistory";
import type { ReviewCanonicalAction, ReviewNode, ReviewValueBatch } from "../../src/modes/reviewEvidence";
import type { Card } from "../../src/types/poker";

export type ExperimentalOpponentId = "always-shove" | "value-heavy" | "passive" | "balanced" | "value-heavy-to-passive" | "passive-to-value-heavy";
export type AdaptationArm = "fixed-belief" | "adaptive-belief";

export interface AdaptationLegalAction {
  key: string;
  kind: "check" | "call" | "raise" | "bet" | "all-in";
  targetChips: number;
}

export interface ExperimentalOpponentPolicy {
  id: ExperimentalOpponentId;
  decide(input: { context: "facingPressure" | "unopenedPreflop"; legalActions: readonly AdaptationLegalAction[]; handIndex: number; publicHistoryLength: number }): { action: AdaptationLegalAction; probability: number };
  likelihood(input: { context: "facingPressure" | "unopenedPreflop"; legalActions: readonly AdaptationLegalAction[]; observedAction: AdaptationLegalAction; observedTargetChips: number; handIndex: number }): number;
}

export interface MixtureBelief {
  schemaVersion: 1;
  priorVersion: string;
  modelIds: ExperimentalOpponentId[];
  weights: Record<ExperimentalOpponentId, number>;
  observations: number;
  posteriorStatus: "initialized" | "uninitialized";
}

export interface AdaptationObservation {
  eventId: string;
  handIndex: number;
  context: "facingPressure" | "unopenedPreflop";
  action: AdaptationLegalAction;
  sizeEvidence: number;
}

export interface PosteriorTrajectory {
  handIndex: number;
  belief: MixtureBelief;
  observation: AdaptationObservation;
}

export interface AdaptationConditionResult {
  arm: AdaptationArm;
  scheduleId: string;
  blockCount: number;
  pairedScheduleIds: string[];
  trajectories: PosteriorTrajectory[];
  historySnapshots: ObserverHistoryStore[];
  commonProbeValues: Array<{ handIndex: number; values: Record<string, number | null>; supported: boolean; referenceIds: string[] }>;
  metrics: {
    chipEv: { status: "fixture_reference" | "pending"; meanCall: number | null; meanRaise: number | null };
    payout: { status: "pending"; value: null };
    qualification: { status: "pending"; value: null };
  };
  controlComparisons: Array<{ control: "balanced" | "value-heavy"; status: "fixture_reference" | "pending"; cost: number | null }>;
  postSwitchRecovery: { switchHandIndex: number | null; status: "fixture_reference" | "pending"; firstRecoveredHandIndex: number | null };
}

export interface AdaptationExperimentResult {
  schemaVersion: 1;
  experimentVersion: string;
  seedManifest: { seed: string; scheduleIds: string[]; blockIds: string[]; unique: boolean };
  conditions: AdaptationConditionResult[];
  schedules: ExperimentalOpponentId[];
  commonSchedulePairing: Array<{ scheduleId: string; fixedBlockIds: string[]; adaptiveBlockIds: string[] }>;
  missingEvidence: string[];
  status: "fixture_complete" | "pending_external";
}

const ACTIONS: readonly AdaptationLegalAction[] = [
  { key: "call", kind: "call", targetChips: 100 },
  { key: "raise:300", kind: "raise", targetChips: 300 },
];

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function unit(value: string): number {
  return hash(value) / 4_294_967_296;
}

function raiseAction(legalActions: readonly AdaptationLegalAction[]): AdaptationLegalAction {
  return legalActions.find((action) => action.kind === "raise" || action.kind === "bet" || action.kind === "all-in") ?? legalActions[legalActions.length - 1];
}

function callAction(legalActions: readonly AdaptationLegalAction[]): AdaptationLegalAction {
  return legalActions.find((action) => action.kind === "call" || action.kind === "check") ?? legalActions[0];
}

function raiseProbability(policy: ExperimentalOpponentId, handIndex: number): number {
  if (policy === "always-shove") return 1;
  if (policy === "value-heavy") return 0.8;
  if (policy === "passive") return 0.1;
  if (policy === "balanced") return 0.5;
  if (policy === "value-heavy-to-passive") return handIndex < 10 ? 0.8 : 0.1;
  return handIndex < 10 ? 0.1 : 0.8;
}

export function createExperimentalOpponentPolicy(id: ExperimentalOpponentId): ExperimentalOpponentPolicy {
  return {
    id,
    decide(input) {
      const probability = raiseProbability(id, input.handIndex);
      const raise = raiseAction(input.legalActions);
      const action = unit(`${id}:fixture-action:${input.handIndex}:${input.publicHistoryLength}`) < probability ? raise : callAction(input.legalActions);
      return { action, probability: action === raise ? probability : 1 - probability };
    },
    likelihood(input) {
      const probability = raiseProbability(id, input.handIndex);
      const raise = input.observedAction.kind === "raise" || input.observedAction.kind === "bet" || input.observedAction.kind === "all-in";
      const expectedRaiseTarget = raiseAction(input.legalActions).targetChips;
      const sizeCompatibility = raise && input.observedTargetChips !== expectedRaiseTarget ? 0.5 : 1;
      return (raise ? probability : 1 - probability) * sizeCompatibility;
    },
  };
}

export const SCRIPTED_EXPERIMENTAL_POLICIES: Readonly<Record<ExperimentalOpponentId, ExperimentalOpponentPolicy>> = Object.freeze(Object.fromEntries(([
  "always-shove", "value-heavy", "passive", "balanced", "value-heavy-to-passive", "passive-to-value-heavy",
] as ExperimentalOpponentId[]).map((id) => [id, createExperimentalOpponentPolicy(id)])) as Record<ExperimentalOpponentId, ExperimentalOpponentPolicy>);

function normalize(weights: Record<ExperimentalOpponentId, number>): Record<ExperimentalOpponentId, number> {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, total > 0 ? Math.max(0, value) / total : 0])) as Record<ExperimentalOpponentId, number>;
}

export function createMixtureBelief(modelIds: readonly ExperimentalOpponentId[] = ["always-shove", "value-heavy", "passive", "balanced"]): MixtureBelief {
  const unique = [...new Set(modelIds)];
  if (unique.length === 0) return { schemaVersion: 1, priorVersion: "no-prior", modelIds: [], weights: {} as Record<ExperimentalOpponentId, number>, observations: 0, posteriorStatus: "uninitialized" };
  const weight = 1 / unique.length;
  return { schemaVersion: 1, priorVersion: "synthetic-mixture-prior-v1", modelIds: unique, weights: Object.fromEntries(unique.map((id) => [id, weight])) as Record<ExperimentalOpponentId, number>, observations: 0, posteriorStatus: "initialized" };
}

export function updateMixtureBelief(input: {
  belief: MixtureBelief;
  context: "facingPressure" | "unopenedPreflop";
  observedAction: AdaptationLegalAction;
  observedTargetChips?: number;
  legalActions: readonly AdaptationLegalAction[];
  handIndex: number;
}): MixtureBelief {
  if (input.belief.modelIds.length === 0) return structuredClone(input.belief);
  const nextWeights = Object.fromEntries(input.belief.modelIds.map((modelId) => {
    const policy = SCRIPTED_EXPERIMENTAL_POLICIES[modelId];
    const likelihood = Math.max(0, policy.likelihood({ context: input.context, legalActions: input.legalActions, observedAction: input.observedAction, observedTargetChips: input.observedTargetChips ?? input.observedAction.targetChips, handIndex: input.handIndex }));
    return [modelId, (input.belief.weights[modelId] ?? 0) * likelihood];
  })) as Record<ExperimentalOpponentId, number>;
  const normalized = normalize(nextWeights);
  return { ...input.belief, weights: normalized, observations: input.belief.observations + 1, posteriorStatus: "initialized" };
}

function canonicalAction(action: AdaptationLegalAction): ReviewCanonicalAction {
  const aggressive = action.kind === "raise" || action.kind === "bet" || action.kind === "all-in";
  return {
    key: action.key,
    kind: action.kind === "all-in" ? "raise" : action.kind,
    targetChips: action.targetChips,
    investedChips: action.targetChips,
    raisesCurrentBet: aggressive,
    raiseByChips: aggressive ? action.targetChips - 100 : 0,
    isActorAllIn: action.kind === "all-in",
    stackOffClass: action.kind === "all-in" ? "all_in_call" : "none",
    isFullRaise: aggressive,
    isShortAllInIncrease: false,
  };
}

function finiteProbeNode(belief: MixtureBelief, handIndex: number): { node: ReviewNode; actions: ReviewCanonicalAction[] } {
  const actions = ACTIONS.map(canonicalAction);
  const villainCards: readonly Card[] = [{ rank: "Q", suit: "hearts" }, { rank: "T", suit: "hearts" }];
  const worlds = belief.modelIds.map((modelId) => ({
    worldId: `model:${modelId}`,
    weight: belief.weights[modelId] ?? 0,
    opponentCards: { villain: villainCards },
    payoffByAction: {
      call: modelId === "passive" ? 40 : modelId === "always-shove" ? -20 : 20,
      "raise:300": modelId === "value-heavy" || modelId.endsWith("value-heavy") ? 60 : modelId === "always-shove" ? 5 : 10,
    },
  }));
  return {
    node: {
      schemaVersion: 1,
      nodeId: `adaptation-probe:${handIndex}`,
      handId: `adaptation-hand:${handIndex}`,
      index: handIndex,
      actorId: "hero",
      objective: "chip_ev",
      street: "flop",
      board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "diamonds" }, { rank: "9", suit: "spades" }],
      heroCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
      potBeforeChips: 200,
      actorStackBeforeChips: 1000,
      actorStreetCommittedChips: 0,
      actorTotalCommittedChips: 0,
      currentBetChips: 100,
      bigBlindChips: 100,
      smallestChipChips: 25,
      buttonSeat: 0,
      tableSize: 2,
      opponents: [{ id: "villain", remainingStackChips: 1000, streetCommittedChips: 100, totalCommittedChips: 100, seat: 1, status: "active" }],
      legalActions: actions,
      worlds,
      metadata: { experiment: "finite-scripted-mixture", handIndex },
    },
    actions,
  };
}

function evaluateProbe(belief: MixtureBelief, handIndex: number): { values: Record<string, number | null>; supported: boolean; referenceIds: string[] } {
  const { node, actions } = finiteProbeNode(belief, handIndex);
  const provider = createFiniteReferenceProvider();
  const batch = provider.evaluateMenu({ node, canonicalActions: actions, modelIds: ["scripted-mixture"], phase: "evaluation", seed: `reference-evaluation:${handIndex}`, drawCount: 0 }) as ReviewValueBatch;
  const values = Object.fromEntries(batch.values.map((value) => [value.actionKey, value.mean]));
  return { values, supported: batch.values.every((value) => value.support.status === "supported" && value.mean !== null), referenceIds: batch.referenceIds };
}

function observeFixtureEvent(store: ObserverHistoryStore, observation: AdaptationObservation, action: AdaptationLegalAction): ObserverHistoryStore {
  return observePublicEvent(store, {
    opportunity: { version: 1, id: observation.eventId, blockId: "adaptation-block", sessionId: "adaptation-session", handId: `hand-${observation.handIndex}`, actorId: "villain", decisionId: observation.eventId, kind: "facing_bet", eligible: true, eligibilityReason: "canonical_call", outcome: action.kind === "call" ? "yes" : "no", strataRef: "adaptation" },
    observerAlias: "hero-observer",
    observerId: "hero-observer",
    observedOpponentId: "villain",
    context: observation.context,
    action: action.kind === "raise" || action.kind === "bet" || action.kind === "all-in" ? "raise" : action.kind === "check" ? "check" : "call",
    observerPresentAtExposure: true,
    eventIndex: observation.handIndex,
  });
}

function runCondition(input: { arm: AdaptationArm; scheduleId: ExperimentalOpponentId; blockCount: number; handsPerBlock: number; seed: string }): AdaptationConditionResult {
  const policy = SCRIPTED_EXPERIMENTAL_POLICIES[input.scheduleId];
  const trajectories: PosteriorTrajectory[] = [];
  const historySnapshots: ObserverHistoryStore[] = [];
  const commonProbeValues: AdaptationConditionResult["commonProbeValues"] = [];
  const blockIds = Array.from({ length: input.blockCount }, (_, index) => `${input.scheduleId}:block:${index}`);
  for (const blockId of blockIds) {
    let belief = createMixtureBelief();
    let history = createObserverHistoryStore({ sessionId: "adaptation-session", historyVersion: "observer-history-v1" });
    for (let handIndex = 0; handIndex < input.handsPerBlock; handIndex += 1) {
      const decision = policy.decide({ context: "facingPressure", legalActions: ACTIONS, handIndex, publicHistoryLength: (hash(`${input.seed}:${blockId}`) % 100_000) + trajectories.length });
      const observation: AdaptationObservation = { eventId: `${blockId}:event:${handIndex}`, handIndex, context: "facingPressure", action: decision.action, sizeEvidence: decision.action.targetChips };
      history = observeFixtureEvent(history, observation, decision.action);
      if (input.arm === "adaptive-belief") belief = updateMixtureBelief({ belief, context: observation.context, observedAction: observation.action, observedTargetChips: observation.sizeEvidence, legalActions: ACTIONS, handIndex });
      trajectories.push({ handIndex, belief: structuredClone(belief), observation });
      if (handIndex === 0 || handIndex === input.handsPerBlock - 1) commonProbeValues.push({ handIndex, ...evaluateProbe(belief, handIndex) });
    }
    historySnapshots.push(history);
  }
  const callValues = commonProbeValues.map((entry) => entry.values.call).filter((value): value is number => value !== null);
  const raiseValues = commonProbeValues.map((entry) => entry.values["raise:300"]).filter((value): value is number => value !== null);
  const switchHandIndex = input.scheduleId.includes("-to-") ? 10 : null;
  const recovered = switchHandIndex === null ? null : trajectories.find((entry) => entry.handIndex >= switchHandIndex && (entry.belief.weights[input.scheduleId] ?? 0) >= 0.4)?.handIndex ?? null;
  return {
    arm: input.arm,
    scheduleId: input.scheduleId,
    blockCount: input.blockCount,
    pairedScheduleIds: [input.scheduleId],
    trajectories,
    historySnapshots,
    commonProbeValues,
    metrics: { chipEv: { status: "fixture_reference", meanCall: callValues.length ? callValues.reduce((sum, value) => sum + value, 0) / callValues.length : null, meanRaise: raiseValues.length ? raiseValues.reduce((sum, value) => sum + value, 0) / raiseValues.length : null }, payout: { status: "pending", value: null }, qualification: { status: "pending", value: null } },
    controlComparisons: [{ control: "balanced", status: "fixture_reference", cost: null }, { control: "value-heavy", status: "fixture_reference", cost: null }],
    postSwitchRecovery: { switchHandIndex, status: switchHandIndex === null ? "pending" : "fixture_reference", firstRecoveredHandIndex: recovered },
  };
}

export function runAdaptationExperiment(input: {
  seed?: string;
  schedules?: readonly ExperimentalOpponentId[];
  blockCount?: number;
  handsPerBlock?: number;
} = {}): AdaptationExperimentResult {
  const seed = input.seed ?? "adaptation-fixture-seed-v1";
  const schedules = [...(input.schedules ?? ["always-shove", "value-heavy", "passive", "balanced", "value-heavy-to-passive", "passive-to-value-heavy"])] as ExperimentalOpponentId[];
  const blockCount = Math.max(1, Math.floor(input.blockCount ?? 30));
  const handsPerBlock = Math.max(1, Math.floor(input.handsPerBlock ?? 20));
  const conditions = schedules.flatMap((scheduleId) => [runCondition({ arm: "fixed-belief", scheduleId, blockCount, handsPerBlock, seed }), runCondition({ arm: "adaptive-belief", scheduleId, blockCount, handsPerBlock, seed })]);
  const blockIds = schedules.flatMap((scheduleId) => Array.from({ length: blockCount }, (_, index) => `${scheduleId}:block:${index}`));
  return {
    schemaVersion: 1,
    experimentVersion: "adaptation-experiment-v1",
    seedManifest: { seed, scheduleIds: schedules, blockIds, unique: new Set(blockIds).size === blockIds.length },
    conditions,
    schedules,
    commonSchedulePairing: schedules.map((scheduleId) => ({ scheduleId, fixedBlockIds: Array.from({ length: blockCount }, (_, index) => `${scheduleId}:block:${index}`), adaptiveBlockIds: Array.from({ length: blockCount }, (_, index) => `${scheduleId}:block:${index}`) })),
    missingEvidence: ["human_observer_labels", "external_payout_mapping", "qualification_calibration", "live_adoption_authority"],
    status: "pending_external",
  };
}
