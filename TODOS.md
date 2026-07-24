# Poker Training Pro — Running TODOs

This is the canonical backlog. Keep it current as work is completed or new
requirements are added.

## Now — desktop first

- [x] Build deterministic deck, hand evaluator, legal betting, side pots, blind
      structures, table balancing, and information-set redaction.
- [x] Build the researched Training Mode scenario bank and EV-regret grading.
- [x] Persist separate Decision Elo, Math Elo, response timing, and progress.
- [x] Accept table-style quiz answers such as `33%`, `0.33`, `1/3`, `2:1`,
      and `3:5` where the question unit makes the interpretation clear.
- [x] Implement Rational AI without hidden-card access.
- [x] Implement bounded, personality-driven Normal AI without random blunders.
- [x] Finish the shared compressed tournament/career session controller.
- [x] Integrate Normal and Rational policies into playable tournament sessions.
- [x] Replace “Career” navigation with a Grand Prix-like mode flow:
      event select → tournament → placement/qualification/Elo/unlock results.
- [x] Replace the dashboard/tab shell with a game-first title and menu scene.
- [x] Match the *interaction hierarchy* of a premium console-game start flow:
      the initial Play/Settings menu should feel like Mario Kart World’s compact
      start menu without copying its art, type, icons, colors, wording, or exact
      geometry.
- [x] Use the user-supplied poker artwork as the desktop start-menu background
      with the same oversized Play/Settings chip-button hierarchy. Yellow text
      must indicate the button currently under the cursor or keyboard/controller
      focus.
- [x] Add a subtle seamless two-second ambient background loop, preserving the
      supplied still as the loading/failure/reduced-motion fallback. The supplied
      artwork now uses its prepared original two-second micro-drift loop; no
      generated video or copied scene is needed, and the same local still remains
      the failure and reduced-motion fallback.
- [x] Make the four-mode choice—Normal, Rational, Training, Timed Table—a
      distinct
      game-mode selection scene with the clarity and immediacy of choosing among
      Grand Prix/Knockout Tour/Time Trial, while using original poker-native
      presentation and names.
- [x] Add a fourth **Timed Table** mode. Ask for 5–180 minutes before play,
      run one table with Normal opponents and no career progression, and award
      tournament Elo from the final placement.
- [x] Build a deterministic timed blind director that keeps blinds monotonic,
      preserves a normal opening phase, then adjusts pressure from elapsed time,
      remaining players, and live stack distribution. At and after the deadline,
      the big blind must cover the second-largest live stack so every player
      except the chip leader is forced all-in; finishing early is valid.
- [x] Add a short loading transition followed by an authored camera fly-through
      of the **Poker Training Pro Championship** room that travels past the
      venue, tables, dealer area, players, and stacks before settling into the
      hero’s seated first-person view.
- [x] Between tournament rounds/table moves, keep the transition inside the
      room: move the camera toward the next seat while a slim, slightly faded
      horizontal progress bar overlays the top of the view. Show completed
      rounds/checkpoints, current progress, and the next stop; fade it before
      control returns. Do not make this bar a separate screen.
- [x] Reserve the full placement/qualification/Elo/unlock results ceremony for
      the end of an event, not for ordinary between-round transitions.
- [x] Build stylized cartoony table characters with physical action animations:
      receive/peek/hold/muck cards, gather/count/push chips, check the felt, react,
      go all-in, win a pot, and leave after elimination. The shipped desktop scene
      now uses original avatar-sheet characters and public-action-driven hands:
      card deal/hold/muck, check tap, call/bet chip push, all-in, pot gather, and
      elimination retreat all have motion-off and reduced-motion alternatives.
- [x] Study VR/card-table presentation for presence, seated scale, readable
      stacks, physical card/chip motion, limited-look camera behavior, comfort,
      and augmented statistics; record the original desktop translation and
      protected-expression boundary.
- [x] Complete the remaining original non-VR physical character/hand/chip
      assets and animations identified by that research. Character gestures read
      only public betting/session state; they never infer opponents' holdings.
- [x] Let the player pan/look left and right from their seat like a traditional
      game, with a center-view command and a fixed/reduced-motion alternative.
- [x] Add expert hotkeys for Fold, Check/Call, Raise 2×, Raise 2.5×, Raise 3×,
      Pot, All-in, Custom Raise, Peek/Hide Cards, camera left/right, center view,
      speed up/down, hand history, and pause. Disable shortcuts while typing.
- [x] Add an always-reachable top-table speed slider/presets controlling AI
      presentation speed without changing the mathematical policy.
- [x] Keep full-hand opponent presentation as the default after the player acts,
      while offering an explicit, keyboard-accessible **Skip to result** control
      that completes only the queued presentation delay. It never cancels or
      duplicates the already-chosen legal action.
- [x] Model AI decision delays from decision closeness/uncertainty, street,
      action complexity, and opponent tempo, plus substantial seeded jitter and
      anti-tell noise. Cap correlations so timing cannot reliably reveal hand
      strength or action.
- [x] Apply the same timing model and user speed preference to mobile, with
      shorter animation budgets and background/inactive pausing. The SwiftUI
      table calls the shared local bridge with the mobile surface cap and saved
      rate, while `TableTimingModel` freezes the exact remaining delay outside
      the active scene; parity and mobile-budget tests cover the contract. It
      also offers an explicit Skip opponent animation control that resolves only
      the queued presentation delay, matching desktop fast-forward behavior.
