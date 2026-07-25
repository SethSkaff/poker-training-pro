# Poker Training Pro — Application Overview

A briefing document describing the application in depth. Written to be handed to
an LLM as context so it can discuss the product, its features, and its
architecture. Current as of version 0.1.0.

---

## 1. What it is, in one paragraph

Poker Training Pro is an **offline desktop poker training game** for Windows,
built as a native Electron application (not a website). It teaches and exercises
tournament No-Limit Hold'em through four distinct modes, backed by a
deterministic poker engine and two different opponent AI philosophies. It tracks
two separate skill ratings — one for poker decisions, one for the underlying
math — and presents everything inside a stylized "championship room" with a
table-focused presentation. The current desktop room, camera, character, card,
and chip treatment is a 2.5D prototype rather than a literal first-person 3D
environment; the roadmap tracks the remaining work to make it spatial and
continuous. It is
**play-chips-only with no real-money wagering**, runs entirely offline with no
account, analytics, ads, or server, and stores all progress locally. A companion
iOS/iPadOS app reuses the same game logic behind a deliberately simplified
native UI.

---

## 2. The four modes

| Mode | What it is | Progression | Opponents |
|---|---|---|---|
| **Normal** | Tournament poker against opponents with bounded personalities, bluffing, and strategic variation — strong, but human-feeling, and never making random blunders | Career events | Normal AI |
| **Rational** | Tournament poker against opponents that play information-set poker math and have **no access to hidden cards** | Career events | Rational AI |
| **Training** | One-move poker scenarios, each paired with a related math question, with immediate feedback and explanation | Decision Elo + Math Elo | N/A (scenario bank) |
| **Timed Table** | Asks how many minutes you have (5–180), then runs a single table that is guaranteed to finish near your deadline | Placement Elo only, no career | Normal AI |

### Career (Grand Prix-style progression)

Career is presented as a **play-through mode with event progression**,
deliberately *not* a dashboard tab. There are five tiered events:

1. Local Qualifier
2. Regional Open
3. Circuit Main
4. National Championship
5. World Championship

You select an event, play the tournament, and receive a results ceremony
covering placement, qualification, unlocks, and Elo change. The current event
progress state is session-only and resets on application restart; durable career
continuity remains roadmap work. The full ceremony is
reserved for the **end of an event** — ordinary between-round table moves
instead keep you inside the room, moving the camera toward your next seat behind
a slim, faded progress bar showing completed rounds, current progress, and the
next stop.

### Training mode specifics

The validated scenario bank contains **12 scenarios**, each governed by a
versioned schema (`schemaVersion`/`contentVersion`) with source and reviewer
metadata, legality validation, tolerance checking, and duplicate detection.
Grading is **EV-regret based** rather than simple right/wrong.

Quiz answers accept any table-realistic notation, because a player thinking in
pot odds shouldn't have to convert formats:

- percentages — `33%`
- decimals — `0.33`
- fractions — `1/3`
- ratios — `2:1`, `3:5`
- decimal-comma input is also parsed unambiguously

### Timed Table specifics

A **deterministic timed blind director** keeps blinds monotonically increasing,
preserves a normal opening phase, then adjusts pressure based on elapsed time,
remaining players, and the live stack distribution. At and after the deadline,
the big blind is forced to cover the second-largest live stack, so every player
except the chip leader is all-in — guaranteeing the table resolves. Finishing
early is valid. Inactive time (pause, minimize, screen lock) is excluded from
the clock, and the adjusted start time is checkpointed into the deterministic
replay.

---

## 3. The two opponent AIs

### Rational AI

Plays **information-set poker math**. Critically, it has **no hidden-card
access** — it only ever reasons from information legally available to its own
seat. Equity is estimated with Monte Carlo simulation that is:

- **Deterministic** — a fixed seed always produces the identical decision
- **Count-sliced** — work is split into slices with exact instrumentation
- **Fail-closed capped** — hard per-decision and per-slice work budgets
- **Off the main thread** — the heavy computation runs in a Web Worker with
  cancellation and stale-result rejection, so a large decision never blocks the
  UI, with a synchronous fallback path preserved for tests and the mobile bundle

