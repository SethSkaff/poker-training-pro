import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const NOTICE_FORMAT_VERSION = "runtime-package-notices-v1";
export const DEFAULT_NOTICE_LIMITS = Object.freeze({
  maximumPackages: 256,
  maximumTextsPerPackage: 32,
  minimumTextBytes: 40,
  maximumTextBytes: 24 * 1024 * 1024,
  maximumTotalSourceBytes: 32 * 1024 * 1024,
  maximumArtifactBytes: 40 * 1024 * 1024,
});

const NOTICE_FILE =
  /^(?:license|licence|notice|copying|copyright)(?:[._-].*)?$/i;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRelative(file) {
  return file.replaceAll("\\", "/");
}

function packageNameFromPath(packagePath) {
  const tail = packagePath.split("node_modules/").at(-1);
  const pieces = tail.split("/");
  return pieces[0].startsWith("@")
    ? `${pieces[0]}/${pieces[1]}`
    : pieces[0];
}

function packageIdentity(name, version) {
  return `${name}@${version}`;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item.type === "string"
            ? item.type
            : "",
      )
      .filter(Boolean);
    return values.length ? values.join(" OR ") : "UNKNOWN";
  }
  return "UNKNOWN";
}

function resolveInside(root, relativePath, label) {
  const normalized = normalizeRelative(relativePath);
  if (path.isAbsolute(relativePath) || normalized.split("/").includes("..")) {
    throw new Error(`${label} escapes the project root: ${relativePath}`);
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  const resolvedRoot = path.resolve(root);
  if (
    absolute !== resolvedRoot &&
    !absolute.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${label} escapes the project root: ${relativePath}`);
  }
  return absolute;
}

function catalogMap(catalog) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
    throw new Error("Package license catalog has an unsupported schema.");
  }
  const result = new Map();
  for (const entry of catalog.entries) {
    const identity = packageIdentity(String(entry.name), String(entry.version));
    if (result.has(identity)) {
      throw new Error(`Duplicate package catalog identity: ${identity}`);
    }
    result.set(identity, entry);
  }
  return result;
}

export function selectShippedLockedPackages({
  lockfile,
  policy,
}) {
  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("package-lock.json does not contain packages.");
  }
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.additionalShippedPackages)
  ) {
    throw new Error("Runtime package notice policy has an unsupported schema.");
  }
  const additional = new Set(
    policy.additionalShippedPackages.map((entry) => String(entry.name)),
  );
  const selectedPaths = new Map();
  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    if (!packagePath) continue;
    const name = packageNameFromPath(packagePath);
    const isTopLevelAdditional =
      packagePath === `node_modules/${name}` && additional.has(name);
    if (metadata.dev === true && !isTopLevelAdditional) continue;
    const version = String(metadata.version ?? "UNKNOWN");
    const identity = packageIdentity(name, version);
    const row = selectedPaths.get(identity) ?? {
      name,
      version,
      packagePaths: [],
    };
    row.packagePaths.push(packagePath);
    selectedPaths.set(identity, row);
  }
  for (const name of additional) {
    if (
      ![...selectedPaths.values()].some(
        (entry) =>
          entry.name === name &&
          entry.packagePaths.includes(`node_modules/${name}`),
      )
    ) {
      throw new Error(
        `Additional shipped package ${name} is absent from the top-level lock path.`,
      );
    }
  }
  return [...selectedPaths.values()]
    .map((entry) => ({
      ...entry,
      packagePaths: entry.packagePaths.sort(compareText),
    }))
    .sort(
      (left, right) =>
        compareText(left.name, right.name) ||
        compareText(left.version, right.version),
    );
}

function discoverTextFiles(projectRoot, packagePath) {
  const packageDirectory = resolveInside(
    projectRoot,
    packagePath,
    "Package path",
  );
  if (!existsSync(packageDirectory) || !statSync(packageDirectory).isDirectory()) {
    throw new Error(`Installed package directory is missing: ${packagePath}`);
  }
  return readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && NOTICE_FILE.test(entry.name))
    .map((entry) => normalizeRelative(`${packagePath}/${entry.name}`))
    .sort(compareText);
}

export function createRuntimePackageNoticeEvidence({
  projectRoot,
  lockfile,
  policy,
  catalog,
}) {
  const catalogByIdentity = catalogMap(catalog);
  const selected = selectShippedLockedPackages({ lockfile, policy });
  return {
    schemaVersion: 1,
    formatVersion: NOTICE_FORMAT_VERSION,
    lockfileVersion: lockfile.lockfileVersion,
    entries: selected.map((locked) => {
      const catalogEntry = catalogByIdentity.get(
        packageIdentity(locked.name, locked.version),
      );
      const manifests = locked.packagePaths.map((packagePath) => {
        const manifestRelative = normalizeRelative(
          `${packagePath}/package.json`,
        );
        const manifestAbsolute = resolveInside(
          projectRoot,
          manifestRelative,
          "Manifest path",
        );
        if (!existsSync(manifestAbsolute)) {
          throw new Error(`Installed manifest is missing: ${manifestRelative}`);
        }
        const manifestBytes = readFileSync(manifestAbsolute);
        const manifest = JSON.parse(manifestBytes.toString("utf8"));
        if (
          manifest.name !== locked.name ||
          manifest.version !== locked.version
        ) {
          throw new Error(
            `Installed identity mismatch at ${manifestRelative}: expected ` +
              `${locked.name}@${locked.version}, found ${manifest.name}@${manifest.version}.`,
          );
        }
        const manifestLicense = normalizeLicense(
          manifest.license ?? manifest.licenses,
        );
        const declaredLicense =
          manifestLicense === "UNKNOWN"
            ? normalizeLicense(catalogEntry?.license)
            : manifestLicense;
        if (declaredLicense === "UNKNOWN") {
          throw new Error(
            `No exact license declaration for ${locked.name}@${locked.version} ` +
              `at ${manifestRelative}.`,
          );
        }
        return {
          path: manifestRelative,
          bytes: manifestBytes.length,
          sha256: sha256(manifestBytes),
          declaredLicense,
          declarationEvidence:
            manifestLicense === "UNKNOWN"
              ? `config/package-license-catalog.json#${locked.name}@${locked.version}`
              : `${manifestRelative}#license`,
        };
      });
      const declaredLicenses = [
        ...new Set(manifests.map((manifest) => manifest.declaredLicense)),
      ];
      if (declaredLicenses.length !== 1) {
        throw new Error(
          `Installed license declarations disagree for ` +
            `${locked.name}@${locked.version}: ${declaredLicenses.join(", ")}.`,
        );
      }
      const textPaths = locked.packagePaths.flatMap((packagePath) =>
        discoverTextFiles(projectRoot, packagePath),
      );
      if (textPaths.length === 0) {
        throw new Error(
          `No upstream license/NOTICE text found for ${locked.name}@${locked.version}.`,
        );
      }
      return {
        name: locked.name,
        version: locked.version,
        declaredLicense: declaredLicenses[0],
        declarationEvidence: manifests.map(
          (manifest) => manifest.declarationEvidence,
        ),
        packagePaths: locked.packagePaths,
        manifests: manifests.map(
          ({ path: manifestPath, bytes, sha256: manifestSha256 }) => ({
            path: manifestPath,
            bytes,
            sha256: manifestSha256,
          }),
        ),
        texts: textPaths.sort(compareText).map((relativePath) => {
          const bytes = readFileSync(
            resolveInside(projectRoot, relativePath, "Notice text path"),
          );
          return {
            kind: /notice/i.test(path.basename(relativePath))
              ? "notice"
              : "license",
            path: relativePath,
            bytes: bytes.length,
            sha256: sha256(bytes),
          };
        }),
      };
    }),
  };
}

