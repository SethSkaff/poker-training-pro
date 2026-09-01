import { describe, expect, it } from "vitest";
import {
  directTimedBlinds,
  type TimedBlindDirectorInput,
} from "./timedBlindDirector";

function input(
  overrides: Partial<TimedBlindDirectorInput> = {},
): TimedBlindDirectorInput {
  return {
    durationMinutes: 30,
    elapsedMs: 0,
    current: { smallBlind: 50, bigBlind: 100, bigBlindAnte: 100 },
    players: [
      { id: "hero", stack: 12_000 },
      { id: "a", stack: 10_000 },
      { id: "b", stack: 8_000 },
      { id: "c", stack: 7_000 },
      { id: "d", stack: 6_000 },
      { id: "e", stack: 5_000 },
    ],
    startingTotalChips: 48_000,
    ...overrides,
  };
}

describe("timed blind director", () => {
  it.each([5, 15, 30, 60])(
    "supports a %i-minute table and protects its opening quarter",
    (durationMinutes) => {
      const decision = directTimedBlinds(
        input({
          durationMinutes,
          elapsedMs: durationMinutes * 60_000 * 0.2,
        }),
      );
      expect(decision.phase).toBe("opening");
      expect(decision.bigBlind).toBe(100);
    },
  );

  it("never lowers blinds and never creates an ante", () => {
    const decision = directTimedBlinds(
      input({
        elapsedMs: 18 * 60_000,
        current: { smallBlind: 1_000, bigBlind: 2_000, bigBlindAnte: 2_000 },
      }),
    );
    expect(decision.smallBlind).toBeGreaterThanOrEqual(1_000);
    expect(decision.bigBlind).toBeGreaterThanOrEqual(2_000);
    expect(decision.bigBlindAnte).toBe(0);
  });

  it("increases public pressure later in the same session", () => {
    const middle = directTimedBlinds(input({ elapsedMs: 12 * 60_000 }));
    const closing = directTimedBlinds(input({ elapsedMs: 27 * 60_000 }));
    expect(middle.phase).toBe("pressure");
    expect(closing.phase).toBe("closing");
    expect(closing.bigBlind).toBeGreaterThan(middle.bigBlind);
  });

  it("responds to the current live stack distribution", () => {
    const shallow = directTimedBlinds(
      input({
        elapsedMs: 25 * 60_000,
        current: { smallBlind: 500, bigBlind: 1_000, bigBlindAnte: 1_000 },
        players: [
          { id: "hero", stack: 4_000 },
          { id: "a", stack: 3_000 },
          { id: "b", stack: 2_000 },
        ],
      }),
    );
    const deep = directTimedBlinds(
      input({
        elapsedMs: 25 * 60_000,
        current: { smallBlind: 500, bigBlind: 1_000, bigBlindAnte: 1_000 },
        players: [
          { id: "hero", stack: 40_000 },
          { id: "a", stack: 30_000 },
          { id: "b", stack: 20_000 },
        ],
      }),
    );
    expect(deep.bigBlind).toBeGreaterThan(shallow.bigBlind);
  });

  it("caps ordinary pressure jumps before the closing phase", () => {
    const decision = directTimedBlinds(
      input({
        elapsedMs: 14 * 60_000,
        players: [
          { id: "hero", stack: 1_000_000 },
          { id: "a", stack: 900_000 },
          { id: "b", stack: 800_000 },
        ],
      }),
    );
    expect(decision.phase).toBe("pressure");
    expect(decision.bigBlind).toBeLessThanOrEqual(200);
  });

  it("covers the second-largest live stack exactly at the deadline", () => {
    const decision = directTimedBlinds(
      input({
        elapsedMs: 30 * 60_000,
        players: [
          { id: "leader", stack: 23_400 },
          { id: "second", stack: 9_125 },
          { id: "short", stack: 2_000 },
        ],
      }),
    );
    expect(decision.phase).toBe("deadline");
    expect(decision.bigBlind).toBeGreaterThanOrEqual(9_125);
    expect(decision.forcedAllInStack).toBe(9_125);
  });

  it("keeps enforcing second-place coverage after the deadline", () => {
    const decision = directTimedBlinds(
      input({
        elapsedMs: 42 * 60_000,
        current: { smallBlind: 2_500, bigBlind: 5_000, bigBlindAnte: 5_000 },
        players: [
          { id: "leader", stack: 18_000 },
          { id: "second", stack: 12_300 },
          { id: "short", stack: 4_500 },
        ],
      }),
    );
    expect(decision.bigBlind).toBeGreaterThanOrEqual(12_300);
    expect(decision.bigBlindAnte).toBe(0);
  });

  it("forces the shorter heads-up stack all-in at the deadline", () => {
    const decision = directTimedBlinds(
      input({
        durationMinutes: 15,
        elapsedMs: 15 * 60_000,
        players: [
          { id: "leader", stack: 31_000 },
          { id: "runner-up", stack: 7_000 },
        ],
      }),
    );
    expect(decision.tournamentPlayersRemaining).toBe(2);
    expect(decision.bigBlind).toBeGreaterThanOrEqual(7_000);
  });

  it("holds the level when a winner already exists", () => {
    const decision = directTimedBlinds(
      input({
        elapsedMs: 35 * 60_000,
        current: { smallBlind: 400, bigBlind: 800, bigBlindAnte: 800 },
        players: [
          { id: "winner", stack: 48_000 },
          { id: "out", stack: 0, eliminated: true },
        ],
      }),
    );
    expect(decision.bigBlind).toBe(800);
    expect(decision.forcedAllInStack).toBeNull();
  });

  it("rejects unsupported durations", () => {
    expect(() => directTimedBlinds(input({ durationMinutes: 4 }))).toThrow(
      /durationMinutes/,
    );
    expect(() => directTimedBlinds(input({ durationMinutes: 181 }))).toThrow(
      /durationMinutes/,
    );
  });
});