- [x] Apply the reference research at the level of task flow and affordance,
      document the originality boundary, and prohibit copied Nintendo, Balatro,
      Discord, Vegas Infinite, or other protected expression/assets.
- [x] Use an original palette that bridges premium casino materials and a
      colorful console game: deep emerald felt, ivory card stock, black lacquer,
      and brass as the base; vivid cyan, coral, warm yellow, sky blue, and
      clay-chip red for mode identity, selection, progress, and motion. Avoid
      Nintendo’s exact combinations, racing motifs, and rainbow-for-everything
      clutter.
- [x] Rename all user-facing and packaged references to **Poker Training Pro**.
- [x] Integrate the original Poker Training Pro brand mark and app icon.
- [x] Remove unnecessary badges, filler copy, decorative cards, and generic
      dashboard patterns identified by the anti-“AI slop” audit. The review
      keeps the supplied-art start menu as the only title surface, removes the
      generic “Live Field” badge in favor of the real Normal Tournament name,
      and retains only rule, accessibility, and gameplay information.
- [x] Re-run visual QA at 1280×720, 1366×768, 1920×1080, ultrawide, and the
      minimum supported desktop window. The live review confirmed the supplied
      Play-selected reference state, unobstructed Fold/Call/Raise controls,
      and a wide-screen table scale that keeps the room composition intentional.
- [ ] Verify mouse, keyboard, card peek, drag-to-fold, bet sizing, settings,
      local save recovery, reduced motion, and high-contrast behavior. The fresh
      packaged CDP input smoke now covers mouse navigation, peek, drag-fold,
      raise-slider sizing, settings, keyboard pause/resume, corrupt-current-save
      recovery, and first-run reduced-motion/high-contrast preferences; physical
      assistive-input acceptance is still pending.
- [x] Eliminate all gameplay layout collisions at every supported size: no card
      may cover another card's rank or suit, opponent bet chips/amounts must
      remain visually separate from total stack balances, and labels, controls,
      cards, chips, and status overlays must never obscure one another. A live
      six-seat Normal Tour geometry audit reports zero intersections at
      1100×720, 1280×720, 1366×768, 1920×1080, and 2560×1080.
- [x] Recheck the live table at 1024x768, 1366x768, and 1920x1080 after
      removing the decorative opponent-card fan; active card bounds and
      stack/bet lanes remain non-intersecting with no horizontal overflow.
- [x] Add a packaged six-seat geometry gate to the Windows input smoke. It
      rejects intersecting opponent-card bounds and bet/stack information lanes
      before continuing through raise, pause, and controller coverage.
- [x] Package distinct Windows x64 NSIS installer and portable preview
      artifacts; verify the unpacked application launches, stays offline at
      idle, has the intended Electron fuses, and rejects tampered ASAR content.
- [x] Add a fail-closed packaged-render smoke gate that launches an isolated
      Windows profile, reloads the bundled custom-protocol document under CDP,
      requires a non-empty recognized app screen, rejects renderer/network/
      console errors, and cleans up the exact process tree and temp profile.
- [x] Open the packaged Windows preview for the user and visually verify the
      first-run setup, supplied-art start menu, four-mode selector, career
      event screen, and animated championship-room arrival.
- [x] Complete a hands-on packaged settings/Training smoke: mute and reduced
      motion toggles, `1/3` quiz submission and grading, a legal decision,
      feedback/Elo, pause menu, and return to the supplied-art start menu.
- [ ] Complete every remaining packaged input path (mouse, keyboard,
      controller, peek, drag-fold, raise sizing, history, resume/recovery,
      Normal/Rational/Timed completion) before calling the whole desktop build
      previewed. A fresh Windows CDP smoke (rebuilt 2026-07-24 against current
      source, hash `db18139b2b8c...`) proves mouse/keyboard navigation, peek,
      drag-fold, legal raise sizing, public hand history, pause settings,
      fast-forward, keyboard resume, Gamepad API polling/mapping, and an
      isolated corrupt-current-save recovery flow, and full Normal/Rational/
      Timed Table tournament completion through their placement ceremonies;
      controller hardware still needs its own packaged acceptance coverage.
      **New finding, not yet resolved**: the packaged input smoke is
      intermittently flaky on the verification host — across 4 consecutive
      runs against the fresh build, 2 passed cleanly (47/47) and 2 failed at
      different unrelated steps (a raise-legality timing case, a pause-menu
      poll timeout), pointing to real unseeded gameplay/timing variance rather
      than a selector regression. Do not treat a single green run as reliable
      evidence until this is investigated (deterministic seeding or
      longer/retrying waits around the affected steps).

## Audio — after the desktop gameplay loop

- [x] Mute the temporary synthesized background loop.
- [x] Research a substantial candidate playlist of thematically appropriate,
      instrumental, royalty-free tracks from reputable libraries.
- [ ] Verify every license permits redistribution inside a commercial desktop
      and mobile game; reject “free to stream only” or unclear licenses.
- [ ] Save source URL, author, track title, license text/version, attribution
      requirement, and downloaded master for every accepted track.
- [x] Prefer several calm focus/table tracks plus restrained tournament-intensity
      tracks; avoid vocals, casino jingles, slot-machine music, and distracting
      drops.
