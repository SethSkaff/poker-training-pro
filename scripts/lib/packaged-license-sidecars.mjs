import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import {
  assembleRuntimePackageNotices,
  loadRuntimePackageNoticeInputs,
  verifyRuntimePackageNoticeArtifact,
} from "./runtime-package-notices.mjs";

export const PACKAGED_LICENSE_SIDECAR_SCHEMA_VERSION = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function normalizeRelative(relativePath) {
  return relativePath.replaceAll("\\", "/");
}

export function resolveSidecarPath(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const normalized = normalizeRelative(relativePath);
  if (
    path.isAbsolute(relativePath) ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} escapes its allowed root: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, ...normalized.split("/"));
  if (
    absolute === resolvedRoot ||
    !absolute.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${label} escapes its allowed root: ${relativePath}`);
  }
  return absolute;
}

function readRegularFile(root, relativePath, label) {
  const absolute = resolveSidecarPath(root, relativePath, label);
  if (!existsSync(absolute)) {
    throw new Error(`${label} is missing: ${relativePath}`);
  }
  const metadata = lstatSync(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file: ${relativePath}`);
  }
  return readFileSync(absolute);
}

function validateBounds(file, bytes) {
  if (
    !Number.isSafeInteger(file.minimumBytes) ||
    !Number.isSafeInteger(file.maximumBytes) ||
    file.minimumBytes < 1 ||
    file.maximumBytes < file.minimumBytes
  ) {
    throw new Error(`Invalid size bounds for ${file.id}.`);
  }
  if (
    bytes.length < file.minimumBytes ||
    bytes.length > file.maximumBytes
  ) {
    throw new Error(
      `${file.id} size ${bytes.length} is outside ` +
        `${file.minimumBytes}..${file.maximumBytes} bytes.`,
    );
  }
}

function validatePolicy(policy) {
  if (
    policy.schemaVersion !== PACKAGED_LICENSE_SIDECAR_SCHEMA_VERSION ||
    !Array.isArray(policy.files) ||
    policy.files.length !== 3 ||
    !Number.isSafeInteger(policy.maximumTotalBytes) ||
    policy.maximumTotalBytes < 1
  ) {
    throw new Error("Packaged license sidecar policy has an unsupported schema.");
  }
  const ids = policy.files.map((file) => String(file.id));
  const targets = policy.files.map((file) =>
    normalizeRelative(String(file.targetPath)),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("Packaged license sidecar policy contains duplicate IDs.");
  }
  if (new Set(targets).size !== targets.length) {
    throw new Error(
      "Packaged license sidecar policy contains duplicate target paths.",
    );
  }
  const expectedKinds = [
    "generated-runtime-notices",
    "pinned-electron-sidecar",
    "pinned-electron-sidecar",
  ];
  const actualKinds = policy.files
    .map((file) => file.kind)
    .sort();
  if (JSON.stringify(actualKinds) !== JSON.stringify(expectedKinds.sort())) {
    throw new Error(
      "Packaged license sidecar policy must contain one generated runtime " +
        "notice and two pinned Electron sidecars.",
    );
  }
}

function validateElectronIdentity(projectRoot, policy) {
  const expected = policy.electronPackage;
  if (
    !expected ||
    expected.name !== "electron" ||
    typeof expected.version !== "string"
  ) {
    throw new Error("Electron package identity policy is invalid.");
  }
  const lockfile = readJson(path.join(projectRoot, "package-lock.json"));
  const locked = lockfile.packages?.["node_modules/electron"];
  const manifest = readJson(
    path.join(projectRoot, "node_modules", "electron", "package.json"),
  );
  if (
    locked?.version !== expected.version ||
    manifest.name !== expected.name ||
    manifest.version !== expected.version
  ) {
    throw new Error(
      `Electron sidecar evidence is stale: expected ` +
        `${expected.name}@${expected.version}, lock/installed package is ` +
        `${manifest.name}@${manifest.version} / ${locked?.version ?? "missing"}.`,
    );
  }
}

