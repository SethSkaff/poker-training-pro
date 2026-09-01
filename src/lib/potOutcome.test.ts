import { describe, expect, it } from "vitest";
import { isPushAwardSet } from "./potOutcome";

describe("isPushAwardSet", () => {
  it("recognizes a shared main pot as a push", () => {
    expect(isPushAwardSet([
      { potId: "main", playerId: "hero" },
      { potId: "main", playerId: "villain" },
    ])).toBe(true);
  });

  it("requires every resolved pot to be shared", () => {
    expect(isPushAwardSet([
      { potId: "main", playerId: "hero" },
      { potId: "main", playerId: "villain" },
      { potId: "side-1", playerId: "hero" },
    ])).toBe(false);
  });

  it("does not mistake repeated awards to one player for a push", () => {
    expect(isPushAwardSet([
      { potId: "main", playerId: "hero" },
      { potId: "side-1", playerId: "hero" },
    ])).toBe(false);
    expect(isPushAwardSet([])).toBe(false);
  });
});
