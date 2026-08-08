import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TourLobby, TournamentCeremony } from "./Dashboard";
import type { TournamentSessionCareerResult } from "../modes/tournamentSession";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

const qualified = (eventId: string): TournamentSessionCareerResult => ({
  eventId,
  finishPlace: 1,
  fieldSize: 6,
  sourceFieldSize: 240,
  qualifyingPlaces: 2,
  qualified: true,
  tournamentEloDelta: 20,
});

function render(
  careerResults: TournamentSessionCareerResult[],
  activeEventId?: string,
) {
  return renderToStaticMarkup(
    <TourLobby
      mode="normal"
      careerResults={careerResults}
      activeEventId={activeEventId}
      onBack={() => undefined}
    />,
  );
}

describe("career route", () => {
  it("lays the events out horizontally with a connecting progress line", () => {
    const rule = css.slice(css.indexOf("\n.event-route {"));
    const body = rule.slice(rule.indexOf("{") + 1, rule.indexOf("}"));
    expect(body).toContain("grid-auto-flow: column");
    // The filled portion of the line is driven by the current event's slot.
    expect(css).toContain("width: var(--route-progress, 0%)");
  });

  it("moves the marker as events are completed", () => {
    const start = render([]);
    const later = render([qualified("local-qualifier")]);

    const progressOf = (markup: string) =>
      Number.parseFloat(
        /--route-progress:\s*([\d.]+)%/.exec(markup)?.[1] ?? "-1",
      );

    expect(progressOf(start)).toBeGreaterThan(0);
    expect(progressOf(later)).toBeGreaterThan(progressOf(start));
  });

  it("distinguishes completed, current, and upcoming by more than colour", () => {
    const markup = render([qualified("local-qualifier")]);

    expect(markup).toContain('data-stage="complete"');
    expect(markup).toContain('data-stage="current"');
    expect(markup).toContain('data-stage="future"');
    // Each stage carries a text label, not just a swatch.
    expect(markup).toContain("Completed");
    expect(markup).toContain("Current");
    expect(markup).toContain("Upcoming");
  });

  it("resumes the active event instead of recommending the next one", () => {
    const withActive = render([qualified("local-qualifier")], "local-qualifier");
    expect(withActive).toContain("Resuming");
    const withoutActive = render([qualified("local-qualifier")]);
    expect(withoutActive).toContain("Next up:");
  });

  it("shows how far the career has come", () => {
    expect(render([qualified("local-qualifier")])).toContain(
      "1 of 5 events qualified",
    );
  });
});

describe("career continuity", () => {
  const ceremonyResult = (overrides: Record<string, unknown> = {}) =>
    ({
      eventId: "local-qualifier",
      eventName: "Local Qualifier",
      finishPlace: 1,
      fieldSize: 6,
      sourceFieldSize: 240,
      qualifyingPlaces: 2,
      qualified: true,
      placementLabel: "1st of 6",
      qualificationLabel: "Qualified",
      tournamentEloDelta: 22,
      handNumber: 41,
      elo: { heroRating: 1022 },
      newlyUnlockedEventIds: [],
      unlockedEventIds: [],
      nextEventId: "regional-classic",
      ...overrides,
    }) as unknown as Parameters<typeof TournamentCeremony>[0]["result"];

  it("names the next event after qualifying", () => {
    const markup = renderToStaticMarkup(
      <TournamentCeremony result={ceremonyResult()} onMenu={() => undefined} />,
    );
    expect(markup).toContain("Next on the road");
  });

  it("states the path forward after failing to qualify", () => {
    // Previously a failed run offered only "Return to menu", which is what
    // made the career feel like it dead-ended.
    const markup = renderToStaticMarkup(
      <TournamentCeremony
        result={ceremonyResult({
          finishPlace: 5,
          qualified: false,
          qualificationLabel: "Did not qualify",
          nextEventId: undefined,
        })}
        onMenu={() => undefined}
      />,
    );
    expect(markup).toContain("stays open");
    expect(markup).toContain("Local Qualifier");
  });
});
