import { createHash } from "node:crypto";
import type { Card, Street } from "../../src/types/poker";
import {
  applyBettingAction,
  assertBettingStateInvariant,
  type BettingActionCommand,
  type BettingPlayerState,
  type BettingRoundState,
} from "../../src/engine/betting";

export interface ScenarioPrefixStep {
  playerId: string;
  command: BettingActionCommand;
}

export interface ScenarioDefinition {
  schemaVersion: 1;
  familyId: string;
  scenarioId: string;
  street: Street;
  rulesRef: string;
  configurationRef: string;
  initialEngineState: BettingRoundState;
  executableLegalActionPrefix: ScenarioPrefixStep[];
  targetEngineState: BettingRoundState;
  board: Card[];
  declaredHoleCards: Record<string, Card[]> | null;
  transformationLineage: string[];
  intendedCoverageTags: string[];
  support: {
    status: "mechanical_only" | "reference_supported" | "pending";
    provenance: string;
    modelDomain: string | null;
  };
  expectedMechanics: {
    stateHash: string;
    potChips: number;
    legalActionCount: number | null;
    noSidePot: boolean;
    notes: string[];
  };
  split?: "development" | "calibration" | "holdout";
  splitReason?: string;
}

export interface BuildReachableScenarioInput {
  familyId: string;
  scenarioId: string;
  street?: Street;
  rulesRef?: string;
  configurationRef?: string;
  initialEngineState: BettingRoundState;
  prefix: readonly ScenarioPrefixStep[];
  board?: readonly Card[];
  declaredHoleCards?: Readonly<Record<string, readonly Card[]>> | null;
  transformationLineage?: readonly string[];
  intendedCoverageTags?: readonly string[];
  support?: ScenarioDefinition["support"];
  notes?: readonly string[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

export function scenarioStateHash(state: BettingRoundState): string {
  return createHash("sha256").update(stableJson(state)).digest("hex");
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

export function replayScenarioPrefix(
  initialState: BettingRoundState,
  prefix: readonly ScenarioPrefixStep[],
): BettingRoundState {
  let state = cloneState(initialState);
  for (const step of prefix) {
    if (state.complete) throw new Error(`Scenario prefix continues after completion at ${step.playerId}`);
    state = applyBettingAction(state, step.playerId, { ...step.command }).state;
  }
  assertBettingStateInvariant(state);
  return state;
}

export function buildReachableScenario(input: BuildReachableScenarioInput): ScenarioDefinition {
  assertBettingStateInvariant(input.initialEngineState);
  const target = replayScenarioPrefix(input.initialEngineState, input.prefix);
  const board = [...(input.board ?? [])].map((card) => ({ ...card }));
  const declaredHoleCards = input.declaredHoleCards
    ? Object.fromEntries(Object.entries(input.declaredHoleCards).map(([id, cards]) => [id, cards.map((card) => ({ ...card }))]))
    : null;
  return {
    schemaVersion: 1,
    familyId: input.familyId,
    scenarioId: input.scenarioId,
    street: input.street ?? "preflop",
    rulesRef: input.rulesRef ?? "holdem-no-limit-blind-only-v1",
    configurationRef: input.configurationRef ?? "evaluation-config-v1",
    initialEngineState: cloneState(input.initialEngineState),
    executableLegalActionPrefix: input.prefix.map((step) => ({ playerId: step.playerId, command: { ...step.command } })),
    targetEngineState: target,
    board,
    declaredHoleCards,
    transformationLineage: [...(input.transformationLineage ?? [])],
    intendedCoverageTags: [...(input.intendedCoverageTags ?? [])],
    support: input.support ?? { status: "mechanical_only", provenance: "reachable-engine-fixture", modelDomain: null },
    expectedMechanics: {
      stateHash: scenarioStateHash(target),
      potChips: target.players.reduce((sum, player) => sum + player.totalCommitted, 0),
      legalActionCount: target.complete || target.pending.length === 0 ? 0 : null,
      noSidePot: true,
      notes: [...(input.notes ?? [])],
    },
  };
}

export function verifyScenarioReachability(scenario: ScenarioDefinition): void {
  const rebuilt = replayScenarioPrefix(scenario.initialEngineState, scenario.executableLegalActionPrefix);
  const expected = scenarioStateHash(scenario.targetEngineState);
  const actual = scenarioStateHash(rebuilt);
  if (actual !== expected || actual !== scenario.expectedMechanics.stateHash) {
    throw new Error(`Scenario ${scenario.scenarioId} failed reachability/state-hash reconciliation`);
  }
  if (rebuilt.players.reduce((sum, player) => sum + player.totalCommitted, 0) !== scenario.expectedMechanics.potChips) {
    throw new Error(`Scenario ${scenario.scenarioId} failed commitment reconciliation`);
  }
}

export function clonePlayerState(player: BettingPlayerState): BettingPlayerState {
  return { ...player };
}
