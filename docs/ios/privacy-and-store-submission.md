# Privacy, age rating, and store-submission drafts

Status: **drafts prepared on Windows.** Nothing here is submitted, approved, or
final. Every item is pending human review and Apple's own tooling on a Mac with
Xcode 26+. Do not represent any of this as completed rating, privacy, or
submission work. Work items are tracked in
[`app-store-release-checklist.md`](./app-store-release-checklist.md); this file
holds the accurate *content* those steps will use, reconciled against the actual
shipped behavior of the scaffold.

## Actual app behavior these drafts describe

- Fully offline. No network client, web view, remote content, or update check.
- No account, sign-in, or user identifier.
- No analytics, advertising, attribution, or third-party SDK of any kind.
- Play chips only. No real-money wagering, deposits, cash-out, prizes, or
  in-app purchases.
- Progress and settings are stored only in the app's local `UserDefaults`
  container (`LocalProgressStore`, `@AppStorage`). Nothing leaves the device.
- All poker logic, grading, timing, and bot math run in-process through the
  bundled JavaScriptCore engine.

## Privacy manifest reconciliation (`PrivacyInfo.xcprivacy`)

The checked-in manifest matches the behavior above and requires no change for
the current scaffold:

- `NSPrivacyTracking` = `false`.
- `NSPrivacyTrackingDomains` = empty.
- `NSPrivacyCollectedDataTypes` = empty (no data is collected or transmitted).
- `NSPrivacyAccessedAPITypes` declares `NSPrivacyAccessedAPICategoryUserDefaults`
  with approved reason `CA92.1` (app-only access). This is correct while
  `UserDefaults` data stays inside the app container.

Re-audit the manifest, the archive's Xcode privacy report, and every dependency
against the **final** binary before each submission. Adding any SDK, network
call, or account changes these answers.

## App Store privacy "nutrition label" — draft answers

- **Data used to track you:** none.
- **Data linked to you:** none.
- **Data not linked to you:** none.
- Net result: *"Data Not Collected."* Confirm against the archived privacy
  report before answering in App Store Connect.

## Age rating questionnaire — draft inputs (do not guess the resulting rating)

Answer the current App Store Connect questionnaire truthfully; Apple computes
the rating. Expected inputs for this app:

- **Simulated Gambling:** present. The app simulates poker with play chips.
- **Contests / real-money gambling / prizes:** none.
- Violence, sexual content, profanity, horror, mature/suggestive themes,
  medical/drug references, unrestricted web access: none.

Because Simulated Gambling is present, the resulting age rating will not be 4+.
Record the exact rating Apple returns; never hard-code an assumed value into
metadata or this document.

## Simulated-gambling and no-cash disclosure language

Use consistent wording in the app UI, store description, screenshots, privacy
policy, and review notes:

> Poker Training Pro is an educational poker trainer and simulator. It uses play
> chips only. There is no real-money wagering, no deposits or cash-out, no
> prizes, and no in-app purchases. All gameplay, grading, and opponents run
> offline on your device.

The start experience and Settings already surface "Play chips only" / "No
real-money wagering" copy; keep them in sync with this language.

## App Review notes — draft

> This is a single-player, fully offline poker **training** app. All logic,
> saves, grading, timing, and opponent math run on-device via a bundled
> JavaScript engine (JavaScriptCore); there is no server, account, or network
> use. Gameplay is educational/simulated with play chips only — no real-money
> wagering, prizes, or purchases. To review: launch offline (airplane mode is
> fine), tap Play, choose Training for a graded decision + math question, or
> Normal/Rational for a simulated table, or Timed Table to pick minutes and play
> a single rising-blind table. Settings and progress persist locally.

## Screenshots — plan (capture on-device from the Release build)

Capture truthful gameplay-only shots on required current device sizes for both
iPhone and iPad, in the same light/dark theme the build ships:

1. Start menu (brand, Play, Settings, play-chip disclosure).
2. Mode selection (Normal / Rational / Training / Timed Table).
3. Training: a decision + math question mid-answer.
4. Training: graded feedback with Decision/Math Elo change.
5. A simulated table (Normal or Rational) with the opponent-thinking indicator.
6. Timed Table setup (minutes picker).
7. Settings (Table speed, accessibility, privacy statement).

Avoid device frames that imply features the build lacks. iPad screenshots are
required because the app targets iPad. Confirm current pixel specs on Apple's
Screenshot specifications page at capture time.

## TestFlight plan — draft

1. Internal testers first (up to Apple's current internal limit) for a clean
   install + offline smoke across every mode on a physical iPhone and iPad.
2. Verify: airplane-mode launch and complete gameplay, local progress/Elo
   persistence across relaunch, background/foreground timing freeze, Dynamic
   Type at accessibility sizes, VoiceOver on cards/actions/results, Reduce
   Motion, and rotation / iPad split view.
3. Beta description states educational/simulated, offline, play-chips-only, no
   account. Provide the feedback email and export-compliance answer.
4. Expand to external testers only after internal issues are triaged; the first
   external build may need beta review.
5. Triage every crash and material accessibility/gameplay issue before choosing
   a release candidate.

## Submission checklist

Follow [`app-store-release-checklist.md`](./app-store-release-checklist.md)
end-to-end on a Mac. External blockers that cannot be cleared from Windows: a
Mac with Xcode 26+, Apple Developer Program membership and signing identity, a
final bundle ID and app record, owned 1024×1024 icon and store imagery, public
support and privacy-policy URLs, physical iPhone and iPad, the production
shared-engine bundle plus cross-runtime conformance evidence, and human review
of privacy, age-rating, export, and content-rights declarations.
