import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(directory, "PokerTable.tsx"), "utf8");
const styles = readFileSync(path.join(directory, "..", "styles.css"), "utf8");

describe("all-in presentation", () => {
  it("turns a public all-in action into an assertive, player-named table beat", () => {
    expect(source).toContain('command.type === "all-in"');
    expect(source).toContain('className="all-in-banner"');
    expect(source).toContain('aria-live="assertive"');
  });

  it("keeps an all-in state perceptible under reduced table motion", () => {
    expect(styles).toContain(':root[data-motion-table="off"] .all-in-banner');
    expect(styles).toContain(':root[data-motion-table="reduced"] .all-in-banner');
  });

  it("puts revealed all-in hands on the 2D felt with a percentage above them", () => {
    expect(source).toContain("allInRevealPlayerIds");
    expect(source).toContain('className="all-in-win-probability"');
    expect(source).toContain("allInWinProbability * 100");
    expect(styles).toContain(
      ".table-screen--2d .player-seat.is-all-in-revealed .opponent-cards",
    );
    expect(styles).toContain(".table-screen--2d .all-in-win-probability");
  });

  it("uses the slower all-in reveal card motion for the reveal beat", () => {
    expect(source).toContain('"all-in-reveal-card"');
    expect(styles).toContain("animation: all-in-card-flip 720ms");
  });
});
