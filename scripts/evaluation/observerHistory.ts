import type { OpportunityEvent } from "./opportunities";

export type ObserverContext = "facingPressure" | "unopenedPreflop";
export type ObservableActionCategory = "fold" | "call" | "raise" | "check";

export interface ObserverPriorConfig {
  version: string;
  decay: "none";
  contexts: Record<ObserverContext, Partial<Record<ObservableActionCategory, number>>>;
}

export interface ShownCardRecord {
  handId: string;
  cards: string[];
  caveat: "shown_publicly" | "qualified_showdown";
}

export interface ObserverContextCounts {
  opportunities: number;
  outcomes: Record<ObservableActionCategory, number>;
  eventIds: string[];
}

export interface ObserverHistorySnapshot {
  schemaVersion: 1;
  sessionId: string;
  observerAlias: string;
  observerId: string;
  observedOpponentId: string;
  context: ObserverContext;
  seenHandCount: number;
  seenHandIds: string[];
  counts: ObserverContextCounts;
  lastObservedEventIndex: number | null;
  shownCardRecords: ShownCardRecord[];
  priorConfigRef: string;
}

export interface ObserverHistoryStore {
  schemaVersion: 1;
  historyVersion: string;
  sessionId: string;
  prior: ObserverPriorConfig;
  snapshots: ObserverHistorySnapshot[];
  observedEventIds: string[];
}

export interface ObservePublicEventInput {
  opportunity: OpportunityEvent;
  observerAlias: string;
  observerId: string;
  observedOpponentId: string;
  context: ObserverContext;
  action: ObservableActionCategory;
  observerPresentAtExposure: boolean;
  eventIndex: number;
  shownCards?: readonly string[];
  shownCardCaveat?: "shown_publicly" | "qualified_showdown";
}

export interface ObserverBeliefSnapshot {
  schemaVersion: 1;
  historyVersion: string;
  priorConfigRef: string;
  observerId: string;
  observedOpponentId: string;
  context: ObserverContext;
  status: "initialized" | "uninitialized";
  categories: ObservableActionCategory[];
  prior: Record<ObservableActionCategory, number>;
  observedCounts: Record<ObservableActionCategory, number>;
  posterior: Record<ObservableActionCategory, number> | null;
  posteriorTotal: number | null;
}

const CATEGORIES: readonly ObservableActionCategory[] = ["fold", "call", "raise", "check"];

function emptyCounts(): Record<ObservableActionCategory, number> {
  return { fold: 0, call: 0, raise: 0, check: 0 };
}

function clonePrior(prior: ObserverPriorConfig): ObserverPriorConfig {
  return { version: prior.version, decay: prior.decay, contexts: {
    facingPressure: { ...prior.contexts.facingPressure },
    unopenedPreflop: { ...prior.contexts.unopenedPreflop },
  } };
}

function priorFor(prior: ObserverPriorConfig, context: ObserverContext): Record<ObservableActionCategory, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [category, Math.max(0, prior.contexts[context][category] ?? 0)])) as Record<ObservableActionCategory, number>;
}

export function createObserverHistoryStore(input: {
  sessionId: string;
  historyVersion?: string;
  prior?: ObserverPriorConfig;
}): ObserverHistoryStore {
  const prior = input.prior ?? {
    version: "synthetic-dirichlet-v1",
    decay: "none",
    contexts: {
      facingPressure: { fold: 1, call: 1, raise: 1 },
      unopenedPreflop: { check: 1, call: 1, raise: 1 },
    },
  };
  if (prior.decay !== "none") throw new Error("Observer history T13 only supports no decay");
  for (const context of ["facingPressure", "unopenedPreflop"] as const) {
    for (const value of Object.values(prior.contexts[context])) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("Observer prior must contain non-negative finite values");
  }
  return { schemaVersion: 1, historyVersion: input.historyVersion ?? "observer-history-v1", sessionId: input.sessionId, prior: clonePrior(prior), snapshots: [], observedEventIds: [] };
}

function snapshotKey(input: Pick<ObservePublicEventInput, "observerId" | "observedOpponentId" | "context">): string {
  return `${input.observerId}:${input.observedOpponentId}:${input.context}`;
}

function emptySnapshot(input: ObservePublicEventInput, store: ObserverHistoryStore): ObserverHistorySnapshot {
  return {
    schemaVersion: 1,
    sessionId: store.sessionId,
    observerAlias: input.observerAlias,
    observerId: input.observerId,
    observedOpponentId: input.observedOpponentId,
    context: input.context,
    seenHandCount: 0,
    seenHandIds: [],
    counts: { opportunities: 0, outcomes: emptyCounts(), eventIds: [] },
    lastObservedEventIndex: null,
    shownCardRecords: [],
    priorConfigRef: store.prior.version,
  };
}

