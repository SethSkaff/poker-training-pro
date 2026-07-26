import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../lib/storage";
import { CareerTravel, type CareerTravelStop } from "./CareerTravel";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");

const route: CareerTravelStop[] = [
  { id: "local-qualifier", name: "Local Qualifier", tier: "local", cleared: true },
  { id: "regional-open", name: "Regional Open", tier: "regional", cleared: false },
  { id: "circuit-main", name: "Circuit Main Event", tier: "circuit", cleared: false },
  {
    id: "national-championship",
    name: "National Championship",
    tier: "championship",
    cleared: false,
  },
  {
    id: "world-championship",
    name: "World Championship",
    tier: "world",
    cleared: false,
  },
];

function render(settings = defaultSettings) {
  return renderToStaticMarkup(
    <CareerTravel
      route={route}
      fromEventId="local-qualifier"
      toEventId="regional-open"
      settings={settings}
      onComplete={() => undefined}
    />,
  );
}

describe("career travel", () => {
  it("shows the whole circuit with the leg's origin and destination marked", () => {
    const markup = render();
    for (const stop of route) {
      expect(markup).toContain(stop.name);
    }
    expect(markup).toContain('data-stop-state="origin"');
    expect(markup).toContain('data-stop-state="destination"');
    // Events not on this leg are neither, so the leg reads unambiguously.
    expect(markup.match(/data-stop-state="ahead"/g)).toHaveLength(3);
  });

  it("pins the marker's start and end to the two events' route slots", () => {
    // Five events: slot centres at (i + 0.5)/5, matching the lobby's route so
    // the two screens read as the same object rather than two diagrams.
    const markup = render();
    expect(markup).toContain("--travel-from:10%");
    expect(markup).toContain("--travel-to:30%");
    // ...and the marker actually moves between them, once the route phase lands.
    expect(css).toContain("left: var(--travel-from, 0%)");
    expect(css).toContain(".career-travel--route .career-travel__marker");
  });

  it("carries the destination tier so the next venue is dressed for it", () => {
    expect(render()).toContain('data-to-tier="regional"');
    expect(css).toContain('.career-travel[data-to-tier="world"]');
  });

  it("states the journey once for assistive technology", () => {
    // The camera move is decorative; the same information must not require
    // waiting out five seconds of it.
    const markup = render();
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Travelling from Local Qualifier to Regional Open");
    expect(markup).toContain("event 2 of 5");
  });

  it("is skippable", () => {
    expect(render()).toContain("career-travel__skip");
  });

  it("still shows the route when motion is off", () => {
    // The static alternative is not "no screen": the marker moving is the
    // step being recorded, so with motion off the route is shown at rest with
    // the marker already at the destination.
    const markup = render({ ...defaultSettings, reducedMotion: true });
    expect(markup).toContain("career-travel--route");
    expect(markup).toContain("career-travel__marker");
    expect(css).toContain(':root[data-motion-room="off"] .career-travel__marker');
    expect(css).toContain(
      ':root[data-motion-room="reduced"] .career-travel__marker',
    );
  });

  it("runs every phase of the journey the criterion names", () => {
    // Seat -> above the room -> the route -> descending into the next venue.
    for (const phase of ["seat", "rise", "route", "approach"]) {
      expect(css).toContain(`.career-travel--${phase} `);
    }
  });
});

describe("career travel is wired into the circuit", () => {
  it("sits between finishing an event and starting the next one", () => {
    // The ceremony's "next event" button used to return to a lobby list --
    // and did not even start the next event.
    expect(app).toContain('setScreen("career-travel")');
    expect(app).toContain("setTravelLeg({");
    expect(app).toContain("startCareerEvent(toEventId)");
  });

  it("prefetches the next event's scenes while the journey plays", () => {
    const nextHandler = app.slice(
      app.indexOf("setTravelLeg({") - 600,
      app.indexOf("setTravelLeg({"),
    );
    expect(nextHandler).toContain("RoomFlythrough.preload()");
    expect(nextHandler).toContain("PokerTable.preload()");
  });
});
