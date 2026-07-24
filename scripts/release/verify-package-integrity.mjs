import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  projectRoot,
  readJson,
  relativePath,
  sha256,
} from "./shared.mjs";

const packageJsonPath = join(projectRoot, "package.json");
const lockfilePath = join(projectRoot, "package-lock.json");
const packageJson = readJson(packageJsonPath);
const lockfile = readJson(lockfilePath);
const errors = [];

if (lockfile.lockfileVersion !== 3) {
  errors.push(
    `expected package-lock lockfileVersion 3, received ${String(lockfile.lockfileVersion)}`,
  );
}

const lockPackages = lockfile.packages;
if (!lockPackages || typeof lockPackages !== "object") {
  errors.push("package-lock.json has no packages inventory");
}

const lockRoot = lockPackages?.[""];
if (!lockRoot || typeof lockRoot !== "object") {
  errors.push("package-lock.json has no root package entry");
} else {
  compareValue("name", packageJson.name, lockRoot.name);
  compareValue("version", packageJson.version, lockRoot.version);
  for (const section of [
    "dependencies",
    "devDependencies",
    "engines",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    compareRecord(section, packageJson[section], lockRoot[section]);
  }
}

let integrityEntries = 0;
let installedEntries = 0;
let absentOptionalEntries = 0;

for (const [packagePath, metadata] of Object.entries(lockPackages ?? {}).sort(
  ([left], [right]) => left.localeCompare(right),
)) {
  if (packagePath === "") continue;
  if (
    packagePath.includes("\\") ||
    packagePath.startsWith("/") ||
    packagePath.split("/").includes("..")
  ) {
    errors.push(`unsafe package-lock path: ${packagePath}`);
    continue;
  }
  if (!metadata || typeof metadata !== "object") {
    errors.push(`invalid package-lock metadata at ${packagePath}`);
    continue;
  }
  if (!metadata.link && !nonEmptyString(metadata.version)) {
    errors.push(`missing version at ${packagePath}`);
  }
  if (isRemoteResolution(metadata.resolved)) {
    if (!isValidSri(metadata.integrity)) {
      errors.push(`missing or malformed SRI integrity at ${packagePath}`);
    } else {
      integrityEntries += 1;
    }
  }

  for (const section of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [dependencyName, requestedVersion] of Object.entries(
      metadata[section] ?? {},
    )) {
      if (!isExactVersion(requestedVersion)) continue;
      const resolvedDependency = resolveLockedDependency(
        packagePath,
        dependencyName,
      );
      if (
        resolvedDependency &&
        resolvedDependency.metadata.version !== requestedVersion
      ) {
        errors.push(
          `${packagePath} requires exact ${section}.${dependencyName}=${requestedVersion}, but lock resolution selects ${resolvedDependency.metadata.version} at ${resolvedDependency.path}`,
        );
      }
    }
  }

  const installedManifestPath = join(projectRoot, packagePath, "package.json");
  if (!existsSync(installedManifestPath)) {
    if (metadata.optional === true || metadata.devOptional === true) {
      absentOptionalEntries += 1;
    } else {
      errors.push(`locked package is not installed: ${packagePath}`);
    }
    continue;
  }
  installedEntries += 1;
  const installedManifest = readJson(installedManifestPath);
  if (
    !metadata.link &&
    nonEmptyString(metadata.version) &&
    installedManifest.version !== metadata.version
  ) {
    errors.push(
      `installed version mismatch at ${packagePath}: lock=${metadata.version}, installed=${String(installedManifest.version)}`,
    );
  }
}

for (const section of ["dependencies", "devDependencies"]) {
  for (const dependencyName of Object.keys(packageJson[section] ?? {}).sort()) {
    const packagePath = `node_modules/${dependencyName}`;
    if (!lockPackages?.[packagePath]) {
      errors.push(`${section}.${dependencyName} has no top-level lock entry`);
    }
  }
}

const npmTree = inspectNpmTree();
if (!npmTree.ok) {
  errors.push(
    ...npmTree.problems.map((problem) => `npm dependency tree: ${problem}`),
  );
}

