# iOS architecture

Status: scaffold prepared on Windows; Apple-platform build validation pending.

## Product flow

```text
Start menu
  ├─ Play
  │   ├─ Training ────────┐
  │   ├─ Rational ────────┤
  │   ├─ Normal ──────────┼─ compact poker table
  │   └─ Timed Table setup (5–180 minutes) ─┘
  └─ Settings
```

There is no first-run splash layer. The brand mark, title, Play, and Settings are the start menu.

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| App shell | `ios/PokerTrainingPro/App` | App lifecycle and typed navigation destinations |
| SwiftUI views | `ios/PokerTrainingPro/Views` | Adaptive start menu, mode selection, table, and settings |
| Design system | `ios/PokerTrainingPro/DesignSystem` | Brand colors, scalable mark, and minimum-size controls |
| Models | `ios/PokerTrainingPro/Models` | Mode and table display values |
| Engine bridge | `ios/PokerTrainingPro/Engine` | Versioned JSON contract and JavaScriptCore confinement |
| Local persistence | `ios/PokerTrainingPro/Persistence` | Codable progress stored only in the app's `UserDefaults` container |
| Bundled resources | `ios/PokerTrainingPro/Resources` | Asset catalog, privacy manifest, and deterministic JS artifact |

## Local-only boundary

The iOS target has no `Network`, `WebKit`, analytics, advertising, authentication, or backend dependency. Gameplay requests cross only this in-process path:

```text
SwiftUI → SharedPokerEngineBridge → JavaScriptCore → bundled poker-engine.js
```

Settings and progress stay in the app's local container. The current privacy manifest declares:

- no tracking;
- no tracking domains;
- no collected data;
- app-only `UserDefaults` access under approved reason `CA92.1`.

This is a statement about the scaffold, not a permanent declaration for future binaries. Re-audit the code, generated archive privacy report, and every dependency before each submission.

## Universal layout and accessibility

- `TARGETED_DEVICE_FAMILY` is `1,2` for iPhone and iPad.
- Navigation uses standard `NavigationStack`, `Form`, `Button`, `Toggle`, and `Picker` controls so system accessibility behavior is retained.
- Content stays within SwiftUI-managed safe areas; only decorative backgrounds extend under system areas.
- Text uses semantic system styles rather than fixed point sizes.
- The brand mark and playing cards use `@ScaledMetric`; spoken card values are exposed separately so visual scaling is not the only representation.
- Interactive actions have at least 48 points of height.
- Decorative symbols are hidden from accessibility; controls and poker state have combined labels and hints.
- Mode cards use an adaptive grid that expands from one column on narrow phones to multiple columns on iPad.
- Scrolling remains available when Dynamic Type or a smaller split-screen width needs more vertical space.

Mac validation still needs to cover the largest accessibility text sizes, VoiceOver reading/focus order, Voice Control names, Switch Control, Reduce Motion, Increase Contrast, iPad multitasking widths, rotation, and right-to-left layouts.

## Orientation, safe areas, and size-class policy

- Supported orientations are declared in `project.yml`: iPhone allows portrait plus both landscapes; iPad additionally allows portrait-upside-down. This lets iPad honor multitasking and Stage Manager while keeping iPhone away from the upside-down layout.
- The app uses `NavigationStack` and adaptive layouts, so it never assumes a fixed width. It has no size-class lock and must remain usable in iPad split view and Slide Over, and across rotation, without a dedicated iPad-only code path.
- Only decorative backgrounds use `.ignoresSafeArea()`; all interactive content stays inside SwiftUI-managed safe areas. Content is capped with `maxWidth` and centered so ultra-wide iPad widths do not stretch controls.
- Mode selection uses an adaptive grid (`LazyVGrid` with `GridItem(.adaptive:)`), and the Training action row uses `ViewThatFits` to fall back from a horizontal row to a vertical stack when Dynamic Type or a narrow split-view width needs more room. Cards use `minimumScaleFactor` so ranks/suits never clip.

## Timing model and background pausing

- Opponent presentation delays come from the shared `decisionTiming` operation with `surface: "mobile"`, which applies a shorter animation budget than desktop. The user's **Table speed** preference (`settings.presentationRate`, 0.5x–3x) is passed as `presentationRate`; Reduce Motion biases the rate faster to shorten the wait and disables card/camera animation.
- `TableTimingModel` freezes the *exact remaining* delay when `scenePhase` leaves `.active` and resumes from that frozen time on return, so inactive time is never counted against play and no timer runs away in the background. The countdown only advances on a display-cadence tick while the scene is active.

## On-device bot math and simulation caps

- All equity/range work runs in JavaScriptCore on device. `estimateEquity` and `botDecision` are hard-capped to a phone ceiling (`maximumSimulations = 600`, `maximumSimulationsPerSlice = 32`) that is well below the desktop ceiling of 1,200. Callers can lower the count but never raise it past the ceiling; the cap is a fixed simulation count, never a wall-clock budget.
- Worst-case per-decision cost is measured by `scripts/benchmark-mobile-engine.mjs`, which evaluates the exact bundle in a Node VM. On one Windows/Node 24 host the observed worst case was an 8-way pot at the 600-simulation ceiling (~0.29 s); a default 2-opponent Normal decision was ~0.06 s. These are non-portable observations. On-device CPU, energy, thermal-state, and hang validation on target iPhones/iPads with Instruments remains macOS/Xcode work.

## Cross-runtime verification (Windows)

`src/modes/mobileEngineBridge.test.ts` loads the exact bundled `poker-engine.js` in a Node VM and asserts parity with the desktop TypeScript source for the hand evaluator, quiz parsing, Training grading, Elo, decision timing, and the Timed Table blind director, plus determinism and cap enforcement for equity/bot decisions. The Swift `SharedPokerEngineBridgeTests` mirror the same expectations against the bundle in the app target; they compile and run only on macOS/Xcode.

## State and evolution

`LocalProgress` is versioned by its storage key (`localProgress.v1`) and decoded defensively. Invalid or missing state falls back to a safe empty value. A production migration should be added before changing the persisted schema.

The JavaScript engine contract is independently versioned. Swift rejects a response whose contract version differs from `1.0.0`. Production should add fixtures exported from the TypeScript engine so both runtimes prove identical output for the same seed.

## Security posture

- JavaScript is loaded only from the signed application bundle.
- The bridge exposes one JSON-string entry point and no native block callbacks into Swift.
- Seeds are deterministic simulation inputs, not cryptographic randomness and not suitable for real-money play.
- The scaffold has no real-money gambling, multiplayer, purchases, or downloadable executable code.
- Any future remote content or account feature changes the privacy, security, age-rating, review, and offline assumptions and needs a fresh design review.
