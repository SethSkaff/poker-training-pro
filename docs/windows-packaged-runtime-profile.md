# Windows packaged runtime performance profile

`scripts/profile-packaged-runtime.mjs` records a bounded cold-launch
observation from the unpacked Windows application. It is an evidence generator,
not a substitute for the required low-spec, typical, and discrete-GPU hardware
matrix.

## Run

Use Node.js 22 or newer after creating a fresh unpacked package:

```powershell
node scripts/profile-packaged-runtime.mjs
```

The default target is
`outputs/desktop/win-unpacked/Poker Training Pro.exe`. Optional arguments are:

```powershell
node scripts/profile-packaged-runtime.mjs `
  --app "D:\staging\Poker Training Pro.exe" `
  --timeout-ms 30000 `
  --sample-interval-ms 250
```

Before launch, the profiler checks that the executable and `app.asar` exist,
that `app.asar` is at least as new as the production renderer and Electron
entry files, and—once only—that no `electron-builder` process is active.

Run deterministic parser and budget-boundary self-tests with:

```powershell
node scripts/test-packaged-runtime-profiler.mjs
```

## Evidence produced

The profiler overwrites two stable paths:

- `work/packaged-runtime-profile.json` — versioned, canonical-key-order JSON;
- `work/packaged-runtime-profile.md` — concise human-readable summary.

The report includes:

- wall-clock launch-to-recognized-rendered-state time;
- Navigation Timing and first-paint/FCP values when Chromium exposes them;
- an allowlist of CDP Performance metrics, including `JSHeapUsedSize` /
  `JSHeapTotalSize` read once the renderer has settled;
- `metrics.longTasks` — count, total duration, and longest duration from a
  buffered `PerformanceObserver({ type: "longtask", buffered: true })`
  registered as early as the profiler's CDP session allows. This is a
  startup-window main-thread-blocking proxy, not a from-process-start
  guarantee: tasks that ran and were evicted from Chromium's internal buffer
  before the observer attached are not replayed;
- `metrics.assetTiming.imageDecodeProxy` and
  `metrics.assetTiming.scriptEvaluateProxy` — Resource Timing API durations
  (`responseEnd - startTime`) and transfer sizes for image and script
  requests observed during startup, sorted deterministically by resource
  name. These durations include network fetch time plus whatever in-process
  handling Chromium folds into that span; they stand in for isolated GPU
  image-decode and V8 script-compile/evaluate phases (a true breakdown of
  those phases needs the heavier Tracing domain, which this profiler
  intentionally avoids) — treat them as a dependency-evaluation/decode proxy
  only;
- sampled Electron process-tree peak working set, process count, aggregate CPU
  time, and peak CPU percent normalized across host logical processors;
- executable and ASAR sizes plus SHA-256 hashes;
- application/Electron/Node versions and anonymous host specification
  fingerprint derived from OS, architecture, CPU model/count, and RAM;
- explicit observational budget classifications (including
  `firstContentfulPaint`, `longTaskTotal`, and `jsHeapUsed`, each of which
  reports `"not-observed"` instead of throwing when Chromium does not expose
  that value) and limitations.

The report deliberately omits hostname, username, temporary profile path,
remote-debugging port, command lines, and normal application saves.

## Isolation and limitations

Each run uses a new operating-system temporary user-data directory and an
ephemeral loopback CDP port. Cleanup targets the exact spawned PID tree and
refuses profiles outside the temporary directory or without the profiler
prefix. Normal profiles and unrelated app copies remain outside scope.

The JSON records that this is one cold launch on one host. It cannot establish
performance on low-spec hardware, a typical target PC, or discrete graphics.
CDP attachment adds detection overhead; Windows process sampling can miss short
spikes; and this run does not cover sustained gameplay, frame pacing, GPU
memory, power, thermals, or long-session leaks. The long-task and asset-timing
additions are startup-window proxies collected without the Tracing domain, so
they can under-report main-thread blocking that happened before the CDP
observer attached, and they cannot isolate GPU decode or V8 compile/evaluate
time from surrounding network/handling time. JS heap and long-task figures are
a single settled-moment snapshot, not a peak or sustained measurement.

The release runner is intentionally unchanged until package construction and
hardware-matrix policy are finalized.
