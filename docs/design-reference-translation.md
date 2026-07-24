# Design reference translation and originality boundary

This note records which interaction ideas Poker Training Pro may learn from and
which protected expression it must not reproduce. It is a product/design
boundary, not a claim that any third-party asset is licensed for reuse.

## Reference findings translated into original behavior

### Mario Kart World

Nintendo's official mode page describes Grand Prix as a connected four-race
competition and Knockout Tour as a continuous route with checkpoint
eliminations. It also presents several modes as immediately distinguishable
choices and exposes assist/control options.

Poker Training Pro translates only those abstract interaction lessons:

- Play opens a dedicated four-mode choice instead of an application dashboard.
- Career events are a connected run with qualification checkpoints and a final
  result, while Timed Table is a separate one-session promise.
- Between-event progress stays over the moving room view instead of becoming a
  detached report page.
- The start menu exposes only Play and Settings; accessibility/control choices
  are available before timed play.

It does **not** reuse Nintendo artwork, characters, racing motifs, cup shapes,
icons, typefaces, exact card geometry, wording, sound, motion paths, or color
combinations.

Source: [Nintendo — Mario Kart World modes](https://www.nintendo.com/en-ca/gaming-systems/switch-2/featured-games/mario-kart-world/modes/)

### Balatro

The official Balatro press kit shows cards as readable, tactile game objects
with decisive movement and clear face/back state. Poker Training Pro translates
that only into general card affordances: a discrete deal, a visible face/back
flip, a short selected/peek lift, and movement that preserves rank/suit
legibility.

It does **not** use Balatro card art, backs, Jokers, logos, CRT treatment,
textures, typography, audio, shaders, scoring presentation, or animation
timings. The press-kit assets are reference material for media; their presence
in a press kit is not treated as permission to ship them in this game.

Source: [Balatro official press kit](https://www.playbalatro.com/press-kit)

### Discord Poker Night

Discord's official Poker Night help shows the value of a compact table that can
identify up to seven participants and keeps an in-game How To path reachable.
Poker Training Pro translates that into compact opponent identity, balance, and
in-hand state on mobile, plus a persistent rules/reference entry.

It does **not** reuse Discord avatars, dealer skins, table themes, card backs,
stickers, layout coordinates, icons, wording, shop, currency, or leaderboard
presentation. Poker Training Pro has no purchase path and uses play chips only.

Source: [Discord — Poker Night FAQ](https://support-apps.discord.com/hc/en-us/articles/26502258215703-Poker-Night-FAQ)

### Seated VR/card-table presentation

The official Vegas Infinite listing emphasizes immersive venues and a seated
table experience on VR and non-VR PC. CardsVR research describes presence
created by picking up, holding, playing, and moving cards; PokAR research argues
for augmenting rather than replacing the familiar table with readable
statistics.

Poker Training Pro translates these findings into:

- a venue-to-seat arrival that establishes scale before control;
- a bounded left/right seated camera with center and static alternatives;
- visible stacks, cards, chips, and public actions anchored to the felt;
- physical-looking deal, fold, bet, pot, and elimination motion;
- optional statistical overlays that never obscure the underlying table state;
- skip/speed controls so presence does not force a long wait.

It remains a conventional desktop/mobile game: no VR controller pose, branded
venue, avatar system, prop economy, social-space UI, or copied hand animation is
used.

Sources:

- [Vegas Infinite official Steam listing](https://store.steampowered.com/app/886250/PokerStars_VR/)
- [CardsVR research paper](https://arxiv.org/abs/2210.16785)
- [PokAR research paper](https://arxiv.org/abs/2301.00505)

## Poker Training Pro's own visual grammar

The implementation uses an original poker-native system:

- deep emerald felt and near-black lacquer establish the casino base;
- ivory card stock and brass/gold provide legible material contrast;
- cyan, coral/red, warm gold, violet, and green identify state and modes;
- Barlow Condensed and Inter are locally bundled under pinned licenses;
- a spade/chip mark, championship-room signage, felt routes, and chip stacks
  replace racing iconography;
- focus/hover uses both yellow text and shape/scale treatment rather than color
  alone;
- reduced-motion paths retain the same information without camera travel or
  ambient drift.

Current implementation evidence lives in:

- `src/components/Dashboard.tsx` — supplied-art Play/Settings hierarchy and
  original mode selection;
- `src/components/RoomFlythrough.tsx` — original venue-to-seat transition;
- `src/components/PokerTable.tsx` — seated camera and poker interactions;
- `src/styles.css` — palette, material, focus, motion, and reduced-motion rules.

## Anti-generic and release review

Every screen should pass this review:

1. Every visible word or badge must answer a player question or expose an
   action; remove labels such as “Live” when they convey no real state.
2. Do not add decorative analytics cards, fake activity feeds, redundant
   headers, glass panels, gradients, or pills merely to fill space.
3. Keep one clear primary action per decision layer and make secondary actions
   visibly subordinate.
4. Prefer poker objects and room geography over generic dashboard containers.
5. Selection must remain readable through text/icon/shape/focus, not color
   alone.
6. Compare against the references at the level of task flow and affordance,
   never pixel geometry or branded expression.

The user-supplied start-menu image and all generated/original image assets still
require documented provenance and commercial redistribution rights before a
public release candidate. This design boundary does not resolve that blocker.

