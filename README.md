# Poker Training Pro

Poker Training Pro is a game-like desktop trainer for No-Limit Texas Hold'em.
It combines one-decision poker-math drills with two tournament careers:

- **Rational Tour:** transparent, range-aware mathematical opponents.
- **Normal Tour:** strong opponents with bounded personalities, bluffs, and
  exploitative adjustments.
- **Training Lab:** one decision and one contextual math question per scenario,
  with practical table-math tolerances and immediate feedback.

The first release is Windows-first and packaged with Electron. All progress,
settings, ratings, and timing history are stored locally on the device.

## Development

Prerequisite: Node.js 22 or newer.

```powershell
npm install
npm run dev
```

## Verification and packaging

```powershell
npm test
npm run build
npm run package:win
```

The approved playable build is always in `outputs/current`. Packaging writes the
candidate build to `outputs/next`; after approval, run
`powershell -File scripts/promote-build.ps1 -Force` to replace `current` with it.
No other versioned build folders should be created.

See [APP_OVERVIEW.md](APP_OVERVIEW.md) for the current product and architecture
brief, and [VERSION_POLICY.md](VERSION_POLICY.md) for the two-slot build rule.

## Research baseline

Tournament behavior follows the 2024 Poker Tournament Directors Association
rules and models its championship structure on the published 2025 WSOP Main
Event. Poker decisions are graded from the information available at the time,
not from the eventual runout.
