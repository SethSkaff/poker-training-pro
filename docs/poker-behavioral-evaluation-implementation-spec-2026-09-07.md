# Poker behavioral evaluation implementation contract

Date: 2026-09-07. Governing methodology: [approved design](poker-behavioral-evaluation-design-2026-09-05.md). Intended executor: GPT-5.6 Luna High. This document specifies implementation of **all T1–T15**, not a policy rebalance. MUST/MUST NOT are acceptance requirements; proposed new module names below are deliberate allocations, not claims that those modules already exist.

## 1. Scope, completion and fixed architectural decisions

Implement the infrastructure, prototypes, tests and commands for all fifteen tasks. Run the deterministic acceptance experiments and bounded pilot dry runs. External expert labels, model credentials, approved grading tolerances and large-run compute are **evidence inputs**, not things to fabricate. Their absence must produce a working report marked pending/unsupported; it does not justify abandoning later implementation tasks. Implemented infrastructure is not equivalent to validated poker methodology or approval to change live strategy.

T8 delivers a callable, tested **Game Review v2 evidence prototype** and a UI-facing DTO. It does not switch `deriveHandReview` or `HandReviewScreen` to the new evaluator by default. That preserves the approved design's explicit prototype-first scope. T9 delivers offline candidate comparisons, not new live wager rounding. T13–T14 deliver observer histories and offline adaptation experiments, not persistent live learning. T11 implements and exercises the pilot; it cannot manufacture qualified human review or promote itself to validated. These are completed tasks when their interfaces, commands, tests and truthful pending-evidence reports work end to end.

All production strategy, default session behavior, replay commands, seed derivations and wager selection MUST remain unchanged. Additive source telemetry and narrowly specified shared pure functions are allowed. The only alternate lifecycle is an explicitly requested full-field evaluation scope, never the production default. Instrumentation MUST NOT consume RNG draws or use elapsed time to select actions.

No new Python service, database, framework, solver dependency, cloud service, or live LLM integration is required. Use existing TypeScript, Vitest, Node built-ins, `vite-node`, seeded engine and pot/evaluator functions. Keep offline IO/network under `scripts/`. Shared source modules are pure, browser-compatible and must not import `scripts/`, Node APIs, manifests, baselines, critic verdicts or full-truth files. The UI prototype accepts an injected value-provider port; it does not load an offline provider from shipped code.

### Repository inspection boundary

Inspected local `main` at `10952e3ae1ee7c87ab4d1632e36338bc20bd2955`; the original design is now tracked. Existing unrelated modifications: `src/components/BlackjackTrainer.css` and `src/components/BlackjackTrainer.tsx`. Preserve them. This specification does not re-run the old audits or imply new statistical results. The September 5 design's dirty-tree and prior HEAD statements remain historical, not the current checkout state.

Concrete constraints verified here:

* Settlement lives in `src/engine/pots.ts`, **not** `src/engine/settlement.ts`.
* `BettingActionResult.event` already contains committed chips, total target, previous/current bet, full-raise, short-all-in and all-in facts. Reuse it.
* `NormalDecision` has no action distribution; Rational's distribution is not Normal's executed distribution.
* `beginTournamentSessionHand` rejects completed sessions, and settlement completes a session at hero placement. Full-field evaluation needs the explicit lifecycle seam in T5.
* `HandActionRecord` lacks pre-action pot, street, legal bounds and complete action semantics. Those cannot be reconstructed reliably from `amount` alone; collect them at the transition boundary.
* `EquityResponseSample` contains rank percentiles and showdown comparisons, not complete payoff trajectories or opponent cards. It cannot be relabeled as a general paired action-EV sample.
* `tsconfig.json` includes `src` and `vite.config.ts`, not all script modules. Vitest includes `scripts/**/*.test.ts`; `.test.mjs` uses Node's test runner.
* Current session hands post only blinds; they intentionally ignore configured antes. Preserve that behavior and record `anteAppliedChips: 0`; nonzero-ante coverage is unsupported unless the actual engine-driven scenario supports it. Do not fix ante policy as a side effect.

## 2. Exact dependency graph and execution order

Dependencies below are direct edges. Shared types can be declared early with later producers returning `unavailable`; do not import a later producer merely to define a type. Within each task finish its tests before advancing. Independent means independently implementable **after** prerequisites, not permission to launch separate agents.

| Task | Direct prerequisites | Direct dependents | Change class | Independent / integration requirement |
|---|---|---|---|---|
| T1 Evidence manifest | — | T2, T4, T5 | Tooling | Yes; establishes artifact identity before producers. |
| T2 Semantic action/geometry record | T1 | T3, T4, T5, T7, T8, T9, T10, T13 | Measurement + pure source adapter | Yes; all later consumers must share its semantics. |
| T3 Correct counters/gate registry | T2 | T5, T6, T15 | Measurement/tests/tooling | Yes; legacy compatibility remains until T15 integration. |
| T4 Common-state bank/holdout split | T1, T2 | T6, T7, T12 | Tooling/tests | Yes; scenario provenance and families fixed before scoring. |
| T5 Interactive capture/sampling | T1, T2, T3 | T6, T10, T13 | Measurement; default-preserving lifecycle seam | Yes; integrate both existing behavior and critic recording. |
| T6 Conditional statistical report | T3, T4, T5 | T11, T12, T14, T15 | Measurement/tooling | Yes; implements generic aggregate/cluster statistics. |
| T7 Independent value adapter | T2, T4 | T8, T9, T11, T12, T14 | Offline reference + source telemetry | Yes; no import from T8/T9; accepts explicit legal menus. |
| T8 Game Review evidence prototype | T2, T7 | T15 | Pure prototype/source types/tests | Yes; consumes provider port, does not adopt live UI. |
| T9 Denomination reference expansion | T2, T7 | T15 | Offline measurement | Yes; imports T7 port, not T8 implementation. |
| T10 Blinded critic adapter | T2, T5 | T11 | Development tooling | Yes; validation status initially unvalidated. |
| T11 Reviewer validation pilot | T6, T7, T10 | T15 | Tooling/experimental evaluation | Yes; T6 is an explicit addition for grouped statistics. |
| T12 Personality report | T4, T6, T7 | T15 | Measurement; default-preserving Normal telemetry | Yes; integrate exact Normal distribution extraction. |
| T13 Adaptation evidence contract | T2, T5 | T14 | Offline measurement/prototype | Yes; no live observer history wiring. |
| T14 Adaptation experiment | T6, T7, T13 | T15 | Offline experiment | Yes; prior/config inputs explicit; no live learning. |
| T15 CI/release integration | T3, T6, T8, T9, T11, T12, T14 | — | Tooling/tests | Integration task; transitively requires all earlier tasks. |

**Exact order:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15. All direct prerequisites precede their consumers. Do not use T9's expanded candidate generator as a prerequisite for T7; T7 accepts hand-authored legal action arrays. T8 constructs its own search via its specified port. T11 uses T6 statistics, resolving an implicit dependency in the methodology.

Checkpoint groups are C1=T1–T3, C2=T4–T6, C3=T7–T9, C4=T10–T12, C5=T13–T14, C6=T15. Continue automatically after success.

## 3. Repository and module ownership map

### Existing files and symbols: reuse, do not duplicate

| Existing path | Verified symbols / role | Authorized use |
|---|---|---|
| `src/engine/betting.ts` | `BettingRoundState`, `LegalActionSet`, `BettingActionCommand`, `BettingActionResult`, `getLegalActions`, `applyBettingAction`, `isStackOffCommand`, `assertBettingStateInvariant`, private `raisingReopenedFor` | Authoritative legal transitions. May export the unchanged read-only reopening helper; do not copy or alter its logic. |
| `src/engine/pots.ts` | `buildPots`, `buildLivePots`, `resolvePots`, `ContestablePot`, `PotRefund` | Pot eligibility, refunds, settlement; independent arithmetic fixtures verify them. |
| `src/engine/deck.ts` | `DeckSeed`, `deriveSeed`, `createSeededRandom`, `createDeck`, `createShuffledDeck`, `cardKey`, `assertUniqueCards` | Reproduction and deterministic card machinery, unchanged live streams. |
| `src/engine/evaluator.ts` | `evaluateBestHand`, `compareHandValues`, `HAND_CATEGORY` | Exact hand comparisons; do not create another hand evaluator. |
| `src/engine/tournament.ts` | `PlayerInformationSet`, `HandActionRecord`, `HandInformationSource`, `createInformationSet`, `TournamentStructure`, `currentBlindLevel`, `recordEliminations`, `CAREER_EVENTS` | Actor redaction, structures and tournament facts. Do not add telemetry/truth fields to public information sets. |
| `src/lib/playerCountSemantics.ts` | `derivePlayerCountSemantics`, `assertPlayerCountSemantics`, `isActiveInHand`, `opponentsAbleToRespond` | Existing count/response semantics; new fields compose these types. |
| `src/modes/rational.ts` | `RationalPolicyInput`, `RationalDecision`, `RationalActionOption`, `RationalActionResponseAudit`, `RationalWagerSizingAudit`, `EquityResponseSample`, `decideRationalAction`, `decideRationalActionAsync`, `estimateRangeEquity`, `responseForCandidate`, `scoreCandidates`, `buildCandidates`, `quantizeWager`, `evaluateCallActionEv`, `evaluateRaiseBranchEv`, exposure/reopening penalties | Add value/support telemetry at existing calculations. Keep numerical operations/order, candidates, random draws and defaults. Its utility is a comparator, never independent reference truth. |
| `src/modes/normal.ts` | `NORMAL_OPPONENT_PROFILES`, `NormalOpponentProfile`, `NormalPersonalityVector`, `NormalDecision`, `NormalDecisionInput`, `PublicOpponentHistory`, `derivePublicExploitSignals`, `decideNormalAction`, `candidateWeight`, `weightedChoice`, `publicDecisionSeed` | Read profile contracts; expose selection probabilities through shared pure preparation without changing selection. Do not repair/tune existing adaptation here. |
| `src/modes/tournamentSession.ts` | `TournamentSession`, `SessionHandState`, `SessionPolicyDecision`, `SessionPolicyOptions`, `NormalProfileKey`, `createTournamentSession`, `beginTournamentSessionHand`, `applyTournamentSessionAction`, `progressTournamentSessionHand`, `settleTournamentSessionHand`, `chooseTournamentSessionPolicyAction` and async counterpart, `sessionPolicyContext`, `assembleSessionPolicyDecision`, `tournamentPolicyContextForSession` | Shared production adapter and explicit full-field lifecycle extension; otherwise production defaults preserved. |
| `src/modes/tournamentRunner.ts` | `TournamentRunnerReplay`, `CURRENT_ENGINE_VERSION`, `CURRENT_CONTENT_VERSION`, `CURRENT_POLICY_VERSION`, `createTournamentRunnerReplay`, `restoreTournamentRunnerReplay`, `tournamentCommandForHeroAction` | Preserve replay format/version semantics and exact user command resolution. Export unchanged command resolver only if prototype requires it and it is not already exported. |
| `src/modes/handReview.ts` | `ReviewMath`, `ReviewDecision`, `HandReview`, `DeriveHandReviewOptions`, `canonicalReviewResult`, `deriveHandReview`, `qualityFor`, `assertReviewIsRedacted` | Reuse replay traversal via an extracted common iterator; old DTO/entry point unchanged. New prototype cannot use old uncertainty discount/nearest-match fallback. |
| `src/modes/botLeague.ts` | `runBotLeague`, `serializeBotLeagueReport`, `BOT_LEAGUE_HARNESS_VERSION`, `BOT_LEAGUE_BASELINE_ID`, private `matrixFixtures`, `normalEvaluations`, `normalProfileReport`, `timingLeakageReport` | Retain legacy report; share adapters where needed. New reachable scenarios must not masquerade as the old handcrafted matrix. |
| `scripts/measure-ai-behavior.ts`, `scripts/report-ai-behavior.ts` | `measureAiBehavior`, `AiBehaviorMetrics`, `AiBehaviorEventTimeline`, `summarizeEventTimelines`, `playEvent` | Add v2 producer/output and move repeated capture into shared evaluation runner; retain labeled legacy output. |
| `scripts/normal-all-in-audit.ts`, `scripts/report-normal-all-in-audit.ts` | Existing semantic all-in audit/CLI | Consume canonical flags; preserve postcondition checking. |
| `scripts/measure-exploitability.ts`, `scripts/report-exploitability.ts` | `ScriptedStrategy`, `SCRIPTED_STRATEGIES`, `measureExploitability`, `ExploitabilityMetrics` | Reuse scripted strategies through an adapter; new paired/context-aware strategy port is offline. |
| `scripts/critic-harness.ts`, `scripts/report-critic-harness.ts` | `PublicHandHistory`, `PublicHistoryAction`, `SampledHand`, `CriticClient`, `CriticVerdict`, `CriticReport`, `playPublicHands`, `sampleHands`, `assertNoHiddenCards`, `renderHandHistory`, `heuristicCritic`, `httpCritic`, `runCriticHarness` | Extend existing harness with a v2 adapter; keep legacy public-only validator strict and offline default. |
| `scripts/audit-ai-behavior-gates.ts`, `scripts/audit-exploitability-gates.ts` | `BOUNDS`, `check`, script entry points | Migrate unsupported judgments to explicit retired diagnostics; no substitute quotas. |
| `scripts/release/release-stages.mjs`, `scripts/release/run-release-verification.mjs`, `scripts/release/release-stages.test.ts` | `stages` and existing release execution | Integrate T15 artifact verifier; every named stage must exist. |
| `package.json`, `tsconfig.json`, `scripts/vite-node.config.mjs`, `vite.config.ts` | Existing npm commands, headless runner, strict TS/Vitest configuration | Add named evaluation scripts and tooling TS project; do not exclude evaluation tests for speed. |

