import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const unpackedDirectory = path.resolve(
  process.argv[2] ??
    path.join(projectRoot, "outputs", "next", "win-unpacked"),
);
const executable = path.join(unpackedDirectory, "Poker Training Pro.exe");
const archive = path.join(unpackedDirectory, "resources", "app.asar");
const backup = `${archive}.integrity-test-backup`;

for (const required of [executable, archive]) {
  if (!existsSync(required)) fail(`required packaged file is missing: ${required}`);
}
if (existsSync(backup)) {
  fail(`refusing to overwrite an existing integrity-test backup: ${backup}`);
}

const original = await observeLaunch(executable, 2500);
if (!original.remainedRunning) {
  fail(
    `untampered packaged app exited early: ${JSON.stringify(original)}`,
  );
}

copyFileSync(archive, backup);
try {
  flipHeaderByte(archive);
  const tampered = await observeLaunch(executable, 3500);
  if (tampered.remainedRunning) {
    fail("tampered packaged app remained running; ASAR rejection failed");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        executable,
        untamperedRemainedRunning: original.remainedRunning,
        tamperedRemainedRunning: tampered.remainedRunning,
        tamperedExitCode: tampered.exitCode,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (existsSync(archive)) unlinkSync(archive);
  renameSync(backup, archive);
}

function flipHeaderByte(file) {
  const descriptor = openSync(file, "r+");
  try {
    const offset = 64;
    const byte = Buffer.alloc(1);
    if (readSync(descriptor, byte, 0, 1, offset) !== 1) {
      throw new Error("could not read ASAR header byte");
    }
    byte[0] ^= 1;
    if (writeSync(descriptor, byte, 0, 1, offset) !== 1) {
      throw new Error("could not modify ASAR header byte");
    }
  } finally {
    closeSync(descriptor);
  }
}

async function observeLaunch(program, observationMs) {
  const child = spawn(program, [], {
    cwd: path.dirname(program),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ error }));
  });
  const outcome = await Promise.race([
    exit,
    new Promise((resolve) =>
      setTimeout(() => resolve({ observationExpired: true }), observationMs),
    ),
  ]);
  const remainedRunning =
    "observationExpired" in outcome && child.exitCode === null;
  if (remainedRunning) {
    child.kill();
    await exit;
  }
  return {
    remainedRunning,
    exitCode: child.exitCode,
    outcome,
    stdout: stdout.slice(-4_000),
    stderr: stderr.slice(-4_000),
  };
}

function fail(message) {
  process.stderr.write(`ASAR tamper test failed: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}
