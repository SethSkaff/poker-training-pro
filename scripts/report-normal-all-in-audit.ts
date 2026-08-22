/** CLI for the reproducible Normal-mode all-in audit. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  auditSeedList,
  runNormalAllInAudit,
  type AuditClock,
  type ClockAudit,
  type NormalAllInAuditReport,
} from "./normal-all-in-audit";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const seedCount = Number.parseInt(flag("seeds", "12")!, 10);
const seedPrefix = flag("seed-prefix", "normal-all-in-audit")!;
const clockArg = flag("clock", "both")!;
const clocks: AuditClock[] = clockArg === "both"
  ? ["frozen", "live"]
  : [clockArg as AuditClock];
if (clocks.some((clock) => clock !== "frozen" && clock !== "live")) {
  throw new Error("--clock must be frozen, live, or both");
}
const maxHands = Number.parseInt(flag("max-hands", "400")!, 10);
const eventId = flag("event", "local-qualifier")!;
const auditDate = flag("audit-date", "unspecified")!;
const sourceRevision = flag("source-revision", "unspecified")!;
const reproductionCommand = flag("reproduction-command", "unspecified")!;
const jsonOutput = flag("json-out");
const markdownOutput = flag("markdown-out");

const report = runNormalAllInAudit({
  seeds: auditSeedList(seedCount, seedPrefix),
  clocks,
  eventId,
  maxHandsPerTournament: maxHands,
  auditDate,
  sourceRevision,
  reproductionCommand,
});

const writeOutput = (outputPath: string | undefined, contents: string): void => {
  if (!outputPath) return;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, contents, "utf8");
};

const percent = (value: number): string => (value * 100).toFixed(2) + "%";

const renderClock = (
  summary: ClockAudit,
): string => {
  const gate = summary.releaseGateComparison;
  const gateText = gate
    ? "preflop " + percent(gate.preflop.measured) + " <= " +
      percent(gate.preflop.maximum) + " " + (gate.preflop.pass ? "PASS" : "FAIL") +
      "; postflop " + percent(gate.postflop.measured) + " <= " +
      percent(gate.postflop.maximum) + " " + (gate.postflop.pass ? "PASS" : "FAIL")
    : "not applicable for live-clock replay";
  const streetRows = Object.entries(summary.byStreet)
    .map(([street, bucket]) =>
      "| " + street + " | " + bucket.decisions + " | " + bucket.allInActions +
      " | " + percent(bucket.allInActionRate) + " |")
    .join("\n");
  const depthRows = Object.entries(summary.byEffectiveStack)
    .map(([bucketName, bucket]) =>
      "| " + bucketName + " | " + bucket.decisions + " | " + bucket.allInActions +
      " | " + percent(bucket.allInActionRate) + " |")
    .join("\n");
  return [
    "## " + summary.clock + " clock",
    "",
    "- Tournaments: " + summary.tournaments + " (" + summary.completedTournaments +
      " completed, " + summary.cappedTournaments + " capped)",
    "- Hands / verified decisions: " + summary.hands + " / " + summary.decisions,
    "- All-in actions: " + summary.allInActions + " (" + percent(summary.allInActionRate) + " of decisions)",
    "- Preflop all-in hands: " + summary.handsWithPreflopAllIn + "/" + summary.hands +
      " (" + percent(summary.preflopAllInHandRate) + "; Wilson 95% " +
      percent(summary.preflopAllInHandRateWilson95.lower) + "-" +
      percent(summary.preflopAllInHandRateWilson95.upper) + ")",
    "- Postflop all-in hands: " + summary.handsWithPostflopAllIn + "/" + summary.hands +
      " (" + percent(summary.postflopAllInHandRate) + "; Wilson 95% " +
      percent(summary.postflopAllInHandRateWilson95.lower) + "-" +
      percent(summary.postflopAllInHandRateWilson95.upper) + ")",
    "- Personality-deviation all-ins: " + summary.personalityDeviationAllIns,
    "- Legality/postcondition violations: " + summary.legality.violations +
      " (all " + summary.legality.allInsVerified + " all-ins verified)",
    "- Release-gate comparison: " + gateText,
    "",
    "| Street | Decisions | All-ins | Rate |",
    "| --- | ---: | ---: | ---: |",
    streetRows,
    "",
    "| Effective stack | Decisions | All-ins | Rate |",
    "| --- | ---: | ---: | ---: |",
    depthRows,
  ].join("\n");
};

const markdown = [
  "# Normal-mode all-in audit",
  "",
  "- Status: " + report.status,
  "- Audit date: " + report.auditDate,
  "- Source revision: " + report.sourceRevision,
  "- Event: " + report.inputs.eventId,
  "- Seeds: " + report.inputs.seeds.join(", "),
  "- Maximum hands per tournament: " + report.inputs.maxHandsPerTournament,
  "- Clocks: " + report.inputs.clocks.join(", "),
  "- Reproduction command: " + report.reproductionCommand,
  "",
  "This is a read-only audit of the production Normal-mode engine. It records all-in context and verifies legal action/postcondition invariants; it does not alter bot behavior.",
  "",
  ...report.inputs.clocks.map((clock) => renderClock(report.summaries[clock]!)),
  "",
  "## Source hashes",
  "",
  ...Object.entries(report.relevantSourceSha256).map(([file, hash]) =>
    "- " + file + " — " + hash),
  "",
].join("\n");

writeOutput(jsonOutput, JSON.stringify(report, null, 2) + "\n");
writeOutput(markdownOutput, markdown);

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const clock of clocks) {
    const summary = report.summaries[clock]!;
    console.log(`${clock} clock: ${summary.tournaments} tournaments, ${summary.hands} hands`);
    console.log(
      `  preflop all-in hands  ${summary.handsWithPreflopAllIn}/${summary.hands} ` +
        `(${(summary.preflopAllInHandRate * 100).toFixed(2)}%)`,
    );
    console.log(
      `  postflop all-in hands ${summary.handsWithPostflopAllIn}/${summary.hands} ` +
        `(${(summary.postflopAllInHandRate * 100).toFixed(2)}%)`,
    );
    console.log(
      `  actions / legality    ${summary.allInActions} all-ins; ` +
        `${summary.legality.violations} violations`,
    );
  }
}
