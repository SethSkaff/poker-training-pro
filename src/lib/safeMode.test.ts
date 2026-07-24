import { describe, expect, it } from "vitest";
import { defaultSettings } from "./storage";
import {
  deriveSafeModeSettings,
  safeModeIgnoresImportedSettings,
} from "./safeMode";

describe("deriveSafeModeSettings", () => {
  it("returns the settings unchanged when safe mode is off", () => {
    const settings = {
      ...defaultSettings,
      muted: false,
      reducedMotion: false,
      dealSpeed: "cinematic" as const,
      fullscreen: true,
    };
    expect(deriveSafeModeSettings(settings, false)).toBe(settings);
  });

  it("forces conservative presentation in safe mode without touching progress-facing fields", () => {
    const imported = {
      ...defaultSettings,
      muted: false,
      reducedMotion: false,
      dealSpeed: "cinematic" as const,
      fullscreen: true,
      masterVolume: 88,
      colorAssist: true,
    };
    const derived = deriveSafeModeSettings(imported, true);
    expect(derived.muted).toBe(true);
    expect(derived.reducedMotion).toBe(true);
    expect(derived.dealSpeed).toBe("quick");
    expect(derived.autoCameraMovement).toBe(false);
    expect(derived.menuMotion).toBe("off");
    expect(derived.roomMotion).toBe("off");
    expect(derived.cameraMotion).toBe("off");
    expect(derived.tableMotion).toBe("off");
    expect(derived.transitionMotion).toBe("off");
    expect(derived.fullscreen).toBe(false);
    // Non-risky preferences are preserved rather than reset.
    expect(derived.masterVolume).toBe(88);
    expect(derived.colorAssist).toBe(true);
  });

  it("ignores animated background and nonessential audio for any imported settings", () => {
    const hostileImport = {
      ...defaultSettings,
      muted: false,
      reducedMotion: false,
      dealSpeed: "cinematic" as const,
      fullscreen: true,
    };
    expect(safeModeIgnoresImportedSettings(hostileImport, true)).toBe(true);
    expect(safeModeIgnoresImportedSettings(hostileImport, false)).toBe(false);
  });
});