### Normal AI

Bounded, **personality-driven** opponents that bluff and vary strategically
without degenerating into random blunders. This is the "feels like playing
people" mode, versus Rational's "feels like playing the math."

### Decision timing (anti-tell)

Both AIs delay realistically. Delay is modeled from decision closeness and
uncertainty, street, action complexity, and opponent tempo, plus substantial
seeded jitter and explicit anti-tell noise. **Correlations are capped so timing
cannot reliably reveal hand strength or intended action** — the AI can't leak
information through how long it "thinks." A player-facing speed slider controls
presentation speed *without* changing the mathematical policy, and an explicit
keyboard-accessible **Skip to result** control resolves only the queued
animation delay — it never cancels or duplicates the already-chosen action.

---

## 4. The poker engine

A deterministic core, independent of presentation:

- Deterministic deck and shuffling
- Full hand evaluator
- Legal betting enforcement (strict — an illegal bet target is rejected, not
  silently coerced)
- Side pots
- Blind structures and table balancing
- **Information-set redaction** — the mechanism that guarantees opponents and
  exported data never see hidden cards

Correctness is defended by property and soak tests covering card uniqueness,
chip conservation, legal-action invariants, hidden-information invariance, and
deterministic replay.

---

## 5. Presentation and game feel

The design goal is a **premium console-game feel** — the interaction hierarchy
of a polished start flow — while using entirely original poker-native
presentation. Explicitly *not* copying protected expression from any other game.

- **Start menu**: opens directly on the supplied poker artwork, with an
  oversized Play/Settings chip-button hierarchy. Play turns yellow when hovered
  or focused; Settings is white otherwise. No separate splash screen.
- **Room arrival**: a short loading transition using an authored 2D room scene.
  A true camera fly-through between venue, dealer, players, and stacks is still
  roadmap work.
- **Camera**: a deliberately limited 2D left/right pan with a center-view
  command and a fixed/reduced-motion alternative. It is not a free or 3D camera.
- **Characters**: stylized seat portraits and public-state gesture cues for
  actions. Full identity-specific characters that visibly receive, hold, muck,
  gather, and push physical cards and chips are roadmap work. Gestures are
  driven **only by public betting/session state**; they never encode private
  information.
- **Palette**: deep emerald felt, ivory card stock, black lacquer and brass as
  the base; vivid cyan, coral, warm yellow, sky blue and clay-chip red for mode
  identity, selection, progress and motion.
- **Layout integrity**: a one-time six-seat bounding-box capture was recorded
  at common desktop sizes. It is not yet a live geometry gate and does not cover
  every visual lane; the repeatable collision and perceptual checks are tracked
  in the release backlog.

---

## 6. Input

A **single versioned action map** is shared across mouse, keyboard, and
controller, so every menu and gameplay action has an equivalent non-pointer
operation.

Gameplay actions: Fold, Check/Call, Raise 2×, Raise 2.5×, Raise 3×, Pot,
All-in, Custom Raise, Peek/Hide Cards, camera left/right, center view, speed
up/down, hand history, and pause.

- Hotkeys are automatically disabled while a text field, slider, remapping
  dialog, or system dialog owns input.
- **Controller support** via the Gamepad API with contextual button prompts that
  appear only when a gamepad was the most recent input device. D-pad/stick moves
  focus, A activates, B goes back, sliders adjust with left/right.
- **In-game remapping** for all gameplay and menu controls, with conflict
  detection, reserved-key warnings, per-device defaults, and Reset to Defaults.
- No required action depends on dragging, holding, double-clicking, or rapid
  repeated input — drag-to-fold and chip dragging always have one-press
  alternatives.

---

## 7. Accessibility

Treated as a first-class product requirement rather than a checkbox:

- **Screen reader**: correct roles and named groups for seats, community cards,
  and face-up/face-down cards, with decorative duplicated scenery hidden from
  the accessibility tree. **Live announcements** via `aria-live` regions cover
  player actions, pot changes, blind increases, hand results and side pots, with
  an assertive channel for all-ins and errors. Announcements are debounced so
  they read as play-by-play rather than a firehose, and are verified never to
  leak hidden-card information.
