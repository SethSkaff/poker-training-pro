import { describe, expect, it } from "vitest";
import {
  cameraPanFromHorizontalDrag,
  clampTableCameraPan,
  TABLE_CAMERA_MAX_PAN,
  TABLE_CAMERA_MIN_PAN,
} from "./tableCameraControls";

describe("table camera controls", () => {
  it("keeps the camera within the two-seat look range", () => {
    expect(clampTableCameraPan(-99)).toBe(TABLE_CAMERA_MIN_PAN);
    expect(clampTableCameraPan(99)).toBe(TABLE_CAMERA_MAX_PAN);
  });

  it("uses horizontal held-pointer movement and ignores click wobble", () => {
    expect(cameraPanFromHorizontalDrag(0, 400, 405)).toBe(0);
    expect(cameraPanFromHorizontalDrag(0, 400, 660)).toBe(1);
    expect(cameraPanFromHorizontalDrag(0, 400, 140)).toBe(-1);
  });

  it("preserves fine-grained free-look positions instead of snapping to seats", () => {
    const first = cameraPanFromHorizontalDrag(0, 120, 254);
    const second = cameraPanFromHorizontalDrag(0, 120, 255);

    expect(first).toBeCloseTo(134 / 260, 8);
    expect(second).toBeCloseTo(135 / 260, 8);
    expect(second - first).toBeCloseTo(1 / 260, 8);
  });

  it("clamps a drag at either end of the view", () => {
    expect(cameraPanFromHorizontalDrag(1.9, 0, 1_000)).toBe(TABLE_CAMERA_MAX_PAN);
    expect(cameraPanFromHorizontalDrag(-1.9, 1_000, 0)).toBe(TABLE_CAMERA_MIN_PAN);
  });
});