Before coding, recheck these files for concurrent changes. A missing/renamed symbol is constrained integration discretion: find its actual owner, retain its contract and record the mapping change. Do not invent a second engine to avoid integration.

### New allocations (verified absent at planning time)

Create **new** pure shared `src/lib/pokerActionSemantics.ts` (T2), `src/modes/reviewEvidence.ts` (T7–T8 types/math), `src/modes/handReviewPrototype.ts` (T8), and if needed `src/modes/handReviewReplay.ts` (T8 shared traversal). Source modules must be production-safe even when only offline callers use them.

Create **new** `scripts/evaluation/` modules with one owner each:

| Task | New files, relative to `scripts/evaluation/` | Public entry points to provide |
|---|---|---|
| T1 | `contracts.ts`, `manifest.ts`, `artifactStore.ts` | `createRunManifest`, `hashCanonicalJson`, `writeImmutableArtifact`, `verifyArtifact` |
| T2 | `decisionEvent.ts`, `stratification.ts` | `captureDecisionBefore`, `completeDecisionEvent`, `stratifyDecision` |
| T3 | `opportunities.ts`, `metricRegistry.ts` | `emitHandOpportunities`, `emitDecisionOpportunities`, `reduceOpportunities`, `evaluateMetricAuthority` |
| T4 | `scenarios.ts`, `scenarioTransforms.ts`, `scenarioBank.ts` | `buildReachableScenario`, `applyScenarioTransform`, `assignFamilySplit`, `loadScenarioBank` |
| T5 | `sessionRunner.ts`, `policyAdapter.ts`, `sampling.ts` | `runEvaluationSession`, `evaluatePolicyAtNode`, `selectReviewSamples` |
| T6 | `statistics.ts`, `metrics.ts`, `comparison.ts`, `report.ts` | `clusterBootstrap`, `aggregateBehavior`, `compareRuns`, `renderEvaluationReport` |
| T7 | `referenceValues.ts`, `referenceCases.ts` | `evaluateReferenceMenu`, `loadReferenceCase`, `comparePolicyValues` |
| T8 | `reviewPrototypeRunner.ts` | `runReviewPrototype` (injected offline provider; no UI dependency) |
| T9 | `wagerCandidates.ts`, `wagerReport.ts` | `generateWagerReferenceMenu`, `compareWagerMenus` |
| T10 | `criticContracts.ts`, `criticInput.ts`, `criticAdapter.ts` | `buildBlindedCriticInput`, `validateCriticOutput`, `runCriticBatch` |
| T11 | `reviewerPilot.ts`, `reviewerValidation.ts` | `buildPilotManifest`, `scoreReviewerPilot`, `validateReviewerPromotion` |
| T12 | `personalities.ts`, `personalityReport.ts`, `timingReport.ts` | `buildStyleContracts`, `comparePersonalities`, `evaluateTimingPredictability` |
| T13 | `observerHistory.ts` | `observePublicEvent`, `snapshotOpponentBeliefs` |
| T14 | `adaptationExperiment.ts` | `runAdaptationExperiment` |
| T15 | `run.ts`, `verifyEvidence.ts` | CLI dispatcher and release evidence verifier |

Use adjacent `.test.ts` files for these modules, with test IDs from section 15. Split private helpers only where readability requires it; keep public ownership above. Add **new** `tsconfig.evaluation.json`, extending root strict settings and including `scripts/evaluation/**/*.ts`, the adapted headless scripts and required source imports, with Node types. `npm run build` alone cannot certify script types.

Allocate **new tracked data** at `scripts/evaluation/fixtures/` (small exact cases, mock reviewers, tiny banks), `scripts/evaluation/banks/` (family manifests), `scripts/evaluation/baselines/` (immutable approved summaries), and `scripts/evaluation/config/` (versioned run/registry/pilot/tolerance templates). Large outputs go to existing ignored `work/behavior-evaluation/<runId>/`; no change to ignored user/build paths. Empty templates must say `pending`, not pretend to be approved evidence.

## 4. Canonical data contracts

These are interface contracts, not pseudocode instructions to duplicate existing engine types. `Chips` means nonnegative safe integer except signed value/adjustment fields; `BB`, probabilities and ratios are finite numbers. Use JSON `null` for known missing/not-applicable values; never NaN, Infinity, absent-as-zero, or an unexplained empty array. TypeScript optional fields are allowed only where explicitly stated. All wire objects reject unknown schema versions and validate at IO boundaries.

### 4.1 Shared primitives and provenance (T1)

```ts
type SchemaVersion = 1;
type Hash = string; // lowercase SHA-256 hex; not engine hashSeed
interface ArtifactRef { relativePath: string; sha256: Hash; bytes: number }
type Maybe<T> =
  | { value: T; reason: null }
  | { value: null; reason: string }; // versioned reason-code vocabulary
type Split = "development" | "calibration" | "holdout";
type RunStatus = "complete" | "budget_exhausted" | "cancelled" | "invalid";
interface PolicyIdentity {
  id: Hash; // hash of the remaining identity fields
  mode: "normal" | "rational" | "scripted" | "experimental";
  policyVersion: string; engineVersion: string; contentVersion: string;
  sourceTreeHash: Hash; parameterHash: Hash;
  profileKey: string | null; profileId: string | null;
  profileHash: Hash | null; adapterVersion: string;
}
interface Reproduction {
  manifestHash: Hash; scenarioId: string | null; familyId: string;
  blockId: string; sessionId: string; handId: string;
  handNumber: number; decisionIndex: number; streetActionIndex: number;
  initialStateRef: ArtifactRef; prefixRef: ArtifactRef;
  sourceSnapshotRef: ArtifactRef; stateHash: Hash;
  masterSeed: string; dealSeed: string; equitySeed: string;
  actionSeed: string; samplingSeed: string;
  seedStreamVersion: string; rolloutReplicate: number;
  policy: PolicyIdentity; simulations: number; temperature: number | null;
}
```

`decisionIndex` and `streetActionIndex` are zero-based voluntary decision ordinals; forced bets/dealer events have their own sequence index. `handNumber` is the existing one-based table hand counter. `blockId` identifies the independent master-seed block and is shared by seat rotations/paired versions. IDs needed to reproduce live policy are retained internally, never shown to the critic.

`RunManifest` required fields: `schemaVersion`, `runId` (hash of deterministic identity payload), `harnessVersion`, `semanticsVersion`, `registryVersion`, `commandArgv` (array), `gitHead`, `branch`, `dirty`, `sourceTreeHash`, `sourceFiles` (path/hash list), `diffRef` nullable, `untrackedSourceRefs`, `lockfileHash`, `runtime` (Node/npm/platform/arch), `policies`, `experiment` (common-state/natural/fixed-stack/adaptation/reviewer), `scope` (hero/full-field), `clock` (frozen/nominal-live), `objective` (chip/payout/qualification), `bankRef`, `split`, `seeds`, `budgets`, `baselineRef` nullable, and `samplingConfigRef`. Run receipt separately stores timestamp, machine timing, status, reason, actual counts, cost and output checksums; timestamps MUST NOT change deterministic run identity.

Snapshot source includes tracked execution/config files, staged and unstaged diffs against HEAD and explicitly selected untracked source needed to reproduce. Exclude `.env`, credentials, `node_modules`, `.git`, build/work artifacts and unrelated user files from exported bundles. Hash the full declared relevant source set, not just the version string. Manifest creation is read-only; never stages, commits or stashes files. A reference to HEAD without dirty content is not a reproducible dirty run.

### 4.2 Canonical action and geometry (T2)

```ts
interface CanonicalAction {
  key: string; // context-local transition identity, see section 5
  kind: "fold" | "check" | "call" | "bet" | "raise";
  rawCommand: BettingActionCommand;
  targetChips: number; investedChips: number;
  raisesCurrentBet: boolean; raiseByChips: number;
  isActorAllIn: boolean;
  stackOffClass: "none" | "aggressive_jam" | "all_in_call";
  isFullRaise: boolean; isShortAllInIncrease: boolean;
  newlyReopenedPlayerIds: string[];
}
interface OpponentExposure {
  opponentId: string;
  status: "active" | "all-in";
  remainingStackChips: number; streetCommittedChips: number;
  futureMatchedChips: number; // min(actor remaining, opponent remaining)
  contestableAdditionalChips: number; // actor's additional chips matchable by this opponent
  callableAtTargetChips: number;
  facingAdditionalCost: boolean;
  canMakeDecisionAtTarget: boolean;
}
interface WagerGeometry {
  bigBlindChips: number; smallestChipChips: number;
  configuredAnteChips: number; anteAppliedChips: number;
  potAtDecisionChips: number; potAtStreetStartChips: Maybe<number>;
  actorStackChips: number; actorStreetCommittedChips: number;
  currentBetChips: number; outstandingCallChips: number;
  actualCallChips: number; potAfterActorCallChips: number;
  targetChips: number; investedChips: number; raiseByChips: number;
  callCostOverCurrentPot: Maybe<number>;
  previousAggression: Maybe<{
    decisionId: string; potBeforeChips: number; investedChips: number;
    previousBetChips: number; targetChips: number;
    investedOverPot: Maybe<number>; raiseOverPotAfterCall: Maybe<number>;
  }>;
  investmentOverCurrentPot: Maybe<number>;
  raiseOverPotAfterCall: Maybe<number>;
  actorCommitmentFraction: number;
  opponents: OpponentExposure[];
  minPositiveFutureMatchedChips: Maybe<number>;
  maxFutureMatchedChips: Maybe<number>;
  decisionMinSpr: Maybe<number>; decisionMaxSpr: Maybe<number>;
  streetStartMinSpr: Maybe<number>; streetStartMaxSpr: Maybe<number>;
  livePots: ContestablePot[]; currentlyUnmatched: PotRefund[];
  actualSettlementRefundChips: Maybe<number>;
}
```

Source pure adapter exports `canonicalizeBettingAction(preState, command)` and `computeWagerGeometry(context, canonicalAction)`. Obtain validity and transition through `applyBettingAction` on its existing nonmutating path; project `key` as stable JSON of the resulting actor commitment/status, current bet, last full raise, last-acted commitments, pending order and hand/round completion, excluding raw command label and irrelevant names. Sort record keys, retain action-order arrays. The scripts adapter hashes this string for event/execution artifact IDs; the source adapter returns the string, not a SHA-256 claim. Never make a browser import Node crypto.

`futureMatchedChips` reproduces remaining-stack comparisons such as Wesley's 24,775. `contestableAdditionalChips = max(0,min(actorStack, opponentStreetCommitted + opponentStack - actorStreetCommitted))`; it incorporates unequal existing street commitments. Neither is a multiway pot value. `callableAtTargetChips = min(opponentStack,max(0,target-opponentStreetCommitted))`. Already all-in opponents have zero future call capacity but retain pot eligibility. Folded/out players are excluded from exposure vector, retained in pot contribution ledger. `actualSettlementRefundChips` stays null/pending until settlement, even if some current unmatched money could later be called.

### 4.3 Events, strata and policy telemetry (T2–T5)

`BehavioralDecisionEvent` required fields: version/semanticsVersion; `decisionId`; `reproduction`; `policy`; `preState` (`BettingRoundState`, internal only); `actorView` (`PlayerInformationSet`); `strata`; `legal` (`LegalActionSet`); `candidates` (array below); `chosen` (`CanonicalAction`); `geometry`; `postcondition` (`pass|fail`, independent reconciliation errors, execution hash); `opportunityIds`; `traceRef`. Candidate-only common-state evaluations set `execution: "counterfactual"` and `postcondition` checks a copied transition; real records use `execution: "observed"`. Never pretend a sampled candidate was executed in the population experiment.

`captureDecisionBefore` returns a `PendingDecisionFrame` containing the prestate/identity/strata/legal fields and pending opportunities only. `completeDecisionEvent` constructs the finalized event after a selected legal transition. Cancellation/throw before selection writes a separate failure/pending receipt referencing that frame, not a fabricated event with chosen action null or a default fold. Subsequent hand settlement records supplement events by ID without mutating sealed decision data.

`CandidateTelemetry`: `action`, `geometry`, `selectionProbability: Maybe<number>`, `probabilitySource: "rational"|"normal"|"scripted"|"unavailable"`, `policyUtilityBb: Maybe<number>`, `valueComponents: Maybe<PolicyValueComponents>`, `responseSupport: Maybe<ResponseSupport>`, `sizing: RationalWagerSizingAudit|null`. `PolicyValueComponents` has signed raw chip value and nonnegative charge fields: `baseChipEv`, `reopenChargeChips`, `tournamentChargeChips`, `exposureChargeChips`, `finalUtilityChips`, plus modelVersion. Preserve signs if a current implementation legitimately uses a signed adjustment; name/document it instead of clamping. These are produced at existing calculations, not back-solved from final utility.

Extend `RationalActionResponseAudit` with additive `sampleCounts: {allFold:number; call:number; reRaise:number}`, `conditionalSamples: {call:number; reRaise:number}`, and `emptyBranchFallback: {call:boolean; reRaise:boolean}`. Never replace its corrected conditional ratios. `ResponseSupport` copies these counts plus `simulations`, `estimatorVersion`, `weightedEss: Maybe<number>`, `confidenceBasis: "sampled_branch"|"empty_branch_fallback"|"exact_reference"`. Binomial counts are exact integers, not rounded `probability*N` reconstructions.

`DecisionStrata` required fields: `street` (existing `Street`); `counts` (`PlayerCountSemantics`); `playersAbleToAct`; `contestants` (`heads_up|multiway|uncontested`); `actorSeat`, `buttonSeat`, `actorRelativeSeat`, `actorDecisionOrder`; `positionVsResponders` (`in|out|mixed|none`); `actorDepthBb`; pairwise depth/SPR summaries from geometry; `depthBin`, `sprBin`; `facing` (`none|small|medium|large|overbet|unknown`); `facingJam`; `potType` (`unopened|limped|single_raised|three_bet|four_bet_plus|unknown`); `fullPreflopRaises`, `shortPreflopIncreases`; `board` features (section 5); `actorHandFeatures: Maybe<...>`; `tournamentStage` (`early|middle|late|bubble|unknown`, definition config ref); `qualificationDistance: Maybe<number>`; `tournamentPressure: Maybe<number>` labeled heuristic; `modelSupportCodes: string[]`. Profile is in `PolicyIdentity`, not a redundant freely typed name field.

