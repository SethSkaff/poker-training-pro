import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditPackagedLicenseSidecars,
} from "./lib/packaged-license-sidecars.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workRoot = path.join(projectRoot, "work");
mkdirSync(workRoot, { recursive: true });
const fixtureRoot = mkdtempSync(
  path.join(workRoot, "packaged-license-sidecar-test-"),
);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeRelative(relativePath, bytes) {
  const destination = path.join(
    fixtureRoot,
    ...relativePath.split("/"),
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function expected(id, targetPath, contents) {
  const expectedBytes = Buffer.from(contents, "utf8");
  return {
    id,
    targetPath,
    minimumBytes: 8,
    maximumBytes: 4096,
    bytes: expectedBytes.length,
    sha256: hash(expectedBytes),
    expectedBytes,
  };
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

const files = [
  expected(
    "electron-license",
    "LICENSE.electron.txt",
    "Electron license fixture version 43.2.0\n",
  ),
  expected(
    "chromium-licenses",
    "LICENSES.chromium.html",
    "<html>Chromium license fixture version 43.2.0</html>\n",
  ),
  expected(
    "runtime-notices",
    "resources/THIRD-PARTY-NOTICES.runtime.txt",
    "Runtime package notices fixture version 1\n",
  ),
];

function audit(overrides = {}) {
  return auditPackagedLicenseSidecars({
    packageRoot: fixtureRoot,
    files,
    maximumTotalBytes: 16384,
    ...overrides,
  });
}

try {
  for (const file of files) {
    writeRelative(file.targetPath, file.expectedBytes);
  }
  const valid = audit();
  if (valid.files.length !== 3) {
    throw new Error("Valid sidecar fixture did not verify all three files.");
  }

  unlinkSync(path.join(fixtureRoot, "LICENSE.electron.txt"));
  expectThrow(audit, /is missing/, "missing Electron license");
  writeRelative(files[0].targetPath, files[0].expectedBytes);

  writeRelative(
    files[1].targetPath,
    "<html>Chromium license fixture tampered!</html>\n",
  );
  expectThrow(audit, /stale, tampered, or the wrong version/, "tampered file");
  writeRelative(files[1].targetPath, files[1].expectedBytes);

  writeRelative(
    files[2].targetPath,
    "Runtime package notices fixture old version\n",
  );
  expectThrow(audit, /stale, tampered, or the wrong version/, "stale file");
  writeRelative(files[2].targetPath, files[2].expectedBytes);

  const staleEvidence = files.map((file) => ({ ...file }));
  staleEvidence[0].sha256 = "0".repeat(64);
  expectThrow(
    () => audit({ files: staleEvidence }),
    /expected evidence is stale or inconsistent/,
    "stale expected evidence",
  );

  const escaping = files.map((file) => ({ ...file }));
  escaping[0].targetPath = "../LICENSE.electron.txt";
  expectThrow(
    () => audit({ files: escaping }),
    /escapes its allowed root/,
    "path traversal",
  );

  const oversized = files.map((file) => ({ ...file }));
  oversized[1].maximumBytes = 16;
  expectThrow(
    () => audit({ files: oversized }),
    /size.*outside/,
    "individual size bound",
  );
  expectThrow(
    () => audit({ maximumTotalBytes: 64 }),
    /exceed.*total bytes/,
    "total size bound",
  );

  console.log(
    "Packaged license sidecar tests passed: valid, missing, tampered, stale, " +
      "stale evidence, path traversal, and size bounds.",
  );
} finally {
  const resolvedFixture = path.resolve(fixtureRoot);
  const resolvedWork = path.resolve(workRoot);
  if (!resolvedFixture.startsWith(`${resolvedWork}${path.sep}`)) {
    throw new Error(
      `Refusing to remove unexpected fixture path: ${fixtureRoot}`,
    );
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
}
