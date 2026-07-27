/**
 * Pseudo-locale completeness sweep (TODOS.md: "pseudo-localization ...
 * layout tests").
 *
 * Renders each major screen with the deterministic pseudo locale
 * (`createPseudoLocale`, see src/lib/localeMessages.ts) forced as the active
 * locale, then checks two things per screen:
 *
 *   (a) every visible text run that is player-facing prose is wrapped in the
 *       pseudo locale's ［…］ markers, with a narrow, explicit allowlist for
 *       documented exemptions: formatted numbers/symbols, single-glyph
 *       hotkey/rank/dealer badges, and raw game/scenario DATA (training
 *       scenario text, opponent names, PokerAction codes) that is
 *       intentionally not part of the message catalog.
 *   (b) interpolated values (chip counts, scenario numbers, percentages)
 *       still appear correctly inside the pseudo-wrapped text.
 *
 * HONESTY NOTE: this environment has no DOM (no jsdom/happy-dom is
 * installed; tests render through `react-dom/server`'s
 * `renderToStaticMarkup`, matching every other component test in this
 * repo). That proves catalog *completeness* — every visible string a screen
 * emits resolves through the versioned message catalog and pseudo-wraps
 * correctly — but it cannot prove real *layout*: clipping, wrapping,
 * overlap, or truncation at the 35%-expanded pseudo width. Full-screen
 * visual/layout acceptance for pseudo-localization remains open and must be
 * done with an actual rendered window.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/localeMessages", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/localeMessages")>();
  const pseudo = actual.createPseudoLocale();
  return {
    ...actual,
    formatMessage: (
      key: string,
      values?: Record<string, string | number>,
      locale = pseudo,
    ) => actual.formatMessage(key, values, locale),
    localeTextAttributes: (locale = pseudo) =>
      actual.localeTextAttributes(locale),
  };
});

import { trainingScenarios } from "../data/trainingScenarios";
import {
  DurablePersistence as DurablePersistenceCtor,
  type DesktopPersistenceBridge,
  type DurablePersistence,
} from "../lib/durablePersistence";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { describeTrainingContext } from "../lib/trainingScenarioContext";
import { formatMessage } from "../lib/localeMessages";
import { defaultProgress, defaultSettings } from "../lib/storage";
import type { TournamentSessionResult } from "../modes/tournamentSession";
import { SESSION_TABLE_SIZE } from "../modes/tournamentSession";
import { AboutSupport } from "./AboutSupport";
import { CreditsScreen } from "./CreditsScreen";
import {
  HomeView,
  ModeSelect,
  PlayerRecord,
  TimedSetup,
  TournamentCeremony,
  TourLobby,
} from "./Dashboard";
import { PlayableTutorial } from "./PlayableTutorial";
import { PlayChipAcknowledgment } from "./PlayChipAcknowledgment";
import { PokerTable } from "./PokerTable";
import { RecoveryScreen, type RecoveryScreenActions } from "./RecoveryScreen";
import { RoomFlythrough } from "./RoomFlythrough";
import { SaveDataControls } from "./SaveDataControls";
import { SettingsPanel } from "./SettingsPanel";
import { TitleScreen } from "./TitleScreen";

const stubPersistence = {} as unknown as DurablePersistence;

const unusedRecoveryActions: RecoveryScreenActions = {
  restore: async () => {
    throw new Error("not called during server render");
  },
  exportSave: async () => {
    throw new Error("not called during server render");
  },
  exportDiagnostics: async () => {
    throw new Error("not called during server render");
  },
  startFresh: async () => {
    throw new Error("not called during server render");
  },
  cancel: () => undefined,
};

const PSEUDO_WRAPPED = /^［[\s\S]*］$/u;

/** Formatted numbers, currency-free chip counts, percents, and separators. */
function isNumericOrSymbol(text: string): boolean {
  return /^[\d.,%×:/\-–—+·s\s]+$/u.test(text) && /\d/.test(text);
}

