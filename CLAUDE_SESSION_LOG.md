# Claude Code session log — 2026-07-23 (Claude-to-Codex handoff)

Multi-agent session: a Claude Fable 5 coordinator planned and delegated all coding
to Claude Opus 4.8 subagents working in this tree. Session was wrapped up early at
the user's request with two Wave 3 agents stopped mid-task (details below). This
file is the authoritative record of what happened; read it together with
`TODOS.md` (kept current) and `CLAUDE_HANDOFF.md` (original Codex-to-Claude brief,
unchanged).

## Environment — read this first

- **System Node is v20.9.0, which is below the repo's `engines >=22.12`.**
  Vitest/Vite cannot even start on it (`node:util` has no `styleText`).
  This session used a portable Node 22.14.0 extracted to a session-temp
  directory that **will not survive cleanup**:
  `C:\Users\19496\AppData\Local\Temp\claude\C--Users-19496-Downloads-Poker\bfbbd379-6d66-4e07-93b4-598cdd414f37\scratchpad\node-v22.14.0-win-x64`
  **Action for next session: install/use Node >= 22.12 before running anything.**
  `tsc --noEmit` works on either Node.
- All verification commands below were run with that Node 22.14.0.

## Git history created this session

The repo had **zero commits** at session start (everything untracked). Three
commits now exist on `main`:

| Commit | Contents |
|---|---|
| `6054879` | Baseline snapshot of the tree exactly as Codex left it |
| `3960ece` | Waves 1–2 (verified: tsc clean, 52 files / 366 tests green) |
| HEAD | Wave 3 (one agent complete+verified, one near-complete, one stopped mid-fix) + this log |

Use `git diff 6054879..3960ece` / `git diff 3960ece..HEAD` to review each wave.

## Current tree state (verified immediately before final commit)

- `npx tsc --noEmit`: **clean**.
- `npx vitest run`: **64 files, 454/455 tests passing — 1 known failure**, fully
  root-caused (see "Known failing test" below; it is a ~2-line fix).

## Wave 1 — completed and verified

### 1a. Stabilization + interrupted tutorial/contextual-prompt work (complete)
Codex's interrupted tutorial agent work was inspected and finished:
- `src/lib/contextualPrompts.ts` rewritten: it only had 4 prompt events; added the
  missing **minimum-raise, blind-increase, elimination, qualification, elo-change**
  (7 required events total), a pure `detectContextualPromptOccurrences()` detector,
  stable priority order, and `resetContextualPromptState()` for replay.
- Signal wiring: `openingBigBlind` + `qualifyingPlaces` threaded from `App.tsx`
  through `TournamentTableControls`; Elo-baseline ref in `PokerTable` detects the
  first Elo change; pause menu "Replay contextual tips" wired to the reset helper.
- The tutorial/prompt UI had **zero CSS** — full palette-consistent styling added
  to `src/styles.css` (`.playable-tutorial`, `.context-coach`), plus the mode grid
  fixed from 4 to 5 columns for the tutorial entry.
- `src/lib/playableTutorial.ts` / `PlayableTutorial.tsx` logic was already complete
  (peek → legal-action → bet-sizing → showdown → math → speed → complete) and was
  left intact.
- New tests: `src/lib/playableTutorial.test.ts` (8), `src/lib/contextualPrompts.test.ts` (14).
- TODOS checked: playable tutorial; contextual prompts.

### 1b. iOS feature parity (advanced; Swift unbuilt — no Xcode on Windows)
- `ios/PokerTrainingPro/Resources/Engine/poker-engine.js` rewritten from 2 ops to
  **11 ops**: `evaluateHand`, `compareHands`, `parseMathAnswer`, `gradeTraining`,
  `eloDelta`, `decisionTiming`, `timedBlinds`, `estimateEquity`, `botDecision`, +
  the original `health`/`dealPreview`. **Parity-verified against the desktop TS
  source of truth** via `src/modes/mobileEngineBridge.test.ts` (14 tests: seeded
  7-card hand byte-comparison, quiz-answer forms, training grading field-by-field,
  timing model 100+ cases, timed blinds across phases).
- New Swift: `Engine/EngineModels.swift`, `Engine/EngineOperations.swift`,
  `Models/MobileScenario.swift`, `DesignSystem/CardViews.swift`,
  `Views/TableTimingModel.swift`, `Views/TrainingQuizView.swift`. Modified:
  `LocalProgressStore` (v1→v2 migration; Elo/streaks/careerResults),
  `SettingsView` (speed slider 0.5–3x), `PokerTableView` (bot play + timing +
  scenePhase freeze of exact remaining delay), `RootView`, `ModeSelectionView`,
  `AppDestination`, `JSONValue`, both test files.