Mode/profile distinction: Normal key is the existing `NormalProfileKey`: `anchor`, `tempo`, `pressure`, `mirror`, `wideLens`; profile IDs are respectively `anchor`, `tempo`, `pressure`, `mirror`, `wide-lens`. Resolve from `NORMAL_OPPONENT_PROFILES`, never convert by guessing punctuation. Rational profile fields are null. Scripted ID is its strategy ID in `policyVersion`/parameter record, not a Normal profile.

`OpportunityEvent`: version, `id`, `blockId`, `sessionId`, `handId`, `actorId`, `decisionId: string|null`, `kind` (`dealt_hand|facing_bet|raise_available_facing_bet|three_bet|four_bet|voluntary_entry|preflop_raise`), `eligible: boolean`, `eligibilityReason`, `outcome: "pending"|"yes"|"no"`, `strataRef`. Hand-level rows finalize at preflop end/hand termination. Decision rows finalize with exactly one legal applied action. A failed/cancelled pre-action record remains pending and never becomes a “no.” Deduplication is by semantic ID, not array position.

### 4.4 Metrics, comparisons and findings (T3/T6)

```ts
interface Interval {
  lower: number; upper: number; level: number;
  method: "exact" | "wilson" | "zero_event_exact" |
    "cluster_bootstrap_percentile" | "paired_hoeffding";
  independentUnit: "block" | "base_case" | "scenario_family" | "iid_draw";
}
interface MetricResult {
  schemaVersion: 1; metricId: string; definitionVersion: string;
  runId: string; policyId: string; sliceId: string;
  estimand: string; unit: "proportion"|"BB"|"chips"|"count"|"hands"|"ms"|"bits";
  numerator: number | null; denominator: number | null;
  estimate: Maybe<number>; interval: Maybe<Interval>;
  distinctDecisions: number; distinctHands: number; independentBlocks: number;
  effectiveN: Maybe<number>; missingCount: number; pendingCount: number;
  coverage: "adequate"|"sparse"|"unvisited"|"impossible"|"invalid";
  authority: "contract"|"diagnostic"|"approved_regression"|"retired";
  status: "pass"|"regression"|"insufficient_evidence"|"invalid_run"|
    "unsupported_reference"|"diagnostic_only";
  registryRef: ArtifactRef; supportingEventRefs: ArtifactRef[];
}
interface BaselineComparison {
  schemaVersion: 1; baselineRef: ArtifactRef; candidateRunId: string;
  comparability: "matched"|"descriptive_only"|"incompatible";
  reasons: string[]; matchedBlockIds: string[]; missingPairIds: string[];
  metricId: string; sliceId: string;
  deltaCandidateMinusBaseline: Maybe<number>; interval: Maybe<Interval>;
  practicalMargin: Maybe<number>; marginEvidenceRef: ArtifactRef|null;
  multiplicityFamilyId: string|null; status: MetricResult["status"];
}
interface FlaggedCase {
  schemaVersion: 1; flagId: string; detectorId: string; detectorVersion: string;
  decisionIds: string[]; familyId: string; reproduction: Reproduction;
  measurements: Record<string, number|null>;
  reasonCodes: string[]; missingEvidence: string[];
  priority: "low"|"medium"|"high"|"critical";
  findingState: "candidate"|"reproduced"|"supported"|"unresolved"|
    "rejected"|"intervention_tested"|"resolved";
  samplingStreams: string[]; inclusionProbability: Maybe<number>;
  evidenceRefs: ArtifactRef[];
}
```

Flags are not truth labels; critical is reserved for independently reconciled contract failure. `supportingEventRefs` can point to a compact ID-list artifact instead of copying entire histories. `effectiveN` is null for clustered data unless an identified estimator supplies it; raw decision count is not effective N. Scalar reports also persist quantiles/ECDF counts in an attached distribution artifact where requested.

### 4.5 Reviewer IO and validation (T10–T11)

Use a discriminated `ReviewerInputV2`, separate from `PublicHandHistory`. Common required fields: `schemaVersion`, opaque `caseId`, `task`, `rules` (holdem/no-limit, actual forced bets, rack/medium, objective), `publicTimeline` with street-appropriate boards, `selectedAction`, `legalActions` (canonical), raw and normalized `geometry`. No `Reproduction`, source paths, policy/model names, flags, truth hashes or seed. Stable aliases `P1`…`P6` replace player IDs and names consistently within a bundle.

* `task: "decision"`: current actor alias, exactly actor's two cards, decision-boundary board, action prefix and observer-visible tendency summary with counts. No style description.
* `task: "session_public"`: bundle of public prefixes/hand sequences, no private cards and no final winnings/outcome fields; later actions are permissible only for evaluating the chronological pattern as a whole, never to grade an earlier node. Strategic assessment must be `insufficient`.
* `task: "style"`: same public bundle plus anonymized behavioral `styleDescription`; no original key/ID/vector numbers. Requires a locked earlier unlabeled bundle verdict reference stored outside model input.
* `task: "diagnosis"`: actor-view decision plus selected verified ranges/decomposed values/support evidence. Requires locked initial verdict ID; store as a new phase, never overwrite initial verdict. Outcome remains hidden; full-truth settlement audit is a different tool.

`ReviewerOutputV2` required: `caseId`, `assessments` with `strategicPlausibility: concern|plausible|insufficient`, `wagerNumberPlausibility: concern|plausible|not_applicable|insufficient`, `styleConsistency: concern|consistent|not_provided|insufficient`; `findings[]`; `missingInformation[]`; `inputContradictions[]`. Each finding requires `category` from versioned enum (`unsupported_stack_exposure`, `escalation_pattern`, `candidate_magnitude`, `denomination_pattern`, `missed_value_hypothesis`, `passive_defense_hypothesis`, `style_mismatch`, `input_inconsistency`, `other_hypothesis`), `priority: low|medium|high`, resolvable JSON Pointer `evidencePaths[]`, factual `claim`, `possibleJustification`, `requestedCheck`, `confidence: low|medium|high`. `other_hypothesis` is retained descriptively and not aggregated into a new validated category automatically.

Malformed enums, wrong case IDs, nonresolving evidence pointers and contradictory phase fields yield `invalid_response`, never `plausible`. Allow one configured schema-repair retry, recording both responses; no endless retries until a preferred verdict. Per-dimension abstention is valid data. Empty findings with `concern` is invalid; insufficient must name missing evidence. Claims may be wrong even with valid pointers: schema validity is not reviewer accuracy.

`ReviewerRunReceipt`: reviewer identity/version, prompt/schema/input hashes, cache mode, decoder settings, endpoint category (local/remote/mock), requested/actual tokens, elapsed/cost with nullable unknown cost, transport errors and immutable response refs. Secrets and raw endpoint credentials never enter receipts. `ReviewerValidationResult`: version, reviewer/prompt fingerprint, pilot/family split refs, base-case count, transformation/repeat counts, per-category confusion tables, precision/recall with intervals, abstention/coverage, high-priority false positives, factual-error counts, consistency pairs, confidence buckets, human rater/adjudication refs, incremental yield/time/cost, missing evidence, status and promotion record ref. Every ratio preserves its numerator/denominator and nulls when undefined.

### 4.6 Game Review evidence DTO (T7–T8)

Do not widen existing numeric fields into null and break current consumers. Define separate `ReviewDecisionEvidenceV2` in `src/modes/reviewEvidence.ts`; `handReviewPrototype.ts` returns an envelope keyed by existing review decision index/hand ID. An optional association in legacy `ReviewDecision` is permitted only if no caller depends on it; adoption is outside this project.

Required v2 fields:

| Field | Type / units / meaning |
|---|---|
| `schemaVersion`, `semanticsVersion`, `decisionId`, `handId`, `index` | Identifiers; zero-based index into replay decisions |
| `objective` | `chip_ev`, `payout_ev`, or `qualification_probability`; unsupported objectives never silently become chip EV |
| `playedAction` | Canonical legal action, exact amount |
| `bestSampledAction` | Canonical action or null if unsupported; a sample maximum, not uniquely optimal |
| `comparisonMenu` | Canonical keys, evaluated final target chips, menu hash, search/evaluation seed separation |
| `actionValues` | Per action/model: mean, value unit, bound, sample count, support/continuation assumption and provider provenance |
| `regretEstimateBb` | `Maybe<number>` nonnegative point estimate against considered menu; null for non-chip units (parallel `regretInObjectiveUnits`) |
| `regretInterval` | `Maybe<Interval>`; computed from paired differences, never uncertainty-discounted regret |
| `tolerance` | Value, unit, calibration-artifact hash/status or null/pending; no arbitrary production default |
| `decisionStatus` | One of `supported_near_optimal`, `supported_loss`, `unresolved`, `ood`, `unsupported_objective`, `invalid_input`, `tolerance_pending` |
| `grading` | `eligible:boolean`; nullable `quality` (`excellent` or `supported_loss`); nullable `severityBand`; `reasonCodes:string[]`; no severity band without approved calibration |
| `sizingRegion` | Supported/unresolved/excluded sampled chip-target arrays; intervals with min/max/step chips and basis (`exhaustive_lattice` or `certified_bound`); menu coverage (`finite_menu` or `certified_domain`); `searchTruncated:boolean` |
| `simulationUncertainty` | Method, confidence level, iid draw count, pair count, payoff bounds, search/evaluation budget, branch-support counts; exact values have zero simulation width |
| `modelConfidence` | Status (`reference_supported`, `assumption_sensitive`, `unvalidated`, or `unsupported`), reference ID array, sensitivity-model ID array and limitation array; not derived solely from Monte Carlo SE |
| `display` | Recommendation text key, reason keys, amount list/region, value precision guidance; no forced magic-number headline |
| `summaryEligibility` | Boolean and exclusion reason; missing/OOD/unresolved are not bad decisions or free excellent scores |

`ReviewEvidenceEnvelopeV2`: decisions, total encountered, supported-grade count, unresolved/OOD/pending counts, near-optimal share over **eligible** decisions (`null` if none), mean regret over separately named supported subset, and truncated/cancelled flags. Do not average different objective units.

## 5. Locked measurement semantics

### 5.1 Record timing and actions

Capture state immediately before `chooseTournamentSessionPolicyAction` and before applying the command. Legal set, pot, stacks, counts, ranges and SPR are pre-action. Record result after applying, reconcile it, then finalize opportunity outcomes. Never compute pre-action geometry using decremented stacks or increased pot. Only actions actually selected/executed count in natural-play rates; candidate probabilities are separate expected-frequency series.

Canonical kind derives from the legal transition: fold/check retain kind; any positive investment with target <= pre `currentBet` is a call (including short all-in); an increase from `currentBet=0` is a bet; other increases are raises. `raiseByChips=max(0,target-currentBet)` only for bet/raise; for check/fold/call it is zero. `targetChips` is actual resulting street commitment, including unchanged commitment for fold/check. `investedChips` is target minus pre street commitment, zero for fold/check. Explicit `all-in` is an encoding, never a mutually exclusive action-kind bucket.

`isActorAllIn` must agree with `isStackOffCommand(command,legal,preActor.streetCommitted)` and the independently observed actor stack=0/active-to-all-in transition. Invalid encoded targets are rejected as invalid evidence rather than silently treated as a valid alias. Aggressive jam means kind bet/raise AND actor all-in; all-in call means kind call AND actor all-in. Full raise/reopening follow the engine result and unchanged `raisingReopenedFor` for each eligible opponent before/after; report the IDs gaining raise rights. A short increase may cumulatively reopen action, so `newlyReopenedPlayerIds` is not just `isFullRaise`.

### 5.2 Denominators, exactly

* **Facing-bet opportunity:** actor can act, `legal.toCall>0`, `legal.callAmount>0`, legal set belongs to actor. Count once per decision. Every finalized row contributes exactly one fold/call/raise-kind outcome; an aggressive all-in is a raise-kind response. A free fold where `toCall=0` is a separate no-pressure action, not a facing-bet fold. A player already all-in/folded/out has no decision opportunity.
* **Call:** canonical kind call, including stack-consuming short/full call regardless of raw encoding. A check is not a call. **Fold:** canonical fold, pressure denominator only when facing opportunity holds.
* **Raise-available-facing-bet:** facing opportunity AND a legal increasing action exists, either `legal.raise` or `legal.allIn && allInTo>currentBet`. Record full-raise availability separately; use this denominator only for explicitly labeled raise-when-available analysis. General facing-bet raise rate still divides by all facing opportunities.
* **VPIP:** one `dealt_hand` denominator per actor actually dealt in, including forced-all-in seats, and one binary voluntary-entry numerator per player-hand if any positive preflop voluntary call/bet/raise occurs. Blinds/antes/checks do not count. Repeated calls/raises cannot increase this numerator above one. Snapshot its context at hand start, not at the later winning action.
* **PFR:** same player-hand denominator, binary numerator if any preflop canonical bet/raise increase occurs, including short increases, excluding all-in calls. Label it player-hand PFR. The legacy per-decision series remains `legacy.preflopActionEntryRate`/`legacy.preflopActionRaiseRate`.
* **3-bet:** decision opportunity when exactly one prior **full voluntary preflop increase** exists, no prior short preflop increase, actor faces a cost, has raising rights and can make a full raise. Outcome yes only if current action is full preflop raise. **4-bet:** same with exactly two prior full increases. Count repeated eligible nodes only if state genuinely reopens a new opportunity; key includes decision ID. Sequences containing short increases go to `short_raise_sequence`, with their own decision/opportunity distributions; do not pretend short jams are standard 3-/4-bets. This intentionally fixes an ambiguity rather than importing online-HUD assumptions.
* **Unopened/limped pots:** blinds are not raises. Preflop opening action is the first full voluntary increase; live initial `currentBet` includes the nominal blind even when short-posted. Postflop bet is not a preflop raise. Pot type at flop freezes the observed preflop history; any short increase gives `unknown` standard pot-type plus its explicit flag.
* **Continue vs raise:** among facing-bet rows, continue=call+raise. Raise-given-continue denominator is calls+raises, null when zero. State whether “raise” includes short increases (general facing distribution does).
* **Hand jam rates:** numerator once if the hand/street contains >=1 semantic aggressive jam or all-in call, separately; denominator is all observed hands reaching that street, not only hands with a wager. Decision jam rates use eligible decision counts. Keep these two estimands separate.

