import { describe, expect, it } from "vitest";
import { shouldCancelQueuedActionShortcut } from "./queuedActionShortcut";

const queued = {
  hasQueuedAction: true,
  isEditableTarget: false,
  paused: false,
  trainingMode: false,
};

describe("queued normal-game action shortcut", () => {
  it.each(["Backspace", "Delete"])("cancels a live queue with %s", (key) => {
    expect(shouldCancelQueuedActionShortcut({ ...queued, key })).toBe(true);
  });

  it("ignores the shortcut after the queued action has been submitted", () => {
    expect(
      shouldCancelQueuedActionShortcut({
        ...queued,
        key: "Delete",
        hasQueuedAction: false,
      }),
    ).toBe(false);
  });

  it("preserves native editing in text and numeric controls", () => {
    expect(
      shouldCancelQueuedActionShortcut({
        ...queued,
        key: "Backspace",
        isEditableTarget: true,
      }),
    ).toBe(false);
  });

  it("does not change Training, paused play, or unrelated keys", () => {
    expect(
      shouldCancelQueuedActionShortcut({
        ...queued,
        key: "Delete",
        trainingMode: true,
      }),
    ).toBe(false);
    expect(
      shouldCancelQueuedActionShortcut({
        ...queued,
        key: "Delete",
        paused: true,
      }),
    ).toBe(false);
    expect(
      shouldCancelQueuedActionShortcut({ ...queued, key: "Escape" }),
    ).toBe(false);
  });
});