/**
 * Hotkey/gamepad/dealer/card-rank badges: one or more short (<=2 char)
 * glyph tokens, optionally joined by "/" or "-" (e.g. "F", "Q / E / X",
 * "2 / 5 / 3", "D"). Deliberately capped at 2 characters per token so real
 * prose that happens to contain a slash (e.g. "Check / Call") never matches.
 */
function isKeyGlyph(text: string): boolean {
  return /^[A-Za-z0-9]{1,2}([\s/-]+[A-Za-z0-9]{1,2})*$/.test(text);
}

/**
 * Literal keyboard/gamepad control names shown by
 * `describeKeyToken`/`describeGamepadToken` (src/lib/actionMap.ts) in the
 * controls remap UI -- these name a physical input, not translatable UI
 * prose (the same category as the single-letter hotkey badges above).
 */
const KEY_NAME_EXEMPTIONS = new Set([
  "Space",
  "Esc",
  "Enter",
  "View",
  "Menu",
  "L-stick",
  "R-stick",
]);

/** Purely decorative rank+suit glyphs baked into the ambient night scene. */
function isDecorativeCardGlyph(text: string): boolean {
  return /^[2-9TJQKA][♠♥♦♣]$/.test(text);
}

function textRuns(markup: string): string[] {
  const runs: string[] = [];
  const re = />([^<>]+)</g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markup))) {
    const trimmed = match[1].trim().replace(/\s+/g, " ");
    if (trimmed) runs.push(trimmed);
  }
  return runs;
}

/**
 * Asserts every visible letter-bearing text run on the screen is either
 * pseudo-wrapped catalog copy or an explicitly declared exemption.
 */
function expectScreenIsPseudoLocalized(
  markup: string,
  dataExemptions: readonly string[],
) {
  // Sanity: pseudo-localization actually activated for this render. Every
  // screen tested here renders at least one catalog string.
  expect(markup).toMatch(/［/u);

  const exemptSet = new Set(dataExemptions);
  const leaks: string[] = [];
  for (const run of textRuns(markup)) {
    if (!/[A-Za-z]/.test(run)) continue; // no letters -> nothing to localize
    if (isNumericOrSymbol(run)) continue;
    if (isKeyGlyph(run)) continue;
    if (isDecorativeCardGlyph(run)) continue;
    if (KEY_NAME_EXEMPTIONS.has(run)) continue;
    if (exemptSet.has(run)) continue;
    if (PSEUDO_WRAPPED.test(run)) continue;
    leaks.push(run);
  }
  expect(leaks, `unwrapped, non-exempt text found: ${JSON.stringify(leaks)}`).toEqual(
    [],
  );
}

