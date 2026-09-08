import { describe, expect, it } from "vitest";
import { jensenShannonDivergence } from "./personalityReport";

describe("A12 personality report math", () => {
  it("is symmetric, bounded and zero for identical distributions", () => {
    expect(jensenShannonDivergence({ fold: 0.5, call: 0.5 }, { fold: 0.5, call: 0.5 })).toBeCloseTo(0, 12);
    expect(jensenShannonDivergence({ fold: 1 }, { call: 1 })).toBeCloseTo(1, 12);
    expect(jensenShannonDivergence({ fold: 0.2, call: 0.8 }, { fold: 0.7, call: 0.3 })).toBeCloseTo(jensenShannonDivergence({ fold: 0.7, call: 0.3 }, { fold: 0.2, call: 0.8 }), 12);
  });
});
