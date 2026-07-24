/**
 * Most-recent input-device tracking.
 *
 * Controller button prompts should appear only when the player is actually
 * using a controller — showing them for a mouse/keyboard user is noise. This
 * module records which device produced the most recent input and notifies
 * subscribers on change. The React hook wraps it; the pure reducer is exported
 * for testing.
 */

export type InputDevice = "keyboard" | "pointer" | "gamepad";

export interface InputDeviceTransition {
  device: InputDevice;
  changed: boolean;
}

/**
 * Given the current device and a new signal, decide the next device. Pure so
 * the debounce/priority rules are testable. Any signal simply becomes the most
 * recent device; the `changed` flag tells callers whether to re-render prompts.
 */
export function reduceInputDevice(
  current: InputDevice,
  signal: InputDevice,
): InputDeviceTransition {
  return { device: signal, changed: current !== signal };
}

let currentDevice: InputDevice = "pointer";
const listeners = new Set<(device: InputDevice) => void>();

export function getInputDevice(): InputDevice {
  return currentDevice;
}

export function noteInputDevice(signal: InputDevice): void {
  const { device, changed } = reduceInputDevice(currentDevice, signal);
  if (!changed) return;
  currentDevice = device;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.inputDevice = device;
  }
  for (const listener of [...listeners]) listener(device);
}

export function subscribeInputDevice(
  listener: (device: InputDevice) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
