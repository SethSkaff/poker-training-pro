import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { gradeTrainingAttempt } from "../lib/trainingEngine";
import { ContextCoachPanel, FeedbackPanel } from "./PokerTable";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(path.join(componentsRoot, name), "utf8");
}

describe("player-facing notification persistence", () => {
  it("does not auto-dismiss teaching, math feedback, or support/error status", () => {
    for (const component of [
      "SettingsPanel.tsx",
      "AboutSupport.tsx",
      "RecoveryScreen.tsx",
      "SaveDataControls.tsx",
    ]) {
      expect(source(component), component).not.toMatch(/set(?:Timeout|Interval)\s*\(/);
    }
    const table = source("PokerTable.tsx");
    expect(table).not.toMatch(/setTimeout\s*\(/);
    expect(table).toContain("setElapsedMs");

    // The training feedback panel's "Review"/"Next hand" buttons and the
    // contextual-coach dialog's "Got it" button now resolve through the
    // versioned message catalog. Render each component directly (rather than
    // scanning PokerTable.tsx's source for literal copy) and assert the
    // persistent, undismissed controls are present in the rendered markup.
    const scenario = trainingScenarios[0];
    const graded = gradeTrainingAttempt({
      scenario: scenario.id,
      action: "call",
      mathAnswer: 10,
      decisionElo: 1000,
      mathElo: 1000,
      actionElapsedMs: 9000,
      mathElapsedMs: 12_000,
      completedAt: "2026-07-22T12:00:00.000Z",
      decisionAttempts: 1,
      mathAttempts: 1,
    });

    const feedbackMarkup = renderToStaticMarkup(
      <FeedbackPanel
        action="call"
        graded={graded}
        mathAttempted
        scenario={scenario}
        onNext={() => undefined}
        onReview={() => undefined}
      />,
    );
    expect(feedbackMarkup).toContain("Review");
    expect(feedbackMarkup).toContain("Next hand");

    const coachMarkup = renderToStaticMarkup(
      <ContextCoachPanel
        prompt={{ id: "all-in", title: "All-in", message: "Test message" }}
        onGotIt={() => undefined}
        onTurnOff={() => undefined}
      />,
    );
    expect(coachMarkup).toContain("Got it");
  });

  it("keeps the only loading timer paired with an explicit cancel path", () => {
    const loader = source("SceneLoader.tsx");
    expect(loader).toContain("window.setTimeout");
    expect(loader).toContain("Cancel and go back");
    expect(loader).toContain("This is taking longer than expected.");
  });
});
