# Developer-only Training scenario tool

This terminal tool previews the canonical bank, creates editable draft copies,
validates candidate content, and runs deterministic synthetic batches. It is
not part of the player application. Preview output contains answer keys.

Use the supported Node runtime in each example:

```powershell
$node = "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
```

Preview a canonical scenario:

```powershell
& $node ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\training-scenario-tool.ts" preview `
  --id "river-bluff-catch-price"
```

Create a deterministic draft. If `--id` is omitted, the seed deterministically
selects the source scenario:

```powershell
& $node ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\training-scenario-tool.ts" draft `
  --seed "author-2026-07-23-a"
```

The default is
`work/training-drafts/author-2026-07-23-a.draft.json`. Edit that JSON, then
validate it:

```powershell
& $node ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\training-scenario-tool.ts" validate `
  --input ".\work\training-drafts\author-2026-07-23-a.draft.json"
```

Exporting first validates and writes a candidate under
`work/training-exports/`. Invalid content produces no export:

```powershell
& $node ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\training-scenario-tool.ts" export `
  --input ".\work\training-drafts\author-2026-07-23-a.draft.json"
```

Run a reproducible synthetic batch:

```powershell
& $node ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\training-scenario-tool.ts" simulate `
  --seed "simulation-2026-07-23-a" --trials 10000
```

The simulator samples only validated scenarios and uses current grading, Elo,
schema, and calibration contracts. Its response policy is deliberately
synthetic and is not a model of real players.

## Safety boundary

- Every write is restricted to `work/`.
- Drafts and exports contain `canonicalReplacementAllowed: false`.
- The tool has no canonical replacement command.
- A human must review a validated export, update content/calibration versions
  where required, and use the separate canonical validator before changing the
  authored TypeScript bank.
- No draft, export, simulation, or preview output is player telemetry or
  evidence of learning effectiveness.

After a production build, audit exclusion from renderer output:

```powershell
& $node ".\scripts\audit-training-tool-exclusion.mjs"
```

After packaging, require and inspect the ASAR:

```powershell
& $node ".\scripts\audit-training-tool-exclusion.mjs" --require-asar
```

The audit fails if production source references the tool, built files contain
its answer-key marker, the packaged archive contains its script paths, or a
required archive is absent.

