# Poker AI forensic audit consolidation — 2026-09-04

## Scope and evidence

This audit started from the persisted Regional Open replay in
`%APPDATA%/poker-training-pro/saves/autosave.json`, then traced the current
TypeScript implementation and replay/measurement harness. Prior Codex-session
transcripts were not available in the repository or connected workspace; this
report therefore does not claim to have inspected them. The historical record
used here is the git history, checked-in audit documents/tests, and generated
audit artifacts that are present in the checkout.

The exact machine-readable hand record is
[`wesley-incident-forensic-record.json`](./wesley-incident-forensic-record.json).
The ignored `work/` files were temporary diagnostic captures; the tracked
record and regression fixture are the durable evidence.

The strategy and replay identifiers were bumped to `rational-v5` /
`normal-rational-v5`; the saved v4 replay remains labeled as historical evidence
and is intentionally not treated as a faithful current-build replay.

## Executive finding

Wesley was not given the wrong stack, blind unit, pot, or raise semantics. The
engine correctly executed a total-target command of `{ type: "raise", to:
24925 }`, leaving the 24,925-chip stack at zero. The incident was a layered
policy failure:

1. The response evaluator regularized the seven observed callers with twelve
   pseudo-samples from the unconditional full-range equity. In the saved seed,
   the true caller branch was `2/7 = 0.285714`; the prior changed it to
   `(2 + 12 * 0.633333) / 19 = 0.505263`, turning the all-in branch from about
   `-12.1 BB` to `+5.00 BB` before tournament/exposure charges.
2. Candidate construction always placed `legal.raise.maxTo` in the ordinary
   raise set. Because `maxTo === allInTo`, the stack-off was represented as
   `raise:maxTo`; an explicit `all-in` candidate was deduplicated. This hid the
   event from type-only all-in audits and made the semantic boundary ambiguous.
3. Commit `e578b41` removed the prior bounded re-open, credible-bluff, and
   stack-preservation protections while refactoring the same evaluator. The
   unconditional-prior error then had no nonlinear deep-stack brake.

The first incorrect numerical transformation is the unconditional prior in
`responseForCandidate`. The first structurally unsafe transformation is the
max-stack target being treated as a routine raise candidate. RNG selected the
bad tail but did not create it; the engine and UI were not the source.

## Consolidation table

