import { describe, expect, it } from "vitest";
import { formatChips } from "./format";
import { formatMessage } from "./localeMessages";
import {
  deriveTableAnnouncements,
  TableAnnouncerController,
  type TableAnnouncerSnapshot,
} from "./tableAnnouncer";

function baseSnapshot(
  overrides: Partial<TableAnnouncerSnapshot> = {},
): TableAnnouncerSnapshot {
  return {
    bigBlind: 40,
    smallBlind: 20,
    handNumber: 1,
    heroAction: null,
    ...overrides,
  };
}

describe("deriveTableAnnouncements (pure transition logic)", () => {
  it("announces nothing on the first snapshot (no announcement on mount)", () => {
    expect(deriveTableAnnouncements(null, baseSnapshot())).toEqual([]);
  });

  it("announces nothing when a snapshot repeats -- the no-spam guarantee", () => {
    const snapshot = baseSnapshot({ latestPublicAction: "Maya: call" });
    // Simulate many re-renders (e.g. a camera-pan or countdown tick) that do
    // not touch any field this module reads: calling this dozens of times
    // with an unchanged snapshot must never produce an announcement.
    let previous: TableAnnouncerSnapshot | null = null;
    let totalAnnouncements = 0;
    for (let i = 0; i < 50; i += 1) {
      const announcements = deriveTableAnnouncements(previous, snapshot);
      totalAnnouncements += announcements.length;
      previous = snapshot;
    }
    // Only the very first transition (null -> snapshot) can ever fire, and it
    // fires zero here because there is no previous snapshot to diff against.
    expect(totalAnnouncements).toBe(0);
  });

  it("announces a blind increase exactly once per level change (a timer state change, not a tick)", () => {
    const level1 = baseSnapshot({ bigBlind: 40, smallBlind: 20 });
    const level2 = baseSnapshot({ bigBlind: 80, smallBlind: 40 });

    const first = deriveTableAnnouncements(level1, level2);
    expect(first).toHaveLength(1);
    expect(first[0].priority).toBe("polite");
    expect(first[0].text).toBe(
      formatMessage("table.announce.blindsIncreased", {
        smallBlind: formatChips(40),
        bigBlind: formatChips(80),
      }),
    );
    expect(first[0].text).toBe("Blinds increased to 40/80.");

    // Re-rendering at the SAME level (e.g. the decision clock ticking, which
    // is not part of this snapshot at all) never re-announces it.
    const repeat = deriveTableAnnouncements(level2, level2);
    expect(repeat).toEqual([]);
  });

  it("never announces a blind DECREASE (there is no such rule in this game, so treat it as noise, not a timer event)", () => {
    const higher = baseSnapshot({ bigBlind: 80, smallBlind: 40 });
    const lower = baseSnapshot({ bigBlind: 40, smallBlind: 20 });
    expect(deriveTableAnnouncements(higher, lower)).toEqual([]);
  });

  it("announces a single-winner hand result exactly once when the hand number advances", () => {
    const finishing = baseSnapshot({ handNumber: 4 });
    const nextHand = baseSnapshot({
      handNumber: 5,
      potResult: { winnerNames: ["Maya"], amount: 640, hadSidePot: false },
    });

    const announcements = deriveTableAnnouncements(finishing, nextHand);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].priority).toBe("polite");
    expect(announcements[0].text).toBe("Maya won the pot of 640.");

    // The same hand number never re-announces the same result.
    expect(deriveTableAnnouncements(nextHand, nextHand)).toEqual([]);
  });

  it("announces a split-pot result and appends the side-pot note only when the engine reported one", () => {
    const finishing = baseSnapshot({ handNumber: 7 });
    const nextHand = baseSnapshot({
      handNumber: 8,
      potResult: {
        winnerNames: ["You", "Jules"],
        amount: 900,
        hadSidePot: true,
      },
    });

    const [announcement] = deriveTableAnnouncements(finishing, nextHand);
    expect(announcement.text).toBe(
      "You and Jules split the pot of 900. A side pot was contested this hand.",
    );
  });

  it("never announces a result without a hand-number transition (avoids re-narrating a stale result on unrelated renders)", () => {
    const snapshot = baseSnapshot({
      handNumber: 3,
      potResult: { winnerNames: ["Maya"], amount: 500, hadSidePot: false },
    });
    expect(deriveTableAnnouncements(snapshot, snapshot)).toEqual([]);
  });

  it("escalates the hero's own all-in to the assertive channel exactly at the transition", () => {
    const beforeAllIn = baseSnapshot({ heroAction: null });
    const afterAllIn = baseSnapshot({ heroAction: "all-in", heroAllInAmount: 2_400 });

    const announcements = deriveTableAnnouncements(beforeAllIn, afterAllIn);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].priority).toBe("assertive");
    expect(announcements[0].text).toBe("You are all-in for 2,400.");

    // Staying all-in across renders (e.g. while the runout is presented)
    // never re-fires the same assertive announcement.
    expect(deriveTableAnnouncements(afterAllIn, afterAllIn)).toEqual([]);
  });

  it("escalates a public opponent all-in to the assertive channel using only already-visible public text", () => {
    const before = baseSnapshot({ latestPublicAction: "Maya: raise to 200" });
    const after = baseSnapshot({ latestPublicAction: "Maya: all-in to 4,000" });

    const announcements = deriveTableAnnouncements(before, after);
    expect(announcements).toHaveLength(1);
    expect(announcements[0].priority).toBe("assertive");
    expect(announcements[0].text).toBe("Maya: all-in to 4,000.");
  });

  it("does not double-fire an assertive all-in when the hero and a public entry both indicate all-in in the same transition", () => {
    const before = baseSnapshot({
      heroAction: null,
      latestPublicAction: "Maya: call",
    });
    const after = baseSnapshot({
      heroAction: "all-in",
      heroAllInAmount: 1_000,
      latestPublicAction: "You: all-in to 1,000",
    });

    const announcements = deriveTableAnnouncements(before, after);
    const assertiveCount = announcements.filter(
      (entry) => entry.priority === "assertive",
    ).length;
    expect(assertiveCount).toBe(1);
    expect(announcements[0].text).toBe("You are all-in for 1,000.");
  });

  it("never mentions hidden information such as a specific hole card rank/suit or a folded hand's cards", () => {
    const before = baseSnapshot({ handNumber: 1 });
    const after = baseSnapshot({
      handNumber: 2,
      bigBlind: 80,
      smallBlind: 40,
      potResult: { winnerNames: ["Maya"], amount: 300, hadSidePot: false },
    });
    const combined = deriveTableAnnouncements(before, after)
      .map((entry) => entry.text)
      .join(" ");
    expect(combined).not.toMatch(
      /clubs|diamonds|hearts|spades|hole card|folded hand/i,
    );
  });
});

