# Normal-mode all-in audit — 2026-08-21

Conclusion: the reproducible frozen-clock Normal-mode measurement does not
demonstrate a frequent-all-in regression, so no bot-policy change is warranted.
The documented release gates pass by a wide margin, every observed all-in
passes the legal-action and postcondition checks, and only one frozen-clock
all-in used a personality deviation. The live-clock replay is retained as
context; its different hand-count/clock progression is not substituted for the
frozen release gate.

## Reproduction

- Source revision: e440712
- Event: local-qualifier
- Seeds: ai-measure-0 through ai-measure-7
- Clocks: frozen, live
- Maximum hands per tournament: 400
- Policy options: simulations=60, temperature=0.48
- Exact command:

  node node_modules/vite-node/vite-node.mjs -c scripts/vite-node.config.mjs scripts/report-normal-all-in-audit.ts -- --seeds 8 --seed-prefix ai-measure --clock both --max-hands 400 --event local-qualifier --audit-date 2026-08-21 --source-revision e440712 --json-out work/normal-all-in-audit-2026-08-21.json --markdown-out work/normal-all-in-audit-2026-08-21.md

Machine-readable event-level evidence, stack/equity/EV context, Wilson
intervals, legality fields, and source hashes are saved in
work/normal-all-in-audit-2026-08-21.json; the CLI-generated summary is in
work/normal-all-in-audit-2026-08-21.md.

## Measured result

| Clock | Tournaments | Hands | All-in hands | Preflop | Postflop | Verified violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen | 8 | 1,475 | 7 | 0/1,475 (0.00%) | 7/1,475 (0.47%) | 0 |
| Live | 8 | 372 | 10 | 5/372 (1.34%) | 5/372 (1.34%) | 0 |

Frozen release-gate comparison: preflop 0.00% <= 10.00% PASS; postflop
0.47% <= 20.00% PASS. Frozen all-ins were distributed across flop (5), turn
(1), and river (1), with 3 in the 0-5 BB effective-stack band, 1 in
>12-40 BB, and 3 in >80 BB; one used personality deviation. Live-clock
all-ins were also legal and postcondition-clean, but the accelerated replay
ended after 372 hands and is context rather than the release-gate denominator.

This audit is read-only and uses the production Normal-mode session/policy
adapters. No bot behavior or policy source was changed.
