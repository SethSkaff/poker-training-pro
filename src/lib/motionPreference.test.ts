import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "./storage";
import {
  applyOsReducedMotionDefault,
  readOsReducedMotionPreference,
  subscribeOsReducedMotionPreference,
} from "./motionPreference";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean, overrides: Record<string, unknown> = {}) {
  const matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    ...overrides,
  });
  vi.stubGlobal("window", { matchMedia });
  return matchMedia;
}

describe("readOsReducedMotionPreference", () => {
  it("reports true when the OS prefers reduced motion", () => {
    stubMatchMedia(true);
    expect(readOsReducedMotionPreference()).toBe(true);
  });

  it("reports false when the OS has no reduced-motion preference", () => {
    stubMatchMedia(false);
    expect(readOsReducedMotionPreference()).toBe(false);
  });

  it("defaults to false when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});
    expect(readOsReducedMotionPreference()).toBe(false);
  });

  it("defaults to false when matchMedia throws", () => {
    vi.stubGlobal("window", {
      matchMedia: () => {
        throw new Error("unsupported");
      },
    });
    expect(readOsReducedMotionPreference()).toBe(false);
  });
});

describe("subscribeOsReducedMotionPreference", () => {
  it("uses addEventListener/removeEventListener when available", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    stubMatchMedia(false, { addEventListener, removeEventListener });

    const onChange = vi.fn();
    const unsubscribe = subscribeOsReducedMotionPreference(onChange);

    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    const listener = addEventListener.mock.calls[0][1] as (event: {
      matches: boolean;
    }) => void;
    listener({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("falls back to the legacy addListener/removeListener pair", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    stubMatchMedia(false, {
      addEventListener: undefined,
      removeEventListener: undefined,
      addListener,
      removeListener,
    });

    const onChange = vi.fn();
    const unsubscribe = subscribeOsReducedMotionPreference(onChange);

    expect(addListener).toHaveBeenCalledWith(expect.any(Function));
    const listener = addListener.mock.calls[0][0] as (event: {
      matches: boolean;
    }) => void;
    listener({ matches: true });
    expect(onChange).toHaveBeenCalledWith(true);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });

  it("is a no-op when matchMedia is unavailable", () => {
    vi.stubGlobal("window", {});
    const onChange = vi.fn();
    const unsubscribe = subscribeOsReducedMotionPreference(onChange);
    expect(() => unsubscribe()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("applyOsReducedMotionDefault", () => {
  it("follows the OS preference when the player has not made an explicit choice", () => {
    const settings = {
      ...defaultSettings,
      reducedMotion: false,
      reducedMotionExplicit: false,
    };
    expect(applyOsReducedMotionDefault(settings, true)).toMatchObject({
      reducedMotion: true,
      reducedMotionExplicit: false,
    });
  });

  it("keeps referential equality when the OS preference already matches", () => {
    const settings = {
      ...defaultSettings,
      reducedMotion: true,
      reducedMotionExplicit: false,
    };
    expect(applyOsReducedMotionDefault(settings, true)).toBe(settings);
  });

  it("never overrides an explicit in-app choice, even one that disagrees with the OS", () => {
    const settings = {
      ...defaultSettings,
      reducedMotion: false,
      reducedMotionExplicit: true,
    };
    expect(applyOsReducedMotionDefault(settings, true)).toBe(settings);

    const oppositeChoice = {
      ...defaultSettings,
      reducedMotion: true,
      reducedMotionExplicit: true,
    };
    expect(applyOsReducedMotionDefault(oppositeChoice, false)).toBe(
      oppositeChoice,
    );
  });
});
