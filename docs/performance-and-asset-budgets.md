# Desktop performance and asset budgets

These are v1 pass/fail budgets, not aspirational measurements. They must be
revised deliberately by changing the versioned
`config/performance-budgets.json`; a slower build does not silently redefine
the target.

## Interaction and runtime budgets

| Measure | Typical integrated-graphics laptop | Low-spec supported PC |
| --- | ---: | ---: |
| Cold launch to interactive start menu | 1.5 s | 3.0 s |
| Mode confirmation to usable table | 1.5 s | 3.0 s |
| Hero action to visible acknowledgement | 100 ms | 100 ms |
| Frame time, 95th percentile during play | 25 ms | 25 ms |
| Frame time, 99th percentile during play | 50 ms | 50 ms |
| Hidden/static-menu idle CPU | 3% | 3% |
| Peak application working set | 600 MiB | 600 MiB |
| Crash-safe autosave write, 95th percentile | 50 ms | 50 ms |

The action-feedback clock stops on the first visible pressed/action state; it
does not wait for a cinematic chip or card animation. Intentional AI thinking
time is measured separately and may not block input or rendering.

The low-spec, typical-laptop, and discrete-GPU hardware definitions and the
60-minute thermal soak remain part of the separate benchmark TODO. Until those
machines are recorded, a developer-machine pass is informative but cannot
close the hardware benchmark gate.

## Shipping and bundle budgets

| Artifact | Budget |
| --- | ---: |
| Production `dist/` | 64 MiB |
| Initial JavaScript, gzip | 0.30 MiB |
| Initial CSS, gzip | 0.10 MiB |
| Windows installer before soundtrack | 200 MiB |
| Portable build before soundtrack | 250 MiB |

The bundle audit reports compressed and uncompressed totals. Electron runtime
bytes are counted in installer/portable measurements, not in the renderer
`dist/` number.

## Image, animation, and audio budgets

- Decoded texture peak: 256 MiB across the active scene.
- Single menu background: at most 8,294,400 pixels and 4 MiB compressed.
- Two-second ambient menu loop: at most 12 MiB, with the supplied still as the
  loading, error, unsupported-codec, and Reduced Motion fallback.
- A single streamed audio decode/buffer window: at most 16 MiB.
- Shipping instrumental music: at most 180 MiB after loudness normalization
  and delivery encoding.
- Shipping sound effects: at most 24 MiB.
- Source masters stay outside runtime packaging and are tracked separately from
  shipping encodes.

Large assets must be lazy-loaded by scene. Leaving a scene must release decoded
video frames, object URLs, and audio buffers that are not part of the next
preload window.

## Measurement contract

1. Use a production build with developer tools closed.
2. Start from a cold process; record ten launches and report median and p95.
3. Run each mode-to-table transition ten times per supported hardware class.
4. Capture frame times, process CPU, working set, GPU memory where available,
   and save latency with timestamps tied to the build identifier.
5. Record failures as failures; do not discard shader compilation, first-use
   font loading, or unusually expensive poker decisions.
6. Store the raw results and a short environment manifest with each release
   candidate.

`scripts/audit-static-budgets.mjs` enforces the build-time subset now. Runtime,
hardware, installer, and long-soak numbers require the later acceptance pass.
`docs/production-composition-audit.md` records the initial file/dependency
composition baseline and the separate static Electron import-isolation gate.
