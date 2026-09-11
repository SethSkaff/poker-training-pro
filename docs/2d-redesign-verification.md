# 2D redesign verification and desktop activation

Implemented in `bcc0f05` and `d04fffb`, committed and pushed on main. Windows activation completed on September 10, 2026. The packaged 3D composition audit remains incomplete as described below.

## Delivered

- Shared 2D table with a suspended dynamic blinds placard, retained timer/speed/pause/audio, equal avatars, and felt-oriented hole cards.
- Full-width winner reveal using authoritative awards, public cards, and evaluator best-five highlights. Each recipient receives a 400 ms entrance, 3000 ms hold, and 400 ms exit at 1x.
- An 800 ms chip peel stream, accurate split-pot remainder and recipient stack presentation, and mute/volume-aware payout audio. Animations never determine settlement.
- Game Review reuses PokerTable with read-only decision snapshots, Back/Next/Next Key Move, original scoring, and inspectable evaluator formulas. Narrow layouts use compact Math/Alternatives controls.
- START/RESUME progression through configured events, with qualification advancement and restart after loss or final completion. Private checkpoints preserve accepted actions across animations, leaving, practice, loading cancellation, and restart.
- Skip retains the actual terminal board, public reveals, and payout queue. No strategy retuning.

## Review contracts restored after the redesign

The redesign replaced the review dashboard with the live table, and four
contracts the old dashboard carried were dropped rather than re-homed. The
obsolete source-string tests that guarded them were removed with the dashboard,
so nothing failed. They are reinstated in the redesigned screen and are now
covered behaviourally instead of by string matching:

- **Keyboard navigation.** The old vertical timeline bound Up/Down; the
  horizontal redesign bound only Left/Right, so a keyboard user's habit stopped
  working, and `M` (jump to the next key move) had no coverage. Both axes and
  `M` now resolve through the pure `reviewKeyboardTarget`, which is tested for
  advance, step-back, clamping at both ends, case-insensitive `M`, the
  no-key-move case, keys it must ignore, and the empty-review case.
- **Quality is never colour-only.** The verdict panel is coloured by
  `data-quality`, but the decision selector had lost the written quality.
  `decisionOptionLabel` restores a distinct glyph *and* the localized word on
  every entry.
- **Discoverability.** `review.keyboardHint` is displayed again, so the
  shortcuts are findable without documentation.
- **Localization.** The pre-redesign screen made 63 `formatMessage` calls; the
  redesign shipped 9 and hard-coded the rest in English while all 92 `review.*`
  keys remained in the catalogue. The screen's chrome, metric labels, verdict
  copy and error states go back through the catalogue, with uppercase styling
  left to CSS. `formatMessage` throws on an unknown key, so a typo fails loudly.

`review.basis` is displayed again alongside the confidence band, so the equity
estimate states the simulation count it came from.

Read-only semantics are now asserted rather than assumed: `handleAction`
rejects review before any other guard (so keyboard, gamepad and pointer input
are all covered by one gate), the hero card surface degrades from `button` to a
`div` with `role="group"`, Skip is suppressed, the live callbacks are the shared
no-op, and the calculation popover's Escape handler stops in the capture phase
so it cannot also reach the table's own Escape handling.

Winner reveal gained the visible-card cases the checkpoint asked for: an
unrevealed hand shows two face-down cards and no hand name; a showdown that did
not reveal a player never falls back to that player's seat cards; a single
revealed card is highlighted without padding the hand back to two; and only the
board cards the winning five actually used are marked.

One latent CSS trap from the checkpoint is resolved. The review felt columns
were positioned inside a `max-width: 760px` block, then again unconditionally,
then again by a second block with the *identical* condition. The first block's
positioning could never reach the page. It is removed with a comment recording
why re-adding it there would not work.

## Verification

- Full unfiltered `vitest run`: 228 files, 1545 tests, 0 failures.
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

## Still outstanding

- The 2D table's own new overlays are not localized: `WinnerReveal`
  ("WINNER", "Chips awarded", "Won uncontested", "Hand winner") and the review
  mobile tab labels' surrounding chrome were authored in English. Unlike the
  review screen this is new copy rather than a regression, and neither the
  winner overlay nor Game Review is part of the pseudo-locale sweep, so no test
  covers either. Adding both screens to that sweep is the natural next step.
- `PokerTable.tsx` still carries the removed footer as a `{false && ...}` block,
  which keeps `useIsGamepadActive` and a run of `table.footer.*` lookups alive
  in the bundle. Deleting it is safe but touches locale-usage auditing, so it is
  left for a focused cleanup.
- Responsive behaviour beyond the resolved cascade order was verified by browser
  inspection only; there is no automated narrow-layout coverage.

## Unresolved validation limit

`npm run package:win` completed its build and packaging stages but returned failure from its packaged 3D audit: `Scene audit failed during composition-matrix: CDP command Runtime.evaluate timed out.` The retry after closing both old game instances failed at the same stage. Consequently, the full package command is not reported as passing. This timeout has not been established as pre-existing, and no unrelated 3D rendering changes were made to address it. The license audit was run separately and passed.