### 5.3 Pot, depth and multiway

`P=sum(pre.players.totalCommitted)` before settlement and including preceding wagers; verify equality with information-set pot. `C=legal.callAmount`, not uncapped `toCall`; save both. The simple current-pot call ratio is C/P. Previous wager fraction comes from **that bettor's captured pre-action P**, never `currentP-C` when intervening actions may exist. For a bet, previous invested/pre-pot; for a raise, show both investment/pre-pot and raise-by/(pre-pot+actual-call). Facing size bins use bet fraction for bets and the raise-by fraction for full raises; partial/short-history cases use unknown plus raw geometry.

For a current full raise `T`, `raiseOverPotAfterCall=(T-b)/(P+C)` when C is the full outstanding call; otherwise null/short-call. Investment/current-pot is `(T-s)/P`; it is not raise-by. `C/(P+C)` is a simple terminal heads-up single-pot required share only when everyone eligible and no pending response/side-pot complication is present; outside that support save geometry but mark required-equity shortcut inapplicable.

Decision minimum SPR uses minimum **positive** pairwise remaining matchable stack among active opponents with chips / P; maximum SPR uses maximum. Null/no_future_responder if none; zero-stack all-in opponents do not flatten the statistic to zero. Street-start values use a snapshot before any voluntary street action (preflop after forced blinds). Record all-in contestants and side-pot caps independently so excluding zeros from the depth summary cannot hide them. Actor BB depth remains actorStack/BB; never label it effective stack.

Heads-up means exactly two nonfolded current-hand contestants including actor, whether active or all-in. Multiway means >=3. Able-to-respond count is candidate-specific via `opponentsAbleToRespond`; “three contestants, one able to respond” is not heads-up. An uncontested state with no next actor has no decision row.

Acceptance geometry anchor: saved Wesley node has P=375, C=150, actorStack=24,925, opponentStack=24,775, previous lead P=225 and invested=150. Record C/P=0.4; previous bet fraction=2/3; actor depth=332.333… BB; pairwise remaining depth=330.333… BB; decision SPR=66.066… . A raise to 24,925 invests 24,925 and raises by 24,775, and is an aggressive jam. These are fixture facts; no policy branch may test these constants.

### 5.4 Strata and board features

Use governing depth bins `(0,15],(15,40],(40,100],(100,200],(200,400],>400` and SPR bins `[0,1],(1,4],(4,10],(10,20],(20,50],>50`; invalid negative values reject input. Boundary comparisons are unrounded. Facing fractions: <=1/3 small, >1/3–2/3 medium, >2/3–1 large, >1 overbet. No facing cost is none. A jam is an orthogonal flag. Unknown previous-action geometry cannot be inferred from an all-in chip amount.

Board features: sorted rank multiplicities, maximum suit count, highest rank, number of distinct ranks and maximum distinct ranks in any five-rank straight window (Ace supports A2345 and TJQKA separately), plus changes from previous street. Actor features: exact made-hand category via `evaluateBestHand` where enough cards exist, pocket-pair/preflop ranks/suitedness, cards-to-flush and straight-window counts using only own cards+board. These are factual feature definitions, not a fabricated “air strength” score. Policy role/bluff labels remain model assertions alongside features. No independently calculated bluff frequency from hidden future showdowns.

Tournament stage is descriptive config output; until stage boundaries have an approved definition use `unknown` and exact remaining-player/qualification/level facts. Do not invent “late=25% left” without configuration provenance. Main v1 reports need only street×contestants×depth×facing and named tail slices, plus profile/mode; record other features for drilldown.

## 6. Statistical implementation, sampling and rare pathology

### 6.1 Fixed v1 methods

Aggregate full-population counters without sampling weights. For probability-sampled review estimates use the uniform stream only in v1; save inclusion probabilities for future weighted analysis. Stratified/outlier mixtures are discovery data. All failed/pending actions retain coverage status and are excluded from finalized action denominators.

Implement Wilson 95% intervals for independent binary base cases/trials; for zero events use exact one-sided `1-0.05^(1/n)`. Do not use independent-binomial intervals on decisions from sessions. For session rate comparisons, resample independent blocks with replacement, recompute pooled numerator/denominator within each resample, and use paired candidate-minus-baseline differences. Use 2,000 deterministic bootstrap replicates, fixed hash-derived bootstrap seed, nearest-rank 2.5%/97.5% endpoints. Undefined resamples remain invalid; if all/sufficient endpoints cannot be formed, return sparse/null rather than a fabricated interval. With <30 independent blocks, bootstrap output is exploratory only; no approved-regression claim. A zero-event cluster bootstrap degenerates: report event/no-event per independent block and its one-sided bound, not a zero-width per-decision certainty.

For matched common-state policies, cluster by base scenario family (or independent base-case unit explicitly specified by bank), retaining its transformations and rollout replicas together. Estimate both mean probability-vector delta and sampled-action delta, with their distinct sampling bases. Run profiles as paired observations on identical node/rollout sets. NaN/nonfinite values are invalid runs.

`coverage=adequate` requires the registry's prespecified sample/precision rule; absence of a justified rule yields `diagnostic_only`, not pass. Default low-data policy for style reports is descriptive below 100 independent base cases or 30 session blocks; crossing that reporting boundary does not certify style. Report raw counts and uncertainty always.

Primary regression comparisons require a predeclared practical margin and evidence reference. Use Bonferroni-adjusted confidence level across the fixed primary family in v1 (simple and sufficient); no optional p-value mining. Exploratory slices are labeled exploratory and confirmed on fresh data. Baseline absence, unsupported objective or missing pairs prohibits a pass/fail inference. No early success stopping from repeated 95% intervals. Evaluate at fixed endpoints; budget exhaustion produces insufficient evidence.

### 6.2 Sampling algorithm

Hash-sort eligible IDs with SHA-256 over canonical `[samplingSeed,streamId,id]`; select lowest hashes, deterministic ID tie-break. This is a reproducible simple random sample with inclusion k/N under a random precommitted salt. Precommit salt before simulation; do not select a salt after viewing outcomes. Uniform decision sample is over **all** finalized nodes including flagged ones. Independently sample whole-hand/session bundles over their own universes.

Primary critic budget 200: uniform 60, stratified 50, tails 40, disagreements 30, changed-path/neighborhood 20. Preserve the untouched uniform selection and its denominator for prevalence. Deduplicate display submissions in that priority order; refill nonuniform streams from their unused candidates. Record raw stream memberships, selection rank, universe size and original uniform inclusion probability. Never modify uniform sample because it overlaps a flag. Empty nonuniform budget goes to additional stratified slots, then uniform discovery slots labeled supplementary (not silently merged with the original prevalence sample). Add 20 validation repeat/transform requests and 20 bundle requests as separate types.

Stratified 50 uses round-robin allocation over sorted nonempty primary cells, then hash order within each cell; persist actual allocation. Tail and disagreement lists are sorted by their declared score plus ID, with top-list inclusion marked `not_probability_sample`. Changed-path membership must be an explicit producer tag or changed-module dependency map, not LLM guesswork. Every sample retains source event IDs only in the harness receipt.

### 6.3 Outlier detectors and severity

These triggers select investigation cases; **none is a strategic failure threshold**. Version numeric coverage cutpoints separately from gates.

* `deep_exposure`: every candidate/selected aggressive jam or candidate covering >=90% actor stack in depth>200 BB or decisionMaxSpr>20. Include both selected actions and maximum/mean probability mass on this candidate set. 90% is a retrieval band, not a live prohibition or accepted frequency.
* `deep_small_pressure`: governing historical slice flop, decisionMinSpr>20 and 0<C/P<=0.5. Also report correctly named previous-bet <=2/3 and <=1/3 slices; this ensures the Wesley class remains visible after fixing denominator labels. Split by actor category, contestant count, callable exposure and pressure support.
* `unsupported_branch`: selected/high-ranked commitment candidate with empty caller branch; otherwise sort by caller count ascending and potential contestable exposure descending. Save the unobserved branch's unknown status even when estimated call probability is zero.
* `escalation`: record entire per-street full-increase and short-increase counts, consecutive increases, and raises separated by calls. Preserve >=8 retrieval flag and ECDF for counts 1,2,3,…max; no “eight is impossible” hard gate. Break consecutive runs at any nonincrease voluntary action and at street boundary; count entire-street increases regardless of intervening calls.
* `menu_or_value_disagreement`: reference/regret bounds disagree with production rank, or expanded menu has positive supported coverage gain. If reference absent, flag unavailable only, never assign a loss.
* `wager_pattern`: off-rack ordinary amount contract violation; otherwise conditional repeated targets/fractions and denomination preferences are descriptive. Repeated identical action means consecutive actor decisions of that type within a declared sequence, reset by a different action; total occurrence is a separate metric.
* `version_shift`: large ranked common-state probability distances and occupancy changes; ranking score has no pass/fail authority. Use Jensen–Shannon divergence on canonical action-kind×jam vectors and expanded target-key distributions, specifying their difference.

Persist tail ECDFs `Pr(commitment>=x)` for x=.25,.5,.75,.9,1, raw max, q95/q99 and both event counts/probability mass with denominators. State depth/SPR summaries used; never collapse actor commitment with actual called risk. Critical=confirmed mechanical defect; high=deep exposure, missing caller support or independently supported material loss; medium=pattern/disagreement hypothesis; low=cosmetic concern. A legitimate rare jam can receive high investigation priority and be rejected as a defect. Detector flags never constrain candidate generation or action selection.

## 7. Independent value and Game Review implementation

### 7.1 T7 provider boundary

Define pure `ReviewValueProvider` port in `src/modes/reviewEvidence.ts`. It exposes `describeSupport(node, objective)` and `evaluateMenu({node, canonicalActions, modelIds, phase:"search"|"evaluation", seed, drawCount, signal})`. Return per-action/per-model values and either exact expectations or aligned iid payoff rows with common `drawId` and finite theoretical payoff bounds. `signal` supports cancellation at draw boundaries. Never expose opponent truth through returned UI evidence.

Required offline provider implementations:

1. Exact terminal fold and single-survivor settlement under the incremental convention.
2. Exact finite-world terminal/closed-betting evaluation, including river and remaining runouts, using independently supplied weighted **joint** opponent holdings consistent with actor cards/board; validate no card overlap. Weights normalize across worlds, not independently across colliding player ranges. Use engine hand/pot primitives with independent known-answer tests.
3. A bounded finite reference continuation tree: chance branches plus specified opponent response distributions for each actual action size; each opponent decision input is its own actor view. Support a supplied explicit tree/response table and valid terminal leaves. If a requested nonterminal action has no continuation, return unsupported; do not assume a check reaches showdown or a re-raise always loses all investment.
4. Monte Carlo sampling of the same finite reference worlds/trees using shared chance draws across candidate actions. This is an actual working provider to verify paired intervals against exact values, not fake vectors emitted by production scoring.

This is a deliberately limited reference engine, not a request for a new solver or general poker strategy implementation. Import external solver/human benchmark values only with metadata: tree/actions, ranges, depth, players, objective, provenance, verification status and reference version. Do not call the current Rational utility independent truth. `comparePolicyValues` reports model utility and decomposed charges separately against supported reference chip value.

Every reference range/response model records `conditioningPrefixHash`, `observedSizingSignature` and `conditioningStatus: "explicit_reference"|"estimated"|"unavailable"`. A case with observed pressure cannot be labeled reference-supported using an unconditional starting range without that assumption being explicitly part of the reference case and its limitations. Candidate response tables are keyed by canonical evaluated amount/context; sharing a chance draw does not mean reusing one identical response for every size. All sensitivity models requested by the evaluation config must be present; silently dropping an inconvenient model invalidates robust grading.

Payoff is actor's ending stack minus predecision stack, including refunds and awards; earlier contributions are sunk. Fold is exactly 0 in this convention. All-in closure without known opponent cards/runout is an expectation, not realized perfect-information payoff. Terminal exact expectation over a complete specified distribution has zero **Monte Carlo** uncertainty, but range/model confidence remains separate.

Production telemetry extraction in `scoreCandidates` must save each intermediate value without changing operation order. `responseForCandidate` records branch counters it already has. No new penalty, fallback, candidate, simulation limit or scoring algebra is permitted.

### 7.2 T8 exact algorithm

Implement `deriveHandReviewEvidence(replay, {valueProvider, tolerancePolicy, budget, signal, yieldControl})` in the new prototype. Reuse `restoreTournamentRunnerReplay` and exact command resolver; extract replay traversal if necessary rather than maintain two diverging replay engines. Capture actor view/legal state before each replay action; a version mismatch remains an error. The prototype never calls a model endpoint.

For each decision:

1. Resolve and canonicalize the exact played action. Add it to the menu before scoring. No nearest match, rank-last fallback, raw all-in-only match or cosmetic replacement. Invalid played action yields invalid-input and no grade.
2. Build initial menu from production candidates as **proposals**, plus exact boundaries and the played amount. During sizing search include neighboring legal amounts and declared strategic targets; preserve all-in/short-call discontinuities. Actual final amounts go through the reference provider. Candidate proposals do not confer value evidence.
3. Deterministic search: initial legal targets plus one rack step on either side of played target and each ordinary proposed size; full domain boundaries; integer/rack floor+ceiling of neighboring-target midpoints. Deduplicate canonical results. Score search phase; refine midpoints adjacent to played and current search-best targets for at most three rounds, maximum 64 semantic actions. Rank refinements by possible search gain and stable target order. Preserve played action and exact boundaries if capped. Record `searchTruncated`/finite-menu coverage. Number of rounds/menu cap are compute settings, not tolerance or claims of optimality.
4. Freeze this menu before evaluation phase. Use distinct phase seeds. Do not add a size after seeing evaluation samples unless starting a separately labeled new experiment. Support exact enumeration when provider can finish within budget; otherwise use iid matched-world sampling and bounds below.
5. For each model and action pair compute per-draw `D_i=payoff_i(b)-payoff_i(a)`. Mean differences and variance may be shown diagnostically. For decision guarantees v1 uses conservative simultaneous Hoeffding bounds with provider-supplied finite theoretical difference range `[L,U]`: `h=(U-L)*sqrt(log(2J/alpha)/(2n))`; bounds `mean(D)±h`, intersect theoretical bounds. J is the number of tested unordered action pairs across all models; alpha=.05 across the frozen menu. Exact evaluated pairs have degenerate exact bounds and need no sampling approximation. A supported one-action menu has regret exactly zero against that menu and bypasses J=0 arithmetic; this does not prove menu coverage. n=0/1 without valid bounds gives insufficient evidence. Never estimate payoff bounds from observed min/max.
6. For action a/model m compute regret point `max(0,max_b mean(D_ba))`, lower `max(0,max_b lower(D_ba))`, upper `max(0,max_b upper(D_ba))`. Include self comparison=0. Across supported sensitivity models, robust upper is maximum model upper; robust lower is minimum model lower. Strong grade requires all relevant models supported and robust upper<=epsilon. Supported loss requires robust lower>epsilon. Model disagreement, missing action support, wide interval, OOD or missing tolerance yields unresolved/explicit unsupported status. Report model-specific results too.
7. `epsilon` must come from a supplied `ReviewTolerancePolicy` with version, objective/unit, context scope, value, source evidence and approval status. Ship a pending template, not a fabricated production tolerance. Tests use explicitly synthetic tolerance fixtures. Legacy 0.35 BB can be shown as a **legacy hypothetical** comparison, never as an approved new grading standard. No tolerance input means `tolerance_pending` but still computes supported values/intervals.
8. `bestSampledAction` is the highest evaluation mean under a named primary model; ties use canonical key for deterministic rendering only. Robust supported set determines the sizing region and grade. The best sampled size is not necessarily proven best. No 0.02-BB ranking claim if uncertainty does not support it.

Intervals on the number line must not claim unsampled values. By default return a set of sampled supported targets. Merge to an `exhaustive_lattice` interval only if every legal lattice point in that closed interval was evaluated and supported with unchanged semantic domain. A provider may supply a separately validated interpolation bound for `certified_bound`; v1 need not implement interpolation. Distant supported endpoints cannot certify their interior. Exact off-rack legal boundaries are separate supported points. This narrows the design's informal “region” into an implementable, honest representation.

Required plateau tests use injected, analytically specified reference surfaces: 11,063 slightly highest, 11,000 and 12,000 within a synthetic epsilon both receive `excellent`; a different surface makes 12,000 materially worse and returns supported loss; a noisy surface yields unresolved rather than excellent/loss; a discontinuity between supported endpoints forbids one continuous interval. These fixtures test inference logic, not assert real-world EV for a hand that has not been specified. Add at least one actual finite-world poker reference case exhibiting multiple equivalent choices so T8 is not only testing synthetic curves.

Use a one-chip legal context for the literal 11,063 surface fixture. In a 25-chip context, 11,063 may describe an abstract optimum but must not be advertised as a physically feasible ordinary generated wager. This distinction never disqualifies the player's supported 11,000/12,000 choices.

The UI-facing DTO must carry `bestSampledAction`, supported target set/regions, point regret, uncertainty, model confidence and unscored reason independently. Summary excludes unresolved/OOD/pending from grade denominator and exposes coverage. No display of a precise optimum without finite-menu caveat. No denomination-preference field enters grading code.

Prototype defaults: 64-action maximum, three search rounds, 128 search draws/model, 512 evaluation draws/model, 1,024 maximum when explicitly configured before evaluation. Exact enumeration cap and total work cap explicit. Wide deep-stack bounds will often be unresolved; that is honest. Do not repeatedly grow n until a desired grade appears. Full simulation requirements are satisfied by supported providers and truthful budget reports, not by claiming general poker certainty.

## 8. Wager-realism contract (T9)

Existing `quantizeWager` and `RationalWagerSizingAudit` remain. Do not add a second live quantizer. `generateWagerReferenceMenu` is **offline** and takes prestate, legal set, abstract target list, rack and a versioned preference proposal. It returns final targets plus origin tags (`production`, `rack_floor`, `rack_ceil`, `human_multiple`, `legal_boundary`, `exact_action`, `played`).

Generate nearest floor/ceil rack targets, existing production targets, exact min/max and exact required actions; optional human proposals use configured chip or BB multiples, never an unversioned hardcoded multiples-of-100 rule. Validate final commands with engine before reference scoring. Failed proposals are reported as rejected, never executed. Floor/ceil crossing a boundary includes the exact boundary with its reason; calls/all-ins/forced bets/minimum/short-all-in state-derived amounts are never rounded. Once an action is selected in a hypothetical comparison, execute its evaluated target unchanged.

Physical legality: integer/legal engine validity separately from rack feasibility. Ordinary generated nonboundary amount must be on configured rack; exact state-derived exceptions carry provenance. If a custom game has off-rack legal bounds, preserve legal correctness and report rack configuration anomaly rather than alter the engine. User-entered legal off-rack amounts retain exact scoring in T8.

Strategic magnitude: compare reference value at actual final sizes and candidate coverage. Human preference: descriptive ranking/score with `unvalidated` or evidence-backed preference source, no strategic authority. Optional hypothetical selector may break ties only within a **supported** strategic tolerance from an approved input. No tolerance/preference evidence means report amounts, do not invent preferences or select a live action. T8 grading tolerance is a distinct parameter and never reads the preference score.

Required outputs: original vs expanded menu, matched canonical targets, legality/rack exceptions, raw and normalized size distributions, supported reference coverage gain/loss, denomination pattern counts, and scope of evidence. No rollout adopts generated sizes into `buildCandidates` in this project.

## 9. Personality and adaptation contracts (T12–T14)

### 9.1 Normal probability telemetry

Add an additive exact `selectionDistribution` to `NormalDecision` (or an explicit detailed-result wrapper used by both paths). Extract common pure selection preparation inside `normal.ts`; do not copy the selection logic into scripts. Let q be existing `deviationProbability`, B existing preserve-aggressive/elimination short-circuit, and D existing eligible alternatives. If B or D empty, probability of best is 1. Otherwise p(best)=1-q and p(d)=q*w(d)/sum w. Weights use existing max(0,weight) logic; if total<=0 the first eligible deviation receives q. Use current ranked tie-breaking and actual control flow. Preserve old RNG consumption exactly, including when the existing short-circuit skips the first draw, and preserve fallback choices.

Before extraction, record known seeded decisions as regression fixtures including every branch. Compare command, EV loss, profile, reason, signals, and next consumed draw where observable; after extraction those fields must agree. Telemetry probabilities are conditional on a fixed Rational evaluation. Across multiple equity draws report their mean; never publish Rational probabilities as Normal probabilities. Until extraction lands in T12, Normal probability fields are explicitly unavailable; observed decisions still work in T3–T6. No hidden dependency from T3 to T12.

### 9.2 Personality report

Dimensions: continue propensity, raise-given-continue, opening/defending/3-betting, wager magnitude and actor commitment, thin-value/defense/semi-bluff/trap decisions **labeled by reference or policy source**, size recurrence, and response to observed tendency evidence. Read profile vectors/descriptions unchanged. No new quotas on best-action/deviation, calls, folds, aggression or separation.

Comparison: common nodes across each profile and Rational, probability deltas with grouped intervals, Jensen–Shannon divergence on canonical categories, and natural-play occupancy-reweighted distributions. Publish per-dimension effects and joint descriptive map; do not compress into a “distinctness score” acceptance threshold. The initial bank is 300 nodes/profile×8 equity replicas; session pilot 30 blocks. Low-data policy follows section 6; exact identical probability maps on the specified bank are a descriptive convergence signal, not universal equivalence. Empirical convergence requires held-out common-state similarity plus failed blinded human distinction at the intended situations under prespecified operational criteria; missing labels means unresolved, not “profiles distinct.”

Pathological differentiation means apparent separation is attributable to unsupported loss, illegal actions, arbitrary denomination/timing tells, IDs, or changed state exposure rather than competent style. Report paired competence/reference results alongside style. Clear-value and forced-action anchors where profiles should agree are required negative controls. Never modify `competenceRate`, `maxEvLossBb`, profile vectors or Normal's existing constants to pass this report.

Provide blinded bundle export and label import for human style matching with an abstain option. A deterministic baseline classifier may use nearest class centroid on standardized public behavioral features, fit on development sessions and tested on held-out families; use permutation-label baseline and grouped uncertainty. Classifier performance is diagnostic and cannot certify human recognition. No profile ID/name, hidden cards, seed, mode or outcome-derived leak in classifier features.

Timing report uses two evaluations: public-state-only predictor vs same features plus actual externally observable action-delay features. Private-strength label is internal offline truth/actor feature, not provided to predictor. Group train/test by session/base family; record device/runtime. Prediction improvement is a potential tell diagnostic, no replacement correlation threshold. Existing delay limits remain UX contracts. If actual delay observations unavailable, report missing coverage; never substitute raw CPU duration without labeling the measurement change.

### 9.3 Observer histories and offline adaptation

Create new `ObserverHistory` in scripts, not a misleading extension of legacy `PublicOpponentHistory`. Required: observer alias/internal ID, observed opponent ID, session/hand event IDs, seen-hand count, per-context opportunity/outcome counts, last-observed event index, shown-card records with selection caveat, and versioned prior/config reference. Immutable snapshots keyed by observer/opponent/context. Reuse canonical `OpportunityEvent` IDs; same event observed twice cannot increment twice. Only seats present at table from exposure start may observe an event; late joins get no prior hidden history. History persists across hands in the same experimental session, resets at session boundary. No career persistence.

Per-context counts include `facingPressure -> fold/call/raise`, `unopenedPreflop -> check/call/raise` where applicable, and per-player-hand entries. Always record nonfold opportunities. Do not route these corrected counters into live `derivePublicExploitSignals`; its current default is protected. Provide a labeled legacy export for side-by-side diagnosis if useful.

Offline beliefs: Dirichlet posterior over **observable action categories**, counts + positive prior pseudo-counts, separately by context and opponent. Prior parameters and context pooling hierarchy are required versioned experiment config; `no_prior` gives uninitialized, not guessed 42% aggression. Use development scripted data to fit priors or a clearly synthetic test config. First implement no decay (`decay:"none"`); regime-switch experiments show its tradeoff. A configured fixed exponential decay may be an experimental candidate only, calibrated before holdout, never a live default. Shown cards are retained as qualified evidence; unshown actions cannot increment a bluff count.

To exercise meaningful response learning without inventing a general poker solver, T14 includes a **finite scripted-opponent mixture** model with explicit, known policies and likelihood of observed actions given public context. Update posterior mixture weights using only observed action/size evidence; marginalize private holdings using the configured model, not simulation truth. Feed this posterior into T7's finite continuation provider to compare supported actions. This tests the intended belief→value→response chain. It does not claim observable aggression alone identifies bluff frequency. Where models induce identical public likelihoods, posterior odds must stay at prior odds.

Schedules: stationary always-shove, value-heavy, passive, balanced finite-reference policy; bluff-heavy→value-heavy and reverse switches at a predeclared hand index. “Balanced” is only within the supplied reference game unless independently verified. Reuse `SCRIPTED_STRATEGIES` when their `decide(legal,holeCards)` contract suffices; wrap them in an offline `ExperimentalOpponentPolicy` port receiving actor view/public history only. Do not pass deck/future board through that port.

Run fixed-belief and adaptive conditions on identical block/seat/deal schedules. Outputs: per-context posterior trajectories, call/raise probability changes on common probes, chip/payout/qualification metrics separately, cost against balanced/value-heavy control, post-switch recovery and missing evidence. Initial 30 independent blocks/schedule; extend toward 100 by precommitted config. Fixed-stack experiment uses independent reset hands with the same stacks/dealer schedule in both arms; tournament experiment continues with exact existing blind clock rules. No update to live strategy, no suppression of opponent bluffs, no use of unseen truth.

## 10. Critic pilot and reviewer-validation state machine

The critic prompt is the governing design section 6 prompt with the v2 schema appended. Send only the serializer's allowlisted task projection. Do not stringify `BehavioralDecisionEvent`, reproduction data, `SampledHand.signals`, policy explanation text or final hand history wholesale. Validate the final serialized request, not merely its input object. For the decision phase, future boards/results and opponent hidden cards must be absent even when the truth store contains them. Expose own cards deliberately through a separate actor-view allowlist; keep `assertNoHiddenCards(PublicHandHistory)` strict for the legacy public-only API.

Blinding is structural: use opaque independent case aliases, remapped seat/player aliases, reordered cases, no source filenames, stack labels containing “Wesley,” seed strings or profile keys. Raw geometry and current actor cards are necessary evidence, not a privacy leak in synthetic offline review. Names can be injected only in dedicated validation variants. Cache identity includes input, task, prompt, model and decoder fingerprint. Duplicate validation calls use `cacheMode:"bypass"`; a cached response is not an independent repeat. Network adapter requires explicit endpoint/model/budget; no environment-triggered automatic contact in CI.