| Finding / concern | Source audit or commit | Original diagnosis | Original fix | Current implementation | Still present? | Current test coverage | Confidence / notes |
|---|---|---|---|---|---|---|---|
| Raise wars / repeated escalation | `4c8e1f6`, E11-001/E11-002 in historical `TODOS.md` | Minimum-raise candidate dominance, two-outcome raise model, no stack brake, and a thin Normal wrapper produced 40–660-action chains | Added re-raise branch, credible-bluff checks, stack-preservation brake, behavior scripts/gates | Candidate max-to stack-offs are now explicit; min-target loophole when every fraction clamps to the stack cap was removed; bounded re-open and exposure pricing restored | The original 600-action mechanism is removed; high aggression in some ordinary/deep preflop tails remains measurable | `rational.test.ts`, bot league, `measure-ai-behavior`, high-SPR conditional metric, exact Wesley fixture | High for the identified mechanism; residual strategy tails are a separate risk |
| Preflop raise depth / pacing | `0b09f92`, E14 docs | Release gate sampled shallow canonical cells and did not represent realistic depth | Added preflop-depth and tournament pacing bounds | Measurement now records semantic stack-offs and deep stack geometry | The old gate’s type-only counting blind spot was present until this audit | `audit-ai-behavior-gates.ts`, measurement JSONs | High |
| Player-count/range response semantics | `c79ac41`, `docs/game-review-player-count-audit.md` from `e578b41` | Table-wide response/MDF and stale count contracts over-counted or under-counted responders | Added current-hand count semantics and public-action-conditioned ranges | `createInformationSet` redacts opponent cards; `derivePlayerCountSemantics` is checked before scoring; response opponents are current active/all-in responders | The unrelated unconditional equity prior survived the audit | `playerCountSemantics.test.ts`, rational multiway tests, Wesley fixture | High |
| Deep-stack strategy safeguards | `4c8e1f6` versus `e578b41` diff | Earlier protections charged re-opening and exposure; refactor removed them as part of a UI/showdown change | No replacement in the refactor | Restored as pure bounded utility terms; no hard SPR ban | Fixed for this failure class; no solver/ICM exists | Stack-penalty/re-open assertions and distributional metrics | High for regression history; calibration remains a risk |
| All-in accounting | `docs/normal-all-in-audit-2026-08-21.md` | Audit counted `command.type === "all-in"` | Reported 1,475 hands / 7 all-ins and no violations | `isStackOffCommand` recognizes explicit all-in, target==`allInTo`, and stack-consuming calls; scripts verify zero stack and all-in status | The old artifact is historically under-inclusive; the production measurement is corrected | `betting.test.ts`, normal-all-in audit, behavior harness | High |
| Normal/Rational distinctness | E12/E14 historical contract and `botLeague.test.ts` | Normal was intended to add bounded personality/adaptation over Rational | EV budget and named profile vectors were added | Normal still shares Rational’s scored distribution and preserves aggressive best lines in most high-leverage spots; profile vectors/deviations remain real | Partly present as an architectural limitation, not the Wesley root | Normal policy tests and bot-league profile distinctness; no strong mode-separation gate remains reliable | High |
| Human wager denomination | No previous meaningful behavioral audit; scene rack in `src/scene3d/tableScene.ts` and `settlement` defaulted to 1 | Ordinary sizing used `bigBlind / 4`, then integer rounding; at BB=75 the unit was 18.75, so values such as 243 were possible | None found in prior audits | Tournament structures carry `smallestChip: 25`; ordinary candidate targets quantize before scoring; exact calls, forced bets, min raises, short all-ins, and exact all-ins retain legal state-derived amounts | Fixed for built-in tournament structures; custom structures without a denomination intentionally fall back to 1 and should configure it | Quantization examples, chip-scale fixture, structure validation | High |
| UI/replay display mismatch | UI/release audits and saved replay | A display bug was a possible incident hypothesis | Existing action/replay path retained total targets | Saved event and post-engine stack agree; no display arithmetic mismatch found | Not implicated | Engine postcondition in fixture; existing table/replay tests | High |

Repeated findings were not all the same bug. The July raise-war audit found an
interaction between candidate geometry and a weak utility model. The August
count audit fixed responder semantics but did not test conditional caller
equity. The August 31 refactor removed the deep-stack charges that would have
limited the surviving tail. Type-only all-in measurement then made later runs
look clean even when a max-target raise had consumed the stack.

## Current decision architecture

The traced production path is:

```text
TournamentSession
  -> policyInformation()
  -> createInformationSet() [viewer cards only; public board/actions/stacks]
  -> getLegalActions() [toCall, minTo, maxTo, allInTo]
  -> sessionPolicyContext() [blind, denomination, deterministic seed, tournament context]
  -> decideRationalAction()
       -> estimateRangeEquity() / sliced equivalent
       -> buildRange() and shared response samples
       -> buildCandidates() [pot fractions, BB-like targets, explicit exact actions]
       -> responseForCandidate() [fold/call/re-raise branch probabilities]
       -> scoreCandidates() [branch EV, risk premium, re-open charge, stack exposure]
       -> normalizedDistribution() -> sampleAction()
  -> Normal mode maps Rational evaluations into decideNormalAction()
  -> applyTournamentSessionAction()
  -> applyBettingAction() [engine total-target semantics]
  -> tournament settlement / table snapshot / review payload
```

