import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { RoomFlythrough } from "./RoomFlythrough";

describe("room tier presentation", () => {
  it("exposes the event tier as a local scene styling hook", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough eventName="World" modeLabel="Normal" tier="world" settings={defaultSettings} onComplete={() => undefined} />,
    );
    expect(markup).toContain('data-event-tier="world"');
  });

  it("grows the visible venue and crowd with event tier", () => {
    const local = renderToStaticMarkup(<RoomFlythrough eventName="Local" modeLabel="Normal" tier="local" settings={defaultSettings} onComplete={() => undefined} />);
    const world = renderToStaticMarkup(<RoomFlythrough eventName="World" modeLabel="Normal" tier="world" settings={defaultSettings} onComplete={() => undefined} />);
    expect(local.match(/class="venue-table"/g)).toHaveLength(3);
    expect(world.match(/class="venue-table"/g)).toHaveLength(8);
    expect(local.match(/venue-guest/g)?.length).toBeLessThan(world.match(/venue-guest/g)?.length ?? 0);
  });
});

describe("seated table tier presentation", () => {
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
  const table = readFileSync(
    path.join(sourceRoot, "components", "PokerTable.tsx"),
    "utf8",
  );

  it("exposes the event tier at the seated table, not only the fly-through", () => {
    // Every event looked identical once the player sat down.
    expect(table).toContain('data-event-tier={tournament?.tier ?? "local"}');
  });

  it("varies room scale, crowd density, and lighting by tier", () => {
    // Crowd density: how many distant tables remain visible.
    expect(css).toContain(
      '.table-screen[data-event-tier="local"] .room-depth__far i:nth-child(n + 4)',
    );
    // Room scale: how far the far plane spreads.
    expect(css).toContain(
      '.table-screen[data-event-tier="championship"] .room-depth__far',
    );
    // Lighting: house-light warmth and spread.
    expect(css).toContain(
      '.table-screen[data-event-tier="world"] .room-lights i',
    );
    // Table presentation: a warmer rail at the top tiers.
    expect(css).toContain(
      '.table-screen[data-event-tier="world"] .poker-table',
    );
  });

  it("achieves the variation procedurally, with no per-tier art", () => {
    // No tier rule may pull in an image; the whole point is that a fresh venue
    // costs nothing at build time.
    const tierRules = css
      .split("\n")
      .filter((line) => line.includes('[data-event-tier='));
    for (const rule of tierRules) {
      expect(rule).not.toContain("url(");
    }
  });
});
