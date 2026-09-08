import type { CanonicalAction } from "../../src/lib/pokerActionSemantics";
import type { BehavioralDecisionEvent } from "./decisionEvent";

export type OpportunityKind =
  | "dealt_hand"
  | "facing_bet"
  | "raise_available_facing_bet"
  | "three_bet"
  | "four_bet"
  | "voluntary_entry"
  | "preflop_raise";

export interface OpportunityEvent {
  version: 1;
  id: string;
  blockId: string;
  sessionId: string;
  handId: string;
  actorId: string;
  decisionId: string | null;
  kind: OpportunityKind;
  eligible: boolean;
  eligibilityReason: string;
  outcome: "pending" | "yes" | "no";
  strataRef: string;
}

function stableId(parts: readonly (string | number | boolean)[]): string {
  return parts.map((part) => String(part).replaceAll(":", "%3A")).join(":");
}

function outcome(eligible: boolean, yes: boolean): OpportunityEvent["outcome"] {
  return eligible ? (yes ? "yes" : "no") : "pending";
}

export interface HandOpportunityActor {
  actorId: string;
  dealtIn: boolean;
  preflopActions: readonly CanonicalAction[];
  strataRef?: string;
}

export interface HandOpportunityInput {
  blockId: string;
  sessionId: string;
  handId: string;
  actors: readonly HandOpportunityActor[];
}

/** Emits one immutable player-hand denominator and binary entry outcomes. */
export function emitHandOpportunities(input: HandOpportunityInput): OpportunityEvent[] {
  return input.actors.flatMap((actor) => {
    const voluntary = actor.preflopActions.some((action) =>
      (action.kind === "call" || action.kind === "bet" || action.kind === "raise") && action.investedChips > 0,
    );
    const raised = actor.preflopActions.some((action) => action.kind === "bet" || action.kind === "raise");
    const prefix = [input.blockId, input.sessionId, input.handId, actor.actorId] as const;
    const strataRef = actor.strataRef ?? "hand-start";
    const rows: OpportunityEvent[] = [{
      version: 1,
      id: stableId([...prefix, "dealt_hand"]),
      blockId: input.blockId,
      sessionId: input.sessionId,
      handId: input.handId,
      actorId: actor.actorId,
      decisionId: null,
      kind: "dealt_hand",
      eligible: actor.dealtIn,
      eligibilityReason: actor.dealtIn ? "dealt_into_hand" : "not_dealt_into_hand",
      outcome: outcome(actor.dealtIn, true),
      strataRef,
    }];
    if (actor.dealtIn) {
      rows.push({
        ...rows[0],
        id: stableId([...prefix, "voluntary_entry"]),
        kind: "voluntary_entry",
        eligible: true,
        eligibilityReason: "one_player_hand_denominator",
        outcome: voluntary ? "yes" : "no",
      });
      rows.push({
        ...rows[0],
        id: stableId([...prefix, "preflop_raise"]),
        kind: "preflop_raise",
        eligible: true,
        eligibilityReason: "one_player_hand_denominator",
        outcome: raised ? "yes" : "no",
      });
    }
    return rows;
  });
}

export interface DecisionOpportunityInput {
  event: BehavioralDecisionEvent;
  priorPreflopActions?: readonly CanonicalAction[];
}

function decisionRow(
  event: BehavioralDecisionEvent,
  kind: OpportunityKind,
  eligible: boolean,
  reason: string,
  yes: boolean,
): OpportunityEvent {
  return {
    version: 1,
    id: stableId([event.reproduction.blockId, event.reproduction.sessionId, event.reproduction.handId, event.decisionId, kind]),
    blockId: event.reproduction.blockId,
    sessionId: event.reproduction.sessionId,
    handId: event.reproduction.handId,
    actorId: event.chosen.playerId,
    decisionId: event.decisionId,
    kind,
    eligible,
    eligibilityReason: reason,
    outcome: outcome(eligible, yes),
    strataRef: event.decisionId,
  };
}

/** Emits legal-action opportunity rows using canonical action kinds, not labels. */
export function emitDecisionOpportunities(input: DecisionOpportunityInput): OpportunityEvent[] {
  const { event } = input;
  const action = event.chosen;
  const facing = event.legal.toCall > 0 && event.legal.callAmount > 0;
  const raisesAvailable = facing && (event.legal.raise !== undefined || (event.legal.allIn && event.legal.allInTo > event.geometry.currentBetChips));
  const prior = [...(input.priorPreflopActions ?? [])];
  const priorShort = prior.some((entry) => entry.isShortAllInIncrease);
  const priorFull = prior.filter((entry) => entry.isFullRaise && (entry.kind === "bet" || entry.kind === "raise")).length;
  const preflop = event.strata.street === "preflop";
  const fullRaise = action.isFullRaise && (action.kind === "bet" || action.kind === "raise");
  const rows: OpportunityEvent[] = [];
  if (facing) rows.push(decisionRow(event, "facing_bet", true, action.kind === "call" ? "canonical_call" : action.kind === "fold" ? "canonical_fold" : "canonical_raise", action.kind === "call" ? true : action.kind === "fold" ? false : action.kind === "bet" || action.kind === "raise"));
  else rows.push(decisionRow(event, "facing_bet", false, "no_call_cost", false));
  rows.push(decisionRow(event, "raise_available_facing_bet", raisesAvailable, raisesAvailable ? "legal_increase_available" : "no_legal_increase", fullRaise));
  const standardRaiseOpportunity = preflop && facing && !priorShort && (priorFull === 1 || priorFull === 2) && event.legal.raisingReopened && event.legal.raise !== undefined;
  if (standardRaiseOpportunity) {
    rows.push(decisionRow(event, priorFull === 1 ? "three_bet" : "four_bet", true, "full_voluntary_raise_sequence", fullRaise));
  }
  if (preflop) rows.push(decisionRow(event, "preflop_raise", true, "preflop_decision", fullRaise || action.isShortAllInIncrease));
  return rows;
}

