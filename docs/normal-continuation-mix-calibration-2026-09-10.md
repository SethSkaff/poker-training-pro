# Normal-policy calibration study — 2026-09-10

Follow-up to the [2026-09-04 forensic consolidation](poker-ai-audit-consolidation-2026-09-04.md),
which reported two residual Stage 14 findings, declined to silence them with an
action clamp, and named "an intentionally separate strategy-calibration study of
Normal/Rational separation [and] call/fold mix" as the recommended next step.
This is that study.

Both findings are now resolved, and they had one cause.

## Findings under investigation

The release behavior gate (`scripts/audit-ai-behavior-gates.ts`, eight
deterministic `ai-measure-*` seeds, frozen blind clock, `local-qualifier`,
60 simulations) reported:

| Finding | Measured | Gate band |
|---|---:|---|
| Normal call rate facing a bet | 0.115 | `[0.20, 0.65]` |
| Normal/Rational raise-back separation | 0.013 | `>= 0.03` |

Both reproduced exactly at `bcc0f05` before any change.

## Root cause: Normal was a deterministic argmax, not a policy

Normal consumes Rational's scored candidate distribution and re-selects from it.
Rational samples that distribution with a softmax at temperature 0.48 BB; Normal
took the point argmax and then allowed a rare bounded "personality deviation".
Instrumenting every decision through the production path shows the deviation
layer was inert:

| Normal, facing a bet (8 seeds, n = 8,552) | fold | call | raise |
|---|---:|---:|---:|
| action actually chosen | 0.5467 | 0.1147 | 0.3386 |
| point argmax of the same utilities | 0.5464 | 0.1125 | 0.3411 |

The chosen distribution and the argmax distribution agree to within 0.3
percentage points. Normal was not mixing at all. Two mechanisms produced that:

1. **The eligible-alternative set was almost always empty.** A deviation had to
   sit within `maxEvLossBb * bigBlind`, which is 0.06–0.36 BB per profile. The
   evaluator's own spread between its best action and the plain continuation is
   an order of magnitude larger — a median 0.49–0.64 BB in the preflop nodes
   that dominate this metric — so no alternative qualified in **83.2%** of
   decisions. Measured control flow: 65.3% `best-only`, 26.3% `forced-best`,
   8.3% `mixture`.
2. **Two hard branches removed the remaining mixing, always toward aggression.**
   `preserveAggressiveBest` forced the argmax whenever it was a bet/raise/all-in
   outside the one preflop 3-bet context, and `highLeveragePot` (postflop pot
   >= 3 BB, i.e. nearly every postflop node) filtered the deviation set to
   *aggressive* alternatives only. Together they made a fold-to-call deviation
   structurally impossible postflop and an escalate-to-continue deviation
   impossible everywhere except facing a single preflop open.

"Call" is the action that argmax structurally never selects: it is almost never
the strict maximum, but it is very often a hair behind one. That is the whole of
the 11.5%.

### Where the missing calls were

92% of "facing a bet" decisions are preflop, because every preflop actor except
an unraised big blind faces the forced blind. Splitting the metric by public
context isolates the defect to a single slice:

| Preflop slice (Normal, baseline) | n | fold | call | raise |
|---|---:|---:|---:|---:|
| Small blind, unopened pot (`toCall` = 0.5 BB) | 1,294 | 0.080 | **0.039** | **0.881** |
| Any other seat, unopened pot (`toCall` = 1 BB) | 2,879 | 0.770 | **0.000** | 0.230 |
| Facing one raise | 2,628 | 0.608 | 0.142 | 0.249 |
| Facing two or more raises | 1,085 | 0.476 | 0.221 | 0.303 |

The small blind open-raised 88.1% of unopened pots and completed 3.9%. No seat
ever open-limped. Facing an actual raise, Normal's call rate already matched
Rational's (0.142 vs 0.145) — because that is the one context where a flatting
mix had been special-cased in.

### Same cause for the separation finding

Normal's raise-back rate was its argmax raise rate (0.341); Rational's was its
softmax raise rate (0.325). Two different selection rules happened to land 1.3
points apart on the aggressive axis. The separation was small for exactly the
reason the call rate was low: Normal had no independent selection behaviour to
be separate *with*. The two findings are one finding.

## What changed

`decideNormalAction` now treats **escalating versus simply continuing as a mix,
not a competence test**, and the two hard branches above are gone.

Rational publishes a 95% uncertainty band per action (`uncertaintyBigBlinds`,
from the bounded Monte Carlo rollout). That band is now plumbed into the Normal
layer as `NormalActionEvaluation.uncertaintyChips`. When the best action is
aggressive, a passive continuation of the same pot becomes eligible for a mix
only if both of the following hold, and both read the evaluator rather than any
target frequency:

* the modeled loss is within the profile's error budget **plus the resolution of
  the comparison** (`hypot` of the two error bars — the aggressive line's bar is
  usually dominated by its response-branch sample and the continuation's by the
  showdown-equity sample, so the two are largely independent); and
* the continuation is **not resolvably losing** — its utility is not below a
  fold's zero by more than its own error bar.

