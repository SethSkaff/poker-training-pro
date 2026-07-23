import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(scriptDirectory, "..");
const testParent = join(projectRoot, "work", "package-license-gate-tests");
mkdirSync(testParent, { recursive: true });
const testRoot = mkdtempSync(join(testParent, "case-"));
const nodeModulesJunction = join(testRoot, "node_modules");

try {
  for (const directory of ["config", "public", "scripts", "src", "work"]) {
    mkdirSync(join(testRoot, directory), { recursive: true });
  }
  for (const relativePath of [
    "package.json",
    "package-lock.json",
    "index.html",
    "config/package-license-catalog.json",
    "config/package-license-policy.json",
    "scripts/generate-third-party-audit.mjs",
  ]) {
    copyFileSync(join(projectRoot, relativePath), join(testRoot, relativePath));
  }
  symlinkSync(join(projectRoot, "node_modules"), nodeModulesJunction, "junction");

  const originalCatalog = readJson(
    join(testRoot, "config", "package-license-catalog.json"),
  );
  expectResult("valid catalog", originalCatalog, true);

  const missingEvidence = structuredClone(originalCatalog);
  missingEvidence.entries.pop();
  expectResult("missing evidence", missingEvidence, false);

  const nonstandard = structuredClone(originalCatalog);
  nonstandard.entries[0].license = "SEE LICENSE IN LICENSE";
  nonstandard.entries[0].evidence.value = "SEE LICENSE IN LICENSE";
  expectResult("nonstandard declaration", nonstandard, false);

  const stale = structuredClone(originalCatalog);
  stale.entries.push({
    name: "deliberately-stale-license-test",
    version: "0.0.0-test",
    license: "MIT",
    evidence: {
      kind: "npm-registry-version-metadata",
      field: "license",
      value: "MIT",
      url: "https://registry.npmjs.org/deliberately-stale-license-test/0.0.0-test",
    },
    repository: "UNKNOWN",
    tarball: "UNKNOWN",
  });
  expectResult("stale evidence", stale, false);

  console.log(
    "Package-license negative gate tests passed: valid=pass, missing=fail, nonstandard=fail, stale=fail.",
  );
} finally {
  if (resolve(nodeModulesJunction).startsWith(`${resolve(testRoot)}${sep}`)) {
    try {
      unlinkSync(nodeModulesJunction);
    } catch {
      // The junction may not exist if setup failed before it was created.
    }
  }
  const resolvedTestRoot = resolve(testRoot);
  const resolvedParent = resolve(testParent);
  if (!resolvedTestRoot.startsWith(`${resolvedParent}${sep}`)) {
    throw new Error(`Refusing to remove unexpected test path: ${resolvedTestRoot}`);
  }
  rmSync(resolvedTestRoot, { recursive: true, force: true });
}

function expectResult(label, catalog, expectedSuccess) {
  writeFileSync(
    join(testRoot, "config", "package-license-catalog.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [join(testRoot, "scripts", "generate-third-party-audit.mjs")],
    {
      cwd: testRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true", TZ: "UTC" },
      shell: false,
    },
  );
  const succeeded = result.status === 0;
  if (succeeded !== expectedSuccess) {
    throw new Error(
      `${label} produced exit ${String(result.status)}.\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
