import type { BettingRoundState, LegalActionSet, BettingActionCommand } from "../../src/engine/betting";
import { assertBettingStateInvariant } from "../../src/engine/betting";
import type { PlayerInformationSet } from "../../src/engine/tournament";
import type { PolicyIdentity, Reproduction, Maybe } from "./contracts";
import type { DecisionStrata } from "./stratification";
import { canonicalizeBettingAction, computeWagerGeometry, type CanonicalAction, type WagerGeometry, type WagerGeometryContext } from "../../src/lib/pokerActionSemantics";
import type { ActionSupportAssessment, ResponseSupport } from "../../src/lib/actionSupport";

export interface PolicyValueComponents {
  baseChipEv: number;
  reopenChargeChips: number;
  tournamentChargeChips: number;
  exposureChargeChips: number;
  finalUtilityChips: number;
  modelVersion: string;
}

export interface CandidateTelemetry {
  action: CanonicalAction;
  geometry: WagerGeometry;
  selectionProbability: Maybe<number>;
  probabilitySource: "rational" | "normal" | "scripted" | "unavailable";
  policyUtilityBb: Maybe<number>;
  valueComponents: Maybe<PolicyValueComponents>;
  responseSupport: Maybe<ResponseSupport>;
  sizing: Record<string, number> | null;
  actionSupport?: ActionSupportAssessment;
}

export interface EventPostcondition {
  status: "pass" | "fail";
  errors: string[];
  executionHash: string;
}

export interface BehavioralDecisionEvent {
  schemaVersion: 1;
  semanticsVersion: string;
  decisionId: string;
  reproduction: Reproduction;
  policy: PolicyIdentity;
  preState: BettingRoundState;
  actorView: PlayerInformationSet;
  strata: DecisionStrata;
  legal: LegalActionSet;
  candidates: CandidateTelemetry[];
  chosen: CanonicalAction;
  geometry: WagerGeometry;
  postcondition: EventPostcondition;
  opportunityIds: string[];
  traceRef: string | null;
  actionSupport: ActionSupportAssessment | null;
  supportTraceLink: string | null;
  execution: "observed" | "counterfactual";
}

export interface PendingDecisionFrame {
  schemaVersion: 1;
  semanticsVersion: string;
  decisionId: string;
  reproduction: Reproduction;
  policy: PolicyIdentity;
  preState: BettingRoundState;
  actorView: PlayerInformationSet;
  strata: DecisionStrata;
  legal: LegalActionSet;
  opportunityIds: string[];
  traceRef: string | null;
}

export interface CaptureDecisionBeforeInput {
  decisionId: string;
  reproduction: Reproduction;
  policy: PolicyIdentity;
  preState: BettingRoundState;
  actorView: PlayerInformationSet;
  legal: LegalActionSet;
  strata: DecisionStrata;
  opportunityIds?: readonly string[];
  traceRef?: string | null;
  semanticsVersion?: string;
}

function cloneState(state: BettingRoundState): BettingRoundState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    actionOrder: [...state.actionOrder],
    pending: [...state.pending],
    lastActedAtBet: { ...state.lastActedAtBet },
  };
}

function stableStateHash(state: BettingRoundState): string {
  return JSON.stringify({
    currentBet: state.currentBet,
    lastFullRaise: state.lastFullRaise,
    pending: state.pending,
    complete: state.complete,
    handComplete: state.handComplete,
    players: [...state.players].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function captureDecisionBefore(input: CaptureDecisionBeforeInput): PendingDecisionFrame {
  assertBettingStateInvariant(input.preState);
  if (input.legal.playerId !== input.actorView.viewerId) throw new Error("Decision legal set and actor view disagree");
  return {
    schemaVersion: 1,
    semanticsVersion: input.semanticsVersion ?? "poker-action-semantics-v1",
    decisionId: input.decisionId,
    reproduction: input.reproduction,
    policy: input.policy,
    preState: cloneState(input.preState),
    actorView: {
      ...input.actorView,
      board: input.actorView.board.map((card) => ({ ...card })),
      players: input.actorView.players.map((player) => ({ ...player, holeCards: player.holeCards?.map((card) => ({ ...card })) })),
      actions: input.actorView.actions.map((action) => ({ ...action })),
    },
    strata: structuredClone(input.strata),
    legal: structuredClone(input.legal),
    opportunityIds: [...(input.opportunityIds ?? [])],
    traceRef: input.traceRef ?? null,
  };
}

export interface CompleteDecisionEventInput {
  frame: PendingDecisionFrame;
  command: BettingActionCommand;
  geometry?: Omit<WagerGeometryContext, "preState" | "canonicalAction">;
  candidates?: readonly CandidateTelemetry[];
  actionSupport?: ActionSupportAssessment | null;
  execution?: "observed" | "counterfactual";
}

export function completeDecisionEvent(input: CompleteDecisionEventInput): BehavioralDecisionEvent {
  const chosen = canonicalizeBettingAction(input.frame.preState, input.command);
  const geometry = computeWagerGeometry({
    preState: input.frame.preState,
    canonicalAction: chosen,
    ...input.geometry,
  });
  const errors: string[] = [];
  if (chosen.result.event.playerId !== input.frame.legal.playerId) errors.push("actor_mismatch");
  if (chosen.result.event.to !== chosen.targetChips) errors.push("target_mismatch");
  try { assertBettingStateInvariant(chosen.result.state); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  return {
    schemaVersion: 1,
    semanticsVersion: input.frame.semanticsVersion,
    decisionId: input.frame.decisionId,
    reproduction: input.frame.reproduction,
    policy: input.frame.policy,
    preState: cloneState(input.frame.preState),
    actorView: input.frame.actorView,
    strata: input.frame.strata,
    legal: input.frame.legal,
    candidates: [...(input.candidates ?? [])],
    chosen,
    geometry,
    postcondition: {
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      executionHash: stableStateHash(chosen.result.state),
    },
    opportunityIds: [...input.frame.opportunityIds],
    traceRef: input.frame.traceRef,
    actionSupport: input.actionSupport ?? null,
    supportTraceLink: input.frame.traceRef,
    execution: input.execution ?? "observed",
  };
}

export function invalidAttemptFrame(frame: PendingDecisionFrame, error: unknown): {
  decisionId: string;
  status: "invalid";
  canonicalAction: null;
  error: string;
} {
  return {
    decisionId: frame.decisionId,
    status: "invalid",
    canonicalAction: null,
    error: error instanceof Error ? error.message : String(error),
  };
}
