import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import {
  buildPokerTableAnnouncement,
  decisionClockAriaLabel,
  playerSeatAriaLabel,
  sceneSeatDomAttributes,
} from "./PokerTable";
import { createTableSceneSnapshot } from "../scene3d/tableSceneSnapshot";

describe("poker table live announcements", () => {
  it("keeps the elapsed decision clock semantic and the table-audio button actionable", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );

    expect(source).toContain('role="timer"');
    // The clock's accessible name is exported as a pure function so its
    // resolved, catalog-backed value can be asserted directly instead of
    // scanning the source for literal copy.
    expect(source).toContain("aria-label={decisionClockAriaLabel(elapsedMs)}");
    expect(decisionClockAriaLabel(0)).toBe(
      formatMessage("table.decisionClock.ariaLabel", {
        seconds: formatFixedDecimal(0, 1),
      }),
    );
    expect(decisionClockAriaLabel(0)).toBe("Decision time 0.0 seconds");
    expect(decisionClockAriaLabel(12_345)).toBe(
      formatMessage("table.decisionClock.ariaLabel", {
        seconds: formatFixedDecimal(12.345, 1),
      }),
    );
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
    // The skip control's accessible name now resolves through the versioned
    // catalog; verify the wiring (key usage) and the resolved value
    // separately instead of scanning for the literal English copy.
    expect(source).toContain(
      'aria-label={formatMessage("table.spectator.skipAriaLabel")}',
    );
    /*
      Reworded for E27-015: the accessible name now says what is skipped *and*
      what is not, because "skip" on its own invites the fear that the hand is
      being abandoned or the result thrown away. Neither is true -- the engine
      still plays the hand out and the winner is still shown.
    */
    const skipName = formatMessage("table.spectator.skipAriaLabel");
    expect(skipName).toContain("go to the result");
    expect(skipName).toContain("still played out");
    expect(skipName).toContain("winner is still shown");
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
    // Face-down opponent cards remain decorative. The sole exception is the
    // short-lived public showdown event, whose cards are intentionally exposed
    // with their normal image semantics.
    expect(source).toContain('className="opponent-cards" aria-hidden={!hasRevealedCards}');
    expect(source).toContain('className="seat-label" aria-hidden="true"');

    // The seat's accessible name is built by an exported pure function
    // (`playerSeatAriaLabel`) rather than inline source string concatenation.
    // Verify its actual rendered output for the cases the removed literal
    // source-scan used to cover: an opponent's held cards and an active bet.
    expect(source).toContain("aria-label={playerSeatAriaLabel({");

    const holdingCardsLabel = playerSeatAriaLabel({
      isHero: false,
      name: "Maya",
      stack: 3_600,
      status: "active",
      showingCards: true,
      bet: 0,
      dealer: false,
    });
    expect(holdingCardsLabel).toBe(
      `${formatMessage("table.seat.ariaBase", {
        name: "Maya",
        chips: formatChips(3_600),
        status: formatMessage("table.seat.statusFragment.active"),
      })}${formatMessage("table.seat.holdingCardsFragment")}`,
    );
    expect(holdingCardsLabel).toContain(", holding cards");

    const noCardsLabel = playerSeatAriaLabel({
      isHero: false,
      name: "Maya",
      stack: 3_600,
      status: "active",
      showingCards: false,
      bet: 0,
      dealer: false,
    });
    expect(noCardsLabel).not.toContain(", holding cards");

    const betLabel = playerSeatAriaLabel({
      isHero: true,
      name: "You",
      stack: 3_600,
      status: "active",
      showingCards: false,
      bet: 200,
      dealer: true,
    });
    expect(betLabel).toBe(
      `${formatMessage("table.seat.ariaBase", {
        name: formatMessage("table.seat.you"),
        chips: formatChips(3_600),
        status: formatMessage("table.seat.statusFragment.active"),
      })}${formatMessage("table.seat.betFragment", {
        amount: formatChips(200),
      })}${formatMessage("table.seat.dealerFragment")}`,
    );
    expect(betLabel).toContain(", bet 200");
    expect(betLabel).toContain(", dealer button");
    expect(betLabel.startsWith("You,")).toBe(true);

    const investedLabel = playerSeatAriaLabel({
      isHero: true,
      name: "You",
      stack: 3_400,
      status: "active",
      showingCards: false,
      bet: 200,
      totalCommitted: 800,
      dealer: false,
    });
    expect(investedLabel).toContain(", total invested 800");

    const noBetLabel = playerSeatAriaLabel({
      isHero: false,
      name: "Jules",
      stack: 5_400,
      status: "folded",
      showingCards: true,
      bet: 0,
      dealer: false,
    });
    expect(noBetLabel).not.toContain(", bet ");
    expect(noBetLabel).toContain(formatMessage("table.seat.statusFragment.folded"));
  });

  it("publishes the adapter's canonical public seat projection on DOM seats", () => {
    const snapshot = createTableSceneSnapshot({
      players: [
        { id: "villain", canonicalSeat: 8, stack: 900, bet: 25, status: "active" },
        { id: "hero", canonicalSeat: 3, stack: 1000, bet: 0, status: "active" },
      ],
      heroId: "hero",
      pot: 25,
      boardCards: 0,
      cameraPan: 0,
      reducedMotion: false,
    });

    expect(sceneSeatDomAttributes(snapshot.seats[1])).toEqual({
      "data-scene-canonical-seat": "8",
      "data-scene-relative-seat": "5",
      "data-scene-card-visibility": "hidden",
    });
    expect(sceneSeatDomAttributes(undefined)).toEqual({});
  });
});