- [x] Implement shuffled playlist playback, no immediate repeats, crossfades,
      pause/focus behavior, music ducking under feedback, and separate Music/SFX
      volume controls. All six behaviors are implemented, unit-tested against
      injected fake clock/sink, and genuinely wired end-to-end in `App.tsx`;
      this pass closed two real wiring gaps (engine pause/resume never received
      focus/blur/minimize/suspend transitions — now via a new
      `GameAudio.observeFocusMuted()`; and Music-volume/Mute never reached the
      engine — now via `musicVolumeFromSettings()`). Ducking was verified to
      fire through real `gameAudio.play()` cues, not an isolated utility. The
      engine stays **dormant**: `src/lib/musicPlaylistWiring.test.ts`
      reproduces the exact app composition against the empty production
      manifest and proves zero audio-graph construction, no playback attempt,
      and no throw across focus churn/volume changes/500s of simulated time.
      **Pending licensed masters** for actual audible playback — see the
      license/master/loudness/attribution items in this section, all still
      blocked on rights that do not yet exist.
- [x] Add a Credits/Licenses screen and ship required attribution files. The
      offline screen exposes font and package/runtime notices; the fresh
      Windows package audit verifies the sidecars. Music remains absent until
      licensed masters and their individual attributions are ready.
- [ ] Loudness-normalize tracks and test looping, memory usage, and package size.

## iOS / iPadOS — begin after desktop is previewable

- [x] Finish current official App Store approval and device-support research.
- [x] Select an implementation path that reuses the local TypeScript poker
      engine and requires no dedicated game server.
- [x] Create the simplified mobile information architecture:
      logo/name → large Play and Settings actions → mode/event select → table.
- [x] Build a flat green table with names, balances, compact blue live cards,
      no dealer, no free camera, and tap-to-flip hero cards.
- [ ] Preserve every backend feature: Training, Rational, Normal, math checks,
      Elo, tournaments, career results, local settings, and local progress.
      The full validated 12-scenario Training bank now exports into the iOS
      bundle and has a release freshness gate; a typed hero-safe JavaScriptCore
      tournament bridge now drives the compact Normal, Rational, and Timed
      tables with live legal actions, public results, local tournament Elo, and
      career qualification persistence. Xcode/Simulator/device validation is
      still required before this cross-runtime feature set can be verified.
- [ ] Study card readability/motion from Balatro and compact table clarity from
      Discord Activities, then design original assets and animation timings.
- [x] Keep all bot equity/range work on-device; benchmark and cap expensive
      simulations to avoid frame drops, thermal spikes, and battery drain. The
      shared JavaScriptCore engine has a 600-simulation hard ceiling with
      deterministic 32-simulation slices; the Windows contract benchmark and
      parity suite pass. Target-device Instruments validation remains part of
      the separate supported-device test task.
- [x] Support iPhone and iPad safe areas, Dynamic Type, landscape/portrait policy,
      split view/window resizing where required, and accessibility settings. The
      universal SwiftUI source keeps only decorative backgrounds under system
      areas, uses scalable text/cards and standard accessibility controls, and
      now falls back for narrow player/action rows and board-card overflow; the
      separate supported-device validation task remains required on macOS/Xcode.
- [ ] Validate every supported iPhone/iPad layout required by the chosen
      deployment target—without inventing obsolete devices.
- [ ] Add privacy manifest/labels, age rating, simulated-gambling disclosures,
      review notes, screenshots, TestFlight plan, and submission checklist.
- [x] Determine the legitimate preview path from Windows. Do not install a fake
      iOS simulator; official Apple Simulator requires macOS/Xcode.
- [ ] Open the final mobile preview for the user before any handoff/submission.

## Desktop production necessities — audit added 2026-07-23

### Complete player journey and teaching

- [x] Write one canonical game-state diagram covering cold start, first run,
      menu, mode setup, loading, seated play, pause, results, retry, quit, and
      recovery; make every Back/Cancel path explicit.
- [x] Define the desktop v1 exit criteria and a playable vertical-slice gate:
      every mode can start, finish, save, recover, and return to the start menu
      without a dead end or placeholder.
- [x] Add a first-run flow that offers accessibility and control setup before
      animation or timed interactions begin, then lets the player skip it.
- [x] Build a short playable tutorial that teaches card peeking, legal actions,
      bet sizing, hand flow, showdown, and the difference between chips, pot
      odds, equity, and expected value.
- [x] Add optional contextual prompts for the first occurrence of an all-in,
      side pot, minimum raise, blind increase, elimination, qualification, and
      Elo change; keep them manually dismissible and replayable.
- [x] Add an always-available poker reference with hand rankings, betting terms,
      common probability shortcuts, tournament terms, and worked examples.
- [x] Explain what Normal, Rational, Training, and Timed Table actually optimize
      before selection, including that Rational opponents use only information
      legally available to their seat.
- [x] Add a safe “restart hand/scenario” path only where it cannot alter career
      results, and clearly distinguish practice retries from scored play.
- [x] Make every event-end result screen explain placement, qualification,
      unlocks, Elo change, and the next available action without requiring prior
      poker knowledge.

### Input, focus, pause, and window lifecycle

