/**
 * CLI front end for the development-only LLM critic harness (E14-002).
 *
 *   vite-node -c scripts/vite-node.config.mjs scripts/report-critic-harness.ts -- \
 *     [--hands N] [--sample N] [--mode normal|rational] [--seed S] [--json]
 *     [--endpoint URL --model NAME]
 *
 * With no `--endpoint` the run is fully offline and uses the heuristic critic.
 * There is no default endpoint and no environment fallback: reaching the
 * network requires typing the URL, every time.
 *
 * This is a research tool. It is not wired into release verification and must
 * not become a gate -- see the disclaimer carried in its own output.
 */

import {
  heuristicCritic,
  httpCritic,
  runCriticHarness,
  type CriticClient,
} from "./critic-harness";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const hands = Number.parseInt(flag("hands", "40")!, 10);
const sample = Number.parseInt(flag("sample", "12")!, 10);
const mode = (flag("mode", "normal") as "normal" | "rational") ?? "normal";
const seed = flag("seed", "critic-harness")!;
const endpoint = flag("endpoint");
const model = flag("model");
const asJson = args.includes("--json");

if (endpoint && !model) {
  console.error("--endpoint requires --model naming the model to ask.");
  process.exit(2);
}

const critic: CriticClient = endpoint
  ? httpCritic({ endpoint, model: model! })
  : heuristicCritic;

const report = await runCriticHarness({ hands, sample, mode, seed, critic });

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`critic        ${report.critic}`);
  console.log(`hands played  ${report.handsPlayed}`);
  console.log(`sampled       ${report.sampled}`);
  console.log("");
  for (const [label, count] of Object.entries(report.labelCounts)) {
    console.log(`  ${label.padEnd(26)} ${String(count).padStart(4)}`);
  }
  console.log("");
  console.log(report.disclaimer);
}
