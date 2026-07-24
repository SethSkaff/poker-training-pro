/**
 * Pure focus-navigation and focus-trap math.
 *
 * The DOM glue (querying focusable elements, calling `.focus()`) lives in the
 * `useModalFocusTrap` hook and the gamepad navigation provider. Keeping the
 * index arithmetic here means the wraparound-trap contract and controller
 * focus movement can be unit-tested deterministically without a real DOM.
 */

/** CSS selector for elements that can receive keyboard focus inside a dialog. */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Given the focusable count, the index of the currently focused element, and
 * whether Shift is held, return the index that a Tab press should move focus to
 * — but only when the default browser behaviour would escape the trap. Returns
 * `null` when the browser's own Tab handling already keeps focus inside, and
 * `"container"` when there is nothing focusable and focus should fall back to
 * the dialog container.
 */
export function computeTrapTarget(
  focusableCount: number,
  currentIndex: number,
  shift: boolean,
): number | "container" | null {
  if (focusableCount <= 0) return "container";
  const first = 0;
  const last = focusableCount - 1;
  if (shift && currentIndex === first) return last;
  if (!shift && currentIndex === last) return first;
  // Focus is not tracked inside the trap (e.g. it escaped): pull it back to an
  // edge so the wraparound stays closed.
  if (currentIndex < 0) return shift ? last : first;
  return null;
}

/**
 * Wrap an index by `delta` within `count` items. Used for controller d-pad
 * focus movement, which wraps around the ends of a menu.
 */
export function wrapIndex(
  currentIndex: number,
  count: number,
  delta: number,
): number {
  if (count <= 0) return 0;
  const start = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex;
  return (((start + delta) % count) + count) % count;
}

/** A minimal range-input shape for slider adjustment math. */
export interface RangeLike {
  value: number;
  min: number;
  max: number;
  step: number;
}

/**
 * Adjust a range control by one step in `direction`, clamped to its bounds.
 * Returns the same value when already at the relevant bound so callers can skip
 * a no-op change event.
 */
export function adjustRangeValue(
  range: RangeLike,
  direction: "left" | "right",
): number {
  const step = range.step > 0 ? range.step : 1;
  const delta = direction === "right" ? step : -step;
  const next = range.value + delta;
  return Math.min(range.max, Math.max(range.min, next));
}