### State transitions

`ReviewerQualification` is keyed by exact model/prompt/schema fingerprint, dimension and domain:

* **UNVALIDATED:** default, including an implemented/mock/heuristic adapter. May run developer dry runs and create hypotheses; output carries unvalidated status.
* **PILOT:** operator selects a versioned pilot manifest and records a pilot-start event. This only authorizes that evaluation campaign within its configured budget; it does not grant quality authority.
* **VALIDATED_LIMITED:** requires completed held-out report, human/exact reference provenance, preregistered operational acceptance criteria, and explicit human validation record naming allowed dimensions/domains and limits. No code path computes this promotion from “tests passed” or a majority of LLM votes.
* **SUSPENDED:** optional administrative state after demonstrated drift/regression or withdrawn evidence. Revalidation requires a fresh/prespecified pilot. Changing model, prompt, schema or relevant serialization produces a new unvalidated fingerprint, not inherited approval.

Every state has `strategyAuthority:false`, `releaseGateAuthority:false`, `userGradeAuthority:false`. No consumer outside reporting/triage can import qualification status. A human can record limited validation; the agent cannot invent reviewer identity, date, signature or evidence. Missing human input returns `promotion_pending`; execution proceeds with other tasks and an honest incomplete pilot-evidence report.

### Pilot manifest and fixed controls

Required 200 base-case slots: 50 verified defects, 50 defensible unusual lines, 50 ordinary, 50 ambiguous/OOD. A generated case fills a slot only with provenance: `exact_verified`, `expert_adjudicated`, or `pending_review`; pending cases do not count toward claimed validated coverage. No pretending all 200 are verified by labeling them so. Split base families before prompt tuning; 60/20/20 development/calibration/holdout. Final held-out cases cannot be used to tune the prompt/model choice without being retired and replaced.

Select 40 base cases balanced across strata by precommitted hash. For each request one independent exact duplicate and these transformations: name permutation, global suit permutation, 10× chip/blind/rack scaling, irrelevant whitespace/list-order perturbation, and equivalent command encoding where available. Record not-applicable transforms rather than force invalid ones. Add one substantive contrast per selected base case (e.g. actual position, price or draw changed); its expected difference is reference-supported or pending. Keep group ID/transform details outside critic input. Small dry-run uses 8 base cases, 2/stratum, with the same transform machinery.

Human panel: two qualified raters independently label at least the 40 transformation-base cases and all initial high-severity model concerns selected for adjudication; label a probability sample of unflagged cases too. For missing qualifications/raters, emit pending evidence. Rater disagreement remains an explicit set/ambiguous label unless adjudicated; do not force a single “gold” via majority of models. Exact mechanical anchors do not need a human to establish their arithmetic but cannot validate poker judgment broadly.

For each base/variant/repeat store immutable input hash, review receipt, all dimensions, confidence, requested checks, expert/exact reference, whether the verdict agrees, and the reason for disagreement. Score:

* confusion counts and precision/recall per assessable category; uncertain gold cases excluded from binary correctness but used for appropriate abstention;
* false-high-priority concerns on defensible lines, with opportunities and grouped intervals;
* transform disagreement and exact-duplicate repeatability, grouped by base case;
* sensitivity to true non-equivalent controls (a constant “plausible” reviewer must fail this utility assessment);
* empirical correctness by low/medium/high confidence; no verbal-confidence-to-probability invention;
* rater pair agreement/confusion and adjudication frequency;
* detector-only vs detector+LLM vs expert additional confirmed findings, unflagged misses, investigation minutes, tokens and cost.

No numeric pass threshold is asserted by this spec. A `PilotAcceptancePolicy` records stakeholder false-alarm budget, high-impact miss priorities, minimum evidence coverage and allowed domain **before** held-out evaluation. If absent, result is baseline-establishment-only and qualification cannot advance. The implementation must support those fields and enforce their provenance; it must not create replacement 80%-accuracy/90%-agreement defaults. Test state-machine transitions with synthetic approvals explicitly labeled fixture-only, not with fake production approval artifacts.

## 11. Baselines, holdouts, seeds and artifact immutability

### Storage and schema

Every run directory contains `manifest.json`, `receipt.json`, `decisions.jsonl`, `opportunities.jsonl`, `hands.jsonl`, `metrics.json`, `comparison.json`, `flags.jsonl`, `samples.json`, `report.md`, and checksums. Optional reviewer/reference/adaptation outputs have explicit task IDs and status. Full truth and original-ID mapping live under `restricted/` and are never referenced by an upload serializer. Missing optional output is represented in receipt task status, not silently omitted. Per-decision settlement additions are append-only hand/settlement records joined by IDs, not rewrites of sealed decision JSONL.

`BaselineArtifact` required: schema/semantics/registry/harness versions; `baselineId`; creation source run refs/checksums; policy identity; bank and split refs; selected metrics with counts/uncertainty; scope/objective/clock; comparison eligibility; provenance (`descriptive_snapshot|approved_reference`); promotion record ref nullable; supersedes nullable. A baseline does not include target percentages invented from its own observed extrema.

Write artifacts with exclusive create, temp-write+atomic rename where appropriate; identical existing content may be reused after verifying hash. Different bytes at an existing content ID are an error. Do not overwrite baselines or fixtures on a failed test. No `--update`, `--accept-new`, `UPDATE_SNAPSHOTS`, or auto-regenerate path in release/CI. A development `snapshot` command may create a **new descriptive** candidate with new ID; promotion is a separate operation consuming an explicit human record and evidence. Keep previous files and link supersession.

`BaselinePromotion` records actor identity, source/target IDs, reason, calibration evidence, changed metric definitions/margins and timestamp. No automatic `approved` value. A baseline may be provisionally descriptive without approval; report comparisons as diagnostics. A defect fix does not entitle the agent to change every expected value: exact regression fixtures change only if their independently specified contract changes with documented justification.

### Family split and isolation

`ScenarioDefinition` fields: version, family ID, scenario ID, rules/config refs, initial engine state/deal seed, executable legal action prefix, transformation lineage, intended coverage tags, support/provenance and expected mechanics. Freeze family split by hash of `[splitSalt,familyId]` modulo 100: 0–59 development, 60–79 calibration, 80–99 holdout. Wesley's named family is forced development with recorded reason. Same base family and every permutation/scaled variant share one split. Modifying salt or lineage requires a new bank version, not recategorization in place.

Tune only development. Calibration sets budgets, tolerances and model choice without touching final holdout. Holdout execution is read-only and appends a usage ledger: ID, purpose, openedAt, run ID, whether inspected for tuning. Once used to guide a change it is `spent`; next confirmation needs fresh families. A physically readable local holdout is not cryptographic secrecy; the enforceable contract is provenance, command restrictions and recorded use. Never claim inaccessible holdout security in one local repo.

The calibration/baseline writer must reject holdout/spent files as tuning input. Test a mutation that tries to use holdout outputs to regenerate expectations: command fails, original hashes unchanged. Read-only comparison against an approved frozen holdout reference is permitted; promoting results obtained by tuning on that same holdout is not.

### Deterministic streams and version comparisons

Use `deriveSeed` for engine streams with structured parts serialized unambiguously by the harness before hashing; actual production replay seed recipes remain unchanged. Common-state runs hold information/legal/menu constant and vary rollout seed explicitly. Natural runs reuse the current session's deal derivation keyed by hand ID; seat rotation/source version have separate metadata. Baseline and candidate seat schedules use identical **logical** session/hand IDs and deal seeds, even when output directory/run IDs differ. Otherwise different run IDs would change cards and defeat pairing.

Record actual Rational and Normal seed arguments and existing inner stream versions. Do not change their coupling to satisfy an idealized separation. New reference/provider/sampling/bootstrap draws use independent `reference-search`, `reference-evaluation`, `sample`, `bootstrap`, `pilot` namespaces. Randomly drawn real time is forbidden as a seed default. A fresh seed list is created and saved before outcomes, with uniqueness checked.

Compare separate baseline and candidate artifacts; do not load two source versions into a mutable singleton. Old baseline can be evaluated in a separate checkout/process and provide JSON; implementation need not automatically manage old git worktrees. Source/config fingerprints distinguish versions even if `CURRENT_POLICY_VERSION` is unchanged by telemetry-only changes. Same logical node key plus rollout replicate pairs common-state output; divergent natural histories pair only at independent block, never by matching decision ordinal after divergence. Missing pairs are reported and excluded from paired estimates, not filled with zero.

## 12. Test tiers and command contract

Add package scripts using existing `vite-node -c scripts/vite-node.config.mjs` convention:

* `eval:behavior`: `scripts/evaluation/run.ts`, subcommands `capture`, `common`, `report`, `compare`, `wagers`, `review-prototype`, `critic`, `reviewer-pilot`, `personalities`, `adaptation`, `verify`, `snapshot`, `promote`.
* `eval:fast`: dispatcher `tier fast`; `eval:periodic`: `tier periodic`; `eval:release`: `tier release`.
* `typecheck:evaluation`: `tsc --noEmit -p tsconfig.evaluation.json`.

Common CLI flags: `--config <file>`, `--output <new-directory>`, `--baseline <artifact>`, `--seed-manifest <file>`, `--budget-ms <integer>`, `--dry-run`, `--offline`. `--dry-run` validates configuration/planned work without generating claimed measurements; actual small mock pipeline is a separate `--fixture-run`. Reject unknown flags and missing values. Release uses explicit config and artifact hashes; no endpoint flag in fast/release execution. Operator may run critic separately and attach validated report; it never gates.

| Tier | Exact intended work / scale | Determinism | Hard failure vs report | Persisted outputs |
|---|---|---|---|---|
| PER-COMMIT / FAST | Relevant engine/semantic/property/known-answer tests; typecheck; 120 common nodes×4 equity seeds/policy (60 current production simulations each); 8 session blocks per mode capped at 12 hands; 8-case offline critic/reference pipeline fixture | Fixed bank/seeds; stochastic algorithms reproducible; no network/wall-clock decisions | Hard: invalid telemetry, illegal transition, leak, known-value regression, hash/schema failure. Short-session cap is planned and reports partial, not fake finish; behavior frequencies only warnings. | Manifest/receipt, counts/flags, selected reproductions, exact-suite result, timings; bounded raw traces |
| PERIODIC / LARGE | 300 common nodes×8 replicas/profile; 30 full session blocks/lineup first pilot, then explicit config up to 100 and 10,000 common nodes; critic 200+20+20 only when selected separately; adaptation schedules | Precommitted seed manifest; no production network; optional model responses versioned but not assumed deterministic | Hard: contracts/invalid pipeline. Statistical changes and sparse references report; justified registered regression criteria may fail only with sufficient evidence. | All run artifacts; grouped intervals, occupancy, menus, pilot/recognition bundles, pending evidence |
| PRE-RELEASE / FULL | Complete repo tests and build; evaluation typecheck; fresh holdout common-state/reference suite; normally 100 full-field blocks/main lineup plus hero/live pacing; tail/reference and T8/T9/T12/T14 reports | Frozen release manifest/fresh precommitted seeds; independently stored model evidence optional | Hard: contract/reference failures, invalid artifacts, registered material regression. Missing required release coverage is `incomplete` and cannot be advertised as certified; optional unvalidated critic does not block packaging. | Sealed release evidence index with counts, limits, gaps, baseline/margin refs and conformance report |

Fast intended runtime target is <=5 minutes after throughput profiling, not a reason to truncate unmarked. Set default fast elapsed cap 300,000 ms at whole-decision boundaries; if reached, preserve exact tests and mark behavioral smoke incomplete. Periodic/release default campaign cap is 60 minutes per invocation; resumable **new receipts** must preserve manifest and state IDs. Do not silently reduce fixed sample targets to fit a timeout. Split campaigns into recorded blocks when needed. Current live policies keep 60 simulations unless run config explicitly tests another existing supported budget; high-precision reference computation has its own limits.

Exit codes: 0=command completed and required contracts passed (report may contain diagnostics/optional pending); 1=reproduced contract or registered regression failure; 2=invalid configuration/artifact; 3=required campaign incomplete. `report` can return 0 while clearly reporting insufficient evidence; `verify --require-complete` returns 3 on missing required coverage. No blanket catch converting nonzero to success.

T15 integrates a fast contract stage and a **verification** stage for the separately generated release evidence into `release-stages.mjs`; avoid silently launching hours of new simulation in existing release command. If required evidence is absent, verifier returns 3 with the exact command/config needed. Existing packaging remains available independently. Preserve existing nonbehavior release gates. Retired behavior gates produce their old observed values and explicit retirement rationale, not unexplained disappearance.

Build/package closeout follows `AGENTS.md`: source changes require relevant tests and `npm run build`; if the approved packaged app must reflect changed production behavior, package it. This infrastructure/prototype project does not adopt new live behavior, so do not represent a package as containing an adopted strategy improvement. Run `npm run release:update-shortcut` to the existing latest approved build. Commit only task-owned changes on local `main`, preserving unrelated work. If unrelated work remains, report it rather than staging it to manufacture a clean status.

## 13. Task-by-task implementation and acceptance

The module allocations and graph above are normative. This section states each task's existing edit points, verification and completion evidence. IDs `A01`–`A15` must appear in test names or an acceptance index mapping to exact test names. Every task requires real executable behavior, not just exported interfaces/TODOs or reports with fabricated metrics.

### T1 — Evidence manifest (`A01`)

Existing: read `package.json`, lockfile, `tournamentRunner.ts` version constants and engine seed helpers; no source policy edits. New: T1 allocations plus `manifest.test.ts`, `artifactStore.test.ts`. Output: reproducible run manifest, artifact loader/writer and fixture command.

