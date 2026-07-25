# Desktop presentation architecture decision

**Status:** Accepted — 2026-07-25

## Decision

Poker Training Pro will use a staged **DOM-first 2.5D scene**, not a bundled
real-time 3D engine, for the current desktop release. The scene remains
semantic HTML/CSS/React: seats, cards, chip movement, the dealer button,
table-state labels, and live regions are first-class DOM elements. Depth comes
from layered art, perspective, parallax, translated table coordinates, and
event-driven animation.

This is an intentional delivery decision, not a claim that the present scene is
full 3D. A later real-3D prototype requires a separate decision record and a
new accessibility and performance review.

## Why

| Option | Decision | Reason |
|---|---|---|
| CSS/DOM 2.5D | Chosen | Keeps the established keyboard, screen-reader, reduced-motion, localization, and deterministic event-queue paths intact. |
| Canvas/WebGL engine | Deferred | Would require a maintained parallel accessibility scene and new mesh, material, lighting, and input infrastructure. |
| Video-only room | Rejected | Cannot represent table state, player movement, or dynamic chip/card actions without misleading the player. |

The bundle budget currently caps initial JavaScript at 0.3 MiB gzip and total
`dist` at 64 MiB (`config/performance-budgets.json`). No rendering dependency
is added or hidden behind a budget exception. A future engine must be lazy
loaded after mode selection, report separate initial/scene bundle numbers, and
keep the existing initial budget unless the product owner explicitly approves a
new policy.

## Asset and rights plan

Current shipping visual assets are local, deterministic files in `public/`:
the start-menu images, Poker Training Pro mark, and opponent avatar sheet.
Every newly acquired art, music master, texture, model, or font must enter the
asset-rights manifest and pass the existing release asset-rights audit before
shipping. Reference products inform broad interaction goals only; no external
game artwork, characters, UI, audio, or branded visual language is imported.

For the selected 2.5D path, planned assets are original or properly licensed:

1. optional low-poly-style room layers and chair/body silhouettes;
2. procedural felt, light, and chip textures generated in-app or sourced with
   a recorded permissive/commercial licence;
3. original hand/action sprites keyed to player identity rather than a copied
   third-party character design.

## Accessibility parity

The DOM scene is the accessibility scene. Cards, public actions, pot results,
side pots, focus targets, and current actor are represented as meaningful DOM
and live-region text. Vestibular movement is isolated under the named motion
tier; state changes retain text and short feedback at reduced-motion settings.
Any future canvas scene must preserve equivalent DOM controls and announcements
before it can replace the current table.

## Milestones

1. Finish the current 2.5D event presentation: chips, folds, board cards,
   awards, side pots, and all-ins.
2. Add seated-body/chair grounding and identity-keyed opponent visuals.
3. Improve layered room depth and bounded camera parallax within the motion
   policy.
4. Capture packaged perceptual and geometry evidence at the supported sizes.
5. Only then evaluate a lazy-loaded 3D prototype against the same budgets and
   accessibility parity criteria.

## Cheaper interim path

The immediate path is CSS/DOM enhancement with existing assets and generated
layers. It delivers continuous movement and readable table state without a
renderer dependency, GPU requirement, or an inaccessible canvas-only surface.