- **Motion**: reduced motion respects the **OS-level `prefers-reduced-motion`
  setting** by default, while an explicit in-app choice always wins. Static
  fallbacks are available before play begins.
- **UI/text scale**: persisted Compact / Standard / Large / Extra Large settings
  scale the entire interface — including table labels and action targets — not
  just prose.
- **Contrast and targets**: a source-level regression audit enforces defined
  opaque palette pairings, a 44px minimum for primary poker actions, and 24px
  for utility controls.
- **Focus**: initial focus, wraparound focus trap, and exact prior-focus
  restoration on every modal dialog, plus a visible global focus indicator that
  survives animated backgrounds.
- **Color independence**: selection, card state, action type, stack danger, math
  correctness and tournament progress are never encoded by color alone.
- **Persistence**: tutorials, math explanations, errors and non-gameplay
  notifications stay on screen until dismissed.
- **Flash safety**: a rendered luminance and saturated-red flash analysis
  implementing WCAG 2.3.1 thresholds, run against the packaged build.

---

## 8. Teaching and onboarding

- A **first-run flow** offers accessibility and control setup *before* any
  animation or timed interaction begins, and is skippable.
- A short **playable tutorial** teaches card peeking, legal actions, bet sizing,
  hand flow, showdown, and — importantly — the difference between chips, pot
  odds, equity, and expected value.
- **Contextual prompts** fire once on the first occurrence of an all-in, side
  pot, minimum raise, blind increase, elimination, qualification, and Elo
  change. They are manually dismissible and fully replayable from the pause menu.
- A limited glossary is currently available inside the playable tutorial and
  live math HUD. A standalone, always-available poker reference is planned.
- Each mode explains **what it actually optimizes** before you select it —
  including that Rational opponents use only information legally available to
  their seat.
- Practice retries are clearly distinguished from scored play; a "restart
  hand/scenario" path exists only where it cannot alter career results.

---

## 9. Saves, recovery, and determinism

Progress is authoritative in **versioned files under Electron's per-user
`userData` directory**, not renderer `localStorage` (browser storage remains
only as a one-time import source).

- **Atomic writes** through a temporary file plus replace/rotation, checksummed,
  retaining at least one previous valid generation. A corrupt write can never
  overwrite the only valid save.
- **Recovery screen** explains which save failed and offers restore from
  last-known-good, export diagnostics, start fresh, or cancel — never silently
  discarding progress.
- **Player-visible Export Save, Import Save, and Reset Progress**, with a
  redacted preview, one-use confirmation, TOCTOU protection, and atomic commit.
  Settings reset is kept visibly separate from progress deletion.
- **Deterministic replay**: engine/content version, PRNG seed, public action
  log, full blind schedule, policy version and simulation count, and public
  entrant data are stored so any scored tournament can be reproduced — *without*
  retaining opponents' hidden cards.
- **Crash-safe autosave** at action and hand boundaries.
- **Crash-loop safe mode**: after repeated startup or renderer failures, the app
  activates a pre-ready safe mode that disables hardware acceleration, ignores
  imported settings, forces reduced motion and mute, disables nonessential
  audio, and exposes a redacted read-only recovery state — while preserving
  progress.

---

## 10. Lifecycle behavior

Unusually careful, and worth calling out as a differentiator:

On minimize, screen lock, Windows suspend, or window blur, the app **freezes the
exact remaining AI-presentation and animation delays** — storing the precise
remaining milliseconds and resuming with that exact remainder — rather than
letting timers drain in real time or restarting them. On resume it shows a brief
readable recap (hand and street, last action, pot, current decision) and
confirms that the inactive time was not counted against Training or Timed Table
play. Saves happen at safe boundaries before close, Windows session end, and
suspend, and the app confirms before abandoning unsaved scored progress — with a
fail-open timeout so a stuck renderer can never trap the window.

---

## 11. Privacy, security, and trust

- **Fully offline.** No account, analytics, ads, remote fonts, CDN assets, bot
  server, or mandatory update check. Fonts and every runtime asset are bundled.
  This is enforced by a packaged **deny-proxy audit that drives representative
  play through every mode** and fails if any endpoint is contacted.
