import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureParentDirectory,
  projectRoot,
  readJson,
} from "./shared.mjs";

const packageJson = readJson(join(projectRoot, "package.json"));
const lockfile = readJson(join(projectRoot, "package-lock.json"));
const lockPackages = lockfile.packages ?? {};

const components = Object.entries(lockPackages)
  .filter(([packagePath]) => packagePath !== "")
  .map(([packagePath, metadata]) => {
    const name = packageNameFromPath(packagePath);
    const version = String(metadata.version ?? "UNKNOWN");
    const component = {
      type: "library",
      "bom-ref": `${name}@${version}:${packagePath}`,
      name: unscopedName(name),
      version,
      scope:
        metadata.dev === true
          ? "excluded"
          : metadata.optional === true
            ? "optional"
            : "required",
      purl: npmPurl(name, version),
      properties: [
        {
          name: "poker-training-pro:lockfile-path",
          value: packagePath,
        },
      ],
    };
    const group = packageGroup(name);
    if (group) component.group = group;
    if (typeof metadata.integrity === "string") {
      const hashes = integrityHashes(metadata.integrity);
      if (hashes.length > 0) component.hashes = hashes;
    }
    if (typeof metadata.license === "string") {
      component.licenses = [{ license: { id: metadata.license } }];
    }
    return component;
  })
  .sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": `${packageJson.name}@${packageJson.version}`,
      name: packageJson.name,
      version: packageJson.version,
    },
    properties: [
      {
        name: "poker-training-pro:source",
        value: "package-lock.json",
      },
      {
        name: "poker-training-pro:lockfile-version",
        value: String(lockfile.lockfileVersion),
      },
    ],
  },
  components,
};

const outputPath = join(
  projectRoot,
  "work",
  `${packageJson.name}-${packageJson.version}.cdx.json`,
);
ensureParentDirectory(outputPath);
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");

const verification = readJson(outputPath);
if (
  verification.bomFormat !== "CycloneDX" ||
  verification.specVersion !== "1.5" ||
  verification.components.length !==
    Math.max(0, Object.keys(lockPackages).length - 1)
) {
  throw new Error("Generated CycloneDX SBOM failed readback verification.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      path: `work/${packageJson.name}-${packageJson.version}.cdx.json`,
      format: `${sbom.bomFormat} ${sbom.specVersion}`,
      components: components.length,
    },
    null,
    2,
  ),
);

function packageNameFromPath(packagePath) {
  const parts = packagePath.split("/node_modules/").at(-1).split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function packageGroup(name) {
  return name.startsWith("@") ? name.split("/")[0] : "";
}

function unscopedName(name) {
  return name.startsWith("@") ? name.split("/")[1] : name;
}

function npmPurl(name, version) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function integrityHashes(integrity) {
  return integrity
    .split(/\s+/)
    .map((token) => token.match(/^(sha256|sha384|sha512)-(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      alg: match[1].toUpperCase().replace("SHA", "SHA-"),
      content: Buffer.from(match[2], "base64").toString("hex").toUpperCase(),
    }));
}