- [x] Create a single action map shared by mouse, keyboard, and controller so
      menus and every gameplay action have equivalent non-pointer operation.
      The versioned action registry and routing tests cover default bindings,
      conflicts, keyboard/controller resolution, and persistence.
- [x] Add controller navigation and prompts for the complete desktop flow,
      including settings, dialogs, sliders, card peek, betting, pause, and Back.
      The visibility-aware provider supports already-connected controllers as
      well as connection events, and routes modal navigation separately.
- [x] Add in-game remapping for all gameplay and menu controls, conflict
      detection, reserved-key warnings, per-device defaults, and Reset to
      Defaults.
- [x] Ensure drag-to-fold and chip dragging always have one-press alternatives;
      no required action may depend on dragging, holding, double-clicking, or
      rapid repeated input.
- [x] Add an initial-focus and wraparound focus trap to the pause dialog, plus a
      visible global keyboard-focus indicator over animated backgrounds.
- [x] Restore the exact pre-pause focus reliably while pause subpages move
      their initial focus without replacing the original restoration target.
- [x] Apply and test the same initial-focus/trap/restoration contract for every
      other modal dialog. The shared modal hook now covers raise, history,
      pause, and remap-capture dialogs with ARIA modal semantics and restoration
      tests.
- [x] Disable global poker hotkeys while a text field, slider, remapping dialog,
      or system dialog owns input.
- [x] Add a real pause menu with Resume, Controls, Settings, Hand Reference,
      Restart/Leave where valid, and Quit to Menu; never hide destructive
      consequences behind ambiguous wording.
- [x] On table blur/document hiding, enter the explicit pause menu, stop the
      Training decision/math stopwatch, mute table audio, pause the arrival
      timeout, and block tournament action delivery until Resume.
- [x] Wire minimize/screen-lock/Windows suspend through Electron lifecycle,
      freeze the exact remaining AI-presentation and animation delays rather
      than merely blocking/restarting them, and apply the same policy outside
      the table.
- [x] Shift Timed Table's authoritative start clock by the inactive duration on
      explicit Resume and checkpoint the adjusted deterministic replay.
- [x] On resume, restore the exact decision state and camera position, show a
      brief readable recap, and do not count inactive time against Training or
      Timed Table play.
- [x] Save at safe boundaries before close, Windows session end, suspend, and
      update installation; the Electron close handshake flushes first and asks
      before abandoning a pending scored commit.
- [x] Handle renderer “unresponsive” and “render-process-gone” events with
      recovery choices instead of a blank or permanently frozen window.
- [ ] Test windowed, maximized, fullscreen, Alt+Tab, Win+D, display disconnect,
      DPI change, and moving between monitors without losing focus or layout.

### Accessibility baseline

- [ ] Make all controls expose correct accessible names, roles, values, state,
      and order to Windows Narrator/NVDA; announce cards, actions, pot changes,
      errors, timers, and results without reading decorative scenery. The table
      now has static SR semantics (named seat/card groups, decorative children
      hidden) plus live `aria-live` regions for the running status line, action
      errors, blind-level increases, hand results/side pots, and an assertive
      all-in escalation — sourced from the locale catalog, unit-tested for
      no-spam/no-hidden-info via a pure `deriveTableAnnouncements` diff
      (`src/lib/tableAnnouncer.ts`). Real Windows Narrator/NVDA speech
      acceptance on hardware is still unverified and remains before this can
      be checked.
- [x] Add UI/text scale controls. The persisted Compact, Standard, Large, and
      Extra large choices scale the whole desktop interface (including table
      labels and action targets), not prose alone; older saves use Standard.
- [ ] Verify critical table information remains readable without clipping at the
      minimum window size and 200% Windows display scaling on the packaged app.
- [ ] Meet at least WCAG 2.2 AA contrast for text and meaningful non-text
      controls; use a 24-by-24 CSS-pixel minimum target or equivalent spacing,
      with larger targets for primary poker actions.
  - [x] Add a source-level desktop regression audit for defined opaque palette
        pairings and the minimum sizes of the principal menu, utility, settings,
        tutorial, and table-action targets. This guards the locally-verifiable
        CSS contract only; blended artwork, operating-system scaling, and
        assistive-technology rendering remain acceptance-test work.
- [x] Never encode selection, card state, action type, stack danger, math
      correctness, or tournament progress by color alone; pair color with
      shape, label, icon, pattern, or motion-independent state. Selection uses
      pressed/current semantics and text, cards and player states have spoken
      labels, decisions are text buttons, and feedback pairs words with icons.
- [x] Expand Reduced Motion into independent controls for animated menu
      backgrounds, room fly-through, camera sway/shake, card/chip flourish, and
      transition intensity, with static fallbacks available before Play. The
      one-click global control and Safe Mode still override every category.
- [x] Add camera sensitivity, recenter behavior, field-of-view/zoom choice, and
      an option to disable automatic camera movement. Settings persist as low /
      standard / high look sensitivity, close / standard / wide table view, and
      an automatic-arrival/recenter toggle; older saves receive safe defaults.
- [x] Inventory motion/flash sources, document conservative safe limits, and
      hard-gate mechanically detectable strobe/rapid-toggle signatures plus
      missing operating-system or in-app reduced-motion coverage.
