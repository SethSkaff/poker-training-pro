# Runtime support and security-update policy

## Supported toolchain

Poker Training Pro uses exact release-runtime pins for the components that
execute application code:

| Layer | Supported version | Verification |
| --- | --- | --- |
| Development and CI Node.js | `>=22.12.0` | `node --version` before install |
| Electron | `43.2.0` | exact `devDependency` and lockfile |
| Packaged Chromium | `150.0.7871.129` | `process.versions.chrome` in Electron |
| Packaged Node.js | `24.18.0` | `process.versions.node` in Electron |
| Vite | `8.1.5` | exact `devDependency` and lockfile |
| React plugin for Vite | `6.0.4` | exact `devDependency` and lockfile |
| electron-builder | `26.15.3` | exact `devDependency` and lockfile |

The packaged runtime versions were inspected directly from the downloaded
Electron executable on 2026-07-23:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
.\node_modules\electron\dist\electron.exe -e `
  "console.log(JSON.stringify(process.versions))"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

The application does not claim support for development with an older Node
release. `npm ci` is the required install command for repeatable CI/release
builds.

## Update cadence

- Run the lockfile vulnerability and integrity gates on every change.
- Review Electron, Vite, React, electron-builder, and all direct dependencies
  at least monthly even when automated checks are green.
- Upgrade to a security-fixed Electron patch immediately when compatible.
- Triage a critical or remotely exploitable high-severity advisory within one
  business day and prepare a patched build within 72 hours.
- Triage other high-severity advisories within seven days.
- Do not suppress an advisory without a written scope analysis, compensating
  controls, owner, expiry date, and a linked upgrade task.
- Never use `npm audit fix --force` in the release workflow. Major upgrades are
  explicit changes followed by the complete verification gate.

## Required verification after a runtime upgrade

1. Clean `npm ci` under the supported Node version.
2. Zero unresolved production vulnerability findings.
3. Typecheck and complete unit/property/soak test suite.
4. Production build and offline/CSP audit.
5. Electron launch smoke test with sandbox, preload IPC, local saves, and
   packaged fonts.
6. Windows installer and portable-build smoke tests before release.
7. Record the bundled Chromium and Node versions in this file when Electron
   changes.

The current direct Electron and Vite pins were upgraded after an audit found
known advisories in the previous versions. The refreshed lockfile reports zero
known vulnerabilities at the time recorded above.
