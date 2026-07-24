import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = resolve(scriptDirectory, "..");
const lockfile = readJson(join(projectRoot, "package-lock.json"));
const catalogPath = join(projectRoot, "config", "package-license-catalog.json");

const targets = new Map();
for (const [packagePath, lockMetadata] of Object.entries(lockfile.packages ?? {})) {
  if (packagePath === "") {
    continue;
  }
  const installedManifestPath = join(
    projectRoot,
    ...packagePath.split("/"),
    "package.json",
  );
  const installed = existsSync(installedManifestPath)
    ? readJson(installedManifestPath)
    : {};
  const license = installed.license ?? installed.licenses ?? lockMetadata.license;
  if (normalizeLicense(license) !== "UNKNOWN") {
    continue;
  }
  const name = installed.name ?? packageNameFromLockPath(packagePath);
  const version = String(lockMetadata.version ?? installed.version ?? "");
  if (!name || !version) {
    throw new Error(`Cannot resolve package identity for ${packagePath}.`);
  }
  targets.set(`${name}\0${version}`, { name, version });
}

const entries = [];
for (const target of [...targets.values()].sort(compareIdentity)) {
  const encodedName = encodeURIComponent(target.name);
  const registryMetadataUrl =
    `https://registry.npmjs.org/${encodedName}/${encodeURIComponent(target.version)}`;
  const response = await fetch(registryMetadataUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Registry metadata request failed for ${target.name}@${target.version}: ${response.status}`,
    );
  }
  const metadata = await response.json();
  if (metadata.name !== target.name || metadata.version !== target.version) {
    throw new Error(
      `Registry identity mismatch for ${target.name}@${target.version}.`,
    );
  }
  const license = normalizeLicense(metadata.license ?? metadata.licenses);
  if (license === "UNKNOWN") {
    throw new Error(
      `npm registry metadata has no license for ${target.name}@${target.version}.`,
    );
  }
  entries.push({
    name: target.name,
    version: target.version,
    license,
    evidence: {
      kind: "npm-registry-version-metadata",
      field: metadata.license !== undefined ? "license" : "licenses",
      value: metadata.license ?? metadata.licenses,
      url: registryMetadataUrl,
    },
    repository: normalizeRepository(metadata.repository),
    tarball: metadata.dist?.tarball ?? "UNKNOWN",
  });
}

const catalog = {
  schemaVersion: 1,
  purpose:
    "License evidence for exact package-lock entries whose platform/optional package manifests are absent from this installation.",
  entries,
};
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Wrote ${entries.length} exact-version entries to config/package-license-catalog.json`);

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean);
    return values.length > 0 ? values.join(" OR ") : "UNKNOWN";
  }
  if (value && typeof value === "object" && typeof value.type === "string") {
    return value.type;
  }
  return "UNKNOWN";
}

function normalizeRepository(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value.url === "string" && value.url.trim()) {
    return value.url.trim();
  }
  return "UNKNOWN";
}

function packageNameFromLockPath(packagePath) {
  const marker = "node_modules/";
  const tail = packagePath.slice(packagePath.lastIndexOf(marker) + marker.length);
  const parts = tail.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function compareIdentity(a, b) {
  return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
