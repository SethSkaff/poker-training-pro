import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));
const tableSource = readFileSync(path.join(componentDirectory, "PokerTable.tsx"), "utf8");
const styleSource = readFileSync(path.join(componentDirectory, "..", "styles.css"), "utf8");
const twoDStyles = styleSource.slice(styleSource.lastIndexOf("Isolated 2D table pass"));

describe("isolated 2D table layout contract", () => {
  it("keeps the identity, stack, bet, fold, and peek layers separate", () => {
    expect(tableSource).toContain('data-hero-identity": "true"');
    expect(tableSource).toContain('<span className="seat-name">{isHero ? formatMessage("table.seat.you")');
    expect(tableSource).toContain("<strong>{formatChips(player.stack)}</strong>");
    expect(tableSource).toContain("{player.bet > 0 && (");
    expect(tableSource).toContain('data-bet-badge={isHero ? "hero" : "opponent"}');
    expect(tableSource).toContain('data-card-control="hero"');
    expect(tableSource).not.toContain('className="hero-stack-readout"');
    expect(tableSource).toContain("const isShowingCards = !isHero && !isOut && cardsDealt && !isFolded");
    expect(tableSource).toContain("setFoldProgress(0);");
  });

  it("anchors every 2D seat to the rail and keeps opponent cards inside the viewport", () => {
    expect(twoDStyles).toContain("overflow: visible;");
    expect(twoDStyles).toContain("--rail-gap: clamp(5px, 0.55vw, 8px);");
    expect(twoDStyles).toContain(
      "left: calc(var(--table-left) - var(--avatar-half) - var(--rail-gap));",
    );
    expect(twoDStyles).toContain(
      "left: calc(var(--table-right) + var(--avatar-half) + var(--rail-gap));",
    );
    expect(twoDStyles).toContain(".player-seat--upper-left .opponent-cards");
    expect(twoDStyles).toContain("left: 50%;");
    expect(twoDStyles).toContain(".player-seat--upper-right .opponent-cards");
    expect(twoDStyles).toContain("right: 50%;");
  });

  it("preserves a large flat table at desktop and a readable compact breakpoint", () => {
    expect(twoDStyles).toContain("--table-left: 5%;");
    expect(twoDStyles).toContain("--table-width: 90%;");
    expect(twoDStyles).toContain("--table-top: 13%;");
    expect(twoDStyles).toContain("--table-left: 12.5%;");
    expect(twoDStyles).toContain("--table-width: 75%;");
    expect(twoDStyles).toContain("--table-height: 42.5%;");
    expect(twoDStyles).toContain("top: calc(var(--table-bottom) + var(--avatar-size) + var(--rail-gap) + 36px);");
    expect(twoDStyles).toContain("min-width: 146px;");
    expect(twoDStyles).toContain("min-width: 122px;");
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
