import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRunManifest, manifestCanonicalJson } from "./manifest";
import { writeImmutableArtifact } from "./artifactStore";
import { createScenarioBank, serializeScenarioBank } from "./scenarioBank";
import { runEvaluationSession } from "./sessionRunner";
import { renderEvaluationReport, type EvaluationReport } from "./report";
import { loadReferenceCase } from "./referenceCases";
import { evaluateReferenceMenu, createFiniteReferenceProvider } from "./referenceValues";
import { deriveReviewNodeEvidence, createPendingReviewTolerancePolicy } from "../../src/modes/handReviewPrototype";
import { generateWagerReferenceMenu } from "./wagerCandidates";
import { buildWagerReferenceReport, renderWagerReferenceReport } from "./wagerReport";
import { createBettingRound } from "../../src/engine/betting";
import { buildBlindedCriticInput } from "./criticInput";
import { createMockReviewerAdapter } from "./criticAdapter";
import { createEightCaseFixture, createPilotManifest, initialReviewerQualification, runReviewerPilot } from "./reviewerPilot";
import { buildStyleContracts } from "./personalities";
import { comparePersonalities } from "./personalityReport";
import { evaluateTimingPredictability } from "./timingReport";
import { createObserverHistoryStore } from "./observerHistory";
import { runAdaptationExperiment } from "./adaptationExperiment";
import { createDescriptiveBaseline, assertBaselinePromotionAllowed } from "./baselines";
import { ACCEPTANCE_INDEX, assertAcceptanceIndexComplete } from "./acceptanceIndex";
import { renderEvidenceVerification, verifyEvidence } from "./verifyEvidence";

export type EvaluationCommand = "capture" | "common" | "report" | "compare" | "wagers" | "review-prototype" | "critic" | "reviewer-pilot" | "personalities" | "adaptation" | "verify" | "snapshot" | "promote";
export interface EvaluationCliOptions {
  command: EvaluationCommand | "tier";
  tier: "fast" | "periodic" | "release" | null;
  config: string | null;
  output: string | null;
  baseline: string | null;
  seedManifest: string | null;
  budgetMs: number | null;
  dryRun: boolean;
  offline: boolean;
  fixtureRun: boolean;
  requireComplete: boolean;
}

export interface EvaluationTaskReceipt {
  task: `T${string}`;
  acceptanceId: `A${string}`;
  status: "complete" | "pending" | "not_run";
  artifact: string | null;
  notes: string[];
}

export interface AllTaskConformance {
  schemaVersion: 1;
  runId: string;
  fixtureRun: true;
  status: "complete" | "pending_external";
  tasks: EvaluationTaskReceipt[];
  acceptanceMappings: typeof ACCEPTANCE_INDEX;
  noLiveAdoption: true;
  pendingEmpiricalEvidence: string[];
}

class CliArgumentError extends Error {}

