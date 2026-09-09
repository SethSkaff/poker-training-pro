import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ACCEPTANCE_INDEX, assertAcceptanceIndexComplete } from "./acceptanceIndex";

export interface EvidenceVerification {
  schemaVersion: 1;
  status: "complete" | "incomplete" | "invalid";
  checkpointReceipts: Record<string, "present" | "missing">;
  taskEntryPoints: Record<string, "present" | "missing">;
  acceptanceIndex: { complete: boolean; mappings: number };
  productionInvariance: { noEvaluationImports: boolean; liveAdoption: "none_detected" | "detected"; findings: string[] };
  empiricalEvidence: { status: "pending" | "available"; missing: string[] };
  errors: string[];
  warnings: string[];
}

const REQUIRED_CHECKPOINTS = ["C1", "C2", "C3", "C4", "C5", "C6"] as const;

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) result.push(path);
    }
  };
  visit(root);
  return result;
}

export function verifyProductionImportExclusion(root: string): EvidenceVerification["productionInvariance"] {
  const findings: string[] = [];
  const forbiddenImport = /(?:from\s*["'][^"']*(?:scripts[\\/]evaluation|handReviewPrototype|wagerCandidates|criticAdapter|observerHistory|adaptationExperiment)[^"']*["']|import\s*\(\s*["'][^"']*scripts[\\/]evaluation)/;
  for (const file of sourceFiles(join(root, "src")).filter((file) => !file.endsWith(".test.ts"))) {
    const source = readFileSync(file, "utf8");
    if (forbiddenImport.test(source)) findings.push(relative(root, file));
  }
  return { noEvaluationImports: findings.length === 0, liveAdoption: findings.length === 0 ? "none_detected" : "detected", findings };
}

export function verifyEvidence(input: { root?: string; outputDir?: string; requireComplete?: boolean } = {}): EvidenceVerification {
  const root = input.root ?? process.cwd();
  const errors: string[] = [];
  const warnings: string[] = [];
  let acceptanceComplete = false;
  try { assertAcceptanceIndexComplete(); acceptanceComplete = true; } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const checkpointReceipts = Object.fromEntries(REQUIRED_CHECKPOINTS.map((checkpoint) => {
    const present = existsSync(join(root, "scripts", "evaluation", "receipts", `${checkpoint}.md`));
    if (!present && (input.requireComplete || checkpoint !== "C6")) errors.push(`Missing checkpoint receipt ${checkpoint}`);
    return [checkpoint, present ? "present" : "missing"];
  })) as EvidenceVerification["checkpointReceipts"];
  const taskEntryPoints = Object.fromEntries(ACCEPTANCE_INDEX.map((entry) => {
    const present = entry.entryPoints.every((symbol) => {
      const needle = new RegExp(`(?:export\\s+(?:async\\s+)?function\\s+${symbol}\\b|export\\s+(?:const|let)\\s+${symbol}\\b|export\\s*\\{[^}]*\\b${symbol}\\b)`);
      return sourceFiles(join(root, "scripts", "evaluation")).some((file) => needle.test(readFileSync(file, "utf8"))) || sourceFiles(join(root, "src")).some((file) => needle.test(readFileSync(file, "utf8")));
    });
    if (!present) errors.push(`Missing task entry point for ${entry.task}: ${entry.entryPoints.join(", ")}`);
    return [entry.task, present ? "present" : "missing"];
  })) as EvidenceVerification["taskEntryPoints"];
  const productionInvariance = verifyProductionImportExclusion(root);
  if (!productionInvariance.noEvaluationImports) errors.push("Production source imports offline evaluation infrastructure");
  const outputReady = input.outputDir ? existsSync(input.outputDir) && existsSync(join(input.outputDir, "all-task-conformance.json")) : false;
  // Fixture evidence lives under the ignored /work/ tree, so a clean checkout never has one.
  // `--require-complete` gates executable conformance; the output directory is only checked when a caller names one.
  if (input.outputDir && input.requireComplete && !outputReady) errors.push(`Required evidence output directory is missing: ${input.outputDir}`);
  const empiricalMissing = ["qualified human reviewer labels", "approved grading tolerances", "external timing observations", "range-domain calibration", "live-adoption approval"];
  warnings.push(...empiricalMissing.map((item) => `Pending empirical evidence: ${item}`));
  const invalid = productionInvariance.liveAdoption === "detected" || !acceptanceComplete;
  const incomplete = errors.length > 0 || (input.requireComplete && !REQUIRED_CHECKPOINTS.every((checkpoint) => checkpointReceipts[checkpoint] === "present"));
  return {
    schemaVersion: 1,
    status: invalid ? "invalid" : incomplete ? "incomplete" : "complete",
    checkpointReceipts,
    taskEntryPoints,
    acceptanceIndex: { complete: acceptanceComplete, mappings: ACCEPTANCE_INDEX.length },
    productionInvariance,
    empiricalEvidence: { status: "pending", missing: empiricalMissing },
    errors,
    warnings,
  };
}

export function renderEvidenceVerification(result: EvidenceVerification): string {
  return [
    `# Evidence verification: ${result.status}`,
    "",
    `Acceptance index: ${result.acceptanceIndex.mappings}/15 mappings; complete=${String(result.acceptanceIndex.complete)}`,
    `Production invariance: ${result.productionInvariance.liveAdoption}; evaluation imports=${result.productionInvariance.noEvaluationImports ? "none" : "detected"}`,
    `Empirical evidence: ${result.empiricalEvidence.status}`,
    "",
    "## Errors",
    ...(result.errors.length ? result.errors.map((error) => `- ${error}`) : ["- none"]),
    "",
    "## Pending evidence",
    ...result.empiricalEvidence.missing.map((item) => `- ${item}`),
  ].join("\n") + "\n";
}
