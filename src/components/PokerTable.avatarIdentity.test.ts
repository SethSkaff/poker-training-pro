import { describe, expect, it } from "vitest";
import { avatarVariantForPlayerId } from "./PokerTable";

describe("opponent avatar identity", () => {
  it("is deterministic for an entrant and stays independent of seat position", () => {
    const maya = avatarVariantForPlayerId("maya-tempo");
    expect(maya).toBe(avatarVariantForPlayerId("maya-tempo"));
    expect(maya).toBeGreaterThanOrEqual(0);
    expect(maya).toBeLessThan(6);
  });

  it("gives the roster more than one visual variant", () => {
    const variants = new Set(
      ["maya-tempo", "rafael-solver", "adrian-pressure", "juno-mirror", "lena-anchor"]
        .map(avatarVariantForPlayerId),
    );
    expect(variants.size).toBeGreaterThan(1);
  });
});
