/**
 * Global input-capture gate.
 *
 * While the remapping dialog is listening for the next key or gamepad button,
 * every global poker hotkey and menu shortcut must be suppressed so the capture
 * owns input exclusively (an extension of the existing while-typing
 * suppression). This tiny shared signal lets the capture dialog raise the gate
 * and the various keydown handlers consult it without prop-drilling.
 */

let captureActive = false;
const listeners = new Set<(active: boolean) => void>();

export function isInputCaptureActive(): boolean {
  return captureActive;
}

export function setInputCaptureActive(active: boolean): void {
  if (captureActive === active) return;
  captureActive = active;
  for (const listener of [...listeners]) listener(active);
}

export function subscribeInputCapture(
  listener: (active: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
