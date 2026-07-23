import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { auditProductionComposition } from "./lib/production-composition-audit.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

try {
  const report = auditProductionComposition({ projectRoot });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `Production composition audit failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
}
