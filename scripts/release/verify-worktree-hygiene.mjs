import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  findConflictMarkerLines,
  isRejectedMergeArtifact,
  shouldInspectConflictMarkers,
} from "./worktree-hygiene-lib.mjs";
import { projectRoot } from "./shared.mjs";

const ROOTS = Object.freeze([
  "config",
  "docs",
  "electron",
  "scripts",
  "src",
]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const findings = [];
let filesScanned = 0;
let textFilesScanned = 0;

for (const rootName of ROOTS) {
  const root = join(projectRoot, rootName);
  for (const filePath of await walkFiles(root)) {
    filesScanned += 1;
    const displayPath = relative(projectRoot, filePath).split(sep).join("/");
    if (isRejectedMergeArtifact(displayPath)) {
      findings.push({
        path: displayPath,
        kind: "merge-artifact",
        message: "Rejected/backup merge artifact must be resolved and removed.",
      });
      continue;
    }
    if (!shouldInspectConflictMarkers(displayPath)) continue;
    const bytes = await readFile(filePath);
    if (bytes.length > MAX_TEXT_BYTES || bytes.includes(0)) continue;
    textFilesScanned += 1;
    const lines = findConflictMarkerLines(bytes.toString("utf8"));
    for (const line of lines) {
      findings.push({
        path: displayPath,
        line,
        kind: "conflict-marker",
        message: "Unresolved source-control conflict marker.",
      });
    }
  }
}

findings.sort((left, right) =>
  `${left.path}:${left.line ?? 0}:${left.kind}`.localeCompare(
    `${right.path}:${right.line ?? 0}:${right.kind}`,
  ),
);

const report = {
  ok: findings.length === 0,
  roots: ROOTS,
  filesScanned,
  textFilesScanned,
  findings,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

async function walkFiles(root) {
  const resolvedRoot = resolve(root);
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = join(resolvedRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(candidate)));
    } else if (entry.isFile()) {
      files.push(candidate);
    }
  }
  return files;
}
