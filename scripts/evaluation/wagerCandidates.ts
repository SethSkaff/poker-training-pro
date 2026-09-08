import {
  canonicalizeBettingAction,
  type CanonicalAction,
} from "../../src/lib/pokerActionSemantics";
import { quantizeWager } from "../../src/modes/rational";
import type {
  BettingActionCommand,
  BettingRoundState,
  LegalActionSet,
} from "../../src/engine/betting";

export type WagerCandidateOrigin =
  | "production"
  | "rack_floor"
  | "rack_ceil"
  | "human_multiple"
  | "legal_boundary"
  | "exact_action"
  | "played";

export interface WagerPreferenceProposal {
  version: string;
  status: "unvalidated" | "evidence_backed";
  chipTargets?: readonly number[];
  potMultiples?: readonly number[];
  bigBlindMultiples?: readonly number[];
  sourceEvidence: string | null;
  evidenceRefs: readonly string[];
}

export interface WagerReferenceCandidate {
  candidateId: string;
  command: BettingActionCommand;
  canonical: CanonicalAction | null;
  desiredTargetChips: number | null;
  finalTargetChips: number | null;
  origins: WagerCandidateOrigin[];
  legal: boolean;
  rackFeasible: boolean;
  exactStateDerived: boolean;
  rejectedReason: string | null;
}

export interface WagerReferenceMenu {
  schemaVersion: 1;
  menuVersion: string;
  smallestChip: number;
  originalProductionTargets: number[];
  expandedTargets: number[];
  candidates: WagerReferenceCandidate[];
  rejectedCandidates: WagerReferenceCandidate[];
  rawSizeDistribution: Record<string, number>;
  normalizedSizeDistribution: Record<string, number>;
  legalityAnomalies: string[];
  scope: {
    offlineOnly: true;
    preferenceAuthority: "none" | "descriptive_only" | "supported_tie_break_only";
    preferenceVersion: string | null;
  };
}

export interface GenerateWagerReferenceMenuInput {
  preState: BettingRoundState;
  legal: LegalActionSet;
  abstractTargets: readonly number[];
  smallestChip: number;
  preferenceProposal?: WagerPreferenceProposal;
  productionCommands?: readonly BettingActionCommand[];
  playedCommand?: BettingActionCommand;
}

