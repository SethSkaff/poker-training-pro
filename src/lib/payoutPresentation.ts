export interface PresentationAward {
  potId: string;
  playerId: string;
  amount: number;
}
/** Read-only projection of an authoritative ordered award ledger. */
export function payoutPresentation(
  awards: readonly PresentationAward[],
  event: { kind: string; awardIndex?: number } | undefined,
  progress: number,
) {
  const paying = event?.kind === "pot-awarded";
  const finished =
    event?.kind === "cards-collected" || event?.kind === "eliminated";
  const count = finished
    ? awards.length
    : paying
      ? (event.awardIndex ?? 0) + (progress >= 0.98 ? 1 : 0)
      : 0;
  const completed = awards.slice(0, count);
  return {
    paid: completed.reduce((sum, award) => sum + award.amount, 0),
    toPlayer: (playerId: string) =>
      completed
        .filter((a) => a.playerId === playerId)
        .reduce((sum, a) => sum + a.amount, 0),
    fromPot: (potId: string) =>
      completed
        .filter((a) => a.potId === potId)
        .reduce((sum, a) => sum + a.amount, 0),
    active:
      paying && progress < 0.98 ? awards[event.awardIndex ?? 0] : undefined,
  };
}