The frequency on such a tie is the personality layer's own action preference,
factored out of the existing `candidateWeight` as `actionStyleWeight`; no new
tuned constant was introduced. A patient profile continues more often than a
pressure profile, and every profile still mixes both ways.

Genuine push/fold pressure (effective stack <= 24 BB) still keeps the aggressive
best line. `highLeveragePot` still governs the ordinary error-budget deviation
path; it no longer gates this one, because the two tests above already answer
what that guard was protecting against — a tied, non-losing continuation risks
*less* than the escalation it replaces and cannot be a punt.

`NormalDecision` now reports `profileEvLossBudget`, `modelResolution`, and
`usedContinuationMix` alongside `evLossBudget`, so competence reporting can keep
modeled mistakes and tie mixes apart. `botLeague`'s `deviationRate` counts only
the former; `continuationMixRate` is reported separately. `evLoss` never exceeds
the reported `evLossBudget`, which is now `profileEvLossBudget + modelResolution`.

The Normal random stream and replay policy identifiers are bumped
(`normal-policy-v2`, `normal-rational-v6`) because seeded decisions changed.

### Why this rather than a clamp

A `facingBet => call more` rule would have hit the number without answering why
the number was wrong, and it would have called with whatever hands happened to
be there. The rule adopted here cannot manufacture a call in a spot the
evaluator has actually resolved, and cannot select a continuation the evaluator
has shown to lose. Its effect is therefore concentrated exactly where the defect
was, and it is measurably *absent* where a clamp would have done damage.

## Result

Same command, same seeds, same clock. Rational is byte-identical to baseline —
nothing in its evaluator or sampler was touched.

