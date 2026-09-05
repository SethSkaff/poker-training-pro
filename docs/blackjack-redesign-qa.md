# Blackjack Lab redesign — visual QA

Verified September 5, 2026 against the running Vite app in Chromium.

## Presentation

- Compact Blackjack Lab masthead and four-mode navigation. Removed the requested explanatory copy and the floating rules badge.
- Quick Count uses a control rail, centered deck/card surface, and session stats. Tables uses a framed felt table, centered hands, integrated shoe meter/rules, and colored actions. Trainer uses a focused hand matchup and a 66px true-count readout.
- Guide uses three adjacent strategy boards at desktop widths, with Hard Totals slightly wider. Soft Totals and Pairs use their remaining column space for compact Hi-Lo and insurance references. Below 1051px the boards reflow; below 701px they stack.
- Action colors: green hit, red stand, blue double, yellow surrender, purple split. The same variables color Guide tiles and play controls.
- The shared strategy engine remains unchanged. Guide still calls `getAvailableActions` and `getOptimalAction` for every hand/dealer/count combination. Index labels sit absolutely inside fixed-height tiles; a brass inset outline marks actions differing from basic strategy.
- Corrected a display bug: settled dealer hands previously displayed only the initial two cards even when the computed total included further draws. The table now renders every revealed dealer card. This does not change dealing, counting, or settlement logic.
- Removed pre-answer Trainer hints that exposed the index being tested. Engine explanations remain available after answering.

## Viewport and geometry checks

At 1280 × 720, moved the actual range input through every integer from −10 to +10 using keyboard events. At the other sizes, checked −10, −1, 0, +1, +5, +10. Compared 730 bounding rectangles covering the Guide, control strip, board columns, strategy panels, tables, rows, headers, cells, tiles, and insurance area at each count. All rectangles were identical across counts within each viewport. Badge/letter collision, badge containment, tile-letter containment, and table overflow checks passed.

| Viewport | Guide document height | Result |
| --- | ---: | --- |
| 1600 × 900 | 900px | All three boards and controls fit; no scrolling |
| 1366 × 768 | 768px | All three boards and controls fit; no scrolling |
| 1280 × 720 | 720px | Guide ends at 690px; no scrolling |
| 1100 × 720 | 720px | All three boards and controls fit; no scrolling |
| 760 × 900 | 1410px | Responsive board arrangement; vertical scrolling only |
| 390 × 844 | 1850px | Stacked boards; vertical scrolling only |

All four modes were visually inspected at 1600 × 900. Quick Count, Tables, and Trainer were also checked at 1280 × 720 and 390 × 844. Tables' initial play surface ends at 686px on the 720px laptop viewport. Longer drills, reviews, and multi-hand outcomes may scroll vertically.

## Interaction checks

- Quick Count: completed a 10-card Flash drill; submitted the correct +2 count; verified 100% accuracy, streak 1, and the full running-count progression. Completed a 50-card sequence and checked card wrapping at laptop width.
- Tables: played three rounds, including Stand and Double; observed a four-card dealer hand and correct total; submitted the round-three checkpoint; inspected Game Review's decisions and count history.
- Trainer: stood on 15 vs 10 at TC +4 with surrender unavailable; verified the correct result, score increment, and engine explanation.
- Guide: keyboard slider sweep above; direct numeric entry; visible insurance change at its +3 threshold. Requested removed copy is absent.
- Regression checks: 32 tests across the blackjack engine, BlackjackTrainer, TableViewSelect, App table-scene stability, and lifecycle progression passed. Production TypeScript/Vite build passed; Vite retains its existing large 3D-chunk advisory.

Local screenshots and measurement JSON are in `work/blackjack-redesign/` (generated evidence, excluded from Git). Poker gameplay and existing uncommitted Poker work were left untouched. The commit includes the pre-existing Blackjack engine and product routing because those files were not yet committed in the starting checkout.
