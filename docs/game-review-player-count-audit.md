# Game Review state and EV audit

Status: implemented and verified 2026-08-31

## Root causes

The main confirmed defect was an ambiguous count contract. The tournament
roster and the current hand were both exposed as generic “players remaining”
values, and the prominent review/table copy could therefore present a
tournament survivor count as if it described the hand being evaluated. A
zero-stack all-in was also at risk of being treated as eliminated before the
hand settled when callers counted positive stacks instead of tournament status.

The evaluator had separate weak heuristics for response fold frequency and
action EV. In particular, the old response model applied a table-wide
minimum-defence root, while review prominently showed the chosen action's fold
percentage and could explain a different recommended action's percentage
without naming that distinction. Raw showdown equity was also used too
directly for ordinary deep-stack calls and raises. These were modeling and
explainability defects, not just cosmetic defects.

The range estimator is still a bounded heuristic rather than a solver. There
is no trusted preflop chart/solver lookup in this repository to query. That is
now explicit: preflop reviews identify themselves as a
`preflop-continuation-rollout`, rather than silently claiming chart-backed
strategy.

## State contract

`src/lib/playerCountSemantics.ts` is the shared boundary for count meaning:

| Name | Owner | Meaning | Used for |
| --- | --- | --- | --- |
| `tournamentPlayersRemaining` | tournament roster | Survivors across the event, including a zero-stack all-in until settlement | Bubble/qualification/ICM-inspired pressure, phase, explicit tournament UI |
| `playersDealtIn` | current hand | Seats that began this hand; folded players remain included | Table-size context and review explanation |
| `activePlayersInHand` | current hand | Dealt-in players not folded at this decision, including hero | Multiway state and current-hand UI |
| `activeOpponents` | current hand | Active current-hand players other than hero | Equity/multiway context and SPR inputs |
| `opponentsAbleToRespond` | candidate action | Active opponents with chips who face a new wager target | Immediate fold/call/re-raise response modeling |

`opponentsAbleToRespond` is intentionally candidate-specific. It excludes
folded, out, and already all-in players, and excludes a player whose existing
street commitment already covers the candidate target. Already all-in players
still participate in showdown equity and side-pot accounting; they simply do
not add immediate fold equity.

The tournament session supplies the first value from its roster and supplies
the hand information set from the hand ledger. No current-hand quantity is
derived from the tournament survivor count. Presentation snapshots may retain
out seats for stable chair geometry, but those seats are excluded from
`playersDealtIn`.

## Evaluation pipeline after the repair

The pipeline is:

```text
hand ledger + public actions
  -> explicit current-hand counts
  -> action-conditioned opponent ranges
  -> shared seeded multiway equity samples
  -> candidate-specific response branches
  -> chip EV in chips
  -> convert to BB
  -> apply separate tournament risk premium
  -> rank, classify with uncertainty, explain, render
```

### Equity and ranges

`estimateRangeEquity` takes only the viewer's information set. Its opponent
population is the current hand's non-folded, non-out players, not the
tournament roster. Hidden opponent combos are weighted using public actions;
checks, calls, bets, raises, and all-ins condition the range summary. A shared
joint sample records each opponent's range quantile and showdown result, so
multiway collision-free card sampling and candidate response evaluation use
the same outcomes.

The estimate names its primary quantity `showdownEquity`: the hero's share of
the pot if the sampled current-hand opponents reach showdown. It is not action
EV, and the UI no longer calls it generic “equity you had.”

### Preflop

The review derives context-aware labels such as open-fold, open-limp,
open-raise, limp-call, limp-raise, overcall, 3-bet, and 4-bet+. An unopened
preflop `call` from the betting engine is therefore displayed as an
`open-limp` when that is what the ledger means.

For a non-all-in preflop call, immediate pot odds remain a reference statistic;
the EV uses a bounded future-street realization factor based on current-hand
position, effective stack depth, and multiway context. It does not add an
arbitrary “implied odds bonus” or treat a deep-stack limp as an all-in call.
For a river call or a call that consumes the relevant stack, the showdown
threshold is marked applicable. The source remains the conservative rollout
fallback until a validated chart/solver node is added.

### Postflop calls and raises

Calls use the pot-commitment equation in the units shown by the audit:

```text
EV(call) = showdownEquity * (pot + callAmount) * realization - callAmount
```

For a bet, raise, or all-in, each candidate builds mutually exclusive sampled
branches: all opponents fold, one or more continue without a re-raise, or at
least one eligible opponent re-raises. The canonical branch equation is:

```text
EV(wager) =
  P(all fold) * pot
  + P(call) * (equityWhenCalled * (pot + risk + expectedOpponentContribution) - risk)
  + P(re-raise) * (-risk)
```

`risk` is the additional hero commitment, not the raise-to total. Previously
committed chips are sunk at the decision boundary. The conservative re-raise
branch stops at this hero decision and therefore cannot manufacture future
equity.

Fold equity is one canonical `allFoldProbability` value. In a multiway hand,
the all-fold event is sampled jointly across only the candidate's responding
opponents; it is never a heads-up fold percentage copied to the whole table.

### SPR and tournament pressure

Effective stack and SPR use the hero's stack capped by the smallest positive
stack of the current hand's active opponents who can contest the relevant
side pot. Tournament survivors do not affect this cap. Out/all-in players can
remain in the showdown population while contributing no new betting depth.

The tournament risk premium is applied only after base chip EV is calculated.
`tournamentPlayersRemaining` may change the ICM-inspired risk adjustment,
blind urgency, and review phase, but it cannot change the current-hand ranges,
equity population, response population, or heads-up/multiway arithmetic.
The app labels this as tournament pressure, not solver-quality ICM.

### Uncertainty and explanations

Equity reports a standard error and clamped 95% confidence interval. Review
actions carry approximate BB uncertainty, expose the same response audit used
by EV, and classify EV regret only after subtracting the relevant uncertainty
margin. Close noisy actions are therefore not presented as precise blunders.
The explanation layer reads branch probabilities, conditional equity, EV, and
uncertainty from the candidate audit; it does not calculate a second fold
percentage.

## UI contract

Prominent hand/review copy now says, for example:

```text
2 players in hand · 1 active opponent · 2 dealt in · 6 players remaining in tournament
```

The live table similarly shows the current-hand count separately from the
tournament count. Tournament-only copy explicitly says “in tournament.” No
generic `playersRemaining` field remains in the Game Review/table path.

## Regression coverage

The required invariant is covered by `src/lib/playerCountSemantics.test.ts`
and the rational integration test: six tournament survivors can coexist with
six dealt-in seats of which only hero and one villain are active. The tests
verify one current opponent range, heads-up equity/response sampling, one
immediate responder, explicit UI counts, and stable current-hand outputs when
only the tournament count changes. Branch EV, call EV, joint all-fold
probability, preflop naming, action-conditioned ranges, deterministic slices,
redaction, and all-in settlement semantics are also covered by focused tests.
