declare module "*audit-training-tool-exclusion.mjs" {
  export interface TrainingToolExclusionFinding {
    surface: "production-source" | "dist" | "asar";
    path: string;
    reason?: string;
  }

  export interface TrainingToolExclusionReport {
    ok: boolean;
    marker: string;
    productionSourceRoots: string[];
    distInspected: boolean;
    asarInspected: boolean;
    asarEntries: number;
    findings: TrainingToolExclusionFinding[];
  }

  export function auditTrainingToolExclusion(options?: {
    projectRoot?: string;
    distDirectory?: string;
    asarPath?: string;
    requireAsar?: boolean;
  }): TrainingToolExclusionReport;
}

