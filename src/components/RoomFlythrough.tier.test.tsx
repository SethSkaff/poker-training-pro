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

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");

describe("arrival is a route through the venue", () => {
  const world = renderToStaticMarkup(
    <RoomFlythrough
      eventName="World"
      modeLabel="Normal"
      tier="world"
      settings={defaultSettings}
      onComplete={() => undefined}
    />,
  );

  it("passes dealer areas and player stacks, not just felt", () => {
    // The criterion names what the camera goes past; an empty room of green
    // ellipses is a zoom over wallpaper, not a walk through a card room.
    expect(world).toContain("venue-table__dealer");
    expect(world).toContain("venue-stack");
    // One dealer per table.
    expect(world.match(/venue-table__dealer/g)).toHaveLength(8);
    // One stack per seated guest.
    expect(world.match(/venue-stack/g)?.length).toBe(
      world.match(/class="venue-guest/g)?.length,
    );
  });

  it("gives each table its own depth so the room parallaxes", () => {
    // Depth must be distinct per table -- if they shared one value the room
    // would slide as a single flat sheet.
    const depths = [...world.matchAll(/--venue-depth:\s*([0-9.]+)/g)].map(
      (match) => match[1],
    );
    expect(depths).toHaveLength(8);
    expect(new Set(depths).size).toBe(8);
    // Nearest table is the last one, at full depth.
    expect(Number(depths[depths.length - 1])).toBeCloseTo(1, 3);
    // ...and the transform actually consumes it, at both translate and scale.
    expect(css).toContain("var(--venue-depth) * var(--venue-sweep");
    expect(css).toContain("0.58 + var(--venue-depth) * 0.72");
  });

  it("places every table a tier can ask for", () => {
    // `world` asks for eight. An unplaced table collapses onto the layer
    // origin, which reads as a rendering fault rather than a venue.
    for (let slot = 1; slot <= 8; slot += 1) {
      expect(css).toContain(`.venue-table:nth-child(${slot})`);
    }
  });

  it("keeps tier grandeur from overwriting the depth transform", () => {
    // A bare `transform: scale()` on a tier used to win the cascade and flatten
    // the parallax back into a zoom.
    const tierTableRules = css
      .split("\n")
      .filter(
        (line) =>
          line.includes("[data-event-tier=") && line.includes(".venue-table"),
      );
    expect(tierTableRules.length).toBeGreaterThan(0);
    for (const rule of tierTableRules) {
      expect(rule).not.toMatch(/transform:/);
    }
  });

  it("has a static alternative when room motion is off", () => {
    expect(css).toContain(':root[data-motion-room="off"] .venue-table');
    expect(css).toContain(':root[data-motion-room="reduced"] .venue-table');
  });
});

describe("arrival hands off to play without a hard cut", () => {
  it("loads the table during the fly-through, not after it", () => {
    // The preload used to sit in `onComplete`, so the 4.3 s of authored motion
    // finished and *then* the player waited on a chunk download.
    const flythroughBranch = app.slice(
      app.indexOf('if (screen === "room-transition"'),
      app.indexOf('if (screen === "tournament-table"'),
    );
    expect(flythroughBranch).toContain("PokerTable.preload()");
    expect(flythroughBranch).not.toContain(
      "void PokerTable.preload();\n            setScreen",
    );
  });

  it("opens the first hand with the arrival settle, like any later hand", () => {
    // `handNumber > 1` alone meant the hand you arrive on -- the only one that
    // follows a fly-through -- was the single hand that got no settle at all.
    expect(app).toContain("arrivingFromFlythrough.current = true");
    expect(app).toContain(
      "handNumber > 1 || arrivingFromFlythrough.current",
    );
  });
});

describe("seated table tier presentation", () => {
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
