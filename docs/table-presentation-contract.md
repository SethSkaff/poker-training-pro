# Table Presentation Contract

The tournament engine is authoritative. It updates a public table snapshot
immediately after every legal action; presentation never delays, replays, or
modifies that state.

## Inclusive-pot convention

`scenario.pot` is the exact, authoritative total committed to the hand. It
includes a player's currently displayed street wager. The central numeric pot
and its compact chip-stack scale therefore always represent the whole pot,
including wagers that are still visibly parked at seats. A seat wager is a
ledger/readability marker, not a second physical inventory of chips.

This avoids a misleading intermediate number such as a centre pot that omits a
call which has already been accepted by the engine. The centre remains labeled
as the total pot while seat labels explicitly say **Committed**.

## Presentation beats

The public event queue adds visual explanation without changing the convention:

1. `action` (bet, raise, call, blind, or all-in): a transient chip token
   travels from that player's stack lane toward their committed-wager lane. The
   authoritative stack and inclusive total pot already match the snapshot.
2. `bets-collected`: a token travels from the committed lane to the central
   pot. The numeric pot does not jump because it already included that value.
3. `pot-awarded`: a token travels from the central pot to the public award
   recipient. The next authoritative snapshot contains the resulting stack.

The renderer owns only these transient tokens; it is safe to skip or reduce
their motion because it never derives chips from them. When motion is reduced,
the same public event label and updated amounts remain visible.

## Invariants

- Exact numeric amounts come from the engine, never animation deltas.
- The central pot's numeric amount equals the sum of committed chips in the
  current public state.
- Seat commitment, remaining stack, and total-hand commitment use distinct
  labels and lanes.
- No transient animation is persisted, exported, or used for replay.
- A presentation event is public-only and cannot reveal folded or hidden cards.
