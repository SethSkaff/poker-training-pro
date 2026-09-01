/**
 * Public award fields needed to classify the outcome of a resolved hand.
 * Keeping this small makes it safe to use from both visual and live-region
 * presentation code without pulling engine state into either layer.
 */
export interface PublicPotAwardRecipient {
  readonly potId: string;
  readonly playerId: string;
}

/**
 * A push is a genuinely split hand, not merely a result with multiple award
 * rows. Every contestable pot must have more than one distinct recipient;
 * otherwise a side-pot hand with different winners is still a win, not a
 * push.
 */
export function isPushAwardSet(
  awards: readonly PublicPotAwardRecipient[],
): boolean {
  const recipientsByPot = new Map<string, Set<string>>();
  for (const award of awards) {
    const recipients = recipientsByPot.get(award.potId) ?? new Set<string>();
    recipients.add(award.playerId);
    recipientsByPot.set(award.potId, recipients);
  }
  return (
    recipientsByPot.size > 0 &&
    [...recipientsByPot.values()].every((recipients) => recipients.size > 1)
  );
}