- **Telemetry is absent by default.**
- **Renderer security**: strict Content Security Policy, explicitly enabled
  renderer sandboxing, denied permission requests, blocked unapproved
  navigation/new windows/downloads, validated IPC senders and arguments, and
  only narrow typed preload methods exposed.
- **Packaging integrity**: appropriate Electron fuses enabled and ASAR integrity
  verified — the packaged build refuses tampered application resources.
- **Production hygiene**: developer tools, source maps containing source, test
  hooks, hidden-card access, debug IPC, and authoring tools are absent or
  securely disabled in production packages, verified by audit.
- **Local diagnostics**: rotating local logs with secret, path, and
  user-content redaction, bounded disk use, and a one-click redacted diagnostic
  export.
- **In-app transparency**: a Credits/Licenses screen (font licenses, npm package
  notices, runtime notices), plus visible links for Privacy, Support, version,
  build identifier, save location, log location, and diagnostic export.
- **Play chips only**: static disclosure copy on the start menu plus a one-time
  interactive acknowledgment that chips have no monetary value, enforced by a
  fail-closed audit that scans source, build output, and the packaged ASAR for
  any payment, purchase, cash-out, transfer-for-value, payment SDK, billing IPC,
  or real-money wagering path.

---

## 12. Audio

- Persisted **Master, Music, Effects, and Mute** controls, with keyboard-
  accessible previews.
- No audio graph is constructed or played **before the player's first user
  input** — a deliberate policy, verified by test.
- A deterministic **audio-focus controller** handles pause, blur, device
  disconnect, headphone removal, suspend/resume, and explicit Ready, wired to
  real DOM and Electron `powerMonitor` lifecycle events.
- Card, chip, fold, feedback and deal sounds are verified **not to create hidden
  information or timing tells** the visual interface doesn't already disclose.
- Silent fallback if audio initialization fails, so sound can never block a
  poker action.
- A full **playlist engine** exists — deterministic shuffle with no immediate
  repeats, crossfades, focus/pause integration, and music ducking under feedback
  — but ships **dormant**: no licensed music masters exist yet, so the
  production manifest is empty and the engine provably constructs no audio graph
  and attempts no playback. Music is intentionally not shipped until
  redistribution rights, provenance, masters, attribution, and loudness checks
  are complete.

---

## 13. Localization

- A strict **versioned English message catalog** (~500 keys) with an
  interpolation helper and a direction-safe message component. English ships as
  an explicit complete locale.
- A versioned **numeric locale surface** for number, percentage, ratio, chip and
  duration formatting, keeping quiz parsing unambiguous across decimal comma,
  decimal point, fraction and colon-ratio input.
- **Pseudo-localization** with deterministic 35% text expansion and token
  preservation, plus long-name and **right-to-left** direction tests across 16
  screens.
- Deliberate, documented exemptions: the Training scenario bank (governed by its
  own versioned content schema and review pipeline, since its wording is tied to
  exact EVs and tolerances), and verbatim third-party license text.

---

## 14. iOS / iPadOS companion

A SwiftUI application that **reuses the same TypeScript game logic** rather than
reimplementing it — the engine is exported into a JavaScript bundle executed
on-device via JavaScriptCore, with a typed Swift bridge.

- Deliberately **simplified UI**: flat green table, compact players and live
  cards, tap-to-flip hero cards, no dealer, no free camera.
- **Preserves the backend feature set**: Normal, Rational and Timed tournament
  play, Training with math grading, Decision/Math/Tournament Elo, career
  qualification, local settings and progress.
- All bot equity work stays **on-device**, with a conservative 600-simulation
  ceiling (versus 1200 on desktop) to protect frame rate, thermals and battery.
- The same decision-timing model and speed preference apply, with shorter
  animation budgets, background/inactive pausing that freezes the exact
  remaining delay, and a Skip control matching desktop.
- Safe areas, Dynamic Type, and Reduce Motion are honored.

**Status note:** the Swift code cannot be compiled or validated on Windows. No
Simulator or device validation has been performed, and no App Store submission
work is complete.

---

## 15. Technology and scale

