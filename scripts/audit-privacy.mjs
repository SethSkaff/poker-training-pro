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
const sourceFiles = runtimeRoots.flatMap(walk).filter((file) =>
  [".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(
    path.extname(file).toLowerCase(),
  ),
);
// Fixtures are deliberately hostile in places, and this catalogue is a rights
// research document rather than a module reachable from the shipped entrypoint.
// Keep the latter exemption honest below by failing if production source starts
// importing it.
const isTestFixture = (file) => /(?:^|[\\/])[^\\/]+\.test\.[^.]+$/i.test(file);
const researchCatalogue = path.join(
  projectRoot,
  "src",
  "data",
  "musicRotationCatalogue.ts",
);
const runtimeFiles = sourceFiles.filter(
  (file) => !isTestFixture(file) && file !== researchCatalogue,
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

for (const file of runtimeFiles) {
  if (
    readFileSync(file, "utf8").includes("musicRotationCatalogue") &&
    file !== researchCatalogue
  ) {
    findings.push({
      type: "non-runtime module reachable",
      file: path.relative(projectRoot, file).replaceAll("\\", "/"),
      detail: "imports the rights-research music catalogue",
    });
  }
}

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
    const relativeFile = path.relative(projectRoot, file).replaceAll("\\", "/");
    const matcher = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`,
    );
    for (const match of contents.matchAll(matcher)) {
      if (
        rule.name === "external HTTP endpoint" &&
        isReviewedNonEgressUrl(relativeFile, match[0])
      ) {
        continue;
      }
      findings.push({ type: rule.name, file: relativeFile, detail: match[0] });
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
  excludedTestFixtures: sourceFiles.filter(isTestFixture).length,
  reviewedNonRuntimeModules: 1,
  productionDependencies: dependencyNames.length,
  findings,
  publicPolicyUrlReady: false,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exit(1);

/**
 * Narrow, evidence-backed exceptions for strings which cannot initiate I/O.
 * Egress primitives are audited independently above, so using either value in
 * fetch/WebSocket/XMLHttpRequest still fails. Electron also denies every
 * window.open and non-app navigation; these values exist solely for legally
 * required music attribution in the Credits screen.
 */
function isReviewedNonEgressUrl(file, value) {
  if (
    file === "electron/main.cjs" &&
    value === "http://127.0.0.1:${developmentServerPort}"
  ) {
    return true;
  }
  if (file !== "src/data/musicPlaylistManifest.ts") return false;
  return (
    value ===
      "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=" ||
    value === "https://creativecommons.org/licenses/by/4.0/"
  );
}

// Classification regression checks: exact reviewed literals pass, close
// variants and arbitrary endpoints do not acquire a blanket domain exemption.
if (
  !isReviewedNonEgressUrl(
    "electron/main.cjs",
    "http://127.0.0.1:${developmentServerPort}",
  ) ||
  isReviewedNonEgressUrl("electron/main.cjs", "http://127.0.0.1:9999/steal") ||
  isReviewedNonEgressUrl(
    "src/data/musicPlaylistManifest.ts",
    "https://incompetech.com/api/telemetry",
  )
) {
  throw new Error("privacy audit non-egress URL classification regression");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : statSync(target).isFile() ? [target] : [];
  });
}
