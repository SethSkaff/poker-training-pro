export interface QueuedActionShortcutState {
  readonly key: string;
  readonly hasQueuedAction: boolean;
  readonly isEditableTarget: boolean;
  readonly paused: boolean;
  readonly trainingMode: boolean;
}

/**
 * Backspace/Delete may retract only a normal-game action that is still in the
 * local presentation queue. Once that queue entry has fired, `hasQueuedAction`
 * is false and the authoritative engine action is deliberately irreversible.
 */
export function shouldCancelQueuedActionShortcut({
  key,
  hasQueuedAction,
  isEditableTarget,
  paused,
  trainingMode,
}: QueuedActionShortcutState): boolean {
  return (
    hasQueuedAction &&
    !isEditableTarget &&
    !paused &&
    !trainingMode &&
    (key === "Backspace" || key === "Delete")
  );
}