describe("TableAnnouncerController (stateful coalescing)", () => {
  it("keeps the last announcement per priority instead of clearing it on unrelated renders", () => {
    const controller = new TableAnnouncerController();
    controller.update(baseSnapshot({ handNumber: 1 }));
    const afterBlindChange = controller.update(
      baseSnapshot({ handNumber: 1, bigBlind: 80, smallBlind: 40 }),
    );
    expect(afterBlindChange.polite).toBe("Blinds increased to 40/80.");
    expect(afterBlindChange.assertive).toBe("");

    // A later render with nothing new must not blank out the last message --
    // an aria-live region should keep saying the last real thing that
    // happened, not flicker to empty text.
    const unrelatedRender = controller.update(
      baseSnapshot({ handNumber: 1, bigBlind: 80, smallBlind: 40 }),
    );
    expect(unrelatedRender.polite).toBe("Blinds increased to 40/80.");
  });

  it("coalesces two simultaneous same-priority events into one spoken sentence", () => {
    const controller = new TableAnnouncerController();
    controller.update(baseSnapshot({ handNumber: 5, bigBlind: 40, smallBlind: 20 }));
    // A blind increase lands in the SAME transition as a hand result -- both
    // are polite, so they must read as one combined announcement rather than
    // clobbering each other.
    const result = controller.update(
      baseSnapshot({
        handNumber: 6,
        bigBlind: 80,
        smallBlind: 40,
        potResult: { winnerNames: ["Maya"], amount: 480, hadSidePot: false },
      }),
    );
    expect(result.polite).toBe(
      "Blinds increased to 40/80. Maya won the pot of 480.",
    );
  });

  it("resets cleanly for a new table mount", () => {
    const controller = new TableAnnouncerController();
    controller.update(baseSnapshot({ handNumber: 1 }));
    controller.update(baseSnapshot({ handNumber: 1, bigBlind: 80, smallBlind: 40 }));
    controller.reset();
    expect(controller.current()).toEqual({ polite: "", assertive: "" });
    // After a reset the next update is treated as a fresh mount (no
    // previous snapshot), so it never announces anything either.
    const afterReset = controller.update(
      baseSnapshot({ handNumber: 1, bigBlind: 80, smallBlind: 40 }),
    );
    expect(afterReset).toEqual({ polite: "", assertive: "" });
  });

  it("simulates a full hand's worth of rapid re-renders without ever spamming an unrelated one", () => {
    const controller = new TableAnnouncerController();
    controller.update(baseSnapshot({ handNumber: 2, bigBlind: 40, smallBlind: 20 }));
    // 20 renders in a row where only the decision clock (not part of this
    // snapshot) would have been ticking in the real component.
    for (let i = 0; i < 20; i += 1) {
      const result = controller.update(
        baseSnapshot({ handNumber: 2, bigBlind: 40, smallBlind: 20 }),
      );
      expect(result.polite).toBe("");
      expect(result.assertive).toBe("");
    }
  });
});
