import { describe, expect, it } from "vitest";
import {
  isShortStack,
  MAX_SEAT_CHIPS,
  seatChipStackCount,
} from "./chipStackDepth";

describe("a seat's pile reads as depth, measured in big blinds", () => {
  it("draws nothing for a busted stack", () => {
    expect(seatChipStackCount(0, 50)).toBe(0);
    expect(seatChipStackCount(-100, 50)).toBe(0);
  });

  it("grows as the stack grows at a fixed blind", () => {
    const heights = [500, 2_500, 7_500, 15_000, 60_000].map((stack) =>
      seatChipStackCount(stack, 50),
    );
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1]);
    }
    expect(heights[heights.length - 1]).toBeGreaterThan(heights[0]);
  });

  /*
    The point of measuring in blinds. The same 15,000 chips is a deep stack
    early and a desperate one late, and a pile sized by raw chips would look
    identical in both -- which is precisely the information a player needs and
    the old single-glyph seat never gave them.
  */
  it("shrinks as the blinds climb even though the stack has not changed", () => {
    const early = seatChipStackCount(15_000, 50);
    const middle = seatChipStackCount(15_000, 500);
    const late = seatChipStackCount(15_000, 2_000);
    expect(early).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(late);
  });

  it("keeps a short stack visibly stubby", () => {
    // Under ten big blinds should be near the bottom of the range, so it reads
    // as short before the number is read.
    expect(seatChipStackCount(400, 50)).toBeLessThanOrEqual(4);
    expect(seatChipStackCount(15_000, 50)).toBeGreaterThan(6);
  });

  it("never exceeds the drawable maximum however deep the stack", () => {
    for (const stack of [1e6, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(seatChipStackCount(stack, 50)).toBeLessThanOrEqual(MAX_SEAT_CHIPS);
    }
  });

  it("always shows at least one chip for a player who still has chips", () => {
    expect(seatChipStackCount(1, 5_000)).toBe(1);
    expect(seatChipStackCount(25, 50)).toBe(1);
  });

  it("falls back to a single chip rather than inventing a depth", () => {
    // No usable blind means no honest big-blind reading.
    expect(seatChipStackCount(15_000, 0)).toBe(1);
    expect(seatChipStackCount(15_000, Number.NaN)).toBe(1);
  });

  it("returns whole chips only", () => {
    for (const stack of [37, 1_234, 98_765]) {
      expect(Number.isInteger(seatChipStackCount(stack, 50))).toBe(true);
    }
  });
});

describe("short stacks are identifiable", () => {
  it("marks under ten big blinds as short", () => {
    expect(isShortStack(400, 50)).toBe(true);
    expect(isShortStack(499, 50)).toBe(true);
  });

  it("does not mark ten big blinds or more as short", () => {
    expect(isShortStack(500, 50)).toBe(false);
    expect(isShortStack(15_000, 50)).toBe(false);
  });

  it("tracks the blind level rather than the chip count", () => {
    // The same stack becomes short as the level climbs.
    expect(isShortStack(15_000, 50)).toBe(false);
    expect(isShortStack(15_000, 2_000)).toBe(true);
  });

  it("is false rather than throwing on unusable input", () => {
    expect(isShortStack(15_000, 0)).toBe(false);
    expect(isShortStack(0, 50)).toBe(false);
  });
});
