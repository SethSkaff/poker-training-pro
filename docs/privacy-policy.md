# Poker Training Pro desktop privacy policy

Effective date: 2026-07-23

This policy describes the current Windows desktop build. A stable public copy
and publisher support address must be added before public distribution.

## Summary

Poker Training Pro is designed for local, offline play. The current desktop
build has no account, advertising, analytics, telemetry, remote bot service,
cloud save, mandatory update check, or remote crash-report upload. It does not
sell, rent, transmit, or use player information for tracking.

Poker Training Pro simulates tournament poker with play chips. It has no
real-money wagering, cash value, deposits, purchases, withdrawals, or cash-out
path.

## Data stored on the device

The app may store:

- player-selected name;
- settings such as volume, animation speed, fullscreen, Reduced Motion, and
  color assistance;
- Decision, Math, and Tournament Elo;
- training results, elapsed response times, streaks, unlocks, and tournament
  progress;
- versioned save envelopes and a previous valid autosave generation;
- reproducibility metadata such as engine/content/policy version, deterministic
  seed, blind schedule, and public action log when that feature is enabled.

Ordinary hand history and diagnostic exports must not include opponents'
hidden cards, the future deck, private server state, or free-form personal
content. The game currently has no server.

Authoritative packaged saves are intended to live below Electron's per-user
`userData` directory. Browser storage may be read once to migrate an earlier
local-only save; it is not a cloud or third-party store.

## Retention and deletion

Local progress remains until the player resets it, uninstalls and chooses to
remove data, or deletes the application's user-data directory. The recovery
system may retain the current and previous valid generation so a damaged write
does not erase the only usable save. Exported saves or diagnostics remain
wherever the player chose to place them.

The release build must provide separate controls for resetting progress and
settings, exporting/importing a validated save, viewing the save location, and
deleting local diagnostics. Those controls are release requirements; absence
of a completed control is not permission to upload or retain data remotely.

## Diagnostics and crashes

The current build performs no remote crash upload. Any future remote crash
service must be separately disclosed, off by default, activated only by
specific opt-in consent, list every transmitted field and retention period,
exclude cards and free-form answers, and provide an in-app opt-out/delete path.

Local diagnostic exports must be player-initiated, redacted, and reviewable
before the player shares them. Opening or sharing an export is controlled by
the player and the operating system.

## Network and third parties

Required fonts and runtime assets are bundled. Ordinary offline play is not
supposed to contact an endpoint. Electron, React, Vite-built renderer code, and
bundled fonts execute locally and are not analytics or data processors merely
because their code is included in the application.

If a later feature introduces networking, accounts, ads, analytics, cloud
saves, updates, purchases, or support upload, this policy and the in-game
consent/control flow must be revised before that feature is enabled.

## Children and simulated poker

The game teaches simulated poker and statistics. Store age-rating and
simulated-gambling disclosures are handled separately. No statement in this
policy changes the applicable store rating.

## Contact and policy publication

The release owner must publish this exact policy at a stable HTTPS URL and add
the publisher's support contact before store submission or public release.
Until then, this repository copy is the authoritative development policy and
the public-publication requirement remains blocked.
