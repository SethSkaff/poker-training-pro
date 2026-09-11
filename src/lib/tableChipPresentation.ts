import { buildPots } from "../engine/pots";
import { chipValue } from "../engine/chips";
import type { TrainingScenario } from "../types/poker";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import { payoutPresentation, type PresentationAward } from "./payoutPresentation";

export interface TableChipMemory {
  handId: string;
  streetKey: string;
  collected: boolean;
  settled: boolean;
  completedAwards: number;
}

/** Public display accounting only. The engine's inclusive pot and settlement are untouched. */
export function tableChipPresentation(
  scenario: TrainingScenario,
  event: TournamentPresentationEvent | undefined,
  progress: number,
  awards: readonly PresentationAward[],
  previous?: TableChipMemory,
) {
  const sameHand = previous?.handId === scenario.id;
  const streetKey = `${scenario.street}:${scenario.pot}:${scenario.players.map(p => `${p.id}:${p.bet}`).join(",")}`;
  const result = event && event.handId === scenario.id && ["showdown", "hand-result", "pot-awarded", "eliminated", "cards-collected"].includes(event.kind);
  const collecting = event?.kind === "bets-collected" && event.handId === scenario.id;
  const collected = Boolean(result || (collecting && progress >= .98) || (sameHand && previous.streetKey === streetKey && previous.collected));
  // Hold completed awards across event-less frames and the next hand's opening
  // beats. App intentionally retains the old snapshot until the new deal.
  const payout = payoutPresentation(awards, event?.handId === scenario.id ? event : undefined, progress, sameHand ? previous.completedAwards : 0);
  const settled = Boolean(result || (sameHand && previous.settled));
  // Use the same public contribution rules as settlement for uncalled returns.
  // Refunds are not winner awards and must not remain stranded in the pot.
  const settlement = settled ? buildPots(scenario.players.map(p => ({
    playerId: p.id, amount: p.totalCommitted ?? p.bet,
    folded: p.status === "folded", allIn: p.status === "all-in",
  }))) : undefined;
  const refunds = settlement?.refunds ?? [];
  const refunded = refunds.reduce((sum, refund) => sum + refund.amount, 0);
  const outstanding = scenario.players.reduce((sum, p) => sum + p.bet, 0);
  const gathered = collected ? scenario.pot - refunded : scenario.collectedChipInventory ? chipValue(scenario.collectedChipInventory) : Math.max(0, scenario.pot - outstanding);
  const memory: TableChipMemory = { handId: scenario.id, streetKey, collected, settled, completedAwards: payout.completedCount };
  return {
    memory,
    payout,
    gathered,
    settledPots: settlement?.pots,
    credit: (id: string) => payout.toPlayer(id) + refunds.filter(r => r.playerId === id).reduce((sum, r) => sum + r.amount, 0),
    pot: Math.max(0, gathered - payout.paid),
    bet: (amount: number) => collected ? 0 : amount,
    collectionProgress: collecting && !collected ? progress : undefined,
  };
}
