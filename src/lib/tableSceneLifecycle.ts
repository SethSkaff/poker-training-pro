/**
 * The table is one continuous scene. Authoritative poker state can advance
 * several times during a hand, but those updates must not be represented by a
 * React key (which would destroy the scene and its camera/assistive DOM).
 */
export interface TableSceneVersion {
  readonly handId: string;
  readonly stateVersion: number;
}

export interface TableSceneUpdatePlan {
  readonly changed: boolean;
  readonly handChanged: boolean;
  /** Clear a submitted hero action once a new legal hero decision arrives. */
  readonly clearDecisionTransientState: boolean;
  /** Reset only visuals that belong to the previous hand. */
  readonly resetHandVisualState: boolean;
  /** Scene-owned interaction state must survive ordinary engine updates. */
  readonly preserveCameraPan: true;
  readonly preservePauseState: true;
  readonly preservePeekState: boolean;
}

export function planTableSceneUpdate(
  previous: TableSceneVersion,
  next: TableSceneVersion,
): TableSceneUpdatePlan {
  const changed = previous.stateVersion !== next.stateVersion;
  const handChanged = previous.handId !== next.handId;
  return {
    changed,
    handChanged,
    clearDecisionTransientState: changed,
    resetHandVisualState: handChanged,
    preserveCameraPan: true,
    preservePauseState: true,
    // A new hand receives new face-down cards. Within the same hand an
    // opponent update must not unexpectedly hide the hero's deliberate peek.
    preservePeekState: !handChanged,
  };
}

/** Synchronous guard against double-click/skip races before React re-renders. */
export function createTableActionGate() {
  let locked = false;
  return {
    tryBegin(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    release(): void {
      locked = false;
    },
    get isLocked(): boolean {
      return locked;
    },
  };
}
