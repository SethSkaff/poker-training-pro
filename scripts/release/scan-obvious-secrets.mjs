import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  listRegularFiles,
  projectRoot,
  relativePath,
} from "./shared.mjs";

const excludedTopLevelDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "work",
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const textBasenames = new Set([
  ".npmrc",
  ".yarnrc",
  "dockerfile",
  "makefile",
]);
const maximumTextBytes = 2 * 1024 * 1024;
const allowMarker = "release-secret-scan:" + " allow";
const patterns = [
  {
    name: "private key material",
    expression: new RegExp(
      ["-----BEGIN ", "(?:RSA |EC |DSA |OPENSSH |PGP )?", "PRIVATE KEY-----"].join(
        "",
      ),
      "g",
    ),
  },
  {
    name: "AWS access key",
    expression: new RegExp(["AK", "IA[0-9A-Z]{16}"].join(""), "g"),
  },
  {
    name: "GitHub token",
    expression: new RegExp(
      ["(?:gh[pousr]_", "[A-Za-z0-9]{36,255}", "|github_pat_", "[A-Za-z0-9_]{40,255})"].join(
        "",
      ),
      "g",
    ),
  },
  {
    name: "Slack token",
    expression: new RegExp(
      ["xox", "[aboprs]-[A-Za-z0-9-]{10,}"].join(""),
      "g",
    ),
  },
  {
    name: "Stripe live secret",
    expression: new RegExp(["sk_", "live_[A-Za-z0-9]{16,}"].join(""), "g"),
  },
  {
    name: "Google API key",
    expression: new RegExp(["AI", "za[0-9A-Za-z_-]{35}"].join(""), "g"),
  },
  {
    name: "credential-bearing URL",
    expression:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s@]+@/gi,
  },
];
const assignmentExpression =
  /\b(api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b\s*[:=]\s*["'`]([^"'`\r\n]{12,})["'`]/gi;

const candidates = listRepositoryCandidates();
const findings = [];
let scannedBytes = 0;

for (const filePath of candidates) {
  const bytes = readFileSync(filePath);
  if (bytes.length > maximumTextBytes || bytes.includes(0)) continue;
  scannedBytes += bytes.length;
  const source = bytes.toString("utf8");
  const lines = source.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.includes(allowMarker)) continue;

    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      if (pattern.expression.test(line)) {
        findings.push({
          path: relativePath(filePath),
          line: lineIndex + 1,
          kind: pattern.name,
        });
      }
    }

    assignmentExpression.lastIndex = 0;
    for (const match of line.matchAll(assignmentExpression)) {
      if (!looksLikePlaceholder(match[2])) {
        findings.push({
          path: relativePath(filePath),
          line: lineIndex + 1,
          kind: `hard-coded ${match[1]}`,
        });
      }
    }
  }
}

if (findings.length > 0) {
  throw new Error(
    `Obvious secret scan found ${findings.length} potential credential${findings.length === 1 ? "" : "s"}:\n${findings
      .map(
        (finding) =>
          `- ${finding.path}:${finding.line} (${finding.kind}; value redacted)`,
      )
      .join(
        "\n",
      )}\nUse an environment/secret store. For an intentional synthetic fixture, add the exact marker "${allowMarker}" on that line.`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      filesScanned: candidates.length,
      bytesScanned: scannedBytes,
      findings: 0,
      excludedDirectories: [...excludedTopLevelDirectories].sort(),
      scope:
        "Repository text inputs only; generated output, dependencies, binary files, and files over 2 MiB are excluded. This is a high-signal heuristic scan, not a complete credential-history scanner.",
    },
    null,
    2,
  ),
);

function listRepositoryCandidates() {
  const files = [];
  const topLevelEntries = readdirSync(projectRoot, {
    withFileTypes: true,
  }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of topLevelEntries) {
    if (entry.isDirectory() && excludedTopLevelDirectories.has(entry.name)) {
      continue;
    }
    const entryPath = join(projectRoot, entry.name);
    const candidates = entry.isDirectory()
      ? listRegularFiles(entryPath)
      : entry.isFile()
        ? [entryPath]
        : [];
    for (const candidate of candidates) {
      const name = basename(candidate).toLowerCase();
      const extension = extname(candidate).toLowerCase();
      if (
        textExtensions.has(extension) ||
        textBasenames.has(name) ||
        name.startsWith(".env.")
      ) {
        files.push(candidate);
      }
    }
  }
  return files.sort((left, right) =>
    relativePath(left).localeCompare(relativePath(right)),
  );
}

function looksLikePlaceholder(value) {
  const normalized = value.trim();
  return (
    normalized.length < 12 ||
    /^(?:changeme|example|placeholder|redacted|not[_ -]?set|your[_ -])/i.test(
      normalized,
    ) ||
    /^(?:process\.env|import\.meta\.env|\$\{|\{\{|<[^>]+>)/.test(normalized) ||
    /^x+$/i.test(normalized)
  );
}