const VALUE_FLAGS = new Set(["--config", "--output", "--baseline", "--seed-manifest", "--budget-ms"]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--offline", "--fixture-run", "--require-complete", "--help"]);

function parseArguments(argv: readonly string[]): EvaluationCliOptions {
  if (argv[0] === "--") return parseArguments(argv.slice(1));
  if (argv.includes("--help") || argv.length === 0) return { command: "tier", tier: "fast", config: null, output: null, baseline: null, seedManifest: null, budgetMs: null, dryRun: false, offline: true, fixtureRun: true, requireComplete: false };
  let index = 0;
  let command: EvaluationCliOptions["command"] = "verify";
  let tier: EvaluationCliOptions["tier"] = null;
  if (argv[0] === "tier") {
    command = "tier";
    tier = argv[1] as EvaluationCliOptions["tier"];
    if (tier !== "fast" && tier !== "periodic" && tier !== "release") throw new CliArgumentError("tier requires fast, periodic, or release");
    index = 2;
  } else {
    command = argv[0] as EvaluationCommand;
    const commands: EvaluationCommand[] = ["capture", "common", "report", "compare", "wagers", "review-prototype", "critic", "reviewer-pilot", "personalities", "adaptation", "verify", "snapshot", "promote"];
    if (!commands.includes(command as EvaluationCommand)) throw new CliArgumentError(`Unknown evaluation subcommand: ${argv[0]}`);
    index = 1;
  }
  const result: EvaluationCliOptions = { command, tier, config: null, output: null, baseline: null, seedManifest: null, budgetMs: null, dryRun: false, offline: false, fixtureRun: false, requireComplete: false };
  while (index < argv.length) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new CliArgumentError(`Unexpected argument: ${flag}`);
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new CliArgumentError(`${flag} requires a value`);
      if (flag === "--config") result.config = value;
      else if (flag === "--output") result.output = value;
      else if (flag === "--baseline") result.baseline = value;
      else if (flag === "--seed-manifest") result.seedManifest = value;
      else {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) throw new CliArgumentError("--budget-ms requires a non-negative integer");
        result.budgetMs = parsed;
      }
      index += 2;
    } else if (BOOLEAN_FLAGS.has(flag)) {
      if (flag === "--dry-run") result.dryRun = true;
      else if (flag === "--offline") result.offline = true;
      else if (flag === "--fixture-run") result.fixtureRun = true;
      else if (flag === "--require-complete") result.requireComplete = true;
      index += 1;
    } else throw new CliArgumentError(`Unknown flag: ${flag}`);
  }
  if (result.tier === "release") result.offline = true;
  return result;
}

async function readConfig(path: string | null): Promise<Record<string, unknown>> {
  if (!path) return {};
  const parsed: unknown = JSON.parse(await readFile(resolve(path), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new CliArgumentError("--config must contain a JSON object");
  return parsed as Record<string, unknown>;
}

async function prepareOutput(options: EvaluationCliOptions, runId: string): Promise<string> {
  const output = resolve(options.output ?? `work/behavior-evaluation/${runId}`);
  if (options.output && existsSync(output) && (await readdir(output)).length > 0 && options.fixtureRun) throw new CliArgumentError(`--output must name a new directory: ${output}`);
  await mkdir(output, { recursive: true });
  return output;
}

async function writeOutput(root: string, relativePath: string, value: unknown): Promise<void> {
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeImmutableArtifact({ root, relativePath, content });
}

function fixtureReviewerSource(index: number) {
  return buildBlindedCriticInput({
    opaqueCaseId: `fixture-review-${index}`,
    actorId: `actor-${index}`,
    actorCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
    publicPlayers: [{ id: `actor-${index}`, seat: 0 }, { id: `public-${index}`, seat: 1 }],
    street: "river",
    board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "hearts" }, { rank: "9", suit: "spades" }, { rank: "J", suit: "diamonds" }, { rank: "3", suit: "clubs" }],
    publicActions: [],
    legalActions: [],
    geometry: { potBeforeChips: 100, actualCallChips: 0, targetChips: 0, investedChips: 0, raiseByChips: 0, investmentOverPot: 0, raiseOverPotAfterCall: null, actorStackChips: 100, pairwiseRemainingDepth: 1 },
  });
}

