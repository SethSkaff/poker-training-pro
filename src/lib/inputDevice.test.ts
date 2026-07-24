import { describe, expect, it } from "vitest";
import { reduceInputDevice } from "./inputDevice";

describe("reduceInputDevice", () => {
  it("reports a change when the device differs", () => {
    expect(reduceInputDevice("pointer", "gamepad")).toEqual({
      device: "gamepad",
      changed: true,
    });
  });

  it("reports no change when the device repeats", () => {
    expect(reduceInputDevice("gamepad", "gamepad")).toEqual({
      device: "gamepad",
      changed: false,
    });
  });

  it("always adopts the newest signal as the device", () => {
    expect(reduceInputDevice("gamepad", "keyboard").device).toBe("keyboard");
    expect(reduceInputDevice("keyboard", "pointer").device).toBe("pointer");
  });
});