- [ ] Analyze rendered luminance, saturated-red flashes, visual angle, and loop
      boundaries with a recognized tool; verify reduced motion on the packaged
      release candidate and remove any sequence that fails. Re-run 2026-07-24
      against the fresh package: 8/8 sequences pass (0 general/red flashes)
      across full-motion and reduced-motion. Sampling density was measurably
      improved (CDP `optimizeForSpeed` capture) from a worst case of ~1392ms
      to 284.4ms per frame (~1.76fps) on the slowest sequence — still sparse
      evidence for sub-second fast-motion content and still not a certified/
      recognized analysis tool, so this stays unchecked.
- [x] Keep tutorials, math explanations, errors, and non-gameplay notifications
      on screen until dismissed, or provide adjustable display duration. The
      audit locks out auto-dismiss timers in those surfaces; the lone lazy-load
      budget timer adds an explicit Cancel path instead of hiding feedback.
- [x] Provide visual equivalents for meaningful audio cues and optional audio
      equivalents for critical visual-only state changes. Deal, chip, fold,
      success, and click sounds already pair with visible card/chip/action or
      result changes; both error-sound paths now expose persistent visible,
      screen-reader alerts rather than relying on sound alone.
- [ ] Run an accessibility acceptance pass with keyboard only, mouse only,
      controller only, Windows Narrator, NVDA, 200% scaling, high contrast,
      reduced motion, color assist, and muted audio.

### Durable saves, recovery, and deterministic diagnosis

- [x] Move authoritative progress out of renderer `localStorage` into a
      versioned file below Electron’s per-user `userData` directory; keep
      browser storage only as a one-time import source.
- [x] Wire the existing save-envelope migration and last-known-good utilities
      into startup and every write path instead of leaving them test-only.
- [x] Write saves atomically through a temporary file plus replace/rotation,
      checksum them, keep at least one previous valid generation, and never
      overwrite the only valid save with corrupt data.
- [x] Add a recovery screen that explains which save failed, offers restore from
      last-known-good, export diagnostics, start fresh, or cancel, and never
      silently discards progress.
- [x] Implement narrow desktop Export Save plus two-phase Import Save and Reset
      Progress backends with validation, redacted preview, one-use confirmation,
      TOCTOU protection, atomic commit, and retained valid generations.
- [x] Add player-visible Export Save, Import Save, and Reset Progress actions,
      wire the preview/confirmation UI, reload committed state, and keep
      settings reset visibly separate from progress deletion.
- [x] Persist and deterministically restore the exact active tournament runner,
      current hero decision, timed-table start clock, and career event results
      from an ordinary checkpoint without storing opponents’ hidden cards.
- [x] Persist and restore the exact active Training scenario through the durable
      checkpoint, validate it against the shipped scenario bank, offer an
      explicit Resume/Abandon choice, and keep answers, hidden information, and
      unsubmitted scores out of the save.
- [x] Persist and restore the active Training camera, transition, and
      pause/inactivity timing state. The versioned checkpoint now preserves the
      seated camera offset, frozen decision clock, and explicit pause menu while
      deliberately excluding answers, scores, hidden cards, and future deals;
      Training has no room fly-through, so its safe resume frame is the seated
      table rather than an invented mid-flight scene.
- [x] Store the engine/content version, PRNG seed, public action log, full blind
      schedule, policy version/simulation count, and public entrant data needed
      to reproduce each scored tournament without retaining opponents’ hidden
      cards in ordinary hand history.
- [x] Retain completed-event replay metadata after leaving the result screen and
      expose player-visible event-end export. The completed runner checkpoint
      remains in the existing versioned replay envelope through ordinary menu
      navigation and is restored as an exportable (but not resumable) replay
      after restart; starting a new event or explicitly resetting/importing
      data replaces it.
- [x] Add bounded native replay-export backends: a strict-allowlist redacted
      public bug-report artifact and a privileged deterministic developer replay
      that fails closed unless explicitly enabled in an unpackaged
      non-production build.
- [x] Add player-visible public replay export controls and review a generated
      artifact from a completed event.
- [x] Define forward- and backward-compatibility policy for saves, including
      update rollback, unsupported future versions, partial writes, disk-full,
      permission-denied, and quota failures.

### Privacy, diagnostics, and player trust

- [x] Keep v1 fully playable offline with no account, analytics, ads, remote
      fonts, CDN assets, bot server, or mandatory update check.
- [x] Add static runtime/CSP checks plus a packaged launch-and-idle deny-proxy
      audit; bundle fonts and every required runtime asset.
- [x] Extend the packaged deny-proxy audit through representative ordinary
      offline play in every mode, failing if any endpoint is contacted. The
      isolated packaged audit now enters Normal, Rational, Training, Timed, and
      Tutorial through their real UI routes and records zero proxy connections.
- [x] Write a plain-language privacy policy for the actual desktop behavior,
      including local saves, optional diagnostics, retention, deletion, and
      third parties.
- [ ] Publish the privacy policy at a stable HTTPS URL and wire the final
      publisher support contact before store submission.
- [x] Keep telemetry absent by default; if it is later added, define a minimal
      event/data inventory, ask separate opt-in consent, provide an in-game
      opt-out/delete path, and never collect hole cards or free-form answers.