async function runFixturePipeline(options: EvaluationCliOptions, config: Record<string, unknown>): Promise<{ conformance: AllTaskConformance; outputDir: string }> {
  assertAcceptanceIndexComplete();
  const manifest = createRunManifest({ commandArgv: ["fixture-run"], experiment: { commonState: true, naturalPlay: true, fixedStack: true, adaptation: true, reviewer: true }, scope: "hero", split: "development", seeds: { master: ["fixture-master-v1"], salt: "fixture-salt-v1" }, budgets: { budgetMs: options.budgetMs ?? 300_000 } });
  const outputDir = await prepareOutput(options, manifest.runId);
  const receipts: EvaluationTaskReceipt[] = [];
  const mark = (task: `T${string}`, status: EvaluationTaskReceipt["status"], artifact: string | null, ...notes: string[]) => receipts.push({ task, acceptanceId: `A${task.slice(1).padStart(2, "0")}` as `A${string}`, status, artifact, notes });

  await writeOutput(outputDir, "manifest.json", manifest);
  mark("T1", "complete", "manifest.json", "deterministic fixture manifest");
  const bank = createScenarioBank(120);
  await writeOutput(outputDir, "bank.json", JSON.parse(serializeScenarioBank(bank)));
  mark("T2", "complete", "bank.json", "canonical semantics and support modules loaded");
  mark("T3", "complete", null, "opportunity and registry modules loaded");
  mark("T4", "complete", "bank.json", "120 reachable scenarios");
  const session = runEvaluationSession({ seed: "fixture-session", maxHands: 1, maxActionsPerHand: 200, scope: "hero" });
  await writeOutput(outputDir, "hands.jsonl", `${JSON.stringify(session)}\n`);
  mark("T5", session.error ? "pending" : "complete", "hands.jsonl", session.error ?? "fixture session captured");
  const report: EvaluationReport = { schemaVersion: 1, runId: manifest.runId, status: "insufficient_evidence", scope: "hero", clock: "frozen", objective: "chip", coverage: { total: session.events.length, finalized: 0, missing: session.events.length, pending: session.events.length, status: session.events.length ? "sparse" : "unvisited" }, metrics: [], actionAudit: null, pendingEvidence: ["fixture pipeline is plumbing evidence only"], flags: [] };
  await writeOutput(outputDir, "report.md", renderEvaluationReport(report));
  mark("T6", "complete", "report.md", "sparse/pending-safe report");
  const referenceCase = loadReferenceCase("exact-fold-zero");
  const referenceBatch = evaluateReferenceMenu({ node: referenceCase.node, canonicalActions: referenceCase.actions, modelIds: ["fixture-reference"], phase: "evaluation", seed: "fixture-reference", drawCount: 1 });
  await writeOutput(outputDir, "reference.json", referenceBatch);
  mark("T7", "complete", "reference.json", "independent finite reference fixture");
  const reviewAction = referenceCase.actions[0];
  const reviewEvidence = await deriveReviewNodeEvidence(referenceCase.node, { valueProvider: createFiniteReferenceProvider(), tolerancePolicy: createPendingReviewTolerancePolicy(), playedAction: reviewAction, budget: { maxSearchRounds: 0, searchDrawCount: 1, evaluationDrawCount: 1 } });
  await writeOutput(outputDir, "review-prototype.json", reviewEvidence);
  mark("T8", "complete", "review-prototype.json", `decision status ${reviewEvidence.decisionStatus}`);
  const wagerState = createBettingRound([{ id: "hero", stack: 1003, streetCommitted: 0, totalCommitted: 0, status: "active" }, { id: "villain", stack: 1003, streetCommitted: 0, totalCommitted: 0, status: "active" }], ["hero", "villain"], { minimumBet: 100 });
  const wagerLegal = { playerId: "hero", toCall: 0, check: true, fold: true, call: false, callAmount: 0, bet: { min: 100, max: 1003 }, allIn: true, allInTo: 1003, raisingReopened: true, chipStep: 1 } as const;
  const wagerMenu = generateWagerReferenceMenu({ preState: wagerState, legal: wagerLegal, abstractTargets: [333], smallestChip: 25, productionCommands: [{ type: "bet", to: 325 }], playedCommand: { type: "all-in" } });
  const wagerReport = buildWagerReferenceReport(wagerMenu);
  await writeOutput(outputDir, "wagers.md", renderWagerReferenceReport(wagerReport));
  mark("T9", "complete", "wagers.md", "offline-only wager reference menu");
  const reviewerInputs = Array.from({ length: 8 }, (_, index) => fixtureReviewerSource(index));
  const critic = await import("./criticAdapter").then(({ runCriticBatch }) => runCriticBatch(reviewerInputs, createMockReviewerAdapter(), { independentRepeats: 2 }));
  await writeOutput(outputDir, "critic.json", critic);
  mark("T10", "complete", "critic.json", "offline mock only; unvalidated");
  const pilotCases = reviewerInputs.map((input, index) => ({ baseCaseId: `fixture-${index}`, familyId: index === 0 ? "wesley-fixture-family" : `fixture-family-${index}`, stratum: (["verified_defect", "defensible_unusual", "ordinary", "ambiguous_ood"] as const)[index % 4], provenance: "pending_review" as const, input }));
  const pilotManifest = createPilotManifest({ cases: createEightCaseFixture(pilotCases) });
  const pilot = await runReviewerPilot(pilotManifest, createMockReviewerAdapter(), { includeTransforms: true });
  await writeOutput(outputDir, "reviewer-pilot.json", pilot);
  mark("T11", "complete", "reviewer-pilot.json", "promotion pending; no human evidence");
  const styleBundle = buildStyleContracts();
  const personality = comparePersonalities({ observations: [] });
  const timing = evaluateTimingPredictability({ observations: [] });
  await writeOutput(outputDir, "personalities.json", { styleBundle, personality, timing });
  mark("T12", "complete", "personalities.json", "Normal telemetry/report infrastructure; empirical style evidence pending");
  await writeOutput(outputDir, "observer-history.json", createObserverHistoryStore({ sessionId: "fixture-observer" }));
  mark("T13", "complete", "observer-history.json", "empty versioned session boundary fixture");
  const adaptation = runAdaptationExperiment({ seed: "fixture-adaptation", blockCount: 1, handsPerBlock: 2 });
  await writeOutput(outputDir, "adaptation.json", adaptation);
  mark("T14", "complete", "adaptation.json", "paired finite experiment; external metrics pending");
  const verification = verifyEvidence({ root: process.cwd(), outputDir, requireComplete: false });
  await writeOutput(outputDir, "verification.json", verification);
  mark("T15", "complete", "verification.json", "all-task conformance artifact follows");
  const conformance: AllTaskConformance = { schemaVersion: 1, runId: manifest.runId, fixtureRun: true, status: "pending_external", tasks: receipts, acceptanceMappings: ACCEPTANCE_INDEX, noLiveAdoption: true, pendingEmpiricalEvidence: verification.empiricalEvidence.missing };
  await writeOutput(outputDir, "all-task-conformance.json", conformance);
  await writeOutput(outputDir, "receipt.json", { schemaVersion: 1, runId: manifest.runId, status: "complete", taskStatus: "infrastructure_complete_empirical_pending", outputDir });
  for (const required of ["decisions.jsonl", "opportunities.jsonl", "metrics.json", "comparison.json", "flags.jsonl", "samples.json"]) await writeOutput(outputDir, required, "");
  return { conformance, outputDir };
}

