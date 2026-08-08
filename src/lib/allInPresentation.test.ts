import { describe, expect, it } from "vitest";
import { ALL_IN_EQUITY_TRANSITION_MS, interpolateAllInEquities, isUncontestedAllInRunout } from "./allInPresentation";

describe("all-in presentation policy", () => {
  it("allows an early reveal only for an equal-cap all-in table", () => {
    expect(isUncontestedAllInRunout([
      { status: "all-in", totalCommitted: 1_000 },
      { status: "all-in", totalCommitted: 1_000 },
      { status: "folded", totalCommitted: 300 },
    ])).toBe(true);
    expect(isUncontestedAllInRunout([
      { status: "all-in", totalCommitted: 1_000 },
      { status: "all-in", totalCommitted: 600 },
    ])).toBe(false);
    expect(isUncontestedAllInRunout([
      { status: "all-in", totalCommitted: 1_000 },
      { status: "active", totalCommitted: 1_000 },
    ])).toBe(false);
  });

  it("moves public equity smoothly over the quarter-second beat", () => {
    const from = new Map([["a", 0.4], ["b", 0.6]]);
    const target = [{ playerId: "a", equity: 0.52 }, { playerId: "b", equity: 0.48 }];
    expect(interpolateAllInEquities(from, target, 0).get("a")).toBe(0.4);
    const mid = interpolateAllInEquities(from, target, ALL_IN_EQUITY_TRANSITION_MS / 2);
    expect(mid.get("a")).toBeGreaterThan(0.4);
    expect(mid.get("a")).toBeLessThan(0.52);
    expect(interpolateAllInEquities(from, target, ALL_IN_EQUITY_TRANSITION_MS).get("a")).toBe(0.52);
  });
});
