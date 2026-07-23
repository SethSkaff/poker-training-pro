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

## State and evolution

`LocalProgress` is versioned by its storage key (`localProgress.v1`) and decoded defensively. Invalid or missing state falls back to a safe empty value. A production migration should be added before changing the persisted schema.

The JavaScript engine contract is independently versioned. Swift rejects a response whose contract version differs from `1.0.0`. Production should add fixtures exported from the TypeScript engine so both runtimes prove identical output for the same seed.

## Security posture

- JavaScript is loaded only from the signed application bundle.
- The bridge exposes one JSON-string entry point and no native block callbacks into Swift.
- Seeds are deterministic simulation inputs, not cryptographic randomness and not suitable for real-money play.
- The scaffold has no real-money gambling, multiplayer, purchases, or downloadable executable code.
- Any future remote content or account feature changes the privacy, security, age-rating, review, and offline assumptions and needs a fresh design review.
