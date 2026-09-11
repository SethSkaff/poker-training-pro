# Release-quality gate

Run the deterministic release gate from a clean supported Node installation.
CI uses the exact version in `.node-version`; every release command enforces
the `>=22.12.0` contract before loading its tooling.

```powershell
npm ci
node node_modules/electron/install.js
npm run package:win-unpacked
npm run release:verify
```

The gate's packaged audit stage launches the real unpacked executable, so the
package has to exist before the gate runs. `electron` declares no install
lifecycle script, so its pinned platform runtime comes from its own
`install.js` even after a plain `npm ci`. `outputs/` is ignored, so a package
left by an earlier session is evidence about that session's source, not this
checkout's — build it again.

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
- an isolation audit of the real unpacked packaged executable, launched
  without the package-smoke flag, proving the normal production preload
  exposes no audit-only lifecycle, diagnostics, or deterministic-seed bridge,
  plus that audit family's negative self-tests;
- deterministic SHA-256 and byte-size inventory generation at
  `work/release-manifest.json`.

The GitHub Actions job installs with `npm ci --ignore-scripts`, which checks
fetched package bytes against the lockfile's integrity declarations without
running any dependency's own install script. It verifies lockfile integrity and
dependency security first, then invokes only the reviewed, version-pinned entry
points it needs by name: the esbuild and electron-winstaller binary selectors,
and `electron`'s own `install.js`, which resolves the version from the pinned
package and checks the download against the checksums shipped inside it. It
then builds the unpacked Windows app with `npm run package:win-unpacked` — no
installer target, and so no signing — so the packaged audit stage inspects an
artifact that run produced, and finishes with the same gate.

## Explicit gaps

This gate does not claim or perform code signing, Windows installer packaging,
installed-application smoke testing, secret scanning of Git history, exhaustive
credential detection, active penetration testing, or clean-machine hardware
coverage. An unpacked application is not an installer and not an installed
package: the gate launches one for its lifecycle-bridge isolation audit, while
fuses, ASAR integrity, denied-network idle behavior, the rendered
custom-protocol document, and the one-host runtime profile stay standalone
scripts run against a package after building it. The third-party report
and runtime notice artifact do not constitute legal approval; publisher,
signing, complete notices, and non-npm asset rights remain release-owner work.