**PASS:** same deterministic inputs in differently timed invocations produce same run identity; changing a relevant uncommitted source byte/config/bank/seed changes identity; dirty source can be reconstructed from refs; changed bytes cannot overwrite an existing ID; credentials/ignored files never enter source bundle. **FAIL:** a seed/version alone claims reproduction, manifest depends on timestamp, output directory changes deals, or artifact writer silently replaces an old baseline. Use a temporary git fixture to test dirty/staged/untracked capture; do not mutate the real repo for this test.

### T2 — Semantic event and geometry (`A02`)

Existing edits: optional export-only `raisingReopenedFor` in `betting.ts`; new pure `pokerActionSemantics.ts`; no engine arithmetic changes. New tests: `src/lib/pokerActionSemantics.test.ts`, `decisionEvent.test.ts`, `stratification.test.ts`. Reuse `betting.test.ts`, `pots.test.ts`, `playerCountSemantics.test.ts`, `wesleyIncident.test.ts`.

**PASS:** call/all-in-call aliases have same semantic transition key; max-target raise and explicit jam agree; raw alias cannot hide exposure; partial all-in does not become an ordinary full raise; cumulative short raises have correct reopening IDs; Wesley numbers in section 5 match independently specified constants; suit/name transforms preserve geometry and scale transform preserves ratios. **FAIL:** counting by `command.type` alone, post-action SPR, wrong pot denominator, one effective-stack scalar for all side pots, or recording a currently unmatched bet as already refunded.

### T3 — Denominators and registry (`A03`)

Existing edits: measurement/report scripts, both audit gate scripts and `botLeague.test.ts` legacy assertions. New tests: `opportunities.test.ts`, `metricRegistry.test.ts`. Reuse `measure-ai-behavior.test.ts`, `normal-all-in-audit.test.ts`, `botLeague.test.ts`.

**PASS:** in a player-hand containing two calls and one raise, VPIP=1 and PFR=1 over one player-hand; three eligible facing-cost decisions count three opportunities; an all-in call increments call and all-in-call, not raise; free fold increments no facing-bet fold; repeated ingestion changes no counts; zero opportunities returns null/unvisited. Full 3-/4-bet eligibility excludes short-increase sequences and tests all-in calls in prior history. Old 20% call and 3-point gap bounds are present as retired records with origin, never hard release requirements. No new replacement quota. **FAIL:** array/action counts substituted for player-hands, silent gate deletion, fake “pass” for no coverage, or mathematical invariants retired alongside subjective gates.

### T4 — Reachable common-state bank (`A04`)

Existing reuse: engine `createBettingRound`, dealing/transitions, `createTournamentSession` and `botLeague` fixture machinery; legacy matrix remains separately identified. New tests: `scenarios.test.ts`, `scenarioTransforms.test.ts`, `scenarioBank.test.ts`. Reuse engine/deck/tournament/league/incident tests.

Produce at least 120 distinct fast base nodes across streets, depth and contestant bins, and generator capability for 300/10,000-node configured banks. Families include deep pressure, asymmetric stacks/side pots, reopening/short stacks, ordinary play, defensible extreme lines and action-menu boundaries. Generate legal initial configurations and replay legal action prefixes, capturing the desired nodes. Custom finite scenarios may create an engine betting round and a declared deck/hand source, but must record all preceding commitments and validate reachability; do not merely invent a legal set around an impossible hand. Negative controls may remain strategic-label-pending while mechanics are verified.

**PASS:** rebuilding a node from initial-state+prefix reproduces state/key; 10× scaling also scales blinds/rack/minimums; suit mapping bijective across all cards; all descendants share family split; holdout labels absent from policy inputs; transformed copies do not increase independent-case count. **FAIL:** Wesley lookup in policy, silently invalid handmade snapshots, split by individual near-duplicate ID, or changing split seed after a failed result.

### T5 — Interactive capture and sampling (`A05`)

Existing edits: `measure-ai-behavior.ts`, `critic-harness.ts` recording loop and `tournamentSession.ts` explicit lifecycle seam. Reuse current policy/session functions; do not create another poker engine. New tests: `sessionRunner.test.ts`, `policyAdapter.test.ts`, `sampling.test.ts`; reuse `tournamentSession.test.ts`, `tournamentRunner.test.ts`, `critic-harness.test.ts` and measurement timeline tests.

Exact lifecycle choice: add optional `completionScope:"hero"|"full-field"` in an explicit nonpersisted progression-options parameter to `progressTournamentSessionHand`/`settleTournamentSessionHand`, default hero. In full-field scope use the same chip settlement/elimination core, keep status playing while >=2 tournament players remain, and record hero milestone externally. At <=1 remaining, mark complete for evaluation; do not fabricate a hero career result or alter careerResults. Existing production calls omit options and must be byte-for-byte equivalent in old fields. Extract a common settlement core if needed; do not clear `source.result`/change heroId after bust to evade guards. No UI or replay schema gains this option by default.

Policy adapter reuses `sessionPolicyContext`/`assembleSessionPolicyDecision` through export-only or a shared pure adapter extraction. For scripted lineups, use a per-seat policy map in scripts and dispatch commands through the same engine. Benchmark adapters do not relabel a Rational command as Normal. This avoids duplicated Normal mapping logic and supports matched/common nodes.

**PASS:** a hero bust preserves exact existing default completion; evaluation scope continues remaining players and reaches a true winner or explicit cap; timeline identifies both milestones; pre-action event snapshot unchanged by subsequent actions; flagged cases remain eligible for uniform reservoir; determinism/selection probabilities and bounded-memory sampling tested. **FAIL:** second lifecycle engine, status-reset hack, omitted post-hero hands claimed as full-field, future-board critic leak, or uniform sample taken only from unflagged hands.

### T6 — Conditional report (`A06`)

Existing edits: `report-ai-behavior.ts` v2 output and optional adapters for old report formats. New tests: `statistics.test.ts`, `metrics.test.ts`, `comparison.test.ts`, `report.test.ts`; no live code changes.

**PASS:** small hand-computed datasets reproduce numerator/denominator, conditional vs global rates and paired deltas; 300 independent zero-event trials have upper bound `1-.05^(1/300)`; duplicating decisions within one block does not create more blocks; seat rotations retain one block; absent baseline/missing pairs/sparse bins visible. Known incompatible semantics versions cannot produce a paired “pass.” Every report lists clock/scope/objective/coverage and largest tail cases. **FAIL:** normal-looking aggregate hides empty/deep slices, pooled independent decision CIs on sessions, uncorrected arbitrary primary tests, or best/worst scripted-opponent ranking described as full exploitability.

### T7 — Reference values and decomposition (`A07`)

Existing edits: additive `RationalActionOption`/audit value components and branch counters in `rational.ts`; reuse hand/pot primitives. New: `reviewEvidence.ts` provider contracts, T7 offline modules, `referenceValues.test.ts`, `referenceCases.test.ts`. Reuse `rational.test.ts`, `rationalEquityService.test.ts`, `pots.test.ts`, `wesleyIncident.test.ts`.

At least twelve small exact references spanning folds, calls, all-in aliases, ties/refunds, unequal stacks/side pots, hidden-world expectations, size-conditioned response and unsupported continuation. Expected constants derived independently in fixture descriptions, not generated from provider outputs.

**PASS:** fold value exactly 0 and zero simulation uncertainty; a known two-world expectation matches hand arithmetic; finite enumeration and sampled provider agree within the provider's declared conservative interval; payoff excludes sunk chips and includes refunds; different sizes can produce different specified responses on the same world draw; empty branch is flagged; base value minus recorded charges equals unchanged existing utility. **FAIL:** passing production utility back as Q_ref, counting hidden realized opponent cards as known at decision, assuming all river calls close multiway action, or changing penalty arithmetic to make comparison match.

### T8 — Review prototype (`A08`)

Existing reuse/extraction: exact traversal/resolver in `handReview.ts`/`tournamentRunner.ts`, keeping old entry point/DTO behavior; no `HandReviewScreen.tsx` change. New `handReviewPrototype.ts`, optional `handReviewReplay.ts`, `src/modes/reviewEvidence.test.ts`, `src/modes/handReviewPrototype.test.ts`, `reviewPrototypeRunner.test.ts`. Reuse `handReview.test.ts`, `HandReviewScreen.test.tsx` for default compatibility.

**PASS:** exact played amount included; equivalent engine actions equal; 11,000 and 12,000 receive excellent on supported flat reference surface although 11,063 is highest mean; 12,000 receives supported loss on the adverse surface; broad uncertainty produces unresolved; an unvisited interior never becomes a certified region; missing tolerance yields pending; cancellation preserves partial count; OOD/unsupported objectives never enter grade denominator. Real finite-poker reference and synthetic surface cases both execute. **FAIL:** subtracting error bars from point regret, arbitrary numeric distance tolerance, default UI adoption, uncertainty-as-excellence, or prototype only declared but not callable on a replay with injected provider.

### T9 — Wager reference menus (`A09`)

Existing reuse: `quantizeWager`, current candidates via policy output and `RationalWagerSizingAudit`; no `buildCandidates` strategy edits. New tests: `wagerCandidates.test.ts`, `wagerReport.test.ts`.

**PASS:** 243 ordinary target maps to feasible 250 proposal in 25-chip rack; off-rack configured legal minimum retained with exception; exact call/short all-in/blind/ante input unchanged; aliases dedup without extra mass; final proposed amounts evaluated themselves; quantity preference excluded from T8 grading. **FAIL:** post-selection cosmetic mutation, every bot rounded to 100s, unauthorized live candidate menu expansion, or declaring sampled endpoints a strategically equivalent continuum.

### T10 — Blinded critic adapter (`A10`)

Existing edits: `critic-harness.ts`/CLI adapter and tests; legacy `assertNoHiddenCards` remains. New tests: `criticInput.test.ts`, `criticAdapter.test.ts`, `criticContracts.test.ts`. Extend production-import exclusion test beyond literal `critic-harness` string to new `scripts/evaluation`/network modules; use actual import traversal/production graph where available, not just filename convention.

**PASS:** known sentinel opponent-card/seed/future-board strings cannot reach serialized request; own cards only allowed in decision/diagnosis; changing withheld truth keeps initial input identical; source flags/mode/profile ID absent; output evidence paths resolve; invalid schema creates invalid-response; fake fetch records exact request; offline path makes zero requests; report remains unvalidated. **FAIL:** weakened public validator, pass-through entire event, automatic network environment fallback, fabricated model reply or report imported into policy.

### T11 — Pilot and validation (`A11`)

Existing reuse: critic clients plus reference fixtures; T6 grouped statistics. New tests: `reviewerPilot.test.ts`, `reviewerValidation.test.ts` and small mock response/reference data.

**PASS:** manifest contains all four 50-slot strata with honest provenance; 8-case mock run works; duplicates bypass cache; transforms group with base case; names/suits/scale/irrelevant details and substantive controls all exercised; insufficient expert labels remain pending; model majority cannot create truth; a supplied fixture-only valid promotion record advances only its declared dimensions; changed fingerprint returns unvalidated. **FAIL:** “validated” because HTTP adapter works, invented expert records, numerical agreement target chosen after holdout, transformed copies counted as independent examples, or pilot completion blocking unrelated later implementation solely for missing credentials.

### T12 — Personality report (`A12`)

Existing edits: exact Normal distribution extraction in `normal.ts`, replace unsupported league quota assertions with the approved metric/contract distinctions; do not change profile settings. New tests: `personalities.test.ts`, `personalityReport.test.ts`, `timingReport.test.ts`; reuse `normal.test.ts`, `botLeague.test.ts` and session adapter tests.

**PASS:** extracted probabilities cover every actual Normal control-flow case and sum to 1; seeded actions and old fields unchanged; best/deviation branches and zero-weight fallback proven; Rational probabilities never substituted; forced/clear reference cases permit profile agreement; profile key `wideLens` maps to ID `wide-lens`; convergence/recognition without data returns unresolved; label import rejects leaked identity features. **FAIL:** changing competence budgets to force separation, inferring distinct styles from tiny exact rate differences, or hard pass threshold replacing the 3-point gap.

### T13 — Observer history (`A13`)

Existing reuse: read Normal legacy histories for comparison; use canonical capture events/session IDs, no live `publicHistory` wiring. New tests: `observerHistory.test.ts`.

**PASS:** fold/call/raise each increment pressure denominator exactly once; voluntary-entry once per observed opponent-hand; observers joining later lack earlier history; same event replay does not double count; unshown hands never increment bluff truth; posterior action counts use supplied prior and normalize; independent opponents do not share counters; next hand persists, next session resets. **FAIL:** using privileged simulation logs as observed data, treating folds as the only opportunities, silently learning across career sessions, or making live Normal consume corrected histories during this infrastructure task.

### T14 — Adaptation experiment (`A14`)

Existing reuse: `SCRIPTED_STRATEGIES`, engine runner and T7 provider; no new shipped bot. New tests: `adaptationExperiment.test.ts`.

**PASS:** paired fixed/adaptive finite reference experiment executes all stationary/switch schedule types; public histories change posterior only via declared likelihood; indistinguishable public models preserve prior odds; value-heavy jams do not get labeled bluffs automatically; after supported overbluff evidence, at least one analytically specified bluff-catching reference probe favors a wider call than fixed prior; switching to value can reverse it as evidence accumulates; opponent's ability to bluff remains identical. Reports include tradeoffs even when adaptation loses. **FAIL:** always call after N bluffs, modifying opponent actions, hiding adverse schedules, claiming general learning success from synthetic environment, or random simulation-only test with an unstable win-rate assertion.

### T15 — Integration and conformance (`A15`)

Existing edits: package scripts, new tooling TS config, both legacy gate entry points, `release-stages.mjs` and stage tests; preserve other release checks. New `run.test.ts`, `verifyEvidence.test.ts`.

