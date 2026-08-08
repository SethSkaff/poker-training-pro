import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const forbiddenMarker = "PTP_DEV_TRAINING_ANSWER_KEY_V1";
const forbiddenArchivePaths = [
  /^\\?scripts[\\/]training-scenario-tool\.ts$/i,
  /^\\?scripts[\\/]training-tools(?:[\\/]|$)/i,
  /^\\?work[\\/]training-(?:drafts|exports|simulations)(?:[\\/]|$)/i,
];
const productionSourceRoots = ["src", "electron"];

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function textFile(file) {
  return /\.(?:cjs|css|html|js|json|mjs|ts|tsx)$/i.test(file);
}

export function auditTrainingToolExclusion(options = {}) {
  const root = path.resolve(options.projectRoot ?? projectRoot);
  const dist = path.resolve(options.distDirectory ?? path.join(root, "dist"));
  const archive = path.resolve(
    options.asarPath ??
      path.join(
        root,
        "outputs",
        "next",
        "win-unpacked",
        "resources",
        "app.asar",
      ),
  );
  const findings = [];

  for (const relativeRoot of productionSourceRoots) {
    for (const file of listFiles(path.join(root, relativeRoot))) {
      if (!textFile(file)) continue;
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)) continue;
      const source = readFileSync(file, "utf8");
      if (
        source.includes(forbiddenMarker) ||
        /(?:from|import\s*\()\s*["'][^"']*scripts[\\/]training-(?:scenario-tool|tools)/i.test(
          source,
        )
      ) {
        findings.push({
          surface: "production-source",
          path: path.relative(root, file).replaceAll("\\", "/"),
        });
      }
    }
  }

  for (const file of listFiles(dist)) {
    if (!textFile(file) || statSync(file).size > 20_000_000) continue;
    const source = readFileSync(file, "utf8");
    if (
      source.includes(forbiddenMarker) ||
      source.includes("Developer-only Training scenario tool")
    ) {
      findings.push({
        surface: "dist",
        path: path.relative(root, file).replaceAll("\\", "/"),
      });
    }
  }

  let asarInspected = false;
  let asarEntries = 0;
  if (existsSync(archive)) {
    asarInspected = true;
    const entries = asar.listPackage(archive, { isPack: false });
    asarEntries = entries.length;
    for (const entry of entries) {
      if (forbiddenArchivePaths.some((pattern) => pattern.test(entry))) {
        findings.push({ surface: "asar", path: entry.replaceAll("\\", "/") });
      }
    }
  } else if (options.requireAsar) {
    findings.push({
      surface: "asar",
      path: path.relative(root, archive).replaceAll("\\", "/"),
      reason: "required archive is missing",
    });
  }

  return {
    ok: findings.length === 0,
    marker: forbiddenMarker,
    productionSourceRoots,
    distInspected: existsSync(dist),
    asarInspected,
    asarEntries,
    findings,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditTrainingToolExclusion({
    requireAsar: process.argv.includes("--require-asar"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
