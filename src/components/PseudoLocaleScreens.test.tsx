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
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import { defaultProgress, defaultSettings } from "../lib/storage";
import { AboutSupport } from "./AboutSupport";
import { CreditsScreen } from "./CreditsScreen";
import { HomeView, ModeSelect } from "./Dashboard";
import { PlayableTutorial } from "./PlayableTutorial";
import { PokerTable } from "./PokerTable";
import { SettingsPanel } from "./SettingsPanel";
import { TitleScreen } from "./TitleScreen";

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
    // KNOWN GAP (documented, not fixed this pass): SettingsPanel.tsx renders
    // its deal-speed / camera-sensitivity / camera-view choice button labels
    // as raw GameSettings enum values, not through the message catalog
    // (src/components/SettingsPanel.tsx lines ~298-361: `{speed}` / `{value}`
    // literally render "cinematic"/"standard"/"quick", "low"/"standard"/
    // "high", "close"/"standard"/"wide"). SettingsPanel.tsx is out of scope
    // for edits in this pass (a concurrent agent owns it). Exempted here
    // rather than silently ignored so this gap stays visible and traceable.
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
    // KNOWN GAP (documented, not fixed this pass): src/lib/creditsData.ts
    // (assembleCredits) builds every section title, version-row label, and
    // document label as a raw literal, not through the message catalog.
    // creditsData.ts backs both this screen and the About/Support panel,
    // which a concurrent agent owns this pass (see CONCURRENCY notes); its
    // own doc comment also only ever intended to keep *bundled* third-party
    // license/notice *text* out of the catalog, not this chrome, so the
    // chrome half is a real, traceable gap left for that owner or a future
    // pass rather than silently ignored.
    expectScreenIsPseudoLocalized(markup, [
      "Application",
      "Version and runtime identifiers for this build.",
      "Poker Training Pro",
      "Unavailable",
      "Build identifier",
      "Electron",
      "Chromium",
      "Node.js",
      "Fonts",
      "Bundled local fonts under the SIL Open Font License 1.1.",
      "Inter — SIL Open Font License 1.1",
      "Barlow Condensed — SIL Open Font License 1.1",
      "Open-source software",
      "Notices for the npm packages compiled into this build. These are bundled copies, shown offline; nothing is fetched.",
      "npm package notices",
      "Bundled runtime notices",
      "Music",
      "No instrumental soundtrack is included yet. When licensed tracks ship, each track&#x27;s title, author, source, and license will appear here.",
      "No licensed music ships in this build. Background music stays disabled until instrumental masters are licensed, loudness-normalised, and attributed here.",
    ]);
  });

  it("about & support panel", () => {
    const markup = renderToStaticMarkup(<AboutSupport onOpenCredits={() => undefined} />);
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
    // "Scenario {number} of {total}" -> the interpolated numbers must
    // survive pseudo-wrapping intact (digits are never transliterated). The
    // imported `formatMessage` here resolves through the same pseudo-locale
    // mock the rendered screen used, so this is the exact expected string,
    // not a guessed transliteration.
    expect(markup).toContain(
      formatMessage("table.status.scenarioProgress", {
        number: 1,
        total: trainingScenarios.length,
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
