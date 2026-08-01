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

  it("clamps a drag at either end of the view", () => {
    expect(cameraPanFromHorizontalDrag(1.9, 0, 1_000)).toBe(TABLE_CAMERA_MAX_PAN);
    expect(cameraPanFromHorizontalDrag(-1.9, 1_000, 0)).toBe(TABLE_CAMERA_MIN_PAN);
  });
});