- [x] Keep remote crash upload absent in the current offline build. The privacy
      source audit confirms no runtime upload/telemetry dependency, and the
      bundled policy requires any future crash provider to be separate opt-in,
      fully disclosed, reviewable, and deletable before it can ship.
- [x] Add rotating local logs with secrets/path/user-content redaction, bounded
      disk use, timestamps, build/engine versions, and a one-click redacted
      diagnostic export.
- [x] Add bounded atomic crash-loop tracking and pre-ready Electron safe-mode
      activation after repeated startup/renderer failures; disable hardware
      acceleration and expose only a redacted read-only recovery state.
- [x] Consume safe mode in the renderer to ignore imported settings, disable
      animated backgrounds and nonessential audio, show status/exit controls,
      and preserve progress. A renderer-wide safe-mode CSS gate prevents every
      decorative animation, including screens without settings props.
- [x] Pass packaged crash-loop recovery tests against the real Windows build.
      The isolated packaged safe-mode smoke reaches the recovery screen with
      no runtime/console errors and remains reduced-motion after continuing.
- [x] Add visible in-app links for Privacy, Support, Licenses/Credits, version,
      build identifier, save location, log location, and diagnostic export.
      All eight elements verified wired to real preload/IPC values with a
      component test; the support contact is a clearly-labeled placeholder
      pending publisher assignment, and the HTTPS privacy URL remains a
      separately-blocked item.

### Performance, assets, and offline robustness

- [x] Set measurable budgets before optimization: cold start to interactive,
      mode-to-table load time, action-to-feedback latency, frame pacing/FPS,
      idle CPU, peak memory, installer size, and save-write duration.
- [ ] Benchmark those budgets on a low-spec supported Windows machine, a typical
      laptop with integrated graphics, and a discrete-GPU desktop; record power
      and thermal behavior during a 60-minute tournament soak.
- [x] Profile Rational Monte Carlo/equity work, add exact work instrumentation,
      deterministic count-sliced execution, and fail-closed
      per-decision/per-slice caps while preserving fixed-seed decisions and the
      frozen bot baseline.
- [x] Integrate the asynchronous sliced equity boundary into live tournament
      progression (or a worker) with cancellation and stale-result rejection;
      the current synchronous caller remains deterministically capped but can
      still block the UI for a large decision.
- [x] Lazy-load mode-specific code and heavy room/avatar/audio assets, preload
      only the next likely scene, and provide progress plus a cancel/back path
      for loads that exceed the target.
- [x] Define texture, image, animation, and audio memory/size budgets; compress
      masters into shipping formats while retaining source masters outside the
      runtime package.
- [x] Provide static or low-cost fallbacks for artwork, the optional menu video,
      room presentation, local font stacks, and audio; no runtime shader is
      currently shipped.
- [x] Fault-inject corrupt/missing packaged start-menu and championship-room
      image assets without mutating the canonical ASAR; prove visible fallbacks,
      usable controls, clean renderer output, and isolated-profile cleanup.
- [x] Fault-inject slow disk, unsupported video codecs, Windows font failures,
      and audio-device loss in the packaged app. The packaged runner now proves
      an in-memory 1.85-second delayed start-menu read reaches the visible slow
      fallback and then recovers cleanly, and a CDP-blocked bundled-font reload
      records failed Inter/Barlow faces while local fallback stacks keep the
      menu readable and usable; an injected AudioContext failure announces the
      silent fallback and still permits a legal Training action. Unsupported
      codec coverage remains not applicable while no runtime video ships, and
      `scripts/validate-runtime-video-policy.mjs` fails release if a video asset
      or enabled start-menu loop appears without real codec/fallback coverage.
- [ ] Pause expensive rendering and simulations while hidden/minimized and
      verify no runaway timers, detached audio nodes, object URLs, or retained
      hand histories grow memory across long sessions. The packaged input smoke
      now performs a real native minimize/restore and proves the table pauses
      and needs an explicit player resume. The packaged completion smoke also
      records heap/DOM/listener deltas for a completed event and rejects
      retained hand-history rows, blob URLs, or excessive heap growth;
      long-session hardware profiling remains.
- [x] Measure deterministic initial bundle composition and reachable direct
      dependency usage; hard-gate Electron main/preload against renderer or
      poker-engine imports.
- [x] Add a bounded one-host Windows packaged-runtime profiler for cold launch,
      navigation timing, allowlisted CDP main-thread metrics, process-tree CPU/
      working set, exact build/host identity, cleanup, and canonical JSON/Markdown
      evidence; retain the explicit limitation that this is not the required
      low-spec/typical/discrete-GPU hardware matrix.
- [x] Review and retain `start-menu-room.png` as the animated championship-room
      arrival background; the production composition audit now proves every
      built runtime asset has a static reference.
- [ ] Instrument dependency evaluation, startup/main-thread blocking, decode,
      memory, and first-paint cost on supported hardware. Refreshed
      2026-07-24 against the fresh package on this dev host: 492.8ms cold
      launch to recognized renderer, 355 MiB peak process-tree working set,
      4.735% peak normalized CPU, 0 startup long tasks, 2.4 MiB JS heap after
      settle; first paint/FCP still not exposed by the custom
      `poker-training-pro://` protocol. One host only — the low-spec/typical/
      discrete-GPU hardware matrix remains outstanding.

### Audio behavior beyond the soundtrack

