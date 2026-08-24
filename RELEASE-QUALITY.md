# Release-quality gate

Run the deterministic release gate from a clean supported Node installation.
CI uses the exact version in `.node-version`; every release command enforces
the `>=22.12.0` contract before loading its tooling.

```powershell
npm ci
npm run release:verify
```

The gate verifies:

- `package.json`/`package-lock.json` agreement, lockfile v3 structure, SRI
  declarations for remote packages, and installed package versions;
- dependency vulnerability totals, approved registry origins, reviewed install
  lifecycle scripts, and an obvious-secret heuristic scan;
- negative-tested rejection of leftover merge artifacts and unresolved
  conflict markers before compilation;
- versioned release-operations documentation and frozen synthetic Training
  calibration;
- strict TypeScript checking;
- discovery and unfiltered execution of every Vitest unit, audit,
  generated-invariant/property-style, and explicit soak suite;
- a fresh Vite production build, its offline/CSP requirements, and versioned
  static asset/performance budgets;
- privacy/network-source, motion/flash, play-chip-only, hidden Training tooling,
  production composition, and Electron dependency-isolation audits, including
  their applicable negative tests;
- complete locked-package, public-asset, and font-reference audit generation
  plus a deterministic CycloneDX SBOM;
- absence of source maps, source-map references, common debug statements, and
  test hooks in the shipped `dist/**`, `electron/**`, and `package.json` set;
- deterministic SHA-256 and byte-size inventory generation at
  `work/release-manifest.json`.

The GitHub Actions job uses `npm ci`, which checks fetched package bytes against
the lockfile's integrity declarations before running the same gate.

## Explicit gaps

This source gate does not claim or perform code signing, Windows installer
packaging, installed-application smoke testing, secret scanning of Git history,
exhaustive credential detection, active penetration testing, or clean-machine
hardware coverage. Standalone scripts separately exercise the unpacked package,
fuses, ASAR integrity, denied-network idle behavior, rendered custom-protocol
document, and one-host runtime profile after packaging. The third-party report
and runtime notice artifact do not constitute legal approval; publisher,
signing, complete notices, and non-npm asset rights remain release-owner work.
