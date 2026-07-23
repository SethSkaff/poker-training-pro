import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const defaultRoot = resolve(scriptDirectory, "..", "..");
const rootArgumentIndex = process.argv.indexOf("--root");
const root =
  rootArgumentIndex >= 0
    ? resolve(process.argv[rootArgumentIndex + 1] ?? "")
    : defaultRoot;

const requiredDocuments = [
  "CHANGELOG.md",
  "docs/release-known-issues.md",
  "docs/save-compatibility-matrix.md",
  "docs/support-response-procedure.md",
  "docs/end-of-support-policy.md",
  "docs/release-operations-index.md",
];

const errors = [];
const documents = new Map();

for (const path of requiredDocuments) {
  const absolutePath = join(root, path);
  if (!existsSync(absolutePath)) {
    errors.push(`${path}: required release document is missing`);
    continue;
  }
  documents.set(path, readFileSync(absolutePath, "utf8"));
}

let packageVersion;
try {
  packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
} catch (error) {
  errors.push(`package.json: cannot read version (${safeMessage(error)})`);
}

if (typeof packageVersion !== "string" || !packageVersion.trim()) {
  errors.push("package.json: version must be a non-empty string");
} else {
  requirePattern(
    "CHANGELOG.md",
    new RegExp(`^## \\[${escapeRegex(packageVersion)}\\] - Unreleased$`, "m"),
    `must contain an unreleased ${packageVersion} heading`,
  );
  requirePattern(
    "docs/save-compatibility-matrix.md",
    new RegExp(`Application version: \`${escapeRegex(packageVersion)}\` \\(unreleased\\)`),
    `must identify package version ${packageVersion} as unreleased`,
  );
}

requirePattern("CHANGELOG.md", /^## \[Unreleased\]$/m, "must keep an Unreleased section");
requirePattern(
  "CHANGELOG.md",
  /not a public release/i,
  "must state that the current version is not public",
);

requirePattern(
  "docs/release-known-issues.md",
  /Status: \*\*pre-release blocker register\*\*/i,
  "must identify its pre-release status",
);
for (const id of Array.from({ length: 10 }, (_, index) => `PTP-${String(index + 1).padStart(3, "0")}`)) {
  requirePattern(
    "docs/release-known-issues.md",
    new RegExp(`\\\`${id}\\\``),
    `must retain blocker ${id}`,
  );
}
const knownIssues = documents.get("docs/release-known-issues.md") ?? "";
const issueIds = [...knownIssues.matchAll(/`(PTP-\d{3})`/g)].map((match) => match[1]);
const issueCounts = new Map();
for (const id of issueIds) issueCounts.set(id, (issueCounts.get(id) ?? 0) + 1);
for (const [id, count] of issueCounts) {
  if (count > 1 && /^PTP-0/.test(id)) {
    errors.push(`docs/release-known-issues.md: release blocker ${id} appears ${count} times`);
  }
}

for (const token of [
  "Journal format: `poker-training-pro-autosave`, version `1`",
  "Payload format: `poker-training-pro-save`, version `1`",
  "read-only recovery",
  "rollback",
]) {
  requireText("docs/save-compatibility-matrix.md", token);
}

for (const token of [
  "draft — not operational",
  "Support owner | Unassigned",
  "Support contact/channel | Unassigned",
  "Response SLA | No SLA approved",
  "Do not state an SLA",
]) {
  requireText("docs/support-response-procedure.md", token, true);
}

for (const token of [
  "not yet activated",
  "no public version is currently in a supported lifecycle",
  "No minimum notice interval is promised yet",
  "Development preview",
]) {
  requireText("docs/end-of-support-policy.md", token, true);
}

for (const target of [
  "../CHANGELOG.md",
  "release-known-issues.md",
  "save-compatibility-matrix.md",
  "support-response-procedure.md",
  "end-of-support-policy.md",
  "../THIRD-PARTY-NOTICES.packages.md",
  "../work/third-party-audit.md",
  "../config/asset-rights-ledger.json",
  "asset-rights-release-policy.md",
  "audio/playlist-license-research.md",
]) {
  requireText("docs/release-operations-index.md", `](${target})`);
}

for (const [documentPath, source] of documents) {
  if (/example\.invalid/i.test(source)) {
    errors.push(`${documentPath}: placeholder publisher/release URLs are forbidden`);
  }
  validateLocalLinks(documentPath, source);
}

if (errors.length > 0) {
  console.error(
    `Release-document validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n` +
      errors.map((error) => `- ${error}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      packageVersion,
      documents: requiredDocuments,
      releaseBlockers: 10,
      status: "pre-release-blocked",
    },
    null,
    2,
  ),
);

function requirePattern(documentPath, pattern, message) {
  const source = documents.get(documentPath);
  if (source !== undefined && !pattern.test(source)) {
    errors.push(`${documentPath}: ${message}`);
  }
}

function requireText(documentPath, token, caseInsensitive = false) {
  const source = documents.get(documentPath);
  if (source === undefined) return;
  const haystack = caseInsensitive ? source.toLocaleLowerCase("en-US") : source;
  const needle = caseInsensitive ? token.toLocaleLowerCase("en-US") : token;
  if (!haystack.includes(needle)) {
    errors.push(`${documentPath}: missing required text ${JSON.stringify(token)}`);
  }
}

function validateLocalLinks(documentPath, source) {
  const baseDirectory = dirname(join(root, documentPath));
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    if (
      !rawTarget ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }
    const withoutAnchor = decodeURIComponent(rawTarget.split("#", 1)[0]);
    const target = isAbsolute(withoutAnchor)
      ? withoutAnchor
      : resolve(baseDirectory, withoutAnchor);
    if (!existsSync(target)) {
      errors.push(
        `${documentPath}: local link ${JSON.stringify(rawTarget)} does not exist (${relative(root, target)})`,
      );
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
