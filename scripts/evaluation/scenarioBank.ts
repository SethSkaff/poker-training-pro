import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Card, Street } from "../../src/types/poker";
import { createBettingRound, type BettingPlayerState, type BettingRoundState } from "../../src/engine/betting";
import { buildReachableScenario, verifyScenarioReachability, type ScenarioDefinition } from "./scenarios";

export interface ScenarioBank {
  schemaVersion: 1;
  bankId: string;
  splitSalt: string;
  generatedCount: number;
  scenarios: ScenarioDefinition[];
  familyIds: string[];
}

function hashModulo(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) % 100;
}

export function assignFamilySplit(
  familyId: string,
  splitSalt = "poker-evaluation-split-v1",
): { split: ScenarioDefinition["split"]; reason: string } {
  if (familyId === "wesley-reconstructed") return { split: "development", reason: "named forensic fixture is development-only" };
  const bucket = hashModulo(`${splitSalt}:${familyId}`);
  return bucket < 60
    ? { split: "development", reason: `hash bucket ${bucket} in 0-59` }
    : bucket < 80
      ? { split: "calibration", reason: `hash bucket ${bucket} in 60-79` }
      : { split: "holdout", reason: `hash bucket ${bucket} in 80-99` };
}

function cloneCards(cards: readonly Card[]): Card[] {
  return cards.map((card) => ({ ...card }));
}

function basePlayers(count: number, stack: number, totalCommitments = 0): BettingPlayerState[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    stack,
    streetCommitted: totalCommitments,
    totalCommitted: totalCommitments,
    status: "active" as const,
  }));
}

function genericScenario(index: number): ScenarioDefinition {
  const street: Street = (["preflop", "flop", "turn", "river"] as const)[index % 4];
  const count = 2 + (index % 3);
  const stack = 2_000 + (index % 7) * 1_000;
  const familyKind = index % 12 === 0 ? "deep-pressure" : index % 12 === 1 ? "asymmetric-side-pot" : index % 12 === 2 ? "reopening" : index % 12 === 3 ? "extreme-5x" : index % 12 === 4 ? "extreme-10x" : "ordinary";
  const familyId = `${familyKind}-family-${Math.floor(index / 12)}`;
  const players = basePlayers(count, stack);
  const order = players.map((player) => player.id);
  const initial = createBettingRound(players, order, { minimumBet: 100 });
  const prefix = street === "preflop" ? [] : [{ playerId: "p1", command: { type: "check" as const } }];
  return buildReachableScenario({
    familyId,
    scenarioId: `${familyId}-node-${index}`,
    street,
    initialEngineState: initial,
    prefix,
    board: street === "preflop" ? [] : cloneCards([{ rank: "T", suit: "hearts" }, { rank: "7", suit: "clubs" }, { rank: "2", suit: "diamonds" }]).slice(0, street === "flop" ? 3 : street === "turn" ? 4 : 5),
    intendedCoverageTags: [familyKind, street, count === 2 ? "heads-up" : "multiway", stack > 20_000 ? "deep" : "ordinary-depth"],
    support: familyKind.startsWith("extreme")
      ? { status: "mechanical_only", provenance: "reachable negative control; strategic labels pending", modelDomain: null }
      : { status: "mechanical_only", provenance: "reachable synthetic scenario bank", modelDomain: null },
    notes: familyKind === "extreme-5x" || familyKind === "extreme-10x" ? ["unusual sizing is a retrieval signal, not an invalidity label"] : [],
  });
}

function reconstructedJamScenario(): ScenarioDefinition {
  const initial = createBettingRound([
    { id: "button", stack: 21_097, streetCommitted: 0, totalCommitted: 185, status: "folded" },
    { id: "hero", stack: 20_282, streetCommitted: 0, totalCommitted: 1_000, status: "active" },
    { id: "opponent", stack: 20_282, streetCommitted: 0, totalCommitted: 1_000, status: "active" },
  ], ["hero", "opponent", "button"], { minimumBet: 75, currentBet: 0 });
  return buildReachableScenario({
    familyId: "wesley-reconstructed",
    scenarioId: "wesley-reconstructed-flop-jam",
    street: "flop",
    configurationRef: "reconstructed-qdiamond-tdiamond-flop-v1",
    initialEngineState: initial,
    prefix: [
      { playerId: "hero", command: { type: "check" } },
      { playerId: "opponent", command: { type: "all-in" } },
    ],
    board: [{ rank: "T", suit: "hearts" }, { rank: "A", suit: "diamonds" }, { rank: "J", suit: "hearts" }],
    declaredHoleCards: {
      hero: [{ rank: "Q", suit: "diamonds" }, { rank: "T", suit: "diamonds" }],
    },
    intendedCoverageTags: ["deep-pressure", "heads-up", "reconstructed-jam", "flop"],
    support: { status: "mechanical_only", provenance: "synthetic reachable reconstruction; opponent worlds supplied by T7", modelDomain: null },
    notes: ["P=22467", "C=20282", "P+C=42749", "call odds=C/(P+C)=0.4744438", "no uncalled refund or side pot in this state"],
  });
}

function annotateSplit(scenario: ScenarioDefinition, splitSalt: string): ScenarioDefinition {
  const assigned = assignFamilySplit(scenario.familyId, splitSalt);
  return { ...scenario, split: assigned.split, splitReason: assigned.reason };
}

export function createScenarioBank(count = 120, splitSalt = "poker-evaluation-split-v1"): ScenarioBank {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Scenario bank count must be positive");
  const scenarios = [reconstructedJamScenario(), ...Array.from({ length: Math.max(0, count - 1) }, (_, index) => genericScenario(index))]
    .map((scenario) => annotateSplit(scenario, splitSalt));
  for (const scenario of scenarios) verifyScenarioReachability(scenario);
  return {
    schemaVersion: 1,
    bankId: createHash("sha256").update(JSON.stringify({ splitSalt, scenarios })).digest("hex"),
    splitSalt,
    generatedCount: scenarios.length,
    scenarios,
    familyIds: [...new Set(scenarios.map((scenario) => scenario.familyId))].sort(),
  };
}

export function serializeScenarioBank(bank: ScenarioBank): string {
  return `${JSON.stringify(bank, null, 2)}\n`;
}

export function loadScenarioBank(source: ScenarioBank | string, options: { expectedSplitSalt?: string; expectedMinCount?: number } = {}): ScenarioBank {
  const bank = typeof source === "string" ? JSON.parse(readFileSync(source, "utf8")) as ScenarioBank : source;
  if (bank.schemaVersion !== 1) throw new Error("Unsupported scenario-bank schema");
  if (options.expectedSplitSalt && bank.splitSalt !== options.expectedSplitSalt) throw new Error("Scenario bank split salt mismatch");
  if (options.expectedMinCount !== undefined && bank.scenarios.length < options.expectedMinCount) throw new Error("Scenario bank is smaller than the requested coverage");
  const familySplits = new Map<string, ScenarioDefinition["split"]>();
  for (const scenario of bank.scenarios) {
    verifyScenarioReachability(scenario);
    const existing = familySplits.get(scenario.familyId);
    if (existing && existing !== scenario.split) throw new Error(`Family ${scenario.familyId} crosses split boundaries`);
    familySplits.set(scenario.familyId, scenario.split);
  }
  return bank;
}
