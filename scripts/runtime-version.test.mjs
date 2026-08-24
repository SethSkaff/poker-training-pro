import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
  MINIMUM_NODE_VERSION,
  parseNodeVersion,
  PINNED_NODE_VERSION,
  unsupportedNodeVersionMessage,
} from "./runtime-version.mjs";

const projectRoot = new URL("../", import.meta.url);

test("parses Node version strings without accepting partial or malformed input", () => {
  assert.deepEqual(parseNodeVersion("v22.12.0"), {
    major: 22,
    minor: 12,
    patch: 0,
    prerelease: null,
  });
  assert.deepEqual(parseNodeVersion("24.1.3-rc.1"), {
    major: 24,
    minor: 1,
    patch: 3,
    prerelease: "rc.1",
  });
  for (const invalid of ["22", "22.12", "22.12.x", "not-a-version", ""]) {
    assert.equal(parseNodeVersion(invalid), null);
  }
});

test("enforces the complete >=22.12.0 boundary, including prereleases", () => {
  for (const supported of ["22.12.0", "22.12.1-pre.1", "23.0.0", "24.14.0"]) {
    assert.equal(isSupportedNodeVersion(supported), true, supported);
    assert.equal(
      assertSupportedNodeVersion({ version: supported, execPath: "node" }),
      supported,
    );
  }
  for (const unsupported of [
    "20.19.0",
    "22.0.0",
    "22.11.99",
    "22.12.0-rc.1",
    "invalid",
  ]) {
    assert.equal(isSupportedNodeVersion(unsupported), false, unsupported);
    assert.throws(
      () =>
        assertSupportedNodeVersion({ version: unsupported, execPath: "node" }),
      { code: "ERR_UNSUPPORTED_NODE_VERSION" },
    );
  }
});

test("failure guidance names the exact boundary, executable, and version pins", () => {
  const message = unsupportedNodeVersionMessage({
    version: "20.9.0",
    execPath: "C:\\runtime\\node.exe",
    workflow: "Release verification",
  });
  assert.match(message, /Release verification requires Node\.js >=22\.12\.0/);
  assert.match(message, /current runtime is 20\.9\.0/);
  assert.match(message, /C:\\runtime\\node\.exe/);
  assert.match(message, /\.node-version\/\.nvmrc \(22\.12\.0\)/);
});

test("manifest, lockfile, pin files, and ordinary npm workflows share one runtime contract", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("package.json", projectRoot), "utf8"),
  );
  const packageLock = JSON.parse(
    readFileSync(new URL("package-lock.json", projectRoot), "utf8"),
  );
  assert.equal(packageJson.engines.node, `>=${MINIMUM_NODE_VERSION}`);
  assert.equal(
    packageLock.packages[""].engines.node,
    packageJson.engines.node,
  );
  for (const pinName of [".node-version", ".nvmrc"]) {
    assert.equal(
      readFileSync(new URL(pinName, projectRoot), "utf8").trim(),
      PINNED_NODE_VERSION,
      pinName,
    );
  }

  const guard = "node scripts/check-node-version.mjs && ";
  const exempt = new Set(["check:runtime", "preinstall"]);
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (exempt.has(name)) continue;
    assert.equal(
      command.startsWith(guard),
      true,
      `${name} must fail fast through the shared Node runtime check`,
    );
  }
  assert.equal(packageJson.scripts.preinstall, "node scripts/check-node-version.mjs");
  assert.equal(packageJson.scripts["check:runtime"], "node scripts/check-node-version.mjs");

  const workflow = readFileSync(
    new URL(".github/workflows/release-quality.yml", projectRoot),
    "utf8",
  );
  assert.match(workflow, /node-version-file:\s*\.node-version/);
});
