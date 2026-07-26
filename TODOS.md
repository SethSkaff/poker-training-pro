# Poker Training Pro — Running TODOs

This is the canonical backlog. Keep it current as work is completed or new
requirements are added.

> **Document layout.** This file has two parts.
>
> - **Part I — Gameplay experience remediation** (below) is the current source
>   of truth for making the desktop build feel like a video game. It was
>   authored from a live-playthrough product review on 2026-07-25 plus a
>   seven-agent forensic code audit. Work Part I in priority order (P0 → P7).
> - **Part II — Release, platform, and compliance backlog** is the pre-existing
>   backlog, preserved verbatim. Nothing in it was deleted. Most of its
>   remaining open items are blocked on external authority (signing, publisher
>   identity, store accounts, licensed masters, macOS/Xcode) or on hardware and
>   human acceptance testing that cannot be performed in this environment.
>
> **Rules for future runs and sub-agents.**
>
> 1. Do not mark a task complete because code exists. Verify it is *connected to
>    the real application flow* and that the *packaged* experience behaves
>    correctly. This document exists because many features were documented as
>    done while being invisible to a player.
> 2. Do not claim external, hardware, publisher, licensing, or Apple submission
>    work is complete without its actual evidence.
> 3. Keep every acceptance criterion inspectable. Prefer a test or a recorded
>    artifact over an assertion in prose.
> 4. When you complete a task, annotate it with what you verified and how, and
>    leave any residual caveat attached.

---

# Part I — Gameplay experience remediation

## Design north star

Poker Training Pro is an offline desktop tournament No-Limit Hold'em training
**game**, not a poker-themed web dashboard. The desktop product should feel like
the player is physically seated inside a championship poker environment: table,
room, opponents, dealer button, chips, cards, camera, movement, sound, and
transitions forming one continuous world.

**The thirty-second test.** If someone watches over the player's shoulder for
thirty seconds, they must think *"that is a video game"*, not *"that is a poker
web app"*. Today the honest answer is the latter.

Visual assets need not be photorealistic. Deliberately stylized, low-poly, or
simple geometry is acceptable. What matters is that the experience is **spatial,
continuous, readable, and alive**.

Mobile stays deliberately simpler and flatter. **Do not let the simplified
mobile design dictate desktop presentation.**

Do not copy protected visual expression, branding, artwork, interfaces, or
animation from the World Series of Poker, Mario Kart, Chess.com, or any other
product. These are references for broad concepts only — championship
atmosphere, continuous progression, review workflow — never templates.

## Priority order (preserve this hierarchy)

| Phase | Theme | Epics |
|---|---|---|
| **P0** | Make poker hands visibly and correctly play out | E00, E01, E02, E03, E04, E08 |
| **P1** | Continuity and visible state transitions | E05, E06, E07, E22 |
| **P2** | Desktop room, camera, characters, game world | E09, E10 |
| **P3** | AI behavior and tournament pacing | E11, E12, E13, E14 |
| **P4** | Post-round game review | E18 |
| **P5** | Training expansion and adaptation | E15, E16, E17 |
| **P6** | Career continuity, travel, roster variety | E19, E20 |
| **P7** | Tutorial removal/reduction | E21 |
| **X** | Cross-cutting constraints, always in force | E23, E24, E25, E26 |

Dependencies may pull some work in parallel, but the hierarchy above is the
tie-breaker whenever sequencing is ambiguous.

---

## Epic E00 — Audit findings and the discrepancy ledger

The 2026-07-25 audit established that **most reported "missing features" are not
missing code**. The engine and data model are substantially richer than the
player-facing experience. The dominant failure mode is a thin, lossy translation
layer between engine state and the renderer, plus two global suppressors.

### E00-001 — Record the implementation-versus-overview discrepancy ledger

**Status:** Done (this task documents the audit; keep it updated as work lands)

`APP_OVERVIEW.md` and parts of Part II describe systems as delivered that a
player cannot perceive. Verified findings:

| Documented claim | Actual implementation | Classification |
|---|---|---|
| "Seated first-person championship room" | Flat DOM; `.poker-table` uses `perspective(900px) rotateX(56deg)` on an ellipse (`src/styles.css:2599-2614`). No 3D library exists — runtime deps are only react, react-dom, lucide-react, 2 fontsource (`package.json:33-39`) | FAR WEAKER THAN DOCUMENTED |
| "Camera fly-through past venue/tables/dealer/players/stacks" | 4.3s Ken-Burns scale/translate over one static PNG plus decorative divs (`RoomFlythrough.tsx:32-69`, `styles.css:2376-2388`); `.venue-table` scales are fixed (`styles.css:2196-2200`) | PROTOTYPE ONLY |
| "Limited left/right look, center view" | `cameraPan` clamped to `[-2,2]` (`PokerTable.tsx:1408-1414`) × `-18px` (`:1570`) = **±36px** flat `translateX` (`styles.css:2589-2597`); zoom 0.94–1.06 | FAR WEAKER THAN DOCUMENTED |
| "Original avatar-sheet characters with public-action-driven hands (deal/hold/muck, check tap, chip push, all-in, pot gather, elimination retreat)" | Portrait is a sprite crop keyed to **seat slot, not identity** (`styles.css:3041-3064`); gestures are small decorative CSS glyphs beside the seat (`styles.css:4923-5028`); `hold` is `display:none` (`:5026-5028`); opponent peek absent | FAR WEAKER THAN DOCUMENTED |
| "Between-round camera travel toward the next seat" | Progress bar fades in over a table that never moves (`PokerTable.tsx:1810-1834`) | FAR WEAKER THAN DOCUMENTED |
| "Cartoony physical card/chip motion" | No chip ever travels seat→pot or pot→winner; only local fade/scale flourishes at the seat. `.center-pot` is 3 static chip icons, never sized to the real pot (`styles.css:2799-2806`) | MISSING FEATURE |
| "Validated bank of twelve Training scenarios" | 12 exist and are **schema**-valid, but all carry `review.status:"pending"`, `reviewerId:null` — none human-reviewed | DISCREPANCY (in wording) |
| "Always-available poker reference with hand rankings, betting terms, probability shortcuts, tournament terms, worked examples" (Part II marks this `[x]`) | **No standalone reference screen exists.** Content lives only inside `PlayableTutorial.tsx` step 5 and the live in-table math HUD | DISCREPANCY — checked item is not true |
| "Live six-seat geometry audit reports zero intersections" | `work/table-collision-audit.json` has **no producing script anywhere in the repo** — a one-off manual capture, not a gate. Its checklist excludes hero stack, committed-bet labels, dealer button, and side-pot display; measures only bbox intersection, never contrast/size/legibility | DISCREPANCY — misleading as stated |
| "Career play-through with event progression" | Progress is never persisted; resets every app mount | EXISTS BUT DISCONNECTED |
| "Anti-tell decision timing" | Real and implemented; not disputed | ACCURATE |
| Deterministic engine, side pots, information-set redaction | Real, well-tested, richer than the UI exposes | ACCURATE |

**Acceptance criteria**
- [x] `APP_OVERVIEW.md` is corrected so no claim above overstates the build. It is a briefing document given to third parties; leaving it inaccurate is a correctness problem. Verified by direct comparison with the 2026-07-25 code audit.
- [x] Part II's poker-reference item is un-checked or re-scoped to match reality (see E21-003).
- [x] Part II's collision-audit claim is re-worded and superseded by E25-002.

### E00-002 — Two global suppressors explain most "nothing animates" reports

**Observed problem**
The player reported no animation, blinking, and abrupt state replacement
throughout. The audit found two *independent* causes, either of which alone
produces that experience.

**Cause 1 — the player's settings had all motion off.** The real save at
`%APPDATA%\poker-training-pro\saves\autosave.json` contained:
`reducedMotion:true`, `reducedMotionExplicit:true`, `cameraMotion:"off"`,
`menuMotion:"off"`, `roomMotion:"off"`, `tableMotion:"off"`,
`transitionMotion:"off"`, `autoCameraMovement:false`, `dealSpeed:"quick"`.
`src/styles.css:4137-4144` then applies a blanket
`.reduced-motion *, *::before, *::after { animation-duration:0.01ms !important;
transition-duration:0.01ms !important; }` with **no carve-outs**, and
`styles.css:4146-4155` repeats it under `@media (prefers-reduced-motion: reduce)`
so it fires from the OS alone regardless of app state.
The host OS actually has animations **enabled** (`HKCU\...\WindowMetrics\MinAnimate = 1`),
so this was an in-app explicit choice, not an OS mirror.

**Cause 2 — the table subtree remounts on nearly every tick.** See E01-001.
Even with motion fully enabled, no CSS transition can survive a destroyed and
recreated DOM tree.

**Implementation notes**
Both must be fixed before any animation work can be evaluated. Any future
"animation is missing" report must first check these two conditions, or effort
will be spent re-implementing animation that already exists and is suppressed.

**Acceptance criteria**
- [x] A documented one-command diagnostic reports, for the current save and host: resolved `reducedMotion`, `reducedMotionExplicit`, each motion-surface value, `dealSpeed`, and OS `prefers-reduced-motion`. Run `npm run diagnose:motion` (or add `-- --save <autosave.json>`); verified against the current Windows profile on 2026-07-25.
- [x] The remount defect (E01-001) is fixed and verified.
- [x] The reduced-motion policy is corrected (E08). Verified by
  `src/lib/motionPolicy.test.ts`: OS and app reduced-motion rules target only
  `.motion-vestibular`, while table state feedback retains a readable minimum
  duration.

**Tests**
- [x] Unit: the diagnostic resolves settings identically to `applyOsReducedMotionDefault` through the shared first-run and OS-default motion preference tests (`src/lib/firstRunSettings.test.ts`, `src/lib/motionPreference.test.ts`).

### E00-003 — Investigate how first-run produced all-motion-off with explicit=true

**Observed problem**
The save shows `reducedMotionExplicit:true` with every motion surface `"off"`,
on a machine whose OS has animations enabled. Something in the first-run
accessibility flow steered a default player into a fully motion-free game and
locked it in — after which the OS preference is permanently ignored
(`motionPreference.ts:76-83` only defers to the OS while `!explicit`).

**Audit**
- Relevant files: `src/App.tsx:279-298` (OS seed + `applyOsReducedMotionDefault`), `src/lib/motionPreference.ts:30-32,76-83`, the first-run setup screen in `src/App.tsx`, `src/lib/storage.ts:9-12` (defaults).
- Suspected root cause: the first-run screen pre-selects motion options and marks the choice explicit on Save even when the player accepted a pre-checked "reduce motion" state, or the individual motion-surface toggles default to `"off"` independently of `reducedMotion`.
- Not yet determined: which control set the five `*Motion` keys to `"off"`.

**Acceptance criteria**
- [x] Reproduce a clean first run and record the exact resulting settings object. The pure first-run flow test captures the OS-derived untouched Save result (`reducedMotion:true`, `reducedMotionExplicit:false`) and documents the former root cause: Save unconditionally set `reducedMotionExplicit:true`.
- [x] A player who does not deliberately choose reduced motion ends up with motion **on** and `reducedMotionExplicit:false`.
- [x] Skipping first-run setup leaves the app following the OS preference.
- [x] Choosing reduced motion deliberately still fully works and is respected.

**Tests**
- [x] Unit: first-run Save with untouched defaults yields motion-on, `explicit:false`.
- [x] Unit: first-run Skip yields `explicit:false`.
- [x] Integration: OS-reduce + no explicit choice yields reduced motion; explicit choice overrides OS in both directions (`firstRunSettings` + `motionPreference` coverage).

### E00-004 — Fix Math Elo not moving on incorrect answers

**Observed problem**
The real save shows `mathElo: 1000` (exactly the starting value) after
**13 attempts with 0 correct math answers**, while `decisionElo` rose to 1227.
A rating that cannot fall on repeated failure is not a rating.

**Audit**
- Relevant files: `src/lib/trainingEngine.ts` (`calculateEloDelta`, `gradeTrainingAttempt`), the math-grading branch in `src/components/PokerTable.tsx:1547-1560`, persistence in `src/App.tsx`.
- Note the same save shows `mathCorrect:false` on all 13 attempts — separately investigate whether the math input/parse/submit path is failing to register answers at all, since 0/13 with a parser whose own tests pass 32/32 is suspicious.

**Acceptance criteria**
- [x] A wrong math answer produces a negative `mathElo` delta and a persisted decrease. `gradeTrainingAttempt` applies the signed delta before the completed result is appended to progress.
- [x] Determine and document whether 0/13 reflects genuine wrong answers or a submission/registration defect; if the latter, fix it. Inspection of the actual autosave found no `mathAnswer` on all 13 records, proving they were intentionally skipped (the UI only records a math attempt after the player presses Check estimate). It was not a parser/submission failure.
- [x] `mathElo` and `decisionElo` are independently verified to move in both directions.

**Tests**
- [x] Unit: wrong/blank/correct math answers each produce the expected signed delta (`src/lib/trainingEngine.test.ts`). A skipped UI question intentionally receives no math delta; an explicitly graded blank uses the same negative score as any other blank attempt.
- [x] Integration: a full Training attempt persists both Elo values correctly through `PokerTable`'s progress update and the save envelope.

---

## Epic E01 — Visible hand lifecycle (P0)

The single most important requirement: **a hand must visibly progress from
beginning to end**. Before visual polish, the player must be able to see what
was dealt, what each player did, who folded, who bet how much, what remains,
what is in the pot, whether side pots exist, which cards reached the board, how
the hand ended, who won, why, with which five cards, for how many chips, and
what their new stack is.

### E01-001 — Stop remounting the table subtree on every state tick

**Observed problem**
The screen blinks; the flop "suddenly exists"; the visual state appears to
restart between hands. Nothing animates even with motion enabled.

**Desired behavior**
The table, seats, room, and camera persist as stable DOM across actions,
streets, and hands. Objects change *within* a continuous scene.

**Audit**
- Root cause, exact: `src/App.tsx:1344-1352` sets a `key` on `<PokerTable>` composed of `snapshot.id`, `snapshot.street`, `snapshot.pot`, `snapshot.amountToCall`, `runner.sequence`, `activeHand.betting.currentBet`, and `activeHand.betting.pending`. `runner.sequence` increments on **every** action, so the key changes on nearly every update.
- `<PokerTable>` is `React.lazy`-wrapped (`SceneLoader.tsx:27-40`) under `<Suspense>` (`App.tsx:1330-1341`); an unstable key forces a **full unmount/remount** of the whole subtree — destroying all DOM nodes and all component state (`peeked`, `foldProgress`, `dragging`, `raiseOpen`, `cameraPan`, `arrivalVisible`, `paused` — `PokerTable.tsx:815-856`).
- This is not a Suspense-fallback flash; the module is already resolved.
- Consequence: existing, well-authored opponent keyframes (`opponent-card-deal`, `opponent-card-muck`, `styles.css:3134-3149`) either replay every tick or mount directly into their end state, so a deal and a muck can visually coincide.
- Classification: **PRESENTATION BUG**, single location.

**Dependencies** — Blocks essentially all of P0/P1. Do this first.

**Implementation notes**
Remove the volatile key. Identity should change only when the *scene* genuinely
changes (mode/event), not when game state advances. Component state that
legitimately must reset per hand should be reset explicitly by effect on
`handId`, not by destroying the tree. Audit every `key` in the table render path
for the same defect.

**Acceptance criteria**
- [x] `<PokerTable>` is not keyed on pot, bet, street, or `runner.sequence`.
- [x] Advancing a street does not unmount the table subtree.
- [x] Starting a new hand does not unmount the table subtree.
- [x] Camera pan, peek state, and pause state survive an opponent action.
- [x] Existing opponent deal/muck keyframes visibly play once per real transition.

**Tests**
- [x] Unit: a rendered table instance persists across simulated street and hand advances (assert a stable element identity / no remount) (`src/App.tableSceneStability.test.ts`).
- [x] Integration: component state (e.g. camera pan) is retained across an action through explicit scene-state updates rather than a React key (`src/App.tableSceneStability.test.ts`).
- [x] Packaged: E25-001 perceptual gate observes non-instant board transitions and a stable table DOM node.
- [x] Accessibility: live regions remain within the stable table subtree and are not re-announced by a remount (`src/components/PokerTable.liveAnnouncer.test.tsx`).

**Risks**
Removing the key may expose stale-state bugs previously masked by the remount
(the remount was acting as an accidental full reset). Expect to add explicit
per-hand resets.

### E01-002 — Introduce a public presentation event queue

**Observed problem**
There is no presentation timeline at all. Everything between two hero decisions
happens invisibly in one batch.

**Audit**
- `advanceTournamentRunnerToHero` (`src/modes/tournamentRunner.ts:264-329`) and `...Async` (`:353-422`) are run-to-completion loops — deal, resolve street, apply bot action, repeat — with **no yield between iterations**, stopping only when `nextToAct === heroId` or the tournament ends.
- `src/App.tsx:812-853` then performs a **single** `setRunner(next)` for the entire batch.
- The engine *does* have per-event granularity: `hand.information.actions: HandActionRecord[]` (`src/engine/tournament.ts:112-116,139`) and `runner.decisions[]` (bounded 80, `tournamentRunner.ts:315-324`). These are reduced to a static text popover (`App.tsx:1383-1393`) and a single `lastPublicAction` (`App.tsx:1328`).
- Classification: **EXISTS BUT DISCONNECTED** — the event stream exists as data and is discarded as a timeline.

**Desired behavior**
A clean separation between: authoritative engine state; a queue of public
events; presentation state; animation state; input-lock state; and
skip/fast-forward state. The renderer consumes events over time.

**Implementation notes**
The runner must become steppable/incremental (generator or explicit
step-function) rather than run-to-completion. Engine authority must not change —
the engine may compute ahead; only the *presentation* is paced. Actions must
never be duplicated or recomputed because an animation was skipped.

**Acceptance criteria**
- [x] A hand emits an ordered public event stream: hole cards dealt, each action with actor and amount, each street's board cards, bets collected, side pots formed, showdown reveals, each pot award, eliminations, button move, blinds posted.
- [x] The renderer advances through the queue on a deterministic presentation clock honoring the speed setting.
- [x] Engine results are bit-for-bit identical whether or not presentation is skipped.
- [x] Input is locked exactly while a queued sequence is playing, and released precisely when a hero decision is live.
- [x] Pause/resume freezes and restores the exact remaining presentation delay (reuse `FreezableDelay`).

**Tests**
- [x] Unit: the event stream for a scripted hand matches an expected ordered list (`src/modes/tournamentRunner.test.ts`).
- [x] Unit: skipping produces identical final engine state to not skipping (`src/modes/tournamentRunner.test.ts`).
- [x] Unit: pause mid-queue then resume preserves the exact remainder (`src/lib/tournamentPresentationClock.test.ts`).
- [x] Integration: no action is applied twice under rapid skip input (hero action guard plus one-step runner test).
- [x] Determinism: the frozen bot-league baseline and `tournamentReplay` tests are unchanged.

**Risks**
Highest-risk change in Part I. It touches the runner used by replay,
determinism gates, and the iOS bridge. Keep a synchronous run-to-completion path
for tests, replay reconstruction, and the mobile bundle.

### E01-003 — Animate hole-card dealing

**Audit** — No entrance animation exists for hero hole cards; `.hero-hole-cards`
(`styles.css:3207-3272`) has only drag/peek transitions. Opponent cards do have
`opponent-card-deal` (`styles.css:3134-3145`) but it is defeated by E01-001.
Classification: **MISSING FEATURE** (hero) + **DISCONNECTED** (opponent).

**Acceptance criteria**
- [x] Cards visibly travel from a dealer/deal origin to each active seat.
- [x] The deal order is perceptible and correct.
- [x] Each seat visibly receives the correct number of cards.
- [x] Hero cards arrive before peek/reveal is possible.
- [x] Honors the speed setting and the corrected reduced-motion policy (E08).

**Tests** — [ ] Unit: deal events emitted per seat in order. [ ] Packaged: perceptual gate sees a non-instant deal.

### E01-004 — Animate flop, turn, and river

**Audit** — `.community-cards`/`.playing-card` (`styles.css:2715-2773`) have
**zero** animation or transition rules. Board cards appear fully formed.
Empirically confirmed: board went from empty to three rendered cards with the
pot already updated between consecutive frames. Classification: **MISSING FEATURE**.

**Acceptance criteria**
- [x] The flop arrives as a visible three-card dealing sequence (rapid cadence acceptable; the player must see three cards placed).
- [x] A readable pause lets the board register before the turn.
- [x] Turn and river each deal visibly with an appropriate pause.
- [x] All-in runouts use the stronger sequence in E06. Once this hand's `all-in-reveal` has been presented, every remaining `board-card-dealt` runs on the 1,250 ms suspense cadence instead of the 520 ms live-street one.

**Tests** — [ ] Unit: one board-card event per card, ordered. [ ] Packaged: perceptual gate observes intermediate board states.

### E01-005 — Expose every public player action

**Audit** — A textual "Folded" label renders per seat
(`PokerTable.tsx:412-416`). But opponent cards are **always hardcoded
placeholders** — every non-hero seat renders `A♠`/`K♥` marked hidden
(`PokerTable.tsx:376-386`); `createPokerTableSnapshot` only attaches real cards
for the viewer (`tournamentSession.ts:1276-1294`). The muck animation exists but
is defeated by E01-001.

**Acceptance criteria**
- [x] Fold, check, call, bet, raise, all-in, and any forced action are each visibly and distinctly communicated at the acting seat.
- [x] An opponent fold shows a physical/animated muck toward the muck pile plus a readable label.
- [x] Eliminations and pot/side-pot awards are visibly communicated.
- [x] The player never has to infer an action from a later stack change.

**Tests** — [x] Unit: each action type produces a distinct presentation event. [x] Accessibility: each is announced without leaking hidden information.

### E01-006 — Add a real "currently acting" indicator

**Audit** — **Dead code.** `PokerTable.tsx:390-392` gates the thinking ring on
`player.id === "maya"`, but the only roster uses id `"maya-tempo"`
(`tournamentSession.ts:192-199`), so the ring can never render in real play.
There is no `actingPlayerId`/`toAct` concept surfaced to the UI at all.
Classification: **STATE-SYNC BUG** over a **MISSING FEATURE**.

**Acceptance criteria**
- [x] The seat to act is unmistakably indicated, by more than color.
- [x] The indicator is driven by real engine state, not a hardcoded id.
- [x] Action order is discoverable.
- [x] The hero's own turn is clearly distinguished from waiting.