| Concept | Current meaning / unit | Guard or test |
|---|---|---|
| `streetCommitted` | Chips invested by a player on the current street | Betting-state invariant |
| `totalCommitted` | Chips invested across the hand | Pot construction / settlement |
| `pot` | Current pot at the decision boundary, chips | Equity and branch EV |
| `toCall` / `callAmount` | Incremental chips required now, chips | `getLegalActions`, call postcondition |
| `bet.to`, `raise.to` | Total target contribution on this street, chips | `requireTarget`, `applyBettingAction` |
| `additionalRisk` | Incremental chips the candidate adds, chips | Candidate builder / branch EV |
| `effectiveStack` | Minimum actor/opponent remaining active stack, chips | Rational audit metrics |
| `effectiveStackBigBlinds` | `effectiveStack / bigBlind` | Geometry regression |
| `SPR` | `effectiveStack / pot` | High-SPR behavior metric |
| `minRaiseTo` | Current bet plus last full raise increment, chips | Legal-action generator |
| `maxRaiseTo` / `allInTo` | Actor’s exact street contribution plus remaining stack, chips | `isStackOffCommand` |
| `riskPremium` | Tournament utility charge, dimensionless chip-EV fraction | `tournamentPressureAdjustment` |
| ordinary wager denomination | Configured `TournamentStructure.smallestChip` | `quantizeWager`; built-ins use 25 |

## Forensic reconstruction and hypothesis tests

The saved hand is Regional Open, first hand, six players, 50/75 blinds, 25,000
starting stacks. Hero held K♦4♣, called 75 preflop, and bet to 150 on 5♣8♥4♥.
The visible entrant rendered as Wesley is `nash-stone`, profile `tempo`, with
7♠7♥ in the model’s private information set. Immediately before the decision:

```text
pot 375, currentBet 150, Nash toCall 150
Nash stack 24,925, streetCommitted 0, totalCommitted 75
Hero stack 24,775, streetCommitted 150, totalCommitted 225
minRaiseTo 300, maxRaiseTo/allInTo 24,925
effective stack 24,775 = 330.333 BB; SPR = 66.067
```

| Hypothesis | Test | Result |
|---|---|---|
| `raiseTo`/`raiseBy` confusion | Trace `getLegalActions` → `applyBettingAction` and inspect before/after commitments | Rejected. `to` is a total street target; 24,925 is legal and leaves zero. |
| Chip/BB conversion | Compare targets, blind units, and post-action stack | Rejected. No conversion is used for execution; the exact integer target is preserved. |
| Wrong pot/effective stack/SPR | Recompute from saved commitments and independent fixture | Rejected. 375 / 24,775 / 66.067 match. |
| Legal-action generator emitted an illegal target | `getLegalActions` and engine application | Rejected. The target is legal; the semantic classification was missing. |
| Candidate sizing alone | Inspect candidate list before evaluation | Partly supported. maxTo was always a routine raise candidate and was deduplicated with all-in. It explains representation/observability, not positive EV by itself. |
| Response-equity calculation | Compare raw conditional caller branch with pre-fix regularization | Confirmed. `2/7` became `.505263` through the unconditional 12-sample prior; this is the first wrong numerical transformation. |
| Personality/name/reputation | Rename entrant and compare fixed-seed decision; inspect Normal wrapper | Rejected as trigger. Name is not a strategy input; Normal preserved the Rational aggressive best in this spot. |
| RNG | Repeat fixed seed and vary seed | RNG is the selector of a bad candidate tail, not the source of its attractiveness. |
| Execution/UI | Inspect engine event, post-state, replay/table path | Rejected. Engine and displayed total target agree. |

## Reproduction and distributional results

The tracked fixture in `src/modes/wesleyIncident.test.ts` reconstructs the
public state, hidden model cards, deterministic seed, 60 simulations, legal
geometry, response branch, and engine semantics. It asserts conditional caller
equity `2/7`, a negative stack-off utility after the corrected charges, a
non-stack-off selection, display-name invariance, and 10× chip-scale
invariance.

The current frozen-clock run (`8` deterministic `ai-measure-*` seeds, 400-hand
cap, 60 simulations) produced:

