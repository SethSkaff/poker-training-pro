# Windows packaged asset-fault smoke

This smoke test launches the already-packaged Windows application with an
isolated Chromium profile. It never edits bytes in the canonical
`outputs/current/win-unpacked` package.

Electron's custom `poker-training-pro://` resource responses bypass Chrome
DevTools Protocol `Fetch` interception. The package also enables embedded ASAR
integrity, so even altering an isolated copy makes the executable correctly
reject that copy before renderer startup. The strongest safe, non-mutating
test therefore installs a new-document image source override through CDP in
the real packaged renderer:

- `/start-menu-reference.png` is replaced with an invalid `image/png` data
  source before decode.
- `/start-menu-room.png` is replaced with a nonexistent custom-protocol asset.

It then drives the actual packaged UI from first-run setup through **Play**,
**Normal**, and **Enter event**. A pass requires a nonblank `#root`, the real
React failed-asset states, visible CSS/DOM fallback art, and usable Play,
Settings, and Skip arrival controls. Runtime exceptions and console errors
fail closed.

Run:

```powershell
node scripts/audit-packaged-asset-fault-smoke.mjs
```

Machine-readable evidence is written to
`work/packaged-asset-fault-smoke.json`. The evidence includes a SHA-256 hash of
`resources/app.asar` before and after the test, isolated-profile cleanup
status, and a freshness comparison between the package and checked renderer
source/build inputs. A stale package is clearly recorded; it is not silently
presented as current source coverage.

Deterministic self-tests:

```powershell
node --test scripts/test-packaged-asset-fault-smoke.mjs
```

This test deliberately claims only packaged image delivery and the associated
fallback UI. It does not claim video decoding, font loading, audio playback,
or audio-device coverage.
