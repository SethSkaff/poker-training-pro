# Training scenario schema and validation

The authored Training bank is versioned by two independent values:

- `schemaVersion` is the supported object contract. A schema-breaking field or
  semantic change requires a new schema and migration strategy.
- `contentVersion` is `YYYY.MM.DD.REVISION`. Increment it when scenario facts,
  wording, EVs, tolerances, tags, sources, or review state change.

Every scenario carries `source` and `review` metadata. The current bank is
truthfully marked `pending-human-review`; its internal arithmetic and automated
checks are not represented as independent poker-expert approval. Change review
status to `approved` only with a real reviewer ID and review date.

## Validation

From the repository root, using the supported Node runtime:

```powershell
& "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\validate-training-scenarios.ts" `
  --output ".\work\training-scenarios.validated.json"
```

The command validates the TypeScript bank and writes canonical JSON with
recursively sorted object keys and scenarios sorted by ID. Repeated runs against
identical content produce identical bytes. An invalid bank exits with code `1`
and does not write the requested export.

Use `--input <file>` to validate either a JSON scenario array or a previously
exported object containing a `scenarios` array. Argument, parse, and I/O failures
exit with code `2`.

The validator covers:

- supported schema/content versions;
- card ranks, suits, visible-card uniqueness, and street board counts;
- whole-chip blinds, antes, pots, stacks, bets, calls, and raise sizes;
- unique 1-10 seats and player IDs, hero/button presence, and player statuses;
- state-legal recommendations, accepted actions, and EV action keys;
- exactly one numeric math-question object with known topic/unit and bounded
  answer/tolerance;
- substantive prompts/explanations, tags, difficulty, timing/rating metadata;
- source/reviewer consistency;
- duplicate IDs and renamed scenarios with the same structural poker state.

## Human review gate

Automated validation cannot establish that a range, EV estimate, ICM threshold,
or teaching explanation is strategically correct. Before release, an
independent qualified reviewer must inspect each scenario, record a stable
identity and date, resolve requested changes, and only then mark it approved.
