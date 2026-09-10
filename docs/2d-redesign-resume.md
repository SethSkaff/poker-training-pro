# 2D redesign implementation and release checkpoint

The implementation is complete. Desktop activation is still pending because two user-open instances lock `outputs/current/win-unpacked/Poker Training Pro.exe`. Normal CloseMainWindow requests did not release them; do not force-kill sessions or discard scored progress. The user was asked to close both windows and resolve any save prompt. A subsequent “continue” did not release the lock.

## Implemented

- Shared 2D table HUD with upper-left Leave table, suspended dynamic blinds, retained timer/speed/pause/audio, equal avatars, and felt-oriented hole cards. The 3D HUD retains its existing information.
- Full-width winner reveal driven by actual awards/public cards and evaluator best-five selection: 400 ms entrance, 3000 ms hold, 400 ms exit per recipient at 1x. Split/side-pot recipients receive accurate amounts.
- Authoritative payout projection, 800 ms chip peel stream from the actual pot to the recipient, retained split-pot remainder, and mute/volume-aware synthesized payout audio. Visual timing never settles the hand.
- Game Review reuses PokerTable with read-only decision snapshots, previous/next/key-move navigation, original quality scoring, and exact evaluator calculation provenance. Narrow layouts use compact Math/Alternatives toggles.
- START/RESUME progression through configured events. Qualification advances; loss/final completion permits a new run at the first event. Accepted transitions persist before animations finish. Private checkpoints preserve career runs across practice, leaving, and restart, including loading cancellation.
- Skip keeps the real terminal board, public reveals, and award queue. No strategy retuning.

## Verification

- 338 distinct targeted tests passed across table presentation/accessibility, winner/payout, review/provenance, rational policy, tournament runner, progression, private/native save round trips, lifecycle, and audio. Reports: `work/redesign/{test-results,retest,final-tests,app-tests}.json` (later reports supersede initial obsolete source-assertion failures).
- 36 evaluator decisions matched the pre-redesign `6c62925` implementation exactly after excluding added metadata: recommendations, distributions, EVs, equity. Script: `work/redesign/compare-strategy.ts`.
- TypeScript and production build passed. Existing large 3D bundle warning remains. No lint script is configured.
- Actual browser checks: desktop live table, winner reveal, successive moving payout frames and final stack/pot, review navigation and formula/Escape, narrow 390x844 review/winner, compact Math toggle, and leave -> practice -> reload -> exact career continuation (accepted 50-chip call preserved).
- Windows NSIS and portable packages built successfully in `outputs/redesign-candidate`. Packaged license audit passed.
- Packaged 3D audit navigation was updated from obsolete “Enter event” to the new run START control. The candidate audit then failed during composition-matrix with `CDP command Runtime.evaluate timed out`; this is an unresolved packaged 3D validation limit, not established as pre-existing. No 3D rendering changes were made to address it.

## Safe release continuation

1. Use Node 22: `$env:Path = 'C:\Users\19496\.local\node22;' + $env:Path`.
2. Check `work/redesign/package-scene.log`. The prior audit ended and cleaned up its isolated process. Retry after closing the old game instances; do not claim it passed without completion.
3. Ensure both old user game windows are closed. Their original process IDs were 8936 and 11760; verify current executable paths instead of assuming IDs remain valid.
4. `npm run package:win` could not replace the locked executable. Its cleanup removed unlocked runtime files, so all 71 missing files were restored from the existing matching portable release. The old executable and app.asar hashes matched that archive; current build remains the previous release. The old portable extraction is in ignored `work/redesign/previous-unpacked`.
5. After the lock clears, run `npm run package:win`, then `npm run release:update-shortcut`. Verify the actual target and clean git status. Never overwrite only app.asar while retaining an incompatible integrity-stamped executable.
6. The implementation is committed/pushed on main; preserve unrelated changes and history. Git identity is Seth Skaff / 97866615+SethSkaff@users.noreply.github.com.
7. `release:update-shortcut` succeeded and verified the required target, which still contains the restored previous release. Re-run after activation.

Original request: C:/Users/19496/.codex/attachments/4ae82df7-7128-40c4-88b4-173652bde5ac/pasted-text.txt