Audit navigation was updated from the removed Enter event button to the progression START control. Logs: `work/redesign/activation-package.log` and `work/redesign/activation-licenses.log`.

Original request: C:/Users/19496/.codex/attachments/4ae82df7-7128-40c4-88b4-173652bde5ac/pasted-text.txt


## Focused correction pass — 2026-09-10

- Raised the full 2D composition, extended placard supports to the screen edge,
  removed the visual timer while retaining speed/pause/audio controls, and
  centered the gathered pot with its amount.
- Corrected the six card lanes and kept markers beside identities. Name panels
  now contain only names. Persistent stacks sit beside the card area; lower-seat
  stacks use the open outside corner to avoid avatars. Bet piles sit inward.
  Compact layouts place stack piles above/below cards where lateral room is tight.
- Enlarged review columns and added charcoal backing to the verdict below the
  board. Long explanations can scroll within the right panel above navigation.
- Added transient gathered-pot/collection/payout memory, including ordered split
  awards and uncalled returns. Inclusive engine amounts and settlement are unchanged.
- Inspected actual React table/review components in the browser at 1280×720 and
  in 390×844 frames: six active seats, preflop/flop review, bet collection,
  payout travel and the event-less frame after payout. Observed 0 central + 25/50
  outstanding, then 75 central + no outstanding labels. Observed the final
  winner stack remain 31,175 with central pot 0 after payout and card collection.
- Focused Vitest suite: 99 passing tests, including nine accounting regressions.
  Typecheck and Vite production build passed. No lint script is configured.
  The production build reports the existing large-chunk advisory.
- Packaging uses the build/electron-builder stages directly, honoring the request
  to avoid unrelated audits. The first current-output attempt hit a Windows file
  lock; the user closed the running app before replacement was retried.
- Final Windows NSIS/portable packaging completed successfully. The packaged
  HTML/JavaScript/CSS entry assets match the production build byte-for-byte.
  `npm run release:update-shortcut` updated the Desktop shortcut to
  `outputs/current/win-unpacked/Poker Training Pro.exe`.


## Seat geometry and review extension — 2026-09-11

- Replaced independent seat offsets with a shared ellipse projection. Card pairs
  follow the local tangent; stack piles use the seat's personal-left and wagers
  move along the inward direction. Raised the composition to an 80px offset and
  moved Skip below the table, clear of speed/pause controls.
- Zero gathered pot has no visible readout. Inclusive engine accounting and the
  upstream accessible total-pot announcement remain intact. The 2D timer stays
  removed as requested; speed, pause, and audio remain available.
- All-in reveals now require closed betting and include every live hand when at
  most one player retains an actionable stack. Unequal caps and a covering stack
  are supported. The existing public equity estimator and tie semantics are reused.
- Evaluator-selected winning five receive lift, scale, a yellow border and gold
  glow. No hand ranking or payout arithmetic changed.
- Enlarged review columns/verdict; anchored the verdict below the measured board.
  The bottom review hand sits beside the board. Restored summary and meaningful
  street metrics from retained HandReview calculations above the central pot.
- Continuous move Accuracy uses the evaluator's uncertainty-adjusted regret:
  100% inside the 0.02 BB best tolerance, with the 0.35 BB good boundary anchoring
  95% and exponential decay beyond. Existing strategic classifications are unchanged.
  Its displayed calculation exposes both tolerances and the actual regret.
- One shared formula selection replaces the previous formula; only the general
  and substituted expressions are shown. Escape closes it. Move On calls the
  existing exit callback when no later key move remains.
- Restored the existing TourLobby route and event board, with current-only
  Start/Resume and retained loss-reset behavior. Wrapped titles within route nodes.
- Actual component previews inspected at 1280x720: all six simultaneous wagers,
  zero gathered pot, speed without timer, five highlighted winner cards, unequal
  six-way all-in flop/turn/river, preflop/flop review, formula replacement, Move On,
  and completed/current/future route nodes. Review also inspected in a 1920x1080
  frame. Verdict starts 8px below the board; bottom identity ends about 56px above
  the action buttons at 1280x720. Formula width/height had no scroll overflow.
- Six-way runout equity changed from [13.6, 4.2, 2.0, 13.0, 64.4, 2.8] on the flop
  to [95.2, 0, 0, 0, 4.8, 0] on the turn and [100, 0, 0, 0, 0, 0] on the river
  (seat order: lower-left, upper-left, top, upper-right, lower-right, bottom).
- 128 focused tests passed: geometry, accuracy, all-in privacy/closed betting,
  pot/payout presentation, review, progression, winner, runner, and accessibility.
  Production build/typecheck passed; no lint script is configured. Vite retains
  its chunk-size advisory. No unrelated audit repairs were attempted.
- Integrated upstream commits 5af4884 and 14fdffc without rewriting history.
  Used the shared Windows installer packaging entry point after the final build,
  excluding unrelated packaged audits per the requested scope.
- Packaged HTML and all eight referenced JavaScript/CSS assets match the final
  production build byte-for-byte. The Desktop shortcut was updated to the current
  unpacked executable with `npm run release:update-shortcut`.
