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
