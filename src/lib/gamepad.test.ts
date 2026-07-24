import { describe, expect, it } from "vitest";
import {
  createGamepadPollState,
  GAMEPAD_BUTTON,
  readGamepadIntents,
  snapshotGamepads,
  type GamepadSnapshot,
} from "./gamepad";

function snapshot(
  partial: Partial<GamepadSnapshot> & { timestampMs: number },
): GamepadSnapshot {
  return {
    buttons: partial.buttons ?? [],
    axes: partial.axes ?? [0, 0],
    timestampMs: partial.timestampMs,
  };
}

function buttons(...pressedIndices: number[]): boolean[] {
  const result = new Array<boolean>(16).fill(false);
  for (const index of pressedIndices) result[index] = true;
  return result;
}

describe("readGamepadIntents — buttons", () => {
  it("fires a button token once on the press edge", () => {
    const state = createGamepadPollState();
    const first = readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.A), timestampMs: 0 }),
    );
    expect(first).toContainEqual({ buttonToken: "button:0" });
    // Still held next frame → no repeat for discrete buttons.
    const second = readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.A), timestampMs: 16 }),
    );
    expect(second).toEqual([]);
  });

  it("re-fires only after a release then press", () => {
    const state = createGamepadPollState();
    readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.B), timestampMs: 0 }),
    );
    readGamepadIntents(state, snapshot({ buttons: buttons(), timestampMs: 16 }));
    const again = readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.B), timestampMs: 32 }),
    );
    expect(again).toContainEqual({ buttonToken: "button:1" });
  });

  it("does not emit d-pad buttons as discrete tokens", () => {
    const state = createGamepadPollState();
    const intents = readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.DPAD_UP), timestampMs: 0 }),
    );
    expect(intents.some((intent) => intent.buttonToken)).toBe(false);
    expect(intents).toContainEqual({ direction: "up" });
  });
});

describe("readGamepadIntents — directions", () => {
  it("fires a d-pad direction immediately, then repeats after the delay", () => {
    const state = createGamepadPollState();
    const held = buttons(GAMEPAD_BUTTON.DPAD_DOWN);
    expect(
      readGamepadIntents(state, snapshot({ buttons: held, timestampMs: 0 })),
    ).toContainEqual({ direction: "down" });
    // Too soon → no repeat.
    expect(
      readGamepadIntents(state, snapshot({ buttons: held, timestampMs: 100 })),
    ).toEqual([]);
    // Past the repeat delay → repeat fires.
    expect(
      readGamepadIntents(state, snapshot({ buttons: held, timestampMs: 500 })),
    ).toContainEqual({ direction: "down" });
  });

  it("reads the left stick past the deadzone as a direction", () => {
    const state = createGamepadPollState();
    expect(
      readGamepadIntents(
        state,
        snapshot({ axes: [0.9, 0], timestampMs: 0 }),
      ),
    ).toContainEqual({ direction: "right" });
  });

  it("ignores stick movement inside the deadzone", () => {
    const state = createGamepadPollState();
    expect(
      readGamepadIntents(state, snapshot({ axes: [0.2, 0.1], timestampMs: 0 })),
    ).toEqual([]);
  });

  it("re-fires immediately when the direction changes", () => {
    const state = createGamepadPollState();
    readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.DPAD_UP), timestampMs: 0 }),
    );
    const changed = readGamepadIntents(
      state,
      snapshot({ buttons: buttons(GAMEPAD_BUTTON.DPAD_LEFT), timestampMs: 20 }),
    );
    expect(changed).toContainEqual({ direction: "left" });
  });
});

describe("snapshotGamepads", () => {
  it("returns the first connected pad as a snapshot", () => {
    const fakePad = {
      buttons: [{ pressed: true }, { pressed: false }],
      axes: [0.1, -0.2],
    } as unknown as Gamepad;
    const result = snapshotGamepads(() => [null, fakePad], 123);
    expect(result).toEqual({
      buttons: [true, false],
      axes: [0.1, -0.2],
      timestampMs: 123,
    });
  });

  it("returns null when nothing is connected", () => {
    expect(snapshotGamepads(() => [null, null], 0)).toBeNull();
  });
});