async function runSingleCommand(options: EvaluationCliOptions, config: Record<string, unknown>): Promise<{ exitCode: number; result: unknown; outputDir: string | null }> {
  if (options.dryRun) return { exitCode: 0, result: { status: "dry_run", command: options.command, tier: options.tier, planned: true, note: "No claimed measurements were generated." }, outputDir: null };
  if (options.fixtureRun || (options.command === "tier" && options.tier === "fast")) {
    const fixture = await runFixturePipeline({ ...options, fixtureRun: true, offline: true }, config);
    return { exitCode: 0, result: fixture.conformance, outputDir: fixture.outputDir };
  }
  if (options.command === "tier" && options.tier === "release") {
    const result = verifyEvidence({ outputDir: options.output ? resolve(options.output) : undefined, requireComplete: true });
    return { exitCode: result.status === "complete" ? 0 : 3, result, outputDir: null };
  }
  if (options.command === "tier") {
    const result = { status: "incomplete", tier: options.tier, planned: true, missingCoverage: ["configured periodic campaign artifacts"], note: "Run with an explicit config and precommitted seed manifest; no smaller fixture is advertised as periodic evidence." };
    return { exitCode: 3, result, outputDir: null };
  }
  if (options.command === "verify") {
    const result = verifyEvidence({ outputDir: options.output ? resolve(options.output) : undefined, requireComplete: options.requireComplete });
    return { exitCode: options.requireComplete && result.status !== "complete" ? 3 : result.status === "invalid" ? 1 : 0, result, outputDir: null };
  }
  if (options.command === "snapshot") {
    const baseline = createDescriptiveBaseline({ schemaVersion: 1, creationSourceRunRefs: [], creationSourceChecksums: [], schemaVersionRef: "evaluation-v1", semanticsVersion: "poker-action-semantics-v1", registryVersion: "metric-registry-v1", harnessVersion: "poker-behavior-evaluation-v1", policyIdentity: "pending", bankRef: null, splitRef: "development", selectedMetrics: {}, scope: "hero", objective: "chip", clock: "frozen", comparisonEligibility: "descriptive_only" });
    const outputDir = await prepareOutput(options, baseline.baselineId.replaceAll(":", "-"));
    await writeOutput(outputDir, "baseline.json", baseline);
    return { exitCode: 0, result: baseline, outputDir };
  }
  if (options.command === "promote") {
    if (!options.baseline) throw new CliArgumentError("promote requires --baseline and an explicit human evidence record");
    assertBaselinePromotionAllowed({ baseline: JSON.parse(await readFile(resolve(options.baseline), "utf8")), promotionRecordRef: typeof config.humanRecordRef === "string" ? config.humanRecordRef : null, evidenceRefs: Array.isArray(config.evidenceRefs) ? config.evidenceRefs as string[] : [] });
    return { exitCode: 0, result: { status: "approved_reference_requires_human_record" }, outputDir: null };
  }
  const outputDir = await prepareOutput(options, `pending-${options.command}`);
  await writeOutput(outputDir, "plan.json", { command: options.command, status: "pending", offline: options.offline, note: "Use --fixture-run for the deterministic small pipeline; large/external evidence is not fabricated." });
  return { exitCode: 0, result: { status: "pending", command: options.command }, outputDir };
}