export interface OpportunityKindSummary {
  kind: OpportunityKind;
  eligible: number;
  yes: number;
  no: number;
  pending: number;
  rate: number | null;
  coverage: "adequate" | "unvisited" | "sparse";
}

export interface OpportunityReduction {
  rows: OpportunityEvent[];
  duplicateCount: number;
  byKind: Record<OpportunityKind, OpportunityKindSummary>;
  vpip: number | null;
  pfr: number | null;
  facing: { fold: number | null; call: number | null; raise: number | null; continue: number | null; raiseGivenContinue: number | null };
  status: "complete" | "insufficient_evidence" | "invalid";
}

const ALL_KINDS: readonly OpportunityKind[] = ["dealt_hand", "facing_bet", "raise_available_facing_bet", "three_bet", "four_bet", "voluntary_entry", "preflop_raise"];

/** Deduplicates semantic IDs and keeps no-coverage distinct from zero. */
export function reduceOpportunities(input: readonly OpportunityEvent[]): OpportunityReduction {
  const unique = new Map<string, OpportunityEvent>();
  let duplicateCount = 0;
  for (const row of input) {
    if (row.version !== 1) throw new Error("Unsupported opportunity version");
    const existing = unique.get(row.id);
    if (existing) {
      duplicateCount += 1;
      if (existing.outcome !== row.outcome || existing.eligible !== row.eligible) throw new Error(`Conflicting duplicate opportunity ${row.id}`);
    } else unique.set(row.id, row);
  }
  const rows = [...unique.values()];
  const byKind = Object.fromEntries(ALL_KINDS.map((kind) => {
    const entries = rows.filter((row) => row.kind === kind);
    const eligible = entries.filter((row) => row.eligible && row.outcome !== "pending");
    const yes = eligible.filter((row) => row.outcome === "yes").length;
    const no = eligible.filter((row) => row.outcome === "no").length;
    const pending = entries.filter((row) => row.outcome === "pending").length;
    return [kind, {
      kind,
      eligible: eligible.length,
      yes,
      no,
      pending,
      rate: eligible.length ? yes / eligible.length : null,
      coverage: eligible.length ? "adequate" : entries.length ? "sparse" : "unvisited",
    } satisfies OpportunityKindSummary];
  })) as Record<OpportunityKind, OpportunityKindSummary>;
  const dealt = byKind.dealt_hand.eligible;
  const voluntary = byKind.voluntary_entry;
  const raised = byKind.preflop_raise;
  const facingRows = rows.filter((row) => row.kind === "facing_bet" && row.eligible && row.outcome !== "pending");
  const fold = facingRows.filter((row) => row.outcome === "no" && false).length;
  // Decision rows need their canonical outcome category to distinguish a fold
  // from a non-call non-fold raise; the compact event keeps this in the row's
  // reason code, so reducers supplied by the runner may attach category rows.
  const callRows = facingRows.filter((row) => row.eligibilityReason === "canonical_call").length;
  const raiseRows = facingRows.filter((row) => row.eligibilityReason === "canonical_raise").length;
  const foldRows = facingRows.filter((row) => row.eligibilityReason === "canonical_fold").length;
  const calls = callRows / Math.max(1, facingRows.length);
  const raisesRate = raiseRows / Math.max(1, facingRows.length);
  const foldsRate = foldRows / Math.max(1, facingRows.length);
  const continueCount = callRows + raiseRows;
  return {
    rows,
    duplicateCount,
    byKind,
    vpip: dealt ? voluntary.yes / dealt : null,
    pfr: dealt ? raised.yes / dealt : null,
    facing: {
      fold: facingRows.length ? foldsRate : null,
      call: facingRows.length ? calls : null,
      raise: facingRows.length ? raisesRate : null,
      continue: facingRows.length ? continueCount / facingRows.length : null,
      raiseGivenContinue: continueCount ? raiseRows / continueCount : null,
    },
    status: rows.some((row) => row.outcome === "pending") ? "insufficient_evidence" : "complete",
  };
}
