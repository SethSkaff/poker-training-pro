/**
 * CLI front end for the AI behavior harness.
 *
 * Kept separate from `measure-ai-behavior.ts` so that importing the metrics
 * (the E14 regression gate, unit tests) never triggers a measurement run --
 * vite-node strips the script path from `process.argv`, so a module cannot
 * reliably tell whether it is the entry point.
 *
 *   vite-node scripts/report-ai-behavior.ts [--seeds N] [--mode normal|rational|both]
 *                                           [--event <id>] [--json]
 */

import { measureAiBehavior, type AiBehaviorMetrics } from "./measure-ai-behavior";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function report(metrics: AiBehaviorMetrics): string {
  return [
    `mode                        ${metrics.mode} (${metrics.seeds} seeds)`,
    `max raise chain             ${metrics.maxRaiseChain}`,
    `chains >=4 / >=8 / >=10     ${metrics.chainsAtLeast4} / ${metrics.chainsAtLeast8} / ${metrics.chainsAtLeast10} (of ${metrics.totalChains})`,
    `VPIP / PFR                  ${percent(metrics.vpip)} / ${percent(metrics.pfr)}`,
    `facing a bet f/c/r          ${percent(metrics.facingBet.fold)} / ${percent(metrics.facingBet.call)} / ${percent(metrics.facingBet.raise)} (n=${metrics.facingBet.samples})`,
    `all-in hand rate pre/post   ${percent(metrics.preflopAllInHandRate)} / ${percent(metrics.postflopAllInHandRate)}`,
    `raise/pot mean / median     ${metrics.raiseOverPot.mean.toFixed(2)} / ${metrics.raiseOverPot.median.toFixed(2)}`,
    `raise/stack mean / median   ${metrics.raiseOverEffectiveStack.mean.toFixed(2)} / ${metrics.raiseOverEffectiveStack.median.toFixed(2)}`,
    `hands to 1st elimination    ${metrics.handsToFirstElimination.mean.toFixed(1)} / ${metrics.handsToFirstElimination.median}`,
    `hands to heads-up           ${metrics.handsToHeadsUp.mean.toFixed(1)} / ${metrics.handsToHeadsUp.median}`,
    `hands to finish             ${metrics.handsToFinish.mean.toFixed(1)} / ${metrics.handsToFinish.median}`,
  ].join("\n");
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const seeds = Number.parseInt(flag("seeds", "15"), 10);
const modeArg = flag("mode", "both");
const eventId = flag("event", "local-qualifier");
const asJson = args.includes("--json");
const modes: Array<"normal" | "rational"> =
  modeArg === "both" ? ["normal", "rational"] : [modeArg as "normal" | "rational"];

const results = modes.map((mode) =>
  measureAiBehavior({ seeds, mode, eventId, freezeBlinds: true }),
);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const result of results) {
    console.log(report(result));
    console.log("");
  }
}
