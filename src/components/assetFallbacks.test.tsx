import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { HomeView } from "./Dashboard";
import { RoomFlythrough } from "./RoomFlythrough";

describe("low-cost media fallback markup", () => {
  it("keeps the supplied start-menu still canonical with local fallback copy behind it", () => {
    const markup = renderToStaticMarkup(
      <HomeView onPlay={() => undefined} onSettings={() => undefined} />,
    );

    expect(markup).toContain('src="/start-menu-reference.png"');
    expect(markup).toContain('fetchPriority="high"');
    expect(markup).toContain("home-reference__fallback");
    expect(markup).toContain("Poker Training Pro");
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Settings"');
  });

  it("renders room art as a detectable element over a CSS-only venue", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough
        eventName="Qualifier"
        modeLabel="Normal"
        settings={defaultSettings}
        onComplete={() => undefined}
      />,
    );

    expect(markup).toContain('class="room-flight__background-art"');
    expect(markup).toContain('src="/start-menu-room.png"');
    expect(markup).toContain('data-background-status="loading"');
    expect(markup).toContain("Championship Room");
  });
});
