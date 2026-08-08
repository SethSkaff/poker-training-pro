/**
 * RTL direction-propagation sweep across the supported desktop screens.
 *
 * `localeTextAttributes()` (src/lib/localeMessages.ts) resolves a locale's
 * logical `{ lang, dir }` pair. This test forces an RTL resource (mirroring
 * the fixture already used by src/lib/localeMessages.test.tsx) as the active
 * locale and asserts each major screen's root element actually renders
 * `dir="rtl"`/`lang="ar"` -- i.e. that the attribute genuinely propagates
 * from the locale resource to the DOM, not just that the helper function
 * returns the right object in isolation.
 *
 * HONESTY NOTE: same caveat as PseudoLocaleScreens.test.tsx -- there is no
 * DOM here (renderToStaticMarkup only), so this proves the `dir`/`lang`
 * attribute is wired on the right element, not that mirrored/RTL layout
 * actually reads correctly. Real RTL visual/layout acceptance (mirrored
 * icons, reversed flex order, text alignment under a real RTL script)
 * remains open and needs an actual rendered window.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/localeMessages", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/localeMessages")>();
  const { EN_US_MESSAGES } = await import("../locales/en-US.messages");
  const rtl = Object.freeze({
    ...EN_US_MESSAGES,
    id: "ar-XB-test",
    intlLocale: "ar",
    direction: "rtl" as const,
  });
  return {
    ...actual,
    formatMessage: (
      key: string,
      values?: Record<string, string | number>,
      locale = rtl,
    ) => actual.formatMessage(key, values, locale),
    localeTextAttributes: (locale = rtl) => actual.localeTextAttributes(locale),
  };
});

import { trainingScenarios } from "../data/trainingScenarios";
import type { DurablePersistence } from "../lib/durablePersistence";
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

const fixtureTournamentResult: TournamentSessionResult = {
  eventId: "regional-open",
  finishPlace: 2,
  fieldSize: SESSION_TABLE_SIZE,
  sourceFieldSize: 54,
  qualifyingPlaces: 3,
  qualified: true,
  tournamentEloDelta: 12,
  heroId: "hero",
  eventName: "Regional Open",
  handNumber: 42,
  elo: {
    heroId: "hero",
    heroRating: 1200,
    kFactor: 32,
    ratingWeight: 0.9,
    entries: [],
    totalDelta: 12,
  },
  placementLabel: "2nd of 6",
  qualificationLabel: "Qualified for the next Grand Prix event",
  unlockedEventIds: ["circuit-main"],
  newlyUnlockedEventIds: ["circuit-main"],
  nextEventId: "circuit-main",
};

describe("RTL direction propagation sweep", () => {
  it("title screen", () => {
    const markup = renderToStaticMarkup(
      <TitleScreen muted={false} onEnter={() => undefined} onToggleMute={() => undefined} />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("main menu (home view)", () => {
    const markup = renderToStaticMarkup(
      <HomeView onPlay={() => undefined} onSettings={() => undefined} />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("mode select", () => {
    const markup = renderToStaticMarkup(
      <ModeSelect onBack={() => undefined} onSelect={() => undefined} />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("tutorial start", () => {
    const markup = renderToStaticMarkup(<PlayableTutorial onExit={() => undefined} />);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("credits screen", () => {
    const markup = renderToStaticMarkup(<CreditsScreen onBack={() => undefined} />);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("poker table in a representative training state", () => {
    const markup = renderToStaticMarkup(
      <PokerTable
        mode="training"
        scenario={trainingScenarios[0]}
        settings={defaultSettings}
        progress={defaultProgress}
        onProgressChange={() => undefined}
        onSettingsChange={() => undefined}
        onNextScenario={() => undefined}
        onExit={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
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
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("about & support panel", () => {
    const markup = renderToStaticMarkup(
      <AboutSupport onOpenCredits={() => undefined} />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("timed table setup", () => {
    const markup = renderToStaticMarkup(
      <TimedSetup
        initialMinutes={30}
        onBack={() => undefined}
        onStart={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
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
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("player record", () => {
    const markup = renderToStaticMarkup(
      <PlayerRecord progress={defaultProgress} onBack={() => undefined} />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("tournament ceremony", () => {
    const markup = renderToStaticMarkup(
      <TournamentCeremony
        result={fixtureTournamentResult}
        onMenu={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("save recovery screen", () => {
    const markup = renderToStaticMarkup(
      <RecoveryScreen
        message="The recovery action could not be completed."
        actions={unusedRecoveryActions}
        onRecovered={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("play-chip acknowledgment", () => {
    const markup = renderToStaticMarkup(
      <PlayChipAcknowledgment
        onAcknowledge={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("save data controls", () => {
    const markup = renderToStaticMarkup(
      <SaveDataControls
        persistence={stubPersistence}
        onAuthoritativeDataChanged={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  it("room arrival fly-through", () => {
    const markup = renderToStaticMarkup(
      <RoomFlythrough
        eventName="Qualifier"
        modeLabel="Normal"
        settings={defaultSettings}
        onComplete={() => undefined}
      />,
    );
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });
});
