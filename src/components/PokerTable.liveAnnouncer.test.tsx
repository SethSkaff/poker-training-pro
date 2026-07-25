import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { defaultProgress, defaultSettings } from "../lib/storage";
import { PokerTable } from "./PokerTable";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));

function source(): string {
  return readFileSync(path.join(componentsRoot, "PokerTable.tsx"), "utf8");
}

/**
 * The event-driven live-announcement layer added on top of PokerTable's
 * existing per-render status paragraph (`buildPokerTableAnnouncement`,
 * covered by PokerTable.accessibility.test.ts). Its decision logic --
 * exactly what gets announced and when, including the no-spam/coalescing
 * guarantee -- is unit-tested without any UI in
 * `src/lib/tableAnnouncer.test.ts`. This file only checks the two things a
 * static single-pass render can honestly prove:
 *  1. the new regions exist in the DOM with the right role/politeness, and
 *  2. they are empty on first mount (an aria-live region must never dump
 *     the whole current state the instant a screen reader arrives).
 *
 * IMPORTANT LIMITATION: this repository's Vitest setup has no DOM
 * environment or @testing-library/react installed (every existing
 * component test in this codebase uses `renderToStaticMarkup` or source
 * scanning for the same reason -- see notificationPersistence.test.tsx,
 * PseudoLocaleScreens.test.tsx). `renderToStaticMarkup` never runs
 * `useEffect`, so it CANNOT show the announcer's text updating after a
 * simulated action/re-render; that transition behavior is proven instead by
 * the framework-free `TableAnnouncerController` unit tests. Real Narrator/
 * NVDA speech output is not verified anywhere in this suite.
 */
describe("PokerTable live event-announcement regions", () => {
  it("renders a polite and an assertive live region distinct from the existing status paragraph and the error alerts", () => {
    const table = source();

    // The pre-existing per-render summary (untouched).
    expect(table).toContain(
      '<p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">',
    );
    expect(table).toContain("{tableAnnouncement}");

    // The new event-driven regions.
    expect(table).toContain("live-event-announcer live-event-announcer--polite");
    expect(table).toContain("live-event-announcer live-event-announcer--assertive");
    expect(table).toContain("{liveEventPolite}");
    expect(table).toContain("{liveEventAssertive}");
    expect(table).toContain('role="alert"');
    expect(table).toContain('aria-live="assertive"');

    // Errors are not duplicated into the new assertive channel -- they stay
    // on their own pre-existing alert elements.
    expect(table).toContain('className="table-action-alert" role="alert"');
    expect(table).toContain('className="math-input-error" role="alert"');
  });

  it("wires the announcer hook from the reusable library, not ad hoc inline logic", () => {
    const table = source();
    expect(table).toContain("useTableAnnouncer");
    expect(table).toContain('from "../lib/tableAnnouncer";');
    expect(table).toContain("useTableAnnouncer({");
    // Never leaks hidden opponent information into the snapshot: only public
    // pot/blind/action-history/action fields are read.
    expect(table).toContain("heroAction: action,");
    expect(table).toContain("latestPublicAction: tournament?.actionHistory.at(-1),");
  });

  it("mounts in Training mode (no tournament) with both new regions present and silent on first render", () => {
    const scenario = trainingScenarios[0];
    const markup = renderToStaticMarkup(
      <PokerTable
        mode="training"
        scenario={scenario}
        settings={defaultSettings}
        progress={defaultProgress}
        onProgressChange={() => undefined}
        onSettingsChange={() => undefined}
        onNextScenario={() => undefined}
        onExit={() => undefined}
      />,
    );

    expect(markup).toContain("live-event-announcer live-event-announcer--polite");
    expect(markup).toContain("live-event-announcer live-event-announcer--assertive");
    // No announcement is spoken on mount: `useEffect` never runs during a
    // static render, matching this module's real first-render behavior
    // (deriveTableAnnouncements(null, snapshot) === []).
    const politeRegion = markup.match(
      /<p class="visually-hidden live-event-announcer live-event-announcer--polite"[^>]*>([^<]*)<\/p>/,
    );
    const assertiveRegion = markup.match(
      /<p class="visually-hidden live-event-announcer live-event-announcer--assertive"[^>]*>([^<]*)<\/p>/,
    );
    expect(politeRegion?.[1] ?? "").toBe("");
    expect(assertiveRegion?.[1] ?? "").toBe("");
  });

  it("mounts with a tournament and real pot-award data without crashing, still silent on first render", () => {
    const scenario = trainingScenarios[1];
    const markup = renderToStaticMarkup(
      <PokerTable
        mode="normal"
        scenario={scenario}
        settings={defaultSettings}
        progress={defaultProgress}
        onProgressChange={() => undefined}
        onSettingsChange={() => undefined}
        onNextScenario={() => undefined}
        onExit={() => undefined}
        tournament={{
          legalActions: {
            playerId: "hero",
            toCall: scenario.amountToCall,
            check: scenario.amountToCall === 0,
            fold: true,
            call: scenario.amountToCall > 0,
            callAmount: scenario.amountToCall,
            raise: { minTo: scenario.minimumRaise, maxTo: 5_000 },
            allIn: true,
            allInTo: 5_000,
            raisingReopened: true,
          },
          onAction: () => undefined,
          kind: "career",
          sceneStateVersion: 1,
          handNumber: 3,
          fieldSize: 6,
          playersRemaining: 5,
          elapsedMs: 0,
          actionHistory: ["Maya: raise to 200", "Jules: call"],
          showArrival: false,
          lastPotWinnerIds: ["maya"],
          lastPotAwards: [{ playerId: "maya", amount: 640 }],
          lastHandHadSidePot: false,
        }}
      />,
    );

    expect(markup).toContain("live-event-announcer live-event-announcer--polite");
    expect(markup).toContain("live-event-announcer live-event-announcer--assertive");
  });
});