**PASS:** one fixture-run command traverses all 15 outputs and prints task/evidence status without network; strict TS checks scripts; stage file/command tests cover new paths; bad artifact or invariant fails nonzero; missing required evidence returns 3; unvalidated critic yields a report without any strategy/release authority; legacy numbers and retired-gate rationale persist; CLI cannot regenerate expected baselines to pass. Source defaults and Wesley regression unchanged, build succeeds. **FAIL:** isolated unused modules with no orchestration, fake green report on skipped tasks, tests excluded from runner, opaque optional flags hiding unimplemented features, or required empirical approval automatically signed by the implementation agent.

## 14. Protected behavior / do not touch

Protected by regression tests and before/after fixture outputs: Wesley conditional 2/7 statistic and corrected utility/stack-off selection; conditional caller equity and empty-branch semantics; centralized `isStackOffCommand`; engine legality/raise rights/chip conservation; pot eligibility/refunds/odd-chip settlement; `createInformationSet` redaction; deterministic replay/version checks; current Rational and Normal RNG recipes and draw consumption; tournament smallest-chip support; exact forced/call/all-in/minimum amounts; existing six-seat lifecycle default and ante behavior.

Do not change policy candidate fractions, min-raise restrictions, temperature, equity sampling budgets, normal profile constants, response-range formula, risk premiums, exposure/reopening coefficients, tournament qualifications, Elo, payout objectives or bot display identities. Evidence can recommend those changes later, but all tasks here remain evaluation infrastructure. Blackjack, 3D assets, unrelated UI/CSS, audio and current approved build files are outside scope.

Allowed production source edits are strictly: shared pure semantics/DTOs; unchanged helper exports; additive telemetry; common traversal/adapter/selection preparation preserving defaults; and explicit nondefault full-field lifecycle options. T1/T3/T4/T6/T9/T10/T11/T13/T14 are measurement/tooling only; T2/T5/T7/T8/T12 may touch source under those restrictions; T15 changes tooling. No task activates persistent learning, new wager preference or critic control in live games.

Retiring unsupported **tests** is authorized by the governing design; deleting protection is not. Keep numerical regression fixtures independently justified, liveness budgets, legality invariants and replay compatibility. When removing an old quota assertion, add its retired registry record and the relevant evidence/contract tests in the same task.

## 15. Anticipated implementation mistakes and prevention

| Mistake / temptation | Contract prevention | Required catching test |
|---|---|---|
| Replace 20%/3-point quotas with nicer-looking percentages to keep CI green | Diagnostic registry; approved margin evidence required | A03/A15 unsupported gate has no failure authority |
| Treat `raise.to` as incremental wager because field is named amount | Canonical pre/post commitment and separate target/investment/raise-by | A02 Wesley and nonzero prior commitment |
| Count explicit all-ins as aggression, missing jam aliases | Kind plus orthogonal stack-off class | A02/A03 all-in-call and max-raise aliases |
| Measure SPR after execution because result object is handy | Captured immutable prestate; separate settlement record | A02 pre/post stack/pot mismatch fixture |
| Call actor stack effective stack to reuse old telemetry | Pairwise vector and clearly labeled summaries | A02 asymmetric stacks and all-in side-pot contestant |
| Double-count VPIP/PFR from multiple actions | Hand-level unique IDs/finalized binary outcomes | A03 two calls+raise in one hand |
| Infer 3-bet opportunity from all prior all-in labels | Full voluntary increase and legal-right filters; short sequence separate | A03 prior all-in call and nonreopened action |
| Treat no samples or zero callers as certain good behavior | Nullable coverage and explicit branch fallback/support | A06/A07 zero denominator and empty branch |
| Advertise independent reference that calls Rational utility | Injected finite-world provider and independent expected constants | A07 deliberately wrong production scoring still fails reference comparison |
| Reuse `EquityResponseSample` as full paired EV evidence | Explicit payoff-draw provider contract | A07 nonterminal missing continuation is unsupported |
| Subtract SE from regret or label uncertainty “excellent” | Simultaneous paired regret bounds and three-way outcome | A08 noisy plateau unresolved |
| Grade 12,000 by numeric distance from 11,063 | Exact played target, supported regret region | A08 flat and adverse surfaces |
| Join supported endpoints across untested valley | Lattice/certified intervals only | A08 discontinuity/unsampled gap |
| Apply human rounding to selected calls/jams | Offline proposals before evaluation, exact-action exceptions | A09 short all-in/call/minimum tests |
| Leak sampler labels, outcome or IDs to critic for a helpful prompt | Strict serializer allowlist and separate receipts | A10 sentinel serialization/permuted withheld truth |
| Validate reviewer using mock outputs or cached duplicates | State machine/human record requirement/cache bypass | A11 changed fingerprint/pending labels/duplicate request counts |
| Tune holdout or silently regenerate baseline expectations | Immutable writers, usage ledger and split checks | A04/A15 holdout-to-baseline rejection |
| Manufacture full-field completion by changing hero/clearing result | Explicit lifecycle scope, same settlement core | A05 hero bust vs remaining field |
| Publish Rational probabilities as Normal or change RNG during extraction | Shared Normal preparation, exact control-flow probabilities | A12 seeded golden branch fixtures |
| “Learn bluffs” using simulation cards or force a wider call | Observer-scoped likelihood/finite mixture; no action veto | A13/A14 hidden truth substitution and indistinguishable models |

## 16. Checkpoints and required verification

For all commands select the supported Node runtime (currently `C:/Users/19496/.local/node22`) on PATH; do not weaken the repository runtime check. A failed test means investigate and repair within task scope; do not regenerate baselines, reroll seeds, skip tests or widen thresholds. Stop dependent work only for a demonstrated architectural contradiction or an unrecoverable failure; continue independent documentation/report wiring when external evidence is pending.

| Checkpoint | Completed | Focused verification before proceeding | Exit condition |
|---|---|---|---|
| C1 | T1–T3 | A01–A03; engine betting/pots; player-count semantics; measurement and semantic all-in audit tests; Wesley fixture | Canonical alias/denominator/geometry contracts pass and artifacts cannot overwrite. |
| C2 | T4–T6 | A04–A06; session/runner/critic sampling tests; independent second seeded run; complete tiny field after hero bust | Reachability/split isolation, full-field vs hero, cluster math and raw trace reconciliation pass. |
| C3 | T7–T9 | A07–A09; Rational/equity-service/hand-review compatibility tests; Wesley; flat/adverse/noisy/unsupported surfaces | Independent reference is real, default policy unchanged, review/denomination boundaries hold. |
| C4 | T10–T12 | A10–A12; Normal/league tests; import-exclusion tests; 8-base mock pilot with transformations | No leaks/network default; all reviewer authority false; profile probability extraction preserves commands. |
| C5 | T13–T14 | A13–A14; deterministic finite adaptation probes and paired small schedules | Observer boundaries, selected-showdown caveat, belief-driven response and no live adoption proven. |
| C6 | T15/all | A15; `npm run typecheck:evaluation`; full `npm test`; `npm run build`; existing Node release-stage/production-composition tests appropriate to touched tooling; `npm run eval:fast`; all-task fixture-run | Executable integration, honest statuses, no source regressions, complete implementation conformance report. |

Each checkpoint writes receipt: commit/source hash, task IDs, exact commands and exit codes, artifacts, tests, preserved invariants, remaining empirical evidence. Do not claim 200-case expert validation from the 8-case fixture-run. Test large statistical claims in periodic/release campaigns, not ordinary unit tests. Completion of a checkpoint automatically proceeds to the next; no repeated permission requests for the already-authorized implementation work.

At implementation closeout commit task-owned work on `main`, run shortcut update, and report status. No push, history rewrite, unrelated stash/reset or blanket `git add .`. A separate live adoption would need an explicit follow-up scope and evidence; no checkpoint implicitly grants it.

## 17. Final independent conformance checklist

The reviewer must check evidence artifacts and concrete negative tests, not just changed-file count or a green suite.

- [ ] All T1–T15 have implemented entry points, task receipts and A01–A15 test mapping; none is only a type declaration or TODO.
- [ ] Production decisions/default lifecycle/replay/RNG are unchanged in pre/post fixtures; source diff contains only allowed seams/telemetry/prototype work.
- [ ] Canonical aliases, all-in calls, short raises/reopening and partial side-pot commitments reconcile with engine execution.
- [ ] Wesley current/pre-bet pot ratios and decision depth are correctly labeled; generalized deep-state families and legitimate unusual negative controls exist.
- [ ] VPIP/PFR player-hand and facing/3-/4-bet opportunities are precisely deduplicated; missing coverage is null, not zero.
- [ ] Old call/style/aggression quotas are retired with provenance; no replacement unsupported quotas in tests/config/CI.
- [ ] Full-field runs actually continue after hero exit; censored data never becomes fake placement or complete coverage.
- [ ] Common-state changes and natural state occupancy are separate reports; shared seed IDs really pair the same deals.
- [ ] Branch sample support and modeled penalties are explicit; no production utility masquerades as independent reference.
- [ ] Reference tests include genuine known-answer poker cases, side pots and hidden-world expectations, not only self-generated snapshots.
- [ ] Review v2 has real paired/exact evidence, uncertainty and OOD/pending outcomes, and preserves the 11,063/11,000/12,000 tests without numeric-distance grading.
- [ ] Regions do not certify untested amounts; unscored decisions cannot improve or worsen summary grades silently.
- [ ] Wager expansion remains offline and exact state-derived amounts are untouched; aesthetic preference cannot enter review grading.
- [ ] Actual Normal probability maps are used for Normal; style comparisons have competence and low-data caveats instead of diversity quotas.
- [ ] Serialized critic requests omit outcomes/future/opponent truth/flags/IDs; actor-view and public-only schemas are distinct.
- [ ] Pilot/mock infrastructure cannot self-promote reviewer; approvals and reference labels are real or explicitly pending.
- [ ] Transformation/duplicate controls group by base family and include substantive non-equivalent cases; cached copies do not count as repeats.
- [ ] Holdout families/usage and immutable baselines are versioned; attempted regeneration from holdout/failure data is rejected.
- [ ] Adaptive experiments learn only legitimately observed data, retain fixed controls, and never suppress another player's actions.
- [ ] Fast CI is deterministic/offline; subjective behavior is report-only without approved criteria; tooling is typechecked.
- [ ] All-task fixture command works; large-run/reference/approval gaps remain visible rather than reported as completed science.
- [ ] Original governing design unchanged; current specification deviations, if any, documented with evidence; unrelated user work preserved.

## 18. Ambiguities resolved from the governing design

| Previously open/ambiguous | Resolution for safe implementation |
|---|---|
| “Implement all tasks” vs prototype/validation/adoption | Complete all interfaces, commands and deterministic demonstrations. T8/T9/T13/T14 remain prototypes/experiments; expert/model qualification and live adoption are separate evidence states. |
| Where shared telemetry belongs | Pure source semantics/provider DTOs, Node/IO/critic work under one `scripts/evaluation` owner; no source import of scripts. |
| Actual source capabilities | Use existing `BettingActionResult`, pot primitives and player-count helpers; Normal needs exact telemetry extraction and full-field needs explicit default-preserving lifecycle option. |
| T11 statistical dependency and T15 optional dependencies | Add direct T6→T11 edge and make T15 integrate all prototypes' outputs; empirical adoption remains optional, implementation does not. |
| Facing/raise denominators and all-in aliases | Section 5 defines them, including short-increase sequences and free folds; no raw-label aggregation. |
| “Effective stack” in multiway | Pairwise remaining and contestable-additional vectors, minimum-positive/maximum SPR, pot eligibility; no single unlabeled scalar. |
| Candidate probability for Normal | Add exact probabilities from shared existing preparation; before T12 they are unavailable, never Rational substitutes. |
| General independent poker EV | Implement finite exact-world/continuation provider with explicit support, not a new solver or production self-oracle. |
| Paired interval estimator / selection bias | Frozen search/evaluation split; conservative simultaneous bounded-difference intervals in v1. Other estimators require explicit validated replacement. |
| Plateau interpolation | Supported points by default; intervals only with exhaustive lattice or certified bound. |
| New grading epsilon/severity thresholds | Required calibration artifact; no invented global value. Fixture-only synthetic tolerances exercise executable grading. |
| Human denominations after rack quantization | Offline proposals, final-size scoring, evidence-labeled preference; no live rounding or grade influence. |
| Adaptation priors and selection bias | Explicit experimental prior/config, observer histories, public-likelihood finite mixture, no unseen bluff labels or live wiring. |
| Reviewer “validated” | Fingerprint/domain-specific state machine with actual human promotion record; mock pipeline cannot grant authority. |
| Sampling mixture and prevalence | Uniform pool includes every finalized decision; preserve original selection through dedup; use that stream alone for v1 prevalence. |
| Artifact identity and baselines | Source/config content hashes, receipts separate from deterministic IDs, immutable new baselines and explicit promotion. |
| Ante/ICM/qualification support | Preserve current blind-only production sessions; label unsupported contexts; keep chip/payout/qualification units separate. |
| Runtime and scope of tests | Concrete tiers/caps with incomplete status; separate script typecheck; no flaky subjective CI. |

These decisions operationalize the approved methodology. They do not introduce new poker-strength/realism targets. If implementation discovers a genuine contradiction, preserve protected behavior, write a minimal reproducer and identify the exact conflicting requirement; do not silently choose a new methodology.

## 19. Executor handoff

Read `AGENTS.md`, the governing design and this contract. Inspect current status and preserve unrelated work. Implement in the exact order, verify every checkpoint, record all empirical gaps honestly, and continue until all T1–T15 infrastructure is integrated. Do not contact external reviewers, run paid model campaigns, promote baselines/reviewers, or adopt live strategy changes merely because the scaffolding exists. Default offline fixtures and finite known-answer examples are enough to verify every pipeline contract while leaving external evidence pending.

Final implementation report must link the all-task conformance artifact, list test/build results, identify pending empirical validation/adoption separately from completed infrastructure, report commit/status/shortcut result, and disclose any constrained implementation discretion exercised. It must answer whether the approved design was implemented, not whether many files were added.
