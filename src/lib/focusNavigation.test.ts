import { describe, expect, it } from "vitest";
import {
  adjustRangeValue,
  computeTrapTarget,
  wrapIndex,
} from "./focusNavigation";

describe("computeTrapTarget", () => {
  it("wraps Tab from the last element back to the first", () => {
    expect(computeTrapTarget(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    expect(computeTrapTarget(3, 0, true)).toBe(2);
  });

  it("leaves interior Tab moves to the browser", () => {
    expect(computeTrapTarget(3, 1, false)).toBeNull();
    expect(computeTrapTarget(3, 1, true)).toBeNull();
  });

  it("falls back to the container when nothing is focusable", () => {
    expect(computeTrapTarget(0, -1, false)).toBe("container");
  });

  it("pulls escaped focus back to an edge", () => {
    expect(computeTrapTarget(3, -1, false)).toBe(0);
    expect(computeTrapTarget(3, -1, true)).toBe(2);
  });
});

describe("wrapIndex", () => {
  it("advances and wraps forward", () => {
    expect(wrapIndex(0, 3, 1)).toBe(1);
    expect(wrapIndex(2, 3, 1)).toBe(0);
  });

  it("retreats and wraps backward", () => {
    expect(wrapIndex(0, 3, -1)).toBe(2);
  });

  it("starts from the appropriate edge when unfocused", () => {
    expect(wrapIndex(-1, 3, 1)).toBe(0);
    expect(wrapIndex(-1, 3, -1)).toBe(2);
  });

  it("is safe with no items", () => {
    expect(wrapIndex(0, 0, 1)).toBe(0);
  });
});

describe("adjustRangeValue", () => {
  it("steps right and left within bounds", () => {
    const range = { value: 50, min: 0, max: 100, step: 10 };
    expect(adjustRangeValue(range, "right")).toBe(60);
    expect(adjustRangeValue(range, "left")).toBe(40);
  });

  it("clamps at the bounds", () => {
    expect(adjustRangeValue({ value: 100, min: 0, max: 100, step: 10 }, "right")).toBe(100);
    expect(adjustRangeValue({ value: 0, min: 0, max: 100, step: 10 }, "left")).toBe(0);
  });

  it("defaults a non-positive step to 1", () => {
    expect(adjustRangeValue({ value: 5, min: 0, max: 10, step: 0 }, "right")).toBe(6);
  });
});