- [x] Keep persisted volume application from constructing or playing an audio
      graph before the browser records the player’s first input.
- [x] Add persisted Master/Mute alongside Music and SFX.
- [x] Add explicit keyboard-accessible Master and Table-effects previews with
      one polite status region; keep slider changes silent/graph-free and keep
      Music preview visibly unavailable until approved licensed masters exist.
- [x] Define deterministic audio-focus rules for pause, blur, device
      disconnect/change, headphones removal where exactly detectable,
      suspend/resume, explicit Ready, and simultaneous system audio.
- [x] Wire the audio-focus controller to DOM and Electron `powerMonitor`
      lifecycle events, including the explicit Ready policy and on-screen
      resume recap. The optional output-device monitor remains best-effort.
- [ ] Pass the packaged Windows device/focus matrix (headphone/device change,
      blur, minimize, lock, suspend/resume, and explicit Ready) on real hardware.
- [x] Ensure current card, chip, fold, feedback, and deal sounds do not create hidden
      information or timing tells that the visual interface does not disclose.
- [x] Provide a silent fallback when audio initialization or graph creation
      fails so supplementary sound never blocks a poker action.
- [ ] Test long playlist sessions for leaks, clipping, drift, and abrupt cuts
      after licensed masters and playback are integrated.

### Localization and content operations

- [x] Extract every player-facing string, poker term, shortcut label, error,
      tutorial, and explanation from components into versioned locale resources;
      ship English as an explicit complete locale. A strict versioned English
      message catalog, interpolation helper, and direction-safe message
      component exist, and all player-facing UI strings are now migrated:
      PokerTable, Dashboard, tutorial, settings, credits/about, save controls,
      recovery, tournament event names/tiers/qualification/placement labels,
      the 39 `durablePersistence` save/restore failure messages, credits
      chrome, and tournament-mode synthesized scenario title/prompt/
      actionReason (with real interpolation, not concatenation).
      **Permanent documented exemptions** (verified, not gaps): Training
      scenario prompt/explanation content in `src/data/trainingScenarios.ts`
      (governed by its own versioned schema/review/authoring pipeline — it is
      calibrated poker content, not UI chrome); verbatim bundled third-party
      license/notice text and font proper-noun+license labels in
      `creditsData.ts` (must stay byte-exact, never pseudo-localized); and two
      dead fields in `tournamentSession.ts` (`disclosure`, `mathQuestion.*`)
      confirmed never rendered in tournament modes.
- [x] Add a versioned English numeric locale surface for number, percentage,
      ratio, chip, and duration formatting, and keep quiz parsing unambiguous
      for decimal comma, decimal point, fraction, and colon-ratio input.
- [x] Route every remaining player-facing numeric/date surface through the
      locale layer and add an explicit date resource before claiming complete
      application-wide locale-aware formatting. Fixed decimals, chips, duration
      counts, table speed/timers, AI explanation percentages, recovery timestamps,
      and tournament action amounts now use versioned numeric/date resources;
      remaining `toFixed` calls are internal model rounding only.
- [ ] Add pseudo-localization, 30–50% text-expansion, long-name, and right-to-left
      layout tests before claiming support for another language. The locale
      foundation now has deterministic 35% pseudo expansion, token preservation,
      long-name, and RTL direction/layout regression tests across 16 major
      screens (component-render level, no unmigrated-English-leak sweep plus
      `dir`/`lang` root-attribute propagation); full-screen visual acceptance
      (real rendered layout, clipping, mirrored icon/flex direction under an
      actual browser window) remains before advertising another locale.
- [x] Define a versioned scenario schema and validator for legal cards, stacks,
      actions, units, tolerances, explanations, tags, difficulty, source/reviewer,
      and duplicate detection.
- [x] Build a developer-only deterministic Training-bank validation/export CLI;
      production packages exclude authoring and hidden-answer tooling.
- [x] Extend the developer scenario tooling with an interactive preview/editor
      or generator, deterministic seed controls, and bulk simulation.
- [x] Create an automated bot league/regression harness that compares policy
      versions by position, stack depth, street, action distribution, EV loss,
      timing leakage, and tournament finish distribution before balance changes.
- [x] Gate Training difficulty/Elo and historical-score compatibility against a
      versioned frozen synthetic benchmark; fail silent content, evaluator,
      selection, classification, and calibration drift.
- [ ] Obtain qualified poker-math review and consented human pilot/item/
      near-transfer evidence before claiming real-player difficulty or learning
      calibration; keep the current baseline labeled synthetic-only.

### Security and dependency hygiene

- [x] Add a restrictive packaged Content Security Policy and remove runtime
      third-party script/font/style loads.
- [x] Explicitly enable renderer sandboxing; deny unexpected permission requests,
      block unapproved navigation/new windows/downloads, validate IPC senders
      and arguments, and expose only narrow typed preload methods.
- [x] Enable appropriate Electron fuses and ASAR integrity during packaging,
      then verify the packaged unpacked build refuses tampered application
      resources.
- [ ] Repeat fuse and ASAR-integrity verification on the installed, signed
      release candidate in the clean-machine matrix.
- [x] Track supported Electron/Chromium/Node versions and establish a regular
      security-update cadence instead of freezing the current runtime.
- [x] Add dependency vulnerability, lockfile-integrity, secret,
      registry-origin, and reviewed install-lifecycle-script checks to release
      builds; generate a deterministic CycloneDX SBOM for each shipped version.
