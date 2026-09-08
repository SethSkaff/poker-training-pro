# T1–T15 task receipts

This is the task-level handoff index. Checkpoint receipts contain the exact focused commands and exit evidence; the all-task fixture writes the machine-readable counterpart under `all-task-conformance.json`.

| Task | Acceptance | Executable owner | Checkpoint | Evidence boundary |
| --- | --- | --- | --- | --- |
| T1 | A01 | `manifest.ts`, `artifactStore.ts` | C1 | Reproducible immutable artifacts; no baseline overwrite |
| T2 | A02 | `decisionEvent.ts`, `stratification.ts`, `src/lib/actionSupport.ts` | C1 | Canonical semantics/support; scoped observer-safe projection |
| T3 | A03 | `opportunities.ts`, `metricRegistry.ts` | C1 | Player-hand and facing-cost denominators; retired legacy quotas |
| T4 | A04 | `scenarios.ts`, `scenarioTransforms.ts`, `scenarioBank.ts` | C2 | Reachable 120-node bank and family split; 300/10,000 capability |
| T5 | A05 | `sessionRunner.ts`, `policyAdapter.ts`, `sampling.ts` | C2 | Production-adapter capture and full-field evaluation scope |
| T6 | A06 | `statistics.ts`, `metrics.ts`, `comparison.ts`, `report.ts` | C2 | Clustered conditional report; sparse/null coverage remains visible |
| T7 | A07 | `referenceValues.ts`, `referenceCases.ts` | C3 | Independent finite reference values and exact known answers |
| T8 | A08 | `handReviewPrototype.ts`, `reviewPrototypeRunner.ts`, `reviewEvidence.ts` | C3 | Offline regret/support prototype; no UI/guard adoption |
| T9 | A09 | `wagerCandidates.ts`, `wagerReport.ts` | C3 | Offline denomination menu; exact engine-derived amounts preserved |
| T10 | A10 | `criticContracts.ts`, `criticInput.ts`, `criticAdapter.ts` | C4 | Blinded mock/explicit adapter; no network default or authority |
| T11 | A11 | `reviewerPilot.ts`, `reviewerValidation.ts` | C4 | 200-slot manifest, 40-case selection, transformations, pending promotion |
| T12 | A12 | `normal.ts`, `personalities.ts`, `personalityReport.ts`, `timingReport.ts` | C4 | Actual Normal probabilities; descriptive style/timing diagnostics |
| T13 | A13 | `observerHistory.ts` | C5 | Versioned offline observer history and Dirichlet beliefs |
| T14 | A14 | `adaptationExperiment.ts` | C5 | Paired finite public-likelihood adaptation; no live learning |
| T15 | A15 | `run.ts`, `verifyEvidence.ts`, `baselines.ts`, `acceptanceIndex.ts` | C6 | CLI, fixture conformance, immutable baselines, release verifier |

All infrastructure statuses are complete after C6. Human labels, external reviewer results, approved tolerances, range calibration, external timing observations, and live adoption remain pending by design.