| Frozen-clock bound | Normal before | Normal after | Rational | Band |
|---|---:|---:|---:|---|
| fold facing a bet | 0.547 | 0.591 | 0.455 | `[0.15, 0.65]` |
| **call facing a bet** | **0.115** | **0.207** | 0.220 | `[0.20, 0.65]` |
| raise-back facing a bet | 0.339 | 0.202 | 0.325 | `[0.05, 0.42]` |
| **Normal/Rational separation** | **0.013** | **0.123** | — | `>= 0.03` |
| max consecutive-raise chain | 5 | 4 | 5 | `<= 10` |
| chains of 8+ raises | 0 | 0 | 0 | `= 0` |
| preflop all-in hand rate | 0.015 | 0.011 | 0.011 | `<= 0.1` |
| postflop all-in hand rate | 0.023 | 0.027 | 0.028 | `<= 0.2` |
| flop stack-off, SPR > 20, facing <= 0.5 pot | 0.000 | 0.000 | 0.000 | `<= 0.1` |
| median raise / pot | 1.625 | 1.531 | 1.556 | `[0.2, 4]` |
| VPIP (gate's decision denominator) | 0.435 | 0.361 | 0.511 | `[0.15, 0.9]` |
| PFR (gate's decision denominator) | 0.352 | 0.203 | 0.360 | `[0.05, 0.6]` |
| 3-bet | 0.249 | 0.149 | 0.236 | `[0.01, 0.6]` |
| 4-bet | 0.389 | 0.248 | 0.357 | `<= 0.55` |
| ordinary wager denomination violations | 0 | 0 | 0 | contract |

Live-clock pacing, Normal: median hands to hero finish 42 -> 51.5, to first
elimination 11 -> 18.5, to heads-up 53 -> 59; every seed still reaches a
terminal placement.

## Evidence that this is not aggregate-metric gaming

Every decision in the eight gate seeds was re-instrumented through the
production path before and after, and read by public context rather than as one
average. The slice that produced the deficit is the slice that moved:

| Normal, facing a bet, by public context | n before / after | fold before -> after | call before -> after | raise before -> after |
|---|---|---|---|---|
| Small blind, unopened pot | 1,294 / 1,210 | 0.080 -> 0.141 | **0.039 -> 0.403** | **0.881 -> 0.455** |
| Any other seat, unopened pot | 2,879 / 3,780 | **0.770 -> 0.770** | 0.000 -> 0.057 | 0.230 -> 0.173 |
| Facing one raise | 2,628 / 2,283 | 0.608 -> 0.654 | 0.142 -> 0.196 | 0.249 -> 0.149 |
| Facing two or more raises | 1,085 / 570 | 0.476 -> 0.472 | 0.221 -> 0.319 | 0.303 -> 0.209 |
| Flop | 327 / 426 | 0.346 -> 0.390 | 0.401 -> 0.430 | 0.254 -> 0.181 |
| Turn | 181 / 330 | 0.392 -> 0.379 | 0.481 -> 0.491 | 0.127 -> 0.130 |
| River | 158 / 271 | 0.348 -> 0.387 | 0.620 -> 0.579 | 0.032 -> 0.033 |

The single clearest check is the second row. **The fold rate at an unopened
non-blind seat is identical to three decimal places.** The calibration converted
marginal *opens* into continuations; it did not talk Normal into playing more
hands. The small blind — which open-raised 88% of unopened pots and completed
3.9% — now completes 40% and opens 46%.

That second row is also where a loose-call fix would have done its damage. It is
the slice a plain temperature sampler abuses: when Rational open-limps there it
does so 12.0% of the time, at a median showdown equity of 0.242, on a call the
model rates at a median **-0.43 BB**. Roughly three of Rational's 22.0 call
points come from that one slice. Normal's rate there is 5.7%, at a median equity
of 0.342 — half the frequency with materially better hands, because the "not
resolvably losing" test refuses the rest.

### Dimensions the gate does not measure

| Normal | before | after |
|---|---:|---:|
| decisions where the actor was checked to | 2,879 | 6,228 |
| check / bet when checked to | 0.805 / 0.195 | 0.857 / 0.142 |
| — flop | 0.790 / 0.210 | 0.849 / 0.149 |
| — turn | 0.828 / 0.171 | 0.855 / 0.145 |
| — river | 0.795 / 0.205 | 0.844 / 0.155 |
| wager size / pot, p10 / p50 / p90 | 0.75 / 1.62 / 2.67 | 0.50 / 1.53 / 2.67 |
| largest wager / pot observed | 985 | 246 |
| stack-consuming aggressive actions | 64 | 63 |

Postflop volume more than doubled: continuing preflop instead of escalating
means far more hands reach a flop, which is a direct product gain as well as the
occupancy shift that carries the aggregate call rate. Sizing is unchanged in the
body of the distribution and the extreme relative-wager tail shrank. The
absolute number of stack-consuming aggressive actions is flat.

The one dimension that moved further than intended is betting when checked to,
which fell from 19.5% to 14.2% because the same tie test also applies to
check-versus-bet nodes. No gate covers it and it is consistent with a more
passive human field, but it is a real reduction in Normal's initiative and is
recorded here rather than buried.

## Holdout

A calibration that only clears the release seeds is not a calibration. The same
two bounds were re-measured on a wider sample of the gate's own seed family and
on two structures the tuning never saw (`regional-open`, 54 entrants;
`circuit-main`, 90 entrants; both with their own blind schedules and stack
depths):

| Condition | Normal fold / call / raise | n | Rational raise | call `>= 0.20` | separation `>= 0.03` |
|---|---|---:|---:|---|---|
| `local-qualifier`, 8 seeds (the gate) | 0.591 / 0.207 / 0.202 | 8,870 | 0.325 | pass (0.2070) | pass (0.1230) |
| `local-qualifier`, 20 seeds | 0.584 / 0.212 / 0.204 | 22,216 | 0.323 | pass (0.2116) | pass (0.1188) |
| `regional-open`, 8 seeds (holdout) | 0.484 / 0.280 / 0.236 | 5,959 | 0.351 | pass (0.2796) | pass (0.1150) |
| `circuit-main`, 8 seeds (holdout) | 0.504 / 0.262 / 0.234 | 8,098 | 0.356 | pass (0.2622) | pass (0.1227) |

The release seed set is the *least* favourable of the four, not the most, and
separation is stable at 0.115-0.123 everywhere. Every other frozen-clock bound
also holds in all four conditions, with zero ordinary-wager denomination
violations throughout.

Stage 15 (`audit-exploitability-gates.ts`, seven scripted counter-strategies,
six seeds each) passes for both modes. No scripted strategy wins a Normal table
(highest win rate 0.0%), the calling station finishes 5.83 of 6, and the
always-fold qualification rate against Normal is 0.0% against Rational's 66.7% --
Normal's slower field pacing removes the E11-004 fold-to-qualify exploit rather
than adding one.

## Residual concerns

* **The 0.20 lower bound has little headroom on this denominator.** Over 40%
  of "facing a bet" samples are an unopened pot at a non-blind seat, where correct
  6-max play folds roughly three-quarters of the time and calls very rarely.
  Rational clears the band partly through negative-EV open-limping. The
  [2026-09-05 evaluation design](poker-behavioral-evaluation-design-2026-09-05.md)
  already recommends retiring these as pass/fail realism bounds in favour of
  conditional distributions; this study did not act on that recommendation, and
  the bound is unchanged.
* **The evaluator discounts calling but not raising for equity realization.**
  `evaluateCallActionEv` applies `continuationRealization` (0.40–0.88 preflop);
  the called branch of `evaluateRaiseBranchEv` applies none. Directionally this
  encodes the real aggressor/caller realization asymmetry, but its magnitude is
  uncalibrated and it is why flat-calling is structurally dominated in the point
  estimates of *both* modes. It is a shared-evaluator calibration question, out
  of scope here, and it is the first place to look if preflop opening rates are
  revisited.
* The tie test treats the two error bars as independent. Where both are driven
  by the same showdown-equity sample they are not, and the true resolution of the
  difference is smaller. The direction of that error is toward more mixing.
* Profile style separation is still asserted through deviation-rate spread on 36
  canonical cells, which the evaluation design flags as arbitrary. The split into
  `deviationRate` / `continuationMixRate` preserves the original contract but
  does not make it better founded.