- Mobile equity cap: 600 sims ceiling (desktop 1200), Swift-configurable lower;
  benchmark: `scripts/benchmark-mobile-engine.mjs` (worst case ~0.29 s, 8-way, at cap).
- Docs: `docs/ios/privacy-and-store-submission.md` (new; drafts only, explicitly
  pending Apple/human steps), engine-bridge-contract.md, architecture.md, README.
- **Needs macOS**: compiling Swift, running the Swift tests, simulator/device QA,
  Instruments profiling, all submission steps. iOS TODOS intentionally left unchecked.

## Wave 2 — completed and verified (both agents were killed once by an
account session-limit at ~6:50pm PT and successfully resumed from transcript)

### 2a. Electron lifecycle + saves (all 9 assigned items addressed)
- **Exact delay freezing**: new `src/lib/freezableDelay.ts` (`FreezableDelay`
  stores remaining ms on freeze, re-arms with exactly that remainder) +
  `DelayFreezeGroup` in `src/lib/lifecyclePause.ts`. Previously the AI-presentation
  timeout drained in real time during pause and the arrival timeout restarted.
- `electron/main.cjs`: `powerMonitor` suspend/resume/lock/unlock + window
  minimize/restore/blur/focus broadcast as `lifecycle:event`; `preload.cjs`
  exposes narrow `onLifecycleEvent`. Applied to PokerTable, RoomFlythrough
  (`useAwayFreezeGroup`), and audio focus.
- **Resume recap**: `buildResumeRecap` (hand/street, last action, pot, current
  decision, "time not counted" note) rendered as `role="status"` banner; exact
  inactive spans measured by `LifecyclePauseCoordinator` and excluded from
  Training/Timed timing.
- **Safe-boundary saves**: `main.cjs` close interception with renderer handshake
  (`lifecycle:prepare-close`), save-first, confirm dialog only when scored progress
  is unsaved, 1.5 s fail-open. `session-end`/`before-quit`/suspend covered.
  `useDesktopSaveHandshake` in `src/lib/desktopLifecycle.ts`.
- **Save UI verified end-to-end** (Codex's SaveDataControls + two-phase
  save-transfer backend) with new `SaveDataControls.test.tsx`.
- **Replay retention**: completed-event replay metadata retained in memory after
  leaving ceremony; "Export event replay" button added to `TournamentCeremony`;
  `publicReplayFromCompletedEvent.test.ts` drives a real event to completion and
  asserts seed/hole cards/deck/timestamps absent from the redacted artifact.
- **Safe mode**: `src/lib/safeMode.ts` (`deriveSafeModeSettings` forces muted,
  reduced motion, quick dealing, no fullscreen; preserves progress) wired into
  App's `effectiveSettings`. Button labels kept exactly as
  `scripts/audit-packaged-safe-mode.mjs` pins them.
- **Audio focus**: `src/lib/desktopAudioFocus.ts` maps DOM + powerMonitor events
  into the deterministic `AudioFocusController`; Ready is gesture-based.
- New tests (+6 files/+29): freezableDelay, lifecyclePause, desktopAudioFocus,
  safeMode, publicReplayFromCompletedEvent, SaveDataControls.
- **Documented gaps** (left unchecked in TODOS): durable cross-restart persistence
  of active Training scenario/camera and completed-event replay needs a
  **save-envelope schema extension** (validated across saveMigration /
  save-transfer.cjs / replay-export.cjs — was deferred to avoid destabilizing);
  "update installation" boundary needs the not-yet-existing updater; packaged
  device/focus matrix and packaged safe-mode/crash-loop tests need a package build.

### 2b. Performance (all 5 assigned items implemented)
- **Equity worker**: `decideRationalAction` split into `prepareRationalDecision` /
  `assembleRationalDecision` (`src/modes/rational.ts`); versioned worker protocol
  `src/modes/rationalEquityProtocol.ts` (cancellation honored **between** slices,
  never altering the sample stream); `src/modes/rationalEquityService.ts`
  (single-in-flight, supersede→stale rejection, in-thread fallback when `Worker`
  undefined); `src/workers/equityWorker.ts` (Vite module worker, CSP
  `worker-src 'self' blob:`). Async paths added to tournamentSession/tournamentRunner
  (`...Async`, `TournamentAdvanceAborted`); `App.actInTournament` offloads with
  re-entrancy + abort guards and deterministic sync fail-safe. **Bit-for-bit
  parity with sync proven by tests**; frozen bot baseline and replay tests unchanged.
