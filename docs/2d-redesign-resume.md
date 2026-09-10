# 2D redesign: paused at the user's request

Status: implementation in progress, NOT approved for desktop release. The user asked to stop promptly because usage is running out, and will type `continue` to resume. Do not restart the task or replace the existing desktop build with this checkpoint yet.

Original requirements: C:/Users/19496/.codex/attachments/4ae82df7-7128-40c4-88b4-173652bde5ac/pasted-text.txt

## Implemented so far
- 2D HUD now has upper-left Leave table and suspended dynamic blind placard; timer, speed, pause/audio retained.
- Equal larger avatars and felt-positioned, seat-oriented opponent cards. Shared CSS and PlayingCard/TwoDAvatar remain in use.
- WinnerReveal consumes authoritative awards/public cards and highlights actual HandValue.cards. Multiple recipients get separate full-width band presentations. Uses the existing event clock/progress, 3800 ms per recipient at 1x (400 entrance + 3000 hold + 400 exit).
- ChipPayoutStream renders at the actual pot group and measures the receiving seat. 800 ms payout events and synthesized payout audio use existing infrastructure. Added optional potId/awardIndex to public award events.
- HandReviewScreen reuses PokerTable with read-only overlay/control slots. deriveHandReview captures createPokerTableSnapshot at each exact decision. Back/Next/Next Key Move uses the existing notable classification and nextPlaybackStep.
- Review mathematical provenance recorded at rational calculation sites and canonical regret, with compact formula/substitution popovers. Strategy formulas, thresholds, and RNG were not intentionally changed. EV audit uses the exact intermediate branch EV and penalty amounts. Original subtraction order was retained.
- progressionRun derives lifecycle from existing career fields. Main Play > 2D goes directly to START/RESUME. New run clears only the selected track's current-run results; qualification advances to configured next event; loss/full completion restarts at first event.
- Preserve checkpoint on leaving, including accepted pending actions. Private suspended career checkpoint is prioritized over practice checkpoint while a run is active. Browser fallback stores the same replay via storage.ts. Startup Back to menu preserves run.

## Verification completed
- TypeScript check and `npm run build` passed on final checkpoint; build emits its large-chunk warning.
- 104 tests passed across handReview.test.ts, rational.test.ts, tournamentRunner.test.ts, tournamentPresentationClock.test.ts, reviewPlayback.test.ts, audio.test.ts. These ran before the last small storage/layout edits; build ran after them.
- Actual browser inspection at 1280x720: live table, progression RESUME, real engine-generated winner, replay review, exact pot-odds popover, sequential navigation.
- Fixed runtime-discovered animation overriding card rotations, avatar SVG escaping winner container, review overlap with hole cards, and pot overlap with top cards.
- Local fixture tools and real engine replay are in ignored `work/redesign/`: generate.ts, fixture.json, preview.html, preview.tsx. URL /work/redesign/preview.html shows actual WinnerReveal over PokerTable with progress slider; ?mode=review shows actual HandReviewScreen.

## Required remaining work (do not declare complete)
1. Add focused behavior tests for winner timing/highlights with 0/1/2 hole cards, multi-pot payout destinations, exact calculation provenance, progression advancement/loss/full completion, accepted-action leave/resume/persistence. Update obsolete HandReviewScreen source-string tests for the redesigned UI (not run yet; old tests expect removed dashboard).
2. Inspect chip stream in actual runtime and tighten geometry/peel timing. Confirm partially paid/split pots don't show stale or duplicate piles; ensure pot amount and stack presentation transition correctly. Rendering currently hides whole static group during its current payout; partial split remainder may need refinement.
3. Review Skip: it now retains award events after its result, but fast-forward result may use an earlier displayed board. SessionHandResult has board. Thread only legitimate public result metadata through so skipped showdown is correct; avoid leaking opponent cards. Consider using normal queued public result events instead of reconstructing reveals.
4. Responsive inspection still pending (especially narrow/mobile and compact-height); final CSS overrides for review felt columns currently follow media block and need attention. Winner avatar should stay visible in narrow layout. Confirm all card lanes clear rail/markers.
5. Test read-only review keyboard/gamepad/accessibility carefully. handleAction rejects review but live table effects/control affordances may need explicit read-only suppression (hero peek still has button semantics). Popover Escape should close only popover. Verify all displayed numbers have provenance and no stale values during selection changes.
6. Review resume edge cases: app close while pending transition, result/advance persistence, navigation to practice and back, replay preservation on restart, stale worker cancellation. Current suspended career checkpoint takes priority over training checkpoint while a run is active; consider whether preserving both requires a cleaner extension to existing private replay storage. Do not put unredacted replay in public progress exports.
7. Verify strategic output before/after unchanged if needed using an original rational.ts from git as a temporary baseline. No unrelated strategy fixes.
8. Source has not been formatted/reviewed fully; remove obsolete comments/imports as appropriate without broad refactor. There is no lint npm script.
9. Run appropriate focused tests/build, package:win, release:update-shortcut only when complete. Commit final work on local main, push main (no force), verify origin contains it and status clean.

## Environment / git
Use `$env:Path = 'C:\Users\19496\.local\node22;' + $env:Path` for npm/vite commands. Default system node is unsupported v20.9. Node22 is 22.23.1.
Use `python -X utf8` for scripted edits; Windows default cp1252 otherwise.
Initially two unrelated modified files (PseudoLocaleScreens.test.tsx and vite.config.ts) and an ahead commit existed. Another task committed/pushed those during this session. They were untouched by this work. Base HEAD before this checkpoint: 6c62925.
Git identity already correct: Seth Skaff / 97866615+SethSkaff@users.noreply.github.com.
Do not reset/rewrite history. This partial work is committed locally on main. Desktop outputs were NOT repackaged and shortcut remains on the previous build.
