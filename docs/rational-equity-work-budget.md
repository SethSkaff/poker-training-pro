# Rational equity execution budget and UI-thread audit

Status: current implementation, reviewed 2026-08-23

## Current policy and hard limits

The live tournament UI explicitly requests **60 simulations per opponent
decision** and records that count in the replay boundary. The estimator's
library default is 700 for callers that omit a value, while the enforced
engineering ceiling is 1,200 simulations per decision. The ceiling is a
safety limit, not the live budget and not a claim that 1,200 samples are
statistically sufficient for every poker question.

Every estimate advances in deterministic simulation-count slices: 16
simulations per slice by default and no more than 32. Slicing changes scheduling
and work telemetry only. It never reads wall-clock time and does not alter the
seeded sample stream, equity result, action distribution, or chosen action.

Each estimate reports requested/completed simulations, slice size/count, exact
hand-evaluation count, and the applicable caps through `equityWork` audit data.
The same sampled runout also records only an opponent's public-range quantile
and its showdown comparison with hero. Every legal wager reuses those compact
statistics to retain the strongest minimum-defence range, producing audited
fold/call/re-raise frequencies and equity conditional on continuation without
adding simulations or hand evaluations.
The public information set is cloned before the first slice, so caller mutation
during an asynchronous request cannot change later samples.

## Execution topology

| Runtime | Estimator used by live progression | UI-thread consequence |
| --- | --- | --- |
| Browser renderer without `window.desktop` | Vite module Web Worker | Monte Carlo runs off the renderer thread. |
| Electron renderer with the desktop bridge, including the packaged Windows app | Deterministic synchronous fallback | The bounded Monte Carlo runs on the renderer thread. |
| Unit tests or runtimes without `Worker` | Synchronous fallback unless a worker factory is injected | The calling thread performs the work. |

Electron takes the fallback deliberately. Its sandboxed module-worker bootstrap
currently emits a `sandbox_bundle` `startupData` error in packaged builds. The
service therefore does not attempt a worker whenever the desktop bridge is
present. This avoids a known-broken bootstrap, but it also means the packaged
app cannot yet claim complete UI-thread isolation.

Both execution paths use the same serializable request and estimator state
machine. For fixed public information, legal actions, seed, simulation count,
and slice size, worker and synchronous results are bit-for-bit identical.

## Cancellation, staleness, and persistence

The worker-backed service assigns a token to each request and permits one live
request by default. A newer request rejects the previous promise as stale and
sends a cancellation message. Explicit cancellation rejects the promise, and
the worker observes cancellation between completed slices. Responses for
already cancelled or superseded tokens are dropped.

The tournament runner also checks an abort signal before applying an awaited
policy result. Pausing or disposing the table invalidates the current worker
request, leaving the authoritative runner at the previous committed boundary.

The synchronous Electron fallback is importantly different: its estimate
finishes in the call that starts it, before another renderer event can request
cancellation. `cancelPending()` therefore cannot preempt work already executing
on that path. The 60-simulation live budget and 1,200 ceiling bound the exposure,
but neither is a substitute for moving the packaged path off-thread.

No partially completed Monte Carlo state or worker token is persisted. Saves
and replays retain the deterministic runner inputs and policy simulation count;
work interrupted before a decision is committed is recomputed from the saved
runner boundary rather than resumed mid-slice.

## Deterministic coverage

The Rational and equity-service suites verify:

- identical equity outcomes across slice sizes and between synchronous and
  worker-backed estimators;
- immunity to caller mutation of the original information set during a yield;
- yields occur at completed-simulation boundaries rather than elapsed-time
  thresholds;
- rejection above the per-decision and per-slice limits;
- identical fixed-seed decision, distribution, metrics, ranges, explanation,
  and audit across the async boundary;
- explicit cancellation, supersession, and late-result rejection;
- tournament-runner aborts do not apply an obsolete awaited decision; and
- frozen bot-league and replay compatibility gates remain deterministic.

## Profiling

Run the non-gating profiler with the repository's supported Node runtime:

```powershell
npm run check:runtime
node node_modules/vite-node/vite-node.mjs `
  -c scripts/vite-node.config.mjs `
  scripts/profile-rational-equity.ts
```

The profiler reports repeated observations at 50, 200, 700, and 1,200
simulations plus exact work counts. Measurements vary by machine and load and
are never used to terminate a simulation or select an action. Profile the live
60-simulation policy separately when collecting packaged interaction evidence.

## Remaining packaged UI-thread work

Before claiming that Rational equity cannot block player interaction:

1. Restore a functioning off-renderer estimator under the hardened packaged
   Electron sandbox, or replace the module-worker bootstrap with an equally
   isolated supported boundary.
2. Prove request cancellation and stale-result rejection through that actual
   packaged boundary, including pause, quit, restart, and hand advancement.
3. Capture packaged input-delay and long-task evidence at the live 60-simulation
   policy and at the 1,200-simulation ceiling on low-end supported hardware.
4. Keep replay/save recovery deterministic without serializing hidden deck
   state or partially completed worker state.
5. Re-run the accuracy/latency study before increasing the live simulation
   policy; the hard ceiling alone is not an accuracy target.

Until those items are complete, browser-only execution is worker-backed while
the packaged Electron path remains synchronous, deterministic, capped, and a
known bounded renderer-thread risk.
