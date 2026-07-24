import type { AudioFocusEvent } from "./audioFocusPolicy";

/**
 * Maps an Electron lifecycle signal (delivered through the narrow preload
 * bridge) to the deterministic audio-focus policy event it should drive.
 *
 * Screen lock is treated as an audio interruption rather than a suspend so the
 * two blockers stay independent: unlocking must not clear a still-active
 * Windows suspend, and vice versa.
 */
export function audioFocusEventForLifecycle(
  event: DesktopLifecycleEvent,
): AudioFocusEvent | undefined {
  switch (event.kind) {
    case "window-focus":
      return { type: "window-focus", focused: event.focused };
    case "system-suspend":
      return { type: "system-suspend", suspended: event.suspended };
    case "screen-lock":
      return { type: "audio-interruption", interrupted: event.locked };
    case "window-minimized":
      // A minimized window is not visible; a restore alone must not resume
      // audio (the explicit Ready gesture still has to clear it).
      return { type: "document-visibility", visible: !event.minimized };
    case "session-end":
    case "before-quit":
      return undefined;
  }
}