| Aspect | Detail |
|---|---|
| Renderer | React 19 + TypeScript, built with Vite |
| Shell | Electron 43.2.0 (Windows x64) |
| Runtime dependencies | Minimal — `react`, `react-dom`, `lucide-react`, and two bundled `@fontsource` font packages |
| Source size | ~37,000 lines of TypeScript/TSX |
| Test suite | 80 test files / 587 tests (unit, property, soak, accessibility, locale) |
| Mobile | SwiftUI + JavaScriptCore bridge to the shared TS engine |
| Distribution | Signed direct x64 NSIS installer plus a private portable preview |
| Support matrix | x64 editions of Microsoft-supported Windows 11 (Windows 10, ia32 and Arm64 are explicitly **not** claimed) |

### Engineering practices worth noting

- A **release verification pipeline** of 30 stages: package/lockfile integrity,
  dependency vulnerability and registry-origin checks, secret scanning, worktree
  hygiene, release-docs validation, strict typecheck, the full test suite, a
  frozen Training-calibration regression gate, and a production build.
- **Packaged-level audits** run against the real built application: render
  smoke, input smoke, offline deny-proxy through representative play, safe-mode,
  mode completion, save recovery, lifecycle-bridge security, Electron fuses,
  ASAR tamper rejection, static budgets, production composition, and play-chip
  boundary.
- A **bot league regression harness** that compares policy versions by position,
  stack depth, street, action distribution, EV loss, timing leakage, and
  tournament finish distribution before any balance change, gated against a
  frozen baseline.
- A deterministic **CycloneDX SBOM** and a resolved, allowlisted package-license
  inventory generated for each shipped version.

---

## 16. Current status and honest limitations

Version 0.1.0. The desktop game is feature-complete for its intended v1 scope
and packaged, but **not released**. The following are genuinely incomplete, and
any discussion of the product should treat them as open:

**Requires hardware or human acceptance testing not yet performed**
- Physical game controller acceptance
- Windows Narrator / NVDA screen reader acceptance (the code-level semantics and
  live announcements exist; real assistive-technology verification does not)
- 200% display scaling, multi-monitor, DPI change, and display-disconnect testing
- Low-spec / integrated-GPU / discrete-GPU performance matrix and a 60-minute
  thermal and power soak
- Clean-machine install, upgrade, rollback and uninstall testing across Windows
  11 feature releases

**Requires external authority, credentials, or licensing**
- Legal publisher identity, named support owner, and a support contact
- Authenticode code-signing certificate and signature verification
- A stable HTTPS host for the privacy policy
- A signed update mechanism
- IARC/store age-rating questionnaire and store metadata review
- Licensed music masters, attribution, and loudness normalization
- Documented commercial redistribution rights for the supplied start-menu
  artwork and other generated assets
- Qualified poker-math review and consented human pilot evidence — the current
  difficulty and learning calibration baseline is explicitly labeled
  **synthetic-only** and should not be described as validated against real
  players

**Known open engineering issue**
- The packaged input-smoke automation can still hit CDP transport timeouts under
  heavy host CPU contention. This is environmental rather than a product defect
  (it reproduces with an unmodified harness), but it means a single failed
  automated run on a loaded machine should be re-run before being believed.

---

## 17. Suggested framing for discussion

If you are an LLM being asked to discuss this application, useful angles:

- **What makes it unusual**: the strict separation between a deterministic,
  information-redacted poker engine and its presentation; two genuinely
  different AI philosophies as *modes* rather than difficulty levels; dual Elo
  (decision vs. math); anti-tell timing modeling; and lifecycle handling that
  freezes exact remaining animation delays.
- **What it optimizes for**: honest skill measurement and teaching, offline
  privacy, and determinism/reproducibility — every scored tournament can be
  replayed exactly without ever storing opponents' hidden cards.
- **Who it is for**: players who want to *improve* at tournament poker rather
  than gamble — reinforced by being play-chips-only with an audited absence of
  any payment path.
- **Honest weak spots**: it is unreleased and unsigned; accessibility and
  performance claims are code- and instrumentation-level rather than
  hardware-accepted; the learning-calibration baseline is synthetic; music is
  absent pending licensing; and the iOS app is unbuilt on the development
  platform.
