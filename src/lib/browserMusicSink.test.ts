import { describe, expect, it, vi } from "vitest";
import { createBrowserMusicSink } from "./browserMusicSink";

describe("createBrowserMusicSink", () => {
  it("refuses any non-packaged source path", () => {
    const sink = createBrowserMusicSink();
    expect(sink.createVoice({ id: "remote", title: "Remote", durationSec: 60, assetPath: "https://example.test/music.mp3" })).toBeNull();
  });

  it("uses a packaged audio master and safely controls its gain", () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const load = vi.fn();
    const removeAttribute = vi.fn();
    const AudioMock = vi.fn(() => ({
      preload: "",
      loop: false,
      volume: 1,
      currentTime: 23,
      play,
      pause,
      load,
      removeAttribute,
    }));
    vi.stubGlobal("Audio", AudioMock);

    const voice = createBrowserMusicSink().createVoice({
      id: "approved",
      title: "Approved",
      durationSec: 60,
      assetPath: "/audio/approved.ogg",
    });

    expect(voice?.trackId).toBe("approved");
    voice?.setGain(1.8);
    expect(AudioMock.mock.results[0]?.value.volume).toBe(1);
    voice?.stop();
    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