**Tests** — [x] Unit: indicator follows `actingPlayerId` across a betting round. [x] Regression: no hardcoded player id remains in render conditions (add a lint/grep gate).

---

## Epic E02 — Table-state clarity (P0)

### E02-001 — Make the hero's stack always visible

**Observed problem**
The player could not see their own remaining chips, and had to open the raise
controls and drag toward all-in to infer them. This is the most damning
readability defect found.

**Audit**
- Root cause, exact: `src/styles.css:2858-2860` — `.player-seat--hero { display: none; }`, unconditional, present since the baseline commit.
- `PlayerSeat` (`PokerTable.tsx:325-434`) renders the stack for **every** seat including the hero (`:400-405`, invoked `:1911-1928`), so the JSX and data already exist.
- `display:none` also removes it from the **accessibility tree**, so `playerSeatAriaLabel` (`:294-323`) — which does include the stack — is unreachable by screen readers.
- No substitute HUD exists: `table-topbar` (`:1725-1798`) and `ModeSidePanel` (`:682-761`) never show stack.
- Empirically confirmed: the only place the hero's stack appears is the raise panel's All-in preset (`:2144-2145`).
- Interface scale (`styles.css:5075-5085`) is irrelevant — a hidden element cannot be scaled into view.
- Classification: **EXISTS BUT DISCONNECTED**.

**Acceptance criteria**
- [x] Remaining stack is visible during normal play without opening any menu.
- [x] Distinct from the amount currently committed.
- [x] Never obscured by cards, chips, controls, overlays, or avatars.
- [x] Readable at 1100×720 through 2560×1080 and at every interface scale.
- [x] Exposed to screen readers with a correct label, announced on change.
- [x] Not conveyed by color alone.
- [x] Updates at the correct presentation moment (after chips visibly leave, per E05-001).

**Tests** — [x] Unit: hero stack element is present and populated in a live tournament render (`src/components/PokerTable.heroStack.test.ts`). [x] Accessibility: hero stack is reachable in the a11y tree and announced on change. [x] Packaged: present and unobscured at all five reference sizes (E25-002). [x] Regression: a gate fails if the replacement HUD is hidden (`PokerTable.heroStack.test.ts`).

### E02-002 — Show committed wager, amount to call, and total invested

**Audit**
- Amount-to-call **is** already visible outside the raise UI (`PokerTable.tsx:1987-1994`, and the call button `:2064-2070`) — this part of the report was inaccurate; it is present but visually modest and far from the chips.
- Hero's committed-this-street `.seat-bet` (`:406-411`) is hidden by the same `display:none` as E02-001.
- Opponent committed-this-street renders correctly.
- **Total invested this hand is an engine/type gap**: the engine tracks `totalCommitted` (`engine/betting.ts:14`, `tournament.ts:125`) but `SeatPlayer` (`src/types/poker.ts:35-44`) has only a single `bet`, populated from `streetCommitted` alone (`tournamentSession.ts:1289`). The UI has no field to read.

**Acceptance criteria**
- [x] Every seat visibly shows its committed amount for the current betting round.
- [x] The hero's committed amount is visible outside the raise UI.
- [x] Amount to call is prominent and near the decision controls.
- [x] Total invested this hand is available where useful (requires surfacing `totalCommitted`).
- [x] Current pot and each side-pot amount are visible (E05-004). The centre pot carries the inclusive total; whenever a side pot exists the live "Live pots" strip lists every lane with its amount and eligible players.

**Tests** — [x] Unit: `SeatPlayer` carries and renders `totalCommitted` (`tournamentSession.test.ts`, `PokerTable.heroStack.test.ts`). [x] Unit: hero committed amount renders. [x] Accessibility: stack, committed-this-street, total-invested, and amount-to-call are announced (`PokerTable.accessibility.test.ts`, `PokerTable.heroStack.test.ts`).

### E02-003 — Make position and blinds unmistakable

**Audit**
- Dealer button: `PokerTable.tsx:372`, a 20×20px circle with 8px text and a plain `#ede9dc` fill (`styles.css:3191-3205`), pinned beside an 86×86px avatar — a tiny inconspicuous dot.
- **No SB/BB markers exist at all.** Grep for `smallBlindSeat|bigBlindSeat|isSmallBlind|"SB"` in `PokerTable.tsx` returns nothing; only aggregate blind values show in the centre readout (`:1874-1883`).
- **No position labels** (UTG etc.) anywhere.
- Which seats hold SB/BB is not exposed to the UI as seat ids.

**Acceptance criteria**
- [x] The dealer button is unmistakable at every supported size.
- [x] Small-blind and big-blind seats are marked per seat.
- [x] Ante is shown when applicable.
- [x] The player immediately knows whether they are button, SB, BB, UTG, acting, or waiting.
- [x] Markers are distinguished by more than color.

**Tests** — [x] Unit: SB/BB/button markers map to correct seats across a rotation (`PokerTable.heroStack.test.ts`). [x] Accessibility: position is announced for the hero (`heroStackAriaLabel`).

### E02-004 — Make the dealer button visibly move between hands

**Status:** Done — `button-moved` is emitted before `blinds-posted` by the
runner, rendered as `dealer-button-travel`, and verified in both packaged
motion passes on 2026-07-25 (820 ms full motion, 120 ms reduced motion).

**Audit** — No transition or animation is attached to `.dealer-button` or its
position change; it re-renders at the new seat. Empirically confirmed: between
hands the "D" jumped instantly to another seat. Classification: **MISSING FEATURE (motion)**.

**Acceptance criteria**
- [x] The button visibly travels to the next seat during the between-hand sequence (E07).
- [x] The move happens at the correct moment in the sequence, before blinds are posted.
- [x] Reduced-motion provides an instant-but-clear alternative that still communicates the change.

**Tests** — [x] Unit: a button-move event is emitted between hands
(`tournamentRunner.test.ts`). [x] Packaged: the perceptual gate observes the
move in full and reduced motion.

---

## Epic E03 — Showdown and hand-result presentation (P0)

### E03-001 — Stop discarding the winning hand from the result

**Observed problem**
At showdown the player often cannot tell whether they won or lost; winning hands
are not named and winning cards are not highlighted.

**Audit**
- The engine already computes everything: `HandValue { category, categoryName, displayName, tiebreak, cards }` (`src/engine/evaluator.ts:19-34`) — including the exact best-five `cards`.
- `PotAward { potId, playerId, amount, hand?: HandValue }` (`src/engine/pots.ts:43-48`) **already carries the winning hand**, populated for every award by `resolvePots` (`pots.ts:213-220`), correctly handling ties, splits, and odd chips (`pots.ts:169-232`).
- It survives into `session.lastHand.awards` (`tournamentSession.ts:965-980`).
- **Severed here:** `src/App.tsx:1402-1404` maps awards to `{ playerId, amount }`, dropping `potId` and `hand`; the receiving type `TournamentTableControls.lastPotAwards` (`PokerTable.tsx:127`) is likewise narrowed.
- Classification: **EXISTS BUT DISCONNECTED** — a one-line data loss.

**Acceptance criteria**
- [x] `potId` and `hand` reach the UI for every award.
- [x] The winning hand category is named on screen (Pair … Royal Flush).
- [x] The exact five cards used are highlighted — moved slightly forward/up and visually connected.
- [x] Unused cards remain visible but de-emphasized.
- [x] Board-playing hands are handled correctly.
- [x] Ties and split pots are shown explicitly.
- [x] Each side pot's winner is shown separately.
- [x] The result stays visible long enough to read, and is grounded at the table rather than only in a modal.

**Tests** — [ ] Unit: award mapping preserves `potId` and `hand`. [ ] Unit: best-five highlighting for pair/two-pair/trips/straight/flush/full house/quads/straight flush/board-plays. [ ] Unit: split pot and multi-side-pot rendering. [ ] Accessibility: winner, category, and amount announced.

### E03-002 — Implement legitimate showdown reveals

**Audit**
- A `revealed?: boolean` field exists on `HandInformationPlayer` (`engine/tournament.ts:127`) and redaction already honors it (`:848`) — but **nothing ever sets it to `true`**. The only `revealed: true` in the repo is a test fixture (`engine/tournament.test.ts:249`). `createPokerTableSnapshot` doesn't branch on it.
- Consequence: opponent hole cards are never available even at a legitimate showdown, and every opponent seat shows hardcoded placeholders.
- Classification: **PROTOTYPE ONLY** — a half-built mechanism that is fully inert.

**Implementation notes**
This is an engine-level change with a privacy review, not a UI detail. Reveals
must be set only where the rules make cards public, and the redaction path must
remain the single gate. Because determinism ties every card to the seed, review
and replay consumers must reapply viewer-scoped redaction rather than trusting
reconstructed state (see E24-002).

**Architecture decision (2026-07-25): reveals are ephemeral presentation
events, not persistent engine state.** Setting `HandInformationPlayer.revealed`
would have put opponent hole cards into the information set — the same object
that feeds snapshots, the autosave envelope, and replay reconstruction — making
every one of those a new leak surface to re-audit. Instead the runner emits
`showdown` and `all-in-reveal` presentation events carrying the reveal payload.
Those events live only in renderer state (`App.tsx` `pendingPresentation`),
never reach `persistBoundary`, and are absent from the replay export allowlist,
so a reveal is structurally incapable of being written to disk. `revealed` is
deliberately **retained** on `HandInformationPlayer` because
`redactHandInformation` (`tournament.ts:846-850`) and Rational's public-hand
branch (`rational.ts:404,426`) are both correct if a future feature ever does
put a legitimately public hand into an information set; it stays the single
redaction gate rather than dead code to delete.

**Acceptance criteria**
- [x] Reveals are produced exactly for players whose cards the rules make public — `showdown` when betting closes with the hand unresolved, `all-in-reveal` only when every live player is all-in and two or more board cards are still to come (`tournamentRunner.ts:447-471,513-534`). `revealed` remains the redaction gate per the decision above.
- [x] The presentation layer honors those reveals and nothing else; opponent seats show face-down backs until a reveal event arrives (`publicRevealsForPresentation`, `PokerTable.tsx:266-277`).
- [x] Cards never public are never exposed, in UI, logs, announcements, saves, or exports. A deterministic multi-seed sweep asserts no non-reveal event serializes a hole card and no event carries a `holeCards` key.
- [x] Folded hands are not revealed. Both emitters filter `status !== "folded"`, and the sweep tracks every fold within a hand and asserts folded ids never appear in that hand's reveals.

**Tests** — [x] Unit: reveal set only at qualifying showdowns / closed-betting all-ins (`tournamentRunner.test.ts`). [x] Privacy: redaction denies non-revealed cards for every viewer (`engine/tournament.test.ts:258`) plus the runner-level leak sweep. [x] Regression: existing hidden-information invariance tests still pass.

### E03-003 — Guarantee every hand communicates win or loss

**Acceptance criteria**
- [x] Every hand-ending sequence states the winner, the hand category, the amount awarded, and the player's updated stack.
- [x] Losing players are indicated where relevant.
- [x] Elimination and advancement are stated.
- [x] Side-pot effects on the result are explained.
- [x] Communicated visually, textually, and via assistive technology.

**Tests** — [ ] Unit: fold-win, showdown-win, split, side-pot, and elimination each produce a complete result statement. [ ] Accessibility: assertive announcement for elimination.

---

## Epic E04 — Folded-hand continuation (P0)

### E04-001 — Continue the hand after the hero folds

**Observed problem**
When the hero folds, the hand appears to end or blank immediately.

**Audit**
- Root cause: the advance loop's stop condition is `if (actor === runner.session.heroId) return runner;` (`tournamentRunner.ts:298`, `:389`). Once the hero folds they are never `nextToAct` again this hand, so the loop plays out the entire remainder, settles the pot, checks eliminations, **and deals the next hand**, stopping only at the next real hero decision.
- Empirically confirmed: fold at "Hand 1, Preflop, 6 players remain" → the very next frame the player sees is "Hand 2, Preflop, 5 players remain" with two opponents already marked FOLDED and a winner's stack already grown from 14,975 to 30,000. Zero intervening frames.
- Classification: **PRESENTATION BUG / STATE-SYNC BUG**. Depends on E01-002.

**Acceptance criteria**
- [x] Default: hero cards visibly muck, remaining opponents act visibly, board cards continue to deal, pots build, the winner is shown, the pot is awarded, then the next hand begins normally.
- [x] The player can watch a folded hand play out.
- [x] Presentation honors the speed setting.

**Tests** — [ ] Unit: after a hero fold, presentation events continue to hand end. [ ] Integration: the next hand is not dealt until the current hand's result has been presented.

### E04-002 — Make Skip optional, not the default

**Audit**
- "Skip to result" (`PokerTable.tsx:2101-2107`) only resolves the `FreezableDelay` wrapping the hero's **own** just-submitted action (`:1279-1288`). Everything after that runs the same run-to-completion loop regardless.
- The hero-decision delay (`1_500 + ((sequence*977) % 2_750)` ms, `tournamentRunner.ts:310,403`) is the **only** throttle in the entire pipeline.
- Empirically: simply waiting produced the identical instantaneous whole-hand jump. The documented "skip never duplicates or cancels an action" claim is trivially true because there is no other queued presentation.
- Classification: **PRESENTATION BUG / MISSING FEATURE**.

**Acceptance criteria**
- [x] Full presentation is the default; skipping is an explicit choice.
- [x] Skip resolves only queued presentation and opponent-play delays.
- [x] Skip never cancels, duplicates, or recomputes an already-chosen action.
- [x] Skip moves cleanly to the result and leaves the result readable.
- [x] Skip is keyboard and controller accessible and clearly labelled.

**Tests** — [ ] Unit: skip yields identical engine state to full playback. [ ] Unit: repeated rapid skip applies each action exactly once. [ ] Accessibility: skip reachable by keyboard and controller.

### E04-003 — Give fold-wins an explicit result sequence

**Acceptance criteria**
- [x] The final fold is shown.
- [x] The winner is identified with a short result message.
- [x] The pot visibly moves to the winner and the stack updates.
- [x] The result remains visible long enough to understand.
- [x] Folded hole cards are **not** revealed (no deliberate option is in scope here).

**Tests** — [ ] Unit: all-fold termination emits a complete result sequence. [ ] Privacy: no folded hole card is exposed.

---

## Epic E05 — Bets, pots, side pots, and chip movement (P1)

### E05-001 — Make bets physically move and define the presentation contract

**Observed problem**
Bets do not physically move. The player specifically asked whether the pot
number increases before chips visibly move.

**Audit**
- **No chip ever travels between two screen locations.** What exists is local motion at the seat only: `.seat-bet { animation: opponent-chip-push 420ms }` (`styles.css:3117-3132`, keyframes `:3156-3159`) is a fade/scale-in at the seat (translateY(-38px)→0), not travel to the pot. The `.seat-action-hand--bet/--all-in/--win` glyphs (`styles.css:4950-4999`) nudge a ~30-40px icon at the seat edge.
- `.center-pot` (`PokerTable.tsx:1903-1907`, `styles.css:2799-2806`) is **three static chip icons rendered unconditionally**, never sized or animated to reflect the real pot.
- No animation exists for collecting bets at street end — when `player.bet` resets to 0 the `.seat-bet` block simply unmounts with no exit transition.
- No animation exists for chips traveling to a winner; only the local win flourish plays.
- **Order of operations, resolved:** `scenario.pot` is computed as `Σ player.totalCommitted` (`tournamentSession.ts:468-470,595,668`), so the displayed pot **already includes chips still sitting in front of players**. The pot text and each `.seat-bet` badge derive from the same render and update in the same React commit — there is no data-level lag. The player's perception is nonetheless accurate: the centre number changes with nothing visibly moving toward it.
- Classification: **MISSING FEATURE** (travel animation never built), not a state-sync bug.

**Desired behavior**
A single, non-contradictory presentation contract. Either (a) update the
committed-bet amount as chips leave the stack and update the central pot when
chips are collected, or (b) visibly reserve chips before consolidating them.
Never show chips at a seat while simultaneously presenting them as fully
collected into the centre without a clear reason.

**Acceptance criteria**
- [x] The chosen contract is written down in `docs/` and referenced from the code.
- [x] Chips visibly move from the stack area into a committed-bet area on bet/raise/call/blind.
- [x] Committed chips remain visually separate from the remaining stack.
- [x] Opponent bet chips never overlap stack labels (add these elements to the geometry gate, E25-002).
- [x] The numeric pot and the chip visuals never contradict one another.
- [x] `.center-pot` reflects the real pot magnitude or is removed.

**Tests** — [ ] Unit: displayed pot equals the contract's expected value at each phase. [ ] Packaged: geometry gate covers bet-vs-stack-label. [ ] Packaged: perceptual gate observes chip travel.

### E05-002 — Collect bets into the pot at street end

**Acceptance criteria**
- [x] Committed chips visibly move to the central pot when a street closes.
- [x] The pot display updates in sync with the collection.
- [x] Side-pot separation is preserved through the collection. The live ladder is derived from `totalCommitted`, which the street close does not reset, so the Main/Side lanes and their eligibility lists are byte-identical before and after `bets-collected` — the animation consolidates chips visually without ever merging a capped pot into the main pot.
- [x] No instantaneous teleport when motion is enabled.

**Tests** — [x] Unit: a collect event is emitted per street close (`tournamentRunner.test.ts` public-stream ordering). [x] Unit: chip conservation holds across collection, and the pot ladder is unchanged by it (`tournamentSession.test.ts` — "keeps main and side pots separate after a street's bets are collected").

### E05-003 — Animate pot awards

**Acceptance criteria**
- [x] The main pot visibly moves to its winner.
- [x] Each side pot visibly moves to its own correct winner.
- [x] Stacks update during or after the visible award.
- [x] Split-pot division is shown explicitly.
- [x] No full-screen refresh occurs.
- [x] Winning has emotional payoff (pairs with E22-001).

**Tests** — [ ] Unit: one award event per pot with correct recipient. [ ] Unit: split awards animate to multiple seats.

### E05-004 — Build a real side-pot display

**Observed problem**
Side pots are communicated only by a small message in the bottom-right corner,
with no amounts and no eligible players.

**Audit**
- Confirmed exactly. The only side-pot UI is `ContextCoachPanel` (`PokerTable.tsx:774-799`), styled `.context-coach { position: fixed; right: 28px; bottom: clamp(18px,3vh,40px) }` (`styles.css:7254-7272`) — literally pinned bottom-right. Its copy is generic and non-numeric (`en-US.messages.gameplay.ts:440-441`): no amount, no eligible players, nothing tied to the actual hand.
- Worse: `contextualPrompts.ts:21-24,148,152-159` persists a `seen` list, so this prompt fires **once ever per save file**. After first dismissal it never appears again for any subsequent side pot.
- A glossary entry exists in the pause menu's reference page (`PokerTable.tsx:2481-2482`) — not live state.
- **The engine has everything**: `ContestablePot { id, kind:"main"|"side", amount, cap, contributorIds, eligiblePlayerIds }` (`engine/pots.ts:14-21`) and per-pot awards. It is discarded: `App.tsx:1394-1407` collapses `lastHand.pots` into a single boolean `lastHandHadSidePot` and strips `potId` from awards. Live in-hand pot is a single flat number (`types/poker.ts:64`).
- Caveat: `ContestablePot` is currently built at settlement (`buildPots`), so **live** mid-hand pot structure is not yet available before resolution — exposing it during a multiway all-in requires computing it earlier.
- Classification: **EXISTS BUT DISCONNECTED** + **MISSING FEATURE**.

**Acceptance criteria**
- [x] Main pot and each side pot are visually separated with their own amounts.
- [x] Eligible players are shown per pot.
- [x] The reason a side pot exists is explained in context, not as a one-shot tip. The live ledger names the all-in player and public cap, then names only the contenders eligible for each side pot; it does not depend on the persisted contextual-prompt `seen` state (`describeLiveSidePot`, `PokerTable.showdownPresentation.test.ts`).
- [x] Side-pot creation is announced, every time, not once per save.
- [x] At showdown each pot is evaluated and awarded separately and visibly.
- [x] Understandable to a player who knows poker but is not tracking every chip. Each live side lane now states the cap that created it and the only players who can win it, alongside the amount and eligibility list.
- [x] Live pot structure is available before resolution for all-in situations.

**Tests** — [ ] Unit: multi-side-pot hand renders correct amounts and eligibility. [ ] Unit: the explanation is not gated by a once-ever `seen` flag. [ ] Unit: per-pot award attribution reaches the UI. [ ] Accessibility: side-pot amounts and eligibility announced.

---

## Epic E06 — All-in presentation (P1)

### E06-001 — Build a dedicated all-in sequence

**Observed problem**
All-ins are treated as another abrupt transition, often without revealing
opponent cards or showing the runout.

**Audit**
- No all-in presentation exists. Only an `is-all-in` seat label (`PokerTable.tsx:417-420`) and a one-time educational tip (`offerPrompt("all-in")`, `:1174`).
- `progressTournamentSessionHand` is called repeatedly inside the same synchronous loop with no yield (`tournamentRunner.ts:286-292,376-383`), so a flop→turn→river→showdown runout resolves in one JS tick.
- Depends on E01-002 and E03-002.

**Desired sequence**
1. Confirm who is all-in. 2. Move involved hole cards to a clear presentation
position. 3. Reveal all live all-in hands. 4. Show each player's probability of
winning/tying/losing. 5. State plainly that probabilities derive only from
remaining unseen cards. 6. Run remaining board cards one at a time. 7. After each
card, update equities with animation and a brief suspense pause. 8. Resolve the
winner. 9. Highlight the winning five. 10. Award main and side pots visibly.
11. Show eliminations or survival.

**Status:** Done — the eleven steps are now realised by the presentation queue
rather than a bespoke modal, which is what keeps step 2's requirement ("stays
connected to the table") satisfiable at all.

**Acceptance criteria**
- [x] The sequence above plays in order. `all-in` action → `all-in-reveal` (lifting the involved hands, `styles.css` `.player-seat.is-revealed`) → equity strip → one `board-card-dealt` per card on the slower runout cadence with equity recomputed per card → `showdown` with best-five highlight → `side-pot-formed` / `pot-awarded` → `eliminated`.
- [x] It stays visually connected to the table and hides no important state. The reveal lifts only the two cards; the seat, stack, committed bet, and position markers do not move, and the equity strip is a corner aside rather than an overlay.
- [x] It never misrepresents the math. Equity comes from the same deterministic estimator as Rational, and the strip states the unseen-card count and simulation count as its basis.
- [x] It leaks no information before cards are legally revealed. `all-in-reveal` is emitted only when every live player is all-in with ≥2 board cards to come; the leak sweep in E03-002 covers the negative.
- [x] It respects the corrected reduced-motion policy and remains skippable. Runout delays scale with speed and the motion tier (313 ms at speed 4; 563 ms with table motion off), and the lift becomes instant rather than absent under `data-motion-table="off"`.
- [x] It does not affect the deterministic engine result. Pacing lives entirely in `presentationEventDelayMs`, which the engine never reads; the skip-equals-playback test still holds.

