import { renderToStaticMarkup } from "react-dom/server";
import { calculation } from "../lib/reviewCalculation";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ReviewMetric, reviewPlayerCountSummary } from "./HandReviewScreen";

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
    expect(screen).toContain("NEXT KEY MOVE");
    expect(screen).toMatch(/nextPlaybackStep\(\s*review\.decisions/);
    expect(screen).toContain("review.approximationNotice");
    expect(screen).toContain("QUALITY_GLYPH[decision.quality]");
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
