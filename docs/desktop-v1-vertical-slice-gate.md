# Desktop v1 exit criteria and playable vertical-slice gate

Status: objective release gate  
Last grounded against the repository: 2026-07-23  
Current verdict: **FAIL**

Desktop v1 is not a collection of reachable screens. It is releasable only when
one packaged Windows build proves that every mode can start, finish, save,
recover, and return to the start menu without a placeholder, silent loss, or
dead end.

The state semantics and Back/Cancel behavior in
`docs/desktop-game-state-machine.md` are normative for this gate.

## Pass rule

The gate passes only when all of the following are true:

1. Every `COMMON-*`, `MODE-*`, `SAVE-*`, `RECOVERY-*`, `RETURN-*`, and
   `DEADEND-*` criterion below passes.
2. The per-mode journey matrix has no Fail, Partial, Not Run, or waived cell.
3. Required automated tests pass in CI and required packaged-build manual tests
   have attached evidence from the same release candidate.
4. No reachable player-facing control is disabled or replaced with copy such as
   "pending", "coming soon", "next implementation step", "not wired", or
   equivalent.
5. The installer and portable build both use the same save/recovery contract.

A mode cannot be declared done because its pure engine has unit tests. The
player-visible route must own that engine through completion and recovery.

## Terms with testable meanings

| Term | Objective meaning |
|---|---|
| Start | From a cold start-menu launch, the player selects the mode, completes its setup, sees bounded loading/fly-through behavior, and reaches a legal hero decision at a seated table. |
| Finish | A deterministic test fixture reaches the mode's terminal condition and shows the correct player-facing result with no debug control. |
| Save | The authoritative checksummed file generation contains the completed progress/result or exact active snapshot, and a fresh process reads it without relying on the previous renderer's memory or `localStorage`. |
| Recover | After forced termination at action and hand boundaries, a fresh process offers recovery/resume and restores the same public state, hero private state, legal actions, active-time clock, and camera position without duplicate awards. |
| Return | The player can use a visible action and Back behavior to reach the Play/Settings start menu; reopening Play starts a new valid journey. |
| Placeholder | Any reachable UI that substitutes status copy, a disabled primary action, a no-op control, or a mock result for the required behavior. |
| Dead end | A reachable state from which no visible and keyboard-operable action can progress, go Back, recover, or quit safely. |
| Save receipt | Successful acknowledgement from the authoritative atomic file writer for the exact monotonic save revision being displayed. |

## Required test fixtures

Tests may compress presentation time, but may not bypass production routing,
result application, or persistence.

| Fixture | Required deterministic setup |
|---|---|
| `normal-short` | Unlocked first Normal event, fixed seed, hero reaches a legal decision, then a scripted short finish with known placement and Elo delta. |
| `rational-short` | Same as Normal using Rational policy, including an assertion that policy inputs contain no opponent cards or future deck. |
| `training-one` | Fixed Training scenario with known legal action, math answer, expected feedback, and expected Decision/Math Elo changes. |
| `timed-short` | Minimum supported 5-minute configuration with controllable active clock, early-finish branch, and deadline-pressure branch. |
| `corrupt-current` | Invalid/checksum-mismatched current generation plus valid previous generation. |
| `all-corrupt` | Invalid current and previous generations plus exportable diagnostic metadata. |
| `mid-action` | Snapshot immediately after a committed hero action and before hand settlement. |
| `mid-hand` | Snapshot after a committed hand boundary with the next decision not yet acted. |

Seeds and expected outputs must be checked into tests. Debug-only time
acceleration is allowed; debug-only navigation directly to results is not.

## Common journey criteria

| ID | Pass condition |
|---|---|
| `COMMON-01` | A clean profile enters first-run setup before animated/timed gameplay; Configure, Skip, Back, and close/relaunch preserve the documented choice. |
| `COMMON-02` | Main menu exposes keyboard- and mouse-operable Play, Settings, and Quit. Settings Back returns to the menu and Quit Cancel restores focus to Quit. |
| `COMMON-03` | Play exposes exactly Normal, Rational, Training, and Timed Table as launchable choices; Back and Cancel return to the start menu. |
| `COMMON-04` | Every mode has a complete logical setup: event selection for Normal/Rational, scenario/default resolution for Training, and integer 5-180 minute duration for Timed Table. Invalid or locked choices cannot launch and explain why. |
| `COMMON-05` | Every new launch has a progress-bearing loading state. If loading exceeds its budget, Cancel/Back returns to the originating setup without creating a scored run. |
| `COMMON-06` | The room fly-through completes or can be skipped; Reduced Motion uses a static/short transition. Back/Cancel follows the canonical confirmation and never strands the player. |
| `COMMON-07` | The first seated frame has readable stacks, blinds, pot, cards, legal actions, camera state, and a working Pause action. No primary or required control is a no-op. |
| `COMMON-08` | Back at the table closes the topmost composer/dialog first, then opens Pause. It never immediately abandons scored play. |
| `COMMON-09` | Pause stops AI, Training, Timed Table, animation, and audio clocks and offers Resume, Controls, Settings, Hand Reference, valid Restart/Leave wording, Quit to Menu, and Quit Desktop. |
| `COMMON-10` | Blur, minimize, lock, and suspend produce lifecycle pause. Focus returns to an explicit Ready recap; inactive time is excluded and the exact decision/camera state remains intact. |
| `COMMON-11` | A recoverable asset/session load failure offers Retry and Back. A failed save offers Retry Save and diagnostics without falsely completing navigation. |
| `COMMON-12` | All route transitions defined in the canonical state table are exercised at least once by automated navigation tests, including every Back/Cancel edge. |

