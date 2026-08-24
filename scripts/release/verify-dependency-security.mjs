import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureParentDirectory,
  projectRoot,
  readJson,
} from "./shared.mjs";
import { validateNpmAuditReport } from "./dependency-security-lib.mjs";

const lockfile = readJson(join(projectRoot, "package-lock.json"));
const allowlist = readJson(
  join(projectRoot, "config", "dependency-install-script-allowlist.json"),
);
const lockPackages = lockfile.packages ?? {};
const errors = [];

if (allowlist.schemaVersion !== 1 || !Array.isArray(allowlist.entries)) {
  errors.push("dependency install-script allowlist has an unsupported schema");
}

const approvedScripts = new Map(
  (allowlist.entries ?? []).map((entry) => [
    entry.packagePath,
    { version: entry.version, reason: entry.reason },
  ]),
);
const observedScripts = [];
const registryHosts = new Set();

for (const [packagePath, metadata] of Object.entries(lockPackages)) {
  if (!packagePath || !metadata || typeof metadata !== "object") continue;

  if (metadata.resolved) {
    let resolved;
    try {
      resolved = new URL(String(metadata.resolved).replace(/^git\+/, ""));
    } catch {
      errors.push(`${packagePath} has an unparseable resolution`);
      continue;
    }
    registryHosts.add(resolved.hostname);
    if (
      resolved.protocol !== "https:" ||
      resolved.hostname !== "registry.npmjs.org"
    ) {
      errors.push(
        `${packagePath} resolves outside the approved HTTPS npm registry: ${resolved.protocol}//${resolved.hostname}`,
      );
    }
  }

  if (metadata.hasInstallScript === true) {
    const approved = approvedScripts.get(packagePath);
    observedScripts.push({
      packagePath,
      version: metadata.version,
      installed: existsSync(join(projectRoot, packagePath)),
      reason: approved?.reason ?? null,
    });
    if (!approved) {
      errors.push(`${packagePath} has an unreviewed install lifecycle script`);
    } else if (approved.version !== metadata.version) {
      errors.push(
        `${packagePath} install-script approval is for ${approved.version}, but the lockfile selects ${metadata.version}`,
      );
    }
  }
}

for (const [packagePath, approved] of approvedScripts) {
  const metadata = lockPackages[packagePath];
  if (!metadata?.hasInstallScript) {
    errors.push(
      `${packagePath}@${approved.version} is allowlisted but no longer declares an install script; review and remove the stale approval`,
    );
  }
  if (typeof approved.reason !== "string" || approved.reason.trim().length < 12) {
    errors.push(`${packagePath} install-script approval has no useful rationale`);
  }
}

const audit = runNpmAudit();
if (audit.error) {
  errors.push(audit.error);
}
const auditValidation = validateNpmAuditReport(audit.report);
errors.push(...auditValidation.errors);
const vulnerabilityCounts = auditValidation.vulnerabilityCounts;
for (const severity of ["high", "critical"]) {
  const count = Number(vulnerabilityCounts[severity] ?? 0);
  if (!Number.isFinite(count) || count > 0) {
    errors.push(`npm audit reports ${String(count)} ${severity} vulnerabilities`);
  }
}

const report = {
  schemaVersion: 1,
  ok: errors.length === 0,
  npmAuditReportVersion: audit.report?.auditReportVersion ?? null,
  vulnerabilityCounts,
  lockedPackageEntries: Math.max(0, Object.keys(lockPackages).length - 1),
  approvedRegistryHosts: [...registryHosts].sort(),
  installLifecycleScripts: observedScripts.sort((left, right) =>
    left.packagePath.localeCompare(right.packagePath),
  ),
  errors,
};
const reportPath = join(projectRoot, "work", "dependency-security.json");
ensureParentDirectory(reportPath);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (errors.length > 0) {
  throw new Error(
    `Dependency security verification failed:\n${errors
      .map((error) => `- ${error}`)
      .join("\n")}`,
  );
}

console.log(JSON.stringify(report, null, 2));

function runNpmAudit() {
  const args = [
    "audit",
    "--package-lock-only",
    "--json",
    "--audit-level=high",
  ];
  const isWindows = process.platform === "win32";
  const result = spawnSync(
    isWindows ? process.env.ComSpec || "cmd.exe" : "npm",
    isWindows ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args,
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 25 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error) {
    return {
      report: null,
      error: `npm audit could not start: ${result.error.message}`,
    };
  }

  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch {
    return {
      report: null,
      error: `npm audit returned invalid JSON (exit ${String(result.status)}): ${String(result.stderr).trim()}`,
    };
  }
  if (result.status !== 0) {
    return {
      report,
      error: `npm audit exited ${String(result.status)}`,
    };
  }
  return { report, error: "" };
}