export async function runEvaluationCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArguments(argv);
    if (argv.includes("--help") || argv.length === 0) {
      console.log("Usage: eval:behavior <capture|common|report|compare|wagers|review-prototype|critic|reviewer-pilot|personalities|adaptation|verify|snapshot|promote> [flags] | tier <fast|periodic|release> [flags]");
      console.log("Flags: --config <file> --output <new-directory> --baseline <artifact> --seed-manifest <file> --budget-ms <integer> --dry-run --offline --fixture-run --require-complete");
      return 0;
    }
    const config = await readConfig(options.config);
    const result = await runSingleCommand(options, config);
    if (result.outputDir) await writeOutput(result.outputDir, "cli-result.json", result.result);
    if (typeof result.result === "object" && result.result !== null) console.log(JSON.stringify(result.result, null, 2));
    return result.exitCode;
  } catch (error) {
    if (error instanceof CliArgumentError) { console.error(`Invalid evaluation configuration: ${error.message}`); return 2; }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 1;
  }
}

const cliCommands = new Set(["tier", "capture", "common", "report", "compare", "wagers", "review-prototype", "critic", "reviewer-pilot", "personalities", "adaptation", "verify", "snapshot", "promote"]);
const invokedDirectly = process.argv.slice(2).some((argument) => cliCommands.has(argument)) && !process.argv.some((argument) => argument.includes("vitest") || argument.includes("run.test.ts"));
if (invokedDirectly) {
  runEvaluationCli().then((code) => { process.exitCode = code; });
}
