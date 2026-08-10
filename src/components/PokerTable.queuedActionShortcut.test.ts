import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
  "utf8",
);

describe("PokerTable queued-action cancellation wiring", () => {
  it("clears a pending action without calling the tournament action callback", () => {
    expect(source).toContain("shouldCancelQueuedActionShortcut({");
    expect(source).toContain("queuedAction.cancel();");
    expect(source).toContain("freezeGroupRef.current.remove(queuedAction);");
    expect(source).toContain("pendingTournamentAction.current = null;");
    expect(source).toContain("setAction(null);");
    expect(source).toContain("actionGateRef.current.release();");

    const cancelBranch = source.slice(
      source.indexOf("if (\n        shouldCancelQueuedActionShortcut({"),
      source.indexOf("if (\n        shouldCancelQueuedActionShortcut({") + 1_500,
    );
    expect(cancelBranch).not.toContain("tournament.onAction");
  });

  it("marks the queue submitted before invoking authoritative game state", () => {
    const callback = source.slice(
      source.indexOf("pendingTournamentAction.current = null;\n            tournament.onAction(request);"),
      source.indexOf("pendingTournamentAction.current = null;\n            tournament.onAction(request);") + 180,
    );
    expect(callback).toContain("pendingTournamentAction.current = null;");
    expect(callback).toContain("tournament.onAction(request);");
    expect(callback.indexOf("pendingTournamentAction.current = null;")).toBeLessThan(
      callback.indexOf("tournament.onAction(request);"),
    );
  });

  it("guards text, numeric, select, and contenteditable targets", () => {
    expect(source).toContain("target instanceof HTMLInputElement");
    expect(source).toContain("target instanceof HTMLTextAreaElement");
    expect(source).toContain("target instanceof HTMLSelectElement");
    expect(source).toContain("target.isContentEditable");
    expect(source).toContain("if (isEditableTarget) return;");
  });
});