function assertTarget(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function floorRack(value: number, smallestChip: number): number {
  return Math.max(smallestChip, Math.floor(value / smallestChip) * smallestChip);
}

function ceilRack(value: number, smallestChip: number): number {
  return Math.max(smallestChip, Math.ceil(value / smallestChip) * smallestChip);
}

function commandForTarget(legal: LegalActionSet, target: number): BettingActionCommand | null {
  if (legal.bet && target >= legal.bet.min && target <= legal.bet.max && target > 0) return { type: "bet", to: target };
  if (legal.raise && target >= legal.raise.minTo && target <= legal.raise.maxTo) return { type: "raise", to: target };
  return null;
}

function actionKey(command: BettingActionCommand): string {
  return command.to === undefined ? command.type : `${command.type}:${command.to}`;
}

function stateDerived(command: BettingActionCommand, legal: LegalActionSet): boolean {
  if (command.type === "fold" || command.type === "check" || command.type === "call" || command.type === "all-in") return true;
  return command.to === legal.allInTo || command.to === legal.bet?.min || command.to === legal.raise?.minTo || command.to === legal.bet?.max || command.to === legal.raise?.maxTo;
}

function boundaryKind(command: BettingActionCommand, legal: LegalActionSet): WagerCandidateOrigin | null {
  if (command.to === legal.allInTo) return "exact_action";
  if (command.to === legal.bet?.min || command.to === legal.raise?.minTo || command.to === legal.bet?.max || command.to === legal.raise?.maxTo) return "legal_boundary";
  return null;
}

function preferenceTargets(
  input: GenerateWagerReferenceMenuInput,
): number[] {
  const proposal = input.preferenceProposal;
  if (!proposal) return [];
  const pot = input.preState.players.reduce((sum, player) => sum + player.totalCommitted, 0);
  const actor = input.preState.players.find((player) => player.id === input.legal.playerId);
  const actorCommitted = actor?.streetCommitted ?? 0;
  return [
    ...(proposal.chipTargets ?? []),
    ...(proposal.potMultiples ?? []).map((multiple) => Math.round(pot * multiple) + actorCommitted),
    ...(proposal.bigBlindMultiples ?? []).map((multiple) => Math.round(multiple * input.smallestChip) + actorCommitted),
  ];
}

export function generateWagerReferenceMenu(input: GenerateWagerReferenceMenuInput): WagerReferenceMenu {
  if (!Number.isSafeInteger(input.smallestChip) || input.smallestChip <= 0) throw new Error("Smallest chip must be a positive safe integer");
  for (const target of input.abstractTargets) assertTarget(target, "Abstract wager target");
  const proposalTargets = preferenceTargets(input);
  const production = [...(input.productionCommands ?? [])];
  const candidates = new Map<string, WagerReferenceCandidate>();
  const rejected: WagerReferenceCandidate[] = [];
  const anomalies: string[] = [];
  const add = (
    command: BettingActionCommand,
    origins: WagerCandidateOrigin[],
    desiredTargetChips: number | null,
    rackFeasible: boolean,
  ) => {
    const id = actionKey(command);
    const existing = candidates.get(id);
    if (existing) {
      existing.origins = [...new Set([...existing.origins, ...origins])];
      existing.rackFeasible = existing.rackFeasible || rackFeasible;
      return;
    }
    let canonical: CanonicalAction | null = null;
    let rejectedReason: string | null = null;
    try {
      canonical = canonicalizeBettingAction(input.preState, command);
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
    const finalTargetChips = canonical?.targetChips ?? (command.to ?? null);
    const exactStateDerived = stateDerived(command, input.legal);
    const boundary = boundaryKind(command, input.legal);
    const fullOrigins = [...new Set([...origins, ...(boundary ? [boundary] : []), ...(exactStateDerived && !origins.includes("exact_action") ? ["exact_action" as const] : [])])];
    const candidate: WagerReferenceCandidate = {
      candidateId: id,
      command: { ...command },
      canonical,
      desiredTargetChips,
      finalTargetChips,
      origins: fullOrigins,
      legal: canonical !== null,
      rackFeasible,
      exactStateDerived,
      rejectedReason,
    };
    if (canonical) candidates.set(id, candidate);
    else rejected.push(candidate);
  };

  if (input.legal.fold) add({ type: "fold" }, ["exact_action"], null, true);
  if (input.legal.check) add({ type: "check" }, ["exact_action"], null, true);
  if (input.legal.call) add({ type: "call" }, ["exact_action"], null, true);
  if (input.legal.allIn) add({ type: "all-in" }, ["exact_action"], input.legal.allInTo, true);
  if (input.legal.bet) {
    add({ type: "bet", to: input.legal.bet.min }, ["legal_boundary"], input.legal.bet.min, input.legal.bet.min % input.smallestChip === 0);
    add({ type: "bet", to: input.legal.bet.max }, ["legal_boundary"], input.legal.bet.max, input.legal.bet.max % input.smallestChip === 0);
  }
  if (input.legal.raise) {
    add({ type: "raise", to: input.legal.raise.minTo }, ["legal_boundary"], input.legal.raise.minTo, input.legal.raise.minTo % input.smallestChip === 0);
    add({ type: "raise", to: input.legal.raise.maxTo }, ["legal_boundary"], input.legal.raise.maxTo, input.legal.raise.maxTo % input.smallestChip === 0);
  }

  for (const command of production) {
    add(command, ["production"], command.to ?? null, command.to === undefined || command.to % input.smallestChip === 0);
  }

  const ordinaryRange = input.legal.bet ?? (input.legal.raise ? { min: input.legal.raise.minTo, max: input.legal.raise.maxTo } : null);
  const ordinaryType: "bet" | "raise" | null = input.legal.bet ? "bet" : input.legal.raise ? "raise" : null;
  if (ordinaryRange && ordinaryType) {
    for (const desired of input.abstractTargets) {
      const floor = floorRack(desired, input.smallestChip);
      const ceil = ceilRack(desired, input.smallestChip);
      const targets = [
        { target: floor, origin: "rack_floor" as const },
        { target: ceil, origin: "rack_ceil" as const },
      ];
      for (const entry of targets) {
        const inRange = entry.target >= ordinaryRange.min && entry.target <= ordinaryRange.max;
        if (!inRange) {
          if (entry.target < ordinaryRange.min) {
            add({ type: ordinaryType, to: ordinaryRange.min }, [entry.origin, "legal_boundary"], desired, ordinaryRange.min % input.smallestChip === 0);
          } else if (entry.target > ordinaryRange.max) {
            add({ type: ordinaryType, to: ordinaryRange.max }, [entry.origin, "legal_boundary"], desired, ordinaryRange.max % input.smallestChip === 0);
          }
          continue;
        }
        add({ type: ordinaryType, to: entry.target }, [entry.origin], desired, entry.target % input.smallestChip === 0);
      }
    }
  }

  for (const desired of proposalTargets) {
    const command = commandForTarget(input.legal, desired);
    if (command) add(command, ["human_multiple"], desired, desired % input.smallestChip === 0);
    else rejected.push({
      candidateId: `human:${desired}`,
      command: { type: "raise", to: desired },
      canonical: null,
      desiredTargetChips: desired,
      finalTargetChips: null,
      origins: ["human_multiple"],
      legal: false,
      rackFeasible: desired % input.smallestChip === 0,
      exactStateDerived: false,
      rejectedReason: "No legal bet/raise command accepts the preference target",
    });
  }

  if (input.playedCommand) add(input.playedCommand, ["played"], input.playedCommand.to ?? null, input.playedCommand.to === undefined || input.playedCommand.to % input.smallestChip === 0);

  for (const candidate of candidates.values()) {
    if (!candidate.exactStateDerived && candidate.command.to !== undefined && candidate.command.to % input.smallestChip !== 0) {
      anomalies.push(`${candidate.candidateId}:ordinary_target_off_rack`);
    }
  }

  const legalCandidates = [...candidates.values()];
  const rawSizeDistribution: Record<string, number> = {};
  for (const candidate of legalCandidates) {
    const key = candidate.finalTargetChips === null ? candidate.command.type : String(candidate.finalTargetChips);
    rawSizeDistribution[key] = (rawSizeDistribution[key] ?? 0) + 1;
  }
  const total = legalCandidates.length;
  const normalizedSizeDistribution = Object.fromEntries(Object.entries(rawSizeDistribution).map(([key, count]) => [key, total ? count / total : 0]));
  const preferenceAuthority = !input.preferenceProposal
    ? "none" as const
    : input.preferenceProposal.status === "evidence_backed"
      ? "supported_tie_break_only" as const
      : "descriptive_only" as const;
  return {
    schemaVersion: 1,
    menuVersion: "wager-reference-menu-v1",
    smallestChip: input.smallestChip,
    originalProductionTargets: production.map((command) => command.to).filter((target): target is number => target !== undefined),
    expandedTargets: [...new Set(legalCandidates.map((candidate) => candidate.finalTargetChips).filter((target): target is number => target !== null))].sort((left, right) => left - right),
    candidates: legalCandidates,
    rejectedCandidates: rejected,
    rawSizeDistribution,
    normalizedSizeDistribution,
    legalityAnomalies: [...new Set(anomalies)],
    scope: {
      offlineOnly: true,
      preferenceAuthority,
      preferenceVersion: input.preferenceProposal?.version ?? null,
    },
  };
}

export function generateWagerReferenceMenuFromTargets(
  preState: BettingRoundState,
  legal: LegalActionSet,
  abstractTargets: readonly number[],
  smallestChip: number,
): WagerReferenceMenu {
  return generateWagerReferenceMenu({ preState, legal, abstractTargets, smallestChip });
}
