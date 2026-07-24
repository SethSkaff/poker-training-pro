import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = join(projectRoot, "config", "asset-rights-ledger.json");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const failures = [];
const blockers = [];

const normalizePath = (value) => value.replaceAll("\\", "/");
const relativePath = (value) => normalizePath(relative(projectRoot, value));
const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

function fail(message) {
  failures.push(message);
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort((left, right) => relativePath(left).localeCompare(relativePath(right)));
}

function inspectPng(bytes) {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    return { dimensions: "invalid", metadataChunks: [] };
  }
  const metadataChunks = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) {
      fail("PNG chunk extends beyond end of file.");
      break;
    }
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (["tEXt", "zTXt", "iTXt", "eXIf", "caBX"].includes(type)) {
      metadataChunks.push({
        type,
        bytes: length,
        sha256: sha256(payload),
        text: payload.toString("latin1"),
      });
    }
    offset += length + 12;
    if (type === "IEND") break;
  }
  return {
    dimensions: `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,
    metadataChunks,
  };
}

function inspectIco(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    return "invalid";
  }
  const count = bytes.readUInt16LE(4);
  const dimensions = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > bytes.length) return "invalid";
    dimensions.push(`${bytes[offset] || 256}x${bytes[offset + 1] || 256}`);
  }
  return dimensions.join(",");
}

function assertSortedUnique(values, label) {
  const expected = [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(values) !== JSON.stringify(expected)) {
    fail(`${label} must be sorted and unique.`);
  }
}

if (ledger.schemaVersion !== 1) {
  fail(`Unsupported ledger schemaVersion ${JSON.stringify(ledger.schemaVersion)}.`);
}

const visualAssets = ledger.visualAssets ?? [];
const fontPackages = ledger.fontPackages ?? [];
const visualPaths = visualAssets.map((asset) => asset.path);
const fontFiles = fontPackages.flatMap((fontPackage) =>
  fontPackage.files.map((file) => ({ ...file, package: fontPackage })),
);
const fontPaths = fontFiles.map((file) => file.path);
const allDeclaredPaths = [...visualPaths, ...fontPaths];
assertSortedUnique(visualPaths, "visualAssets paths");
assertSortedUnique(
  fontPackages.map((entry) => entry.package),
  "fontPackages",
);
for (const fontPackage of fontPackages) {
  assertSortedUnique(
    fontPackage.files.map((file) => file.path),
    `${fontPackage.package} file paths`,
  );
}
if (new Set(allDeclaredPaths).size !== allDeclaredPaths.length) {
  fail("Ledger contains duplicate asset paths.");
}

const declaredVisualSet = new Set(visualPaths);
const inventoriedVisualPaths = ledger.inventoryRoots
  .flatMap((root) => listFiles(join(projectRoot, root)))
  .filter((path) =>
    ledger.runtimeAssetExtensions.includes(extname(path).toLowerCase()),
  )
  .map(relativePath)
  .sort((left, right) => left.localeCompare(right));
assertSortedUnique(inventoriedVisualPaths, "filesystem visual inventory");

for (const path of inventoriedVisualPaths) {
  if (!declaredVisualSet.has(path)) {
    fail(`Undeclared runtime/package asset: ${path}`);
  }
}
for (const path of visualPaths) {
  if (!inventoriedVisualPaths.includes(path)) {
    fail(`Declared visual asset is outside inventory or missing: ${path}`);
  }
}

for (const asset of visualAssets) {
  const absolutePath = join(projectRoot, asset.path);
  if (!existsSync(absolutePath)) {
    fail(`Missing declared visual asset: ${asset.path}`);
    continue;
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.length !== asset.bytes) {
    fail(`${asset.path}: byte length drift (${bytes.length} != ${asset.bytes}).`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== asset.sha256) {
    fail(`${asset.path}: SHA-256 drift (${actualHash} != ${asset.sha256}).`);
  }
  const extension = extname(asset.path).toLowerCase();
  if (extension === ".png") {
    const inspection = inspectPng(bytes);
    if (inspection.dimensions !== asset.dimensions) {
      fail(
        `${asset.path}: dimensions drift (${inspection.dimensions} != ${asset.dimensions}).`,
      );
    }
    const expectedChunks = asset.embeddedMetadata?.pngMetadataChunks ?? [];
    const actualChunks = inspection.metadataChunks.map(
      ({ type, bytes: length, sha256: hash }) => ({
        type,
        bytes: length,
        sha256: hash,
      }),
    );
    if (JSON.stringify(actualChunks) !== JSON.stringify(expectedChunks)) {
      fail(`${asset.path}: embedded PNG metadata chunk drift.`);
    }
    const signal = asset.embeddedMetadata?.c2paSignal;
    if (signal) {
      const caBx = inspection.metadataChunks.find((chunk) => chunk.type === "caBX");
      const softwareMarkers =
        signal.softwareAgent === "gpt-image 2.0"
          ? ["gpt-image", "c2.0"]
          : [signal.softwareAgent];
      for (const marker of [
        signal.claimGenerator,
        ...softwareMarkers,
        signal.digitalSourceType,
        signal.instanceId,
      ]) {
        if (!caBx?.text.includes(marker)) {
          fail(`${asset.path}: expected caBX/C2PA marker not found: ${marker}`);
        }
      }
    }
  } else if (extension === ".ico") {
    const dimensions = inspectIco(bytes);
    if (dimensions !== asset.dimensions) {
      fail(`${asset.path}: ICO dimensions drift (${dimensions} != ${asset.dimensions}).`);
    }
  }

  const reasons = [];
  if (
    asset.rightsStatus !==
    ledger.releaseRules.approvedRightsStatus
  ) {
    reasons.push(`rights=${asset.rightsStatus}`);
  }
  for (const evidenceType of [
    "sourceEvidence",
    "masterEvidence",
    "licenseEvidence",
  ]) {
    if (asset[evidenceType]?.releaseSufficient !== true) {
      reasons.push(`${evidenceType}=insufficient`);
    }
  }
  if (asset.derivedFrom) {
    const parent = visualAssets.find((candidate) => candidate.path === asset.derivedFrom);
    if (!parent) {
      fail(`${asset.path}: undeclared derivedFrom parent ${asset.derivedFrom}.`);
    } else if (
      ledger.releaseRules.blockDerivedAssetWhenParentIsBlocked &&
      parent.rightsStatus !== ledger.releaseRules.approvedRightsStatus
    ) {
      reasons.push(`parent=${parent.rightsStatus}`);
    }
  }
  if (reasons.length > 0) {
    blockers.push(`${asset.path}: ${reasons.join(", ")}`);
  }
}

const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  readFileSync(join(projectRoot, "package-lock.json"), "utf8"),
);

const importedFontPaths = new Set();
const mainSource = readFileSync(join(projectRoot, "src", "main.tsx"), "utf8");
for (const match of mainSource.matchAll(
  /import\s+["'](@fontsource\/[^"']+\.css)["'];?/g,
)) {
  const cssPath = join(projectRoot, "node_modules", ...match[1].split("/"));
  if (!existsSync(cssPath)) {
    fail(`Imported font CSS is missing: ${relativePath(cssPath)}`);
    continue;
  }
  const cssSource = readFileSync(cssPath, "utf8");
  for (const urlMatch of cssSource.matchAll(
    /url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf))["']?\s*\)/gi,
  )) {
    importedFontPaths.add(relativePath(resolve(dirname(cssPath), urlMatch[1])));
  }
}
const importedFonts = [...importedFontPaths].sort((left, right) =>
  left.localeCompare(right),
);
assertSortedUnique(importedFonts, "imported font paths");
for (const path of importedFonts) {
  if (!fontPaths.includes(path)) fail(`Undeclared imported font binary: ${path}`);
}
for (const path of fontPaths) {
  if (!importedFonts.includes(path)) fail(`Declared font is not imported: ${path}`);
}

for (const fontPackage of fontPackages) {
  const packagePath = `node_modules/${fontPackage.package}`;
  const locked = packageLock.packages?.[packagePath];
  const installedManifestPath = join(projectRoot, packagePath, "package.json");
  if (!locked) {
    fail(`${fontPackage.package}: missing package-lock entry.`);
  } else {
    if (locked.version !== fontPackage.version) {
      fail(`${fontPackage.package}: locked version drift.`);
    }
    if (locked.integrity !== fontPackage.packageIntegrity) {
      fail(`${fontPackage.package}: package integrity drift.`);
    }
  }
  if (packageJson.dependencies?.[fontPackage.package] !== fontPackage.version) {
    fail(`${fontPackage.package}: direct dependency must be exact version ${fontPackage.version}.`);
  }
  if (!existsSync(installedManifestPath)) {
    fail(`${fontPackage.package}: installed package manifest is missing.`);
  } else {
    const installed = JSON.parse(readFileSync(installedManifestPath, "utf8"));
    if (
      installed.version !== fontPackage.version ||
      installed.license !== fontPackage.license
    ) {
      fail(`${fontPackage.package}: installed version/license metadata drift.`);
    }
  }
  for (const evidenceType of [
    "sourceEvidence",
    "masterEvidence",
    "licenseEvidence",
  ]) {
    if (fontPackage[evidenceType]?.releaseSufficient !== true) {
      blockers.push(`${fontPackage.package}: ${evidenceType}=insufficient`);
    }
  }
  const licensePath = join(projectRoot, fontPackage.licenseEvidence.path);
  if (!existsSync(licensePath)) {
    fail(`${fontPackage.package}: installed license evidence is missing.`);
  } else {
    const bytes = readFileSync(licensePath);
    if (
      bytes.length !== fontPackage.licenseEvidence.bytes ||
      sha256(bytes) !== fontPackage.licenseEvidence.sha256
    ) {
      fail(`${fontPackage.package}: installed license evidence hash/size drift.`);
    }
  }
  for (const file of fontPackage.files) {
    const absolutePath = join(projectRoot, file.path);
    if (!existsSync(absolutePath)) {
      fail(`Missing declared font binary: ${file.path}`);
      continue;
    }
    const bytes = readFileSync(absolutePath);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      fail(`${file.path}: font byte/hash drift.`);
    }
  }
  const distributed = fontPackage.distributedLicenseEvidence;
  if (distributed.required) {
    const distributedPath = join(projectRoot, distributed.path);
    if (!existsSync(distributedPath)) {
      if (distributed.status !== "missing") {
        fail(`${fontPackage.package}: distributed license status must be missing.`);
      }
      blockers.push(
        `${fontPackage.package}: required distributable license text is missing at ${distributed.path}`,
      );
    } else {
      if (distributed.status !== "present-verified") {
        fail(`${fontPackage.package}: distributed license status must be present-verified.`);
      }
      if (sha256(readFileSync(distributedPath)) !== distributed.expectedSha256) {
        fail(`${fontPackage.package}: distributed license text hash drift.`);
      }
    }
  }
}

const declaredHashes = new Set([
  ...visualAssets.map((asset) => asset.sha256),
  ...fontFiles.map((file) => file.sha256),
]);
const distPath = join(projectRoot, "dist");
let distAssetCount = 0;
if (existsSync(distPath)) {
  for (const path of listFiles(distPath).filter((candidate) =>
    ledger.runtimeAssetExtensions.includes(extname(candidate).toLowerCase()),
  )) {
    distAssetCount += 1;
    const hash = sha256(readFileSync(path));
    if (!declaredHashes.has(hash)) {
      fail(`Built output contains undeclared image/icon/font bytes: ${relativePath(path)}`);
    }
  }
}

const rightsApprovedAssets =
  fontFiles.length +
  visualAssets.filter(
    (asset) => asset.rightsStatus === ledger.releaseRules.approvedRightsStatus,
  ).length;
const fontPackagesWithNotice = new Set(
  fontPackages
    .filter((entry) => {
      const evidence = entry.distributedLicenseEvidence;
      return (
        !evidence.required ||
        (existsSync(join(projectRoot, evidence.path)) &&
          sha256(readFileSync(join(projectRoot, evidence.path))) ===
            evidence.expectedSha256)
      );
    })
    .map((entry) => entry.package),
);
const releaseEligibleAssets =
  visualAssets.filter(
    (asset) =>
      asset.rightsStatus === ledger.releaseRules.approvedRightsStatus &&
      asset.sourceEvidence?.releaseSufficient === true &&
      asset.masterEvidence?.releaseSufficient === true &&
      asset.licenseEvidence?.releaseSufficient === true,
  ).length +
  fontFiles.filter((file) => fontPackagesWithNotice.has(file.package.package)).length;

const summary = {
  declaredAssets: visualAssets.length + fontFiles.length,
  declaredVisualAndIconAssets: visualAssets.length,
  declaredFontBinaries: fontFiles.length,
  inventoriedVisualAssets: inventoriedVisualPaths.length,
  importedFontBinaries: importedFonts.length,
  inspectedDistAssets: distAssetCount,
  rightsApprovedAssets,
  releaseEligibleAssets,
  mechanicalFailures: failures.length,
  releaseBlockers: blockers.length,
  releaseEligible: failures.length === 0 && blockers.length === 0,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  console.error("\nMechanical validation failures:");
  failures.sort().forEach((failure) => console.error(`- ${failure}`));
}
if (blockers.length > 0) {
  console.error("\nRelease-rights blockers:");
  blockers.sort().forEach((blocker) => console.error(`- ${blocker}`));
}
if (failures.length > 0 || blockers.length > 0) {
  process.exitCode = 1;
} else {
  console.log("\nAsset rights gate passed.");
}
