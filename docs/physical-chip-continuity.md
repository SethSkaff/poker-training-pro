# Physical chip continuity

## Architecture inspected

`engine/betting.ts` owns numeric stacks, street commitments, cumulative hand
commitments, legal wager targets, and round-local conservation. It intentionally
does not own the central pot. `engine/pots.ts` constructs monetary main/side pots,
identifies uncalled returns, evaluates winners, and distributes odd chips clockwise
from the button. `modes/tournamentSession.ts` posts blinds, synchronizes betting
stacks with tournament players, progresses streets, settles pots, and records
eliminations. Tournament sessions are blind-only; legacy ante fields are ignored.

Before this change, `scene3d/tableSceneModel.ts:chipInventoryForAmount` greedily
decomposed each scalar amount, with a special-case 15,000 opening rack.
`chipColumnLayoutForAmount` built columns from that decomposition.
`scene3d/tableScene.ts:setChipStack` used those columns for racks, wagers, and pots.
`setPotLanes` and payout interpolation also reconstructed chips from amounts.
`components/PokerTable.tsx:SeatChipStack` uses the scalar helper for the 2D display.
The previous wager choreography could select real-looking columns within a single
motion, but those columns did not belong to a persistent accounting inventory.

## Ownership and rules boundary

`TournamentSession.chips` is the authoritative physical ledger. It stores
denomination counts, not permanently identified individual chip objects:

- `player:<id>`: the remaining rack, equal to the player's numeric stack.
- `bet:<id>`: chips in the current street's betting area.
- `collected:<id>`: prior-street contributions held in the central pool, retaining
  contributor provenance for refunds and side-pot allocation.
- `pot:<id>`: exact main/side-pot inventories during settlement.
- `house`: a finite, separate dealer change reserve.

The monetary rules engine is unchanged. Session actions first use its legal
numeric result, then transfer the corresponding physical amount on a cloned
ledger. No random stream is consumed. Stacks and contributions are checked against
the physical accounts before and after each hand/action/street/settlement boundary.
No live ledger is silently repaired from a scalar balance.

Collected chips stay physically pooled while eligibility and side-pot amounts
continue to be calculated by `buildLivePots`. Settlement returns unmatched value
from the contributor's own account, allocates each player's capped contribution
to the existing pot layers, and pays the amounts from `resolvePots`. Each pot's
inventory before payout is retained in `lastHand.chipPots`; movement records also
retain any change made while dividing an award. Final live pot accounts are empty.
A single-winner payout transfers the entire existing pot inventory unchanged.

## Starting racks and dealer change

Inspection of `engine/tournament.ts` found 25-value wager increments, local
15,000 stacks opening at 25/50, regional 25,000 stacks opening at 50/75 followed by
75/125 and 75/175, and 60,000 championship stacks opening at 100/200.

Opening racks reserve 5,000 of working chips: 12 × 25, 12 × 100, and 7 × 500.
They add up to ten 1,000 chips, then use 5,000 chips for the remaining large value.
Thus a 25,000 rack is 43 chips: 12 × 25, 12 × 100, 7 × 500, 10 × 1,000, 2 × 5,000.
A 15,000 rack has 41 chips; a 60,000 rack has 50. Smaller test/custom opening
balances are represented exactly. The 1 and 5 denominations support integer
compatibility inputs; ordinary 25-unit sessions never need to introduce them.

An exact bounded selector prefers larger available denominations. If the source
cannot pay exactly, it exchanges the smallest useful larger chip for lower
denominations from the dealer bank. Both exchange legs are recorded with the same
exchange ID and equal value. Selection and exchange order are deterministic.
The bank is initialized with enough of each denomination to exchange the entire
field's value, and is excluded from playable tournament value. It cannot make a
one-way transfer into a pot or player account. All-in transfers move the complete
available inventory without requiring new chips. No automatic consolidation or
color-up occurs between hands.

## Public 3D interface

The viewer-safe table snapshot exposes `chipInventory`, `betChipInventory`,
`collectedChipInventory`, and `chipMovements`. Each movement has a monotonic
sequence, source/destination accounts, denomination counts, value, reason, and an
optional exchange ID. The enclosing session/snapshot supplies the hand identity.
Sequences continue across hands; the movement buffer is reset at the next hand.
Consumers should deduplicate by session identity and sequence. Movement records
carry no private cards, seed, policy evaluation, or strategic information.

The 3D snapshot adapter forwards these public fields. Resting racks and betting
piles use inventory columns directly. Rack footprint, marker placement, and label
placement accept the inventory too. The existing wager renderer accepts the actual
pre-transfer rack, including already-completed dealer change, and selects from
those columns using its existing motion. Geometry IDs remain temporary display
IDs, not game-engine chip identities. The collected pool is rendered once, with
monetary side-pot labels retaining their existing rules meaning.

This is not a Blender or animation redesign. Dealer change happens atomically;
there is no new bank-exchange animation. Collection/payout choreography and its
presentation timing are still legacy presentation effects; the movement interface
is available for a later complete animation integration. Static Training fixtures
and the 2D chip glyph retain their existing scalar fallback. The rules ledger is
shared by tournament modes regardless of which renderer is selected.

## Invariants and compatibility

Assertions enforce safe integer, non-negative quantities and values; exact rack,
bet, and cumulative contribution values; unchanged tournament and bank values;
and conservation of **each denomination's count across all accounts including the
bank**. Settlement additionally verifies each physical side pot against its rules
amount, awards against that pot, and empty contributions/pots after payout.

Persistent saves/replays store seeds and commands, not a serialized live session.
Reconstruction issues the starting inventory once and replays the same deterministic
transfers. No save migration or policy version change is necessary. A consumer that
constructs an in-memory session directly must also provide a valid ledger; scalar
test fixture edits must explicitly issue a matching fixture ledger before play.
There is no implicit migration of an already-running scalar-only hand.

Game Review and AI still receive the original scalar information-set contract.
Bet legality, sizing, strategy, hand evaluation, review judgments, and odd-chip
rules are untouched. Existing engine/session/replay/review tests and focused
physical-ledger, full-field soak, and 3D adapter tests cover these boundaries.

The generic transfer API supports an ante destination/reason, but this change does
not enable antes in blind-only tournaments. Rebuys, late entries, removals, and
scheduled color-ups have no new lifecycle operation; any future implementation
must explicitly extend the issue/removal or equal-value exchange contract.

## Closeout validation (2026-09-09)

- Poker engine, modes, evaluation, and 3D regression run: 609 tests passed across
  98 files. Evaluation type-checking and the production build passed.
- Packaged 3D audit unit tests: 46 passed. Physical pile checks count seated bets
  and collected chips exactly once. The triangle budget retains the previous
  scene allowance plus the measured geometry cost of additional retained chips;
  draw-call, frame-time, and texture limits are unchanged.
- Windows installer and portable executable built. The packaged 3D audit and
  license-sidecar audit passed against that build after updating the chip-count
  and triangle-budget contracts.
- The earlier full-suite run passed 1,509 tests, with one unrelated failure in
  `components/PseudoLocaleScreens.test.tsx:488`: the separate 2D layout change
  removed the combined street/player summary expected by that test. This work
  does not change that localization assertion or the 2D layout.

The shared workspace also contains separate character/asset revisions. Those
files are preserved outside this change's commit; the local packaged build was
verified with the workspace's current assets.
