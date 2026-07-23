import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(scriptDirectory, "..");
const packageJsonPath = join(projectRoot, "package.json");
const lockfilePath = join(projectRoot, "package-lock.json");
const publicDirectory = join(projectRoot, "public");
const reportPath = join(projectRoot, "work", "third-party-audit.md");
const noticesPath = join(projectRoot, "THIRD-PARTY-NOTICES.packages.md");
const catalogPath = join(projectRoot, "config", "package-license-catalog.json");
const policyPath = join(projectRoot, "config", "package-license-policy.json");

const packageJson = readJson(packageJsonPath);
const lockfile = readJson(lockfilePath);
const lockPackages = lockfile.packages;
const licenseCatalog = readJson(catalogPath);
const licensePolicy = readJson(policyPath);

if (!lockPackages || typeof lockPackages !== "object") {
  throw new Error("package-lock.json does not contain a packages object.");
}
if (licenseCatalog.schemaVersion !== 1 || !Array.isArray(licenseCatalog.entries)) {
  throw new Error("Package license catalog has an unsupported schema.");
}
if (
  licensePolicy.schemaVersion !== 1 ||
  !Array.isArray(licensePolicy.allowedDeclaredLicenses)
) {
  throw new Error("Package license policy has an unsupported schema.");
}

const catalogByIdentity = new Map();
for (const entry of licenseCatalog.entries) {
  validateCatalogEntry(entry);
  const identity = packageIdentity(entry.name, entry.version);
  if (catalogByIdentity.has(identity)) {
    throw new Error(`Duplicate package license catalog entry: ${identity}`);
  }
  catalogByIdentity.set(identity, entry);
}
const catalogIdentitiesUsed = new Set();
const allowedDeclaredLicenses = new Set(
  licensePolicy.allowedDeclaredLicenses.map(String),
);

const directRuntime = packageJson.dependencies ?? {};
const directDev = packageJson.devDependencies ?? {};
const dependencyRows = Object.entries(lockPackages)
  .filter(([packagePath]) => packagePath !== "")
  .map(([packagePath, lockMetadata]) =>
    packageInventoryRow(packagePath, lockMetadata),
  )
  .sort(comparePackageRows);

const directCoverage = [
  ...Object.entries(directRuntime).map(([name, requested]) => ({
    name,
    requested,
    scope: "runtime",
  })),
  ...Object.entries(directDev).map(([name, requested]) => ({
    name,
    requested,
    scope: "dev/build",
  })),
]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((dependency) => {
    const matches = dependencyRows.filter(
      (row) =>
        row.name === dependency.name &&
        row.packagePath === `node_modules/${dependency.name}`,
    );
    return {
      ...dependency,
      installed: matches.map((row) => row.version).join(", ") || "MISSING",
      covered: matches.length === 1,
    };
  });

const publicAssets = listFiles(publicDirectory)
  .map(assetInventoryRow)
  .sort((a, b) => a.path.localeCompare(b.path));
const fontReferences = scanFontLoadingReferences();

const missingDirect = directCoverage.filter((item) => !item.covered);
const unknownLicenseRows = dependencyRows.filter(
  (row) => row.license === "UNKNOWN",
);
const nonStandardLicenseRows = dependencyRows.filter(
  (row) =>
    row.license !== "UNKNOWN" &&
    /see license|custom|unlicensed|proprietary/i.test(row.license),
);
const unallowlistedLicenseRows = dependencyRows.filter(
  (row) => !allowedDeclaredLicenses.has(row.license),
);
const staleCatalogEntries = licenseCatalog.entries.filter(
  (entry) => !catalogIdentitiesUsed.has(packageIdentity(entry.name, entry.version)),
);

const report = renderReport({
  dependencyRows,
  directCoverage,
  publicAssets,
  fontReferences,
  missingDirect,
  unknownLicenseRows,
  nonStandardLicenseRows,
  unallowlistedLicenseRows,
  staleCatalogEntries,
});
const notices = renderPackageNotices(dependencyRows);

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report, "utf8");
writeFileSync(noticesPath, notices, "utf8");

