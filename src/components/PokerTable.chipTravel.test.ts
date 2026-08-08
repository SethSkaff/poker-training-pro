import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(directory, "PokerTable.tsx"), "utf8");
const styles = readFileSync(path.join(directory, "..", "styles.css"), "utf8");

describe("public chip travel", () => {
  it("maps public wager, collection, and award events to a renderer-only travel token", () => {
    expect(source).toContain('event.kind === "action"');
    expect(source).toContain('event.kind === "bets-collected"');
    expect(source).toContain('event.kind === "pot-awarded"');
    expect(source).toContain('className={`chip-travel chip-travel--${chipTravel.direction}`}');
  });

  it("uses table-relative start and destination coordinates", () => {
    expect(styles).toContain("@keyframes chip-travel");
    expect(styles).toContain("top: var(--chip-to-y)");
    expect(styles).toContain("left: var(--chip-to-x)");
  });
});