**Tests** — [x] Unit: sequence event order for 2-way and 3-way all-ins (`tournamentRunner.test.ts`). [x] Unit: identical engine result with and without the sequence ("reaches the same authoritative hero decision whether presentation events are consumed or skipped"). [x] Unit: the runout cadence is slower than a live street and still scales with speed/motion (`tournamentPresentationClock.test.ts`). [x] Privacy: no reveal before the legal reveal point. [x] Accessibility: each stage announced; equity values exposed as text (`.all-in-equity-strip` is `role="status"` with per-player win/tie/lose text).

### E06-002 — Wire a player-facing equity readout

**Audit**
- The Monte Carlo machinery is real and production-reachable: `estimateRangeEquity`/`estimateRangeEquitySliced` (`src/modes/rational.ts`), the versioned worker protocol (`rationalEquityProtocol.ts`), and the service with cancellation and stale-result rejection (`rationalEquityService.ts`), already off-main-thread via `createDesktopEquityService()` (`App.tsx:66,82,817-826,864-879`).
- It is **viewer-agnostic** — it accepts any `PlayerInformationSet`, so it works for the hero.
- The table has a public post-reveal estimator (`estimatePublicAllInEquitySliced`) which uses only legally revealed all-in hands plus the board, yields every deterministic 25-simulation slice, and is now genuinely cancellable: it accepts an abort signal, re-checks it at each slice boundary, and rejects with `PublicAllInEquityCancelledError` rather than running a superseded board to completion. `PokerTable` drives it from an `AbortController` torn down by the effect cleanup, so a new board card stops the previous run instead of merely ignoring it.
- Classification: **CONNECTED** — resolved 2026-07-25.

**Implementation notes**
Reuse the existing sliced/worker path; do not add a second estimator. Budget
awareness matters: `docs/rational-equity-work-budget.md:64-71` measures median
382 ms at 700 simulations and 663 ms at 1,200 on the reference machine, so the
readout must be sliced/backgrounded and must not block the runout.

**Acceptance criteria**
- [x] Win/tie/lose probabilities are shown per live all-in player.
- [x] Values update after each board card.
- [x] The basis (remaining unseen cards, simulation count) is disclosed.
- [x] Computation is cancellable and rejects stale results. `estimatePublicAllInEquitySliced` takes `{ signal }`, aborts at the next deterministic slice boundary, and rejects with a `cancelled` marker (`isPublicAllInEquityCancelled`); `PokerTable`'s effect aborts the previous run on every board/hand change.
- [x] It never uses information the player is not entitled to. The request is assembled only after `all-in-reveal` and includes its legal public cards plus the public board.
- [x] It never blocks the presentation thread. Work is sliced at 25 simulations with an awaited yield between slices, so the estimator never holds the main thread across a slice.

**Tests** — [x] Unit: equity for a known board matches an expected range (forced royal flush yields 100/0). [x] Unit: cancellation and stale rejection (`rational.test.ts` — mid-run abort stops at the observing boundary; a pre-aborted signal does zero slices; a never-aborting signal matches the unguarded result). [x] Determinism: fixed seed yields identical displayed values.

---

## Epic E07 — Between-hand continuity (P1)

### E07-001 — Make the inter-hand sequence continuous

**Observed problem**
Each hand appears to start from a newly rendered screen.

**Audit**
- The between-round `room-progress-overlay` (`PokerTable.tsx:1810-1834`) is a fade-in/out div over a **never-unmounted** table — so the overlay itself is fine; the discontinuity comes from E01-001's remount and E01-002's batching.
- The genuine hard cut is per-*event*: `screen === "room-transition"` (`App.tsx:1281-1315`) lazy-loads `RoomFlythrough` and on completion calls `setScreen("tournament-table")` (`:1307-1311`), unmounting one and mounting the other.

**Desired sequence**
Finish the result → push chips to the winner → update stacks visibly → muck or
clear cards → clear the board → move the dealer button → post blinds → deal the
next hand. The room, camera, seats, table, and lighting persist throughout.

**Acceptance criteria**
- [x] The sequence above is visible and ordered.
- [x] No fade-to-black or reload of the same table between hands.
- [x] The player perceives one continuous session, not a sequence of screenshots.
- [x] Blinds are visibly posted before hole cards are dealt.

**Tests** — [ ] Unit: inter-hand event order. [ ] Unit: the table subtree is not unmounted across a hand boundary. [ ] Packaged: perceptual gate confirms continuity.

---

## Epic E08 — Motion policy and reduced-motion correctness (P0)

### E08-001 — Replace the blanket animation kill switch with a tiered policy

**Observed problem**
The player experienced no animation at all. Their settings had every motion
surface off, and the CSS then removes **all** motion app-wide.

**Audit**
- `styles.css:4137-4144`: `.reduced-motion *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }` — a blanket kill with **no carve-outs**.
- `styles.css:4146-4155` repeats the identical rule under `@media (prefers-reduced-motion: reduce)`, so it fires from the OS alone even if app state disagrees.
- `App.tsx:589-602` additionally sets `data-motion-table="off"` etc., which zeroes the `.seat-state--winner` badge animation (`styles.css:5153-5156`) — so a reduced-motion player gets no sound (E22-001), no seat highlight, and no badge animation on winning.

**Why this is a defect, not just a setting**
Reduced-motion is intended to suppress **vestibular triggers** — large parallax,
spin, rapid zoom, camera sway. It is not intended to remove state-change
feedback. Stripping card-deal and chip-movement cues leaves reduced-motion
players unable to perceive what happened, which is itself an accessibility
failure and contradicts the requirement that the player always knows the state.

**Desired behavior**
Tier motion into categories and gate them independently:
- **Vestibular / decorative** (camera sway, room fly-through, parallax, flourish, background motion) — suppressed under reduced motion.
- **State-communicating** (card deal, chip travel, fold/muck, pot award, button move) — retained under reduced motion, optionally shortened, with an instant-but-legible fallback that still shows the state change occurred.
- **Essential feedback** (focus, selection, error) — always retained.

**Dependencies** — Blocks meaningful evaluation of E01, E05, E06, E07.

**Acceptance criteria**
- [x] The blanket `*` kill rule is replaced by tiered, named categories.
- [x] Reduced motion still communicates every queued state change through the
  public event label and a retained, shortened presentation interval.
- [x] Existing granular surfaces (`cameraMotion`, `menuMotion`, `roomMotion`, `tableMotion`, `transitionMotion`) map onto the tiers coherently and are documented in the adjacent CSS policy comment.
- [x] The OS `@media` rule suppresses only the vestibular tier.
- [x] A reduced-motion player can still tell who folded, what was dealt, and who won through the event label, seat labels, cards, and result strip. Physical chip travel remains E05 work.
- [x] Motion-off retains the winner badge (shortened to 120ms); audio settings remain independently controlled in `App.tsx`.

**Tests** — [ ] Unit: per-tier resolution for every combination of settings. [ ] Accessibility: with reduced motion on, every state change still has a perceivable non-motion indicator. [ ] Packaged: perceptual gate run twice — full motion and reduced motion — with different expectations per tier, not "no animation" for both.

**Risks**
Over-correcting would reintroduce vestibular triggers. Keep the flash/luminance
analysis (Part II) green for the vestibular tier.

---

## Epic E09 — Desktop room, camera, and game world (P2)

### E09-001 — Research spike: choose the desktop presentation architecture

**Status:** Done — decision record landed in `docs/desktop-presentation-architecture.md`; implementation remains staged 2.5D.

**Observed problem**
The desktop feels like a web UI arranged around a table. The intent is a
championship room with depth, multiple tables, seated opponents with real
bodies, lighting, objects, and camera motion.

**Audit / constraints that make this a decision, not a task**
- There is **no 3D anywhere** and no 3D dependency (`package.json:33-39`). Nothing existing is reusable as "3D minus a renderer" — the camera and room are CSS illusions with no 3D math beneath them.
- Assets today: one static room PNG and one 3×2 portrait sprite sheet. Low-poly seated characters, a modeled room, and card/chip/table meshes would all need authoring or licensing.
- **Bundle gate:** `config/performance-budgets.json` caps initial JS at **0.3 MiB gzipped** and `distTotalMiB` at 64. A 3D engine strains that before any app code. Either the engine is lazy-loaded strictly behind the room/table screens *and* the budget policy explicitly redefines "initial", or the budget is deliberately raised. Silently blowing the gate fails `scripts/audit-static-budgets.mjs`.
- **CSP/offline:** `index.html:13-14` (`script-src 'self'`) permits a locally bundled engine but forbids CDN delivery, remote models/textures, and eval-based shader loading. Everything ships in the ASAR.
- **Accessibility:** a canvas scene has no DOM for assistive technology. The existing named seat groups, live regions, focus management, contrast/target audits, and CSS-driven reduced motion are all DOM-based. A 3D scene must sit **behind a maintained parallel accessibility layer**, roughly doubling the scene's surface area permanently (see E23-001).

**Deliverable of the spike**
A written decision record in `docs/` covering: chosen approach (staged 2.5D
enhancement vs. real 3D via a bundled engine); the budget-policy decision with
numbers; the asset plan and its provenance/licensing path; the accessibility
parity plan; and a milestone breakdown. **Do not begin E09-002+ before this
lands.** Note honestly that GPU usage is not itself the goal — the goal is a
spatial presentation that could not be mistaken for a mobile web screen.

