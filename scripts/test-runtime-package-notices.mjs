import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_NOTICE_LIMITS,
  assembleRuntimePackageNotices,
  createRuntimePackageNoticeEvidence,
  verifyRuntimePackageNoticeArtifact,
} from "./lib/runtime-package-notices.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workRoot = path.join(projectRoot, "work");
mkdirSync(workRoot, { recursive: true });
const fixtureRoot = mkdtempSync(
  path.join(workRoot, "runtime-package-notice-test-"),
);

const licenseText = [
  "MIT License",
  "",
  "Copyright (c) Fixture Authors",
  "",
  "Permission is hereby granted to use, copy, modify, and distribute this fixture.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
  "",
].join("\n");
const policy = { schemaVersion: 1, additionalShippedPackages: [] };
const catalog = { schemaVersion: 1, entries: [] };
const lockfile = {
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture", version: "1.0.0" },
    "node_modules/zeta": { version: "2.0.0" },
    "node_modules/alpha": { version: "1.0.0" },
    "node_modules/host/node_modules/alpha": { version: "1.0.0" },
    "node_modules/dev-only": { version: "9.0.0", dev: true },
  },
};

function writePackageAt(packagePath, name, version, text = licenseText) {
  const directory = path.join(fixtureRoot, ...packagePath.split("/"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name, version, license: "MIT" })}\n`,
  );
  writeFileSync(path.join(directory, "LICENSE"), text);
}

function expectThrow(run, pattern, label) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) {
      throw new Error(`${label}: unexpected error: ${message}`);
    }
    return;
  }
  throw new Error(`${label}: expected an error.`);
}

try {
  writePackageAt("node_modules/alpha", "alpha", "1.0.0");
  writePackageAt(
    "node_modules/host/node_modules/alpha",
    "alpha",
    "1.0.0",
    `${licenseText}Nested installation notice must remain visible.\n`,
  );
  writePackageAt("node_modules/zeta", "zeta", "2.0.0");
  const evidence = createRuntimePackageNoticeEvidence({
    projectRoot: fixtureRoot,
    lockfile,
    policy,
    catalog,
  });
  const first = assembleRuntimePackageNotices({
    projectRoot: fixtureRoot,
    lockfile,
    policy,
    catalog,
    evidence,
  });
  const reorderedEvidence = {
    ...evidence,
    entries: [...evidence.entries].reverse(),
  };
  const replay = assembleRuntimePackageNotices({
    projectRoot: fixtureRoot,
    lockfile: {
      ...lockfile,
      packages: Object.fromEntries(
        Object.entries(lockfile.packages).reverse(),
      ),
    },
    policy,
    catalog,
    evidence: reorderedEvidence,
  });
  if (!first.artifact.equals(replay.artifact)) {
    throw new Error("Deterministic-order test produced different bytes.");
  }
  const artifactText = first.artifact.toString("utf8");
  if (
    !artifactText.includes("PACKAGE: alpha@1.0.0") ||
    !artifactText.includes("PACKAGE: zeta@2.0.0") ||
    artifactText.split("Copyright (c) Fixture Authors").length - 1 !== 3 ||
    !artifactText.includes("Nested installation notice must remain visible.")
  ) {
    throw new Error(
      "Distinct package paths/sections did not preserve all upstream texts.",
    );
  }
  verifyRuntimePackageNoticeArtifact(first.artifact, first);
  expectThrow(
    () =>
      verifyRuntimePackageNoticeArtifact(
        Buffer.concat([first.artifact, Buffer.from("tamper")]),
        first,
      ),
    /missing, stale, reordered, or modified/,
    "tampered artifact",
  );

  const wrongVersion = structuredClone(evidence);
  wrongVersion.entries[0].version = "999.0.0";
  expectThrow(
    () =>
      assembleRuntimePackageNotices({
        projectRoot: fixtureRoot,
        lockfile,
        policy,
        catalog,
        evidence: wrongVersion,
      }),
    /evidence identities mismatch/,
    "wrong-version evidence",
  );

  writeFileSync(
    path.join(fixtureRoot, "node_modules", "alpha", "LICENSE"),
    `${licenseText}changed\n`,
  );
  expectThrow(
    () =>
      assembleRuntimePackageNotices({
        projectRoot: fixtureRoot,
        lockfile,
        policy,
        catalog,
        evidence,
      }),
    /text evidence is stale/,
    "stale text evidence",
  );
  writeFileSync(
    path.join(fixtureRoot, "node_modules", "alpha", "LICENSE"),
    licenseText,
  );

  unlinkSync(path.join(fixtureRoot, "node_modules", "zeta", "LICENSE"));
  expectThrow(
    () =>
      assembleRuntimePackageNotices({
        projectRoot: fixtureRoot,
        lockfile,
        policy,
        catalog,
        evidence,
      }),
    /file set.*mismatch/,
    "missing upstream text",
  );
  writeFileSync(
    path.join(fixtureRoot, "node_modules", "zeta", "LICENSE"),
    licenseText,
  );

  expectThrow(
    () =>
      assembleRuntimePackageNotices({
        projectRoot: fixtureRoot,
        lockfile,
        policy,
        catalog,
        evidence,
        limits: {
          ...DEFAULT_NOTICE_LIMITS,
          maximumTextBytes: 64,
        },
      }),
    /text size.*outside/,
    "oversized individual text",
  );
  expectThrow(
    () =>
      assembleRuntimePackageNotices({
        projectRoot: fixtureRoot,
        lockfile,
        policy,
        catalog,
        evidence,
        limits: {
          ...DEFAULT_NOTICE_LIMITS,
          maximumArtifactBytes: 256,
        },
      }),
    /artifact.*exceeds/i,
    "oversized artifact",
  );

  console.log(
    "Runtime package notice tests passed: deterministic bytes/order, duplicate-path/distinct notices, artifact tamper, wrong-version/stale/missing evidence, and size bounds.",
  );
} finally {
  const resolvedFixture = path.resolve(fixtureRoot);
  const resolvedWork = path.resolve(workRoot);
  if (!resolvedFixture.startsWith(`${resolvedWork}${path.sep}`)) {
    throw new Error(`Refusing to remove unexpected fixture path: ${fixtureRoot}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}
