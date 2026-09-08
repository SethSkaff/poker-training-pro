import { describe, expect, it } from "vitest";
import { depthBin, facingBin, sprBin } from "./stratification";

describe("A02 strata", () => {
  it("uses exact contract boundaries", () => {
    expect(depthBin(15)).toBe("(0,15]");
    expect(depthBin(15.01)).toBe("(15,40]");
    expect(sprBin(1)).toBe("[0,1]");
    expect(sprBin(1.01)).toBe("(1,4]");
    expect(facingBin(1 / 3, true)).toBe("small");
    expect(facingBin(2 / 3, true)).toBe("medium");
    expect(facingBin(1.01, true)).toBe("overbet");
    expect(facingBin(null, false)).toBe("none");
  });
});
