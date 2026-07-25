import { describe, expect, it } from "vitest";
import {
  createTableActionGate,
  planTableSceneUpdate,
} from "./tableSceneLifecycle";

describe("table scene lifecycle", () => {
  it("retains the scene's camera, pause, and peek state through an action or street update", () => {
    const action = planTableSceneUpdate(
      { handId: "hand-7", stateVersion: 41 },
      { handId: "hand-7", stateVersion: 42 },
    );
    const street = planTableSceneUpdate(
      { handId: "hand-7", stateVersion: 42 },
      { handId: "hand-7", stateVersion: 43 },
    );

    for (const update of [action, street]) {
      expect(update.changed).toBe(true);
      expect(update.handChanged).toBe(false);
      expect(update.clearDecisionTransientState).toBe(true);
      expect(update.resetHandVisualState).toBe(false);
      expect(update.preserveCameraPan).toBe(true);
      expect(update.preservePauseState).toBe(true);
      expect(update.preservePeekState).toBe(true);
    }
  });

  it("resets only stale per-hand visuals when a new hand starts", () => {
    const update = planTableSceneUpdate(
      { handId: "hand-7", stateVersion: 43 },
      { handId: "hand-8", stateVersion: 44 },
    );

    expect(update.handChanged).toBe(true);
    expect(update.resetHandVisualState).toBe(true);
    expect(update.preservePeekState).toBe(false);
    expect(update.preserveCameraPan).toBe(true);
    expect(update.preservePauseState).toBe(true);
  });

  it("accepts exactly one action until the next authoritative decision state", () => {
    const gate = createTableActionGate();
    expect(gate.tryBegin()).toBe(true);
    expect(gate.tryBegin()).toBe(false);
    expect(gate.isLocked).toBe(true);
    gate.release();
    expect(gate.isLocked).toBe(false);
    expect(gate.tryBegin()).toBe(true);
  });
});
