import { describe, expect, it } from "vitest";
import { audioFocusEventForLifecycle } from "./desktopAudioFocus";
import {
  AudioFocusController,
  type AudioFocusEffectTarget,
} from "./audioFocusPolicy";

describe("audioFocusEventForLifecycle", () => {
  it("maps focus, suspend, lock, and minimize to distinct policy events", () => {
    expect(
      audioFocusEventForLifecycle({ kind: "window-focus", focused: false }),
    ).toEqual({ type: "window-focus", focused: false });
    expect(
      audioFocusEventForLifecycle({ kind: "system-suspend", suspended: true }),
    ).toEqual({ type: "system-suspend", suspended: true });
    expect(
      audioFocusEventForLifecycle({ kind: "screen-lock", locked: true }),
    ).toEqual({ type: "audio-interruption", interrupted: true });
    expect(
      audioFocusEventForLifecycle({
        kind: "window-minimized",
        minimized: true,
      }),
    ).toEqual({ type: "document-visibility", visible: false });
  });

  it("does not produce an audio event for save-only lifecycle signals", () => {
    expect(
      audioFocusEventForLifecycle({ kind: "session-end" }),
    ).toBeUndefined();
    expect(
      audioFocusEventForLifecycle({ kind: "before-quit" }),
    ).toBeUndefined();
  });

  it("keeps suspend and lock independent through the controller", () => {
    const muteCalls: boolean[] = [];
    const target: AudioFocusEffectTarget = {
      setFocusMuted: (muted) => muteCalls.push(muted),
    };
    const controller = new AudioFocusController(target);
    controller.dispatch({ type: "user-activated" });
    expect(controller.state.canPlay).toBe(true);

    controller.dispatch(
      audioFocusEventForLifecycle({ kind: "system-suspend", suspended: true })!,
    );
    controller.dispatch(
      audioFocusEventForLifecycle({ kind: "screen-lock", locked: true })!,
    );
    expect(controller.state.canPlay).toBe(false);

    // Unlocking must not clear the still-active suspend blocker.
    controller.dispatch(
      audioFocusEventForLifecycle({ kind: "screen-lock", locked: false })!,
    );
    expect(controller.state.blockers).toContain("system-suspended");
    expect(controller.state.canPlay).toBe(false);

    controller.dispatch(
      audioFocusEventForLifecycle({
        kind: "system-suspend",
        suspended: false,
      })!,
    );
    // Every blocker cleared, but audio stays silent until an explicit Ready.
    expect(controller.state.readiness).toBe("needs-ready-confirmation");
    expect(controller.state.canPlay).toBe(false);

    controller.dispatch({ type: "ready-confirmed" });
    expect(controller.state.canPlay).toBe(true);
  });
});
