import { describe, expect, it } from "vitest";
import { clusterBootstrap, pairedHoeffdingInterval, wilsonInterval, zeroEventUpperBound } from "./statistics";

describe("A06 conditional statistics", () => {
  it("reproduces Wilson and zero-event formulas without converting no data to zero", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(zeroEventUpperBound(300)?.upper).toBeCloseTo(1 - 0.05 ** (1 / 300), 12);
    expect(wilsonInterval(5, 10)?.upper).toBeLessThanOrEqual(1);
  });

  it("clusters bootstrap samples by block and keeps paired bounds explicit", () => {
    const result = clusterBootstrap([{ blockId: "a", numerator: 1, denominator: 2 }, { blockId: "b", numerator: 0, denominator: 2 }], { replicates: 50, seed: "a06" });
    expect(result.independentBlocks).toBe(2);
    expect(result.exploratory).toBe(true);
    expect(pairedHoeffdingInterval([0.1, -0.1], -1, 1)?.method).toBe("paired_hoeffding");
  });
});