| Mode | Hands | Decisions | Max raise chain | Chains ≥8 | Facing bet fold/call/raise | Preflop stack-off hand rate | Postflop stack-off hand rate | High-SPR flop / small facing stack-offs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Normal | 1,847 | 8,552 | 5 | 0 | 54.7% / 11.5% / 33.9% | 1.48% | 2.30% | 129 / 0 |
| Rational | 2,221 | 10,517 | 5 | 0 | 45.5% / 22.0% / 32.5% | 1.08% | 2.79% | 542 / 0 |

Raise-over-pot medians were 1.625 (Normal) and 1.556 (Rational); no
`SPR > 20`, flop, facing-≤0.5-pot stack-off occurred in this run. All semantic
stack-offs in the corrected normal audit had legal targets, zero stack after,
and `status: all-in` (the `normal-all-in-audit-v2` semantic classifier; a
separate four-seed, 434-hand frozen legality audit verified 26 stack-offs and
zero violations). The historical August artifact’s seven all-ins was not a
contradiction: it counted only explicit `all-in` command types and could miss
`raise:maxTo`.

The remaining aggregate warning is not the Wesley tail: Normal’s current
facing-bet call share is 11.5% and its Rational separation is small because the
Normal layer intentionally preserves aggressive Rational best lines in
high-leverage pots. The measurement is retained as a methodology risk rather
than “fixed” by a hard action clamp.

> **Resolved 2026-09-10.** Both findings had one cause -- Normal’s selection
> rule was the point argmax of Rational’s utilities, with an eligible-deviation
> set that was empty in 83% of decisions and two hard branches that removed the
> rest in the aggressive direction. See the
> [Normal-policy calibration study](normal-continuation-mix-calibration-2026-09-10.md).
> Call rate 0.115 -> 0.207, separation 0.013 -> 0.123, with no clamp and no
> change to Rational.

The revised eight-seed behavior/pacing gate was run end-to-end. All deep-tail,
raise-chain, aggregate all-in, and pacing bounds passed. It correctly remained
red for two independent residual findings: Normal facing-bet calls at 11.5%
(historical lower band 20%) and Normal/Rational raise-back separation of 1.3
percentage points (required 3 points). Those failures are reported rather than
silenced; they are outside the Wesley root cause and are the recommended next
calibration study.

## Independent internal review

The implementation-forensics review independently found the persisted replay,
correct total-target engine behavior, max-target candidate ambiguity, and the
unconditional prior as the positive-EV cause. The strategy/methodology review
independently found the removed pre-`e578b41` deep-stack safeguards, the
under-powered canonical league, and the need for a semantic stack-off
classifier. They agreed on a multiple-interacting-causes classification. No
unresolved disagreement remained after the saved-state replay and fixed-seed
tests.

## Human bet-denomination audit (separate dimension)

Before this audit, `rational.ts` rounded ordinary desired sizes to
`bigBlind / 4` and then to an integer. At BB=75 that is an 18.75-chip unit, so
floating percentage output could become values such as 243. The scene already
showed a rack containing 25-chip increments, but denomination was not part of
the tournament structure and settlement defaulted to one chip.

The current path is:

```text
abstract fraction / desired target
  -> legal-bound clamp
  -> configured smallest-chip quantization
  -> candidate scoring and selection
  -> exact engine target
```

Built-in tournament structures now declare `smallestChip: 25`; custom
structures can declare another positive safe integer. Ordinary examples map as
`243→250`, `487→475`, `1,037→1,025`, `2,413→2,425`, and `6,243→6,250` on a
25-chip rack. Calls, blinds/antes, forced bets, minimum raises, short all-ins,
and exact remaining-stack all-ins are not cosmetically rounded. No global
“ends in 00/50” rule was added, so strategic distortion remains bounded to at
most half a rack chip before legal-edge clamping.