if (errors.length > 0) {
  throw new Error(
    `Package integrity verification failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):\n${errors
      .map((error) => `- ${error}`)
      .join("\n")}`,
  );
}

const packageBytes = readFileSync(packageJsonPath);
const lockfileBytes = readFileSync(lockfilePath);
console.log(
  JSON.stringify(
    {
      ok: true,
      lockfileVersion: lockfile.lockfileVersion,
      lockedPackageEntries: Math.max(
        0,
        Object.keys(lockPackages ?? {}).length - 1,
      ),
      sriIntegrityEntries: integrityEntries,
      installedPackageEntriesVerified: installedEntries,
      absentOptionalPackageEntries: absentOptionalEntries,
      npmDependencyTree: {
        valid: npmTree.ok,
        topLevelEntries: npmTree.topLevelEntries,
      },
      inputs: [
        {
          path: relativePath(packageJsonPath),
          bytes: packageBytes.length,
          sha256: sha256(packageBytes),
        },
        {
          path: relativePath(lockfilePath),
          bytes: lockfileBytes.length,
          sha256: sha256(lockfileBytes),
        },
      ],
      note:
        "This verifies lock structure, declared SRI metadata, and installed versions. A clean npm ci in CI performs archive-content integrity verification.",
    },
    null,
    2,
  ),
);

function compareValue(label, expected, actual) {
  if (expected !== actual) {
    errors.push(
      `root ${label} mismatch: package.json=${String(expected)}, package-lock.json=${String(actual)}`,
    );
  }
}

function inspectNpmTree() {
  const isWindows = process.platform === "win32";
  const result = spawnSync(
    isWindows ? process.env.ComSpec || "cmd.exe" : "npm",
    isWindows
      ? ["/d", "/s", "/c", "npm.cmd ls --all --json"]
      : ["ls", "--all", "--json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error) {
    return {
      ok: false,
      problems: [`npm ls could not start: ${result.error.message}`],
      topLevelEntries: 0,
    };
  }

  let tree;
  try {
    tree = JSON.parse(result.stdout || "{}");
  } catch {
    return {
      ok: false,
      problems: [
        `npm ls returned non-JSON output (exit ${String(result.status)})`,
      ],
      topLevelEntries: 0,
    };
  }
  const reportedProblems = Array.isArray(tree.problems)
    ? tree.problems.map(String)
    : [];
  if (result.status !== 0 && reportedProblems.length === 0) {
    reportedProblems.push(
      `npm ls exited ${String(result.status)}: ${String(result.stderr).trim() || "unknown dependency-tree error"}`,
    );
  }
  return {
    ok: result.status === 0 && reportedProblems.length === 0,
    problems: reportedProblems,
    topLevelEntries: Object.keys(tree.dependencies ?? {}).length,
  };
}

function compareRecord(label, packageValue, lockValue) {
  const normalizedPackageValue = sortedRecord(packageValue ?? {});
  const normalizedLockValue = sortedRecord(lockValue ?? {});
  if (
    JSON.stringify(normalizedPackageValue) !== JSON.stringify(normalizedLockValue)
  ) {
    errors.push(
      `root ${label} differs between package.json and package-lock.json`,
    );
  }
}

function sortedRecord(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRemoteResolution(value) {
  return (
    typeof value === "string" &&
    /^(?:https?:|git\+|github:|gitlab:|bitbucket:)/i.test(value)
  );
}

function isValidSri(value) {
  if (typeof value !== "string") return false;
  return value.split(/\s+/).every((token) =>
    /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/.test(token),
  );
}

function isExactVersion(value) {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function resolveLockedDependency(dependentPackagePath, dependencyName) {
  let currentPackagePath = dependentPackagePath;
  while (true) {
    const candidatePath = currentPackagePath
      ? `${currentPackagePath}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    const metadata = lockPackages?.[candidatePath];
    if (metadata) {
      return { path: candidatePath, metadata };
    }
    const parentMarker = currentPackagePath.lastIndexOf("/node_modules/");
    if (parentMarker >= 0) {
      currentPackagePath = currentPackagePath.slice(0, parentMarker);
    } else if (currentPackagePath.startsWith("node_modules/")) {
      currentPackagePath = "";
    } else {
      return undefined;
    }
  }
}
