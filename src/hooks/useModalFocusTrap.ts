import { useEffect, useRef, type RefObject } from "react";
import {
  computeTrapTarget,
  FOCUSABLE_SELECTOR,
} from "../lib/focusNavigation";

export interface ModalFocusTrapOptions {
  /** Whether the trap is currently owning focus. */
  active: boolean;
  /** The dialog container the trap is scoped to. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * When this value changes while the trap stays active, initial focus is
   * re-applied (for dialogs with internal subpages) without replacing the
   * original restore target captured when the trap first opened.
   */
  focusKey?: unknown;
  /**
   * Optional element to focus first. When omitted, the first focusable element
   * inside the container is used, falling back to the container itself.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Set false to skip restoring the pre-open focus on close. Defaults true. */
  restoreFocus?: boolean;
}

/**
 * The shared modal dialog focus contract, extracted from the pause dialog so
 * every modal behaves identically:
 *
 *  1. Initial focus lands inside the dialog when it opens.
 *  2. Tab / Shift+Tab wrap around, trapping focus inside the dialog.
 *  3. The exact element focused before opening is restored on close.
 *
 * Subpage navigation (via `focusKey`) re-runs step 1 without disturbing the
 * restoration target from step 3.
 */
export function useModalFocusTrap({
  active,
  containerRef,
  focusKey,
  initialFocusRef,
  restoreFocus = true,
}: ModalFocusTrapOptions): void {
  const restoreTargetRef = useRef<HTMLElement | null>(null);

  const focusablesRef = useRef<() => HTMLElement[]>(() => []);
  focusablesRef.current = () =>
    Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
        [],
    );

  // Capture the restore target + apply initial focus + install the Tab trap
  // when the dialog opens; restore focus when it closes.
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    restoreTargetRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusInitial = () => {
      const preferred = initialFocusRef?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      const focusables = focusablesRef.current();
      if (focusables.length > 0) focusables[0].focus();
      else container?.focus();
    };
    focusInitial();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = focusablesRef.current();
      const currentIndex = focusables.indexOf(
        document.activeElement as HTMLElement,
      );
      const target = computeTrapTarget(
        focusables.length,
        currentIndex,
        event.shiftKey,
      );
      if (target === null) return;
      event.preventDefault();
      if (target === "container") {
        container?.focus();
      } else {
        focusables[target]?.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      if (restoreFocus) restoreTargetRef.current?.focus();
      restoreTargetRef.current = null;
    };
    // restoreFocus/initialFocusRef are stable enough; re-running only on active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerRef]);

  // Re-apply initial focus on subpage changes without recapturing the restore
  // target. Deferred a frame so freshly rendered controls exist.
  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      focusablesRef.current()[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusKey]);
}
