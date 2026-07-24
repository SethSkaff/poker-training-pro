/**
 * Pure Gamepad API helpers.
 *
 * The browser Gamepad API is poll-based: there are no button events, only a
 * snapshot read each frame. This module turns two consecutive snapshots into a
 * set of discrete, edge-triggered "intents" (a button was just pressed, or a
 * stick was pushed past a threshold in a direction) with autorepeat for held
 * directions. All of it is pure so the navigation behaviour is unit-testable
 * without real hardware or a DOM; the thin polling loop lives in the React
 * provider and feeds these functions.
 */

/** Standard-mapping button indices we care about. */
export const GAMEPAD_BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export type NavDirection = "up" | "down" | "left" | "right";

/** A minimal, serializable snapshot of a single gamepad. */
export interface GamepadSnapshot {
  /** Pressed state per button index. */
  buttons: boolean[];
  /** Axis values in [-1, 1]; index 0/1 = left stick x/y. */
  axes: number[];
  /** Monotonic timestamp (ms) the snapshot was read. */
  timestampMs: number;
}

/**
 * Persistent state carried between polls. Holds which buttons were down last
 * frame (for edge detection) and per-direction repeat bookkeeping.
 */
export interface GamepadPollState {
  buttonsDown: boolean[];
  /** Direction currently held, or null. */
  heldDirection: NavDirection | null;
  /** Timestamp the current direction hold began. */
  directionStartedMs: number;
  /** Timestamp the last direction repeat fired. */
  lastRepeatMs: number;
}

export function createGamepadPollState(): GamepadPollState {
  return {
    buttonsDown: [],
    heldDirection: null,
    directionStartedMs: 0,
    lastRepeatMs: 0,
  };
}

export interface GamepadIntent {
  /** A button token, e.g. "button:0", when a button was just pressed. */
  buttonToken?: string;
  /** A navigation direction (from d-pad or stick), when one should fire. */
  direction?: NavDirection;
}

export interface GamepadReadOptions {
  /** Stick magnitude past which a direction is considered active. */
  deadzone?: number;
  /** Delay before a held direction begins auto-repeating. */
  repeatDelayMs?: number;
  /** Interval between auto-repeats while a direction stays held. */
  repeatIntervalMs?: number;
}

const DEFAULT_DEADZONE = 0.55;
const DEFAULT_REPEAT_DELAY = 420;
const DEFAULT_REPEAT_INTERVAL = 140;

function directionFromSnapshot(
  snapshot: GamepadSnapshot,
  deadzone: number,
): NavDirection | null {
  const buttons = snapshot.buttons;
  if (buttons[GAMEPAD_BUTTON.DPAD_UP]) return "up";
  if (buttons[GAMEPAD_BUTTON.DPAD_DOWN]) return "down";
  if (buttons[GAMEPAD_BUTTON.DPAD_LEFT]) return "left";
  if (buttons[GAMEPAD_BUTTON.DPAD_RIGHT]) return "right";
  const x = snapshot.axes[0] ?? 0;
  const y = snapshot.axes[1] ?? 0;
  if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

/** Buttons that participate in navigation as directions, not discrete tokens. */
const DIRECTION_BUTTONS: ReadonlySet<number> = new Set([
  GAMEPAD_BUTTON.DPAD_UP,
  GAMEPAD_BUTTON.DPAD_DOWN,
  GAMEPAD_BUTTON.DPAD_LEFT,
  GAMEPAD_BUTTON.DPAD_RIGHT,
]);

/**
 * Compare the previous poll state with the newest snapshot and return the
 * discrete intents that should fire this frame. Mutates and returns the passed
 * `state` so the caller can carry it forward across frames.
 *
 * - Non-direction buttons fire once on the press edge (`button:N`).
 * - Directions (d-pad or stick) fire once immediately, then auto-repeat while
 *   held after `repeatDelayMs`, every `repeatIntervalMs`.
 */
export function readGamepadIntents(
  state: GamepadPollState,
  snapshot: GamepadSnapshot,
  options: GamepadReadOptions = {},
): GamepadIntent[] {
  const deadzone = options.deadzone ?? DEFAULT_DEADZONE;
  const repeatDelayMs = options.repeatDelayMs ?? DEFAULT_REPEAT_DELAY;
  const repeatIntervalMs = options.repeatIntervalMs ?? DEFAULT_REPEAT_INTERVAL;
  const intents: GamepadIntent[] = [];

  // Discrete button presses (edge-triggered), excluding the d-pad directions.
  for (let index = 0; index < snapshot.buttons.length; index += 1) {
    if (DIRECTION_BUTTONS.has(index)) continue;
    const pressed = snapshot.buttons[index] === true;
    const wasPressed = state.buttonsDown[index] === true;
    if (pressed && !wasPressed) {
      intents.push({ buttonToken: `button:${index}` });
    }
  }
  state.buttonsDown = snapshot.buttons.slice();

  // Directional navigation with autorepeat.
  const direction = directionFromSnapshot(snapshot, deadzone);
  if (direction === null) {
    state.heldDirection = null;
  } else if (state.heldDirection !== direction) {
    // New direction: fire immediately and start the repeat clock.
    state.heldDirection = direction;
    state.directionStartedMs = snapshot.timestampMs;
    state.lastRepeatMs = snapshot.timestampMs;
    intents.push({ direction });
  } else {
    // Same direction held: fire on the repeat cadence.
    const heldFor = snapshot.timestampMs - state.directionStartedMs;
    if (
      heldFor >= repeatDelayMs &&
      snapshot.timestampMs - state.lastRepeatMs >= repeatIntervalMs
    ) {
      state.lastRepeatMs = snapshot.timestampMs;
      intents.push({ direction });
    }
  }

  return intents;
}

/** Read the connected gamepads into snapshots (browser-side helper). */
export function snapshotGamepads(
  getGamepads: () => (Gamepad | null)[],
  timestampMs: number,
): GamepadSnapshot | null {
  const pads = getGamepads();
  for (const pad of pads) {
    if (!pad) continue;
    return {
      buttons: pad.buttons.map((button) => button.pressed),
      axes: pad.axes.slice(),
      timestampMs,
    };
  }
  return null;
}
