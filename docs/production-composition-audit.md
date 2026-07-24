# Production composition and dependency audit

The deterministic audit is:

```text
node node_modules/vite/bin/vite.js build
node scripts/audit-production-composition.mjs
node scripts/test-production-composition-audit.mjs
```

It prints stable JSON and exits nonzero when the Electron isolation policy is
violated. There is no clock time, machine path, or filesystem enumeration order
in the report. Every built file has a relative path, category, byte count,
SHA-256 digest, and static referrers. JavaScript and CSS also include level-9
gzip sizes. `config/production-composition-baseline.json` records the v0.1.0
category totals; comparisons are informational because the stricter absolute
release size limits remain in `config/performance-budgets.json`.

## Current v0.1.0 baseline

| Category | Files | Bytes | Gzip bytes |
| --- | ---: | ---: | ---: |
| JavaScript | 1 | 355,095 | 107,712 |
| CSS | 1 | 94,233 | 20,326 |
| Images | 7 | 9,912,210 | n/a |
| Fonts | 16 | 400,656 | n/a |
| HTML | 1 | 1,016 | n/a |
| Total | 26 | 10,763,210 | n/a |

The dependency scan follows the production entry graphs from `src/main.tsx`,
`electron/main.cjs`, and `electron/preload.cjs`; it does not credit imports
that exist only in unreachable source or tests. All five direct production
dependencies have reachable production imports:
`@fontsource/barlow-condensed`, `@fontsource/inter`, `lucide-react`, `react`,
and `react-dom`. The report maps each one to its importing files. A future
declared dependency with no production import is a visible warning.

`start-menu-room.png` is currently the only built runtime asset with no static
referrer. That is a review flag, not deletion authority: generated or
dynamically composed asset paths can evade static reachability. The file stays
in place until the UI owner confirms whether it is intentional.

## Electron isolation gate

The audit follows local `require`, static `import`/`export`, and string-literal
dynamic-import edges transitively from `electron/main.cjs` and
`electron/preload.cjs`. The current reachable set is limited to:

- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/local-logger.cjs`
- `electron/save-store.cjs`

Only Node built-ins and Electron itself are allowed as external imports.
Crossing into `src/`, reaching an engine/mode or named poker-computation path,
or importing any renderer-only production dependency hard-fails. A new
Electron external dependency also fails closed until it is classified in
`config/production-composition-policy.json`.

The negative test creates isolated temporary fixtures and proves rejection of
a renderer-only dependency imported by Electron and a transitive Electron
helper that reaches `src/modes/rational.ts`. It also proves unused direct
dependencies are reported without silently changing the manifest.

## What this evidence does not establish

This audit establishes the production bundle composition, direct-dependency
source usage, and absence of a static poker-engine import path from the Electron
entrypoints. It does not measure dependency startup cost or prove the main
thread never blocks. Byte and gzip sizes do not measure module parse/compile
time, module evaluation, image/font decode, GPU upload, first paint, CPU,
working set, or frame time.

Closing the runtime portion requires instrumented cold-start measurements from
process creation to the interactive menu, with module/evaluation spans where
available, across ten production launches on each supported hardware class.
The same acceptance run must record mode-to-table transition time, idle CPU,
working set, and frame-time percentiles. Removing the statically unreferenced
image also requires an explicit UI-owner decision and a new build/audit.