## Per-mode acceptance criteria

### Normal

| ID | Pass condition |
|---|---|
| `MODE-N-START` | From Main Menu -> Play -> Normal, selecting an unlocked event and Enter Event reaches a legal hero decision using a live `TournamentSession` in `mode: "normal"`. |
| `MODE-N-PLAY` | At least one complete hand uses production legal-action, pot, elimination, blind, and Normal-policy paths; ordinary hand transitions do not show the event ceremony. |
| `MODE-N-FINISH` | Hero bust/win ends the event and shows exact placement, qualification, Tournament Elo delta, newly unlocked events, and valid next actions derived from `TournamentSessionResult`. |
| `MODE-N-RETRY` | Retry starts a new scored run ID while the prior result remains committed; Next/Choose Event respects unlock prerequisites. |
| `MODE-N-SCOPE` | Normal results update Normal career state and Tournament Elo once, and do not alter Rational career state or Training ratings. |

### Rational

| ID | Pass condition |
|---|---|
| `MODE-R-START` | From Main Menu -> Play -> Rational, selecting an unlocked event and Enter Event reaches a legal hero decision using a live `TournamentSession` in `mode: "rational"`. |
| `MODE-R-PLAY` | At least one complete hand uses the Rational information-set policy; an instrumentation assertion proves opponent cards, hidden deck, and future cards are absent from every policy input. |
| `MODE-R-FINISH` | Hero bust/win shows the same complete event result contract as Normal with Rational career state and the exact deterministic Elo result. |
| `MODE-R-RETRY` | Retry creates a new scored run; Next/Choose Event respects Rational unlock prerequisites independently of Normal. |
| `MODE-R-SCOPE` | Rational results update Rational career state and Tournament Elo once, and do not alter Normal career state or Training ratings. |

### Training

| ID | Pass condition |
|---|---|
| `MODE-T-START` | From Main Menu -> Play -> Training, a resolved scenario reaches its legal hero decision after the common transition. |
| `MODE-T-FINISH` | Submitting the fixture action and optional math answer shows persistent feedback and applies Decision Elo, Math Elo, streak, timing, and result history exactly once. |
| `MODE-T-NEXT` | Next Scored Scenario creates a new attempt ID and selects the expected deterministic near-transfer scenario. |
| `MODE-T-REVIEW` | Review/Retry is labeled unscored and changes no Elo, streak, completion count, or history, even after repeated reviews. |
| `MODE-T-EXIT` | Returning to menu after feedback waits for the result save receipt; leaving before action follows the documented save/abandon wording and cannot invent an attempt. |

### Timed Table

| ID | Pass condition |
|---|---|
| `MODE-D-START` | From Main Menu -> Play -> Timed Table, each boundary value 5 and 180 starts; 4, 181, fractional, blank, and nonnumeric inputs do not. A valid choice reaches a legal hero decision against Normal opponents. |
| `MODE-D-CLOCK` | Only active seated time advances the duration. Loading, fly-through, pause, blur, minimize, suspend, and Ready recap add zero active milliseconds. |
| `MODE-D-DIRECTOR` | Blinds never decrease; opening is stable; pressure uses the production director; at/after deadline the big blind covers the second-largest live stack until a winner is determined. |
| `MODE-D-FINISH` | Both early completion and deadline-driven completion show final placement and deterministic Tournament Elo delta. |
| `MODE-D-SCOPE` | The result updates Tournament Elo exactly once but does not create career qualification, unlocks, or Normal/Rational event results. |
| `MODE-D-RETRY` | Retry Same Duration creates a new run ID; Change Duration returns to valid setup; both retain the prior committed result. |

## Save and recovery criteria

