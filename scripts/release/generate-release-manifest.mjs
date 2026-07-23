import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureParentDirectory,
  listRegularFiles,
  projectRoot,
  readJson,
  relativePath,
  sha256,
  workDirectory,
} from "./shared.mjs";

const packageJsonPath = join(projectRoot, "package.json");
const packageLockPath = join(projectRoot, "package-lock.json");
const manifestPath = join(workDirectory, "release-manifest.json");
const packageJson = readJson(packageJsonPath);
const artifactFiles = [
  ...listRegularFiles(join(projectRoot, "dist")),
  ...listRegularFiles(join(projectRoot, "electron")),
  packageJsonPath,
].sort((left, right) => relativePath(left).localeCompare(relativePath(right)));

if (artifactFiles.length <= 1) {
  throw new Error("Cannot create a release manifest without build artifacts.");
}

const artifacts = artifactFiles.map(fileRecord);
const releaseInputs = [packageJsonPath, packageLockPath]
  .map(fileRecord)
  .sort((left, right) => left.path.localeCompare(right.path));
const manifest = {
  schemaVersion: 1,
  application: {
    name: packageJson.name,
    version: packageJson.version,
  },
  hashAlgorithm: "sha256",
  artifactSelection: ["dist/**", "electron/**", "package.json"],
  artifacts,
  summary: {
    files: artifacts.length,
    bytes: artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
  },
  releaseInputs,
  reproducibility:
    "No timestamp or host path is recorded. Equal artifact bytes produce byte-identical manifest JSON.",
};

ensureParentDirectory(manifestPath);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const manifestBytes = readFileSync(manifestPath);
console.log(
  JSON.stringify(
    {
      ok: true,
      path: relativePath(manifestPath),
      files: manifest.summary.files,
      bytes: manifest.summary.bytes,
      manifestBytes: manifestBytes.length,
      manifestSha256: sha256(manifestBytes),
    },
    null,
    2,
  ),
);

function fileRecord(filePath) {
  const bytes = readFileSync(filePath);
  return {
    path: relativePath(filePath),
    bytes: statSync(filePath).size,
    sha256: sha256(bytes),
  };
}