function assertExactArray(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`,
    );
  }
}

function decodeText(bytes, identity, sourcePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+$/u, "");
  } catch {
    throw new Error(
      `Upstream text is not valid UTF-8 for ${identity}: ${sourcePath}`,
    );
  }
}

export function assembleRuntimePackageNotices({
  projectRoot,
  lockfile,
  policy,
  catalog,
  evidence,
  limits = DEFAULT_NOTICE_LIMITS,
}) {
  if (
    evidence.schemaVersion !== 1 ||
    evidence.formatVersion !== NOTICE_FORMAT_VERSION ||
    !Array.isArray(evidence.entries)
  ) {
    throw new Error("Runtime package notice evidence has an unsupported schema.");
  }
  if (evidence.lockfileVersion !== lockfile.lockfileVersion) {
    throw new Error(
      `Notice evidence lockfile version is stale: expected ${lockfile.lockfileVersion}, found ${evidence.lockfileVersion}.`,
    );
  }
  const selected = selectShippedLockedPackages({ lockfile, policy });
  if (selected.length > limits.maximumPackages) {
    throw new Error(
      `Shipped package count ${selected.length} exceeds ${limits.maximumPackages}.`,
    );
  }
  const expectedIdentities = selected.map((entry) =>
    packageIdentity(entry.name, entry.version),
  );
  const evidenceIdentities = evidence.entries
    .map((entry) => packageIdentity(entry.name, entry.version))
    .sort(compareText);
  if (new Set(evidenceIdentities).size !== evidenceIdentities.length) {
    throw new Error("Runtime package notice evidence contains duplicate identities.");
  }
  assertExactArray(
    evidenceIdentities,
    [...expectedIdentities].sort(compareText),
    "Runtime package evidence identities",
  );

  const catalogByIdentity = catalogMap(catalog);
  let totalSourceBytes = 0;
  const sections = [];
  for (const locked of selected) {
    const identity = packageIdentity(locked.name, locked.version);
    const entry = evidence.entries.find(
      (candidate) =>
        candidate.name === locked.name && candidate.version === locked.version,
    );
    if (!entry) throw new Error(`Missing notice evidence for ${identity}.`);
    assertExactArray(
      [...entry.packagePaths].sort(compareText),
      locked.packagePaths,
      `Lock paths for ${identity}`,
    );
    if (!Array.isArray(entry.manifests)) {
      throw new Error(`Manifest evidence is missing for ${identity}.`);
    }
    const expectedManifestPaths = locked.packagePaths.map((packagePath) =>
      normalizeRelative(`${packagePath}/package.json`),
    );
    assertExactArray(
      entry.manifests
        .map((manifestEvidence) =>
          normalizeRelative(manifestEvidence.path),
        )
        .sort(compareText),
      expectedManifestPaths,
      `Manifest evidence paths for ${identity}`,
    );
    for (const manifestEvidence of [...entry.manifests].sort((left, right) =>
      compareText(left.path, right.path),
    )) {
      const manifestAbsolute = resolveInside(
        projectRoot,
        manifestEvidence.path,
        `Manifest for ${identity}`,
      );
      if (!existsSync(manifestAbsolute)) {
        throw new Error(
          `Manifest evidence is missing for ${identity}: ${manifestEvidence.path}.`,
        );
      }
      const manifestBytes = readFileSync(manifestAbsolute);
      if (
        manifestBytes.length !== manifestEvidence.bytes ||
        sha256(manifestBytes) !== manifestEvidence.sha256
      ) {
        throw new Error(
          `Manifest evidence is stale for ${identity}: ${manifestEvidence.path}.`,
        );
      }
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      if (manifest.name !== entry.name || manifest.version !== entry.version) {
        throw new Error(
          `Manifest identity is stale for ${identity}: ${manifestEvidence.path}.`,
        );
      }
      const manifestLicense = normalizeLicense(
        manifest.license ?? manifest.licenses,
      );
      const exactCatalogLicense = normalizeLicense(
        catalogByIdentity.get(identity)?.license,
      );
      const actualLicense =
        manifestLicense === "UNKNOWN" ? exactCatalogLicense : manifestLicense;
      if (actualLicense !== entry.declaredLicense) {
        throw new Error(
          `Declared license evidence is stale for ${identity} at ` +
            `${manifestEvidence.path}: expected ${actualLicense}, found ` +
            `${entry.declaredLicense}.`,
        );
      }
    }

    const discovered = locked.packagePaths
      .flatMap((packagePath) => discoverTextFiles(projectRoot, packagePath))
      .sort(compareText);
    const evidencedPaths = entry.texts
      .map((text) => normalizeRelative(text.path))
      .sort(compareText);
    assertExactArray(
      evidencedPaths,
      discovered,
      `License/NOTICE file set for ${identity}`,
    );
    if (
      entry.texts.length < 1 ||
      entry.texts.length > limits.maximumTextsPerPackage
    ) {
      throw new Error(
        `Text count for ${identity} is outside 1..${limits.maximumTextsPerPackage}.`,
      );
    }
    const renderedTexts = [];
    for (const textEvidence of [...entry.texts].sort((left, right) =>
      compareText(left.path, right.path),
    )) {
      const absolute = resolveInside(
        projectRoot,
        textEvidence.path,
        `Text evidence for ${identity}`,
      );
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        throw new Error(
          `Required upstream text is missing for ${identity}: ${textEvidence.path}`,
        );
      }
      const bytes = readFileSync(absolute);
      if (
        bytes.length < limits.minimumTextBytes ||
        bytes.length > limits.maximumTextBytes
      ) {
        throw new Error(
          `Upstream text size for ${identity} is outside ` +
            `${limits.minimumTextBytes}..${limits.maximumTextBytes}: ${textEvidence.path}`,
        );
      }
      if (
        bytes.length !== textEvidence.bytes ||
        sha256(bytes) !== textEvidence.sha256
      ) {
        throw new Error(
          `Upstream text evidence is stale for ${identity}: ${textEvidence.path}`,
        );
      }
      totalSourceBytes += bytes.length;
      if (totalSourceBytes > limits.maximumTotalSourceBytes) {
        throw new Error(
          `Total upstream text exceeds ${limits.maximumTotalSourceBytes} bytes.`,
        );
      }
      renderedTexts.push(
        [
          `SOURCE: ${textEvidence.path}`,
          `SOURCE SHA-256: ${textEvidence.sha256}`,
          "-".repeat(76),
          decodeText(bytes, identity, textEvidence.path),
        ].join("\n"),
      );
    }
    sections.push(
      [
        "=".repeat(76),
        `PACKAGE: ${identity}`,
        `DECLARED LICENSE: ${entry.declaredLicense}`,
        `LOCK PATHS: ${locked.packagePaths.join(", ")}`,
        `DECLARATION EVIDENCE: ${entry.declarationEvidence.join(", ")}`,
        ...renderedTexts,
      ].join("\n"),
    );
  }
  const artifact = Buffer.from(
    [
      "POKER TRAINING PRO — THIRD-PARTY RUNTIME PACKAGE NOTICES",
      `FORMAT: ${NOTICE_FORMAT_VERSION}`,
      `PACKAGE COUNT: ${selected.length}`,
      "",
      "This file contains upstream copyright/license/NOTICE texts for exact npm",
      "package versions selected by config/runtime-package-notice-policy.json.",
      "Line endings are normalized to LF; source byte hashes refer to raw files.",
      "Images, non-npm assets, and unapproved audio require separate evidence.",
      "",
      ...sections,
      "",
    ].join("\n"),
    "utf8",
  );
  if (artifact.length > limits.maximumArtifactBytes) {
    throw new Error(
      `Notice artifact ${artifact.length} exceeds ${limits.maximumArtifactBytes} bytes.`,
    );
  }
  return {
    artifact,
    packageCount: selected.length,
    sourceTextCount: evidence.entries.reduce(
      (sum, entry) => sum + entry.texts.length,
      0,
    ),
    sourceBytes: totalSourceBytes,
    artifactBytes: artifact.length,
    sha256: sha256(artifact),
  };
}

export function verifyRuntimePackageNoticeArtifact(actual, expected) {
  const bytes = Buffer.isBuffer(actual) ? actual : Buffer.from(actual);
  if (!bytes.equals(expected.artifact)) {
    throw new Error(
      "Runtime package notice artifact is missing, stale, reordered, or modified.",
    );
  }
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

export function loadRuntimePackageNoticeInputs(projectRoot) {
  return {
    projectRoot,
    lockfile: readJson(path.join(projectRoot, "package-lock.json")),
    policy: readJson(
      path.join(projectRoot, "config", "runtime-package-notice-policy.json"),
    ),
    catalog: readJson(
      path.join(projectRoot, "config", "package-license-catalog.json"),
    ),
  };
}