**Acceptance criteria**
- [x] Decision record exists and is explicit about cost and trade-offs.
- [x] The budget decision is recorded as an intentional policy decision, not a gate bypass.
- [x] Asset provenance is addressed up front (ties to Part II's asset-rights work).
- [x] A cheaper interim path is identified so P2 is not all-or-nothing.

### E09-002 — Interim: raise perceived depth without a new engine

**Rationale** — De-risks E09-001 by delivering visible improvement regardless of
the architecture decision.

**Acceptance criteria**
- [x] Opponents read as seated presences grounded to the table, not floating portraits. `PlayerSeat` now renders a `.seat-figure` — ground shadow, chair, torso with a collar and neck, and the portrait sitting on top of it — instead of a bare avatar tile.
- [x] Portrait selection is keyed to **player identity**, not seat slot. `describeOpponentAppearance(playerId)` is the single source; `opponentAppearance.test.ts` asserts the same id always yields the same figure.
- [x] Felt, lighting, and depth cues are improved; the table no longer reads as a flat coloured ellipse. The single `background: #164938` fill is replaced by an overhead key light, a far-edge falloff, a woven nap, inset top/bottom shading, and a lit rail highlight (`.poker-table` / `.poker-table::before`). All static gradients, so the motion tiers are unaffected.
- [x] Layered parallax between room, table, and foreground within the vestibular tier of E08. Three planes translate at different fractions of `--camera-pan` — distant hall 0.72×, mid-ground tables 0.38×, table plane 1× — so looking left changes the relationship between layers instead of sliding one flat image. The group is `aria-hidden`, sits behind all table state, and comes fully to rest under `data-camera-motion="off"`.

**Tests** — [x] `PokerTable.roomDepth.test.ts`: the planes render behind the table and are hidden from assistive technology; the pan factors are strictly ordered and all below the table's own 1×; motion-off zeroes both transform and transition; the felt is a lit surface rather than one flat fill.

### E09-003 — Make the seated camera meaningful

**Audit** — Current range is ±36px flat translate plus a 0.94–1.06 scale.

**Acceptance criteria**
- [x] Looking left/right produces a genuinely spatial change, with parallax between depth layers (E09-002's three-plane `--camera-pan` fractions).
- [x] Center-view command works and is discoverable. It was keyboard-only (X); the camera control now has a third button that both recenters and reads out the current heading ("Centered" / "Looking left"), and disables itself when already square.
- [x] Keyboard (Q/E/X), controller (D-pad left/right/down), and pointer control, all remappable, with the pan clamped to ±2 on every path — no free camera in normal play.
- [x] Camera sensitivity, recenter behavior, field-of-view/zoom choice, and an option to disable automatic camera movement are all in Settings (`cameraSensitivity`, `cameraView`, `cameraMotion`).
- [x] A fixed/reduced-motion alternative: `data-camera-motion="off"` stops the parallax transform and transition outright while leaving the layers legible.

**Tests** — [x] Unit: pan bounds and recenter, plus device parity across keyboard/gamepad/pointer for all three camera actions (`PokerTable.camera.test.ts`). [x] Accessibility: every camera action is remappable and carries a pointer hint; auto-camera disable is honored (`PokerTable.roomDepth.test.ts`).

### E09-004 — Make room arrival a real spatial transition

**Audit** — Today: a 4.3 s Ken-Burns zoom over one PNG with a three-stop route
breadcrumb and a skip button; the five "tables" are fixed-scale divs that never
change perspective relative to one another.

**Acceptance criteria**
- [ ] Entering a session or event moves through the venue past tables, dealer areas, players and stacks, then settles into the hero's seat.
- [ ] Loading is hidden behind the authored transition where practical.
- [ ] It transitions directly into play without a hard cut (addresses the `room-transition` → `tournament-table` remount).
- [ ] Skippable, with a static reduced-motion alternative.

---

## Epic E10 — Characters and roster variety (P2)

### E10-001 — Replace the hardcoded roster with a deterministic procedural field

**Observed problem**
The same opponents, names, and portraits appear in Normal, in Rational, across
different events, across later career stages, and across sessions.

**Audit**
- Root cause: `DEFAULT_OPPONENTS` (`tournamentSession.ts:192-223`) is a hardcoded five-entrant constant (Maya Chen, Rafael Torres, Adrian Cole, Juno Pike, Lena Ortiz). `createTournamentSession` uses `options.opponents ?? DEFAULT_OPPONENTS` (`:350`) and the sole call site `App.tsx:734-745` **never passes `opponents`**.
- Only the card/decision seed varies (`deriveSeed(seed, eventId, "tournament")`, `:356`).
- Compounding defect: portraits are keyed to **seat slot** (`styles.css:3041-3064`), so as the same five rotate seats the face at a position never changes even though the occupant does. Stated the other way round — **the same named opponent shows a different face from hand to hand** as the button rotates and their seat relative to the hero changes. Portrait identity is not stable per opponent at all, only per seat.
- Classification: **MISSING FEATURE** — no generation system exists to be reconnected.

**Implementation notes — determinism is a hard constraint**
Replay persists public entrant data and reconstructs from a stored seed. Roster
selection must therefore become part of the **seeded derivation chain**
(`deriveSeed`), never a separate unseeded randomization, or replay determinism
breaks. Continue persisting public entrant identity/personality/rating exactly as
today.

**Implementation as built**
`createSessionOpponents` composes names from 24 given × 24 family parts under a
"no two seats share a name part" constraint, seeded by
`deriveSeed(seed, eventId, mode, "roster")`. Appearance is **not** part of the
entrant: `lib/opponentAppearance.describeOpponentAppearance(playerId)` derives
it from the id alone, which is what makes the non-correlation requirement a
structural property rather than a promise.

**Acceptance criteria**
- [x] A fresh field is generated per event and per session — the roster seed folds in the session seed and the event id.
- [x] Normal and Rational do not reuse an identical roster — mode is in the derivation chain.
- [x] Immediate repeats are avoided. Measured over 2,000 consecutive-event pairs: the field never repeated identically and 4.3% shared even one opponent (mean overlap 0.043 of five seats). An `avoidIds` hook exists but is deliberately unwired — see the note below.
- [x] Variation across face shape (4), hair style (6) and colour (6), clothing (8), accessories (6), body type (4), skin tone (6), age presentation (4), posture (4), idle-animation phase (24), name, personality/playing style, and rating band by tier. 400 sampled identities produce >360 distinct seated figures.
- [x] Appearance is **never** correlated with playing behavior or skill. `describeOpponentAppearance` takes exactly one parameter — the id — so rating, profile, stack, position, and mode are not in scope to correlate with. The test asserts both the arity and that two entrants differing in every behavioural field but sharing an id are visually identical.
- [x] Portraits key to identity, not seat position.
- [x] Recurring named rivals only if deliberately designed — the measured 4.3% single-opponent carry-over is the only recurrence, and no rival system claims otherwise.
- [x] Higher tiers feel like different competitions. Rating bands run 1,000–1,090 (local) to 1,300–1,480 (world); identities are unchanged by tier, so tier cannot be inferred from who is seated.
- [x] Fixed seed reproduces an identical roster.

**Note — why the avoid-list is not wired to live session state.**
`restoreTournamentRunnerReplay` regenerates the roster from `seed + eventId +
mode` alone. Feeding it "the field from the player's previous event" would make
the roster depend on state outside the replay envelope, so faithful
reconstruction would require persisting the avoid-list and widening the export
allowlist. The measurement above shows that cost buys nothing.

**Tests** — [x] Unit: same seed → identical roster; different event/mode/session → different roster (`tournamentRoster.test.ts`). [x] Unit: no immediate repeat across consecutive events (400-pair sweep). [x] Determinism: replay reconstruction reproduces the roster exactly — guaranteed by construction, since the roster inputs are exactly the replay's persisted fields. [x] Review: appearance dimensions are independent of behavior parameters (`opponentAppearance.test.ts`).

### E10-002 — Make character action animation read as physical

**Audit** — Gestures exist and are correctly driven by **public** state (a real
strength — no hidden-information leak), but they are small decorative CSS glyphs
beside a static portrait. `hold` is `display:none` (`styles.css:5026-5028`);
opponent card-peek does not exist; elimination is an opacity/grayscale fade
rather than leaving the table.

**Acceptance criteria**
- [x] Receive, peek/hold, muck, check the felt, place chips, gather-and-push (raise), call, go all-in, react to winning, and leave after elimination each have their own gesture. `raise` is deliberately distinct from `bet` — gathering a stack and pushing it forward is a different physical act from placing chips — and `receive` and `out` give the deal and the departure their own beats.
- [x] `hold` has a real visual; opponent peek exists. Active opponents now visibly lift their face-down cards with a public-state-only hand pose; `PokerTable.characterGesture.test.ts` covers the hold/peek selection and action priority.
- [x] Animation reflects only public state — guaranteed structurally, not by convention. `seatGestureForPublicState` takes a single object of public fields and has no card, rank, equity, or evaluated-hand parameter, so there is no channel through which hand strength could reach a gesture. An opponent holding the nuts and one holding 7-2 are byte-identical.
- [x] Motion tiers per E08 — the new gestures get the same `data-motion-table` off/reduced durations as the existing ones.

**Tests** — [ ] Unit: gesture selection is a pure function of public state. [ ] Privacy: a test asserts gesture choice is invariant to hole cards (extend the existing hidden-information invariance suite).

### E10-003 — Vary the environment by event tier

**Audit** — Zero variation exists; every event renders identical markup, and
`RoomFlythrough` always uses the same PNG regardless of event.

**Acceptance criteria**
- [x] Room scale, crowd density, lighting, table presentation, signage, and background activity vary by tier — now at the **seated table** as well as in the fly-through, which was the real gap: every event looked identical once the player sat down. Crowd density comes from how many distant tables stay visible, room scale from their spread, lighting from house-light warmth and width, and table presentation from a warmer rail at the top tiers.
- [x] Achieved procedurally — the tier rules are asserted to contain no `url(` anywhere, so a new venue costs nothing at build time.
- [x] Reduced-motion and performance budgets respected: the tier rules are static (they add no animation) and the bundle budgets still pass.

**Tests** — [x] `RoomFlythrough.tier.test.tsx`: the tier reaches the seated table; scale, density, lighting, and table presentation each vary; no tier rule loads an image.

---

## Epic E11 — Normal AI behavior (P3)

### E11-001 — Measurement: complete, with results

**Status:** Done. Measured against the **real production engine** headlessly
(`tournamentSession.ts` + `tournament.ts` + `normal.ts`/`rational.ts`, using
`App.tsx`'s exact call signatures: `simulations: 60`, `temperature: 0.48`,
`DEFAULT_OPPONENTS`). 15 seeds × both policies, `local-qualifier` structure
(300 BB start), **blind clock frozen** to isolate policy from pacing.

| Metric | Normal (n=15) | Rational (n=15) |
|---|---|---|
| **Max consecutive-raise chain (one street)** | **660** | **595** |
| Chains ≥4 / ≥8 / ≥10 | 120 / 75 / 64 (of 156) | 108 / 65 / 50 (of 393) |
| VPIP / PFR | 54.9% / 45.6% | 65.1% / 47.8% |
| 3-bet% / 4-bet% | 72.2% / 85.9% | 47.3% / 76.5% |
| **Facing a bet: fold / call / raise-back** | 5.3% / 3.9% / **90.8%** (n=5,901) | 4.9% / 11.1% / **84.0%** (n=5,385) |
| Preflop all-in hand-rate | 25.0% | 19.5% |
| Postflop all-in hand-rate | 6.8% | 9.2% |
| Preflop chips committed (BB) mean / median / max | 88.0 / 1.0 / **1,780** | 82.2 / 2.0 / **1,798** |
| **Raise size ÷ pot: mean / median** | 0.36 / **0.01** | 0.64 / **0.01** |
| Raise ÷ effective stack: mean / median | 0.03 / 0.01 | 0.04 / 0.01 |
| Hands to first elimination: mean / median | 2.6 / 2 | 1.7 / 1 |
| Hands to heads-up: mean / median | 12.0 / 13 | 9.7 / 7 |
| **Total hands to finish a 6-max tournament** | 9.9 / **9** | 11.6 / **10** |

**Complaint verdicts**

| Complaint | Verdict |
|---|---|
| Opponents raise instead of calling | **CONFIRMED, worse than described** — 84-91% raise-back |
| 10-11 consecutive raises | **CONFIRMED and vastly exceeded** — chains of 40-660; ≥10 is common, not an edge case |
| ~60,000 preflop with a big pair | **CONFIRMED in spirit** — preflop commitments to 1,780-1,798 BB, a 489 BB all-in measured; 60,000 is exactly the national/world-championship starting stack (`engine/tournament.ts:221-246`) |
| All-ins vs ordinary hands | **CONFIRMED** — 19.5-25% of hands have a preflop all-in |
| Bots overvalue any good hand | **CONFIRMED** — `actionRole` treats ~0.58 equity as full "value" with no stack-at-risk discount |
| Player could predict the raising | **CONFIRMED quantitatively** — a 84-91% single-action response is trivially exploitable |
| Heads-up by ~hand 16 | **CONFIRMED, worse** — median *whole-field* elimination in 9-10 hands |
| Rational shares the pathology | **CONFIRMED** — all headline metrics within noise of Normal |
| Same roster everywhere | **CONFIRMED** — see E10-001 |
| Renderer submits actions repeatedly | **RULED OUT** — `App.tsx:812-853` guards with `decisionPendingRef`; logged chains show **alternating distinct actor ids**, i.e. genuine multi-agent behavior, not a UI duplication |
| User consistently won | Not directly testable without a human; plausible that bots bust each other via mutual over-aggression while a disciplined human survives by default |

**Reproducing seeds** — ≥8-chain: `nlqnc-2` hand 4 preflop (length **120**);
bot-vs-bot with no hero: `nlqnc-2` hand 5 (length 62), `rlqnc-1` hand 4 (length
**102**). Deep-stack preflop all-in: `nlqnc-9` hand 12 (`juno-mirror`, 489.5 BB).
Single-hand full-field collapse: `nlqnc-11`, `rlqnc-5`.

**Critical pacing conclusion** — With the blind clock **completely frozen** at
25/50, fields still collapsed in a median of 9-10 hands. A paired run on the
`national-championship` 60,000-chip structure **with** the clock running finished
in 12 hands vs 13 frozen. **Blind escalation is not the cause; the policy is.**
This re-scopes E13.

### E11-002 — Root causes (identified; fix these, do not scale a constant)

**Cause 1 — minimum-raise sizing creates a linear, non-doubling raise war.**
Highest confidence, primary cause. `rational.ts:796-815` (`buildCandidates`)
always offers `legal.raise.minTo`. `betting.ts:253` computes
`minRaiseTo = currentBet + lastFullRaise`, and `:362-363` updates
`lastFullRaise` only to the new raise's *increment* — so a chain of minimum
re-raises grows the bet **arithmetically, not geometrically**. At 300-500 BB
depth that takes hundreds of iterations to exhaust a stack. The data proves this
is what happens: **median raise ÷ pot = 0.01** in both modes, i.e. nearly all
raises in a chain are minimum-legal, not the pot-fraction sizes
(0.33/0.5/0.66/0.8/1.1×) the code also offers.

**Cause 2 — the chip-utility formula rewards re-raising with a pot-scaled term
against a flat marginal cost.** `rational.ts:963-967`:
`chipUtility = foldEquity * pot + (1 - foldEquity) * (calledEquity * calledPot - wager)`.
The "steal the pot" reward grows with the pot **the war itself created**, while
`wager` grows only by the flat minimum-raise increment. The model never re-derives
that after N consecutive min-raises the realistic continuation value of raising
again is far lower than a single-shot model assumes.

**Cause 3 — no real ICM / stack-preservation brake.**
`tournamentRiskPremium` (`rational.ts:724-751`) is capped at 0.22-0.3 and
typically computes to 0.04-0.07 in career play. `actionRole`
(`rational.ts:867-882`) classifies anything ≥ ~0.58 equity as "value", and the
utility function has no penalty for tournament-survival value lost when covering
an opponent by 5-10×. This is the mechanism behind deep-stack shoves.

**Cause 4 — Normal is a thin wrapper over Rational's numbers, not an independent
human model.** `tournamentSession.ts:1161-1167` builds Normal's `evaluations`
directly from `rational.distribution`. `normal.ts:105-109` caps `competenceRate`
at 90-95% and `:625,637-641` bound any deviation to `maxEvLossBb` of only
**0.12-0.32 BB**. Because Cause 2 makes "raise" the clear EV leader, there is
essentially never an alternative action within 0.3 BB, so the personality layer
has almost nothing to choose from and inherits Rational's raise addiction
near-unmodified.

**Ruled out with evidence — do not re-investigate without new information**
- Renderer duplicate submission: `decisionPendingRef` guard in `App.tsx:812-853`; chains show alternating distinct actors.
- Stale/async divergence: `decideRationalActionAsync` (`rational.ts:1121-1130`) reconstructs an identical decision; the sliced path never reads elapsed time and is tested bit-identical; each decision re-derives its own seed (`tournamentSession.ts:1130`).
- `roundChips` unit interpretation: no recurrence. `additionalRisk` consistently means incremental chips and `command.to` consistently means the new street total (`betting.ts:326-337`).

**Status:** Done — 2026-07-25. The harness is now a permanent, re-runnable
script (`scripts/measure-ai-behavior.ts` library +
`scripts/report-ai-behavior.ts` CLI, `npm run measure:ai`), so every number
below is reproducible rather than a one-off transcript.

**Before → after (8 seeds per mode, blind clock frozen)**

| Metric | Normal before | Normal after | Rational before | Rational after |
|---|---|---|---|---|
| Max consecutive-raise chain | **631** | **2** | 599 | **3** |
| Chains ≥4 / ≥8 / ≥10 | 54 / 34 / 27 | **0 / 0 / 0** | 51 / 25 / 16 | **0 / 0 / 0** |
| Facing a bet: fold / call / raise | 3 / 3 / **94%** | **46 / 42 / 12%** | 7 / 13 / **80%** | **33 / 49 / 18%** |
| 3-bet / 4-bet | 72% / 86% | **2.5% / 0%** | 47% / 77% | **20% / 21%** |
| Preflop all-in hand rate | 21.0% | **0.0%** | 21.2% | **0.0%** |
| Median raise ÷ pot | 0.50 (min-raise) | **1.00** | 0.50 | **1.00** |
| Median hands to heads-up | 11 | **36** | 7 | **44** |
| Median hands to finish | **8** | **29** | **9** | **46.5** |

**Fixes, one per cause**
- **Cause 1** — `buildCandidates` no longer offers `legal.raise.minTo` as a routine option; it is reinstated only when the stack leaves no larger legal sizing. Pot-fraction floors also rise with the aggression already shown on the street (0.5/0.8/1.1× opening → 0.75/1.1/1.5× → 1.0/1.4/2.0× after three raises).
- **Cause 2** — the raise-utility model gained its missing third outcome. It priced a raise as "they fold, or they call and we see a showdown"; the branch that actually occurs in a war — the opponent re-raises and the chips just wagered are dead — is now modeled, with its probability rising as `streetAggressionCount` grows (6% → capped 72%).
- **Cause 3** — a stack-preservation brake, quadratic in the fraction of the effective stack committed past a 25% threshold and scaled by the risk premium. The threshold matters: a brake applying from zero suppressed ordinary value betting too (measured: Normal's raise rate fell to 2.8%).
- **Cause 4** — investigated and **re-scoped, not "fixed by widening the budget."** Widening `maxEvLossBb` far enough to manufacture deviations also admitted genuine blunders (at a 27 BB pot a pot-scaled budget admitted a 3.3 BB EV loss and profiles began folding and shoving where continuing was clearly right). Measurement showed why: with the corrected utility model the median gap to the second-best action across the 36 canonical cells is **1.05 BB**, so a competent professional *should* take the best line in most of them. The budget was left at its original values and personality distinctness is now asserted **directly** instead — see E11-004.

**Acceptance criteria**
- [x] Each of Causes 1-4 has a targeted fix (or, for Cause 4, a measured re-scope) with a before/after measurement from the E11-001 harness.
- [x] Raise-back-facing-a-bet falls from 84-91% into a documented plausible band — 19% (Normal) and 27% (Rational), gated to [5%, 42%].
- [x] Median raise ÷ pot moves off min-raise dominance — the minimum legal raise is no longer a routine candidate and the median sizing is a full pot.
- [x] Median hands to finish a 6-max tournament rises into the E13 target band — 8-9 → 36-42.5, gated to [15, 140].

### E11-003 — Correct the action-comparison model (framing corrected by measurement)

**Correction to an earlier assumption.** The review hypothesised the AI reasons
*"hand is good enough to continue, therefore raise."* **Measurement shows this is
not the defect.** `rational.ts` genuinely evaluates fold, check, call, and each
raise size, and selects via a softmax over utilities
(`normalizedDistribution`, `rational.ts:999-1018`). The architecture is correct;
the **utility model is miscalibrated for repeated-raise sequences** (Cause 2) and
the **candidate set is dominated by minimum raises** (Cause 1). Fix the model and
the candidates — do not rewrite a working comparison framework.

**Acceptance criteria**
- [x] The utility model accounts for the realistic continuation cost of an ongoing raise war. `streetAggressionCount` makes the war visible to the policy for the first time, and `reRaiseRisk` turns it into a rising probability that the wager is dead — so raising again stops being self-reinforcing.
- [x] Minimum-raise candidates no longer dominate; sizing is pot-relative and its floor rises with the aggression already shown.
- [x] Every raise still has an identifiable reason to outperform calling — the `role` classification (value / semi-bluff / bluff / showdown) and per-option rationale are unchanged and still attached to every candidate.
- [x] Call frequency rises and raise frequency falls to calibrated levels (2.5% → 42% call; 94% → 19% raise-back).
- [x] The comparison stays inspectable: the full scored distribution with utilities, fold equity, role, and rationale is still returned for every action (feeds E17 and E18).

**Tests** — [x] Unit: constructed spots where calling strictly beats raising produce a call (`rational.test.ts` — "calls rather than raises when calling strictly dominates"). [x] Unit: an escalating sequence measurably reduces willingness to re-raise, and the minimum legal raise is not offered as a routine candidate. [x] Unit: a deep stack is not shoved without a commanding edge. [x] Statistical: call/raise mix and chain-length distribution within gated bounds (`scripts/audit-ai-behavior-gates.ts`).

### E11-004 — Reach the Normal AI target

**Target** — A varied table of skilled human professionals: strong fundamentals,
distinct personalities, plausible bluffs, calls as well as raises, strategic
pressure, occasional traps, position/stack/tournament awareness, bounded
mistakes. **"Human-feeling" must not mean "randomly makes bad decisions."** No
inexplicable repeated aggression, no hidden-card access, no reliably exploitable
single pattern.

**Acceptance criteria**
- [ ] No single exploitable pattern lets a competent player win reliably (measure hero win-rate and exploitability against scripted strategies). **Partly addressed:** the one dominant exploitable pattern the review found — a 94% raise-back response — is gone and gated to [5%, 42%], and a "never 3-bets" pattern is gated against too. A hero win-rate measurement against scripted strategies has **not** been built, so this stays open.
- [x] Personalities are behaviorally distinguishable in measurement, not just labelled. Asserted directly in `botLeague.test.ts`: the loosest profile must exercise its budget (>2% deviation), the spread between loosest and tightest must exceed 4×, and all five must be distinct measured points. This replaced the previous `selectedBestRate <= 0.98` proxy, which had been calibrated against the miscalibrated utility model.
- [ ] Position, stack depth, and tournament stage measurably change behavior. The bot league slices Rational by position, stack, and street and freezes those distributions, so a regression is caught — but no assertion yet requires the slices to *differ* from one another.

---

## Epic E12 — Rational AI behavior (P3)

### E12-001 — Verify and enforce the Rational contract

**Acceptance criteria**
- [x] Uses only information legally available to its seat. The new `streetAggressionCount` input reads public betting actions only, so the re-raise-chain awareness added in E11-002 introduces no new information channel; the existing invariance tests cover it.
- [x] Compares action values mathematically rather than pattern-matching hand strength — confirmed by measurement in E11-003 and unchanged by the correction.
- [x] Respects simulation budgets and remains deterministic under fixed seeds.
- [x] No timing leakage — the bot league's anti-tell correlations remain green after the rebalance.
- [x] Calls when calling outperforms raising; folds when continuing is unprofitable (`rational.test.ts` "calls rather than raises when calling strictly dominates"; call rate 13% → 49%).
- [x] No repeated raises without mathematical justification — max chain 599 → 3, and every remaining raise still carries its role and rationale.
- [x] Rational is **measurably distinct** from Normal. They deliberately share the utility core (Normal consumes Rational's evaluations), which is *why* they were previously indistinguishable; the separation is now measured and gated rather than assumed. Rational vs Normal: raise-back 18.2% vs 11.7%, 3-bet 19.8% vs 2.5%, 4-bet 21.2% vs 0%, VPIP 58.2% vs 44.3%. The gate fails if raise-back separation drops below 3 points.

**Tests** — [x] Determinism: fixed seed reproduces decisions bit-for-bit. [x] Privacy: decisions invariant to opponents' hole cards. [x] Statistical: Normal-vs-Rational divergence exceeds a documented threshold (`scripts/audit-ai-behavior-gates.ts`).

---

## Epic E13 — Tournament pacing (P3)

### E13-001 — Pacing is an AI problem, not a blind-structure problem

**Observed problem** — Six players reached heads-up by ~hand 16.

**Audit — measured, and the cause is now settled.** Worse than reported: median
*whole-field* elimination in **9-10 hands**. Critically, this was measured with
the **blind clock completely frozen** at 25/50 from a 300 BB start. A paired run
on the `national-championship` 60,000-chip structure **with** the clock running
finished in 12 hands versus 13 with it frozen — a negligible difference.

**Therefore the blind schedule is not the cause.** Do not re-tune blinds hoping
to fix pacing; that would slow the structure while leaving the real defect intact
and would make later events feel wrong. The collapse is driven by E11-002's
Causes 1-3, and pacing should be re-measured **after** those land.

**Resolution (2026-07-25): no blind-structure change was needed or made.**
The prediction above held exactly. Re-measuring after E11-002/E11-003 landed,
with no structure value altered:

| | before | after |
|---|---|---|
| Median hands to first elimination | 1-2 | 4-9 |
| Median hands to heads-up | 7-11 | **36-44** |
| Median hands to finish | 8-9 | **29-46.5** |

**Calibration target for this format**, justified rather than borrowed: a
six-seat single table starting 300 BB deep, played to completion, should run
**25-90 hands** with heads-up reached no earlier than hand 8. The reasoning is
the format's own arithmetic — at 300 BB effective, no single pot can eliminate
a player who has not committed most of a stack, so a field that collapses in
under ~25 hands must be doing so through mutual over-commitment rather than
through the blind structure. The upper bound keeps a session finishable in one
sitting. This is not copied from a real-world tournament statistic, which would
not transfer: real events have far more players, far more levels, and no
requirement to end in one sitting.

**Acceptance criteria**
- [x] Re-ran the harness after E11-002/E11-003 and recorded pacing before touching any structure value.
- [x] Starting effective stack depth in BBs is documented per event tier — `local-qualifier` is 300 BB; the tier ladder up to `national-championship`'s 60,000 chips is defined in `engine/tournament.ts`.
- [x] A documented calibration target exists for a six-player format, justified for this format (above).
- [x] Median hands to first elimination, to heads-up, and to completion fall within the target and are gated to [15, 140] finish / ≥8 heads-up / ≥2 first elimination.
- [x] No blind-structure change was made — the measurement showed none was warranted, which is the outcome this task was written to protect.
- [ ] Event tiers differ intentionally in pacing. Deferred: tiers currently differ in stack depth, blind schedule, and (new in E10-001) field strength, but no per-tier pacing target has been set or measured.

---

## Epic E14 — AI regression gates and critic harness (P3)

### E14-001 — Gate the metrics that are currently ungated

**Audit — the gap list is now known.** Existing gates are the frozen bot-league
baseline (`src/modes/fixtures/bot-league-baseline.json`, `botLeague.test.ts`) and
the Training calibration gate. **Critically, the bot-league harness evaluates
isolated single decisions on a 36-cell matrix and never a sequence**, and its six
frozen tournaments deliberately use a **6 BB** starting stack per
`docs/bot-league-regression-harness.md`. Its current 3.17-8.67 mean hand count is
therefore by design and **structurally cannot detect** a realistic-depth (300 BB)
collapse like the one measured. Its only pacing assertions are
`maxDecisions ≤ 2500` and that finish-place counts sum correctly.

Not gated by anything today:
- Consecutive-raise chain length (max, and frequency ≥4/≥8/≥10) — impossible to catch with single-decision evaluation.
- Preflop / postflop all-in frequency.
- VPIP, PFR, 3-bet%, 4-bet%, fold-to-raise%, call% over live sequential play.
- Hands to first elimination, to heads-up, and to completion **at realistic stack depth**.
- Average pot relative to blinds; average and median preflop chips committed.
- Raise-size plausibility relative to pot and effective stack.
- Aggregate behavioral divergence between Normal and Rational (only per-decision EV-loss budget and 86-98% `selectedBestRate` are gated).
- Roster diversity and portrait-to-identity stability (no test exists at all).

**Acceptance criteria**
- [x] Regression gates exist for every listed metric. `scripts/audit-ai-behavior-gates.ts` (wired into `npm run release:verify`, also `npm run release:audit-ai-behavior`) covers raise-chain max and ≥8 frequency, preflop/postflop all-in rate, VPIP, PFR, 3-bet%, 4-bet%, fold/call/raise-back mix, median hands to first elimination, to heads-up, and to completion, raise-size plausibility, and Normal-vs-Rational separation — all over live sequential play at realistic 300 BB depth, which is exactly what the bot league structurally cannot see. Finish distribution, EV loss, and timing leakage remain gated by the bot league.
- [x] Gates are statistical with documented tolerances, not single-anecdote assertions. Each bound carries its band, the value measured when it was set, and the reason it exists; bands are set well outside current values so ordinary tuning does not trip them.
- [x] The frozen baseline is only regenerated through the documented sanctioned workflow, with before/after comparison recorded. The 2026-07-25 replacement is written up in `docs/bot-league-regression-harness.md` under "Baseline replacements", including the accepted distribution changes and why the `selectedBestRate <= 0.98` bound was replaced by a direct distinguishability assertion.

### E14-002 — Development-only LLM critic harness

**Hard constraint** — **The shipped game must never gain network access.** No
live LLM opponent, no online dependency. This is a development evaluation tool
only.

**Acceptance criteria**
- [ ] A dev/research harness plays large numbers of hands headlessly, samples suspicious or representative hands, and submits **public** hand histories to a low-cost or local model for qualitative labels: implausible aggression, passive missed value, unjustified raise, strange all-in, repeated action pattern, human-plausible play.
- [ ] Results are used as qualitative signal **alongside** mathematical metrics, never as source of truth.
- [ ] The harness lives outside the shipped bundle and is excluded from production packages (extend the existing production-hygiene audit).
- [ ] No hidden-card information is ever sent.

**Risks** — Must not become a release gate, and must not create an offline-policy
violation or a data-egress path for hidden information.

---

## Epic E15 — Training scenario selection (P5)

### E15-001 — Fix the deterministic selection cycle

**Observed problem**
The player saw what appeared to be only three repeating scenarios, all obvious
calls, answerable by pressing the call hotkey repeatedly for "Strong decision".

**Audit — confirmed empirically, and worse than reported**
- `src/App.tsx:283` — a new session always starts at `trainingScenarios[0]` = `preflop-pot-odds-ak`.
- `App.tsx:921-932` (`advanceTrainingScenario`) calls `selectNearTransferScenario`, a **fully deterministic greedy scorer** (`src/lib/trainingEngine.ts:398-436`) — never random, never Elo-filtered.
- Weights (`:414-428`): same math topic **+100**, same transferGroup **+65**, not-yet-completed **+40 (one time only)**, shared tag +6 each, street change +12, difficulty distance −8/point.
- Simulating 100 consecutive advances from the real default entry point yields a **permanent 2-cycle**: `preflop-pot-odds-ak` ↔ `river-bluff-catch-price`, 50/50, **2 of 12 scenarios**. Both are call-correct — they are the only pair sharing the `pot-odds` topic, worth an unbeatable +100.
- Every one of the 12 possible starting points degenerates: 2-cycles in 8 cases, 3-cycles in 4 (the `aggression-threshold` group). The reported "three scenarios" corresponds to landing in a 3-cycle.
- **Confirmed in the player's real save** (`autosave.json`): 13 attempts, `preflop-pot-odds-ak` ×7 and `river-bluff-catch-price` ×6, **2 distinct scenarios of 12**, action `call` ×13, all correct.
- Compounding: only 2 scenarios share `pot-odds`; `implied-odds`, `outs`, `minimum-defense-frequency`, `stack-to-pot-ratio`, and `tournament-pressure` have exactly **one** scenario each, so the dominant weights have no diversity to draw from.
- The frozen calibration baseline contains a `nearTransferPairs` field (`trainingCalibration.ts:344-347`) — **this cycling was captured into a passing baseline and never flagged**.
- Classification: **SELECTION BUG** + **DATA-CONTENT LIMITATION**.

**The 12-scenario bank** (5 sole-call-best, plus one accepting call as tied-best — call is fully correct on half the bank):

| id | street | difficulty | best action | math topic |
|---|---|---|---|---|
| preflop-pot-odds-ak | preflop | 2 | call | pot-odds |
| preflop-button-shove-fold-equity | preflop | 3 | all-in | expected-value |
| preflop-implied-odds-pair | preflop | 3 | call | implied-odds |
| flop-flush-draw-all-in | flop | 2 | call | equity |
| flop-dirty-straight-outs | flop | 3 | fold | outs |
| flop-defense-frequency | flop | 3 | fold | minimum-defense-frequency |
| turn-close-flush-price | turn | 3 | call (fold also accepted) | equity |
| turn-spr-commitment | turn | 2 | all-in | stack-to-pot-ratio |
| turn-semi-bluff-ev | turn | 4 | raise | expected-value |
| river-bluff-catch-price | river | 3 | call | pot-odds |
| river-blocker-bluff | river | 4 | raise | expected-value |
| river-icm-bubble-call | river | 5 | fold | tournament-pressure |

**Acceptance criteria**
- [x] No fixed-point cycle exists from **any** starting scenario.
- [x] Over a session, coverage spans the bank rather than a 2-3 member subset.
- [x] The correct action varies — a player cannot answer correctly by repeating one input.
- [x] The starting scenario is not always index 0.
- [x] Recent-history avoidance covers scenario id, cards, board texture, stack structure, pot-odds threshold, correct action, wording, and lesson category.
- [x] Determinism is preserved where replay requires it.
- [x] The calibration baseline is re-derived so it no longer enshrines cycling, through the sanctioned workflow.

**Tests** — [x] Unit: 100-draw simulation from every starting point shows no cycle and broad coverage. [x] Unit: consecutive correct actions are not all identical. [x] Unit: all 12 scenarios are reachable. [x] Regression: a gate fails if selection coverage over N draws falls below a threshold.

### E15-002 — Move to constraint-driven selection and generation

**Desired pipeline** — Choose a learning objective → choose target difficulty →
build or select a legal candidate → compute equities, pot odds, action EVs, and
regret → **reject** candidates that are illegal, ambiguous beyond the intended
tolerance, trivially obvious, near-duplicates of recent, or off-target difficulty
→ present → grade by EV regret → explain.

Objectives to cover: pot odds, equity, expected value, bluff catching, value
betting, draws, implied odds (only with a defensible model), fold equity, SPR,
tournament pressure, side pots, preflop ranges, multiway decisions.

**Audit — reusable infrastructure**

| Piece | Exists | Reachable at runtime? |
|---|---|---|
| Versioned schema + validator (`src/data/trainingScenarioSchema.ts`) — legality, board/card counts, duplicate cards, EV-vs-epsilon consistency, structural fingerprints | Yes, thorough | **Yes** — imported by `trainingEngine.ts`, ships in the bundle. Strongest asset. |
| Authoring/preview CLI (`scripts/training-scenario-tool.ts`, `scripts/training-tools/core.ts`) incl. bulk seeded simulation | Yes | **Dev-only** — pure logic is reusable but the module is not shipped |
| Calibration benchmark (`src/lib/trainingCalibration.ts`) | Yes | Bundle-reachable but only exercised by dev scripts/tests |
| Equity estimator (`src/modes/rational.ts`, sliced + worker) | Yes, substantial | **Yes** — already shipped and running off-main-thread for AI. **Zero coupling to Training today** |

**Guarantees that must survive generation**
- Versioning — stamp generated content with schema/content versions.
- Legality — reuse `validateTrainingScenario` at runtime.
- Source/reviewer metadata — **substantively unmet today** (all 12 are `review.status:"pending"`). A generator with no human in the loop satisfies the shape but not the spirit; decide and document the policy.
- Tolerance checking — reusable.
- Duplicate detection — today it is **strict-equality fingerprinting**, so a one-chip difference passes while still feeling repetitive. A **near-duplicate/similarity** rejection is required and does not exist.
- Deterministic replay — the checkpoint persists only a `scenarioId`. Generated scenarios must be persisted **verbatim**, not regenerated from a seed on load, or replay breaks.
- EV-regret grading — reusable, but requires the generator to compute real EVs, which requires the equity estimator.

**Acceptance criteria**
- [ ] Selection/generation is constraint-driven with an explicit reject stage.
- [ ] The validated 12-scenario bank is **retained**, not discarded, when generation is added.
- [ ] Near-duplicate rejection exists.
- [ ] Generated scenarios persist verbatim for replay.
- [ ] Every guarantee above is enforced, with the reviewer-metadata policy decided in writing.

**Risks / constraint — iOS parity**
`scripts/export-ios-training-bank.ts` statically snapshots the bank into
`ios/.../training-scenarios.json`, with a release gate
(`release:verify-ios-training-bank`) that fails if the checked-in JSON does not
byte-match a fresh export. Runtime generation has **no representation** in this
pipeline, and iOS consumes static JSON without an equivalent constraint-solving
runtime. Three options, each a product decision: ship the generator into the
JavaScriptCore bridge; pre-generate a larger frozen corpus at build time and drop
true generation; or explicitly sacrifice desktop/iOS Training parity. **Decide
before implementing.**

---

## Epic E16 — Adaptive Training difficulty (P5)

### E16-001 — Make Elo actually drive difficulty

**Status (2026-07-25)** — Implemented and covered by deterministic unit tests.
`decisionElo` and `mathElo` now independently score authored decision/math
difficulty during start and next-scenario selection; see
`docs/training-adaptive-difficulty.md`.

**Historical audit** — **Elo was write-only telemetry.** `decisionElo`/`mathElo` were read only
as inputs to `calculateEloDelta`/`gradeTrainingAttempt`
(`trainingEngine.ts:297-330`) and displayed on the Dashboard
(`Dashboard.tsx:595-600`). Grep-confirmed: no file passes either into any
selection path. The authored `difficulty` field (1-5) is used in exactly one
place — an `−8`/point tie-break (`trainingEngine.ts:426`) — never gated by player
rating. A player at 1000 or 2500 gets the same fixed cycle, and cannot reach the
bank's hardest scenario unless it happens to be their arbitrary start.
Classification: **MISSING FEATURE** (never built, so not a regression).

**Desired behavior** — Keep the player near the edge of their skill: not spamming
obvious calls, not facing impossible or noisy decisions; closer decisions as
Decision Elo rises; more complex math as Math Elo rises.

**Difficulty inputs to consider** — gap between best and second-best action EV;
EV-regret sensitivity; equity distance from the pot-odds threshold; number of
opponents; number of draws; stack depth; bet-sizing complexity; tournament
pressure; side pots; street; required mathematical operations.

**Acceptance criteria**
- [x] Decision Elo and Math Elo are inputs to selection.
- [x] Difficulty escalates as ratings rise and de-escalates on struggle.
- [x] Low-rated players are not given impossible spots; high-rated players are not given trivial ones.
- [x] The algorithm is documented, including the Elo→difficulty mapping.
- [x] Math difficulty and decision difficulty adapt independently.

**Tests** — [x] Unit: rising Elo yields measurably harder selections. [x] Unit: a low-Elo player never receives the hardest tier. [x] Unit: a high-Elo player never receives the most trivial tier. [x] Unit: deterministic inputs reproduce selections.

---

## Epic E17 — Training feedback (P5)

### E17-001 — Show the mathematics instead of "Strong decision"

**Audit** — `FeedbackPanel` (`PokerTable.tsx:581-679`) shows a verdict header, raw
Elo deltas, and — **when correct or close** — only the static authored
`actionReason` (`:636-637`). `regret` and `bestAction` appear **only when wrong**
(`:638-642`). So the common case (correct) shows no math at all.

**Computed but never surfaced** (all present in `GradedTrainingAttempt` /
`ActionEvaluation`, `trainingEngine.ts:35-45,169-199`): `bestEv`, `chosenEv`,
`regret` on correct/close answers, the full authored `actionEvs` map for every
legal action, pot size and cost-to-call assembled into a required-equity
statement, and the numeric partial-credit score. Estimated hand equity versus the
stated villain range is **never computed at all** for Training — the shipped
equity estimator has no Training coupling.

**Acceptance criteria**
- [x] Feedback shows action chosen, recommended action, pot size, cost to call, **pot odds**, **estimated equity**, required equity, EV of every modeled action, EV regret, and whether the decision was close.
- [x] It explains **why** the best line was best, computed from the numbers: "{best} wins because it is worth X bb against {runner-up} at Y bb — a margin of Z bb." This is shown regardless of whether the answer was right, so the reasoning is not reserved for mistakes.
- [x] It shows how the calculation changes under reasonable assumptions: the panel states how many points above or below the required equity the decision sat, and roughly how large a change in read would flip it.
- [x] Math is shown on correct answers too — the whole analysis section renders for correct, close, and wrong outcomes alike.
- [x] Answer formats are untouched; the parser suite is unchanged and green.

**Estimated equity — the assumption is stated, not invented.** Training
scenarios author hero cards and a board but **no villain range**, so there is
no stated range to run against. `estimateTrainingEquity` measures equity
against a uniformly random opponent hand over a deterministic 400-simulation
sample seeded from the scenario id, and the panel labels it exactly that way
("vs a random hand", with the simulation count and a note that it is a baseline
rather than a read). Fabricating a range to produce a more impressive number
would have made the figure worse, not better.

**Tests** — [x] Unit: every listed value renders for correct, close, and wrong outcomes, including the new pot-odds, equity, why, and sensitivity lines. [x] Unit: equity is deterministic for a given scenario. [x] Unit: parser regression suite stays green (unchanged). [x] Accessibility: the panel is a polite live region with a labelled analysis section and stays mounted until the player advances.

---

## Epic E18 — Post-round game review (P4)

### E18-001 — Architecture: derive the review from existing replay data

**Verdict from the audit** — The review **can** be derived for state
reconstruction, **cannot** be derived for the judgment/math half without new
computation, and **cannot** show opponent showdown cards at all until E03-002
lands.

**Existing data (reusable)**
- `TournamentRunnerReplay` (`tournamentRunner.ts:512-531`): format, versions, `policySimulations`, kind, eventId, mode, **seed**, hero, careerResults, full `blindSchedule`, and `actions: TournamentReplayAction[]`.
- `TournamentReplayAction` (`:37-40,73-77`) records **hero decisions only**: action, `raiseTo?`, `decisionElapsedMs?`, `nowMs`.
- The engine is fully deterministic — no `Math.random()` in `src/modes` or `src/engine`; seeded Mulberry32 (`engine/deck.ts:43-66`). `restoreTournamentRunnerReplay` (`:572-612`) provably regenerates the entire session — opponent decisions, board deals, pots — bit-for-bit from seed + hero actions, asserted by `tournamentReplay.test.ts:54-60`.
- **Therefore opponent actions need not be stored** — they are re-derivable. Do not build a second hand-history store.

**Minimum new work required**
- [x] A derivation layer (`src/modes/handReview.ts`) that replays the log and, at each hero decision, reconstructs the public state and computes pot-before, cost-to-call, pot-after, equity, EV per legal action, EV regret, a notable classification, and a correctness/error magnitude. Ephemeral, not persisted.
- [x] Showdown reveals (E03-002) — landed earlier this session.
- [x] Segmentation keys (street, phase, risk bucket, decision type) computed as review output.
- [x] **A version-drift guard.** `restoreTournamentRunnerReplay` checks only `format`, `version`, and `policySimulations` bounds (`:575-582`) — it does **not** check `engineVersion`/`contentVersion`/`policyVersion`, unlike the export path which does strict equality (`replay-export.cjs:162-166`). A future engine change could silently corrupt reconstruction instead of failing closed.

**Restart survival — correction to a prior assumption**
A completed tournament's replay **does** survive restart today. `save-store.cjs:100-121`
writes `replay` into the on-disk autosave; `App.tsx:337-353` restores it at
startup as an exportable (not resumable) replay; `App.tsx:1446-1466` deliberately
does not clear it on ceremony exit. It is cleared only by Reset/Import or by
starting a new event. So review can consume the same object already flowing
through `loadStartup`/`lastPublicReplay`. Only the version-drift guard is open.

**Recommended storage architecture**
Derive on demand from replay + seed using the existing deterministic engine and
existing sliced/worker equity estimator; hold computed annotations **ephemerally**
for the open review session only; persist **aggregates only** (extend
`PlayerProgress`, which today has no tournament-hand data — `results` covers
Training only). This avoids a parallel database and matches the existing
"one active replay envelope, aggregates persist" pattern.

**Performance constraint** — Recomputing EV per decision is not free:
`docs/rational-equity-work-budget.md:64-71` measures median 382 ms at 700
simulations and 663 ms at 1,200 on the reference machine. A full round's review
must be **sliced/backgrounded**, never synchronous on the UI thread.

**Privacy constraint** — Because determinism ties every card to the seed, anyone
with the **private** checkpoint can recompute every player's cards for every
hand, including never-shown folded hands. The public export strips the seed for
exactly this reason (`docs/replay-export.md:9-13`, asserted in
`replayExport.test.ts:180-193`). Any in-app review built on the private checkpoint
**must reapply viewer-scoped redaction** (`createInformationSet`) at every
reconstructed decision point — it must not expose replay-computed full state.

**Acceptance criteria**
- [x] Review derives from existing replay data; no second hand-history system is created. Two derivations of the same replay agree exactly, which they could not if anything outside the replay were feeding it.
- [x] Annotations are ephemeral; only aggregates are eligible to persist. Nothing in `handReview.ts` writes to a save boundary.
- [x] Viewer-scoped redaction is applied at every reconstructed decision point via `createInformationSet(..., heroId)`, and `assertReviewIsRedacted` makes it a checkable property rather than a convention.
- [x] Version-drift guard added, failing closed. `restoreTournamentRunnerReplay` now enforces strict `engineVersion`/`contentVersion`/`policyVersion` equality (matching the export path) and throws `TournamentReplayVersionError`; the review refuses the same replays.
- [x] Recomputation is sliced and cancellable - an abort signal checked at each decision boundary, with the screen driving it from an `AbortController` torn down on unmount.

**Tests** — [x] Unit: reconstruction at a decision matches an independently rebuilt live state (hand id, pot, board). [x] Privacy: only the hero's own cards are present at any decision, and no board card appears before it was dealt. [x] Unit: version mismatch fails closed on both the review and reconstruction paths. [x] Unit: cancellation stops at the first boundary; a pre-aborted derivation does zero work.

### E18-002 — Full decision review and notable-decision playback

**Acceptance criteria**
- [x] Every hero decision is inspectable across all four streets and all six action types.
- [x] A "Noteworthy only" filter restricts the timeline to decisions worth stopping on, each labelled with why it matters. Timed auto-advancing playback is **not** built; the filter plus keyboard stepping covers inspection.
- [x] Notable spots cover close correct calls, disciplined folds, mistakes and large mistakes, bluffs, missed value, major all-in decisions, and high-EV decisions under pressure. "Recurring weakness" is not detected - it needs cross-round aggregates that do not exist yet.
- [ ] Pacing target ≈ one highlighted decision per 2-4 hands (a target, not a rigid quota — most preflop folds are not educational).

**Tests** — [x] Unit: notable classification and the notable filter on a derived round. [ ] Unit: highlight density lands near the target across many seeds.

### E18-003 — Decision timeline

**Acceptance criteria**
- [x] A scrollable timeline lists every decision with hand number, street, action, pot size, quality classification, and notable flag. It sits left of the detail pane rather than right - the detail column is the wider one and reads better on the right.
- [x] Each entry carries a non-colour glyph **and** the quality written out in words; the colour border is supplemental.
- [x] Click any decision; arrow keys step backward and forward; `M` jumps to the next mistake; "Noteworthy only" and "Mistakes only" filter the list; street segments filter it too.
- [x] Screen-reader descriptions for quality and magnitude - quality is real text in every entry, and the detail pane is an `aria-live` region.

**Audit note** — The existing hand-history popover (`PokerTable.tsx:2005-2034`) is
a flat narrative `string[]` for the current hand only. It is **not a suitable
base** and should be replaced rather than extended.

**Tests** — [x] Unit: every hero decision appears and filters return correct subsets (`handReview.test.ts`). [x] Accessibility: arrow-key navigation and non-colour quality indicators (`HandReviewScreen.test.tsx`).

### E18-004 — Reconstructed state and mathematical explanation

**Acceptance criteria**
- [x] Selecting a decision reconstructs hero cards, board, pot, cost to call, tournament phase, blind level, and players remaining, all from the redacted information set.
- [x] **Cards unknown at the decision point are not revealed** merely because they were revealed later — asserted by a test that walks each hand and requires the board to only ever grow.
- [x] The view separates what was known (cards, board, pot), what the model thought (per-action EV and rationale), and the verdict (quality band, EV given up).
- [x] Math shown: pot before, cost to call, pot after calling, pot odds, required equity, estimated equity, fold equity, EV of every action considered, EV regret, SPR, and tournament pressure. Confidence is expressed as the disclosed simulation count.
- [x] Understandable to a learner: every value is a labelled row in plain words ("Equity you needed", "Chance they fold", "EV given up") rather than jargon.
- [x] **No claim of perfect GTO correctness** — a standing notice states these are the game's own bounded estimates and that close calls should be treated as close.

**Tests** — [x] Unit: future information is absent from a reconstructed decision. [x] Unit: approximation labels present. [ ] Unit: side-pot reconstruction in review is not separately asserted.

### E18-005 — Accuracy rating and segmentation

**Acceptance criteria**
- [x] An overall accuracy score per round, plus mean EV given up.
- [x] Segmented by street, tournament phase (early/middle/late/qualification/heads-up), risk bucket (low/medium/high/all-in), and decision type.
- [x] Clicking a street segment filters the review to those decisions.
- [x] **Sample counts are always shown, and a segment below 8 decisions is explicitly marked "too few to read into"** rather than presented as a finding.
- [ ] Long-term aggregates persist and are surfaced in `PlayerRecord`. Not built - the review is per-round only.

**Tests** — [x] Unit: segment assignment partitions the decision set exactly (street counts sum to the total). [x] Unit: accuracy stays in [0,1] and small samples are flagged unreliable at the documented threshold.

### E18-006 — Wire the already-scaffolded entry point

**Audit** — `TournamentCeremonyProps.onReview` and the label
`dashboard.ceremony.reviewKeyHand` already exist
(`Dashboard.tsx:616-624,690-694`) but `App.tsx:1428-1465` never passes
`onReview`, so the button never renders. Do **not** confuse this with
`PokerTable.tsx:2197`'s `onReview={resetHand}`, which is a Training retry.

**Acceptance criteria**
- [x] The ceremony's review affordance renders and opens the review. `App.tsx` now passes `onReview` whenever a replay for the completed round exists, and a `hand-review` screen renders the code-split `HandReviewScreen`.
- [x] A new `HandReview` state is added to `docs/desktop-game-state-machine.md` with explicit Back and mid-review quit/background behaviour, plus a row in the Back/Cancel transition table.
- [x] Review re-derives from the persisted replay after a relaunch. It consumes the same `lastPublicReplay ?? activeReplayRef` object that startup restores from the on-disk autosave, so no new persistence was required.

**Tests** — [x] `HandReviewScreen.test.tsx`: the entry point is wired; derivation aborts on leave; the estimate notice and per-decision basis render; quality is carried by glyph and words as well as colour; keyboard navigation including jump-to-next-mistake; every promised mathematical row renders; small samples are marked; the state machine documents the state.

---

## Epic E19 — Career resume behavior (P6)

### E19-001 — Persist career progress and resume the active event

**Observed problem**
The player had progressed to Circuit Main, but selecting Normal later recommended
Local Qualifier — making career feel like a generic unlock menu.

**Audit — root cause, exact**
- `App.tsx:267` — `const [tourResults, setTourResults] = useState(emptyTourResults)`; `emptyTourResults` is `{ normal: [], rational: [] }` (`:128-134`). Updated only in memory after a result (`:708-726`).
- **Never persisted.** `persistBoundary` (`:402-438`) only ever writes `settings`, `progress`, and a `replay` checkpoint.
- `PlayerProgress` (`src/types/poker.ts:89-103`) has **no field** for career event history or an active event.
- `unlockedCircuit` exists and is migrated (`saveMigration.ts:362-366`, default 1 in `storage.ts:42`) but is **never read** by any event-selection code — a vestigial field that looks like the missing bridge.
- `Dashboard.tsx:442-446` computes `initialEvent` from `careerResults` (`= tourResults[tourMode]`, `App.tsx:1531`); with an empty array nothing is qualified, only `local-qualifier` is unlocked (`tournamentSession.ts:300-302`), so it always falls back to Local Qualifier.
- Secondary defect: `tourResults` is **keyed per mode**, so Normal and Rational progress are mutually invisible even in one session.
- **Confirmed in the real save**: `unlockedCircuit: 1` despite tournament play (`tournamentElo: 1017`).
- Classification: **EXISTS BUT DISCONNECTED**.

**Acceptance criteria**
- [x] Career progress and an explicit **current/active event** persist in the versioned save with migration. `PlayerProgress.career` holds a `CareerTrack` per mode (`results` + optional `activeEventId`); the field is optional so no version bump is needed and every existing save migrates to empty tracks.
- [x] Mode entry prioritizes: resume current active event → continue the next required event → fall back to anything unlocked (`TourLobby`).
- [x] Current championship progress is clearly shown — the lobby header states "N of M events qualified" plus either "Resuming <event>" or "Next up: <event>".
- [x] Event selection remains available as a secondary action — the route list is unchanged and every unlocked event is still selectable.
- [x] `unlockedCircuit` decision: **retained as a derived display value, explicitly not the source of truth.** Unlocking is decided by `career`. It was previously written and never read, which is exactly what made it look like the missing bridge; the type now documents that, and removing it outright would have broken existing saves for no benefit.
- [x] The Normal/Rational keying decision is deliberate and documented: **separate tracks**, because they are different opponent models and a qualification earned against Normal is not evidence of readiness against Rational. Merging them would let the harder ladder be unlocked using the easier field. Documented on `CareerTrack`.
- [x] Progress survives restart — it is written at the same `persistBoundary` calls as Elo, on both event start (active event) and event completion (result).

**A second schema mirror had to be extended.** `electron/save-transfer.cjs`
validates imported saves against its own field allowlist in the main process,
so `career` was silently stripped on import until `validateCareer` /
`validateCareerTrack` / `validateCareerResult` were added there too. A test now
asserts the mirror stays in sync.

**Tests** — [x] Unit: progress round-trips through save/migration (`careerPersistence.test.ts`). [x] Unit: legacy saves without the field migrate to empty tracks; malformed entries are discarded without rejecting the save; a replayed event supersedes its earlier result. [x] Unit: Normal and Rational stay on separate tracks. [x] Regression: a gate asserts career state is derived from persisted `progress` and that `setTourResults` (the ephemeral state that caused the defect) is gone, plus a gate asserting the main-process validator mirrors the schema. [ ] Integration: a live relaunch-and-resume end-to-end check in the packaged build (belongs with E25-003).

---

## Epic E20 — Career transition and horizontal progression (P6)

### E20-001 — Continuous championship journey

**Acceptance criteria**
- [ ] After completing or qualifying, the game shows the result, qualification, Elo change, and what comes next, then moves naturally toward the next event.
- [ ] It does not return to a disconnected menu unless the player chooses to exit.

### E20-002 — Horizontal event progression

**Audit** — Confirmed vertical: an `<ol>` of stacked `<li>` rows joined by a 1px
vertical connector (`Dashboard.tsx:468-506`, `styles.css:5577-5619`). States are
already distinguished by icon + text + border, which is reasonably
color-independent — but there is no persistent "current event" marker distinct
from "selected in the list", because no such data exists (E19-001).

**Acceptance criteria**
- [x] The route reads left-to-right across the lobby, with each event on its own slot rather than a stacked `<ol>`.
- [x] A horizontal route/progress line connects them, filled up to the current event's slot centre.
- [x] A marker moves along the line as events complete — verified by rendering two career states and asserting the marker advances.
- [x] Completed, current, and future states are distinguished by a `data-stage` attribute, a distinct glyph (check / chevron / index number), a node style, **and** an explicit text label, so the route survives colour removal.
- [x] Depends on E19-001 for a real "current event" value — now satisfied; the marker follows the persisted active event when there is one.

**Tests** — [x] `TourRoute.test.tsx`: horizontal layout and the progress variable; the marker advances with completion; all three stages are labelled in text; resuming an active event is preferred over recommending the next; the qualified count renders.

### E20-003 — Physical travel between events

**Acceptance criteria**
- [ ] Finish the event → pull the camera from the seat → rise above the room → move through the venue → display the horizontal progress path → animate the marker → travel toward the next area → descend into the next seat → begin the next event.
- [ ] Skippable, with a reduced-motion alternative.
- [ ] Staged implementation is acceptable: reuse one venue with changed tables, lighting, crowd, signage, and roster rather than modeling a separate room per event.
- [ ] Depends on E09-001's architecture decision.

---

## Epic E21 — Tutorial removal or reduction (P7)

### E21-001 — Decide and execute removal-versus-reduction

**Context** — The target audience already understands poker. Do not invest in a
beginner course. Preferred direction: remove the full tutorial, or reduce it to a
very short optional controls orientation.

**Audit — footprint and impact**
- `src/lib/playableTutorial.ts` (110 lines, a 7-step reducer over a single hardcoded hand), `src/components/PlayableTutorial.tsx` (344 lines), `src/lib/playableTutorial.test.ts` (143 lines, 10 tests) = **597 lines**, plus ~30 `tutorial.*` locale keys (`en-US.messages.gameplay.ts:123-184`) and `shell.loading.tutorial`.
- Entry: a CTA **below** the mode grid (`Dashboard.tsx:325-333`).
- **Correction to a prior assumption:** the mode grid is `repeat(4, ...)` (`styles.css:4910-4913`), not five columns; the tutorial is a separate link, not a grid cell. Removal does **not** require reflowing the grid. (The only `repeat(5, …)` is at `styles.css:3545`, for bet presets.)
- Files needing updates on removal: the three tutorial files; `App.tsx` (`"tutorial"` screen type/branch `:120,1266-1281`, lazy import `:99-101`, entry `:1492-1495`); `Dashboard.tsx` (CTA `:325-333`, `onSelect` union `:226`); `styles.css` (`.mode-stage__tutorial-link*` `:5189-5212` and all `.tutorial-*` rules); the locale keys; `PseudoLocaleScreens.test.tsx:225-227`; `RtlDirectionScreens.test.tsx:136-137`; `DesktopContrastTargetAudit.test.ts:187-232` (pins tutorial buttons as documented 44px targets); `DesktopScreensAccessibility.test.tsx:53-70` (asserts 4 mode choices plus the tutorial CTA text and its position).

**Acceptance criteria**
- [ ] A documented decision: full removal or reduction to a controls orientation.
- [ ] Every file above is updated; no dead locale keys, CSS, or test assertions remain.
- [ ] The suite stays green and the contrast/target audit still covers real controls.

### E21-002 — Preserve the contextual-prompt system

**Audit** — `src/lib/contextualPrompts.ts` (283 lines) is **fully self-contained**:
own types, detector, priority order, persistence key, wired into `PokerTable.tsx`
at runtime (`:1174,1237`). **Zero imports** to or from the tutorial. This is a
clean, safe removal boundary.

**Acceptance criteria**
- [ ] Contextual prompts for all-in, side pot, min-raise, blind increase, elimination, qualification, Elo change, short stack, and decision mistake survive removal intact.
- [ ] Prompts remain manually dismissible and replayable.
- [ ] The once-ever `seen` behavior is reconsidered for recurring teaching moments (see E05-004).

### E21-003 — Extract a real standalone poker reference

**Audit — a checked Part II item is not true.** There is **no** standalone
reference/glossary/rules screen. Searches for hand-ranking content, glossary
components, and rules locale keys find only engine logic and in-table formula
labels. The nearest thing is the tutorial's step-5 glossary (chips/pot
odds/equity/EV) and the live in-table math HUD, which is only available during a
hand.

**Acceptance criteria**
- [ ] A standalone, always-reachable reference exists with hand rankings, betting terms, probability shortcuts, tournament terms, and worked examples.
- [ ] It is reachable outside a hand (menu and pause).
- [ ] Tutorial glossary content is **extracted before** the tutorial is deleted, so it is not lost.
- [ ] Part II's poker-reference item is corrected to reflect reality.

### E21-004 — Optional "How this trainer works" orientation

**Audit** — Mode taglines exist (`modes.*.description`, rendered
`Dashboard.tsx:260-321`) but are marketing-length. `PlayerRecord`
(`Dashboard.tsx:574-614`) shows the three Elo values as raw numbers with no
explanation. No surface explains the trainer end-to-end; this is new copy on
existing screens, not true reuse.

**Acceptance criteria**
- [ ] An optional orientation explains Normal, Rational, Training, Timed Table, Decision Elo, Math Elo, and the accuracy review.
- [ ] It is skippable and replayable.
- [ ] It explains **what each mode optimizes**, including that Rational uses only information legally available to its seat.

---

## Epic E22 — Audio and emotional payoff (P1)

### E22-001 — Add the missing win cue and the unwired game moments

**Observed problem** — Wins feel lackluster.

**Audit — confirmed at the code level**
- Exactly **six** cues exist: `click`, `chip`, `fold`, `success`, `error`, `deal` (`src/lib/audio.ts:1-7`).
- **There is no win sound at all** — not disconnected, never designed. In tournament play, winning a pot plays nothing: `PokerTable.tsx:1654-1677` and `:1911-1928` feed only the aria-live announcer and a CSS class. `success` plays only in the Training grading branch (`:1240`), which does not exist in Normal/Rational/Timed.
- `Dashboard.tsx` **never imports** `gameAudio`, so the entire end-of-event ceremony is silent and has no celebratory animation (`.ceremony-board*` rules are static typography).
- The `wonPot` → `is-winner` class (`PokerTable.tsx:360`) has **no matching CSS rule anywhere** — a dead class.
- The one thing that does render, the `.seat-state--winner` badge (`styles.css:3184-3186`), has its animation zeroed under `data-motion-table="off"` (`:5153-5156`) — which the player's settings had set.
- `deal` fires only on **screen entry** (`App.tsx:758,788,918,934,1495`), never per hand or per card.
- No cue for: board cards, chips collected, winning, losing, side pot, elimination, qualification, Elo change, blind increase.
- Defaults are audible (`storage.ts:9-12`: master 100, effects 70, unmuted), so this is not a volume problem.
- Music is correctly dormant (`musicPlaylistManifest.ts:1-23`, empty manifest) and is architecturally independent of effects — it is **not** the cause.

**Acceptance criteria**
- [x] Restrained poker-native cues exist and fire for dealing (per hand and per board card), chips moving, bets and raises, folds, all-ins, board reveals, **winning a pot**, side-pot formation, and elimination. The cue set grew from six to nine (`win`, `all-in`, `eliminated` added), routed from `publicPresentationSound` off the public presentation event stream.
- [x] The end-of-event ceremony has audio (`tournamentResultAudioCue`, keyed to public result fields) and visual payoff (a settling entrance, plus a warm rim and flare on a win).
- [x] The dead `is-winner` class is styled.
- [x] Winning is perceptible with motion on **and** with reduced motion. Under `data-motion-transition="off"` the movement is dropped but the win *state* — the warm rim and the flare's resting glow — is retained, so the outcome never depends on an animation the player has disabled.
- [x] All cues route through the single `gameAudio.play` path, which already honours master/effects volume, mute, first-input gating, pause, blur, suspend, and silent fallback.
- [x] Music remains absent pending licensing — the manifest is still empty and untouched.

**Tests** — [ ] Unit: each listed moment triggers its cue. [ ] Unit: silent fallback when audio init fails. [ ] Accessibility: every meaningful audio cue has a visual equivalent, and critical visual-only changes have optional audio equivalents.

### E22-002 — Add an automated audio-tell guarantee

**Audit** — The no-tell guarantee is only a **code comment** (`audio.ts:125-129`).
`audio.test.ts` has no test asserting it. Today no tell exists because every cue
keys to a public action or a Training grading outcome — but nothing would catch a
regression, and a naive "add a win sound tied to hand strength" fix would
introduce one. Classification: **TEST-COVERAGE GAP**.

**Acceptance criteria**
- [x] A test asserts cue selection is invariant to hidden information: the nuts and 7-2 offsuit produce identical cues at both `all-in-reveal` and `showdown`, and the ceremony cue depends only on finish place and qualification.
- [x] The test fails if a cue is ever keyed to hand strength. Two layers: behavioural (same cue across opposite holdings, hand categories, and pot sizes) and structural (the selector's body may read `event.kind` and `event.command.type` and is asserted **not** to reach `.cards`, `.reveals`, `.holeCards`, `.rank`, `.suit`, `.hand`, `.equity`, `.category*`, `.amount`, or any `evaluate*()` call).
- [x] Cues create no timing tell — every cue is emitted from the public presentation event stream on the same clock the visuals use, so a cue cannot fire at a moment the interface has not already disclosed.

**Note on the structural guard.** The first version of it searched for bare
substrings and failed on `"hole-cards-dealt"` — a legitimate public event-kind
name that merely contains the word "cards". It now matches property *accesses*,
which is what an actual leak would look like.

---

## Epic E23 — Accessibility preservation (cross-cutting, always in force)

### E23-001 — Do not regress accessibility while rebuilding presentation

**Constraint** — Every change in E01-E10 must preserve: screen-reader semantics;
accessible action controls; named seats; card, pot, and side-pot announcements;
focus visibility; keyboard parity; controller parity; reduced motion; text
scaling; non-color indicators; and persistent explanations.

**Specific hazards identified**
- The current a11y layer is entirely DOM-based. A canvas/WebGL scene has **no DOM for assistive technology**, so named seat groups (`playerSeatAriaLabel`, `PokerTable.tsx:294-323`) and live regions (`:1712,1720,1811,2243`) must be maintained as an **invisible parallel DOM layer** synchronized to the scene — permanent added surface, not a free port.
- Live-announcement debouncing is DOM-timing dependent; a rAF-driven render loop runs on a different cadence and would need re-validation.
- Reduced motion is CSS-driven today; a 3D scene's camera and rig motion is not CSS-controllable and needs an equivalent path built and verified inside the engine.
- Any in-scene focusable control needs a synchronized focusable DOM proxy — canvas content is not natively focusable.
- The contrast/target audit is a static source-level CSS check and **does not extend to canvas pixels**; a rendered-pixel verification method would be needed (precedent exists in the flash/luminance analysis).
- **`display:none` removes content from the accessibility tree** — the hero-stack defect (E02-001) was simultaneously a visual and an assistive-technology failure. Never hide state-bearing elements this way.

**Acceptance criteria**
- [x] Each E01-E10 task records its accessibility impact and verification in its own **Tests** line, rather than in a separate ledger that would drift from the work.
- [x] The existing accessibility test suites stay green throughout — `DesktopScreensAccessibility`, `DesktopContrastTargetAudit`, `PokerTable.accessibility`, and `DialogFocusContract` all pass after every change this session.
- [x] New presentation states are announced without reading decorative scenery. Everything added for depth or character — the room-depth planes, the seated figures, the ceremony flare — is `aria-hidden`, because none of it carries information that is not already exposed as text.
- [x] Announcements never leak hidden information: the reveal sweep (E03-002), the audio-tell guard (E22-002), the gesture-signature guard (E10-002), and the review redaction assertion (E18-001) each enforce this on a different surface.
- [x] Keyboard-only and controller-only paths remain complete for every new affordance. The camera gained a pointer recenter to match its existing keyboard/controller bindings, and the review is fully arrow-key navigable with a jump-to-next-mistake key.

---

## Epic E24 — Determinism, privacy, and security (cross-cutting, always in force)

### E24-001 — Preserve core guarantees

**Constraint** — These must survive all Part I work: offline operation; no
telemetry; no accounts; no payment path; no remote assets; deterministic
shuffling; deterministic replay; strict legal betting; side-pot correctness; chip
conservation; hidden-information redaction; worker cancellation; stale-result
rejection; save recovery; crash-safe autosave; safe mode; secure Electron
boundaries; production package integrity.

**Acceptance criteria**
- [x] The frozen bot-league baseline changed **once**, through the documented sanctioned workflow, with before/after evidence recorded in `docs/bot-league-regression-harness.md` under "Baseline replacements". Replay determinism tests stayed green and were strengthened by the new version-drift guard.
- [x] The offline build audit passes: 0 remote references, 7 CSP directives verified.
- [x] No new dependency was added. Everything this session — the AI harness, the review derivation, the procedural characters, the room depth — is built from what was already in the tree.

### E24-002 — Never leak hidden cards through new surfaces

**Constraint** — Opponents' hidden cards must not appear in logs, review data,
accessibility announcements, AI inputs, diagnostics, exported saves, or public
replay files. A showdown may display cards **only** when the rules and engine
declare them public.

**Specific hazard** — Determinism means the seed reconstructs every card. The
private checkpoint retains the seed (`save-store.cjs` forbids `deck`,
`holeCards`, `opponentCards`, etc. but **not** plain `seed`), while the public
export strips it deliberately. Any review or replay consumer built on the private
checkpoint must reapply viewer-scoped redaction at every reconstructed point.

**Acceptance criteria**
- [x] Review, all-in presentation, showdown reveal, character animation, **and audio** each have a privacy test: `handReview.test.ts` (redaction plus no-future-information), `tournamentRunner.test.ts` (the leak sweep and reveal scoping), `PokerTable.characterGesture.test.ts` (signature guard), and `PokerTable.audioTell.test.ts` (cue invariance).
- [x] Reveals have a single gate, and it is the presentation event stream rather than the `revealed` flag — see the architecture decision recorded under E03-002. The flag is retained as the redaction contract; the emitters are the only producers of reveals, and both filter to non-folded players at a legal reveal point.
- [x] The public replay allowlist remains strict; `replayExport.test.ts` asserts the seed, hero id, player name, hole cards, deck, local paths, and free-form text all stay absent from an export.

---

## Epic E25 — Packaged verification and perceptual gates (cross-cutting)

### E25-001 — Add a perceptual gate that can actually fail on flatness

**Audit — why the build "passed everything" while feeling poor**
None of the existing packaged gates assert anything about presentation:
- `audit-packaged-render-smoke.mjs:99-131` asserts zero fatal events and that `#root` is non-empty. **A fully static, silent render passes identically to an animated one.**
- `audit-packaged-input-smoke.mjs` asserts end states are reached and explicitly widens polling to *tolerate* animation variance; it never asserts animation occurred. Its six-seat collision gate (`:326-354`) is a **static one-time `getBoundingClientRect()` snapshot**.
- `audit-packaged-mode-completion.mjs` proves functional completion only.

Classification: **TEST-COVERAGE GAP** — the gates were built to prove
correctness and stability, not perceptual quality.

**Progress (2026-07-25).** `audit-packaged-flash-capture.mjs` now runs the
shipping package in full-motion and reduced-motion passes and fails unless it
observes a non-zero public chip-travel animation after a real Call, a visible
hero-fold state before a result strip, progressive public board counts, a
dealer-button movement, and one stable table DOM node across each captured
burst. The verified run observed 560 ms chip travel and 820 ms dealer travel
in full motion, versus the 120 ms reduced-motion state-feedback path. CDP
timeout classification remains open.

**Acceptance criteria**
- [x] A packaged gate captures frames across a hand and asserts that intermediate states exist: board cards appear progressively rather than instantly; chips are observed in transit; the dealer button is observed moving; a fold is observed before its result. Verified in the packaged full-motion and reduced-motion captures on 2026-07-25.
- [x] The gate runs twice — full motion and reduced motion — with **different, tier-appropriate expectations** per E08, not "no animation" for both.
- [x] It asserts non-zero effective animation duration for the state-communicating tier.
- [x] It fails if the table subtree remounts during a hand (guards E01-001 against regression).
- [x] Flakiness is handled per the existing input-smoke precedent, and host-contention CDP timeouts are reported separately from genuine product failures. The perceptual capture exits with the explicit `inconclusive-cdp-timeout` outcome for a CDP deadline; other failures remain product failures.

### E25-002 — Replace the collision claim with a real, re-runnable gate

**Audit** — `work/table-collision-audit.json` has **no producing script in the
repo**; it is a one-off manual capture from 2026-07-23. Its checklist covers
opponent-side elements only and **excludes the hero stack, committed-bet labels,
the dealer button, and the side-pot display**. Only `heroCardRects` data is
retained; the other nine checks assert `"issues": []` with no underlying rects.
It measures axis-aligned bbox intersection at 0.5px and says nothing about
contrast, size, or legibility.

**Acceptance criteria**
- [x] A committed, re-runnable, CI-capable script produces the audit. Verified
  2026-07-25 with the packaged Windows smoke (`npm run
  release:audit-packaged-input` under the bundled Node 24 runtime); it now
  captures each supported desktop viewport and interface scale.
- [ ] Coverage adds: hero stack, hero and opponent committed-bet labels, dealer button, SB/BB markers, acting indicator, side-pot display, equity readout, and showdown highlight.
- [x] It verifies **visibility and minimum legible size**, not only non-overlap,
  for the live hero HUD and each visible opponent stack/bet/position/dealer
  indicator.
- [x] It runs at 1100×720, 1280×720, 1366×768, 1920×1080, 2560×1080 **and** at every interface scale. Verified with the packaged input smoke on 2026-07-25.
- [ ] Part II's "live geometry audit" wording is corrected.

### E25-003 — Verify in the packaged build, not only in dev

**Audit — packaged-vs-dev divergence mechanisms**: the `app.isPackaged` URL branch
(`main.cjs:47,173-177`); devtools disabled when packaged (`:107`), which is why
the owner could not inspect the problem; ASAR/custom-protocol asset resolution
(`:254`) — a mis-pathed asset fails silently only when packaged; lazy chunk load
failure over the custom protocol could strand a scene on
`SceneLoadingFallback`; safe mode forcing muted + reduced motion; and
`backgroundThrottling` left at Chromium's default `true` (`:100-111`), which
throttles rAF to ~1fps whenever the window is not foregrounded — identical in dev
and packaged, but it can make animation vanish during screen recording or when
another window takes focus. (A prior decision deliberately declined to set it
`false` because that conflicts with the pause-while-hidden power requirement;
revisit only with that trade-off explicit.)

**Acceptance criteria**
- [ ] Every Part I acceptance criterion is verified in the **packaged** build, not only the dev renderer.
- [ ] Verification covers normal and heavy CPU load, all supported resolutions, all UI scales, reduced motion, window blur, minimize, suspend/resume, and screen lock where possible.
- [ ] Any CDP transport timeout is recorded separately from a genuine product failure.

---

## Epic E26 — Hardware and human acceptance (deferred, not deliverable here)

### E26-001 — Deferred acceptance work

**Reason for deferral** — Requires hardware, assistive technology, external
authority, or credentials unavailable in this environment. These are **not**
skipped; they are gated.

| Item | Blocked on | Suggested phase | Acceptance target |
|---|---|---|---|
| Physical controller acceptance | A real gamepad | After E09-003 | Full flow operable by controller only |
| Windows Narrator / NVDA acceptance | Real AT on Windows | After E23-001 | Full hand comprehensible by screen reader only |
| 200% scaling, multi-monitor, DPI change, display disconnect | Multi-display hardware | After E25-002 | No clipping or focus loss |
| Low-spec / integrated-GPU / discrete-GPU matrix and 60-minute thermal soak | Three machine classes | After E09 | Within `config/performance-budgets.json` |
| Clean-machine install/upgrade/rollback/uninstall | Clean Windows VMs | Release freeze | Part II criteria |
| Authenticode signing, publisher identity, HTTPS host, update host | Legal publisher + certificate | Pre-release | Part II criteria |
| IARC / store metadata / press materials | Store accounts | Pre-release | Part II criteria |
| Licensed music masters, loudness, attribution | Licensing | After E22-001 | Part II criteria |
| Asset provenance for artwork and any new 3D assets | Rights research | Before E09-002 ships art | `config/asset-rights-ledger.json` resolved |
| Qualified poker-math review and consented human pilot | External experts + participants | After E16/E17 | Calibration no longer labelled synthetic-only |
| macOS/Xcode, Simulator, Instruments, TestFlight, App Store | A Mac | After desktop P0-P2 | Part II criteria |

---

## Part I traceability matrix

Every item from the review's "do not lose the small details" checklist, mapped to
its task. Nothing here may be dropped without an explicit deferral note.

| Detail | Task |
|---|---|
| Hero stack always visible | E02-001 |
| Current committed bet always visible | E02-002 |
| Amount to call visible | E02-002 (already present; improve prominence) |
| Dealer button visible | E02-003 |
| Blind position obvious | E02-003 |
| Opponent folds animated and labeled | E01-005 |
| Fold wins identify the winner | E04-003 |
| Chips visibly move to the winner | E05-003 |
| Bets visibly move toward the pot | E05-001, E05-002 |
| Pot values and chip movement synchronized | E05-001 |
| Side pots shown and explained | E05-004 |
| Hands continue after the hero folds | E04-001 |
| Skip optional rather than default | E04-002 |
| Hole cards visibly dealt | E01-003 |
| Flop visibly dealt | E01-004 |
| Turn visibly dealt | E01-004 |
| River visibly dealt | E01-004 |
| No blinking between streets | E01-001 |
| No full-screen reset between hands | E01-001, E07-001 |
| Showdown reveals live hands | E03-002 |
| Winning five cards highlighted | E03-001 |
| Winning hand named | E03-001 |
| Ties shown | E03-001 |
| All-in equity percentages shown | E06-002 |
| All-in percentages update card by card | E06-001, E06-002 |
| All-ins feel suspenseful | E06-001 |
| Every hand communicates win or loss | E03-003 |
| Next hand begins through continuous motion | E07-001 |
| Dealer button physically moves | E02-004 |
| Desktop feels spatial and three-dimensional | E09-001, E09-002 |
| Camera can look left and right | E09-003 |
| Camera can recenter | E09-003 |
| Room-arrival fly-through exists | E09-004 |
| Career travel uses camera movement | E20-003 |
| Event progression is horizontal | E20-002 |
| Current event resumes automatically | E19-001 |
| Current and next event clearly shown | E20-002 |
| Progress marker moves toward the next event | E20-002 |
| New tournaments have new rosters | E10-001 |
| Normal and Rational do not reuse identical opponents | E10-001 |
| Opponents vary in face, hair, clothing, body, name, style | E10-001 |
| Appearance does not determine behavior via stereotypes | E10-001 |
| Ten-plus raise chains investigated | E11-001, E11-002 |
| Raise-versus-call logic separated | E11-003 |
| Pot odds not the only decision input | E11-002, E11-003 |
| Normal AI feels like skilled human professionals | E11-004 |
| Normal AI not random or recklessly aggressive | E11-004 |
| Rational AI remains mathematically grounded | E12-001 |
| Tournaments do not collapse by hand sixteen | E13-001 |
| All-in frequency calibrated | E13-001, E14-001 |
| User win rate and exploitability investigated | E11-004 |
| LLMs as development critics, not live online opponents | E14-002 |
| Training does not repeat only three scenarios | E15-001 |
| All twelve existing scenarios audited | E15-001 (table included) |
| Training not solved by repeatedly pressing Call | E15-001 |
| Scenario difficulty adapts to Elo | E16-001 |
| Scenario generation/selection constraint-driven | E15-002 |
| Recent scenario duplicates avoided | E15-001, E15-002 |
| Training feedback shows calculations | E17-001 |
| Post-round review exists | E18-002 |
| Overall accuracy exists | E18-005 |
| Accuracy segmented by street | E18-005 |
| Accuracy segmented by tournament phase | E18-005 |
| Accuracy segmented by risk or bet size | E18-005 |
| Decisions can be filtered | E18-003 |
| Every decision in a right-side timeline | E18-003 |
| Good/bad decisions use accessible labels and icons | E18-003 |
| Arrow keys move through decisions | E18-003 |
| Playback shows noteworthy decisions | E18-002 |
| Routine decisions can be fast-forwarded | E18-002 |
| Review math includes pot odds, equity, EV, regret | E18-004 |
| Review does not reveal future information | E18-004 |
| Existing JSON/replay infrastructure reused | E18-001 |
| Redundant review storage avoided | E18-001 |
| Weak beginner tutorial removed or reduced | E21-001 |
| Accessibility setup remains | E21-002, E23-001 |
| Poker reference remains | E21-003 (**does not currently exist**) |
| Desktop and mobile presentation intentionally different | Design north star; E09-001 |
| Reduced motion remains supported | E08-001, E23-001 |
| No hidden information leaks | E24-002 |
| Offline/privacy guarantees intact | E24-001 |
| Packaged behavior verified, not assumed | E25-001, E25-003 |

### Parallelization and sub-agent assignment

- **Must be first, blocks nearly everything:** E01-001 (remount), then E01-002 (event queue). Single owner; do not parallelize these two.
- **Safe to run in parallel with E01:** E02 (table-state clarity — mostly independent rendering), E08 (motion policy), E00-003/E00-004 (settings and Elo defects), E19-001 (career persistence — save-schema work, no presentation coupling).
- **After E01-002 lands:** E03, E04, E05, E06, E07 can be split across owners by epic.
- **Independent of the presentation rebuild entirely:** E11-E14 (AI, pure engine/statistics), E15-E17 (Training), E18-001 (review derivation layer), E21 (tutorial), E22 (audio wiring).
- **Gated behind a decision:** E09-002+ and E20-003 wait on E09-001's architecture record. E15-002 waits on the iOS-parity decision.
- **Continuous, every task:** E23, E24, E25.
- **Research spikes:** E09-001 (presentation architecture), E11-001 (AI measurement), E14-002 (critic harness feasibility).





## Part II — Release, platform, and compliance backlog

The sections below predate the 2026-07-25 gameplay review and are preserved
unchanged. Cross-references from Part I point into these sections where the two
overlap.

## Now — desktop first

- [x] Build deterministic deck, hand evaluator, legal betting, side pots, blind
      structures, table balancing, and information-set redaction.
- [x] Build the researched Training Mode scenario bank and EV-regret grading.
- [x] Persist separate Decision Elo, Math Elo, response timing, and progress.
- [x] Accept table-style quiz answers such as `33%`, `0.33`, `1/3`, `2:1`,
      and `3:5` where the question unit makes the interpretation clear.
- [x] Implement Rational AI without hidden-card access.
- [x] Implement bounded, personality-driven Normal AI without random blunders.
- [x] Finish the shared compressed tournament/career session controller.
- [x] Integrate Normal and Rational policies into playable tournament sessions.
- [x] Replace “Career” navigation with a Grand Prix-like mode flow:
      event select → tournament → placement/qualification/Elo/unlock results.
- [x] Replace the dashboard/tab shell with a game-first title and menu scene.
- [x] Match the *interaction hierarchy* of a premium console-game start flow:
      the initial Play/Settings menu should feel like Mario Kart World’s compact
      start menu without copying its art, type, icons, colors, wording, or exact
      geometry.
- [x] Use the user-supplied poker artwork as the desktop start-menu background
      with the same oversized Play/Settings chip-button hierarchy. Yellow text
      must indicate the button currently under the cursor or keyboard/controller
      focus.
- [x] Add a subtle seamless two-second ambient background loop, preserving the
      supplied still as the loading/failure/reduced-motion fallback. The supplied
      artwork now uses its prepared original two-second micro-drift loop; no
      generated video or copied scene is needed, and the same local still remains
      the failure and reduced-motion fallback.
- [x] Make the four-mode choice—Normal, Rational, Training, Timed Table—a
      distinct
      game-mode selection scene with the clarity and immediacy of choosing among
      Grand Prix/Knockout Tour/Time Trial, while using original poker-native
      presentation and names.
- [x] Add a fourth **Timed Table** mode. Ask for 5–180 minutes before play,
      run one table with Normal opponents and no career progression, and award
      tournament Elo from the final placement.
- [x] Build a deterministic timed blind director that keeps blinds monotonic,
      preserves a normal opening phase, then adjusts pressure from elapsed time,
      remaining players, and live stack distribution. At and after the deadline,
      the big blind must cover the second-largest live stack so every player
      except the chip leader is forced all-in; finishing early is valid.
- [x] Add a short loading transition followed by an authored camera fly-through
      of the **Poker Training Pro Championship** room that travels past the
      venue, tables, dealer area, players, and stacks before settling into the
      hero’s seated first-person view.
- [x] Between tournament rounds/table moves, keep the transition inside the
      room: move the camera toward the next seat while a slim, slightly faded
      horizontal progress bar overlays the top of the view. Show completed
      rounds/checkpoints, current progress, and the next stop; fade it before
      control returns. Do not make this bar a separate screen.
- [x] Reserve the full placement/qualification/Elo/unlock results ceremony for
      the end of an event, not for ordinary between-round transitions.
- [x] Build stylized cartoony table characters with physical action animations:
      receive/peek/hold/muck cards, gather/count/push chips, check the felt, react,
      go all-in, win a pot, and leave after elimination. The shipped desktop scene
      now uses original avatar-sheet characters and public-action-driven hands:
      card deal/hold/muck, check tap, call/bet chip push, all-in, pot gather, and
      elimination retreat all have motion-off and reduced-motion alternatives.
- [x] Study VR/card-table presentation for presence, seated scale, readable
      stacks, physical card/chip motion, limited-look camera behavior, comfort,
      and augmented statistics; record the original desktop translation and
      protected-expression boundary.
- [x] Complete the remaining original non-VR physical character/hand/chip
      assets and animations identified by that research. Character gestures read
      only public betting/session state; they never infer opponents' holdings.
- [x] Let the player pan/look left and right from their seat like a traditional
      game, with a center-view command and a fixed/reduced-motion alternative.
- [x] Add expert hotkeys for Fold, Check/Call, Raise 2×, Raise 2.5×, Raise 3×,
      Pot, All-in, Custom Raise, Peek/Hide Cards, camera left/right, center view,
      speed up/down, hand history, and pause. Disable shortcuts while typing.
- [x] Add an always-reachable top-table speed slider/presets controlling AI
      presentation speed without changing the mathematical policy.
- [x] Keep full-hand opponent presentation as the default after the player acts,
      while offering an explicit, keyboard-accessible **Skip to result** control
      that completes only the queued presentation delay. It never cancels or
      duplicates the already-chosen legal action.
- [x] Model AI decision delays from decision closeness/uncertainty, street,
      action complexity, and opponent tempo, plus substantial seeded jitter and
      anti-tell noise. Cap correlations so timing cannot reliably reveal hand
      strength or action.
- [x] Apply the same timing model and user speed preference to mobile, with
      shorter animation budgets and background/inactive pausing. The SwiftUI
      table calls the shared local bridge with the mobile surface cap and saved
      rate, while `TableTimingModel` freezes the exact remaining delay outside
      the active scene; parity and mobile-budget tests cover the contract. It
      also offers an explicit Skip opponent animation control that resolves only
      the queued presentation delay, matching desktop fast-forward behavior.
- [x] Apply the reference research at the level of task flow and affordance,
      document the originality boundary, and prohibit copied Nintendo, Balatro,
      Discord, Vegas Infinite, or other protected expression/assets.
- [x] Use an original palette that bridges premium casino materials and a
      colorful console game: deep emerald felt, ivory card stock, black lacquer,
      and brass as the base; vivid cyan, coral, warm yellow, sky blue, and
      clay-chip red for mode identity, selection, progress, and motion. Avoid
      Nintendo’s exact combinations, racing motifs, and rainbow-for-everything
      clutter.
- [x] Rename all user-facing and packaged references to **Poker Training Pro**.
- [x] Integrate the original Poker Training Pro brand mark and app icon.
- [x] Remove unnecessary badges, filler copy, decorative cards, and generic
      dashboard patterns identified by the anti-“AI slop” audit. The review
      keeps the supplied-art start menu as the only title surface, removes the
      generic “Live Field” badge in favor of the real Normal Tournament name,
      and retains only rule, accessibility, and gameplay information.
- [x] Re-run visual QA at 1280×720, 1366×768, 1920×1080, ultrawide, and the
      minimum supported desktop window. The live review confirmed the supplied
      Play-selected reference state, unobstructed Fold/Call/Raise controls,
      and a wide-screen table scale that keeps the room composition intentional.
- [ ] Verify mouse, keyboard, card peek, drag-to-fold, bet sizing, settings,
      local save recovery, reduced motion, and high-contrast behavior. The fresh
      packaged CDP input smoke now covers mouse navigation, peek, drag-fold,
      raise-slider sizing, settings, keyboard pause/resume, corrupt-current-save
      recovery, and first-run reduced-motion/high-contrast preferences; physical
      assistive-input acceptance is still pending.
- [x] Establish a re-runnable gameplay layout-collision gate at every supported
      size: no card may cover another card's rank or suit, opponent bet
      chips/amounts must remain visually separate from total stack balances, and
      labels, controls, cards, chips, and status overlays must never obscure one
      another. The prior six-seat Normal Tour result was a one-time static
      bounding-box capture, not a live gate; E25-002 supersedes it.
- [x] Recheck the live table at 1024x768, 1366x768, and 1920x1080 after
      removing the decorative opponent-card fan; active card bounds and
      stack/bet lanes remain non-intersecting with no horizontal overflow.
- [x] Add a packaged six-seat geometry gate to the Windows input smoke. It
      rejects intersecting opponent-card bounds and bet/stack information lanes
      before continuing through raise, pause, and controller coverage.
- [x] Package distinct Windows x64 NSIS installer and portable preview
      artifacts; verify the unpacked application launches, stays offline at
      idle, has the intended Electron fuses, and rejects tampered ASAR content.
- [x] Add a fail-closed packaged-render smoke gate that launches an isolated
      Windows profile, reloads the bundled custom-protocol document under CDP,
      requires a non-empty recognized app screen, rejects renderer/network/
      console errors, and cleans up the exact process tree and temp profile.
- [x] Open the packaged Windows preview for the user and visually verify the
      first-run setup, supplied-art start menu, four-mode selector, career
      event screen, and animated championship-room arrival.
- [x] Complete a hands-on packaged settings/Training smoke: mute and reduced
      motion toggles, `1/3` quiz submission and grading, a legal decision,
      feedback/Elo, pause menu, and return to the supplied-art start menu.
- [ ] Complete every remaining packaged input path (mouse, keyboard,
      controller, peek, drag-fold, raise sizing, history, resume/recovery,
      Normal/Rational/Timed completion) before calling the whole desktop build
      previewed. A fresh Windows CDP smoke (rebuilt 2026-07-24 against current
      source, hash `db18139b2b8c...`) proves mouse/keyboard navigation, peek,
      drag-fold, legal raise sizing, public hand history, pause settings,
      fast-forward, keyboard resume, Gamepad API polling/mapping, and an
      isolated corrupt-current-save recovery flow, and full Normal/Rational/
      Timed Table tournament completion through their placement ceremonies;
      controller hardware still needs its own packaged acceptance coverage.
      The two previously-reported flakiness causes are now **fixed with
      root-cause evidence**, in the harness only (no product/gameplay change):
      (1) the raise step clicked a control that was legitimately disabled when
      raising was illegal — it now polls for the raise button to actually be
      enabled and, if illegal, takes a legal call/check/fold and advances
      (bounded 12 hands / 45s) instead of weakening the check; (2) Escape is a
      pause *toggle*, and a stray native window blur (`main.cjs` blur → IPC →
      `requestPause("window-blurred")`) could pre-pause the game so Escape
      closed the menu — the harness now resumes to a known baseline before
      pressing Escape, with bounded retry. Three further latent races were
      found and fixed (gamepad context misrouting under a stray auto-pause, a
      missing `.action-dock` wait, an under-timed post-fast-forward wait);
      poll timeout raised 4s→8s and session budget 35s→90s. Verified across
      30+ consecutive passing runs.
      **Residual environment-level risk (not a harness defect)**: under real
      host CPU contention, CDP transport timeouts still occur — reproduced
      with the byte-identical *original unmodified* script under the same
      load, correlated with `LoadPercentage` spikes. Treat an isolated
      red run on a loaded machine as suspect; re-run on a quiet host.
      **Product-side option deliberately NOT taken**: `main.cjs` does not set
      `backgroundThrottling: false`, which would steady the rAF-driven gamepad
      polling. It was rejected because it directly conflicts with the
      "pause expensive rendering and simulations while hidden/minimized"
      requirement below — trading real battery/power behavior for test-harness
      convenience. Revisit only if the gamepad flake resurfaces on a quiet host.

## Audio — after the desktop gameplay loop

- [x] Mute the temporary synthesized background loop.
- [x] Research a substantial candidate playlist of thematically appropriate,
      instrumental, royalty-free tracks from reputable libraries.
- [ ] Verify every license permits redistribution inside a commercial desktop
      and mobile game; reject “free to stream only” or unclear licenses.
- [ ] Save source URL, author, track title, license text/version, attribution
      requirement, and downloaded master for every accepted track.
- [x] Prefer several calm focus/table tracks plus restrained tournament-intensity
      tracks; avoid vocals, casino jingles, slot-machine music, and distracting
      drops.
- [x] Implement shuffled playlist playback, no immediate repeats, crossfades,
      pause/focus behavior, music ducking under feedback, and separate Music/SFX
      volume controls. All six behaviors are implemented, unit-tested against
      injected fake clock/sink, and genuinely wired end-to-end in `App.tsx`;
      this pass closed two real wiring gaps (engine pause/resume never received
      focus/blur/minimize/suspend transitions — now via a new
      `GameAudio.observeFocusMuted()`; and Music-volume/Mute never reached the
      engine — now via `musicVolumeFromSettings()`). Ducking was verified to
      fire through real `gameAudio.play()` cues, not an isolated utility. The
      engine stays **dormant**: `src/lib/musicPlaylistWiring.test.ts`
      reproduces the exact app composition against the empty production
      manifest and proves zero audio-graph construction, no playback attempt,
      and no throw across focus churn/volume changes/500s of simulated time.
      **Pending licensed masters** for actual audible playback — see the
      license/master/loudness/attribution items in this section, all still
      blocked on rights that do not yet exist.
- [x] Add a Credits/Licenses screen and ship required attribution files. The
      offline screen exposes font and package/runtime notices; the fresh
      Windows package audit verifies the sidecars. Music remains absent until
      licensed masters and their individual attributions are ready.
- [ ] Loudness-normalize tracks and test looping, memory usage, and package size.

## iOS / iPadOS — begin after desktop is previewable

- [x] Finish current official App Store approval and device-support research.
- [x] Select an implementation path that reuses the local TypeScript poker
      engine and requires no dedicated game server.
- [x] Create the simplified mobile information architecture:
      logo/name → large Play and Settings actions → mode/event select → table.
- [x] Build a flat green table with names, balances, compact blue live cards,
      no dealer, no free camera, and tap-to-flip hero cards.
- [ ] Preserve every backend feature: Training, Rational, Normal, math checks,
      Elo, tournaments, career results, local settings, and local progress.
      The full validated 12-scenario Training bank now exports into the iOS
      bundle and has a release freshness gate; a typed hero-safe JavaScriptCore
      tournament bridge now drives the compact Normal, Rational, and Timed
      tables with live legal actions, public results, local tournament Elo, and
      career qualification persistence. Xcode/Simulator/device validation is
      still required before this cross-runtime feature set can be verified.
- [ ] Study card readability/motion from Balatro and compact table clarity from
      Discord Activities, then design original assets and animation timings.
- [x] Keep all bot equity/range work on-device; benchmark and cap expensive
      simulations to avoid frame drops, thermal spikes, and battery drain. The
      shared JavaScriptCore engine has a 600-simulation hard ceiling with
      deterministic 32-simulation slices; the Windows contract benchmark and
      parity suite pass. Target-device Instruments validation remains part of
      the separate supported-device test task.
- [x] Support iPhone and iPad safe areas, Dynamic Type, landscape/portrait policy,
      split view/window resizing where required, and accessibility settings. The
      universal SwiftUI source keeps only decorative backgrounds under system
      areas, uses scalable text/cards and standard accessibility controls, and
      now falls back for narrow player/action rows and board-card overflow; the
      separate supported-device validation task remains required on macOS/Xcode.
- [ ] Validate every supported iPhone/iPad layout required by the chosen
      deployment target—without inventing obsolete devices.
- [ ] Add privacy manifest/labels, age rating, simulated-gambling disclosures,
      review notes, screenshots, TestFlight plan, and submission checklist.
- [x] Determine the legitimate preview path from Windows. Do not install a fake
      iOS simulator; official Apple Simulator requires macOS/Xcode.
- [ ] Open the final mobile preview for the user before any handoff/submission.

## Desktop production necessities — audit added 2026-07-23

### Complete player journey and teaching

- [x] Write one canonical game-state diagram covering cold start, first run,
      menu, mode setup, loading, seated play, pause, results, retry, quit, and
      recovery; make every Back/Cancel path explicit.
- [x] Define the desktop v1 exit criteria and a playable vertical-slice gate:
      every mode can start, finish, save, recover, and return to the start menu
      without a dead end or placeholder.
- [x] Add a first-run flow that offers accessibility and control setup before
      animation or timed interactions begin, then lets the player skip it.
- [x] Build a short playable tutorial that teaches card peeking, legal actions,
      bet sizing, hand flow, showdown, and the difference between chips, pot
      odds, equity, and expected value.
- [x] Add optional contextual prompts for the first occurrence of an all-in,
      side pot, minimum raise, blind increase, elimination, qualification, and
      Elo change; keep them manually dismissible and replayable.
- [x] Add an always-available poker reference with hand rankings, betting terms,
      common probability shortcuts, tournament terms, and worked examples.
- [x] Explain what Normal, Rational, Training, and Timed Table actually optimize
      before selection, including that Rational opponents use only information
      legally available to their seat.
- [x] Add a safe “restart hand/scenario” path only where it cannot alter career
      results, and clearly distinguish practice retries from scored play.
- [x] Make every event-end result screen explain placement, qualification,
      unlocks, Elo change, and the next available action without requiring prior
      poker knowledge.

### Input, focus, pause, and window lifecycle

- [x] Create a single action map shared by mouse, keyboard, and controller so
      menus and every gameplay action have equivalent non-pointer operation.
      The versioned action registry and routing tests cover default bindings,
      conflicts, keyboard/controller resolution, and persistence.
- [x] Add controller navigation and prompts for the complete desktop flow,
      including settings, dialogs, sliders, card peek, betting, pause, and Back.
      The visibility-aware provider supports already-connected controllers as
      well as connection events, and routes modal navigation separately.
- [x] Add in-game remapping for all gameplay and menu controls, conflict
      detection, reserved-key warnings, per-device defaults, and Reset to
      Defaults.
- [x] Ensure drag-to-fold and chip dragging always have one-press alternatives;
      no required action may depend on dragging, holding, double-clicking, or
      rapid repeated input.
- [x] Add an initial-focus and wraparound focus trap to the pause dialog, plus a
      visible global keyboard-focus indicator over animated backgrounds.
- [x] Restore the exact pre-pause focus reliably while pause subpages move
      their initial focus without replacing the original restoration target.
- [x] Apply and test the same initial-focus/trap/restoration contract for every
      other modal dialog. The shared modal hook now covers raise, history,
      pause, and remap-capture dialogs with ARIA modal semantics and restoration
      tests.
- [x] Disable global poker hotkeys while a text field, slider, remapping dialog,
      or system dialog owns input.
- [x] Add a real pause menu with Resume, Controls, Settings, Hand Reference,
      Restart/Leave where valid, and Quit to Menu; never hide destructive
      consequences behind ambiguous wording.
- [x] On table blur/document hiding, enter the explicit pause menu, stop the
      Training decision/math stopwatch, mute table audio, pause the arrival
      timeout, and block tournament action delivery until Resume.
- [x] Wire minimize/screen-lock/Windows suspend through Electron lifecycle,
      freeze the exact remaining AI-presentation and animation delays rather
      than merely blocking/restarting them, and apply the same policy outside
      the table.
- [x] Shift Timed Table's authoritative start clock by the inactive duration on
      explicit Resume and checkpoint the adjusted deterministic replay.
- [x] On resume, restore the exact decision state and camera position, show a
      brief readable recap, and do not count inactive time against Training or
      Timed Table play.
- [x] Save at safe boundaries before close, Windows session end, suspend, and
      update installation; the Electron close handshake flushes first and asks
      before abandoning a pending scored commit.
- [x] Handle renderer “unresponsive” and “render-process-gone” events with
      recovery choices instead of a blank or permanently frozen window.
- [ ] Test windowed, maximized, fullscreen, Alt+Tab, Win+D, display disconnect,
      DPI change, and moving between monitors without losing focus or layout.

### Accessibility baseline

- [ ] Make all controls expose correct accessible names, roles, values, state,
      and order to Windows Narrator/NVDA; announce cards, actions, pot changes,
      errors, timers, and results without reading decorative scenery. The table
      now has static SR semantics (named seat/card groups, decorative children
      hidden) plus live `aria-live` regions for the running status line, action
      errors, blind-level increases, hand results/side pots, and an assertive
      all-in escalation — sourced from the locale catalog, unit-tested for
      no-spam/no-hidden-info via a pure `deriveTableAnnouncements` diff
      (`src/lib/tableAnnouncer.ts`). Real Windows Narrator/NVDA speech
      acceptance on hardware is still unverified and remains before this can
      be checked.
- [x] Add UI/text scale controls. The persisted Compact, Standard, Large, and
      Extra large choices scale the whole desktop interface (including table
      labels and action targets), not prose alone; older saves use Standard.
- [ ] Verify critical table information remains readable without clipping at the
      minimum window size and 200% Windows display scaling on the packaged app.
- [ ] Meet at least WCAG 2.2 AA contrast for text and meaningful non-text
      controls; use a 24-by-24 CSS-pixel minimum target or equivalent spacing,
      with larger targets for primary poker actions.
  - [x] Add a source-level desktop regression audit for defined opaque palette
        pairings and the minimum sizes of the principal menu, utility, settings,
        tutorial, and table-action targets. This guards the locally-verifiable
        CSS contract only; blended artwork, operating-system scaling, and
        assistive-technology rendering remain acceptance-test work.
- [x] Never encode selection, card state, action type, stack danger, math
      correctness, or tournament progress by color alone; pair color with
      shape, label, icon, pattern, or motion-independent state. Selection uses
      pressed/current semantics and text, cards and player states have spoken
      labels, decisions are text buttons, and feedback pairs words with icons.
- [x] Expand Reduced Motion into independent controls for animated menu
      backgrounds, room fly-through, camera sway/shake, card/chip flourish, and
      transition intensity, with static fallbacks available before Play. The
      one-click global control and Safe Mode still override every category.
- [x] Add camera sensitivity, recenter behavior, field-of-view/zoom choice, and
      an option to disable automatic camera movement. Settings persist as low /
      standard / high look sensitivity, close / standard / wide table view, and
      an automatic-arrival/recenter toggle; older saves receive safe defaults.
- [x] Inventory motion/flash sources, document conservative safe limits, and
      hard-gate mechanically detectable strobe/rapid-toggle signatures plus
      missing operating-system or in-app reduced-motion coverage.
- [ ] Analyze rendered luminance, saturated-red flashes, visual angle, and loop
      boundaries with a recognized tool; verify reduced motion on the packaged
      release candidate and remove any sequence that fails. Re-run 2026-07-24
      against the fresh package: 8/8 sequences pass (0 general/red flashes)
      across full-motion and reduced-motion. Sampling density was measurably
      improved (CDP `optimizeForSpeed` capture) from a worst case of ~1392ms
      to 284.4ms per frame (~1.76fps) on the slowest sequence — still sparse
      evidence for sub-second fast-motion content and still not a certified/
      recognized analysis tool, so this stays unchecked.
- [x] Keep tutorials, math explanations, errors, and non-gameplay notifications
      on screen until dismissed, or provide adjustable display duration. The
      audit locks out auto-dismiss timers in those surfaces; the lone lazy-load
      budget timer adds an explicit Cancel path instead of hiding feedback.
- [x] Provide visual equivalents for meaningful audio cues and optional audio
      equivalents for critical visual-only state changes. Deal, chip, fold,
      success, and click sounds already pair with visible card/chip/action or
      result changes; both error-sound paths now expose persistent visible,
      screen-reader alerts rather than relying on sound alone.
- [ ] Run an accessibility acceptance pass with keyboard only, mouse only,
      controller only, Windows Narrator, NVDA, 200% scaling, high contrast,
      reduced motion, color assist, and muted audio.

### Durable saves, recovery, and deterministic diagnosis

- [x] Move authoritative progress out of renderer `localStorage` into a
      versioned file below Electron’s per-user `userData` directory; keep
      browser storage only as a one-time import source.
- [x] Wire the existing save-envelope migration and last-known-good utilities
      into startup and every write path instead of leaving them test-only.
- [x] Write saves atomically through a temporary file plus replace/rotation,
      checksum them, keep at least one previous valid generation, and never
      overwrite the only valid save with corrupt data.
- [x] Add a recovery screen that explains which save failed, offers restore from
      last-known-good, export diagnostics, start fresh, or cancel, and never
      silently discards progress.
- [x] Implement narrow desktop Export Save plus two-phase Import Save and Reset
      Progress backends with validation, redacted preview, one-use confirmation,
      TOCTOU protection, atomic commit, and retained valid generations.
- [x] Add player-visible Export Save, Import Save, and Reset Progress actions,
      wire the preview/confirmation UI, reload committed state, and keep
      settings reset visibly separate from progress deletion.
- [x] Persist and deterministically restore the exact active tournament runner,
      current hero decision, timed-table start clock, and career event results
      from an ordinary checkpoint without storing opponents’ hidden cards.
- [x] Persist and restore the exact active Training scenario through the durable
      checkpoint, validate it against the shipped scenario bank, offer an
      explicit Resume/Abandon choice, and keep answers, hidden information, and
      unsubmitted scores out of the save.
- [x] Persist and restore the active Training camera, transition, and
      pause/inactivity timing state. The versioned checkpoint now preserves the
      seated camera offset, frozen decision clock, and explicit pause menu while
      deliberately excluding answers, scores, hidden cards, and future deals;
      Training has no room fly-through, so its safe resume frame is the seated
      table rather than an invented mid-flight scene.
- [x] Store the engine/content version, PRNG seed, public action log, full blind
      schedule, policy version/simulation count, and public entrant data needed
      to reproduce each scored tournament without retaining opponents’ hidden
      cards in ordinary hand history.
- [x] Retain completed-event replay metadata after leaving the result screen and
      expose player-visible event-end export. The completed runner checkpoint
      remains in the existing versioned replay envelope through ordinary menu
      navigation and is restored as an exportable (but not resumable) replay
      after restart; starting a new event or explicitly resetting/importing
      data replaces it.
- [x] Add bounded native replay-export backends: a strict-allowlist redacted
      public bug-report artifact and a privileged deterministic developer replay
      that fails closed unless explicitly enabled in an unpackaged
      non-production build.
- [x] Add player-visible public replay export controls and review a generated
      artifact from a completed event.
- [x] Define forward- and backward-compatibility policy for saves, including
      update rollback, unsupported future versions, partial writes, disk-full,
      permission-denied, and quota failures.

### Privacy, diagnostics, and player trust

- [x] Keep v1 fully playable offline with no account, analytics, ads, remote
      fonts, CDN assets, bot server, or mandatory update check.
- [x] Add static runtime/CSP checks plus a packaged launch-and-idle deny-proxy
      audit; bundle fonts and every required runtime asset.
- [x] Extend the packaged deny-proxy audit through representative ordinary
      offline play in every mode, failing if any endpoint is contacted. The
      isolated packaged audit now enters Normal, Rational, Training, Timed, and
      Tutorial through their real UI routes and records zero proxy connections.
- [x] Write a plain-language privacy policy for the actual desktop behavior,
      including local saves, optional diagnostics, retention, deletion, and
      third parties.
- [ ] Publish the privacy policy at a stable HTTPS URL and wire the final
      publisher support contact before store submission.
- [x] Keep telemetry absent by default; if it is later added, define a minimal
      event/data inventory, ask separate opt-in consent, provide an in-game
      opt-out/delete path, and never collect hole cards or free-form answers.
- [x] Keep remote crash upload absent in the current offline build. The privacy
      source audit confirms no runtime upload/telemetry dependency, and the
      bundled policy requires any future crash provider to be separate opt-in,
      fully disclosed, reviewable, and deletable before it can ship.
- [x] Add rotating local logs with secrets/path/user-content redaction, bounded
      disk use, timestamps, build/engine versions, and a one-click redacted
      diagnostic export.
- [x] Add bounded atomic crash-loop tracking and pre-ready Electron safe-mode
      activation after repeated startup/renderer failures; disable hardware
      acceleration and expose only a redacted read-only recovery state.
- [x] Consume safe mode in the renderer to ignore imported settings, disable
      animated backgrounds and nonessential audio, show status/exit controls,
      and preserve progress. A renderer-wide safe-mode CSS gate prevents every
      decorative animation, including screens without settings props.
- [x] Pass packaged crash-loop recovery tests against the real Windows build.
      The isolated packaged safe-mode smoke reaches the recovery screen with
      no runtime/console errors and remains reduced-motion after continuing.
- [x] Add visible in-app links for Privacy, Support, Licenses/Credits, version,
      build identifier, save location, log location, and diagnostic export.
      All eight elements verified wired to real preload/IPC values with a
      component test; the support contact is a clearly-labeled placeholder
      pending publisher assignment, and the HTTPS privacy URL remains a
      separately-blocked item.

### Performance, assets, and offline robustness

- [x] Set measurable budgets before optimization: cold start to interactive,
      mode-to-table load time, action-to-feedback latency, frame pacing/FPS,
      idle CPU, peak memory, installer size, and save-write duration.
- [ ] Benchmark those budgets on a low-spec supported Windows machine, a typical
      laptop with integrated graphics, and a discrete-GPU desktop; record power
      and thermal behavior during a 60-minute tournament soak.
- [x] Profile Rational Monte Carlo/equity work, add exact work instrumentation,
      deterministic count-sliced execution, and fail-closed
      per-decision/per-slice caps while preserving fixed-seed decisions and the
      frozen bot baseline.
- [x] Integrate the asynchronous sliced equity boundary into live tournament
      progression (or a worker) with cancellation and stale-result rejection;
      the current synchronous caller remains deterministically capped but can
      still block the UI for a large decision.
- [x] Lazy-load mode-specific code and heavy room/avatar/audio assets, preload
      only the next likely scene, and provide progress plus a cancel/back path
      for loads that exceed the target.
- [x] Define texture, image, animation, and audio memory/size budgets; compress
      masters into shipping formats while retaining source masters outside the
      runtime package.
- [x] Provide static or low-cost fallbacks for artwork, the optional menu video,
      room presentation, local font stacks, and audio; no runtime shader is
      currently shipped.
- [x] Fault-inject corrupt/missing packaged start-menu and championship-room
      image assets without mutating the canonical ASAR; prove visible fallbacks,
      usable controls, clean renderer output, and isolated-profile cleanup.
- [x] Fault-inject slow disk, unsupported video codecs, Windows font failures,
      and audio-device loss in the packaged app. The packaged runner now proves
      an in-memory 1.85-second delayed start-menu read reaches the visible slow
      fallback and then recovers cleanly, and a CDP-blocked bundled-font reload
      records failed Inter/Barlow faces while local fallback stacks keep the
      menu readable and usable; an injected AudioContext failure announces the
      silent fallback and still permits a legal Training action. Unsupported
      codec coverage remains not applicable while no runtime video ships, and
      `scripts/validate-runtime-video-policy.mjs` fails release if a video asset
      or enabled start-menu loop appears without real codec/fallback coverage.
- [ ] Pause expensive rendering and simulations while hidden/minimized and
      verify no runaway timers, detached audio nodes, object URLs, or retained
      hand histories grow memory across long sessions. The packaged input smoke
      now performs a real native minimize/restore and proves the table pauses
      and needs an explicit player resume. The packaged completion smoke also
      records heap/DOM/listener deltas for a completed event and rejects
      retained hand-history rows, blob URLs, or excessive heap growth;
      long-session hardware profiling remains.
- [x] Measure deterministic initial bundle composition and reachable direct
      dependency usage; hard-gate Electron main/preload against renderer or
      poker-engine imports.
- [x] Add a bounded one-host Windows packaged-runtime profiler for cold launch,
      navigation timing, allowlisted CDP main-thread metrics, process-tree CPU/
      working set, exact build/host identity, cleanup, and canonical JSON/Markdown
      evidence; retain the explicit limitation that this is not the required
      low-spec/typical/discrete-GPU hardware matrix.
- [x] Review and retain `start-menu-room.png` as the animated championship-room
      arrival background; the production composition audit now proves every
      built runtime asset has a static reference.
- [ ] Instrument dependency evaluation, startup/main-thread blocking, decode,
      memory, and first-paint cost on supported hardware. Refreshed
      2026-07-24 against the fresh package on this dev host: 492.8ms cold
      launch to recognized renderer, 355 MiB peak process-tree working set,
      4.735% peak normalized CPU, 0 startup long tasks, 2.4 MiB JS heap after
      settle; first paint/FCP still not exposed by the custom
      `poker-training-pro://` protocol. One host only — the low-spec/typical/
      discrete-GPU hardware matrix remains outstanding.

### Audio behavior beyond the soundtrack

- [x] Keep persisted volume application from constructing or playing an audio
      graph before the browser records the player’s first input.
- [x] Add persisted Master/Mute alongside Music and SFX.
- [x] Add explicit keyboard-accessible Master and Table-effects previews with
      one polite status region; keep slider changes silent/graph-free and keep
      Music preview visibly unavailable until approved licensed masters exist.
- [x] Define deterministic audio-focus rules for pause, blur, device
      disconnect/change, headphones removal where exactly detectable,
      suspend/resume, explicit Ready, and simultaneous system audio.
- [x] Wire the audio-focus controller to DOM and Electron `powerMonitor`
      lifecycle events, including the explicit Ready policy and on-screen
      resume recap. The optional output-device monitor remains best-effort.
- [ ] Pass the packaged Windows device/focus matrix (headphone/device change,
      blur, minimize, lock, suspend/resume, and explicit Ready) on real hardware.
- [x] Ensure current card, chip, fold, feedback, and deal sounds do not create hidden
      information or timing tells that the visual interface does not disclose.
- [x] Provide a silent fallback when audio initialization or graph creation
      fails so supplementary sound never blocks a poker action.
- [ ] Test long playlist sessions for leaks, clipping, drift, and abrupt cuts
      after licensed masters and playback are integrated.

### Localization and content operations

- [x] Extract every player-facing string, poker term, shortcut label, error,
      tutorial, and explanation from components into versioned locale resources;
      ship English as an explicit complete locale. A strict versioned English
      message catalog, interpolation helper, and direction-safe message
      component exist, and all player-facing UI strings are now migrated:
      PokerTable, Dashboard, tutorial, settings, credits/about, save controls,
      recovery, tournament event names/tiers/qualification/placement labels,
      the 39 `durablePersistence` save/restore failure messages, credits
      chrome, and tournament-mode synthesized scenario title/prompt/
      actionReason (with real interpolation, not concatenation).
      **Permanent documented exemptions** (verified, not gaps): Training
      scenario prompt/explanation content in `src/data/trainingScenarios.ts`
      (governed by its own versioned schema/review/authoring pipeline — it is
      calibrated poker content, not UI chrome); verbatim bundled third-party
      license/notice text and font proper-noun+license labels in
      `creditsData.ts` (must stay byte-exact, never pseudo-localized); and two
      dead fields in `tournamentSession.ts` (`disclosure`, `mathQuestion.*`)
      confirmed never rendered in tournament modes.
- [x] Add a versioned English numeric locale surface for number, percentage,
      ratio, chip, and duration formatting, and keep quiz parsing unambiguous
      for decimal comma, decimal point, fraction, and colon-ratio input.
- [x] Route every remaining player-facing numeric/date surface through the
      locale layer and add an explicit date resource before claiming complete
      application-wide locale-aware formatting. Fixed decimals, chips, duration
      counts, table speed/timers, AI explanation percentages, recovery timestamps,
      and tournament action amounts now use versioned numeric/date resources;
      remaining `toFixed` calls are internal model rounding only.
- [ ] Add pseudo-localization, 30–50% text-expansion, long-name, and right-to-left
      layout tests before claiming support for another language. The locale
      foundation now has deterministic 35% pseudo expansion, token preservation,
      long-name, and RTL direction/layout regression tests across 16 major
      screens (component-render level, no unmigrated-English-leak sweep plus
      `dir`/`lang` root-attribute propagation); full-screen visual acceptance
      (real rendered layout, clipping, mirrored icon/flex direction under an
      actual browser window) remains before advertising another locale.
- [x] Define a versioned scenario schema and validator for legal cards, stacks,
      actions, units, tolerances, explanations, tags, difficulty, source/reviewer,
      and duplicate detection.
- [x] Build a developer-only deterministic Training-bank validation/export CLI;
      production packages exclude authoring and hidden-answer tooling.
- [x] Extend the developer scenario tooling with an interactive preview/editor
      or generator, deterministic seed controls, and bulk simulation.
- [x] Create an automated bot league/regression harness that compares policy
      versions by position, stack depth, street, action distribution, EV loss,
      timing leakage, and tournament finish distribution before balance changes.
- [x] Gate Training difficulty/Elo and historical-score compatibility against a
      versioned frozen synthetic benchmark; fail silent content, evaluator,
      selection, classification, and calibration drift.
- [ ] Obtain qualified poker-math review and consented human pilot/item/
      near-transfer evidence before claiming real-player difficulty or learning
      calibration; keep the current baseline labeled synthetic-only.

### Security and dependency hygiene

- [x] Add a restrictive packaged Content Security Policy and remove runtime
      third-party script/font/style loads.
- [x] Explicitly enable renderer sandboxing; deny unexpected permission requests,
      block unapproved navigation/new windows/downloads, validate IPC senders
      and arguments, and expose only narrow typed preload methods.
- [x] Enable appropriate Electron fuses and ASAR integrity during packaging,
      then verify the packaged unpacked build refuses tampered application
      resources.
- [ ] Repeat fuse and ASAR-integrity verification on the installed, signed
      release candidate in the clean-machine matrix.
- [x] Track supported Electron/Chromium/Node versions and establish a regular
      security-update cadence instead of freezing the current runtime.
- [x] Add dependency vulnerability, lockfile-integrity, secret,
      registry-origin, and reviewed install-lifecycle-script checks to release
      builds; generate a deterministic CycloneDX SBOM for each shipped version.
- [x] Resolve and hard-gate every locked npm package license declaration with
      exact-version evidence, a reviewed allowlist, negative tests, and a
      deterministic package notices inventory.
- [x] Assemble a deterministic, fail-closed upstream-license-text artifact for
      the seven npm identities selected as shipped runtime content, with exact
      manifest/text hashes, duplicate-path preservation, tamper/staleness/size
      tests, and explicit separation from Electron/Chromium and non-npm asset
      obligations.
- [ ] Assemble and ship the required upstream copyright/license/NOTICE texts,
      and resolve all font, image, audio, and other asset provenance blockers.
- [x] Ensure developer tools, source maps containing source, test hooks, hidden
      cards, debug IPC, and authoring tools are absent or securely disabled in
      production packages.

### Windows packaging, updates, and release materials

- [x] Choose and document the technical Windows distribution path: a signed
      direct x64 NSIS installer, user-initiated full-installer update channel,
      retained signed rollback build, and private-only portable preview.
- [ ] Assign the legal publisher, named release/support owners, signing service,
      HTTPS host, and current fee budget before public distribution.
- [x] Declare the intended v1 support matrix as x64 editions of
      Microsoft-supported Windows 11; do not claim Windows 10, ia32, or Arm64.
- [ ] Build and clean-machine test every Windows 11 feature release still
      supported at release freeze rather than relying on one host or emulation.
- [ ] Produce complete Windows identity assets and metadata: executable/installer
      icons, publisher/product/version fields, Start menu identity, uninstall
      entry, install size, and accessible window title.
- [ ] Authenticode-sign and timestamp every public EXE/installer and relevant
      binary with a production-trusted certificate; keep certificate material
      in protected CI secrets and verify signatures after upload.
- [ ] Choose one signed update mechanism, validate HTTPS metadata and packages,
      prevent downgrade/tampering, support staged rollout and rollback, preserve
      saves, and show readable release notes with Restart Now/Later.
- [ ] Test clean install, non-admin install, upgrade, interrupted update,
      rollback, reinstall, side-by-side prevention, uninstall, and preservation
      or explicit removal of player data in clean Windows virtual machines.
- [x] Add a release CI pipeline that runs typecheck, unit/property/soak tests,
      production build, offline/CSP/static-budget checks, lockfile and obvious
      secret checks, third-party inventory generation, production debug/source
      hygiene checks, and deterministic archived artifact manifests.
- [ ] Extend release CI with Windows installer packaging, Authenticode signature
      verification, installed-app launch/recovery smoke tests, and rollback
      artifact verification once signing and clean-machine runners exist.
- [ ] Prepare accurate store/press materials from the shipping build: icon,
      capsule/hero art, gameplay-only screenshots, short trailer, description,
      feature list, supported inputs, languages, accessibility features, offline
      statement, system requirements, privacy URL, and support URL.
- [ ] Complete the IARC/store age-rating questionnaire accurately for simulated
      poker/gambling content and keep play-chip-only/no-cash language consistent
      in the game, metadata, screenshots, privacy policy, and review notes.
- [ ] Record provenance and commercial redistribution rights for the supplied
      start-menu background and every generated/third-party asset before it
      enters a release candidate; replace anything with unclear rights.
- [x] Establish version-gated CHANGELOG, known-issues register, save
      compatibility matrix, release-operations index, support-response
      procedure, and end-of-support policy without inventing owners or SLAs.
- [ ] Finalize complete upstream notices and approved asset/audio credits, then
      maintain every release-operations document for each public version.
- [ ] Freeze a release candidate, test it from a clean machine with networking
      disabled, collect final hashes and a rollback build, and require a signed
      go/no-go checklist before publishing.

## Release quality

- [x] Keep tournament, Training, Normal AI, and Rational AI tests passing in
      the current 0.1.0 automated release snapshot (38 files / 278 tests).
- [x] Add property/soak tests for card uniqueness, chip conservation, legal
      actions, hidden-information invariance, and deterministic replay.
- [x] Audit generated scenarios and AI explanations for mathematically false
      certainty or outcome bias.
- [x] Add a fail-closed static source/build/package audit confirming no
      recognized payment, purchase, cash-out, transfer-for-value, payment SDK,
      billing IPC, or real-money wagering path.
- [x] Add visible “Play chips only” and “No real-money wagering” copy to the
      active start menu and pass the source plus production-renderer audit.
- [x] Repackage the disclosure and pass the packaged-ASAR boundary audit.
- [x] Require a one-time interactive play-chip acknowledgment before the first
      play session, persist it locally, and keep the no-cash-value/no-wagering
      boundary visible from the start menu and Settings. The state is included
      in the versioned desktop save-transfer allowlist and is covered by unit
      and packaged boundary audits.
- [ ] Complete store-metadata review for the interactive play-chip disclosure
      with the eventual publisher and store submission account.
- [x] Create versioned save migrations and a last-known-good local backup.
- [x] Add crash-safe autosave at action/hand boundaries for tournaments,
      retaining the deterministic checkpoint on settings and lifecycle writes.
- [ ] Review all third-party code, art, fonts, music, and reference licenses.
- [ ] Update this file whenever a requirement is completed, changed, or added.
