import { describe, expect, it, vi } from "vitest";
import { previewSettingsEffect } from "./audioPreview";

function fakeAudio(result: "played" | "silenced" | "unavailable") {
  return {
    setMasterVolume: vi.fn(),
    setEffectsVolume: vi.fn(),
    setMuted: vi.fn(),
    previewEffect: vi.fn(() => result),
  };
}

describe("Settings audio preview coordination", () => {
  it("synchronizes persisted values before the explicit preview cue", () => {
    const audio = fakeAudio("played");
    const settings = {
      muted: false,
      masterVolume: 64,
      effectsVolume: 37,
    };

    const feedback = previewSettingsEffect(settings, "effects", audio);

    expect(audio.setMasterVolume).toHaveBeenCalledWith(64);
    expect(audio.setEffectsVolume).toHaveBeenCalledWith(37);
    expect(audio.setMuted).toHaveBeenCalledWith(false);
    expect(audio.previewEffect).toHaveBeenCalledWith("chip");
    expect(feedback).toEqual({
      result: "played",
      message: "Table effects preview played at 37 percent.",
    });
  });

  it("describes persisted mute and zero values without changing them", () => {
    const muted = fakeAudio("silenced");
    expect(
      previewSettingsEffect(
        { muted: true, masterVolume: 80, effectsVolume: 70 },
        "master",
        muted,
      ).message,
    ).toBe("Preview is silent. Mute all audio is on.");

    const zero = fakeAudio("silenced");
    expect(
      previewSettingsEffect(
        { muted: false, masterVolume: 0, effectsVolume: 70 },
        "master",
        zero,
      ).message,
    ).toBe("Preview is silent. Master volume is zero.");
  });

  it("contains device failures and returns polite nonblocking feedback", () => {
    const audio = fakeAudio("unavailable");
    audio.previewEffect.mockImplementation(() => {
      throw new Error("output disappeared");
    });

    expect(() =>
      previewSettingsEffect(
        { muted: false, masterVolume: 100, effectsVolume: 70 },
        "effects",
        audio,
      ),
    ).not.toThrow();
    expect(
      previewSettingsEffect(
        { muted: false, masterVolume: 100, effectsVolume: 70 },
        "effects",
        audio,
      ),
    ).toEqual({
      result: "unavailable",
      message: "Audio preview is unavailable on this device. Your settings were kept.",
    });
  });
});
