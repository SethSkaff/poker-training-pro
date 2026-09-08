import type { WagerReferenceMenu } from "./wagerCandidates";

export interface WagerMenuComparison {
  originalTargets: number[];
  candidateTargets: number[];
  addedTargets: number[];
  removedTargets: number[];
  sharedTargets: number[];
  offlineOnly: true;
}

export function compareWagerMenus(original: WagerReferenceMenu, candidate: WagerReferenceMenu): WagerMenuComparison {
  const originalTargets = [...new Set(original.expandedTargets)].sort((left, right) => left - right);
  const candidateTargets = [...new Set(candidate.expandedTargets)].sort((left, right) => left - right);
  const originalSet = new Set(originalTargets);
  const candidateSet = new Set(candidateTargets);
  return {
    originalTargets,
    candidateTargets,
    addedTargets: candidateTargets.filter((target) => !originalSet.has(target)),
    removedTargets: originalTargets.filter((target) => !candidateSet.has(target)),
    sharedTargets: originalTargets.filter((target) => candidateSet.has(target)),
    offlineOnly: true,
  };
}

export interface WagerReferenceCoverage {
  candidateId: string;
  status: "supported" | "unsupported" | "pending";
  valueChips: number | null;
  reason: string | null;
}

export interface WagerReferenceReport {
  schemaVersion: 1;
  menuVersion: string;
  offlineOnly: true;
  originalMenu: {
    candidateIds: string[];
    targetsChips: number[];
  };
  expandedMenu: {
    candidateIds: string[];
    targetsChips: number[];
  };
  matchedCanonicalTargets: Array<{ candidateId: string; targetChips: number | null; origins: string[] }>;
  legality: {
    accepted: number;
    rejected: number;
    rackExceptions: number;
    anomalies: string[];
  };
  coverage: {
    originalSupported: number;
    expandedSupported: number;
    gain: number;
    unsupported: number;
    pending: number;
  };
  denominationPatterns: {
    rackFeasible: number;
    offRackExactExceptions: number;
    ordinaryOffRack: number;
    rawSizeDistribution: Record<string, number>;
    normalizedSizeDistribution: Record<string, number>;
  };
  preference: {
    version: string | null;
    authority: "none" | "descriptive_only" | "supported_tie_break_only";
    evidence: string | null;
  };
  strategicReferenceScope: string;
  liveAdoption: "not_implemented";
}

export function buildWagerReferenceReport(
  menu: WagerReferenceMenu,
  coverage: readonly WagerReferenceCoverage[] = [],
): WagerReferenceReport {
  const coverageById = new Map(coverage.map((entry) => [entry.candidateId, entry]));
  const original = menu.candidates.filter((candidate) => candidate.origins.includes("production"));
  const expanded = menu.candidates;
  const supported = (candidates: typeof expanded) => candidates.filter((candidate) => coverageById.get(candidate.candidateId)?.status === "supported").length;
  const ordinaryOffRack = expanded.filter((candidate) => !candidate.exactStateDerived && !candidate.rackFeasible).length;
  const offRackExact = expanded.filter((candidate) => candidate.exactStateDerived && !candidate.rackFeasible).length;
  return {
    schemaVersion: 1,
    menuVersion: menu.menuVersion,
    offlineOnly: true,
    originalMenu: {
      candidateIds: original.map((candidate) => candidate.candidateId),
      targetsChips: original.map((candidate) => candidate.finalTargetChips).filter((target): target is number => target !== null),
    },
    expandedMenu: {
      candidateIds: expanded.map((candidate) => candidate.candidateId),
      targetsChips: expanded.map((candidate) => candidate.finalTargetChips).filter((target): target is number => target !== null),
    },
    matchedCanonicalTargets: expanded.map((candidate) => ({ candidateId: candidate.candidateId, targetChips: candidate.canonical?.targetChips ?? candidate.finalTargetChips, origins: [...candidate.origins] })),
    legality: {
      accepted: expanded.filter((candidate) => candidate.legal).length,
      rejected: menu.rejectedCandidates.length,
      rackExceptions: offRackExact,
      anomalies: [...menu.legalityAnomalies],
    },
    coverage: {
      originalSupported: supported(original),
      expandedSupported: supported(expanded),
      gain: supported(expanded) - supported(original),
      unsupported: coverage.filter((entry) => entry.status === "unsupported").length,
      pending: coverage.filter((entry) => entry.status === "pending").length,
    },
    denominationPatterns: {
      rackFeasible: expanded.filter((candidate) => candidate.rackFeasible).length,
      offRackExactExceptions: offRackExact,
      ordinaryOffRack,
      rawSizeDistribution: { ...menu.rawSizeDistribution },
      normalizedSizeDistribution: { ...menu.normalizedSizeDistribution },
    },
    preference: {
      version: menu.scope.preferenceVersion,
      authority: menu.scope.preferenceAuthority,
      evidence: null,
    },
    strategicReferenceScope: "Wager amounts are compared at actual final targets; denomination preference never enters Game Review grading.",
    liveAdoption: "not_implemented",
  };
}

export function renderWagerReferenceReport(report: WagerReferenceReport): string {
  return [
    `# Offline wager reference ${report.menuVersion}`,
    "",
    "Live adoption: **not implemented**",
    `Original candidates: ${report.originalMenu.candidateIds.length}; expanded: ${report.expandedMenu.candidateIds.length}`,
    `Legal accepted/rejected: ${report.legality.accepted}/${report.legality.rejected}; rack exceptions: ${report.legality.rackExceptions}`,
    `Reference coverage gain: ${report.coverage.gain}; supported ${report.coverage.expandedSupported}; pending ${report.coverage.pending}; unsupported ${report.coverage.unsupported}`,
    `Preference authority: ${report.preference.authority}`,
  ].join("\n") + "\n";
}