- [x] Resolve and hard-gate every locked npm package license declaration with
      exact-version evidence, a reviewed allowlist, negative tests, and a
      deterministic package notices inventory.
- [x] Assemble a deterministic, fail-closed upstream-license-text artifact for
      the seven npm identities selected as shipped runtime content, with exact
      manifest/text hashes, duplicate-path preservation, tamper/staleness/size
      tests, and explicit separation from Electron/Chromium and non-npm asset
      obligations.
- [ ] Assemble and ship the required upstream copyright/license/NOTICE texts,
      and resolve all font, image, audio, and other asset provenance blockers.
- [x] Ensure developer tools, source maps containing source, test hooks, hidden
      cards, debug IPC, and authoring tools are absent or securely disabled in
      production packages.

### Windows packaging, updates, and release materials

- [x] Choose and document the technical Windows distribution path: a signed
      direct x64 NSIS installer, user-initiated full-installer update channel,
      retained signed rollback build, and private-only portable preview.
- [ ] Assign the legal publisher, named release/support owners, signing service,
      HTTPS host, and current fee budget before public distribution.
- [x] Declare the intended v1 support matrix as x64 editions of
      Microsoft-supported Windows 11; do not claim Windows 10, ia32, or Arm64.
- [ ] Build and clean-machine test every Windows 11 feature release still
      supported at release freeze rather than relying on one host or emulation.
- [ ] Produce complete Windows identity assets and metadata: executable/installer
      icons, publisher/product/version fields, Start menu identity, uninstall
      entry, install size, and accessible window title.
- [ ] Authenticode-sign and timestamp every public EXE/installer and relevant
      binary with a production-trusted certificate; keep certificate material
      in protected CI secrets and verify signatures after upload.
- [ ] Choose one signed update mechanism, validate HTTPS metadata and packages,
      prevent downgrade/tampering, support staged rollout and rollback, preserve
      saves, and show readable release notes with Restart Now/Later.
- [ ] Test clean install, non-admin install, upgrade, interrupted update,
      rollback, reinstall, side-by-side prevention, uninstall, and preservation
      or explicit removal of player data in clean Windows virtual machines.
- [x] Add a release CI pipeline that runs typecheck, unit/property/soak tests,
      production build, offline/CSP/static-budget checks, lockfile and obvious
      secret checks, third-party inventory generation, production debug/source
      hygiene checks, and deterministic archived artifact manifests.
- [ ] Extend release CI with Windows installer packaging, Authenticode signature
      verification, installed-app launch/recovery smoke tests, and rollback
      artifact verification once signing and clean-machine runners exist.
- [ ] Prepare accurate store/press materials from the shipping build: icon,
      capsule/hero art, gameplay-only screenshots, short trailer, description,
      feature list, supported inputs, languages, accessibility features, offline
      statement, system requirements, privacy URL, and support URL.
- [ ] Complete the IARC/store age-rating questionnaire accurately for simulated
      poker/gambling content and keep play-chip-only/no-cash language consistent
      in the game, metadata, screenshots, privacy policy, and review notes.
- [ ] Record provenance and commercial redistribution rights for the supplied
      start-menu background and every generated/third-party asset before it
      enters a release candidate; replace anything with unclear rights.
- [x] Establish version-gated CHANGELOG, known-issues register, save
      compatibility matrix, release-operations index, support-response
      procedure, and end-of-support policy without inventing owners or SLAs.
- [ ] Finalize complete upstream notices and approved asset/audio credits, then
      maintain every release-operations document for each public version.
- [ ] Freeze a release candidate, test it from a clean machine with networking
      disabled, collect final hashes and a rollback build, and require a signed
      go/no-go checklist before publishing.

## Release quality

- [x] Keep tournament, Training, Normal AI, and Rational AI tests passing in
      the current 0.1.0 automated release snapshot (38 files / 278 tests).
- [x] Add property/soak tests for card uniqueness, chip conservation, legal
      actions, hidden-information invariance, and deterministic replay.
- [x] Audit generated scenarios and AI explanations for mathematically false
      certainty or outcome bias.
- [x] Add a fail-closed static source/build/package audit confirming no
      recognized payment, purchase, cash-out, transfer-for-value, payment SDK,
      billing IPC, or real-money wagering path.
- [x] Add visible “Play chips only” and “No real-money wagering” copy to the
      active start menu and pass the source plus production-renderer audit.
- [x] Repackage the disclosure and pass the packaged-ASAR boundary audit.
- [x] Require a one-time interactive play-chip acknowledgment before the first
      play session, persist it locally, and keep the no-cash-value/no-wagering
      boundary visible from the start menu and Settings. The state is included
      in the versioned desktop save-transfer allowlist and is covered by unit
      and packaged boundary audits.
- [ ] Complete store-metadata review for the interactive play-chip disclosure
      with the eventual publisher and store submission account.
- [x] Create versioned save migrations and a last-known-good local backup.
- [x] Add crash-safe autosave at action/hand boundaries for tournaments,
      retaining the deterministic checkpoint on settings and lifecycle writes.
- [ ] Review all third-party code, art, fonts, music, and reference licenses.
- [ ] Update this file whenever a requirement is completed, changed, or added.
