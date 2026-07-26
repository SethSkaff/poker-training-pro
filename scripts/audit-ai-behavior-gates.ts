/**
 * E14-001 — statistical regression gates for AI behavior.
 *
 * The bot league (`src/modes/botLeague.ts`) freezes *decision-level* output on
 * 36 canonical cells. It cannot catch a pathology that only emerges from
 * repeated interaction, which is exactly what the 2026-07-25 review found: a
 * 631-action raise chain and a 94% raise-back rate produced by policies whose
 * individual decisions each looked defensible.
 *
 * This gate therefore measures whole tournaments and asserts documented
 * tolerance bands rather than single anecdotes. Every bound below carries the
 * reason it exists and the value measured when it was set, so a future change
 * that trips it can be judged rather than merely silenced.
 *
 *   vite-node scripts/audit-ai-behavior-gates.ts
 */

import { measureAiBehavior, type AiBehaviorMetrics } from "./measure-ai-behavior";

const SEEDS = 5;

interface Bound {
  label: string;
  value: (metrics: AiBehaviorMetrics) => number;
  min?: number;
  max?: number;
  /** Why this band, and what was measured when it was set. */
  rationale: string;
}

/**
 * Measured on 2026-07-25 after the E11-002 policy corrections, 8 seeds per
 * mode, blind clock frozen:
 *
 *                          Normal            Rational      (pre-fix Normal)
 *   max raise chain        3                 3             631
 *   chains >= 8            0                 0             34
 *   facing bet f/c/r       40/42/19%         30/43/27%     3/3/94%
 *   preflop all-in rate    0.3%              0.0%          21.0%
 *   raise/pot median       1.00              1.00          0.50 (min-raise)
 *   hands to finish        42.5              36            8
 *
 * The bands are set well outside those values so ordinary tuning does not trip
 * them; they exist to catch a return of the pathology, not to freeze the
 * current numbers.
 */
const BOUNDS: Bound[] = [
  {
    label: "max consecutive-raise chain",
    value: (metrics) => metrics.maxRaiseChain,
    max: 10,
    rationale:
      "Chains of 40-660 were the headline defect. Real poker tops out around a 5-bet; 10 leaves room for a legitimate deep sequence.",
  },
  {
    label: "chains of 8 or more raises",
    value: (metrics) => metrics.chainsAtLeast8,
    max: 0,
    rationale: "An 8-raise street is not a real poker sequence at any stack depth.",
  },
  {
    label: "raise-back rate facing a bet",
    value: (metrics) => metrics.facingBet.raise,
    min: 0.05,
    max: 0.42,
    rationale:
      "94% was trivially exploitable; 0% would be a passive punching bag. Human 6-max sits near 10-20%.",
  },
  {
    label: "call rate facing a bet",
    value: (metrics) => metrics.facingBet.call,
    min: 0.2,
    max: 0.65,
    rationale: "Calling was 2.5% before the fix -- the table never simply continued.",
  },
  {
    label: "fold rate facing a bet",
    value: (metrics) => metrics.facingBet.fold,
    min: 0.15,
    max: 0.65,
    rationale: "A field that never folds cannot be outplayed; one that always folds is free money.",
  },
  {
    label: "preflop all-in hand rate",
    value: (metrics) => metrics.preflopAllInHandRate,
    max: 0.1,
    rationale:
      "21% of hands contained a preflop all-in at 300 BB depth. Deep-stacked fields should almost never get it all in before the flop.",
  },
  {
    label: "postflop all-in hand rate",
    value: (metrics) => metrics.postflopAllInHandRate,
    max: 0.2,
    rationale: "All-ins should exist, but not dominate the postflop game.",
  },
  {
    label: "median raise size over pot",
    value: (metrics) => metrics.raiseOverPot.median,
    min: 0.2,
    max: 4,
    rationale:
      "A median of 0.01 proved minimum-legal raises dominated the candidate set, which is what made escalation arithmetic rather than geometric.",
  },
  {
    label: "VPIP",
    value: (metrics) => metrics.vpip,
    min: 0.15,
    max: 0.9,
    rationale:
      "Measured across every preflop decision (not first-action only), so the band is wider than a standard VPIP statistic.",
  },
  {
    label: "PFR",
    value: (metrics) => metrics.pfr,
    min: 0.05,
    max: 0.6,
    rationale: "Aggression must exist without dominating.",
  },
  {
    label: "median hands to finish a 6-max event",
    value: (metrics) => metrics.handsToFinish.median,
    min: 15,
    max: 140,
    rationale:
      "A median of 8-9 hands meant the entire field busted before the player could play poker. E13's pacing target lives here.",
  },
  {
    label: "median hands to first elimination",
    value: (metrics) => metrics.handsToFirstElimination.median,
    min: 2,
    rationale: "A field losing a player in hand 1-2 every time is mutual over-aggression, not variance.",
  },
];

function check(metrics: AiBehaviorMetrics): string[] {
  const failures: string[] = [];
  for (const bound of BOUNDS) {
    const value = bound.value(metrics);
    const belowMin = bound.min !== undefined && value < bound.min;
    const aboveMax = bound.max !== undefined && value > bound.max;
    const band = `[${bound.min ?? "-inf"}, ${bound.max ?? "inf"}]`;
    const status = belowMin || aboveMax ? "FAIL" : "ok  ";
    console.log(
      `  ${status} ${bound.label.padEnd(38)} ${value.toFixed(3).padStart(8)}  ${band}`,
    );
    if (belowMin || aboveMax) {
      failures.push(
        `${metrics.mode}: ${bound.label} = ${value.toFixed(3)}, expected ${band}. ${bound.rationale}`,
      );
    }
  }
  return failures;
}

const failures: string[] = [];
const measured: AiBehaviorMetrics[] = [];

for (const mode of ["normal", "rational"] as const) {
  console.log(`\n${mode} (${SEEDS} seeds, blind clock frozen)`);
  const metrics = measureAiBehavior({ mode, seeds: SEEDS, freezeBlinds: true });
  measured.push(metrics);
  failures.push(...check(metrics));
}

// E12-001: Rational must be measurably distinct from Normal, not a relabelled
// wrapper over identical math.
const [normal, rational] = measured;
const raiseBackGap = Math.abs(
  normal.facingBet.raise - rational.facingBet.raise,
);
console.log(
  `\n  ${raiseBackGap >= 0.03 ? "ok  " : "FAIL"} Normal/Rational raise-back separation${" ".repeat(9)}${raiseBackGap.toFixed(3)}  [0.03, inf]`,
);
if (raiseBackGap < 0.03) {
  failures.push(
    `Normal and Rational raise-back rates differ by only ${raiseBackGap.toFixed(3)}. ` +
      "The two modes must be behaviorally distinguishable, not a thin wrapper over identical math (E12-001).",
  );
}

if (failures.length) {
  console.error(`\nAI behavior gate failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nAI behavior gates: pass");
