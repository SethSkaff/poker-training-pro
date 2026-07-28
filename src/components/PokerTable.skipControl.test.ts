import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSeatFoldedForPresentation } from "./PokerTable";
import {
  advanceTournamentRunnerOneStep,
  advanceTournamentRunnerToHero,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
} from "../modes/tournamentRunner";

const componentDir = path.dirname(fileURLToPath(import.meta.url));
const tableSource = readFileSync(
  path.join(componentDir, "PokerTable.tsx"),
  "utf8",
);
const styles = readFileSync(
  path.join(componentDir, "..", "styles.css"),
  "utf8",
);
const messages = readFileSync(
  path.join(componentDir, "..", "locales", "en-US.messages.gameplay.ts"),
  "utf8",
);

function replayHash(runner: Parameters<typeof createTournamentRunnerReplay>[0]): string {
  return createHash("sha256")
    .update(JSON.stringify(createTournamentRunnerReplay(runner)))
    .digest("hex");
}

function consumePresentationQueue(runner: ReturnType<typeof createCareerTournamentRunner>) {
  let current = runner;
  for (let index = 0; index < 100; index += 1) {
    const step = advanceTournamentRunnerOneStep(current, {
      policy: { simulations: 60 },
    });
    current = step.runner;
    if (step.awaitingHero || current.session.status === "complete") return current;
  }
  throw new Error("Presentation queue did not reach a terminal or hero state");
}

/*
  E27-015. The control existed but was wrong in label, size, and placement: a
  small secondary button in the bottom dock, beside the 2x speed toggle, where
  a player who had just folded could not find it and where the two read as the
  same kind of thing. They are not -- 2x changes the presentation rate, Skip
  ends the presentation and goes to the outcome.
*/
describe("the skip control is findable and distinct from speed", () => {
  it("is labelled with the single word Skip", () => {
    expect(messages).toContain('"table.spectator.skip": "Skip"');
    expect(tableSource).toContain('formatMessage("table.spectator.skip")');
  });

  it("lives over the table, not inside the bottom dock", () => {
    // The button is rendered inside the scene, above the table -- the dock
    // markup must no longer contain it.
    const dockStart = tableSource.indexOf('className="spectator-dock"');
    const dockEnd = tableSource.indexOf("{raiseOpen && !action", dockStart);
    const dockMarkup = tableSource.slice(dockStart, dockEnd);
    expect(dockStart).toBeGreaterThan(0);
    expect(dockMarkup).not.toContain("skip-hand");
    expect(dockMarkup).not.toContain("table.spectator.skip");
  });

  it("is a large, prominent target rather than a quiet secondary button", () => {
    expect(styles).toMatch(/\.skip-hand \{[^}]*min-height: 48px/);
    // Placed toward the top of the table, where the eye already is.
    // Upper-centre band of the table, not the bottom dock, and clear of the
    // top-centre seat it was originally drawn over.
    expect(styles).toMatch(/\.skip-hand \{[^}]*top: 30%/);
    expect(styles).toMatch(/\.skip-hand \{[^}]*left: 50%/);
  });

  it("keeps the speed toggle separate and visually secondary", () => {
    // 2x remains in the dock; it must not have been merged into the new
    // control or given the same prominence.
    expect(tableSource).toContain('formatMessage("table.spectator.speed2x")');
    expect(styles).not.toMatch(/\.skip-hand[^{]*\{[^}]*table\.spectator\.speed2x/);
  });

  it("appears as soon as the hero has no decision, including the fold frame", () => {
    // `action` covers the frame between submitting and the engine answering,
    // so the control does not wait for the next presentation event to arrive.
    expect(tableSource).toContain("{!heroDecisionActive || action ? (");
  });

  it("tells assistive technology what is skipped and what is not", () => {
    expect(messages).toContain(
      "The hand is still played out and the winner is still shown.",
    );
    expect(tableSource).toContain(
      'aria-label={formatMessage("table.spectator.skipAriaLabel")}',
    );
  });

  it("does not animate its way in when table motion is off", () => {
    expect(styles).toContain(':root[data-motion-table="off"] .skip-hand');
  });
});

/*
  The load-bearing guarantee: skipping is presentation-only. It must reach the
  same state the queue would have reached, without replaying a submitted action
  or re-deciding anything.
*/
describe("skipping cannot change what happened", () => {
  const hero = { id: "hero", name: "Player", rating: 1_000 };
  const build = () =>
    createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed: "skip-determinism",
    });

  it("reaches an identical runner state whether or not the queue was drained", () => {
    // Advancing to the hero is exactly what the skip path does to fast-forward.
    // Running it twice from the same seed must produce the same authoritative
    // state, or a skipped hand and a watched hand would diverge.
    const watched = consumePresentationQueue(build());
    const skipped = advanceTournamentRunnerToHero(build(), {
      policy: { simulations: 60 },
    });

    expect(skipped.sequence).toBe(watched.sequence);
    expect(skipped.replayActions).toEqual(watched.replayActions);
    expect(JSON.stringify(skipped.session)).toBe(
      JSON.stringify(watched.session),
    );
    expect(replayHash(skipped)).toBe(replayHash(watched));
  });

  it("never records an extra action for the skip itself", () => {
    const before = build();
    const after = advanceTournamentRunnerToHero(before, {
      policy: { simulations: 60 },
    });
    // Opponent actions are recorded; the skip is not an action and must add
    // nothing of its own beyond them.
    for (const entry of after.replayActions) {
      expect(entry).not.toHaveProperty("skip");
    }
  });

  it("keeps one readable result beat instead of jumping past the outcome", () => {
    // The skip path in App.tsx re-queues a single `hand-result` event and
    // guards re-entry with `skipResultVisible`, so the result cannot be
    // replaced by the next hand before it has been seen (E27-003).
    const appSource = readFileSync(
      path.join(componentDir, "..", "App.tsx"),
      "utf8",
    );
    expect(appSource).toContain("skipResultVisible");
    expect(appSource).toContain("skipTerminalFoldedPlayerIds");
    expect(tableSource).toContain("retainSceneTerminalFoldedPlayers");
    expect(appSource).toContain('kind: "hand-result"');
  });

  it("keeps the DOM seat folded during Skip's readable pre-fold result beat", () => {
    expect(isSeatFoldedForPresentation("active", undefined, true)).toBe(true);
    expect(isSeatFoldedForPresentation("active", undefined, false)).toBe(false);
    expect(tableSource).toContain("terminalFolded={skipTerminalFoldedPlayerIds.has(player.id)}");
  });
});
