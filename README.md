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

Prerequisite: Node.js 22.12.0 or newer. The reproducible baseline is pinned in
`.node-version` and `.nvmrc`; CI reads the same pin. npm workflows fail before
loading Vite, Vitest, Electron, or release tooling when the runtime is too old.

```powershell
npm run check:runtime
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
current Windows package there; the directory is ignored by Git and is never part
of the source release.
No other versioned build folders should be created.

See [APP_OVERVIEW.md](APP_OVERVIEW.md) for the current product and architecture
brief, and [VERSION_POLICY.md](VERSION_POLICY.md) for the two-slot build rule.

## Research baseline

Tournament behavior follows the 2024 Poker Tournament Directors Association
rules and models its championship structure on the published 2025 WSOP Main
Event. Poker decisions are graded from the information available at the time,
not from the eventual runout.
