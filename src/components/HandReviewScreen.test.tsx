import { renderToStaticMarkup } from "react-dom/server";
import { calculation } from "../lib/reviewCalculation";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ReviewMetric,
  decisionOptionLabel,
  reviewKeyboardTarget,
  reviewPlayerCountSummary,
} from "./HandReviewScreen";
import type { ReviewQuality } from "../modes/handReview";

const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const screen = readFileSync(
  path.join(sourceRoot, "components", "HandReviewScreen.tsx"),
  "utf8",
);
const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
const css = readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
const stateMachine = readFileSync(
  path.join(sourceRoot, "..", "docs", "desktop-game-state-machine.md"),
  "utf8",
);

describe("hand review screen", () => {
  it("labels current-hand counts separately from tournament survivors", () => {
    const summary = reviewPlayerCountSummary({
      activePlayersInHand: 2,
      activeOpponents: 1,
      playersDealtIn: 2,
      tournamentPlayersRemaining: 6,
    });

    expect(summary).toContain("2 players in hand");
    expect(summary).toContain("1 active opponent");
    expect(summary).toContain("6 players remaining in tournament");
    expect(summary).not.toContain("6 players in hand");
  });

  it("is reachable from the ceremony, which previously never rendered the button", () => {
    // `onReview` existed on the ceremony but App never passed it, so the
    // affordance never appeared.
    expect(app).toContain("onReview: () => {");
    expect(app).toContain('setScreen("hand-review")');
    expect(app).toContain('screen === "hand-review"');
  });

  it("aborts derivation when the player leaves", () => {
    expect(screen).toContain("new AbortController()");
    expect(screen).toContain("signal: controller.signal");
    expect(screen).toContain("return () => controller.abort();");
  });

  it("uses the live table and replaces its action controls", () => {
    expect(screen).toContain("<PokerTable");
    expect(screen).toContain("scenario={decision.tableSnapshot}");
    expect(screen).toMatch(/nextPlaybackStep\(\s*review\.decisions/);
    expect(screen).toContain("review.approximationNotice");
    // The jump-to-key-move affordance is a button *and* a keyboard shortcut;
    // both resolve through the same `nextKeyMoveIndex`.
    expect(screen).toContain("review.nav.nextKeyMove");
    expect(screen).toContain("reviewKeyboardTarget(event.key");
  });

  it("suppresses the live action dock and drives the table read-only", () => {
    // Review must never be able to act on the table: every live callback is
    // the shared no-op and navigation replaces the action controls.
    expect(screen).toContain("const noop = () => undefined;");
    expect(screen).toContain("onProgressChange={noop}");
    expect(screen).toContain("onSettingsChange={noop}");
    expect(screen).toContain("onNextScenario={noop}");
    expect(screen).toContain("review={{");
    expect(screen).toContain("controls: (");
    // The 3D scene is not rebuilt underneath a static decision snapshot.
    expect(screen).toContain("spatialScene: false");
  });

  it("drops button semantics from the hero cards it is only displaying", () => {
    // In review the hero's cards are already face up and nothing can act on
    // them, so the surface must not keep announcing itself as a button.
    const table = readFileSync(
      path.join(sourceRoot, "components", "PokerTable.tsx"),
      "utf8",
    );
    expect(table).toContain('const HoleCardsSurface = review ? "div" : "button";');
    // Every input path -- keyboard, gamepad and pointer -- funnels through
    // handleAction, so one guard there makes the whole table read-only.
    expect(table).toMatch(/const handleAction = useCallback\(\s*\([^)]*\) => \{\s*if \(\s*review \|\|/);
    expect(table).toContain('role={review ? "group" : undefined}');
    // Skip belongs to a live hand; a static decision has nothing to skip.
    expect(table).toContain("{!review && !resultEvent && !payoutEvent &&");
  });

  it("closes only the calculation popover on Escape, never the review", () => {
    // Registered in the capture phase and stopped there, so Escape cannot also
    // reach the table's own leave handling while a popover is open.
    expect(screen).toContain('if (event.key === "Escape")');
    expect(screen).toContain("event.stopPropagation();");
    expect(screen).toContain('window.addEventListener("keydown", close, true);');
    expect(screen).toContain(
      'window.removeEventListener("keydown", close, true);',
    );
  });

  it("documents the state, including Back and mid-review quit behaviour", () => {
    expect(stateMachine).toContain("### HandReview");
    expect(stateMachine).toContain("EventResult --> HandReview");
    expect(stateMachine).toContain("| Hand review |");
  });
});

it("formats the clickable metric from its audit result, so displayed math cannot disagree", () => {
  const audit = calculation(
    "Odds = call / (pot + call)",
    { call: 500, pot: 1500 },
    "call / (pot + call)",
    0.25,
  );
  const html = renderToStaticMarkup(
    <ReviewMetric label="Pot odds" audit={audit} percent digits={1} />,
  );
  expect(html).toContain("25.0%");
  expect(html).toContain("Inspect calculation");
  expect(audit.substituted).toBe("500 / (1500 + 500)");
});

describe("review keyboard navigation", () => {
  const state = { selected: 2, count: 5, nextKeyMoveIndex: 4 };

  it("advances on both Right and Down, and steps back on both Left and Up", () => {
    // The pre-redesign vertical timeline bound Up/Down; the horizontal
    // redesign binds Left/Right. Both pairs stay live so neither habit breaks.
    expect(reviewKeyboardTarget("ArrowRight", state)).toBe(3);
    expect(reviewKeyboardTarget("ArrowDown", state)).toBe(3);
    expect(reviewKeyboardTarget("ArrowLeft", state)).toBe(1);
    expect(reviewKeyboardTarget("ArrowUp", state)).toBe(1);
  });

  it("clamps at both ends instead of wrapping past the round", () => {
    expect(
      reviewKeyboardTarget("ArrowRight", { ...state, selected: 4 }),
    ).toBe(4);
    expect(reviewKeyboardTarget("ArrowDown", { ...state, selected: 4 })).toBe(4);
    expect(reviewKeyboardTarget("ArrowLeft", { ...state, selected: 0 })).toBe(0);
    expect(reviewKeyboardTarget("ArrowUp", { ...state, selected: 0 })).toBe(0);
  });

  it("jumps to the next key move on M, in either case", () => {
    expect(reviewKeyboardTarget("m", state)).toBe(4);
    expect(reviewKeyboardTarget("M", state)).toBe(4);
  });

  it("does nothing when there is no next key move, rather than moving somewhere else", () => {
    expect(
      reviewKeyboardTarget("m", { ...state, nextKeyMoveIndex: null }),
    ).toBeNull();
  });

  it("ignores keys it does not own so typing and shortcuts still work", () => {
    for (const key of ["a", "Enter", " ", "Escape", "Tab", "PageDown", "1"]) {
      expect(reviewKeyboardTarget(key, state)).toBeNull();
    }
  });

  it("is inert before any decision exists", () => {
    const empty = { selected: 0, count: 0, nextKeyMoveIndex: null };
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "m"]) {
      expect(reviewKeyboardTarget(key, empty)).toBeNull();
    }
  });
});

describe("decision quality is never colour-only", () => {
  const qualities: ReviewQuality[] = [
    "best",
    "close",
    "inaccuracy",
    "mistake",
    "blunder",
  ];
  const words: Record<ReviewQuality, string> = {
    best: "Model-best",
    close: "Close",
    inaccuracy: "Inaccuracy",
    mistake: "Mistake",
    blunder: "Blunder",
  };

  it("writes the quality out in words on every selector entry", () => {
    for (const quality of qualities) {
      const label = decisionOptionLabel(
        { handNumber: 3, street: "flop", quality, notable: false },
        0,
      );
      expect(label).toContain(words[quality]);
      expect(label).toContain("Hand 3");
    }
  });

  it("gives each quality a distinct glyph as well as the word", () => {
    const glyphs = qualities.map((quality) =>
      decisionOptionLabel(
        { handNumber: 1, street: "river", quality, notable: false },
        0,
      ).replace(words[quality], ""),
    );
    expect(new Set(glyphs).size).toBe(qualities.length);
  });

  it("numbers entries from one and marks key moves in words", () => {
    expect(
      decisionOptionLabel(
        { handNumber: 2, street: "turn", quality: "best", notable: true },
        0,
      ),
    ).toContain("1 · ");
    expect(
      decisionOptionLabel(
        { handNumber: 2, street: "turn", quality: "best", notable: true },
        0,
      ),
    ).toContain("Key move");
    expect(
      decisionOptionLabel(
        { handNumber: 2, street: "turn", quality: "best", notable: false },
        4,
      ),
    ).not.toContain("Key move");
  });
});

it("localizes its own chrome instead of hard-coding English", () => {
  // The pre-redesign screen was fully localized. Every catalogued string the
  // redesign still shows must go back through `formatMessage`, which throws on
  // an unknown key, so a typo fails loudly rather than rendering a raw key.
  for (const key of [
    "review.title",
    "review.deriving",
    "review.noDecisions",
    "review.keyboardHint",
    "review.nav.next",
    "review.nav.nextKeyMove",
    "review.decisionSelectLabel",
    "review.mathHeading",
    "review.math.potOdds",
    "review.math.evRegret",
    "review.youPlayed",
    "review.modelPreferred",
    "review.actionValues",
    "review.basis",
    "common.back",
  ]) {
    expect(screen).toContain(`"${key}"`);
  }
  // Uppercase display copy belongs to CSS, not to the string itself.
  expect(screen).not.toContain("GAME REVIEW");
  expect(screen).not.toContain("NEXT KEY MOVE");
  expect(screen).not.toContain("THE MATH");
});
