import { createHash } from "node:crypto";
import type { BehavioralDecisionEvent } from "./decisionEvent";

export type ReviewStream = "uniform" | "stratified" | "tails" | "disagreements" | "changed-path" | "supplementary";

export interface SampleCandidate {
  id: string;
  event: BehavioralDecisionEvent;
  familyId: string;
  blockId: string;
  primaryCell: string;
  score: number;
  streams: ReviewStream[];
  finalized: boolean;
}

export interface SelectedReviewSample extends SampleCandidate {
  selectedStream: ReviewStream;
  selectionRank: number;
  universeSize: number;
  inclusionProbability: number | null;
  probabilitySample: boolean;
}

export interface ReviewSampleSelection {
  uniform: SelectedReviewSample[];
  targeted: SelectedReviewSample[];
  streamMembership: Record<string, ReviewStream[]>;
  budgets: Record<ReviewStream, number>;
  universeSize: number;
  supplementaryCount: number;
}

const DEFAULT_BUDGETS: Record<ReviewStream, number> = {
  uniform: 60,
  stratified: 50,
  tails: 40,
  disagreements: 30,
  "changed-path": 20,
  supplementary: 0,
};

function orderByHash(candidates: readonly SampleCandidate[], seed: string, stream: ReviewStream): SampleCandidate[] {
  if (stream === "tails" || stream === "disagreements") {
    return [...candidates].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  }
  if (stream === "stratified") {
    const cells = new Map<string, SampleCandidate[]>();
    for (const candidate of candidates) {
      const cell = cells.get(candidate.primaryCell) ?? [];
      cell.push(candidate);
      cells.set(candidate.primaryCell, cell);
    }
    for (const cell of cells.values()) {
      cell.sort((left, right) => {
        const leftHash = createHash("sha256").update(JSON.stringify([seed, stream, left.id])).digest("hex");
        const rightHash = createHash("sha256").update(JSON.stringify([seed, stream, right.id])).digest("hex");
        return leftHash.localeCompare(rightHash) || left.id.localeCompare(right.id);
      });
    }
    const ordered: SampleCandidate[] = [];
    const sortedCells = [...cells.keys()].sort();
    for (let index = 0; ; index += 1) {
      let added = false;
      for (const cellId of sortedCells) {
        const candidate = cells.get(cellId)?.[index];
        if (candidate) { ordered.push(candidate); added = true; }
      }
      if (!added) return ordered;
    }
  }
  return [...candidates].sort((left, right) => {
    const leftHash = createHash("sha256").update(JSON.stringify([seed, stream, left.id])).digest("hex");
    const rightHash = createHash("sha256").update(JSON.stringify([seed, stream, right.id])).digest("hex");
    return leftHash.localeCompare(rightHash) || left.id.localeCompare(right.id);
  });
}

function select(candidates: readonly SampleCandidate[], stream: ReviewStream, budget: number, seed: string, selected: Set<string>): SelectedReviewSample[] {
  if (budget <= 0) return [];
  const pool = stream === "uniform" ? candidates.filter((candidate) => candidate.finalized) : candidates.filter((candidate) => candidate.finalized && candidate.streams.includes(stream));
  const ordered = orderByHash(pool, seed, stream);
  const universeSize = pool.length;
  return ordered.filter((candidate) => !selected.has(candidate.id)).slice(0, budget).map((candidate, index) => ({
    ...candidate,
    selectedStream: stream,
    selectionRank: index,
    universeSize,
    inclusionProbability: stream === "uniform" && universeSize > 0 ? Math.min(1, budget / universeSize) : null,
    probabilitySample: stream === "uniform",
  }));
}

export function selectReviewSamples(
  candidates: readonly SampleCandidate[],
  options: { samplingSeed: string; budgets?: Partial<Record<ReviewStream, number>> } = { samplingSeed: "evaluation-sample-v1" },
): ReviewSampleSelection {
  const budgets = { ...DEFAULT_BUDGETS, ...(options.budgets ?? {}) };
  const streamMembership = Object.fromEntries(candidates.map((candidate) => [candidate.id, [...candidate.streams]]));
  const selectedIds = new Set<string>();
  const uniform = select(candidates, "uniform", budgets.uniform, options.samplingSeed, selectedIds);
  uniform.forEach((sample) => selectedIds.add(sample.id));
  const targeted: SelectedReviewSample[] = [];
  for (const stream of ["stratified", "tails", "disagreements", "changed-path"] as const) {
    const picks = select(candidates, stream, budgets[stream], options.samplingSeed, selectedIds);
    picks.forEach((sample) => { selectedIds.add(sample.id); targeted.push(sample); });
  }
  return { uniform, targeted, streamMembership, budgets, universeSize: candidates.filter((candidate) => candidate.finalized).length, supplementaryCount: 0 };
}
