import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatChips } from "../lib/format";
import { heroStackAriaLabel, tablePositionLabelForSeat } from "./PokerTable";

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("persistent hero stack HUD", () => {
  it("maps button, blinds, and postflop positions across a full table rotation", () => {
    const labels = Array.from({ length: 6 }, (_, seat) =>
      tablePositionLabelForSeat({
        seat,
        buttonSeat: 0,
        smallBlindSeat: 1,
        bigBlindSeat: 2,
        playerCount: 6,
      }),
    );

    expect(labels).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "MP"]);
    // Rotate every visible marker one seat: labels must follow the engine
    // seats rather than a fixed visual slot.
    expect(tablePositionLabelForSeat({
      seat: 3,
      buttonSeat: 1,
      smallBlindSeat: 2,
      bigBlindSeat: 3,
      playerCount: 6,
    })).toBe("BB");
    expect(tablePositionLabelForSeat({
      seat: 4,
      buttonSeat: 1,
      smallBlindSeat: 2,
      bigBlindSeat: 3,
      playerCount: 6,
    })).toBe("UTG");
  });

  it("uses the live stack value in visible and accessible status copy", () => {
    expect(heroStackAriaLabel({
      stack: 3_600,
      streetCommitted: 200,
      totalCommitted: 800,
      position: "BB",
    })).toBe(
      `Your remaining stack: ${formatChips(3_600)} chips. ` +
        `Committed this round: ${formatChips(200)} chips. ` +
        `Total committed this hand: ${formatChips(800)} chips. Position: BB.`,
    );

    const source = readFileSync(
      path.join(componentDirectory, "PokerTable.tsx"),
      "utf8",
    );
    expect(source).toContain('className="hero-stack-hud"');
    expect(source).toContain("aria-label={heroStackAriaLabel({");
    expect(source).toContain("streetCommitted: heroStreetCommitted");
    expect(source).toContain("totalCommitted: heroTotalCommitted");
    expect(source).toContain("{formatChips(heroStack)}");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
  });

  it("guards against hiding the only always-visible hero stack surface", () => {
    const styles = readFileSync(
      path.join(componentDirectory, "..", "styles.css"),
      "utf8",
    );
    const hudRule = styles.match(/\.hero-stack-hud\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(hudRule).toBeDefined();
    expect(hudRule).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/i);
    expect(hudRule).toMatch(/position\s*:\s*absolute/i);
    expect(hudRule).toMatch(/z-index\s*:\s*34/i);
  });
});
