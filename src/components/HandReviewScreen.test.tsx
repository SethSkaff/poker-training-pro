import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

  it("states that its numbers are estimates rather than solved play", () => {
    expect(screen).toContain("review.approximationNotice");
    expect(screen).toContain("review.basis");
  });

  it("carries quality without relying on colour", () => {
    // A glyph per band...
    expect(screen).toContain("QUALITY_GLYPH");
    for (const quality of ["best", "close", "inaccuracy", "mistake", "blunder"]) {
      expect(screen).toContain(`${quality}:`);
    }
    // ...and the quality written out in words on every timeline entry.
    expect(screen).toContain("qualityLabel(entry.quality)");
  });

  it("supports keyboard navigation including jump-to-next-mistake", () => {
    expect(screen).toContain('event.key === "ArrowDown"');
    expect(screen).toContain('event.key === "ArrowUp"');
    expect(screen).toContain('event.key === "m"');
  });

  it("renders every mathematical value the review promises", () => {
    for (const key of [
      "potBefore",
      "costToCall",
      "potAfterCalling",
      "potOdds",
      "requiredEquity",
      "estimatedEquity",
      "foldEquity",
      "spr",
      "tournamentPressure",
      "evRegret",
    ]) {
      expect(screen).toContain(`review.math.${key}`);
    }
    expect(screen).toContain("review.actionValues");
  });

  it("marks small samples instead of presenting them as findings", () => {
    expect(screen).toContain("review.sampleTooSmall");
    expect(screen).toContain("entry.reliable");
  });

  it("has the styles the timeline and detail panes need", () => {
    for (const selector of [
      ".review-timeline",
      ".review-detail",
      ".review-math",
      ".review-segments",
      ".review-action-values",
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("documents the state, including Back and mid-review quit behaviour", () => {
    expect(stateMachine).toContain("### HandReview");
    expect(stateMachine).toContain("EventResult --> HandReview");
    expect(stateMachine).toContain("| Hand review |");
  });
});
