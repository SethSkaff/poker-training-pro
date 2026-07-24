import { describe, expect, it } from "vitest";
import {
  advancePlayableTutorial,
  createPlayableTutorial,
  TUTORIAL_MAX_BET,
  TUTORIAL_MIN_BET,
  TUTORIAL_STEP_ORDER,
  type PlayableTutorialCommand,
  type PlayableTutorialState,
} from "./playableTutorial";

function run(
  commands: PlayableTutorialCommand[],
  from: PlayableTutorialState = createPlayableTutorial(),
): PlayableTutorialState {
  return commands.reduce(advancePlayableTutorial, from);
}

describe("playable tutorial state machine", () => {
  it("starts on the card-peek lesson with unscored defaults", () => {
    const state = createPlayableTutorial();
    expect(state.step).toBe("peek");
    expect(state.cardsPeeked).toBe(false);
    expect(state.betSize).toBe(TUTORIAL_MIN_BET);
    expect(state.runoutCards).toBe(0);
    expect(state.presentationSpeed).toBe(1);
  });

  it("teaches every required lesson in order through to completion", () => {
    const state = run([
      { type: "peek" },
      { type: "choose-action", action: "check" },
      { type: "set-bet", amount: 600 },
      { type: "confirm-bet" },
      { type: "wait-for-card" },
      { type: "wait-for-card" },
      { type: "continue-math" },
      { type: "set-speed", speed: 2 },
    ]);
    expect(state.step).toBe("complete");
    expect(state.cardsPeeked).toBe(true);
    expect(state.betSize).toBe(600);
    expect(state.runoutCards).toBe(2);
    expect(state.presentationSpeed).toBe(2);
  });

  it("covers each pedagogical step exactly once in the canonical order", () => {
    // peek, legal-action, bet-sizing, showdown (hand flow), math (chips vs
    // pot odds vs equity vs EV), speed, complete.
    expect(TUTORIAL_STEP_ORDER).toEqual([
      "peek",
      "legal-action",
      "bet-sizing",
      "showdown",
      "math",
      "speed",
      "complete",
    ]);
  });

  it("ignores commands that are illegal for the current lesson", () => {
    // Cannot size a bet before peeking and choosing the legal action.
    const early = advancePlayableTutorial(createPlayableTutorial(), {
      type: "set-bet",
      amount: 800,
    });
    expect(early.step).toBe("peek");
    expect(early.betSize).toBe(TUTORIAL_MIN_BET);

    // The only legal action in this beat is check; fold/raise do nothing.
    const afterPeek = run([{ type: "peek" }]);
    const illegalFold = advancePlayableTutorial(afterPeek, {
      type: "choose-action",
      action: "fold",
    });
    expect(illegalFold.step).toBe("legal-action");
  });

  it("clamps and snaps the bet size to legal increments", () => {
    const base = run([{ type: "peek" }, { type: "choose-action", action: "check" }]);
    expect(advancePlayableTutorial(base, { type: "set-bet", amount: 50 }).betSize).toBe(
      TUTORIAL_MIN_BET,
    );
    expect(
      advancePlayableTutorial(base, { type: "set-bet", amount: 99999 }).betSize,
    ).toBe(TUTORIAL_MAX_BET);
    expect(
      advancePlayableTutorial(base, { type: "set-bet", amount: 643 }).betSize,
    ).toBe(600);
  });

  it("deals the runout one card at a time before reaching the math lesson", () => {
    const afterBet = run([
      { type: "peek" },
      { type: "choose-action", action: "check" },
      { type: "confirm-bet" },
    ]);
    expect(afterBet.step).toBe("showdown");

    const oneCard = advancePlayableTutorial(afterBet, { type: "wait-for-card" });
    expect(oneCard.runoutCards).toBe(1);
    expect(oneCard.step).toBe("showdown");

    const twoCards = advancePlayableTutorial(oneCard, { type: "wait-for-card" });
    expect(twoCards.runoutCards).toBe(2);
    expect(twoCards.step).toBe("math");
  });

  it("keeps the speed lesson open until the pace actually changes", () => {
    const atSpeed = run([
      { type: "peek" },
      { type: "choose-action", action: "check" },
      { type: "confirm-bet" },
      { type: "wait-for-card" },
      { type: "wait-for-card" },
      { type: "continue-math" },
    ]);
    expect(atSpeed.step).toBe("speed");

    // Leaving the slider at 1x does not complete the lesson.
    const unchanged = advancePlayableTutorial(atSpeed, {
      type: "set-speed",
      speed: 1,
    });
    expect(unchanged.step).toBe("speed");

    const changed = advancePlayableTutorial(atSpeed, {
      type: "set-speed",
      speed: 1.5,
    });
    expect(changed.step).toBe("complete");
  });

  it("restarts to a clean first lesson from any point", () => {
    const mid = run([
      { type: "peek" },
      { type: "choose-action", action: "check" },
      { type: "set-bet", amount: 800 },
    ]);
    const restarted = advancePlayableTutorial(mid, { type: "restart" });
    expect(restarted).toEqual(createPlayableTutorial());
  });
});
