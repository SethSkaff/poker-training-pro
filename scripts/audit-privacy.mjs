import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const runtimeRoots = ["src", "electron"].map((directory) =>
  path.join(projectRoot, directory),
);
const runtimeFiles = runtimeRoots.flatMap(walk).filter((file) =>
  [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(
    path.extname(file).toLowerCase(),
  ),
);
const dependencyNames = Object.keys({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {}),
});
const prohibitedDependency =
  /(?:analytics|amplitude|appcenter|bugsnag|datadog|firebase|fullstory|heap|mixpanel|newrelic|posthog|segment|sentry|telemetry)/i;
const prohibitedRuntimePatterns = [
  { name: "beacon upload", pattern: /\bnavigator\.sendBeacon\s*\(/ },
  { name: "fetch client", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest client", pattern: /\bXMLHttpRequest\b/ },
  { name: "WebSocket client", pattern: /\bnew\s+WebSocket\s*\(/ },
  {
    name: "external HTTP endpoint",
    pattern: /\bhttps?:\/\/(?!127\.0\.0\.1(?::5173)?(?:\/|["'`]))[^\s"'`)]+/i,
  },
];
const findings = [];

for (const dependency of dependencyNames) {
  if (prohibitedDependency.test(dependency)) {
    findings.push({
      type: "dependency",
      file: "package.json",
      detail: dependency,
    });
  }
}

for (const file of runtimeFiles) {
  const contents = readFileSync(file, "utf8");
  for (const rule of prohibitedRuntimePatterns) {
    if (rule.pattern.test(contents)) {
      findings.push({
        type: rule.name,
        file: path.relative(projectRoot, file).replaceAll("\\", "/"),
        detail: contents.match(rule.pattern)?.[0] ?? "matched",
      });
    }
  }
}

const policy = readFileSync(
  path.join(projectRoot, "docs", "privacy-policy.md"),
  "utf8",
);
const normalizedPolicy = policy.replace(/\s+/g, " ");
const requiredPolicyStatements = [
  "no account",
  "advertising",
  "analytics",
  "remote crash-report upload",
  "play chips",
  "no real-money wagering",
  "retention and deletion",
  "userData",
];
for (const statement of requiredPolicyStatements) {
  if (!normalizedPolicy.toLowerCase().includes(statement.toLowerCase())) {
    findings.push({
      type: "policy",
      file: "docs/privacy-policy.md",
      detail: `missing statement: ${statement}`,
    });
  }
}

const report = {
  ok: findings.length === 0,
  runtimeFiles: runtimeFiles.length,
  productionDependencies: dependencyNames.length,
  findings,
  publicPolicyUrlReady: false,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exit(1);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : statSync(target).isFile() ? [target] : [];
  });
}
