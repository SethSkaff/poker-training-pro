import { describe, expect, it } from "vitest";
import { defaultSettings } from "./storage";
import {
  completeFirstRunSettings,
  skipFirstRunSettings,
} from "./firstRunSettings";

describe("first-run motion choices", () => {
  it("keeps the OS-derived setting non-explicit when Save is untouched", () => {
    const initial = {
      ...defaultSettings,
      reducedMotion: true,
      reducedMotionExplicit: false,
    };

    expect(completeFirstRunSettings(initial, initial, false)).toMatchObject({
      reducedMotion: true,
      reducedMotionExplicit: false,
    });
  });

  it("records an explicit choice only after the player changes motion", () => {
    const initial = { ...defaultSettings, reducedMotionExplicit: false };
    const draft = { ...initial, reducedMotion: true };

    expect(completeFirstRunSettings(initial, draft, true)).toMatchObject({
      reducedMotion: true,
      reducedMotionExplicit: true,
    });
  });

  it("keeps Skip following the OS even if a stale draft had been altered", () => {
    const initial = { ...defaultSettings, reducedMotion: true };

    expect(skipFirstRunSettings(initial)).toMatchObject({
      reducedMotion: true,
      reducedMotionExplicit: false,
    });
  });
});
