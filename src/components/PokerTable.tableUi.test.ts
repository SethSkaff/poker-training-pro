import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const table = readFileSync(
  path.join(sourceRoot, "components", "PokerTable.tsx"),
  "utf8",
);

describe("table UI restraint and card peek", () => {
  it("applies stack and bet world projections independently of the rail plaque", () => {
    expect(table).toContain("(railAnchor || stackAnchor || betAnchor)");
    expect(table).toContain("projectionWidth = activeCameraFrame?.viewportWidth || sceneViewport.width");
    expect(table).toContain("seatStackAmountViewportAnchorFromCamera");
    expect(table).toContain("seatBetViewportAnchorFromCamera");
  });

  it("does not render the redundant bottom shortcut bar or floating camera menu", () => {
    expect(table).not.toContain('className="table-footer"');
    expect(table).toContain('className="camera-controls"');
    expect(table).toContain('onPointerDownCapture={beginCameraDrag}');
    expect(table).toContain('onWheelCapture={handleCameraWheel}');
    expect(table).not.toContain("table.footer.quickRaise");
    expect(table).not.toContain("table.camera.offset");
  });

  it("keeps decorative room depth behind camera controls and locks peek during an action", () => {
    expect(table.indexOf('className="room-depth"')).toBeLessThan(
      table.indexOf('className="camera-controls"'),
    );
    expect(table).toContain("disabled={Boolean(action) || !cardsDealt || heroFolded}");
  });

  it("keeps card taps as a private toggle while preserving drag-fold protection", () => {
    expect(table).toContain('className={`hero-hole-cards ${peeked ? "is-peeked" : ""}');
    expect(table).toContain("setPeeked((value) => !value)");
    expect(table).toContain("const shouldFold = !cancelled && didDrag.current && foldProgress >= 82");
    // A table action can be in flight while the player is still entitled to
    // read their own cards. Only undealt or mucked cards reject a normal tap.
    expect(table).toContain("disabled={Boolean(action) || !cardsDealt || heroFolded}");
    // Opponent cards remain hidden until a legal public showdown reveal.
    expect(table).toContain("hidden={!peeked && !showdownHeroRevealed}");
  });

  it("keeps the existing keyboard peek action available through the shared action map", () => {
    expect(table).toContain('case "game.peek":');
    expect(table).toContain("runGameAction(actionId)");
  });

  it("makes a non-drag card click toggle the same private peek as the keyboard shortcut", () => {
    expect(table).toContain("Pointer release without a drag is a normal click: mirror Space.");
    expect(table).toContain("setPeeked((value) => !value);");
    expect(table).toContain("event.stopPropagation();");
    expect(table).toContain("event.currentTarget.setPointerCapture(event.pointerId);");
    expect(table).toContain("if (shouldFold) {");
  });
});
