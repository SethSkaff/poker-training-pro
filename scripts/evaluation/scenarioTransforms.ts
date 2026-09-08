import type { Card, Suit } from "../../src/types/poker";
import type { BettingRoundState } from "../../src/engine/betting";
import { buildReachableScenario, type ScenarioDefinition, type ScenarioPrefixStep } from "./scenarios";

export type ScenarioTransform =
  | { type: "scale"; factor: number }
  | { type: "suit-permutation"; mapping: Record<Suit, Suit> };

function scaleState(state: BettingRoundState, factor: number): BettingRoundState {
  return {
    ...state,
    chipTotal: state.chipTotal * factor,
    currentBet: state.currentBet * factor,
    minimumBet: state.minimumBet * factor,
    lastFullRaise: state.lastFullRaise * factor,
    players: state.players.map((player) => ({
      ...player,
      stack: player.stack * factor,
      streetCommitted: player.streetCommitted * factor,
      totalCommitted: player.totalCommitted * factor,
    })),
    lastActedAtBet: Object.fromEntries(Object.entries(state.lastActedAtBet).map(([id, value]) => [id, value === undefined ? undefined : value * factor])),
  };
}

function mapCard(card: Card, mapping: Record<Suit, Suit>): Card {
  return { rank: card.rank, suit: mapping[card.suit] };
}

function transformState(state: BettingRoundState, transform: ScenarioTransform): BettingRoundState {
  if (transform.type === "scale") return scaleState(state, transform.factor);
  return { ...state, players: state.players.map((player) => ({ ...player })) };
}

function transformStep(step: ScenarioPrefixStep, transform: ScenarioTransform): ScenarioPrefixStep {
  if (transform.type === "scale") {
    return { playerId: step.playerId, command: { ...step.command, ...(step.command.to === undefined ? {} : { to: step.command.to * transform.factor }) } };
  }
  return { playerId: step.playerId, command: { ...step.command } };
}

export function applyScenarioTransform(scenario: ScenarioDefinition, transform: ScenarioTransform): ScenarioDefinition {
  if (transform.type === "scale" && (!Number.isSafeInteger(transform.factor) || transform.factor <= 0)) {
    throw new Error("Scenario scale must be a positive safe integer");
  }
  const initial = transformState(scenario.initialEngineState, transform);
  const prefix = scenario.executableLegalActionPrefix.map((step) => transformStep(step, transform));
  const board = transform.type === "suit-permutation" ? scenario.board.map((card) => mapCard(card, transform.mapping)) : scenario.board.map((card) => ({ ...card }));
  const holes = scenario.declaredHoleCards
    ? Object.fromEntries(Object.entries(scenario.declaredHoleCards).map(([id, cards]) => [id, transform.type === "suit-permutation" ? cards.map((card) => mapCard(card, transform.mapping)) : cards.map((card) => ({ ...card }))]))
    : null;
  return buildReachableScenario({
    familyId: scenario.familyId,
    scenarioId: `${scenario.scenarioId}:${transform.type}:${transform.type === "scale" ? transform.factor : Object.values(transform.mapping).join(",")}`,
    street: scenario.street,
    rulesRef: scenario.rulesRef,
    configurationRef: scenario.configurationRef,
    initialEngineState: initial,
    prefix,
    board,
    declaredHoleCards: holes,
    transformationLineage: [...scenario.transformationLineage, scenario.scenarioId],
    intendedCoverageTags: scenario.intendedCoverageTags,
    support: scenario.support,
    notes: scenario.expectedMechanics.notes,
  });
}

export function scaleScenario(scenario: ScenarioDefinition, factor: number): ScenarioDefinition {
  return applyScenarioTransform(scenario, { type: "scale", factor });
}

export function permuteScenarioSuits(scenario: ScenarioDefinition, mapping: Record<Suit, Suit>): ScenarioDefinition {
  const values = new Set(Object.values(mapping));
  if (values.size !== 4) throw new Error("Suit permutation must be bijective");
  return applyScenarioTransform(scenario, { type: "suit-permutation", mapping });
}
