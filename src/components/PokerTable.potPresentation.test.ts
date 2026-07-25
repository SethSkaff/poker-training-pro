import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { potChipStackCount } from "./PokerTable";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("central pot presentation", () => {
  it.each([
    [0, 0],
    [1, 1],
    [10, 2],
    [100, 3],
    [10_000, 5],
    [1_000_000_000, 8],
  ])("scales chip stacks for a %s-chip pot", (pot, expected) => {
    expect(potChipStackCount(pot)).toBe(expected);
  });

  it("documents the inclusive-pot convention used by the renderer", () => {
    const contract = readFileSync(
      path.join(directory, "..", "..", "docs", "table-presentation-contract.md"),
      "utf8",
    );
    expect(contract).toContain("Inclusive-pot convention");
    expect(contract).toContain("bets-collected");
    expect(contract).toContain("pot-awarded");
  });
});
