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
const styles = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

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
    expect(table).toContain('onPointerDownCapture={isTwoDMode ? undefined : beginCameraDrag}');
    expect(table).toContain('onWheelCapture={isTwoDMode ? undefined : handleCameraWheel}');
    expect(table).not.toContain("table.footer.quickRaise");
    expect(table).not.toContain("table.camera.offset");
  });

  it("keeps the unopened raise action neutral and reveals amounts in the composer", () => {
    expect(table).toContain('<strong>{formatMessage("table.action.raiseTo")}</strong>');
    expect(table).not.toContain('<small>{formatChips(minimumRaise)}</small>');
    expect(table).toContain("min={minimumRaise}");
    expect(table).toContain("value={raiseAmount}");
  });

  it("keeps folded 2D cards transient without fading or moving stack and bet identity", () => {
    expect(table.indexOf('<div className="hero-stack-readout"')).toBeGreaterThan(
      table.indexOf("</button>"),
    );
    const folded2d = styles.match(/\.table-screen--2d \.player-seat\.is-folded\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(folded2d).toContain("opacity: 1");
    expect(folded2d).toContain("filter: none");
    expect(styles).toContain(".table-screen--2d .player-seat.is-folded .seat-figure");
    expect(styles).not.toContain(".table-screen--2d .player-seat.is-folded .seat-label");
    expect(styles).not.toContain(".table-screen--2d .player-seat.is-folded .seat-bet");
    expect(table).toContain("if (!update.changed && !update.handChanged) return;");
    expect(table).toContain("setFoldProgress(0);");
  });

  it("keeps decorative room depth behind camera controls and locks peek during an action", () => {
    expect(table.indexOf('className="room-depth"')).toBeLessThan(
      table.indexOf('className="camera-controls"'),
    );
    expect(table).toContain("disabled={Boolean(action) || heroDealtCardCount === 0 || heroFolded}");
  });

  it("keeps card taps as a private toggle while preserving drag-fold protection", () => {
    expect(table).toContain('className={`hero-hole-cards ${peeked ? "is-peeked" : ""}');
    expect(table).toContain("setPeeked((value) => !value)");
    expect(table).toContain("const shouldFold = !cancelled && didDrag.current && foldProgress >= 82");
    // A table action can be in flight while the player is still entitled to
    // read their own cards. Only undealt or mucked cards reject a normal tap.
    expect(table).toContain("disabled={Boolean(action) || heroDealtCardCount === 0 || heroFolded}");
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

  it("aligns the ready-3D semantic card target to physical projected card pixels", () => {
    expect(table).toContain("heroHoleCardProjectedHitTarget({");
    expect(table).toContain("camera: activeCameraFrame ?? undefined");
    expect(table).toContain("sceneElementRef.current?.getBoundingClientRect()");
    expect(table).toContain("heroHoleCardClientPointHits(");
    expect(table).toContain("if (!dragStart.current) return;");
    expect(table).toContain('heroHoleCardHitBounds ? "has-spatial-hit-target" : ""');

    const readyTargetRule = styles.slice(
      styles.indexOf(
        '.table-stage:has(.poker-scene[data-spatial-scene="ready"]) .hero-hole-cards {',
      ),
      styles.indexOf(
        '.table-stage:has(.poker-scene[data-spatial-scene="ready"]) .hero-hole-cards {',
      ) + 800,
    );
    expect(readyTargetRule).toContain("top: var(--hero-card-hit-top)");
    expect(readyTargetRule).toContain("left: var(--hero-card-hit-left)");
    expect(readyTargetRule).toContain("width: var(--hero-card-hit-width)");
    expect(readyTargetRule).toContain("height: var(--hero-card-hit-height)");
    expect(readyTargetRule).toContain("min-width: 0");
    expect(readyTargetRule).toContain("min-height: 0");
    expect(readyTargetRule).not.toContain("bottom: 14%");
    expect(readyTargetRule).not.toContain("min-width: 180px");
    expect(readyTargetRule).not.toContain("min-height: 126px");
  });

  it("keeps the numeric question and post-move feedback interactive in ready 3D Training", () => {
    const genericHiddenRule = styles.indexOf(
      '.table-layout:has(.poker-scene[data-spatial-scene="ready"]) > .training-panel',
    );
    const trainingOverride = styles.indexOf(
      '.table-screen--3d[data-game-mode="training"]',
    );

    expect(table).toContain("data-game-mode={mode}");
    expect(table).toContain('"feedback"');
    expect(table).toContain('"question"');
    expect(genericHiddenRule).toBeGreaterThan(-1);
    expect(trainingOverride).toBeGreaterThan(genericHiddenRule);

    const override = styles.slice(trainingOverride, trainingOverride + 1_500);
    expect(override).toContain("> .training-panel");
    expect(override).toContain("> .feedback-panel");
    expect(override).toContain("clip: auto");
    expect(override).toContain("clip-path: none");
    expect(override).toContain("pointer-events: auto");
    expect(override).toContain("overflow: auto");
  });

  it("bounds 3D gameplay to the viewport without changing document overflow elsewhere", () => {
    expect(styles).toContain("body:has(.table-screen--3d)");
    expect(styles).toContain("overflow-y: hidden");

    const spatialScreenRule = styles.slice(
      styles.indexOf(".table-screen--3d {"),
      styles.indexOf(".table-screen--3d {") + 320,
    );
    expect(spatialScreenRule).toContain("height: 100dvh");
    expect(spatialScreenRule).toContain("grid-template-rows: auto minmax(0, 1fr)");

    const readyLayoutRule = styles.slice(
      styles.indexOf(
        '.table-screen--3d\n  > .table-layout:has(.poker-scene[data-spatial-scene="ready"])',
      ),
      styles.indexOf(
        '.table-screen--3d\n  > .table-layout:has(.poker-scene[data-spatial-scene="ready"])',
      ) + 240,
    );
    expect(readyLayoutRule).toContain("height: auto");

    // Non-spatial table screens retain the normal page overflow contract.
    expect(styles).not.toContain("body {\n  overflow-y: hidden");
    expect(styles).not.toContain(".table-screen--2d {\n  overflow-y: hidden");
  });
});
