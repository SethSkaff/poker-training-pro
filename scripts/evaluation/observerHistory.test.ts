import { describe, expect, it } from "vitest";
import { createObserverHistoryStore, observePublicEvent, resetObserverHistory, snapshotOpponentBeliefs, exportLegacyObserverHistory, type ObservePublicEventInput } from "./observerHistory";
import type { OpportunityEvent } from "./opportunities";

function event(id: string, handId: string, sessionId = "session-a"): OpportunityEvent {
  return { version: 1, id, blockId: "block-a", sessionId, handId, actorId: "villain", decisionId: id, kind: "facing_bet", eligible: true, eligibilityReason: "canonical_call", outcome: "yes", strataRef: "fixture" };
}

function input(id: string, handId: string, action: "fold" | "call" | "raise" | "check", overrides: Partial<ObservePublicEventInput> = {}): ObservePublicEventInput {
  return { opportunity: event(id, handId), observerAlias: "observer-a", observerId: "observer-a", observedOpponentId: "villain", context: "facingPressure", action, observerPresentAtExposure: true, eventIndex: Number(id.replace("event-", "")), ...overrides };
}

describe("A13 observer history", () => {
  it("increments fold/call/raise pressure opportunities exactly once and deduplicates replay", () => {
    let store = createObserverHistoryStore({ sessionId: "session-a" });
    store = observePublicEvent(store, input("event-1", "hand-1", "fold"));
    store = observePublicEvent(store, input("event-2", "hand-1", "call"));
    store = observePublicEvent(store, input("event-3", "hand-2", "raise", { shownCards: ["As", "Kd"], shownCardCaveat: "qualified_showdown" }));
    store = observePublicEvent(store, input("event-3", "hand-2", "raise", { eventIndex: 99 }));
    const snapshot = store.snapshots[0];
    expect(snapshot.counts.opportunities).toBe(3);
    expect(snapshot.counts.outcomes).toEqual({ fold: 1, call: 1, raise: 1, check: 0 });
    expect(snapshot.seenHandCount).toBe(2);
    expect(snapshot.lastObservedEventIndex).toBe(3);
    expect(snapshot.shownCardRecords[0].caveat).toBe("qualified_showdown");
    expect(snapshot.counts.eventIds).toHaveLength(3);
  });

  it("does not backfill a late observer and isolates opponents", () => {
    let store = createObserverHistoryStore({ sessionId: "session-a" });
    store = observePublicEvent(store, input("event-1", "hand-1", "raise", { observerPresentAtExposure: false }));
    expect(store.snapshots).toHaveLength(0);
    store = observePublicEvent(store, input("event-2", "hand-2", "call", { observedOpponentId: "villain-2", observerPresentAtExposure: true }));
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshots[0].observedOpponentId).toBe("villain-2");
    expect(snapshotOpponentBeliefs(store, { observerId: "observer-a", observedOpponentId: "villain", context: "facingPressure" }).observedCounts.call).toBe(0);
  });

  it("normalizes a versioned Dirichlet posterior and reports no-prior as uninitialized", () => {
    let store = createObserverHistoryStore({ sessionId: "session-a", prior: { version: "fixture-prior", decay: "none", contexts: { facingPressure: { fold: 2, call: 1, raise: 1 }, unopenedPreflop: {} } } });
    store = observePublicEvent(store, input("event-1", "hand-1", "call"));
    const belief = snapshotOpponentBeliefs(store, { observerId: "observer-a", observedOpponentId: "villain", context: "facingPressure" });
    expect(belief.status).toBe("initialized");
    expect(belief.priorConfigRef).toBe("fixture-prior");
    expect(belief.posterior?.call).toBeCloseTo(2 / 5, 12);
    expect(Object.values(belief.posterior ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    const noPrior = createObserverHistoryStore({ sessionId: "session-b", prior: { version: "none", decay: "none", contexts: { facingPressure: {}, unopenedPreflop: {} } } });
    expect(snapshotOpponentBeliefs(noPrior, { observerId: "o", observedOpponentId: "v", context: "facingPressure" }).status).toBe("uninitialized");
  });

  it("resets at an experimental session boundary and keeps legacy export labeled", () => {
    let store = createObserverHistoryStore({ sessionId: "session-a" });
    store = observePublicEvent(store, input("event-1", "hand-1", "fold"));
    const legacy = exportLegacyObserverHistory(store, "observer-a");
    expect(legacy[0].foldsFacingPressure).toBe(1);
    const next = resetObserverHistory("session-b", store.prior);
    expect(next.snapshots).toEqual([]);
    expect(() => observePublicEvent(next, input("event-2", "hand-2", "call"))).toThrow(/another experimental session/);
  });
});
