import { describe, expect, it } from "vitest";
import { createTournamentDecisionClock } from "./tournamentDecisionClock";

function controllableClock(startAt = 1_000) {
  let value = startAt;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

describe("the blind clock counts each millisecond exactly once", () => {
  it("reports the time since the previous drain, not since the start", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });

    time.advance(30_000);
    expect(clock.drain()).toBe(30_000);
    time.advance(45_000);
    expect(clock.drain()).toBe(45_000);
    time.advance(45_000);
    expect(clock.drain()).toBe(45_000);
  });

  /*
    The regression, stated as the invariant that failed: the same span of real
    time must advance the blind clock by that span however many hero actions
    fall inside it. The old cumulative timer turned three decisions across three
    minutes into six minutes of blind-clock advance.
  */
  it("advances by the same total no matter how many actions occur", () => {
    const runFor = (actions: number) => {
      const time = controllableClock();
      const clock = createTournamentDecisionClock({ now: time.now });
      const sliceMs = 180_000 / actions;
      let total = 0;
      for (let index = 0; index < actions; index += 1) {
        time.advance(sliceMs);
        total += clock.drain();
      }
      return total;
    };

    expect(runFor(1)).toBe(180_000);
    expect(runFor(3)).toBe(180_000);
    expect(runFor(6)).toBe(180_000);
    expect(runFor(12)).toBe(180_000);
  });

  it("reports nothing when no time has passed", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });
    expect(clock.drain()).toBe(0);
    expect(clock.drain()).toBe(0);
  });

  it("never reports negative time if the source goes backwards", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });
    time.advance(-5_000);
    expect(clock.drain()).toBe(0);
  });
});

describe("paused time is not tournament time", () => {
  it("excludes time spent paused", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });

    time.advance(10_000);
    clock.pause();
    time.advance(120_000); // player reading the pause menu
    clock.resume();
    time.advance(5_000);

    expect(clock.drain()).toBe(15_000);
  });

  it("drains only up to the pause point while still paused", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });
    time.advance(8_000);
    clock.pause();
    time.advance(60_000);
    expect(clock.drain()).toBe(8_000);
  });

  it("is idempotent for repeated pause and resume", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });
    clock.pause();
    clock.pause();
    time.advance(30_000);
    clock.resume();
    clock.resume();
    time.advance(2_000);
    expect(clock.drain()).toBe(2_000);
  });
});

describe("a sleeping machine does not skip blind levels", () => {
  it("clamps a single enormous gap", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({
      now: time.now,
      maximumAdvanceMs: 300_000,
    });
    time.advance(9 * 60 * 60_000); // lid shut overnight
    expect(clock.drain()).toBe(300_000);
  });

  it("re-anchors after clamping so the gap is not repaid later", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({
      now: time.now,
      maximumAdvanceMs: 300_000,
    });
    time.advance(9 * 60 * 60_000);
    clock.drain();
    time.advance(20_000);
    expect(clock.drain()).toBe(20_000);
  });
});

describe("reset discards accrued time without reporting it", () => {
  it("drops everything since the last drain", () => {
    const time = controllableClock();
    const clock = createTournamentDecisionClock({ now: time.now });
    time.advance(50_000);
    clock.reset();
    expect(clock.drain()).toBe(0);
    time.advance(1_000);
    expect(clock.drain()).toBe(1_000);
  });
});
