export interface RaiseSliderBounds {
  /** Minimum legal total committed amount after the raise. */
  readonly minimumRaiseTo: number;
  /** Total committed amount after moving the player's remaining stack in. */
  readonly allInTo: number;
  readonly chipStep: number;
}

/**
 * Snap a continuous range input back onto the table's chip increment while
 * preserving the exact all-in endpoint. `allInTo` can be off the ordinary
 * step grid when the player already has chips committed this street.
 */
export function snapRaiseSliderToAmount(
  rawRaiseTo: number,
  { minimumRaiseTo, allInTo, chipStep }: RaiseSliderBounds,
): number {
  const minimum = Math.min(minimumRaiseTo, allInTo);
  const maximum = Math.max(minimumRaiseTo, allInTo);
  if (!Number.isFinite(rawRaiseTo)) return minimum;
  if (rawRaiseTo <= minimum) return minimum;
  // The native range emits its exact maximum at the right edge. Preserve it
  // before step snapping so an irregular final partial increment remains a
  // reachable, visually complete all-in.
  if (rawRaiseTo >= maximum) return maximum;

  const step = Number.isFinite(chipStep) && chipStep > 0 ? chipStep : 1;
  const snapped = minimum + Math.round((rawRaiseTo - minimum) / step) * step;
  return Math.max(minimum, Math.min(maximum, snapped));
}