| ID | Pass condition |
|---|---|
| `SAVE-01` | The authoritative save lives below Electron `userData`, is versioned, checksummed, atomically replaced, and keeps at least one prior valid generation. |
| `SAVE-02` | Production startup and every production write use the save-envelope migration/validation path. Browser storage is read only for a one-time legacy import after which the file is authoritative. |
| `SAVE-03` | Action-boundary and hand-boundary writes call the file journal and include a monotonic revision, mode/session ID, engine/content/policy versions, seed, public action log, blind data, and exact resume snapshot. |
| `SAVE-04` | Disk-full, permission-denied, corrupt current, corrupt previous, partial write, and unsupported future-version fixtures never silently replace the only valid generation or load defaults over player progress. |
| `SAVE-05` | A result UI enables Retry/Next/Menu only after its exact result revision receives a durable save receipt. Restarting after that receipt shows the result/progress once. |
| `SAVE-06` | Settings, separate mode career results, Tournament Elo, Training results, unlocks, timing, first-run status, and active session all round-trip through a process restart. |
| `SAVE-07` | Ordinary exported history and diagnostics contain no opponent hole cards, future deck, hidden cards, or production-only secret seed. |
| `RECOVERY-01` | With corrupt current and valid previous, startup names the failed generation and offers Restore Previous/LKG; restore preserves the expected fixture state. |
| `RECOVERY-02` | With no valid generation, startup offers Export Diagnostics, Start Fresh with a second confirmation, Retry, and Cancel/Quit. It never silently discards data. |
| `RECOVERY-03` | Killing the process after each committed hero action in every mode restores the same actor, street, pot, stacks, board, hero cards, legal actions, clock, and camera. |
| `RECOVERY-04` | Killing the process immediately before and after hand/result commits never duplicates or loses chips, result history, Elo, qualification, unlocks, or Training completion. |
| `RECOVERY-05` | Resume never advances AI or active clocks until the player selects Ready. The recap identifies the mode, event/scenario/duration, street, pot, and action faced. |
| `RECOVERY-06` | Start Over from Resume Offer requires confirmation. Back/Cancel quits with the recovered snapshot intact. |

## Return and no-dead-end criteria

| ID | Pass condition |
|---|---|
| `RETURN-01` | Normal event result -> Return to Menu -> start menu, then Play reopens functional mode selection. |
| `RETURN-02` | Rational event result -> Return to Menu -> start menu, then Play reopens functional mode selection. |
| `RETURN-03` | Training result -> Return to Menu/Back -> start menu, then Play reopens functional mode selection. |
| `RETURN-04` | Timed result -> Return to Menu/Back -> start menu, then Play reopens functional mode selection. |
| `RETURN-05` | From each setup, loading, load-failure, fly-through confirmation, seated overlay, pause child, pause root, result, recovery confirmation, and quit confirmation, Back and Cancel produce the canonical destination. |
| `DEADEND-01` | A crawler using keyboard-only actions visits every reachable route/dialog and finds at least one enabled forward, Back, recovery, or safe-quit action. |
| `DEADEND-02` | No required action has an empty handler, optional callback omitted by the route owner, permanently disabled primary control, or status-only replacement. |
| `DEADEND-03` | Source and built output contain no reachable player-facing placeholder phrases. Allow-list test fixtures and developer documentation only. |
| `DEADEND-04` | After 50 sequential journeys with mixed modes, retries, settings visits, cancels, and returns, the app remains interactive with one current route, no duplicate modal, and no accumulating active timer/audio loop. |

## Objective per-mode journey matrix

Each cell requires both an automated test artifact and a packaged-build smoke
record. "Engine exists" is not evidence for a player-visible cell.

| Mode | Start | Finish | Save | Recover | Return | Current verdict |
|---|---:|---:|---:|---:|---:|---|
| Normal | Fail | Fail | Fail | Fail | Fail | **FAIL** |
| Rational | Fail | Fail | Fail | Fail | Fail | **FAIL** |
| Training | Partial | Pass per scored scenario | Fail | Fail | Partial | **FAIL** |
| Timed Table | Fail | Fail | Fail | Fail | Fail | **FAIL** |

Current evidence behind the verdict:

- **Normal/Rational Start fail:** `TourLobby` receives no `onStartEvent`, so its
  primary control is disabled and explicitly says the table connection is
  pending.
- **Normal/Rational Finish/Return fail:** no player-visible session can start.
  `TournamentCeremony` and the tournament engine being present do not satisfy
  the route.
- **Normal/Rational Save/Recover fail:** `tourResults` has no setter, no
  tournament snapshot is in the renderer save path, and the file journal is not
  called.
- **Training Start partial:** it reaches a playable table, but bypasses required
  setup resolution, loading, fly-through, pause, and resumable run creation.
- **Training Finish pass per scenario:** a legal action produces feedback and
  progress. This does not pass the overall gate.
