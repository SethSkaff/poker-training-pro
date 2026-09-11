import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import { defaultProgress, defaultSettings } from "../lib/storage";
import { tableChipPresentation } from "../lib/tableChipPresentation";
import {
  PokerTable,
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
    expect(source).toContain("}, [action, paused, isReview]);");
  });

  it("omits the 2D decision clock by design while keeping the timer it fed", () => {
    /*
      DELIBERATE OMISSION -- do not "fix" this by restoring the clock.

      `e114728` removed the visible decision clock from the 2D table on
      request. 2D is the default layout, so this is what most players see, and
      the comment that commit deleted from `PokerTable.tsx` had argued the
      other way; that argument lost. This test exists so the next session
      finds the decision recorded as a contract rather than as an absence,
      and so the one thing that would make the removal a real regression --
      losing the elapsed timer itself -- is checked instead of assumed.

      What was removed is a readout. `elapsedMs` still runs in both layouts and
      still feeds the two things that consume it: Training grading, and the
      tournament blind schedule through its own separately-drained clock.
    */
    const scenario = trainingScenarios[0];
    const renderTable = (spatialScene: boolean) =>
      renderToStaticMarkup(
        createElement(PokerTable, {
          mode: "training",
          scenario,
          settings: { ...defaultSettings, spatialScene },
          progress: defaultProgress,
          onProgressChange: () => undefined,
          onSettingsChange: () => undefined,
          onNextScenario: () => undefined,
          onExit: () => undefined,
        }),
      );

    const twoD = renderTable(false);
    expect(defaultSettings.spatialScene ?? false).toBe(false);
    expect(twoD).not.toContain("decision-clock");
    expect(twoD).not.toContain('role="timer"');
    expect(twoD).not.toContain(decisionClockAriaLabel(0));

    // 3D keeps it: the clock sits in the table-tools cluster, not the canvas.
    const threeD = renderTable(true);
    expect(threeD).toContain("decision-clock");
    expect(threeD).toContain('role="timer"');
    expect(threeD).toContain(decisionClockAriaLabel(0));

    /*
      The timer is not presentation. These are the statements that keep it
      running and spend it, and none of them is behind the layout switch --
      asserted on the source because neither grading nor the blind schedule is
      reachable from a static render.
    */
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "PokerTable.tsx"),
      "utf8",
    );
    const unconditional = [
      // The elapsed interval, rebased on resume rather than restarted.
      "elapsedStartedAt.current = performance.now() - elapsedMs",
      // Training grading spends the elapsed time, net of the math detour.
      "Math.round(elapsedMs - mathElapsedMs.current),",
      // The blind schedule has its own clock and is drained once per action.
      "decisionElapsedMs: blindClock.current.drain(),",
    ];
    for (const statement of unconditional) {
      expect(source, statement).toContain(statement);
      const line = source
        .split("\n")
        .find((candidate) => candidate.includes(statement));
      expect(line, statement).not.toContain("isTwoDMode");
    }
    // Exactly one place decides whether the clock is drawn.
    expect(source.split('{!isTwoDMode && <span').length - 1).toBe(1);
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

    expect(source).toContain("pendingPresentationEvent.current?.finish()");
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
      "data-scene-player-id": "villain",
      "data-scene-canonical-seat": "8",
      "data-scene-relative-seat": "5",
      "data-scene-card-visibility": "hidden",
      "data-scene-stack": "900",
      "data-scene-bet": "25",
      "data-scene-acting": "false",
    });
    expect(sceneSeatDomAttributes(undefined)).toEqual({});
  });
});

