# Table Presentation Contract

The tournament engine owns legality, commitments, odds, refunds and settlement.
Presentation projects public snapshots and the ordered presentation event queue.

## Inclusive-pot convention

`scenario.pot` remains the authoritative inclusive hand total, including current
street bets. Evaluators and pot odds continue to use this value unchanged.

The 2D central pot displays **gathered chips only**, using
`scenario.collectedChipInventory`. Training snapshots without an inventory use
`pot - sum(street bets)`. Outstanding wagers are physical chips in front of each
seat, with their own labels. The persistent stack has a separate chip pile and
amount; the identity panel contains only the name.

## Presentation beats

- `bets-collected`: street piles move to the center. At completion their labels
  disappear and the central amount increases once. This state persists through
  subsequent board events until the next authoritative street snapshot.
- Result events collect any remaining wagers. Uncalled returns use the engine's
  public contribution rules and credit their owner separately from winner awards.
- `pot-awarded`: the ordered authoritative award ledger transfers each amount
  from its central pile to the recipient's stack. Completed award credits persist
  through event-less frames and the next hand's opening beats while App still
  holds the previous snapshot. They reset when the new hand snapshot arrives.

## Invariants

- No presentation value changes engine state or settlement.
- Outstanding bets and gathered chips are never counted twice on the 2D felt.
- Completed payouts cannot briefly reappear in the central pot or revert stacks.
- Split pots and refunds conserve the inclusive hand total.
- Presentation memory is local, transient and never persisted or exported.
- No event reveals hidden or folded private cards.
- The existing 3D renderer retains its own physical chip projection.
