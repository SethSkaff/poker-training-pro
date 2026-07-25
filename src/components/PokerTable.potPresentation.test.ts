import { describe, expect, it } from "vitest";
import { potChipStackCount } from "./PokerTable";

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
});
