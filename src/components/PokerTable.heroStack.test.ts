import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatChips } from "../lib/format";
import { heroStackAriaLabel } from "./PokerTable";

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));

describe("persistent hero stack HUD", () => {
  it("uses the live stack value in visible and accessible status copy", () => {
    expect(heroStackAriaLabel(3_600)).toBe(
      `Your remaining stack: ${formatChips(3_600)} chips`,
    );

    const source = readFileSync(
      path.join(componentDirectory, "PokerTable.tsx"),
      "utf8",
    );
    expect(source).toContain('className="hero-stack-hud"');
    expect(source).toContain("aria-label={heroStackAriaLabel(heroStack)}");
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
