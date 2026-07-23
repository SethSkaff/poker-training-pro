# Poker Training Pro — Codex-to-Claude handoff

## Project and objective

Work only inside `C:\Users\19496\Downloads\Poker`.

Finish Poker Training Pro by completing every actionable item in `TODOS.md`,
continuously implementing, testing, reviewing the desktop UI against the user's
supplied reference, packaging, and fixing defects. Desktop is the shipping
priority; iOS follows with the same backend features and a simplified UI.

The user most recently paused Codex work due to usage limits and asked to open
this session in Claude Code CLI. Do not assume the project is finished.

## Product requirements that must remain true

- Desktop application, not a website. Electron/Windows is the primary target.
- Start directly on the supplied poker artwork with the same large Play and
  Settings chip-button hierarchy. Hover/focus uses yellow text. There is no
  separate splash screen.
- The start flow should feel like entering a premium console game, inspired by
  Mario Kart World's interaction hierarchy without copying protected art,
  wording, geometry, colors, or assets.
- Four modes: Normal, Rational, Training, and Timed Table.
- Career is a play-through mode with event progression and results, not a
  dashboard tab.
- Normal and Rational run tournament poker. Rational follows information-set
  poker math; Normal remains strong but adds bounded personalities, bluffing,
  and strategic variation.
- Training presents one-move poker scenarios with one related math question,
  Decision Elo, Math Elo, timing, and clear feedback. Quiz answers accept
  percentages, decimals, fractions, and ratios such as `33%`, `0.33`, `1/3`,
  and `2:1`.
- Timed Table asks how many minutes are available, uses Normal opponents, and
  increases blinds monotonically to force a heads-up/all-in end condition near
  the deadline. It has no career advancement but does award placement Elo.
- Desktop table presentation includes a championship-room arrival, limited
  left/right camera, animated cards/chips/characters, physical-feeling betting
  and folding, hotkeys, opponent timing variation, and a speed slider.
- After a round/table move, show a slim faded progress overlay while the camera
  travels to the next seat; do not make it a separate results screen.
- Mobile keeps every backend feature but uses a compact flat table, no dealer
  or free camera, tap-to-flip hero cards, safe areas, and native on-device bot
  math.
- Desktop palette bridges casino materials and colorful console-game energy:
  deep emerald, ivory, black lacquer, brass, cyan, coral, warm yellow, sky blue,
  and clay-chip red.
- Avoid generic “AI trainer/dashboard” patterns, filler badges/copy, decorative
  clutter, and unexplained status labels.
- Opponent bets must never overlap stack balances; card ranks/suits and all
  controls/labels must remain unobscured at every supported size.
- Instrumental music is deferred until redistribution rights, provenance,
  masters, attribution, loudness, memory, and package-size checks are complete.

## Current implementation state

Use the worktree and `TODOS.md` as authoritative; inspect before editing.

Already implemented and previously tested:

- Poker engine, side pots, blinds, evaluation, information-set redaction.
- Rational/Normal policies, Training bank/grading, Timed blind director.
- Four-mode game flow, career events/results, room arrival/progress overlay.
- Hotkeys, camera controls, AI timing, speed control, pause menu.
- Durable Electron saves, migrations, atomic generations, recovery, logging,
  crash-loop safe mode backend, replay/resume, save import/reset backends.
- First-run accessibility setup and game settings.
- Windows packaging, offline/security/fuse/ASAR checks and multiple release
  audit scripts.
- iOS scaffold and simplified mobile table.

Recent Codex changes:

- Added player-facing save export/import/reset, diagnostics, and public replay
  controls in Settings.
- Consumed Electron safe-mode state in the renderer.
- Added deterministic tournament replay/resume tests.
- Fixed table collisions:
  - separated opponent bet pills from stack labels;
  - removed overlap between hero cards;
  - separated hero cards, action context, and action dock;
  - moved camera controls away from the top opponent.
- Live rendered collision evidence is saved in
  `work/table-collision-audit.json`. It covers 1100×720, 1280×720,
  1366×768, 1920×1080, and 2560×1080 with zero reported intersections.
- A tutorial/contextual-prompt agent edited `App`, `Dashboard`,
  `PokerTable`, styles, and tutorial/prompt components immediately before work
  was paused. Inspect those edits for completeness and test them.

## Important release state

- Source was changed after the last package was built, so existing packaged
  hashes/artifacts may be stale.
- The release coordinator was interrupted while restarting the package from
  the latest source.
- Before claiming a package is current, rebuild from the present source and
  rerun freshness, typecheck, tests, packaged-render, offline/network,
  asset-fault, fuse, ASAR-integrity, and visual smoke gates.
- Do not claim Authenticode/App Store/hardware-matrix/legal approval work is
  complete without the external credentials, devices, publisher identity,
  licensed masters, and human review those items require.

## Last verified checks

- TypeScript `tsc --noEmit` passed before the interrupted tutorial edits.
- Focused Vitest suite passed 31/31:
  `src/lib/audio.test.ts`,
  `src/lib/durablePersistence.test.ts`,
  `src/modes/tournamentReplay.test.ts`,
  `src/modes/tournamentRunner.test.ts`.
- The live six-seat collision matrix passed all five viewport sizes.
- Mouse card peek/hide, keyboard camera left/recenter, pause focus wrap,
  speed hotkey, custom-raise panel, and hand-history hotkey were manually
  exercised in the live renderer.

## Resume procedure

1. Read all of `TODOS.md`, then inspect current source changes and running
   processes.
2. Typecheck and run focused tests immediately; repair interrupted tutorial
   work if needed.
3. Rebuild a fresh package only after runtime files are frozen.
4. Continue the highest-value actionable desktop TODOs, adding tests and
   evidence before checking them off.
5. Keep `TODOS.md` current and do not mark external/legal/device tasks complete
   without authoritative evidence.

