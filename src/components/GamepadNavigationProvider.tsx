import { useEffect, useState } from "react";
import {
  resolveBindings,
  resolveGamepadAction,
  type ActionContext,
  type ControlBindingOverrides,
} from "../lib/actionMap";
import {
  adjustRangeValue,
  FOCUSABLE_SELECTOR,
  wrapIndex,
} from "../lib/focusNavigation";
import {
  createGamepadPollState,
  readGamepadIntents,
  snapshotGamepads,
  type NavDirection,
} from "../lib/gamepad";
import {
  getInputDevice,
  noteInputDevice,
  subscribeInputDevice,
  type InputDevice,
} from "../lib/inputDevice";
import { isInputCaptureActive } from "../lib/inputCaptureGate";
import { createVisibilityAwareAnimationLoop } from "../lib/visibilityWorkGate";

/** Fired on `window` when a controller triggers a game-context action. */
export const GAME_ACTION_EVENT = "ptp:gameaction";

export interface GameActionEventDetail {
  actionId: string;
}

/**
 * Detect the active navigation context from the DOM so the same controller
 * button can drive the table in game context and menus/dialogs in menu context.
 * Any open modal dialog (pause, bet composer, remap capture, hand history)
 * takes precedence and switches to menu navigation.
 */
function detectContext(): ActionContext {
  const modal = document.querySelector(
    '[role="dialog"][aria-modal="true"], .pause-scrim, [data-modal-open="true"]',
  );
  if (modal) return "menu";
  if (document.querySelector(".table-screen")) return "game";
  return "menu";
}

function visibleFocusables(): HTMLElement[] {
  const root = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-modal="true"], .pause-scrim, [data-modal-open="true"]',
  );
  const scope: ParentNode = root ?? document;
  return Array.from(
    scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.hidden) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function isRangeInput(element: Element | null): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement && element.type === "range"
  );
}

/** Set a range input value the way React expects, then notify listeners. */
function setRangeValue(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function moveFocus(delta: number): void {
  const focusables = visibleFocusables();
  if (focusables.length === 0) return;
  const currentIndex = focusables.indexOf(
    document.activeElement as HTMLElement,
  );
  const nextIndex = wrapIndex(currentIndex, focusables.length, delta);
  focusables[nextIndex]?.focus();
}

function handleDirection(direction: NavDirection): void {
  const active = document.activeElement;
  if ((direction === "left" || direction === "right") && isRangeInput(active)) {
    const next = adjustRangeValue(
      {
        value: Number(active.value),
        min: Number(active.min || "0"),
        max: Number(active.max || "100"),
        step: Number(active.step || "1"),
      },
      direction,
    );
    if (next !== Number(active.value)) setRangeValue(active, next);
    return;
  }
  if (direction === "up" || direction === "left") moveFocus(-1);
  else moveFocus(1);
}

function dispatchEscape(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

interface GamepadNavigationProviderProps {
  controlBindings?: ControlBindingOverrides;
}

/**
 * Effect body shared by the component and the direct hook. Runs a
 * visibility-aware polling loop (so it stops while hidden/minimized), converts
 * controller input into focus navigation for menus/dialogs/sliders and into
 * game actions at the table, and records that a gamepad is the most recent
 * input device so button prompts can appear contextually. Keyboard-only
 * operation is untouched.
 */
export function useGamepadNavigation(
  controlBindings?: ControlBindingOverrides,
): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("getGamepads" in navigator)) {
      return;
    }
    const resolved = resolveBindings(controlBindings);
    const pollState = createGamepadPollState();
    let connectedCount = 0;

    const onConnect = () => {
      connectedCount += 1;
    };
    const onDisconnect = () => {
      connectedCount = Math.max(0, connectedCount - 1);
    };
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);

    const step = (timestamp: number) => {
      if (connectedCount === 0) return;
      // The remap capture dialog owns input exclusively while listening.
      if (isInputCaptureActive()) return;
      const snapshot = snapshotGamepads(
        () => Array.from(navigator.getGamepads?.() ?? []),
        timestamp,
      );
      if (!snapshot) return;
      const intents = readGamepadIntents(pollState, snapshot);
      if (intents.length === 0) return;
      noteInputDevice("gamepad");

      const context = detectContext();
      for (const intent of intents) {
        if (intent.direction) {
          if (context === "menu") {
            handleDirection(intent.direction);
          } else {
            // Game context: map d-pad directions through the action map too.
            const token =
              intent.direction === "left"
                ? "button:14"
                : intent.direction === "right"
                  ? "button:15"
                  : intent.direction === "up"
                    ? "button:12"
                    : "button:13";
            const actionId = resolveGamepadAction(resolved, "game", token);
            if (actionId) {
              window.dispatchEvent(
                new CustomEvent<GameActionEventDetail>(GAME_ACTION_EVENT, {
                  detail: { actionId },
                }),
              );
            }
          }
          continue;
        }
        if (!intent.buttonToken) continue;
        const actionId = resolveGamepadAction(
          resolved,
          context,
          intent.buttonToken,
        );
        if (!actionId) continue;
        if (actionId === "menu.activate") {
          (document.activeElement as HTMLElement | null)?.click();
        } else if (actionId === "menu.back") {
          dispatchEscape();
        } else {
          window.dispatchEvent(
            new CustomEvent<GameActionEventDetail>(GAME_ACTION_EVENT, {
              detail: { actionId },
            }),
          );
        }
      }
    };

    const loop = createVisibilityAwareAnimationLoop(step);
    return () => {
      loop.stop();
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, [controlBindings]);

  // Record pointer/keyboard usage so controller prompts hide again once the
  // player returns to mouse or keyboard.
  useEffect(() => {
    const onKey = () => noteInputDevice("keyboard");
    const onPointer = () => noteInputDevice("pointer");
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
}

/** Component form for callers that prefer mounting it in the tree. */
export function GamepadNavigationProvider({
  controlBindings,
}: GamepadNavigationProviderProps) {
  useGamepadNavigation(controlBindings);
  return null;
}

/** Subscribe to whether a gamepad is the most recent input device. */
export function useIsGamepadActive(): boolean {
  const [device, setDevice] = useState<InputDevice>(() => getInputDevice());
  useEffect(() => subscribeInputDevice(setDevice), []);
  return device === "gamepad";
}
