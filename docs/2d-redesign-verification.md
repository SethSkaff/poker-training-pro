# 2D redesign verification and desktop activation

Implemented in `bcc0f05` and `d04fffb`, committed and pushed on main. Windows activation completed on September 10, 2026. The packaged 3D composition audit remains incomplete as described below.

## Delivered

- Shared 2D table with a suspended dynamic blinds placard, retained timer/speed/pause/audio, equal avatars, and felt-oriented hole cards.
- Full-width winner reveal using authoritative awards, public cards, and evaluator best-five highlights. Each recipient receives a 400 ms entrance, 3000 ms hold, and 400 ms exit at 1x.
- An 800 ms chip peel stream, accurate split-pot remainder and recipient stack presentation, and mute/volume-aware payout audio. Animations never determine settlement.
- Game Review reuses PokerTable with read-only decision snapshots, Back/Next/Next Key Move, original scoring, and inspectable evaluator formulas. Narrow layouts use compact Math/Alternatives controls.
- START/RESUME progression through configured events, with qualification advancement and restart after loss or final completion. Private checkpoints preserve accepted actions across animations, leaving, practice, loading cancellation, and restart.
- Skip retains the actual terminal board, public reveals, and payout queue. No strategy retuning.

## Verification

- 338 distinct targeted tests passed across table presentation/accessibility, review/provenance, winner/payout, rational policy, tournament runner, progression, native/private saves, lifecycle, and audio. Reports remain in ignored `work/redesign/{test-results,retest,final-tests,app-tests}.json`; later reports supersede obsolete source-assertion failures.
- 36 evaluator decisions matched the pre-redesign `6c62925` implementation exactly after excluding added metadata: recommendations, distributions, EVs, and equity.
- TypeScript and production build passed, including the final activation build. The large 3D bundle warning remains; no lint script is configured.
- Actual browser inspection covered desktop live play, winner reveal, successive moving payout frames and final pot/stack, review navigation/formula/Escape, narrow 390x844 winner/review, Math expansion, and leave -> practice -> reload -> exact career continuation.

## Desktop release

- The old game instances closed before activation. Windows NSIS, portable, and unpacked builds were successfully written under `outputs/current`.
- `release:audit-packaged-licenses` passed against the installed unpacked build.
- `release:update-shortcut` passed. The Desktop shortcut resolves to `outputs/current/win-unpacked/Poker Training Pro.exe`; the executable and working directory were verified.
- The installed `resources/app.asar` matches the previously verified candidate byte-for-byte. SHA-256: `519DA79056919CA746C275423B9BCE8A94CFA79C7A101BB42DFA0E7A48292A8E`.
- No release/test processes remain running.

## Unresolved validation limit

`npm run package:win` completed its build and packaging stages but returned failure from its packaged 3D audit: `Scene audit failed during composition-matrix: CDP command Runtime.evaluate timed out.` The retry after closing both old game instances failed at the same stage. Consequently, the full package command is not reported as passing. This timeout has not been established as pre-existing, and no unrelated 3D rendering changes were made to address it. The license audit was run separately and passed.

Audit navigation was updated from the removed Enter event button to the progression START control. Logs: `work/redesign/activation-package.log` and `work/redesign/activation-licenses.log`.

Original request: C:/Users/19496/.codex/attachments/4ae82df7-7128-40c4-88b4-173652bde5ac/pasted-text.txt
