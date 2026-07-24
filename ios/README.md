# Poker Training Pro for iPhone and iPad

This directory is a source-complete SwiftUI scaffold for a universal iOS/iPadOS app. It is intentionally local-only: there is no account, server, web view, analytics SDK, advertising SDK, or network client. A bundled deterministic JavaScript artifact runs through JavaScriptCore.

## What is implemented

- One start menu: brand mark and title, then large **Play** and **Settings** actions. There is no disposable splash screen.
- Four play modes: Normal, Rational, Training, and Timed
  Table. Timed Table asks for a 5–180 minute budget before seating the player.
- A compact, adaptive green poker table using the bundled deterministic engine preview.
- SwiftUI layouts that respect safe areas, system text styles, Dynamic Type, light/dark accessibility semantics, and VoiceOver labels.
- Local preferences and progress storage (Decision/Math/Tournament Elo, streaks, career results, a Table-speed preference) with a privacy-manifest declaration for app-only `UserDefaults`.
- A versioned JSON bridge around JavaScriptCore whose bundled engine mirrors the desktop primitives: hand evaluation, quiz answer parsing (`33%`, `0.33`, `1/3`, `2:1`), Training grading + Elo, the AI decision-timing model (mobile budget), the Timed Table blind director, and capped on-device range equity for Normal/Rational bot decisions.
- A one-move Training flow that grades a decision and a math question on-device and persists Elo/progress.
- `scenePhase`-based freezing of the exact remaining opponent delay when backgrounded/inactive, and Reduce Motion handling.
- Unit-test source for the expanded bridge operations and local persistence, plus a Windows-runnable cross-runtime parity test (`../src/modes/mobileEngineBridge.test.ts`) and a worst-case decision benchmark (`../scripts/benchmark-mobile-engine.mjs`).
- An XcodeGen `project.yml` for iPhone and iPad targets.

## Generate and open the project on a Mac

Prerequisites:

1. A Mac running a macOS version supported by the selected Xcode release.
2. Xcode 26 or later. Apple has required App Store uploads to use Xcode 26 or later with an iOS/iPadOS 26 SDK or later since April 28, 2026.
3. XcodeGen available on the Mac.

From Terminal:

```sh
cd ios
xcodegen generate
open PokerTrainingPro.xcodeproj
```

Then select the app target, choose a signing team, verify that the bundle identifier is available, and run the `PokerTrainingPro` scheme.

`project.yml` is the source of truth. Do not hand-edit the generated `.xcodeproj`; regenerate it after changing project metadata.

## Important Windows boundary

Windows can store and review this source, run the JavaScript contract smoke test with Node, and validate text/XML/JSON files. Windows **cannot run Apple's iOS/iPadOS Simulator, Xcode build system, code signing, archive validation, or App Store upload flow**. Apple documents Simulator as running in Device Hub on a Mac and Xcode as a Mac App Store download.

No fake simulator has been installed or used, and this scaffold has not been represented as an iOS build from Windows. Compilation, tests, accessibility inspection, simulator coverage, physical-device validation, archive validation, TestFlight, and submission remain Mac/Xcode work.

## Before an archive

- Replace the intentionally empty `AppIcon.appiconset` slots with approved 1024×1024 artwork, including any dark/tinted variants you intend to ship.
- Replace the scaffold JS artifact with the production browserless bundle from the shared TypeScript engine while keeping contract `1.0.0`, then run the contract suite.
- Set the Apple Developer team and final bundle identifier.
- Review the privacy manifest and App Store privacy answers against the final binary and every dependency.
- Work through `../docs/ios/app-store-release-checklist.md`.

See:

- `../docs/ios/architecture.md`
- `../docs/ios/engine-bridge-contract.md`
- `../docs/ios/app-store-release-checklist.md`
