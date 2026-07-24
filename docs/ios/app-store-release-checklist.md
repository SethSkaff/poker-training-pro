# iPhone/iPad, TestFlight, and App Store release checklist

Retrieved and reviewed: **July 23, 2026**. Sources below are official Apple pages only. Apple changes requirements, so re-open every linked requirement immediately before upload.

## 1. Mac, Xcode, account, and signing

- [ ] Use a Mac with a macOS release supported by the stable Xcode chosen for release. Apple distributes Xcode through the Mac App Store and lists supported macOS/SDK/device combinations on its [Xcode support page](https://developer.apple.com/support/xcode/).
- [ ] Use **Xcode 26 or later with an iOS/iPadOS 26 SDK or later**. This has been required for App Store Connect uploads since April 28, 2026; confirm the requirement on Apple's [Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/) page.
- [ ] Do not treat a Windows code review as a build. Apple says simulated devices run in Device Hub on a Mac, and recommends physical-device verification: [Running your app on simulated or physical devices](https://developer.apple.com/documentation/Xcode/running-your-app-on-simulated-or-physical-devices).
- [ ] Join the Apple Developer Program for App Store Connect and TestFlight distribution. A free Personal Team can do limited, expiring on-device development but not App Store distribution: [Developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account).
- [ ] In Xcode, set the final team and registered bundle ID, leave automatic signing enabled unless the release owner deliberately manages profiles, and confirm Release signing.
- [ ] Connect at least one supported iPhone and one supported iPad. Xcode can register connected devices automatically when using automatic signing: [Register a single device](https://developer.apple.com/help/account/devices/register-a-single-device).

## 2. Generate, compile, test, and inspect

- [ ] On the Mac, run `xcodegen generate` from `ios/`, open `PokerTrainingPro.xcodeproj`, and resolve any project-generation warnings.
- [ ] Build Debug and Release configurations with Xcode 26+.
- [ ] Run all `PokerTrainingProTests` and preserve the result bundle.
- [ ] Test clean install, upgrade, background/foreground, termination/relaunch, low-storage behavior, and corrupted local progress recovery.
- [ ] Test portrait and landscape on compact and large iPhones plus full-screen and multitasking widths on iPad.
- [ ] Test the oldest supported OS (iOS/iPadOS 17) and the current OS available in the chosen Xcode.
- [ ] Run on physical iPhone and iPad. Apple warns Simulator does not reproduce all physical-device performance and features: [Building and running an app](https://developer.apple.com/documentation/xcode/building-and-running-an-app).
- [ ] Verify airplane-mode startup and complete gameplay because the product promises local-only operation.
- [ ] Confirm the exact bundled `poker-engine.js` passes the shared deterministic conformance corpus and record its source revision and SHA-256.
- [ ] Use Instruments and Xcode diagnostics to check launch time, hangs, crashes, memory growth, energy, and main-thread stalls.

## 3. Accessibility and UI quality

- [ ] Use Accessibility Inspector and test manually with VoiceOver, Voice Control, and Switch Control. SwiftUI provides baseline semantics, but Apple explicitly recommends testing with accessibility features and enhancing labels/values where needed: [Accessibility fundamentals](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals).
- [ ] Check every Dynamic Type size, including accessibility sizes, without clipped controls, hidden actions, or unreadable poker state.
- [ ] Check Bold Text, Button Shapes, Increase Contrast, Reduce Transparency, Reduce Motion, Differentiate Without Color, and color filters.
- [ ] Confirm focus order, action names, hints, card announcements, pot/blind announcements, and modal dismissal with VoiceOver.
- [ ] Test right-to-left layout and every supported localization. Apple documents scheme-based language/region testing: [Testing localizations when running your app](https://developer.apple.com/documentation/xcode/testing-localizations-when-running-your-app).

## 4. Icons, screenshots, metadata, and product claims

- [ ] Replace all empty AppIcon placeholders with owned final art; confirm the archive contains the correct icon and no alpha-related validation issue.
- [ ] Capture truthful iPhone and iPad screenshots from the release build. App Store Connect accepts one to ten `.jpeg`, `.jpg`, or `.png` screenshots and documents current device pixels on [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
- [ ] Because this app supports iPad, provide the required iPad screenshot set as well as iPhone screenshots. Avoid frames or feature claims that the build does not deliver.
- [ ] Prepare final name, subtitle, description, keywords, support URL, marketing URL if used, copyright, category, and review contact.
- [ ] Review the current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), especially crash-free operation, complete/accurate metadata, review access, minimum functionality, privacy, and gambling-related content.
- [ ] Confirm Poker Training Pro is described as education/simulation only. Do not imply real-money wagering, prizes, or guaranteed gambling outcomes.

## 5. Privacy, age rating, legal, and export

- [ ] Re-audit the final binary and every SDK. The scaffold currently contains no tracking, off-device collection, or third-party SDK, but final App Store answers must describe the shipped binary.
- [ ] Validate `PrivacyInfo.xcprivacy`. Apple requires the exact filename and explains its data, tracking-domain, and required-reason keys in [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).
- [ ] Keep `CA92.1` only while `UserDefaults` data is app-only. Apple defines this approved reason in [Privacy Accessed API Reasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons).
- [ ] Archive, generate Xcode's privacy report, and reconcile it with App Store Connect. Apple documents that process in [Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests).
- [ ] Publish a publicly accessible privacy policy and enter its URL. Apple says a Privacy Policy URL is required for all apps: [App privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/).
- [ ] Complete the current age-rating questionnaire accurately. It explicitly includes chance-based activities and **Simulated Gambling**; never guess the resulting rating: [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating).
- [ ] Confirm content rights for the name, logo, card art, sounds, copy, and any future third-party material.
- [ ] Answer export-compliance questions for the final binary. Apple requires an export determination if an app uses, accesses, contains, implements, or incorporates encryption: [Overview of export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).
- [ ] If legal counsel and App Store Connect determine the app uses no nonexempt encryption, set the appropriate Info.plist declaration only after that determination. Do not copy an exemption claim from this checklist.
- [ ] If distributing in the EU, complete applicable trader-status information; Apple's [Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/) page says trader status is required for EU App Store updates.

## 6. App Store Connect and TestFlight

- [ ] Have the Account Holder accept current agreements.
- [ ] Create the app record before uploading a build; Apple lists name, primary language, bundle ID, SKU, and access in [Add a new app](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app).
- [ ] Increment the build number, archive the Release scheme, run Validate App, and upload from Xcode.
- [ ] Wait for processing and resolve every warning/error. Apple explains association by bundle ID, version, and build string in [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).
- [ ] Fill in TestFlight beta description, features to test, feedback email, and export-compliance information.
- [ ] Start with internal testers. Apple currently supports up to 100 App Store Connect internal testers.
- [ ] After internal smoke testing, invite external testers if needed. Apple currently supports up to 10,000 external testers, the first external build may need beta review, and builds remain testable for up to 90 days: [TestFlight Overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview).
- [ ] Test production signing, first launch, local saves, airplane mode, every mode, settings persistence, crash reporting, and update from the prior TestFlight build on physical iPhone and iPad.
- [ ] Triage every TestFlight crash and material accessibility/gameplay issue before selecting the release candidate.

## 7. Submission and release

- [ ] Select the exact tested build for the version and complete all required version metadata, screenshots, privacy answers, age rating, availability, pricing, export answers, and App Review contact fields.
- [ ] In App Review notes, state that gameplay is educational/simulated, all logic and saves are on-device, no account is required, no server is used, and no real-money gambling or prizes are present. Explain any non-obvious training interaction.
- [ ] Perform a final clean-install smoke test from the uploaded TestFlight build on physical iPhone and iPad.
- [ ] Add the version for review, inspect the draft submission, then explicitly submit it. Apple documents the two-step action in [Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/).
- [ ] Monitor App Store Connect messages, respond with concrete reproduction details, and keep the submitted experience available and functional.
- [ ] After approval, verify the chosen release mode and storefront availability, then smoke-test the App Store build.

## External blockers for this Windows-prepared scaffold

- A supported Mac and stable Xcode 26+.
- XcodeGen on that Mac.
- Apple Developer Program membership, team selection, certificates, and profiles.
- Available final bundle ID and App Store Connect app record.
- Final owned 1024×1024 app icon and store imagery.
- Public support and privacy-policy URLs.
- Physical iPhone and iPad.
- Production shared-engine bundle and cross-runtime conformance evidence.
- Human review of privacy, age-rating, export, content-rights, and regional business declarations.
- Xcode compile/test/archive/privacy-report validation, TestFlight validation, and App Review.