/*
  The 2D redesign split one number into two: `scenario.pot` stays the
  authoritative inclusive hand total that poker maths uses, while the felt's
  central pile shows only the chips physically gathered into the middle. The
  redesign then fed the gathered amount into the live region, so the table
  announced "Pot 500" while asking the same player for 1,800 to call. Pricing
  that call off the announced number gives 1800/(500+1800) = 78% required
  equity instead of the true 1800/(2700+1800) = 40%.

  These assertions pin the split itself, so either half moving is a failure
  rather than a silent change of meaning.
*/
describe("gathered center chips are never announced as the pot", () => {
  // A scenario whose inclusive pot is genuinely larger than what has been
  // gathered, because the street's wagers are still in front of the seats.
  const scenario = trainingScenarios.find(
    (candidate) =>
      candidate.players.reduce((sum, player) => sum + player.bet, 0) > 0 &&
      candidate.amountToCall > 0,
  );
  if (!scenario) throw new Error("Expected a scenario with outstanding wagers");

  const outstanding = scenario.players.reduce(
    (sum, player) => sum + player.bet,
    0,
  );
  const gathered = tableChipPresentation(scenario, undefined, 0, []).pot;

  it("splits the inclusive pot into gathered chips plus outstanding wagers", () => {
    // No chip is counted twice and none goes missing: the two physical places
    // chips can be must add back up to the authoritative total.
    expect(gathered + outstanding).toBe(scenario.pot);
    expect(gathered).toBeLessThan(scenario.pot);
    expect(outstanding).toBeGreaterThan(0);
  });

  it("announces the authoritative inclusive pot, not the center pile", () => {
    const announcement = buildPokerTableAnnouncement({
      action: null,
      scenario,
    });

    expect(announcement).toContain(
      formatMessage("table.announce.streetPot", {
        street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
        pot: formatChips(scenario.pot),
      }),
    );
    // The price and the pot it is priced against have to be the same hand.
    expect(announcement).toContain(
      formatMessage("table.announce.amountToCall", {
        amount: formatChips(scenario.amountToCall),
      }),
    );
    expect(announcement).not.toContain(
      formatMessage("table.announce.streetPot", {
        street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
        pot: formatChips(gathered),
      }),
    );
  });

  it("renders the gathered amount on the felt while the live region says the pot", () => {
    const markup = renderToStaticMarkup(
      createElement(PokerTable, {
        mode: "training",
        scenario,
        settings: defaultSettings,
        progress: defaultProgress,
        onProgressChange: () => undefined,
        onSettingsChange: () => undefined,
        onNextScenario: () => undefined,
        onExit: () => undefined,
      }),
    );

    expect(markup).toContain('class="table-screen table-screen--2d"');
    // The center pile is the gathered chips only.
    expect(markup).toContain(`data-pot-amount="${gathered}"`);
    // Outstanding wagers stay physically in front of their seats.
    for (const player of scenario.players.filter((entry) => entry.bet > 0)) {
      expect(markup).toContain(`data-bet-amount="${player.bet}"`);
    }
    // The scene still carries the authoritative total for poker reasoning.
    expect(markup).toContain(`data-scene-pot="${scenario.pot}"`);
    // And the live region prices the decision off that same total.
    expect(markup).toContain(
      formatMessage("table.announce.streetPot", {
        street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
        pot: formatChips(scenario.pot),
      }),
    );
  });

  it("names the felt readout for the quantity it actually shows", () => {
    const markup = renderToStaticMarkup(
      createElement(PokerTable, {
        mode: "training",
        scenario,
        settings: defaultSettings,
        progress: defaultProgress,
        onProgressChange: () => undefined,
        onSettingsChange: () => undefined,
        onNextScenario: () => undefined,
        onExit: () => undefined,
      }),
    );

    // The readout is the center pile, so its accessible name says so rather
    // than calling a fraction of the hand total "Pot".
    // Scoped to the attribute: the live region legitimately contains the word
    // "Pot" beside the inclusive total, so a bare substring would collide.
    expect(markup).toContain(
      `aria-label="${formatMessage("table.readout.gatheredAriaLabel", {
        amount: formatChips(gathered),
      })}"`,
    );
    expect(markup).not.toContain(
      `aria-label="${formatMessage("table.readout.potAriaLabel", {
        amount: formatChips(gathered),
      })}"`,
    );
  });

  it("leaves the Training decision context on the inclusive pot", () => {
    const markup = renderToStaticMarkup(
      createElement(PokerTable, {
        mode: "training",
        scenario,
        settings: defaultSettings,
        progress: defaultProgress,
        onProgressChange: () => undefined,
        onSettingsChange: () => undefined,
        onNextScenario: () => undefined,
        onExit: () => undefined,
      }),
    );

    // Pot odds are taught from this panel; it must never quote the center pile.
    const context = markup.slice(
      markup.indexOf('class="training-context"'),
      markup.indexOf("poker-scene"),
    );
    expect(context).toContain(formatChips(scenario.pot));
    expect(context).toContain(formatChips(scenario.amountToCall));
  });
});
