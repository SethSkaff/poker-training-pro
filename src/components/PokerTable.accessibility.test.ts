import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { buildPokerTableAnnouncement } from "./PokerTable";

describe("poker table live announcements", () => {
  it("keeps the elapsed decision clock semantic and the table-audio button actionable", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );

    expect(source).toContain('role="timer"');
    expect(source).toContain("Decision time ${formatFixedDecimal(elapsedMs / 1000, 1)} seconds");
    expect(source).toContain('aria-pressed={settings.muted}');
    expect(source).toContain('onSettingsChange({ ...settings, muted: !settings.muted })');
    expect(source).toContain("elapsedStartedAt.current = performance.now() - elapsedMs");
    expect(source).toContain("}, [action, paused]);");
  });

  it("pairs invalid math-entry audio with a persistent visible alert", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );

    expect(source).toContain('className="math-input-error" role="alert"');
    expect(source).toContain('className="table-action-alert" role="alert"');
    expect(source).toContain("setMathError(");
    expect(source).toContain("setActionError(");
    expect(source).toContain('gameAudio.play("error")');
  });

  it("keeps the optional fast-forward control actionable and clearly named", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );

    expect(source).toContain("pendingTournamentAction.current?.finish()");
    expect(source).toContain(
      'aria-label="Skip opponent presentation and continue the hand"',
    );
  });

  it("keeps Escape available while a pause-menu range or checkbox has focus", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );
    const escapeIndex = source.indexOf('keyEventToken(event) === "escape"');
    const inputGuardIndex = source.indexOf("target instanceof HTMLInputElement");

    expect(escapeIndex).toBeGreaterThan(-1);
    expect(inputGuardIndex).toBeGreaterThan(-1);
    expect(escapeIndex).toBeLessThan(inputGuardIndex);
  });

  it("announces real table state and never decorative room content", () => {
    const scenario = trainingScenarios.find(
      (candidate) => candidate.board.length > 0,
    );
    if (!scenario) throw new Error("Expected a post-flop training scenario");

    const announcement = buildPokerTableAnnouncement({
      action: "raise",
      latestPublicAction: "Maya called 120",
      scenario,
    });

    expect(announcement).toContain("Pot");
    expect(announcement).toContain("Board:");
    expect(announcement).toContain("Latest public action: Maya called 120.");
    expect(announcement).toContain("You submitted raise.");
    expect(announcement).not.toMatch(/dealer|avatar|room|championship/i);
  });

  it("states a legal next decision before the player acts", () => {
    const scenario = trainingScenarios[0];
    const announcement = buildPokerTableAnnouncement({
      action: null,
      scenario,
    });

    expect(announcement).toMatch(/to call\.|You may check or bet\./);
  });

  it("gives non-interactive visual cards and player seats explicit screen-reader semantics", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );

    // A labelled span/div is not reliably represented in every platform
    // accessibility tree. Explicit roles make face-up/down cards and table
    // seat state discoverable to Narrator/NVDA without exposing scenery.
    expect(source).toContain('role="img"');
    expect(source).toContain('className="community-cards"');
    expect(source).toContain('role="group"');
    expect(source).toContain('isShowingCards ? ", holding cards" : ""');
    expect(source).toContain('player.bet > 0 ? `, bet ${formatChips(player.bet)}` : ""');
    expect(source).toContain('className="opponent-cards" aria-hidden="true"');
    expect(source).toContain('className="seat-label" aria-hidden="true"');
  });
});
