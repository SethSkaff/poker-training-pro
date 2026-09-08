import { createHash } from "node:crypto";
import type { Interval } from "./report";

export function wilsonInterval(successes: number, trials: number, level = 0.95): Interval | null {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(trials) || trials < 0 || successes < 0 || successes > trials) throw new Error("Invalid Wilson interval counts");
  if (trials === 0) return null;
  const z = level >= 0.999 ? 3.29 : level >= 0.99 ? 2.576 : 1.96;
  const p = successes / trials;
  const denominator = 1 + z * z / trials;
  const center = (p + z * z / (2 * trials)) / denominator;
  const radius = z * Math.sqrt((p * (1 - p) + z * z / (4 * trials)) / trials) / denominator;
  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius), level, method: "wilson", independentUnit: "iid_draw" };
}

export function zeroEventUpperBound(trials: number, level = 0.95): Interval | null {
  if (!Number.isSafeInteger(trials) || trials < 0) throw new Error("Invalid zero-event trial count");
  if (trials === 0) return null;
  const alpha = 1 - level;
  return { lower: 0, upper: 1 - alpha ** (1 / trials), level, method: "zero_event_exact", independentUnit: "iid_draw" };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function randomIndex(seed: string, replicate: number, index: number, size: number): number {
  const digest = createHash("sha256").update(JSON.stringify([seed, replicate, index])).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % size;
}

export interface ClusterObservation {
  blockId: string;
  numerator: number;
  denominator: number;
}

export interface ClusterIntervalResult {
  interval: Interval | null;
  replicates: number;
  independentBlocks: number;
  undefinedReplicates: number;
  exploratory: boolean;
}

export function clusterBootstrap(
  observations: readonly ClusterObservation[],
  options: { replicates?: number; seed?: string; level?: number } = {},
): ClusterIntervalResult {
  const replicates = options.replicates ?? 2_000;
  const level = options.level ?? 0.95;
  if (!Number.isSafeInteger(replicates) || replicates < 1) throw new Error("Bootstrap replicates must be positive");
  for (const observation of observations) {
    if (!Number.isFinite(observation.numerator) || !Number.isFinite(observation.denominator) || observation.denominator < 0 || observation.numerator < 0 || observation.numerator > observation.denominator) throw new Error("Invalid cluster observation");
  }
  if (observations.length === 0) return { interval: null, replicates, independentBlocks: 0, undefinedReplicates: replicates, exploratory: true };
  const estimates: number[] = [];
  let undefinedReplicates = 0;
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let numerator = 0;
    let denominator = 0;
    for (let draw = 0; draw < observations.length; draw += 1) {
      const observation = observations[randomIndex(options.seed ?? "bootstrap-v1", replicate, draw, observations.length)];
      numerator += observation.numerator;
      denominator += observation.denominator;
    }
    if (denominator === 0) undefinedReplicates += 1;
    else estimates.push(numerator / denominator);
  }
  if (estimates.length < Math.max(10, replicates * 0.5)) return { interval: null, replicates, independentBlocks: observations.length, undefinedReplicates, exploratory: observations.length < 30 };
  return {
    interval: { lower: percentile(estimates, 0.025), upper: percentile(estimates, 0.975), level, method: "cluster_bootstrap_percentile", independentUnit: "block" },
    replicates,
    independentBlocks: observations.length,
    undefinedReplicates,
    exploratory: observations.length < 30,
  };
}

export function pairedHoeffdingInterval(
  differences: readonly number[],
  lowerBound: number,
  upperBound: number,
  level = 0.95,
): Interval | null {
  if (differences.length === 0) return null;
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound) || upperBound < lowerBound) throw new Error("Invalid paired payoff bounds");
  if (differences.some((value) => !Number.isFinite(value))) throw new Error("Nonfinite paired difference");
  const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const alpha = 1 - level;
  const halfWidth = (upperBound - lowerBound) * Math.sqrt(Math.log(2 / alpha) / (2 * differences.length));
  return { lower: Math.max(lowerBound, mean - halfWidth), upper: Math.min(upperBound, mean + halfWidth), level, method: "paired_hoeffding", independentUnit: "base_case" };
}