- **Lazy scenes**: `src/components/SceneLoader.tsx` (`lazyWithPreload`,
  budget-aware fallback with cancel/back past `SCENE_LOAD_BUDGET_MS`);
  PokerTable/PlayableTutorial/RoomFlythrough code-split (13.09/2.75/1.24 kB gz
  chunks + 10.55 kB worker); next-scene preload on navigation.
  `audit-static-budgets.mjs` ok (130 kB gz < 314 kB budget);
  `audit-production-composition.mjs` ok, no baseline update needed.
- **Visibility primitives**: `src/lib/visibilityWorkGate.ts` (`createVisibilityGate`,
  `createVisibilityAwareAnimationLoop`). Audit found no object URLs; histories
  already bounded (decisions slice(-79), results slice(-250)); rAF/timers clean.
  Long-session soak: `src/modes/longSessionMemory.test.ts`.
- **Asset-fault matrix extended**: `scripts/release/packaged-asset-fault-smoke-lib.mjs`
  gained `FAULT_MATRIX`, slow-disk/video/font/audio-device-loss classification and
  validators; `scripts/test-packaged-asset-fault-smoke.mjs` now 13 tests.
- **Deny-proxy through play**: new `scripts/release/packaged-network-play-lib.mjs`
  (play plan: menu → every mode incl. tutorial → actions; pass/fail evaluation) +
  `scripts/test-packaged-network-play.mjs`; `scripts/audit-packaged-network.mjs`
  rewritten to drive representative play over CDP under the deny proxy.
  **Runs against a built package — selectors must be reconfirmed during release
  verification.**

## Wave 3 — partially complete (session wrapped early by user request)

### 3a. Engine bet-legality bug — COMPLETE and verified
Pre-existing scored-play correctness bug (found by the Wave 2 soak): career
events use `scaledStructure` (blinds snapped to multiples of 25), so
`bigBlind/4` chip units become fractional (12.5, 37.5); `roundChips` in
`src/modes/rational.ts` then proposed half-chip targets (e.g. `to: 187.5`) that
`requireTarget`/`assertChipAmount` (`src/engine/betting.ts:78`) correctly
rejected — **aborting the tournament event**. Reproduced deterministically
(seeds `sweep-normal-6/9/12/18/23`, `sweep-rational-3/4/5/7/9`).
**Fix**: `roundChips` now rounds its snapped result to a whole chip — a no-op for
all integer units, so only previously-crashing states change. Engine validation
left strict. Frozen bot-league baseline **byte-identical** (it uses bigBlind 100 →
unit 25; exact-equality test passes unchanged); replay determinism green.
New regression test `src/modes/betTargetLegality.test.ts` (10 formerly-aborting
seeds now complete); `longSessionMemory.test.ts` abort-tolerance removed —
asserts `abortedEvents === 0`.