The production measurement now records ordinary bet/raise amounts separately
from stack-offs. A two-seed frozen run (local qualifier, 1,194 Normal wagers
and 761 Rational wagers) found zero denomination violations in either mode;
the final digits were 0/5 only (Normal 762/432, Rational 451/310), which is
the expected consequence of a 25-chip rack and still includes both 0 and 5
rather than forcing every amount to a 00/50 convention. The metric is exposed
by `scripts/report-ai-behavior.ts` for larger samples and other structures. Of
the selected ordinary wagers, 1,155/1,194 Normal and 692/761 Rational retained
abstract-target telemetry; mean absolute rack adjustments were 4.86 and 5.99
chips respectively (maximum 12.5 in both), while mean absolute executed-target
adjustments were 4.92 and 6.03 chips (maximum 17). These are measured
quantization/clamping deltas, not a claim that every candidate is human-optimal.

The old policy did not retain the raw pre-quantization target, so a historical
population-wide distortion number cannot be recovered exactly. The new pure
quantizer gives the hard bound (nearest-rack adjustment is at most half a
denomination), and future telemetry can add the raw target if strategic-size
calibration needs a separate distortion histogram.

This is physical-denomination realism, not strategic plausibility. A 24,925
all-in is denomination-realistic on a 25-chip rack while still strategically
absurd at 66 SPR; the two dimensions are deliberately tested separately.

## Fix and permanent coverage

The smallest architecture-correct fix has four parts:

- response equity is conditional on the sampled call/re-raise branch, with the
  unconditional equity retained only as an empty-branch fallback;
- all-in-equivalent max targets are explicit semantic all-in candidates, while
  ordinary candidates cannot reintroduce the max-target/min-raise loophole;
- bounded re-open and nonlinear stack-exposure charges were restored in
  `scoreCandidates` as auditable utility terms, without a global SPR ban;
- tournament denomination is configurable and ordinary candidate targets are
  quantized before evaluation; exact rule-derived amounts remain exact.

Permanent tests now cover:

- exact saved-state Wesley geometry, response `2/7`, negative corrected
  stack-off utility, and non-stack-off selection;
- semantic stack-off detection for explicit all-in, max-target raise, and
  stack-consuming calls;
- legal postcondition/chip conservation for the engine;
- display-name invariance and 10× chip-scale invariance;
- ordinary rack quantization plus exact all-in preservation;
- multiway conditional response equity and public-information invariance;
- frozen whole-tournament distributional metrics, including the requested
  high-SPR flop/small-facing conditional tail;
- named-profile EV budgets and existing engine/review/tournament/UI suites.

## Remaining risks and recommendation

Evidence-supported risks that remain are:

- Normal was still a thin wrapper over Rational in high-leverage spots, so its
  aggregate call share and mode separation needed deliberate calibration rather
  than a Wesley-specific clamp. That study was carried out on 2026-09-10; see
  the [calibration study](normal-continuation-mix-calibration-2026-09-10.md),
  whose own residual risks supersede this entry;
- the strategy is Monte Carlo/range-heuristic based, not a solver or full ICM
  model, and 60-sample narrow branches carry material uncertainty;
- custom tournament structures that omit `smallestChip` intentionally retain
  one-chip precision and should configure their physical rack;
- large multiway/deep-stack distributional samples should be expanded before
  release calibration is treated as stable.

Another external methodology audit is not warranted immediately for the same
incident: the root cause is reproduced, fixed, and regression-covered. The
next useful step is an intentionally separate strategy-calibration study of
Normal/Rational separation, call/fold mix, and ICM/deep-stack benchmarks using
larger seeded samples. That study should consume the semantic metrics here
instead of starting another anecdotal playtest.

The Normal/Rational separation and call/fold half of that recommendation was
completed on 2026-09-10 and is written up in
[`normal-continuation-mix-calibration-2026-09-10.md`](normal-continuation-mix-calibration-2026-09-10.md).
The ICM and deep-stack benchmark half remains open.
