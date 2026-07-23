import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  FuseV1Options,
  getCurrentFuseWire,
} from "@electron/fuses";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const executable =
  process.argv[2] ??
  path.join(
    projectRoot,
    "outputs",
    "desktop",
    "win-unpacked",
    "Poker Training Pro.exe",
  );

if (!existsSync(executable)) {
  fail(`packaged executable not found: ${executable}`);
}

const wire = await getCurrentFuseWire(executable);
const expected = new Map([
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, false],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, false],
]);
const checks = [];

for (const [option, expectedValue] of expected) {
  const raw = wire[option];
  const actual = raw === 49 || raw === "1" || raw === true;
  checks.push({
    option: FuseV1Options[option],
    expected: expectedValue,
    actual,
    raw,
    ok: actual === expectedValue,
  });
}

const failed = checks.filter((check) => !check.ok);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: failed.length === 0,
      executable,
      version: wire.version,
      checks,
    },
    null,
    2,
  )}\n`,
);
if (failed.length > 0) process.exit(1);

function fail(message) {
  process.stderr.write(`Electron fuse verification failed: ${message}\n`);
  process.exit(1);
}
