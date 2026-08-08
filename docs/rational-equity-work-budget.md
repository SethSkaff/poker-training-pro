# Rational equity work budget and UI-thread audit

## Finding

Rational policy was the material UI-thread risk. Each decision ran a synchronous
range-aware Monte Carlo loop with a default of 700 simulations and an accepted
maximum of 20,000. Every trial selects opponent combinations, constructs a
runout, and evaluates the hero plus every live opponent. Normal policy does not
run Monte Carlo; it consumes already-scored legal actions.

The current synchronous tournament engine calls `decideRationalAction` in the
same call stack that advances a hand. Converting that contract to a worker or
promise safely also requires an explicit pending-policy state, stale-result
rejection, save/replay semantics, cancellation, and renderer integration.
Those cross-owner changes are not made here.

## Implemented boundary

- A Rational decision now fails closed above 1,200 simulations instead of
  accepting 20,000.
- Work advances in deterministic slices of 16 simulations by default. A slice
  may contain at most 32 simulations.
- `estimateRangeEquitySliced` yields only between completed-simulation-count
  boundaries. It never reads elapsed time. A caller can inject its scheduler;
  the default yields with a zero-delay task.
- The public information set is cloned before the first slice, so caller
  mutation during a yield cannot alter later samples in that request.
- Synchronous `estimateRangeEquity` and current `decideRationalAction` retain
  the existing engine contract while using the same state machine.
- Every estimate reports requested/completed simulations, slice size/count,
  exact hand-evaluation count, caps, and the count-based scheduling policy.
  Rational decision audit exposes these values as `equityWork`.
- Slice size changes scheduling and instrumentation only. The seed stream,
  opponent sampling, runouts, equity, action distribution, and chosen action
  remain identical.

The 1,200-simulation ceiling is an engineering work limit, not a claim that
1,200 samples are statistically sufficient for every poker question. Product
accuracy decisions require a separate error/latency study.

## Deterministic tests

The Rational suite verifies:

- identical equity outcomes at slice sizes 1 and 32;
- identical synchronous and async-sliced results;
- immunity to caller mutation of the original information set during a yield;
- yields occur exactly between slices, never based on time;
- the per-decision and per-slice limits reject excess work;
- fixed-seed chosen action, distribution, metrics, ranges, and explanation are
  identical across slice boundaries;
- the frozen bot-league baseline and tournament policy adapters remain green.

## Local profiling

Run the non-gating profiler with the supported Node runtime:

```powershell
& "C:\Users\19496\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  ".\node_modules\vite-node\vite-node.mjs" `
  ".\scripts\profile-rational-equity.ts"
```

It reports five-run observed timing ranges at 50, 200, 700, and 1,200
simulations plus exact work counts. Wall-clock observations vary by machine and
load and are never used to stop a simulation or select an action.

One local Windows x64 / Node 24.14 run of the fixed two-opponent fixture measured
median synchronous times of 40.131 ms, 119.452 ms, 381.923 ms, and 663.044 ms
respectively. These observations demonstrate why the async integration remains
necessary; they are not portable acceptance thresholds.

## Remaining integration

Before claiming the UI thread is fully protected:

1. Add an async Rational policy boundary around the tournament runner, or a
   versioned worker request/response protocol.
2. Persist a pending policy request using only public information, seed,
   simulation count, policy version, and request ID; never serialize hidden
   deck state into renderer-visible data.
3. Reject stale worker results after navigation, restart, hand advancement, or
   request cancellation.
4. Make replay record the fixed work budget and seed, not elapsed time.
5. Add packaged desktop measurements for input delay and long tasks at default
   and maximum work, including low-end supported hardware.

Until that integration is complete, the synchronous path is capped and
measurable but can still occupy its calling thread for the bounded duration.
