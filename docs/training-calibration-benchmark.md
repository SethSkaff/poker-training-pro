# Training calibration benchmark

`training-calibration-1.0.0` is a deterministic regression benchmark for the
Training scenario bank. It is synthetic engineering evidence, not evidence that
the difficulty ratings are valid for real players or that using the trainer
improves poker performance. The checked-in baseline is explicitly marked
`pending-human-review`.

## What is frozen

The baseline freezes:

- schema, content, evaluator, and calibration versions;
- each scenario's street, authored difficulty, tags, transfer group, rating
  bands, action EVs/regret thresholds, and math answer/tolerance;
- deterministic near-transfer selections;
- action and math grades, independent Elo deltas, final ratings, and the legacy
  `TrainingResult` projection for three synthetic traces;
- coverage counts for streets, authored difficulties, rating bands, and every
  current tag.

Rating bands are engineering buckets: foundation below 1100, intermediate
1100-1299, advanced 1300-1499, and expert 1500 or above. They do not represent
validated human skill boundaries.

The synthetic traces are intentionally simple:

1. `reference` always selects the highest modeled action EV and the exact math
   answer.
2. `developing` alternates best/second-best actions and exact/near-miss math.
3. `nonresponse` folds where modeled (otherwise alphabetically first) and omits
   math.

All start at 1200/1200 and use the established-player K factor. Fixed timestamps
make the historical `TrainingResult` records byte-stable.

## Run the gate

Using the supported Node runtime:

```powershell
& "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\audit-training-calibration.ts"
```

The command exits `0` only for an exact match. It exits `1` for drift and `2`
when it cannot load or run the audit.

Do not edit the JSON baseline to make a failure disappear. A deliberate
scenario-scoring, classification, selection, or calibration-policy change must:

1. bump `TRAINING_CALIBRATION_VERSION`;
2. regenerate the baseline from the deterministic builder;
3. review the diff, including legacy-result changes;
4. update these assumptions when policy changed;
5. commit the version and reviewed baseline together.

A version mismatch still fails so a version bump cannot silently waive a
changed result.

After bumping the version and before committing, a reviewer may regenerate the
candidate artifact with the deliberately verbose acknowledgement:

```powershell
& "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\generate-training-calibration-baseline.ts" `
  --output ".\src\data\fixtures\training-calibration-v1.json" `
  --acknowledge-synthetic-baseline
```

This command is not the review; it only makes the policy change and its
resulting diff visible.

## Real-player work still required

Before making claims about calibrated difficulty or learning effectiveness,
conduct consented human pilot testing across intended skill levels. Predefine
sample size and exclusion rules; inspect item response, action and math
dimensions separately, timing, ambiguity, transfer to unseen scenarios, and
accessibility/device effects. A qualified poker-math reviewer must also approve
the scenario assumptions. Store only appropriately consented and minimized
data. None of that validation has occurred in this repository.
