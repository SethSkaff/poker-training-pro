import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
  "utf8",
);

describe("PokerTable immediate player actions", () => {
  it("submits all player actions in either view without a thinking timer", () => {
    const start = source.indexOf("const handleAction = useCallback(");
    const end = source.indexOf("\n  useEffect(() => {", start);
    const handler = source.slice(start, end);
    expect(handler).toContain("tournament.onAction(request);");
    expect(handler).toContain('nextAction === "raise" ? { raiseTo: requestedRaiseTo }');
    expect(handler).not.toMatch(/calculateAiDecisionTiming|FreezableDelay|setTimeout|isTwoDMode/);
    expect(source).not.toContain("pendingTournamentAction");
  });

  it("retains duplicate submission and turn guards", () => {
    expect(source).toContain("if (!actionGateRef.current.tryBegin()) return;");
    expect(source).toContain("tournament?.presentationEvent ||");
    expect(source).toContain("tournament.heroDecision === false");
    expect(source).toContain("actionGateRef.current.release();");
  });

  it("guards editable targets from gameplay hotkeys", () => {
    expect(source).toContain("target instanceof HTMLInputElement");
    expect(source).toContain("target instanceof HTMLTextAreaElement");
    expect(source).toContain("target instanceof HTMLSelectElement");
    expect(source).toContain("target.isContentEditable");
    expect(source).toContain("if (isEditableTarget) return;");
  });
});
