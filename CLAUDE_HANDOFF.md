# Poker Training Pro — Codex-to-Claude handoff (2026-07-24)

## Workspace and objective

Work only in `C:\Users\19496\Downloads\Poker`. Keep `TODOS.md` as the
canonical backlog. Desktop Electron/Windows remains the shipping priority;
iOS/iPadOS uses the same local game backend with a compact native UI.

The user is temporarily out of Codex usage and wants Claude Code to continue
implementation, testing, and backlog maintenance. Do not claim external,
hardware, publisher, licensing, or Apple submission tasks complete without
their actual evidence.

## Non-negotiable product behavior

- Start directly on the supplied poker-artwork menu—no separate splash. Match
  its Play/Settings chip-button hierarchy: Play is yellow when hovered/focused;
  Settings is white otherwise. Do not copy protected Mario Kart/Balatro/Discord
  expression; only the high-level game-flow affordance is inspiration.
- Four modes: Normal, Rational, Training, Timed Table. Career is a tournament
  mode flow, not a dashboard tab. Quiz input accepts `%`, decimal, fraction, and
  ratios (`33%`, `0.33`, `1/3`, `2:1`).
- Desktop needs room arrival, left/right look, cartoony physical card/chip
  motions, hotkeys, opponent timing, a speed control, and safe skip-to-result.
- Never allow card ranks/suits, bet amounts, stacks, labels, or action controls
  to overlap at supported window sizes.
- The app is offline, play-chip-only, with no real-money wagering.
- Mobile is deliberately simplified (flat felt, compact players/live cards,
  tap-to-reveal hero cards, no dealer/free camera) but keeps local poker,
  tournament, Elo, Training, Normal, Rational, and Timed Table behavior.
- Do not add soundtrack assets until commercial redistribution rights, masters,
  attribution, and loudness evidence exist.

## What Codex completed in the latest pass

### Desktop

- Fresh visual review at `http://127.0.0.1:5173/` confirmed the main menu uses
  the supplied reference artwork and Play-yellow/Settings-white composition.
- Added explicit screen-reader semantics to the desktop table:
  face-up/down cards are images, community cards a named group, player seats
  named groups, and decorative duplicated avatar/card/chip children hidden.
  `src/components/PokerTable.accessibility.test.ts` covers this.
- Added an immutable versioned English message-resource foundation,
  deterministic 35%-expansion pseudo locale, RTL DOM direction support, a
  `LocalizedMessage` component, and tests. The main menu’s Play/Settings
  accessible labels now consume that catalog. Full component string migration is
  still an unchecked TODO.
- Fixed the TypeScript cast in `src/modes/iosTournamentEngineBridge.test.ts` so
  `tsc --noEmit` is clean.
- Current package artifacts were rebuilt on 2026-07-24:
  - `outputs\desktop\Poker Training Pro-Setup-0.1.0-x64.exe`
  - `outputs\desktop\Poker Training Pro-Portable-0.1.0-x64.exe`
  - `outputs\desktop\win-unpacked\Poker Training Pro.exe`

### iOS shared game backend

- Added/validated the generated browserless tournament bridge:
  `ios/PokerTrainingPro/Resources/Engine/tournament-session-engine.js`, built
  from `ios/tournament-session-engine-entry.ts` with
  `scripts/export-ios-tournament-engine.mjs`.
- `SharedTournamentSessionBridge.swift` now safely escapes JSON requests using
  `JSONEncoder` (not Foundation top-level `JSONSerialization`), exposes
  create/act calls, and has native XCTest source.
- Replaced `PokerTableView.swift`’s fixed demonstration deal/players/actions
  with hero-safe live Normal/Rational/Timed tournament state: legal actions,
  raise/bet range slider, cards, stacks, bets, blinds, pots, result ceremony,
  local Tournament Elo, and public career qualification persistence. Training
  stays a separate one-move coaching view.
- Updated iOS architecture/README/TODO notes to state this accurately. Windows
  cannot compile this Swift; do not report Simulator/device validation as done.

## Last verified commands (all passed)

Use the bundled Node runtime, not the system Node:

```powershell
$node = 'C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node .\node_modules\typescript\bin\tsc --noEmit
& $node .\node_modules\vitest\vitest.mjs run --reporter=dot
& $node .\scripts\export-ios-tournament-engine.mjs --check
& $node .\node_modules\vitest\vitest.mjs run src\modes\iosTournamentEngineBridge.test.ts src\modes\iosLayoutContract.test.ts src\components\PokerTable.accessibility.test.ts src\lib\localeMessages.test.tsx --reporter=dot
& $node .\node_modules\vite\bin\vite.js build
& $node .\scripts\audit-packaged-input-smoke.mjs
& $node .\scripts\audit-packaged-lifecycle-bridge-security.mjs
```

The latest packaged input smoke passed mouse, keyboard, Gamepad API mapping,
peek, drag-fold, raise slider, history, pause/resume, high contrast/reduced
motion preference flow, minimize/restore, and the six-seat collision geometry
gate. It is not physical controller or assistive-technology acceptance.

## Current TODO reality

Review the 44 unchecked entries in `TODOS.md` before changing status. The
highest-value remaining locally implementable work is:

1. Finish migration of player-facing strings into the new message catalog and
   extend full-screen pseudo/RTL visual tests.
2. Add code-verifiable contrast/target-size coverage where it is sound; do not
   mistake it for real Narrator/NVDA/high-contrast/display acceptance.
3. Extend local performance/instrumentation only where it gives meaningful
   evidence—not fabricated hardware results.

The remaining items genuinely blocked by external authority/platform include:

- physical controller, Narrator/NVDA, multi-monitor/DPI/200%-scale, device/audio
  focus, low-spec/long-soak, and clean-machine Windows validation;
- macOS/Xcode, iPhone/iPad Simulator/device, Instruments, TestFlight, App Store;
- publisher identity/support contact/privacy HTTPS host, signing certificate,
  Authenticode, update host, IARC/store material/accounts;
- commercial asset/font/start-menu-art/music provenance and licensed music
  masters/attribution; qualified poker-math and consented human-pilot review.

## Safety and workflow

- The worktree is intentionally dirty; preserve unrelated existing changes.
  Never reset or checkout files wholesale.
- Use `apply_patch` for edits. Use `rg` first for code search.
- Rebuild `dist` and package only after desktop runtime files are frozen.
- On Windows, Electron Builder sometimes leaves packaging child processes alive
  after the invoking shell returns. Check `Get-Process 7za,makensis,node` and
  `outputs\desktop` timestamps before concluding the installer/portable build
  failed.
- Do not fake iOS Simulator/Xcode or release credentials. Document those
  blockers precisely in `TODOS.md` instead.
