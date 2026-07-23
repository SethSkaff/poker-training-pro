import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../lib/storage";
import { gameAudio } from "../lib/audio";
import { SettingsPanel } from "./SettingsPanel";

describe("accessible Settings audio controls", () => {
  it("associates sliders with descriptions and exposes keyboard-native preview buttons", () => {
    const preview = vi.spyOn(gameAudio, "previewEffect");
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={{
          ...defaultSettings,
          masterVolume: 83,
          musicVolume: 31,
          effectsVolume: 62,
        }}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    expect(preview).not.toHaveBeenCalled();
    expect(markup).toContain('id="master-volume"');
    expect(markup).toContain(
      'aria-describedby="master-volume-description master-volume-value"',
    );
    expect(markup).toContain(
      'aria-label="Preview Master volume at 83 percent"',
    );
    expect(markup).toContain(
      'aria-label="Preview Table effects volume at 62 percent"',
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    preview.mockRestore();
  });

  it("keeps music preview visibly unavailable while preserving its slider", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={defaultSettings}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );

    expect(markup).toContain('id="music-volume"');
    expect(markup).toContain("no approved licensed music masters are installed");
    expect(markup).toContain('aria-label="Music preview unavailable"');
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Music preview unavailable"/,
    );
    expect(markup).toContain(">Unavailable</button>");
  });
});