if (
  missingDirect.length > 0 ||
  unknownLicenseRows.length > 0 ||
  nonStandardLicenseRows.length > 0 ||
  unallowlistedLicenseRows.length > 0 ||
  staleCatalogEntries.length > 0
) {
  throw new Error(
    `Package-license gate failed after generating ${relativePath(reportPath)}: ` +
      `${missingDirect.length} direct gaps, ${unknownLicenseRows.length} unknown, ` +
      `${nonStandardLicenseRows.length} nonstandard, ${unallowlistedLicenseRows.length} unallowlisted, ` +
      `${staleCatalogEntries.length} stale catalog entries.`,
  );
}

console.log(
  [
    `Generated ${relativePath(reportPath)}`,
    `Dependencies: ${dependencyRows.length} locked package entries`,
    `Direct dependency coverage: ${directCoverage.length}/${directCoverage.length}`,
    `Public asset coverage: ${publicAssets.length}/${publicAssets.length}`,
    `Font-loading references: ${fontReferences.length}`,
    `Unknown package licenses: ${unknownLicenseRows.length}`,
    `Unallowlisted package licenses: ${unallowlistedLicenseRows.length}`,
    `Catalog evidence entries used: ${catalogIdentitiesUsed.size}/${licenseCatalog.entries.length}`,
    `Generated ${relativePath(noticesPath)}`,
  ].join("\n"),
);

function packageInventoryRow(packagePath, lockMetadata) {
  const installedManifestPath = join(projectRoot, ...packagePath.split("/"), "package.json");
  const installedMetadata = existsSync(installedManifestPath)
    ? readJson(installedManifestPath)
    : {};
  const name =
    installedMetadata.name ??
    packageNameFromLockPath(packagePath);
  const isDirectRuntime =
    packagePath === `node_modules/${name}` &&
    Object.hasOwn(directRuntime, name);
  const isDirectDev =
    packagePath === `node_modules/${name}` &&
    Object.hasOwn(directDev, name);

  let scope;
  if (isDirectRuntime && isDirectDev) {
    scope = "runtime + dev/build (direct)";
  } else if (isDirectRuntime) {
    scope = "runtime (direct)";
  } else if (isDirectDev) {
    scope = "dev/build (direct)";
  } else if (lockMetadata.dev === true) {
    scope = "dev/build (transitive)";
  } else {
    scope = "runtime (transitive)";
  }

  const manifestLicense = normalizeLicense(
    installedMetadata.license ?? installedMetadata.licenses ?? lockMetadata.license,
  );
  const catalogEntry =
    manifestLicense === "UNKNOWN"
      ? catalogByIdentity.get(
          packageIdentity(
            name,
            String(lockMetadata.version ?? installedMetadata.version ?? "UNKNOWN"),
          ),
        )
      : undefined;
  if (catalogEntry) {
    catalogIdentitiesUsed.add(packageIdentity(catalogEntry.name, catalogEntry.version));
  }

  return {
    name,
    version: String(lockMetadata.version ?? installedMetadata.version ?? "UNKNOWN"),
    license: catalogEntry?.license ?? manifestLicense,
    repository: normalizeRepository(
      installedMetadata.repository ?? lockMetadata.repository,
    ),
    homepage: normalizeText(
      installedMetadata.homepage ?? lockMetadata.homepage,
    ),
    scope,
    packagePath,
    metadataSource: catalogEntry
      ? "npm registry catalog"
      : existsSync(installedManifestPath)
        ? "node_modules package.json"
        : "package-lock.json",
    licenseEvidence: catalogEntry
      ? `${catalogEntry.evidence.url}#${catalogEntry.evidence.field}`
      : existsSync(installedManifestPath)
        ? `${relativePath(installedManifestPath)}#license`
        : "package-lock.json#license",
  };
}

function assetInventoryRow(absolutePath) {
  const bytes = readFileSync(absolutePath);
  const extension = extname(absolutePath).toLowerCase();
  const pngInspection =
    extension === ".png" ? inspectPng(bytes) : undefined;
  return {
    path: relativePath(absolutePath),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    type: extension.slice(1).toUpperCase() || "NO EXTENSION",
    dimensions: pngInspection?.dimensions ?? "n/a",
    embeddedMetadata:
      pngInspection?.embeddedMetadata ??
      "not inspected for this file type",
    provenance: "UNKNOWN",
    redistribution: "UNKNOWN",
    blocker:
      "Release owner must document creator/source and redistribution permission.",
  };
}

