/**
 * First-run interactive play-chip disclosure gating.
 *
 * The static "Play chips only / No real-money wagering" copy already appears on
 * the start menu. This adds the one-time interactive acknowledgment that must be
 * shown and recorded before the first play session. It is deliberately a tiny,
 * pure surface so the gating is trivial to test.
 */

export interface PlayChipAcknowledgable {
  readonly playChipsAcknowledged?: boolean;
}

/** True until the player has acknowledged the play-chip disclosure once. */
export function needsPlayChipAcknowledgment(
  progress: PlayChipAcknowledgable,
): boolean {
  return progress.playChipsAcknowledged !== true;
}

/** Record the one-time acknowledgment; idempotent. */
export function acknowledgePlayChips<T extends PlayChipAcknowledgable>(
  progress: T,
): T {
  if (progress.playChipsAcknowledged === true) return progress;
  return { ...progress, playChipsAcknowledged: true };
}
