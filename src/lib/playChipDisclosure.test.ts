import { describe, expect, it } from "vitest";
import {
  acknowledgePlayChips,
  needsPlayChipAcknowledgment,
} from "./playChipDisclosure";

describe("play-chip disclosure gating", () => {
  it("requires acknowledgment when the flag is missing or false", () => {
    expect(needsPlayChipAcknowledgment({})).toBe(true);
    expect(needsPlayChipAcknowledgment({ playChipsAcknowledged: false })).toBe(
      true,
    );
  });

  it("does not require acknowledgment once recorded", () => {
    expect(
      needsPlayChipAcknowledgment({ playChipsAcknowledged: true }),
    ).toBe(false);
  });

  it("records the acknowledgment and is idempotent", () => {
    const before = { playChipsAcknowledged: false, playerName: "P" };
    const after = acknowledgePlayChips(before);
    expect(after.playChipsAcknowledged).toBe(true);
    expect(after.playerName).toBe("P");
    // Idempotent: a second call returns the same reference.
    expect(acknowledgePlayChips(after)).toBe(after);
  });
});
