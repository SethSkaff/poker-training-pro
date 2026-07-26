# Bot league and balance-regression harness

`src/modes/botLeague.ts` is the deterministic, offline balance gate for current
Rational and Normal policies. `src/modes/fixtures/bot-league-baseline.json` is
the frozen report that must be reviewed and deliberately replaced when a
balance change is accepted.

## Coverage

- 36 canonical decision cells: three table positions, three effective stack
  depths, and all four streets.
- Rational selected and probability-weighted action distributions, equity and
  required-equity audit values, effective stack, position, and SPR.
- Every named Normal profile, sampled with 12 fixed public seeds per cell:
  action distribution, best-action/deviation rates, mean/max EV loss, and hard
  EV-budget breaches.
- 1,200 fixed presentation-timing samples measuring Pearson correlation between
  delay and cutoff closeness, uncertainty, and the eventual action class.
- Six fixed, shallow six-seat tournaments per policy mode. They exercise the
  real session, betting, equity, policy, pot, showdown, and elimination paths
  and report hero finish, hands, and policy-decision counts.

No wall-clock values, platform data, opponent hidden cards, or unseeded random
sources enter the report.

## Gate behavior

Run:

```powershell
npx vitest run src/modes/botLeague.test.ts
```

The test suite checks both:

1. exact equality with the frozen JSON report, so a policy or balance change
   cannot silently move any tracked distribution; and
2. semantic safety thresholds for action normalization, Normal EV budgets,
   weak cutoff/uncertainty timing correlation, tournament completion, and the
   bounded decision cap.

When an intentional balance change fails the exact baseline comparison, inspect
the full diff, run the ordinary policy/session suites, and have a reviewer
approve the distribution changes before replacing the baseline JSON.

## Baseline replacements

### 2026-07-25 — E11-002 policy correction

The first sanctioned replacement since the baseline was frozen. The 2026-07-25
gameplay review measured a 631-action consecutive-raise chain and a 94%
raise-back rate; `rational.ts` was corrected for all four documented root
causes (minimum-raise candidate dominance, a two-outcome raise-utility model
that ignored being re-raised, an absent stack-preservation brake, and the
personality layer having nothing to choose from).

Whole-tournament measurement before and after, 8 seeds per mode, blind clock
frozen (`npm run measure:ai -- --seeds 8`):

| Metric | Normal before | Normal after | Rational before | Rational after |
|---|---|---|---|---|
| Max consecutive-raise chain | 631 | **3** | 599 | **3** |
| Chains >= 8 | 34 | **0** | 25 | **0** |
| Facing a bet: fold / call / raise | 3 / 3 / 94% | **40 / 42 / 19%** | 7 / 13 / 80% | **30 / 43 / 27%** |
| Preflop all-in hand rate | 21.0% | **0.3%** | 21.2% | **0.0%** |
| Median hands to finish | 8 | **42.5** | 9 | **36** |

Baseline-report changes accepted with it:

- Rational's canonical-cell action mix moved from 58% raise / 31% call to
  6% raise / 83% call. The cells are predominantly marginal spots facing a bet,
  where calling is the correct line; the previous raise share was the defect.
- Normal profile `selectedBestRate` rose to 0.977-0.998. The gate's former
  `<= 0.98` upper bound was calibrated against the miscalibrated utility model,
  which produced many near-ties. With the corrected model the median gap to the
  second-best action across the 36 cells is 1.05 BB, so a competent
  professional should take the best line in almost all of them. The bound was
  replaced by a direct distinguishability assertion (loosest profile deviates
  > 2%, and the spread between loosest and tightest exceeds 4x), which is what
  the original bound was proxying for.
- Tournament sections moved (`rational.meanHands` 3.2 -> 4.2,
  `normal.maxDecisions` 150 -> 122), consistent with slower, less explosive
  play.

Interaction-level behavior is now additionally gated outside this harness by
`scripts/audit-ai-behavior-gates.ts`, which the release verification runs; the
league remains the decision-level sentinel.

## Current boundary

The application currently exposes one Rational implementation version
(`rational-v1`) and one Normal implementation seeded as `normal-policy-v1`.
Therefore the harness compares the current implementation against its frozen
versioned report and compares all current Normal profiles; it cannot run an
older executable policy implementation side-by-side because no policy registry
or retained legacy implementation exists. Do not claim cross-version executable
A/B simulation until such a registry is introduced.

The tournament sample is deliberately shallow and small. It is a deterministic
regression sentinel, not statistical proof that one policy is stronger. Larger
league calibration belongs in an opt-in developer benchmark so normal CI stays
bounded.
