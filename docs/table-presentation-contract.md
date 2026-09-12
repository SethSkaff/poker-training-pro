# Table Presentation Contract

The tournament engine owns legality, commitments, odds, refunds and settlement.
Presentation projects public snapshots and the ordered presentation event queue.

## Desktop 2D coordinate system

`GameViewport` fits a single 1920×1080 DOM frame into its available viewport with
`min(width / 1920, height / 1080)` and centers it over the existing dark room.
Electron always uses this frame; the browser's existing <=760px compact layout
and the 3D renderer retain their responsive behavior. The normal interface zoom
setting still applies to other screens, but does not add a second game scale.

The entire `PokerTable` subtree belongs to this frame, including HUD controls,
training/review overlays, raise controls, and pause dialogs. Gameplay viewport
lengths resolve through `--game-vw`, `--game-vh`, and `--game-dvh`, set to 19.2px
and 10.8px in the desktop frame. Their native viewport fallbacks preserve compact
and 3D styling. Physical size media rules exclude the desktop frame; container
units and percentage anchors resolve against its fixed logical stage. Preserve
that distinction when adding gameplay CSS: a new physical `vw`/`vh` or media
query must not silently reintroduce desktop reflow.

The existing seat/card/stack/bet geometry hook now measures an invariant logical
table. Resize changes only the ancestor transform. Its DOM measurements, chip
collection offsets, and chip payout destinations already divide screen-space
rectangles by the ancestor scale, so those animation vectors remain logical.
Native controls, hover regions, and overlays share the transform. Card-drag
distances explicitly convert client coordinates into frame coordinates before
applying peek/fold thresholds. The 3D projected hit-test path stays unchanged.

`src/lib/gameViewport.test.ts` covers fit, centering, and pointer conversion.
`node scripts/audit-2d-game-frame.mjs` verifies the packaged Electron app at
720p, 1080p, 1440p, 4K, ultrawide, tall, and narrow desktop viewports. It compares
normalized DOM geometry, fonts, and rotations for Training and a six-player
hand, tests interface-scale isolation, and sends native mouse input to cards,
raise and speed sliders, audio, and pause/resume. `--dev` uses Vite on port 5173.
Screenshots and the report are written to ignored `work/fixed-frame/`.

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
