import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  listRegularFiles,
  projectRoot,
  relativePath,
} from "./shared.mjs";

const artifactRoots = [
  join(projectRoot, "dist"),
  join(projectRoot, "electron"),
];
const packageManifestPath = join(projectRoot, "package.json");
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
]);
const forbiddenContent = [
  { name: "source map reference", expression: /[#@]\s*sourceMappingURL\s*=/g },
  { name: "runtime sourceURL", expression: /[#@]\s*sourceURL\s*=/g },
  { name: "debugger statement", expression: /\bdebugger\s*;/g },
  {
    name: "console debug/trace call",
    expression: /\bconsole\.(?:debug|trace)\s*\(/g,
  },
  {
    name: "test-only global marker",
    expression: /\b__(?:TEST|TESTING|E2E|DEBUG)(?:_HOOKS?)?__\b/g,
  },
  { name: "DOM test id", expression: /\bdata-testid\b/g },
  {
    name: "test framework import",
    expression: /@(?:vitest|testing-library)\//g,
  },
];
const files = [
  ...artifactRoots.flatMap((root) => listRegularFiles(root)),
  packageManifestPath,
].sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
const findings = [];
let textFilesScanned = 0;

if (files.length <= 1) {
  throw new Error("No production build artifacts were found.");
}

for (const filePath of files) {
  const relative = relativePath(filePath);
  const extension = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();
  if (extension === ".map") {
    findings.push({ path: relative, kind: "source map file" });
  }
  if (/\.(?:test|spec)\.[^.]+$/i.test(name)) {
    findings.push({ path: relative, kind: "test/spec file" });
  }
  if (!textExtensions.has(extension)) continue;

  textFilesScanned += 1;
  const source = readFileSync(filePath, "utf8");
  for (const pattern of forbiddenContent) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(source)) {
      findings.push({ path: relative, kind: pattern.name });
    }
  }
}

if (findings.length > 0) {
  throw new Error(
    `Production artifact hygiene verification failed:\n${findings
      .map((finding) => `- ${finding.path}: ${finding.kind}`)
      .join("\n")}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      artifactFilesScanned: files.length,
      textArtifactFilesScanned: textFilesScanned,
      sourceMapFiles: 0,
      forbiddenDebugOrTestHookFindings: 0,
      artifactRoots: ["dist/**", "electron/**", "package.json"],
    },
    null,
    2,
  ),
);