function inspectPng(bytes) {
  const pngSignature = "89504e470d0a1a0a";
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== pngSignature
  ) {
    return {
      dimensions: "invalid PNG",
      embeddedMetadata: "invalid PNG",
    };
  }
  const chunkTypes = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + 12 + length > bytes.length) {
      break;
    }
    chunkTypes.push(type);
    offset += length + 12;
    if (type === "IEND") {
      break;
    }
  }
  const metadataChunks = chunkTypes.filter((type) =>
    ["tEXt", "zTXt", "iTXt", "eXIf", "caBX"].includes(type),
  );
  const embeddedMetadata =
    metadataChunks.length === 0
      ? "no standard text/EXIF or caBX chunks detected"
      : metadataChunks
          .map((type) =>
            type === "caBX"
              ? "caBX present (opaque; not decoded)"
              : `${type} present (not decoded)`,
          )
          .join(", ");
  return {
    dimensions: `${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`,
    embeddedMetadata,
  };
}

function scanFontLoadingReferences() {
  const candidates = [
    join(projectRoot, "index.html"),
    ...listFiles(join(projectRoot, "src")).filter((filePath) =>
      [".css", ".html", ".js", ".jsx", ".ts", ".tsx"].includes(
        extname(filePath).toLowerCase(),
      ),
    ),
  ];
  const referencePattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s;)]+))|<link\b[^>]*href=["']([^"']+)["'][^>]*>|@font-face\b|url\(\s*(?:"([^"]+?\.(?:woff2?|ttf|otf)(?:\?[^"]*)?)"|'([^']+?\.(?:woff2?|ttf|otf)(?:\?[^']*)?)'|([^"')\s]+?\.(?:woff2?|ttf|otf)(?:\?[^"')\s]*)?))/gi;
  const rows = [];

  for (const filePath of candidates.sort()) {
    const source = readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      referencePattern.lastIndex = 0;
      for (const match of lines[lineIndex].matchAll(referencePattern)) {
        const target =
          match.slice(1).find((capture) => capture !== undefined) ??
          "@font-face declaration";
        if (
          target === "@font-face declaration" ||
          /font|woff|ttf|otf/i.test(target)
        ) {
          rows.push({
            location: `${relativePath(filePath)}:${lineIndex + 1}`,
            target,
            delivery:
              /^https?:\/\//i.test(target) ? "remote at runtime/build" : "local",
            provenance: "UNKNOWN",
            redistribution:
              /^https?:\/\//i.test(target)
                ? "Not bundled by this repository; remote provider terms still require review"
                : "UNKNOWN",
          });
        }
      }
    }
  }

  return rows.sort(
    (a, b) =>
      a.location.localeCompare(b.location) ||
      a.target.localeCompare(b.target),
  );
}

function renderReport(context) {
  const {
    dependencyRows: packages,
    directCoverage: direct,
    publicAssets: assets,
    fontReferences: fonts,
    missingDirect: missing,
    unknownLicenseRows: unknown,
    nonStandardLicenseRows: nonStandard,
    unallowlistedLicenseRows: unallowlisted,
    staleCatalogEntries: staleCatalog,
  } = context;
  const runtimeCount = packages.filter((row) =>
    row.scope.startsWith("runtime"),
  ).length;
  const devCount = packages.length - runtimeCount;
  const lockfileVersion = lockfile.lockfileVersion ?? "UNKNOWN";
  const blockers = [
    ...assets.map(
      (asset) =>
        `\`${asset.path}\`: creator/source and redistribution permission are undocumented. Embedded metadata inspection: ${asset.embeddedMetadata}.`,
    ),
    ...fonts.map(
      (font) =>
        `\`${font.target}\` loaded from \`${font.location}\`: font provenance/license and remote-delivery terms have not been recorded; offline behavior also depends on the remote host.`,
    ),
    ...unknown.map(
      (row) =>
        `Package \`${row.name}@${row.version}\` at \`${row.packagePath}\` has no declared license in the inspected metadata.`,
    ),
    ...nonStandard.map(
      (row) =>
        `Package \`${row.name}@${row.version}\` declares \`${row.license}\`; inspect its distributed license file before release.`,
    ),
    ...unallowlisted.map(
      (row) =>
        `Package \`${row.name}@${row.version}\` declares \`${row.license}\`, which is not in the reviewed commercial-redistribution allowlist.`,
    ),
    ...staleCatalog.map(
      (entry) =>
        `License catalog entry \`${entry.name}@${entry.version}\` is stale: the current lockfile does not require this fallback evidence.`,
    ),
  ];

  return `# Third-Party Dependency and Asset Audit

This report is generated deterministically by \`node scripts/generate-third-party-audit.mjs\`.
It records declarations found in the repository and installed package metadata; it is not legal advice and does not infer permissions.

## Release triage

- **Status:** ${blockers.length === 0 ? "No metadata blockers detected" : `BLOCKED (${blockers.length} items require review)`}
- Lockfile version: ${lockfileVersion}
- Locked package entries covered: ${packages.length} (${runtimeCount} runtime, ${devCount} dev/build)
- Direct manifest entries covered: ${direct.length - missing.length}/${direct.length}
- Public files covered: ${assets.length}/${assets.length}
- Font-loading references covered: ${fonts.length}
- Package entries with unknown declared license: ${unknown.length}
- Package entries outside the reviewed license allowlist: ${unallowlisted.length}
- Exact-version npm registry catalog evidence used: ${catalogIdentitiesUsed.size}/${licenseCatalog.entries.length}

### Concrete blockers

${blockers.length > 0 ? blockers.map((item) => `- ${item}`).join("\n") : "- None detected from repository metadata."}

## Classification rules

- A top-level package in \`dependencies\` is **runtime (direct)** and one in \`devDependencies\` is **dev/build (direct)**.
- Other lock entries use package-lock's \`dev: true\` marker for **dev/build (transitive)**; entries without that marker are **runtime (transitive)**.
- This is npm install-scope classification, not a claim that a package executes in the shipped renderer. In particular, build tools listed under \`dependencies\` remain classified as runtime because that is how the manifest declares them.
- Package license/repository/homepage values come from the installed package's \`package.json\` when present, with package-lock metadata as fallback.
- Absent optional/platform package manifests use exact-version npm registry evidence recorded in \`config/package-license-catalog.json\`; missing, duplicate, identity-mismatched, or stale evidence fails the generator.
- Every declared license must exactly match \`config/package-license-policy.json\`. New, unknown, malformed, nonstandard, or unreviewed declarations fail closed.
- \`UNKNOWN\` means the inspected metadata did not establish the fact. It never means public domain or permission granted.
- An allowlisted SPDX declaration indicates commercial redistribution is permitted subject to the license terms. It is not a legal conclusion, and required copyright/license texts, attribution, modification notices, source availability, or other conditions must still be satisfied.

## Direct dependency coverage

| Package | Requested | Installed | Manifest scope | Covered |
|---|---:|---:|---|---|
${direct.map((row) => `| ${md(row.name)} | ${md(row.requested)} | ${md(row.installed)} | ${row.scope} | ${row.covered ? "yes" : "NO"} |`).join("\n")}

## Public asset inventory

| Path | Type | Dimensions | Bytes | SHA-256 | Embedded metadata signal | Provenance | Redistribution |
|---|---|---:|---:|---|---|---|---|
${assets.map((row) => `| ${md(row.path)} | ${row.type} | ${row.dimensions} | ${row.bytes} | \`${row.sha256}\` | ${md(row.embeddedMetadata)} | ${row.provenance} | ${row.redistribution} |`).join("\n")}

Every file currently under \`public/\` appears above. PNG chunk inspection does not decode or validate opaque metadata, and the presence or absence of a metadata chunk does not establish ownership or permission. No asset was downloaded, changed, or assigned a guessed origin.

## Font-loading references

| Location | Target | Delivery | Provenance | Redistribution review |
|---|---|---|---|---|
${fonts.length > 0 ? fonts.map((row) => `| ${md(row.location)} | ${md(row.target)} | ${row.delivery} | ${row.provenance} | ${md(row.redistribution)} |`).join("\n") : "| — | No font-loading references detected | — | — | — |"}

The Google Fonts request names **Barlow Condensed** and **Inter**, but this report deliberately does not infer a license from the family names. The remote CSS and font bytes are not checked into \`public/\`; their exact served files can vary by user agent and provider response.

## Complete locked package inventory

| Package | Version | Declared license | License evidence | Repository | Homepage | Scope | Lock path | Metadata source |
|---|---:|---|---|---|---|---|---|---|
${packages.map((row) => `| ${md(row.name)} | ${md(row.version)} | ${md(row.license)} | ${md(row.licenseEvidence)} | ${md(row.repository)} | ${md(row.homepage)} | ${row.scope} | ${md(row.packagePath)} | ${row.metadataSource} |`).join("\n")}

## Verification

- Direct \`dependencies\`: ${Object.keys(directRuntime).length}/${Object.keys(directRuntime).length} enumerated; unique top-level lock coverage ${direct.filter((row) => row.scope === "runtime" && row.covered).length}/${Object.keys(directRuntime).length}.
- Direct \`devDependencies\`: ${Object.keys(directDev).length}/${Object.keys(directDev).length} enumerated; unique top-level lock coverage ${direct.filter((row) => row.scope === "dev/build" && row.covered).length}/${Object.keys(directDev).length}.
- Public assets: ${assets.length}/${assets.length} recursively enumerated.
- A nonzero direct-coverage gap makes the generator exit unsuccessfully after writing the report.
`;
}

function renderPackageNotices(rows) {
  const identities = new Map();
  for (const row of rows) {
    const identity = packageIdentity(row.name, row.version);
    const existing = identities.get(identity);
    if (existing && existing.license !== row.license) {
      throw new Error(`Conflicting license declarations for ${identity}.`);
    }
    identities.set(identity, row);
  }
  const packages = [...identities.values()].sort(comparePackageRows);
  return `# Third-Party Package Notices

This deterministic package section was generated by \`node scripts/generate-third-party-audit.mjs\`.
It covers npm packages locked by this project; it deliberately does **not** establish rights for images, audio, fonts outside npm, or other assets.

The SPDX declarations below are an inventory, not the complete license notices and not legal advice.
Before distribution, retain and ship all copyright notices, license texts, attribution, source/modification notices, and other materials required by the applicable licenses.

| Package | Version | Declared license | Evidence |
|---|---:|---|---|
${packages.map((row) => `| ${md(row.name)} | ${md(row.version)} | ${md(row.license)} | ${md(row.licenseEvidence)} |`).join("\n")}

Locked paths: ${rows.length}. Unique package/version identities: ${packages.length}.
`;
}

function validateCatalogEntry(entry) {
  if (
    !entry ||
    typeof entry.name !== "string" ||
    typeof entry.version !== "string" ||
    typeof entry.license !== "string" ||
    entry.evidence?.kind !== "npm-registry-version-metadata" ||
    typeof entry.evidence.field !== "string" ||
    typeof entry.evidence.url !== "string"
  ) {
    throw new Error("Malformed package license catalog entry.");
  }
  const expectedUrl =
    `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`;
  if (entry.evidence.url !== expectedUrl) {
    throw new Error(
      `Catalog evidence URL does not match exact identity ${packageIdentity(entry.name, entry.version)}.`,
    );
  }
  if (normalizeLicense(entry.evidence.value) !== entry.license) {
    throw new Error(
      `Catalog evidence value does not match normalized license for ${packageIdentity(entry.name, entry.version)}.`,
    );
  }
}

function packageIdentity(name, version) {
  return `${name}@${version}`;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) =>
        typeof item === "string" ? item : item?.type,
      )
      .filter(Boolean);
    return values.length > 0 ? values.join(" OR ") : "UNKNOWN";
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type;
  }
  return "UNKNOWN";
}

function normalizeRepository(value) {
  if (typeof value === "string") {
    return value || "UNKNOWN";
  }
  if (value && typeof value === "object") {
    return normalizeText(value.url);
  }
  return "UNKNOWN";
}

function normalizeText(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "UNKNOWN";
}

function packageNameFromLockPath(packagePath) {
  const marker = "node_modules/";
  const lastMarker = packagePath.lastIndexOf(marker);
  const tail = packagePath.slice(lastMarker + marker.length);
  const parts = tail.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function comparePackageRows(a, b) {
  return (
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a.packagePath.localeCompare(b.packagePath)
  );
}

function listFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(absolutePath));
    } else if (entry.isFile()) {
      results.push(absolutePath);
    }
  }
  return results;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function relativePath(filePath) {
  return relative(projectRoot, filePath).split(sep).join("/");
}

function md(value) {
  return String(value)
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}
