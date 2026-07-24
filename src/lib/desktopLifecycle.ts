import { useEffect, useRef } from "react";
import { gameAudio } from "./audio";
import { AudioFocusController } from "./audioFocusPolicy";
import { audioFocusEventForLifecycle } from "./desktopAudioFocus";
import { DelayFreezeGroup } from "./lifecyclePause";

/**
 * A freeze group for non-table surfaces (menus, room fly-through, results) that
 * freezes the exact remaining animation delays while the window is away (blur,
 * hidden, minimized, suspended, locked) and continues them from that remainder
 * when it returns. Unlike the table, there is no scored decision to protect, so
 * these surfaces resume automatically rather than requiring an explicit Ready.
 */
export function useAwayFreezeGroup(): DelayFreezeGroup {
  const groupRef = useRef<DelayFreezeGroup>(new DelayFreezeGroup());
  useEffect(() => {
    const group = groupRef.current;
    const away = () => group.freezeAll();
    const back = () => group.resumeAll();
    const onBlur = () => away();
    const onFocus = () => back();
    const onVisibility = () => (document.hidden ? away() : back());
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = window.desktop?.onLifecycleEvent?.((event) => {
      if (event.kind === "window-minimized") {
        event.minimized ? away() : back();
      } else if (event.kind === "system-suspend") {
        event.suspended ? away() : back();
      } else if (event.kind === "screen-lock") {
        event.locked ? away() : back();
      } else if (event.kind === "window-focus") {
        event.focused ? back() : away();
      }
    });
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
    };
  }, []);
  return groupRef.current;
}

/**
 * Commits a lifecycle save at every safe boundary the OS gives us (window
 * close, Windows session end, before-quit, and system suspend) and answers the
 * main process's pre-close question about unsaved scored progress so it can
 * confirm before the player loses it.
 *
 * Effect-only: no UI. The main process owns the confirmation dialog; this hook
 * only reports the boolean and flushes a save first.
 */
export function useDesktopSaveHandshake(options: {
  saveNow: () => void | Promise<unknown>;
  hasUnsavedScoredProgress: () => boolean;
}): void {
  const saveRef = useRef(options.saveNow);
  const unsavedRef = useRef(options.hasUnsavedScoredProgress);
  saveRef.current = options.saveNow;
  unsavedRef.current = options.hasUnsavedScoredProgress;

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    const unsubscribeClose = desktop.onPrepareClose?.((request) => {
      void (async () => {
        try {
          await saveRef.current();
        } catch {
          // A failed save still leaves a retryable pending commit; report it.
        }
        void request.report({
          hasUnsavedScoredProgress: unsavedRef.current(),
        });
      })();
    });
    const unsubscribeLifecycle = desktop.onLifecycleEvent?.((event) => {
      if (
        event.kind === "session-end" ||
        event.kind === "before-quit" ||
        (event.kind === "system-suspend" && event.suspended)
      ) {
        void saveRef.current();
      }
    });
    return () => {
      unsubscribeClose?.();
      unsubscribeLifecycle?.();
    };
  }, []);
}

/**
 * Wires the deterministic audio-focus controller to real DOM lifecycle events
 * and Electron `powerMonitor` signals for the non-table (menu, room fly-through,
 * results) surfaces. During table play `PokerTable` owns table-audio focus, so
 * this hook is disabled there to avoid two writers fighting over the same mute.
 *
 * The first user gesture after every blocker clears is the explicit Ready: the
 * policy only re-readies audio on `user-activated`/`ready-confirmed` once
 * nothing is blocking, so a bare refocus, restore, unlock, or resume never
 * un-mutes on its own.
 */
export function useAudioFocusLifecycle(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const controller = new AudioFocusController({
      setFocusMuted: (muted) => gameAudio.setFocusMuted(muted),
      suspendForLifecycle: () => gameAudio.suspendForLifecycle(),
      resumeAfterExplicitReady: () => gameAudio.resumeAfterExplicitReady(),
    });
    const activate = () => controller.dispatch({ type: "user-activated" });
    const onBlur = () =>
      controller.dispatch({ type: "window-focus", focused: false });
    const onFocus = () =>
      controller.dispatch({ type: "window-focus", focused: true });
    const onVisibility = () =>
      controller.dispatch({
        type: "document-visibility",
        visible: !document.hidden,
      });
    window.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", activate);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = window.desktop?.onLifecycleEvent?.((event) => {
      const mapped = audioFocusEventForLifecycle(event);
      if (mapped) controller.dispatch(mapped);
    });
    return () => {
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
      // Hand focus muting back to the table's own controller cleanly.
      gameAudio.setFocusMuted(false);
    };
  }, [enabled]);
}