### 3b. Input systems agent — STOPPED just before its final full-suite run
Its last status: typecheck clean, starting the full suite. Work on disk (appears
complete but **final verification was not run by that agent**; the coordinator's
final suite run passed everything except the known saveTransfer failure below,
which is not this agent's):
- `src/lib/actionMap.ts` + test — versioned shared action map (stable action ids,
  per-device bindings), existing hotkeys preserved.
- `src/lib/gamepad.ts`, `src/lib/inputDevice.ts`, `src/lib/focusNavigation.ts`,
  `src/lib/inputCaptureGate.ts` (+tests) — Gamepad API polling, last-input-device
  awareness for contextual prompts, focus navigation, capture gating.
- `src/components/GamepadNavigationProvider.tsx`, `src/components/ControlsRemapPanel.tsx`
  (+test), `src/components/DialogFocusContract.test.tsx`, new `src/hooks/`.
- `src/lib/controlBindingsPersistence.test.ts` — remap persistence.
- Integration edits in App.tsx / PokerTable.tsx / SettingsPanel.tsx / styles.css.
**Next session: review this work against its four TODOS items (action map,
controller navigation/prompts, remapping with conflict/reserved detection +
per-device defaults + reset, focus contract on every modal), then check off
whichever are genuinely complete.**

### 3c. Audio + trust surfaces agent — STOPPED MID-FIX (source of the one failing test)
Work on disk: `src/lib/musicPlaylist.ts` + `musicDucking.ts` (+tests) — dormant
playlist engine (deterministic shuffle/no-repeat/crossfade/ducking);
`src/data/musicPlaylistManifest.ts`; `src/components/CreditsScreen.tsx`,
`AboutSupport.tsx`, `PlayChipAcknowledgment.tsx`; `src/lib/creditsData.ts` (+test),
`useCreditsResources.ts`, `playChipDisclosure.ts` (+test); edits to audio.ts,
saveMigration.ts, storage.ts, types/poker.ts, SettingsPanel, Dashboard, App,
main.cjs/preload.cjs (~93 lines, likely open-folder/links), package.json.
Status of its 5 items: playlist engine/credits/about/disclosure code exists with
tests, but the agent was killed while tracing a save-layer issue and **its work is
unreviewed and unverified as a whole** — treat 3b/3c as needing review + completion.

## KNOWN FAILING TEST — root-caused, small fix

`src/lib/saveTransfer.test.ts > two-phase save import > requires a one-use
confirmation and keeps a valid prior generation`

The audio/trust agent added a new progress field **`playChipsAcknowledged`**
(interactive play-chip disclosure) to the TS types/defaults and to this test's
expected imported payload — but the **Electron CJS save layer re-normalizes
progress and drops unknown fields**, so the persisted payload lacks the field and
the `toMatchObject` on the serialized payload fails. The agent's literal last
words before being stopped: "The Electron CJS save layer re-normalizes progress
and drops the unknown field. Let me find where."
**Fix**: add `playChipsAcknowledged` (boolean, default false) to the progress
normalization allowlist in the Electron save layer — look in
`electron/save-transfer.cjs` and/or `electron/save-store.cjs` (whichever
normalizes progress keys) and mirror however `onboardingCompleted` is handled.
Then confirm the full suite is green (expected 64 files / 455 tests).

## TODOS.md items checked off this session (all with test evidence)

1. Playable tutorial (Wave 1a)
2. Contextual prompts ×7 events (Wave 1a)
3. Minimize/lock/suspend lifecycle with exact delay freezing (2a)
4. Resume recap + inactive-time exclusion (2a)
5. Player-visible Export/Import/Reset with preview/confirm (2a — verified + tested)
6. Completed-event replay retention + player-visible event-end export (2a; durable
   cross-restart retention still needs the save-envelope extension — noted inline)
7. Public replay export controls + artifact review (2a)
8. Async sliced equity boundary into live progression (2b)
9. Lazy-loading with progress + cancel/back (2b)

## Remaining roadmap (planned waves not yet run)

- **Wave 3 completion**: review/finish 3b + 3c, fix the saveTransfer test, then
  check off their TODOS items as earned.
- **Wave 4**: (a) Accessibility baseline — ARIA names/roles/announcements for
  Narrator/NVDA, text-scale controls + 200% verification, WCAG 2.2 AA contrast +
  24px targets, no color-only encoding, granular reduced-motion controls, camera
  sensitivity/FOV/auto-move options, motion-flash analysis via
  `scripts/audit-motion-flash.mjs`, persistent-until-dismissed notices, visual↔audio
  equivalents. (b) Save-envelope schema extension — durable active-Training-
  scenario/camera/transition state + completed-replay retention (unblocks the two
  gaps from 2a). These two touch disjoint areas and can run in parallel.
- **Wave 5 (solo — touches every component)**: string extraction into versioned
  English locale resources, route remaining numeric/date surfaces through the
  locale layer, pseudo-localization/expansion/RTL tests.
- **Wave 6**: rebuild package from frozen source and run every gate (freshness,
  typecheck, tests, packaged-render smoke, offline deny-proxy THROUGH PLAY in all
  modes — new audit from 2b, asset-fault, fuses, ASAR integrity, safe-mode,
  motion-flash on packaged RC, visual smoke at 1100×720/1280×720/1366×768/
  1920×1080/2560×1080), packaged input-path verification, Windows identity
  metadata. Only then update the "packaged/previewed" TODOS.

## Blocked items — need things no agent can supply (do NOT mark complete)

- Higgsfield ambient menu video: waiting on `higgsfield auth login` by the user.
- Music: license verification, licensed masters, loudness normalization, long-
  session playback tests (playlist engine is built and dormant).
- Authenticode signing, publisher identity, signing service, fee budget.
- Clean-machine Windows 11 matrix; low-spec/typical/discrete-GPU benchmarks.
- Privacy policy HTTPS hosting + publisher support contact.
- IARC/store questionnaires, store metadata review, press materials approval.
- Qualified poker-math human review + consented pilot evidence.
- Supplied start-menu artwork provenance/redistribution rights.
- Apple: everything requiring macOS/Xcode/App Store Connect.
