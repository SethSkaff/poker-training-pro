import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));
const tableSource = readFileSync(path.join(componentDirectory, "PokerTable.tsx"), "utf8");
const styleSource = readFileSync(path.join(componentDirectory, "..", "styles.css"), "utf8");
const twoDStyles = styleSource.slice(styleSource.lastIndexOf("Isolated 2D table pass"));

describe("isolated 2D table layout contract", () => {
  it("ships only the current isolated 2D pass", () => {
    expect(styleSource.match(/Isolated 2D table pass/g)).toHaveLength(1);
    expect(styleSource).not.toContain("The fallback is a deliberate flat table");
    expect(twoDStyles).toContain("Authored 2D model portraits.");
  });

  it("keeps the identity, stack, bet, fold, and peek layers separate", () => {
    expect(tableSource).toContain('data-hero-identity": "true"');
    expect(tableSource).toContain('<span className="seat-name">{isHero ? formatMessage("table.seat.you")');
    expect(tableSource).toContain("<strong>{formatChips(player.stack)}</strong>");
    expect(tableSource).toContain("{player.bet > 0 && (");
    expect(tableSource).toContain('data-bet-badge={isHero ? "hero" : "opponent"}');
    expect(tableSource).toContain('data-card-control="hero"');
    expect(tableSource).not.toContain('className="hero-stack-readout"');
    expect(tableSource).toContain("const isShowingCards = !isHero && !isOut && visiblePrivateCardCount > 0 && !isFolded");
    expect(tableSource).toContain("setFoldProgress(0);");
  });

  it("keeps the 2D surface quiet while making bets and cards unambiguous", () => {
    expect(tableSource).toContain("physicalChips={isTwoDMode}");
    expect(tableSource).toContain('className="seat-stack-chips"');
    expect(twoDStyles).toContain("--table-height: calc(100% - var(--table-top) - 76px);");
    expect(twoDStyles).toContain("border-radius: 50%;");
    expect(twoDStyles).toContain("--side-upper-y: calc(var(--table-top) + var(--table-height) * 0.2);");
    expect(twoDStyles).toContain("--side-lower-y: calc(var(--table-top) + var(--table-height) * 0.8);");
    expect(twoDStyles).toContain(".table-screen--2d .seat-figure-accessory--visor");
    expect(twoDStyles).toContain(".table-screen--2d .hero-card-control");
    expect(twoDStyles).toContain(".table-screen--2d .fold-release-zone");
    expect(twoDStyles).toContain(".table-screen--2d .hero-hole-cards-visual .hero-card-wrap small");
    expect(twoDStyles).toContain("flex-direction: row-reverse;");
    expect(twoDStyles).toContain(".table-screen--2d .community-placeholder");
    expect(twoDStyles).toContain(".table-screen--2d .hero-hole-cards__cards");
  });

  it("anchors every 2D seat to the rail and keeps opponent cards inside the viewport", () => {
    expect(twoDStyles).toContain("overflow: visible;");
    expect(twoDStyles).toContain("--rail-gap: clamp(5px, 0.55vw, 8px);");
    expect(twoDStyles).toContain(
      "left: var(--side-inset);",
    );
    expect(twoDStyles).toContain(
      "left: calc(100% - var(--side-inset));",
    );
    expect(twoDStyles).toContain(".player-seat--upper-left .opponent-cards");
    expect(twoDStyles).toContain("left: 50%;");
    expect(twoDStyles).toContain(".player-seat--upper-right .opponent-cards");
    expect(twoDStyles).toContain("right: 50%;");
  });

  it("puts each position marker in front of its owner's stack", () => {
    expect(twoDStyles).toContain(".table-screen--2d .player-seat--top .seat-position-marker");
    expect(twoDStyles).toContain("top: calc(100% + 8px);");
    expect(twoDStyles).toContain(".table-screen--2d .player-seat--hero .seat-position-marker");
    expect(twoDStyles).toContain("left: calc(100% + 12px);");
    expect(twoDStyles).toContain("left: calc(100% + 8px);");
    expect(twoDStyles).toContain("right: calc(100% + 8px);");
  });

  it("preserves a large flat table at desktop and a readable compact breakpoint", () => {
    expect(twoDStyles).toContain("display: block;");
    expect(twoDStyles).toContain("height: 100%;");
    expect(twoDStyles).toContain("--table-left: 7%;");
    expect(twoDStyles).toContain("--table-width: 86%;");
    expect(twoDStyles).toContain("--table-top: clamp(122px, 17cqh, 170px);");
    expect(twoDStyles).toContain("--table-left: 9%;");
    expect(twoDStyles).toContain("--table-width: 82%;");
    expect(twoDStyles).toContain("--table-top: 142px;");
    expect(twoDStyles).toContain("top: calc(var(--table-bottom) + var(--avatar-size) + var(--rail-gap) + 36px);");
    expect(twoDStyles).toContain("min-width: 146px;");
    expect(twoDStyles).toContain("min-width: 122px;");
  });

  it("keeps the training question as a top-right overlay instead of a second row", () => {
    expect(twoDStyles).toContain(
      '.table-screen--2d[data-game-mode="training"]',
    );
    expect(twoDStyles).toContain("> .table-layout");
    expect(twoDStyles).toContain("> .training-panel");
    expect(twoDStyles).toContain("> .feedback-panel");
    expect(twoDStyles).toContain("top: 16px;");
    expect(twoDStyles).toContain("right: 16px;");
    expect(twoDStyles).toContain("aspect-ratio: auto;");
  });

  it("uses quiet felt/rail/room colors without ambient bloom", () => {
    expect(twoDStyles).toContain("--two-d-bg: #101214;");
    expect(twoDStyles).toContain("--two-d-felt: #155232;");
    expect(twoDStyles).toContain("--two-d-rail: #603a2c;");
    expect(twoDStyles).not.toContain("radial-gradient");
    expect(twoDStyles).not.toMatch(/filter:\s*blur/i);
    expect(twoDStyles).toContain("backdrop-filter: none;");
    expect(twoDStyles).not.toContain("backdrop-filter: blur");
  });
});
