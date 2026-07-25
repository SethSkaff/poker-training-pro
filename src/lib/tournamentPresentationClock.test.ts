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
