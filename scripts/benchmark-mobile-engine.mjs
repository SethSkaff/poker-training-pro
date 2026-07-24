// Non-gating worst-case decision-cost benchmark for the mobile engine bundle.
//
// It evaluates the exact bundled `ios/.../poker-engine.js` in an isolated VM
// (the same artifact JavaScriptCore evaluates on device) and measures the cost
// of the most expensive per-decision operations: capped range equity and the
// bot decision built on it. Wall-clock numbers vary by machine and are never
// used to stop a simulation or choose an action; the simulation ceiling is a
// fixed count-based cap, not a time budget.
//
// Run with the supported Node runtime (>=22):
//   node scripts/benchmark-mobile-engine.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { performance } from "node:perf_hooks";

const ENGINE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../ios/PokerTrainingPro/Resources/Engine/poker-engine.js",
);

function loadEngine() {
  const source = readFileSync(ENGINE_PATH, "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "poker-engine.js" });
  return context.PokerTrainingEngine;
}

const engine = loadEngine();
let counter = 0;
function invoke(operation, payload, seed) {
  counter += 1;
  return JSON.parse(
    engine.invoke(
      JSON.stringify({ contractVersion: "1.0.0", requestID: `bench-${counter}`, operation, seed, payload }),
    ),
  );
}

const health = invoke("health", {}).result;
const caps = health.equityCaps;

const hero = [
  { rank: "A", suit: "spades" },
  { rank: "K", suit: "spades" },
];
// A flop board is the worst runout case for the evaluator (5 - 3 = 2 runout
// cards, then a 7-card best-hand search for hero plus every opponent).
const board = [
  { rank: "Q", suit: "spades" },
  { rank: "J", suit: "hearts" },
  { rank: "2", suit: "clubs" },
];

function measure(label, fn, iterations) {
  // Warm up so the first-parse cost does not skew the median.
  for (let i = 0; i < 3; i += 1) fn(i);
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn(i);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
  const max = samples[samples.length - 1];
  return { label, iterations, median, p95, max };
}

const rows = [];

// Worst-case equity: maximum simulations at the phone ceiling, with the maximum
// supported opponents (an 8-way pot is far beyond typical late-game play).
for (const opponents of [1, 2, 5, 8]) {
  rows.push(
    measure(
      `equity ${opponents}-opp @${caps.maximumSimulations} sims`,
      (i) =>
        invoke(
          "estimateEquity",
          { hero, board, opponents, simulations: caps.maximumSimulations },
          `bench-equity-${opponents}-${i}`,
        ),
      15,
    ),
  );
}

// Default-cost decision: what a typical mobile decision actually pays.
rows.push(
  measure(
    `rational botDecision 2-opp (default caps)`,
    (i) =>
      invoke(
        "botDecision",
        { style: "rational", hero, board, opponents: 2, pot: 1200, toCall: 400, bigBlind: 200, legalRaiseTo: 1200 },
        `bench-bot-${i}`,
      ),
    15,
  ),
);
rows.push(
  measure(
    `normal botDecision 2-opp (default caps)`,
    (i) =>
      invoke(
        "botDecision",
        { style: "normal", hero, board, opponents: 2, pot: 1200, toCall: 400, bigBlind: 200, legalRaiseTo: 1200 },
        `bench-normaldec-${i}`,
      ),
    15,
  ),
);

const worst = rows.reduce((a, b) => (b.max > a.max ? b : a));

console.log("Mobile engine worst-case decision-cost benchmark");
console.log(`Engine: ${health.engineVersion}  Contract: ${health.contractVersion}`);
console.log(`Node: ${process.version}  Caps: ${JSON.stringify(caps)}`);
console.log("");
console.log("label                                    | iters | median ms |  p95 ms |  max ms");
console.log("-----------------------------------------+-------+-----------+---------+--------");
for (const r of rows) {
  console.log(
    `${r.label.padEnd(40)} | ${String(r.iterations).padStart(5)} | ${r.median.toFixed(3).padStart(9)} | ${r.p95
      .toFixed(3)
      .padStart(7)} | ${r.max.toFixed(3).padStart(7)}`,
  );
}
console.log("");
console.log(
  `Observed worst case: "${worst.label}" at ${worst.max.toFixed(3)} ms max on this host.`,
);
console.log(
  "These are non-portable observations. On-device validation on target iPhones/iPads",
);
console.log("with Instruments (CPU, energy, thermal state, hangs) remains macOS/Xcode work.");
