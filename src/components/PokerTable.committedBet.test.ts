import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(directory, "PokerTable.tsx"), "utf8");
const styles = readFileSync(path.join(directory, "..", "styles.css"), "utf8");

describe("committed wager presentation", () => {
  it("shows an opponent wager only when chips are actually committed", () => {
    expect(source).toContain("!isHero && player.bet > 0");
    expect(source).toContain('formatMessage("table.seat.committed")');
  });

  it("keeps the wager lane clear of the balance plate", () => {
    const betRule = styles.match(/\.seat-bet\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(betRule).toMatch(/top:\s*140px/);
    expect(betRule).toMatch(/z-index:\s*3/);
  });
});