describe("pseudo-locale completeness sweep", () => {
  it("title screen", () => {
    const markup = renderToStaticMarkup(
      <TitleScreen muted={false} onEnter={() => undefined} onToggleMute={() => undefined} />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("main menu (home view)", () => {
    const markup = renderToStaticMarkup(
      <HomeView onPlay={() => undefined} onSettings={() => undefined} />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("mode select", () => {
    const markup = renderToStaticMarkup(
      <ModeSelect onBack={() => undefined} onSelect={() => undefined} />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("settings panel", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={defaultSettings}
        onBack={() => undefined}
        onChange={() => undefined}
        onFullscreenChange={() => undefined}
      />,
    );
    // DELIBERATE NON-MIGRATION (consistent with the deal-speed/camera-mode
    // buttons audited in Wave A): SettingsPanel.tsx renders its deal-speed /
    // camera-sensitivity / camera-view choice button labels as raw
    // GameSettings enum values (src/components/SettingsPanel.tsx lines
    // ~298-361: `{speed}` / `{value}` literally render "cinematic"/
    // "standard"/"quick", "low"/"standard"/"high", "close"/"standard"/
    // "wide"). The visible text IS the data value being selected, the same
    // category as the raw data-value labels intentionally left unmigrated
    // elsewhere. Exempted here rather than silently ignored so the choice
    // stays visible and traceable.
    expectScreenIsPseudoLocalized(markup, [
      "cinematic",
      "standard",
      "quick",
      "low",
      "high",
      "close",
      "wide",
    ]);
  });

  it("tutorial start", () => {
    const markup = renderToStaticMarkup(<PlayableTutorial onExit={() => undefined} />);
    // The guided tutorial hand uses fixed demonstration cards; rank glyphs
    // (Q, A, K, 7, 2) are single-character key-glyph exemptions and suit
    // symbols contain no Latin letters, so no further data exemptions apply.
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("credits screen", () => {
    const markup = renderToStaticMarkup(<CreditsScreen onBack={() => undefined} />);
    // src/lib/creditsData.ts (assembleCredits) now resolves every section
    // title, note, version-row label, and non-font document label through
    // the message catalog. The only remaining raw literals are the two font
    // document labels, which pair a font's proper name with its license name
    // ("Inter — SIL Open Font License 1.1") -- proper nouns/license
    // identifiers, not composed UI prose, deliberately left untranslated.
    expectScreenIsPseudoLocalized(markup, [
      "Inter — SIL Open Font License 1.1",
      "Barlow Condensed — SIL Open Font License 1.1",
    ]);
  });

  it("about & support panel", () => {
    const markup = renderToStaticMarkup(<AboutSupport onOpenCredits={() => undefined} />);
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("timed table setup", () => {
    const markup = renderToStaticMarkup(
      <TimedSetup
        initialMinutes={30}
        onBack={() => undefined}
        onStart={() => undefined}
      />,
    );
    // Numeric preset buttons (15/30/45/60) and the custom-minutes input value
    // carry no letters, so they are skipped before any exemption is needed.
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("tournament tour lobby", () => {
    const markup = renderToStaticMarkup(
      <TourLobby
        mode="normal"
        careerResults={[]}
        onBack={() => undefined}
        onStartEvent={() => undefined}
      />,
    );
    // Career event names, tier labels, and qualification-requirement copy
    // were migrated into the catalog this pass (see TODOS.md string-
    // extraction verdict), so this screen now needs no data exemptions.
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("player record", () => {
    const markup = renderToStaticMarkup(
      <PlayerRecord progress={defaultProgress} onBack={() => undefined} />,
    );
    // "Player" is the player-chosen profile name (save data), not UI chrome
    // -- the same category as a training scenario's opponent names.
    expectScreenIsPseudoLocalized(markup, ["Player"]);
  });

  it("tournament ceremony", () => {
    const result: TournamentSessionResult = {
      eventId: "regional-open",
      finishPlace: 2,
      fieldSize: SESSION_TABLE_SIZE,
      sourceFieldSize: 54,
      qualifyingPlaces: 3,
      qualified: true,
      tournamentEloDelta: 12,
      heroId: "hero",
      // Precomputed the same way src/modes/tournamentSession.ts really
      // builds these fields: through `formatMessage`, so under this test's
      // pseudo-locale mock they resolve exactly as they would in the app.
      eventName: formatMessage("career.event.regional-open"),
      handNumber: 42,
      elo: {
        heroId: "hero",
        heroRating: 1200,
        kFactor: 32,
        ratingWeight: 0.9,
        entries: [],
        totalDelta: 12,
      },
      placementLabel: formatMessage("career.result.placement", {
        place: "2nd",
        total: SESSION_TABLE_SIZE,
      }),
      qualificationLabel: formatMessage("career.result.qualified"),
      unlockedEventIds: ["circuit-main"],
      newlyUnlockedEventIds: ["circuit-main"],
      nextEventId: "circuit-main",
    };
    const markup = renderToStaticMarkup(
      <TournamentCeremony result={result} onMenu={() => undefined} />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("save recovery screen", () => {
    const markup = renderToStaticMarkup(
      <RecoveryScreen
        // Reuses the same catalog key the component itself falls back to on
        // a caught failure, so this is routed through the pseudo mock rather
        // than a hand-picked literal.
        message={formatMessage("recovery.error.generic")}
        actions={unusedRecoveryActions}
        onRecovered={() => undefined}
      />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("play-chip acknowledgment", () => {
    const markup = renderToStaticMarkup(
      <PlayChipAcknowledgment
        onAcknowledge={() => undefined}
        onBack={() => undefined}
      />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("save data controls (default state)", () => {
    const markup = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    // src/lib/durablePersistence.ts now resolves every DurableFailure.message
    // through the catalog too (see the "save recovery screen with a real
    // durable failure message" test below for a rendered failure path).
    // This test only exercises the component's default (no error, no
    // pending confirmation) state; SaveDataControls keeps its error text in
    // internal React state set from an async action, which this
    // server-render environment (no jsdom, no event simulation) cannot
    // trigger, so its error-state markup is exercised indirectly through
    // RecoveryScreen instead, which accepts its failure message as a prop.
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("save recovery screen with a real durable failure message", async () => {
    // Exercises an actual DurablePersistence failure path (not a hand-picked
    // literal): the bridge omits restoreAutosave, so `.restore()` returns the
    // "durable.error.restoreUnavailable" catalog message exactly as
    // RecoveryScreen would receive it from src/App.tsx in production.
    const persistence = new DurablePersistenceCtor(
      {} as DesktopPersistenceBridge,
    );
    const result = await persistence.restore("previous");
    if (result.ok) throw new Error("expected restore() to fail");
    const markup = renderToStaticMarkup(
      <RecoveryScreen
        message={result.error.message}
        actions={unusedRecoveryActions}
        onRecovered={() => undefined}
      />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("room arrival fly-through", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough
        // Mirrors src/App.tsx's real call: eventName from the (now
        // catalog-backed) session event name, modeLabel from the catalog
        // keys App.tsx was fixed to use this pass instead of a raw literal.
        eventName={formatMessage("career.event.regional-open")}
        modeLabel={formatMessage("table.modeTitle.rational")}
        settings={defaultSettings}
        onComplete={() => undefined}
      />,
    );
    expectScreenIsPseudoLocalized(markup, []);
  });

  it("poker table in a representative training state", () => {
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
    // Training-scenario content is versioned, calibration-gated DATA (see
    // src/data/trainingScenarioSchema.ts's schemaVersion/contentVersion),
    // deliberately outside the UI message catalog -- it is not chrome, it is
    // the poker situation being taught, and it stays English-authored data
    // even under a translated UI shell. Opponent character names and raw
    // PokerAction codes are the same kind of scenario data.
    const mathTopicTitle = scenario.mathQuestion.topic
      .split("-")
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(" ");
    expectScreenIsPseudoLocalized(markup, [
      scenario.title,
      scenario.prompt,
      scenario.mathQuestion.prompt,
      mathTopicTitle,
      ...scenario.players.filter((player) => player.id !== "hero").map((player) => player.name),
    ]);
  });

  it("preserves interpolated values inside pseudo-wrapped text", () => {
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
    /*
      The scenario counter was removed from the player interface (E27-013): it
      framed Training as a twelve-question pack with an end. Training now
      reports street and field like every other mode, so that is the
      interpolated string checked here. The point of the assertion is unchanged
      -- interpolated values must survive pseudo-wrapping intact, and digits are
      never transliterated -- and `formatMessage` resolves through the same
      pseudo-locale mock the rendered screen used, so this is the exact expected
      string rather than a guessed transliteration.
    */
    expect(markup).not.toContain("scenarioProgress");
    const street = `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`;
    expect(markup).toContain(
      formatMessage("table.status.streetPlayersRemain", {
        street,
        playersRemaining: describeTrainingContext(scenario).players,
      }),
    );
    // The decision clock's visible "{seconds}s" label keeps its digits.
    expect(markup).toContain(
      formatMessage("table.decisionClock.visibleLabel", {
        seconds: formatFixedDecimal(0, 1),
      }),
    );
    // The pot readout keeps the formatted chip count intact.
    expect(markup).toContain(formatChips(scenario.pot));
  });
});