- **Training Save fail:** the write is renderer `localStorage`, not the
  authoritative checksummed file; storage failure is swallowed.
- **Training Recover fail:** no live attempt snapshot is loaded. A malformed
  progress value silently falls back to defaults.
- **Training Return partial:** Leave Table returns to `home`, but Escape abandons
  immediately, no result save receipt is required, and Review can score the
  same already-completed scenario again.
- **Timed Start fail:** valid duration routes to `TimedTablePending`, whose copy
  states that live runner wiring is the next step.
- **Timed Finish/Save/Recover/Return fail:** no live Timed session exists.
- **Common blockers:** no first run, loading/fly-through, real pause, lifecycle
  pause, recovery UI, resume offer, safe result transaction, or menu Quit.

## Required automated evidence

The release candidate must produce these test classes:

1. **Reducer/state-machine tests**
   - one assertion for every canonical transition;
   - invalid transitions are rejected;
   - modal Back is consumed before parent Back;
   - result application and save revisions are idempotent.
2. **Renderer integration tests**
   - drive the real `App` routes with the real mode/session adapters;
   - prove enabled primary actions and focus restoration;
   - mock Electron only at the preload contract boundary.
3. **Engine/session integration tests**
   - use deterministic fixtures from setup through result;
   - include Normal, Rational, Training scored/review, and Timed early/deadline
     branches.
4. **File-store fault tests**
   - corrupt JSON, checksum mismatch, partial temp file, invalid envelope,
     unsupported future version, disk full, and permission denial;
   - prove current/previous rotation and preservation of the only valid save.
5. **Process-restart end-to-end tests**
   - launch the packaged app, reach a recorded boundary, force-kill renderer or
     process, relaunch, recover, and compare the complete expected snapshot.
6. **Dead-end/static audit**
   - fail on omitted required route callbacks, no-op required buttons, and
     placeholder phrases in production UI.

At minimum, the normal test command and TypeScript build must be green. The gate
also requires the new integration/end-to-end suites; the current unit suite
alone is insufficient.

## Required packaged-build manual evidence

Run the same signed or release-candidate binaries intended for handoff:

| Evidence ID | Procedure | Required artifact |
|---|---|---|
| `PKG-01` | Clean install -> first run -> skip/configure -> menu | Video plus save-generation metadata |
| `PKG-02` | Complete one deterministic journey in each of four modes | Four videos/screenshots of result and menu return |
| `PKG-03` | Kill during one action and one hand in every mode, relaunch, resume | Before/after snapshot diff and video |
| `PKG-04` | Corrupt current save, then corrupt both generations | Recovery screenshots and diagnostic export |
| `PKG-05` | Exercise every Back/Cancel path keyboard-only | Navigation log with expected/actual state |
| `PKG-06` | Pause via button, Escape, Alt+Tab, minimize, lock, and suspend | Clock/state comparison proving zero inactive time |
| `PKG-07` | Installer and portable each complete save, quit, relaunch, recover | Save location/version/checksum record |
| `PKG-08` | 50 mixed return/retry/cancel loops | No-dead-end crawler log and resource/timer summary |

Record build version, commit, Windows version, binary type, save schema version,
engine/content/policy versions, and test seed with every artifact.

## Sign-off checklist

No TODO should be marked complete until a reviewer can answer Yes to every item:

- [ ] All common journey criteria pass.
- [ ] Normal passes Start, Finish, Save, Recover, Retry, and Return.
- [ ] Rational passes Start, Finish, Save, Recover, Retry, information-set
      safety, and Return.
- [ ] Training passes Start, scored Finish, unscored Review, Save, Recover, and
      Return without double-awarding.
- [ ] Timed Table passes duration boundaries, active-time behavior, early and
      deadline finishes, Save, Recover, Retry, and Return.
- [ ] Every result is durable before its navigation actions enable.
- [ ] Every Back/Cancel edge matches the canonical state machine.
- [ ] Corrupt/unreadable saves never silently become defaults.
- [ ] No reachable placeholder, omitted callback, no-op required control, or
      dead end remains.
- [ ] Automated and packaged-build evidence is attached to the same release
      candidate.

## Present TODO satisfaction

The documentation TODOs are satisfied by these two documents:

- The canonical machine covers cold start, first run, menu, setup for all four
  modes, loading/fly-through, seated play, pause, results, retry, quit,
  recovery, and explicit Back/Cancel behavior.
- This gate defines objective pass/fail conditions for every mode to start,
  finish, save, recover, and return without placeholders or dead ends.

The playable desktop vertical slice itself is **not** satisfied. Its current
objective verdict remains **FAIL** until the implementation and evidence meet
all criteria above.
