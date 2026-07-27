import { describe, expect, it } from "vitest";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import type { FreezableDelayHost } from "./freezableDelay";
import {
  createPresentationEventDelay,
  presentationEventDelayMs,
} from "./tournamentPresentationClock";

const actionEvent: TournamentPresentationEvent = {
  id: "3:hand-1:action:0",
  kind: "action",
  handId: "hand-1",
  playerId: "opponent",
  command: { type: "call" },
};

class FakeClock implements FreezableDelayHost {
  private nowMs = 0;
  private nextId = 1;
  private scheduled = new Map<number, { at: number; callback: () => void }>();

  now() {
    return this.nowMs;
  }

  schedule(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.scheduled.set(id, { at: this.nowMs + ms, callback });
    return id;
  }

  cancel(handle: unknown) {
    this.scheduled.delete(handle as number);
  }

  advance(ms: number) {
    const target = this.nowMs + ms;
    while (true) {
      const next = [...this.scheduled.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.scheduled.delete(next[0]);
      this.nowMs = next[1].at;
      next[1].callback();
    }
    this.nowMs = target;
  }
}

describe("tournament presentation clock", () => {
  it("uses a deterministic rate without feeding presentation speed into the engine", () => {
    const full = presentationEventDelayMs(actionEvent, 1, {
      reducedMotion: false,
      transitionMotion: "full",
    });
    expect(full).toBe(980);
    expect(
      presentationEventDelayMs(actionEvent, 2, {
        reducedMotion: false,
        transitionMotion: "full",
      }),
    ).toBe(490);
    expect(
      presentationEventDelayMs(actionEvent, 1, {
        reducedMotion: true,
        transitionMotion: "full",
      }),
    ).toBe(441);
  });

  it("runs an all-in board out more slowly than a live betting street", () => {
    const boardEvent: TournamentPresentationEvent = {
      id: "9:hand-4:board-card-dealt:3",
      kind: "board-card-dealt",
      handId: "hand-4",
      street: "turn",
      cardIndex: 3,
      card: { rank: "9", suit: "clubs" },
    };
    const settings = { reducedMotion: false, transitionMotion: "full" } as const;

    const live = presentationEventDelayMs(boardEvent, 1, settings);
    const runout = presentationEventDelayMs(boardEvent, 1, settings, {
      allInRunout: true,
    });
    expect(live).toBe(520);
    expect(runout).toBe(1_250);
    expect(runout).toBeGreaterThan(live);

    // The reveal itself gets its own beat, long enough to read the hands and
    // the first equity figures before the next card lands.
    const reveal: TournamentPresentationEvent = {
      id: "9:hand-4:all-in-reveal:0",
      kind: "all-in-reveal",
      handId: "hand-4",
      playerIds: ["hero", "villain"],
      reveals: [],
    };
    expect(presentationEventDelayMs(reveal, 1, settings)).toBe(1_500);

    // Speed and the motion policy still scale the runout; it is a longer beat,
    // not an unskippable one.
    expect(
      presentationEventDelayMs(boardEvent, 4, settings, { allInRunout: true }),
    ).toBe(313);
    expect(
      presentationEventDelayMs(
        boardEvent,
        1,
        { reducedMotion: true, transitionMotion: "off" },
        { allInRunout: true },
      ),
    ).toBe(563);
  });

  /*
    E27-003. Speed and reduced motion scale motion; they must not scale reading.
    At the old 1,100 ms base with no floor, a reduced-motion player at 2x was
    given 1_100 * 0.45 / 2 = 247 ms to read who had won and with what -- the
    reported quarter-second flash, measured in the packaged build as a result
    that appeared and was replaced within one second.
  */
  describe("the outcome stays readable at every speed and motion setting", () => {
    const resultKinds = [
      {
        id: "1:hand-1:showdown:0",
        kind: "showdown",
        handId: "hand-1",
        awards: [],
        reveals: [],
      },
      {
        id: "1:hand-1:hand-result:0",
        kind: "hand-result",
        handId: "hand-1",
        awards: [],
      },
      {
        id: "1:hand-1:pot-awarded:0",
        kind: "pot-awarded",
        handId: "hand-1",
        potId: "main",
        amount: 100,
        playerIds: ["hero"],
      },
    ] as unknown as TournamentPresentationEvent[];

    it("never drops a result below the readable floor, however it is compressed", () => {
      for (const event of resultKinds) {
        for (const speed of [1, 2, 4, 8]) {
          for (const settings of [
            { reducedMotion: false, transitionMotion: "full" } as const,
            { reducedMotion: false, transitionMotion: "reduced" } as const,
            { reducedMotion: true, transitionMotion: "off" } as const,
          ]) {
            expect(
              presentationEventDelayMs(event, speed, settings),
            ).toBeGreaterThanOrEqual(1_200);
          }
        }
      }
    });

    it("gives the exact case that failed at least a second and a fifth", () => {
      const showdown = resultKinds[0];
      // Reduced motion at 2x: 247 ms before the floor existed.
      expect(
        presentationEventDelayMs(showdown, 2, {
          reducedMotion: true,
          transitionMotion: "full",
        }),
      ).toBe(1_200);
    });

    it("leaves ordinary milestones as responsive as they were", () => {
      // The floor is for outcomes, not for everything: an action at 4x is still
      // brisk, and reduced motion still shortens it.
      expect(
        presentationEventDelayMs(actionEvent, 4, {
          reducedMotion: false,
          transitionMotion: "full",
        }),
      ).toBe(245);
    });
  });

  it("freezes the exact remaining queue-item duration and completes only once", () => {
    const clock = new FakeClock();
    let completions = 0;
    const delay = createPresentationEventDelay(
      clock,
      actionEvent,
      1,
      { reducedMotion: false, transitionMotion: "full" },
      () => (completions += 1),
    );
    clock.advance(400);
    delay.freeze();
    clock.advance(5_000);
    expect(completions).toBe(0);
    delay.resume();
    clock.advance(579);
    expect(completions).toBe(0);
    clock.advance(1);
    expect(completions).toBe(1);
    delay.finish();
    expect(completions).toBe(1);
  });
});