export function observePublicEvent(store: ObserverHistoryStore, input: ObservePublicEventInput): ObserverHistoryStore {
  if (input.opportunity.version !== 1) throw new Error("Unsupported OpportunityEvent version");
  if (input.opportunity.sessionId !== store.sessionId) throw new Error("Observer event belongs to another experimental session");
  if (!input.observerPresentAtExposure) return structuredClone(store);
  if (store.observedEventIds.includes(input.opportunity.id)) return structuredClone(store);
  if (!Number.isSafeInteger(input.eventIndex) || input.eventIndex < 0) throw new Error("Observer event index must be a non-negative integer");
  if (!input.opportunity.eligible || input.opportunity.outcome === "pending") return structuredClone(store);
  const next = structuredClone(store);
  const key = snapshotKey(input);
  const existingIndex = next.snapshots.findIndex((snapshot) => `${snapshot.observerId}:${snapshot.observedOpponentId}:${snapshot.context}` === key);
  const snapshot = existingIndex >= 0 ? next.snapshots[existingIndex] : emptySnapshot(input, next);
  if (snapshot.sessionId !== next.sessionId) throw new Error("Observer snapshot session mismatch");
  if (!snapshot.seenHandIds.includes(input.opportunity.handId)) {
    snapshot.seenHandIds.push(input.opportunity.handId);
    snapshot.seenHandCount += 1;
  }
  snapshot.counts.opportunities += 1;
  snapshot.counts.outcomes[input.action] += 1;
  snapshot.counts.eventIds.push(input.opportunity.id);
  snapshot.lastObservedEventIndex = snapshot.lastObservedEventIndex === null ? input.eventIndex : Math.max(snapshot.lastObservedEventIndex, input.eventIndex);
  if (input.shownCards && input.shownCards.length > 0) snapshot.shownCardRecords.push({ handId: input.opportunity.handId, cards: [...input.shownCards], caveat: input.shownCardCaveat ?? "shown_publicly" });
  if (existingIndex >= 0) next.snapshots[existingIndex] = snapshot;
  else next.snapshots.push(snapshot);
  next.observedEventIds.push(input.opportunity.id);
  return next;
}

export function resetObserverHistory(sessionId: string, prior: ObserverPriorConfig, historyVersion = "observer-history-v1"): ObserverHistoryStore {
  return createObserverHistoryStore({ sessionId, prior, historyVersion });
}

function legacyContextCounts(snapshot: ObserverHistorySnapshot): { handsObserved: number; voluntaryEntries: number; aggressiveActions: number; passiveActions: number; foldsFacingPressure: number; pressureOpportunities: number } {
  const outcomes = snapshot.counts.outcomes;
  return {
    handsObserved: snapshot.seenHandCount,
    voluntaryEntries: (outcomes.call ?? 0) + (outcomes.raise ?? 0),
    aggressiveActions: outcomes.raise ?? 0,
    passiveActions: (outcomes.call ?? 0) + (outcomes.check ?? 0),
    foldsFacingPressure: outcomes.fold ?? 0,
    pressureOpportunities: snapshot.context === "facingPressure" ? snapshot.counts.opportunities : 0,
  };
}

export function exportLegacyObserverHistory(store: ObserverHistoryStore, observerId: string): Array<{ playerId: string; handsObserved: number; voluntaryEntries: number; aggressiveActions: number; passiveActions: number; foldsFacingPressure: number; pressureOpportunities: number }> {
  const byOpponent = new Map<string, ReturnType<typeof legacyContextCounts>>();
  for (const snapshot of store.snapshots.filter((entry) => entry.observerId === observerId)) {
    const prior = byOpponent.get(snapshot.observedOpponentId) ?? { handsObserved: 0, voluntaryEntries: 0, aggressiveActions: 0, passiveActions: 0, foldsFacingPressure: 0, pressureOpportunities: 0 };
    const current = legacyContextCounts(snapshot);
    for (const field of Object.keys(prior) as (keyof typeof prior)[]) prior[field] += current[field];
    byOpponent.set(snapshot.observedOpponentId, prior);
  }
  return [...byOpponent.entries()].map(([playerId, values]) => ({ playerId, ...values }));
}

export function snapshotOpponentBeliefs(store: ObserverHistoryStore, input: { observerId: string; observedOpponentId: string; context: ObserverContext }): ObserverBeliefSnapshot {
  const matching = store.snapshots.filter((entry) => entry.observerId === input.observerId && entry.observedOpponentId === input.observedOpponentId && entry.context === input.context);
  const observedCounts = emptyCounts();
  for (const snapshot of matching) for (const category of CATEGORIES) observedCounts[category] += snapshot.counts.outcomes[category] ?? 0;
  const prior = priorFor(store.prior, input.context);
  const priorTotal = Object.values(prior).reduce((sum, value) => sum + value, 0);
  const observedTotal = Object.values(observedCounts).reduce((sum, value) => sum + value, 0);
  const initialized = priorTotal > 0 || observedTotal > 0;
  const posteriorTotal = initialized ? priorTotal + observedTotal : null;
  return {
    schemaVersion: 1,
    historyVersion: store.historyVersion,
    priorConfigRef: store.prior.version,
    observerId: input.observerId,
    observedOpponentId: input.observedOpponentId,
    context: input.context,
    status: initialized ? "initialized" : "uninitialized",
    categories: [...CATEGORIES],
    prior,
    observedCounts,
    posterior: initialized ? Object.fromEntries(CATEGORIES.map((category) => [category, (prior[category] + observedCounts[category]) / (posteriorTotal ?? 1)])) as Record<ObservableActionCategory, number> : null,
    posteriorTotal,
  };
}