export function loadPackagedLicenseSidecarExpectations(projectRoot) {
  const policy = readJson(
    path.join(
      projectRoot,
      "config",
      "packaged-license-sidecar-policy.json",
    ),
  );
  validatePolicy(policy);
  validateElectronIdentity(projectRoot, policy);

  const runtimeInputs = loadRuntimePackageNoticeInputs(projectRoot);
  const evidence = readJson(
    path.join(
      projectRoot,
      "config",
      "runtime-package-notice-evidence.json",
    ),
  );
  const generatedRuntimeNotice = assembleRuntimePackageNotices({
    ...runtimeInputs,
    evidence,
  });
  const runtimeArtifact = readRegularFile(
    projectRoot,
    "THIRD-PARTY-NOTICES.runtime.txt",
    "Generated runtime notice artifact",
  );
  verifyRuntimePackageNoticeArtifact(
    runtimeArtifact,
    generatedRuntimeNotice,
  );

  const files = policy.files
    .map((file) => {
      let expectedBytes;
      if (file.kind === "generated-runtime-notices") {
        if (file.sourcePath !== "THIRD-PARTY-NOTICES.runtime.txt") {
          throw new Error(
            "Generated runtime notice source path is not canonical.",
          );
        }
        expectedBytes = generatedRuntimeNotice.artifact;
      } else {
        expectedBytes = readRegularFile(
          projectRoot,
          file.sourcePath,
          `${file.id} pinned source`,
        );
        if (
          expectedBytes.length !== file.bytes ||
          sha256(expectedBytes) !== file.sha256
        ) {
          throw new Error(
            `${file.id} pinned source evidence is stale or tampered.`,
          );
        }
      }
      validateBounds(file, expectedBytes);
      return {
        id: file.id,
        targetPath: file.targetPath,
        minimumBytes: file.minimumBytes,
        maximumBytes: file.maximumBytes,
        bytes: expectedBytes.length,
        sha256: sha256(expectedBytes),
        expectedBytes,
      };
    })
    .sort((left, right) =>
      left.targetPath.localeCompare(right.targetPath, "en"),
    );

  return {
    packageRoot: resolveSidecarPath(
      projectRoot,
      policy.packageRoot,
      "Default package root",
    ),
    maximumTotalBytes: policy.maximumTotalBytes,
    files,
  };
}

export function auditPackagedLicenseSidecars({
  packageRoot,
  files,
  maximumTotalBytes,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No packaged license sidecar expectations were supplied.");
  }
  if (!Number.isSafeInteger(maximumTotalBytes) || maximumTotalBytes < 1) {
    throw new Error("Packaged license total-size bound is invalid.");
  }
  const targets = files.map((file) =>
    normalizeRelative(String(file.targetPath)),
  );
  if (new Set(targets).size !== targets.length) {
    throw new Error("Packaged license expectations contain duplicate targets.");
  }

  let totalBytes = 0;
  const verified = [];
  for (const file of [...files].sort((left, right) =>
    left.targetPath.localeCompare(right.targetPath, "en"),
  )) {
    if (!Buffer.isBuffer(file.expectedBytes)) {
      throw new Error(`${file.id} expected bytes are missing.`);
    }
    validateBounds(file, file.expectedBytes);
    if (
      file.expectedBytes.length !== file.bytes ||
      sha256(file.expectedBytes) !== file.sha256
    ) {
      throw new Error(`${file.id} expected evidence is stale or inconsistent.`);
    }
    const packagedBytes = readRegularFile(
      packageRoot,
      file.targetPath,
      `${file.id} packaged sidecar`,
    );
    validateBounds(file, packagedBytes);
    if (
      packagedBytes.length !== file.bytes ||
      sha256(packagedBytes) !== file.sha256 ||
      !packagedBytes.equals(file.expectedBytes)
    ) {
      throw new Error(
        `${file.id} packaged sidecar is stale, tampered, or the wrong version.`,
      );
    }
    totalBytes += packagedBytes.length;
    if (totalBytes > maximumTotalBytes) {
      throw new Error(
        `Packaged license sidecars exceed ${maximumTotalBytes} total bytes.`,
      );
    }
    verified.push({
      id: file.id,
      targetPath: normalizeRelative(file.targetPath),
      bytes: packagedBytes.length,
      sha256: file.sha256,
    });
  }
  return {
    ok: true,
    packageRoot: path.resolve(packageRoot),
    totalBytes,
    files: verified,
  };
}
