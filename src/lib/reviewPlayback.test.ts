import { describe, expect, it } from "vitest";
import {
  countNotable,
  nextPlaybackStep,
  type PlaybackDecision,
} from "./reviewPlayback";

/** A round with notable decisions at indices 2 and 5. */
const round: PlaybackDecision[] = [
  { index: 0, notable: false },
  { index: 1, notable: false },
  { index: 2, notable: true },
  { index: 3, notable: false },
  { index: 4, notable: false },
  { index: 5, notable: true },
  { index: 6, notable: false },
];

describe("Play All walks the whole round in order", () => {
  it("starts at the first decision", () => {
    expect(nextPlaybackStep(round, null, "all")).toEqual({
      index: 0,
      pause: false,
      finished: false,
    });
  });

  it("advances one decision at a time and never skips one", () => {
    const seen: number[] = [];
    let current: number | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const step = nextPlaybackStep(round, current, "all");
      if (step.index === null) break;
      seen.push(step.index);
      current = step.index;
      if (step.finished) break;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("does not stop at notable decisions", () => {
    expect(nextPlaybackStep(round, 1, "all").pause).toBe(false);
    expect(nextPlaybackStep(round, 4, "all").pause).toBe(false);
  });

  it("reports the end of the round", () => {
    expect(nextPlaybackStep(round, 5, "all").finished).toBe(true);
    expect(nextPlaybackStep(round, 6, "all")).toEqual({
      index: null,
      pause: false,
      finished: true,
    });
  });
});

describe("Play Noteworthy navigates without deleting the round", () => {
  /*
    The regression this replaces. "Noteworthy" was a filter: turning it on
    removed every ordinary decision from the timeline, so the player lost the
    shape of their own round and any sense of chronology. It is navigation now
    -- the routine decisions are passed over, not taken away.
  */
  it("stops at each notable decision in order", () => {
    const first = nextPlaybackStep(round, null, "noteworthy");
    expect(first).toEqual({ index: 2, pause: true, finished: false });
    const second = nextPlaybackStep(round, 2, "noteworthy");
    expect(second).toEqual({ index: 5, pause: true, finished: true });
  });

  it("passes over routine decisions rather than removing them", () => {
    // The decision list handed in is never mutated or reduced; the caller keeps
    // rendering all seven rows.
    const before = JSON.stringify(round);
    nextPlaybackStep(round, null, "noteworthy");
    nextPlaybackStep(round, 2, "noteworthy");
    expect(JSON.stringify(round)).toBe(before);
    expect(round).toHaveLength(7);
  });

  it("resumes from wherever the player is, including a routine decision", () => {
    // A player who clicked decision 3 by hand and pressed continue should go to
    // the next notable one after it, not back to the start.
    expect(nextPlaybackStep(round, 3, "noteworthy").index).toBe(5);
  });

  it("ends at the last decision when no notable ones remain", () => {
    // Landing on the round's end rather than stopping halfway through it.
    const step = nextPlaybackStep(round, 5, "noteworthy");
    expect(step.index).toBe(6);
    expect(step.finished).toBe(true);
  });

  it("handles a round with no notable decisions at all", () => {
    const quiet: PlaybackDecision[] = [
      { index: 0, notable: false },
      { index: 1, notable: false },
    ];
    const step = nextPlaybackStep(quiet, null, "noteworthy");
    expect(step.index).toBe(1);
    expect(step.finished).toBe(true);
  });

  it("handles a round where everything is notable", () => {
    const loud: PlaybackDecision[] = [
      { index: 0, notable: true },
      { index: 1, notable: true },
    ];
    expect(nextPlaybackStep(loud, null, "noteworthy")).toEqual({
      index: 0,
      pause: true,
      finished: false,
    });
    expect(nextPlaybackStep(loud, 0, "noteworthy")).toEqual({
      index: 1,
      pause: true,
      finished: true,
    });
  });
});

describe("edge cases do not strand playback", () => {
  it("finishes immediately on an empty round", () => {
    for (const mode of ["all", "noteworthy"] as const) {
      expect(nextPlaybackStep([], null, mode)).toEqual({
        index: null,
        pause: false,
        finished: true,
      });
    }
  });

  it("treats an unknown current index as the start", () => {
    // A decision that has been filtered out of view must not strand playback.
    expect(nextPlaybackStep(round, 999, "all").index).toBe(0);
  });

  it("counts what a noteworthy run will stop at", () => {
    expect(countNotable(round)).toBe(2);
    expect(countNotable([])).toBe(0);
  });
});
