/**
 * The native minimize/restore IPC used by the package smoke must not appear in
 * a normal production renderer. This launches the exact unpacked executable
 * without the smoke flag and checks only the public preload surface.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname.slice(1));
const appPath = resolve(
  projectRoot,
  process.argv.includes("--app")
    ? process.argv[process.argv.indexOf("--app") + 1]
    : "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const reportPath = resolve(projectRoot, "work", "packaged-lifecycle-bridge-security.json");
const profile = await mkdtemp(join(tmpdir(), "poker-training-pro-lifecycle-security-"));

if (process.platform !== "win32") {
  throw new Error("Packaged lifecycle bridge audit requires Windows.");
}
if (!existsSync(appPath)) throw new Error(`Packaged executable not found: ${appPath}`);

const child = spawn(
  appPath,
  [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
  ],
  { cwd: dirname(appPath), detached: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false },
);
const output = captureBoundedOutput(child, 8_192);
let client;
let failure;
let transportTimeout;

try {
  const deadline = Date.now() + 20_000;
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  client = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  const result = await client.send("Runtime.evaluate", {
    expression:
      "typeof window.desktop === 'object' && window.desktop !== null && typeof window.desktop.testLifecycleWindow === 'undefined'",
    returnByValue: true,
  });
  if (result.result?.value !== true) {
    throw new Error("Normal packaged preload was unavailable or exposed the lifecycle smoke bridge.");
  }
} catch (error) {
  // A CDP command deadline proves neither a passing check nor a regression;
  // it must not be reported as a product failure (E25-003).
  ({ failure, transportTimeout } = classifyCdpFailure(error));
} finally {
  try { client?.close(); } catch {}
  try { await terminateProcessTree(child); } catch {}
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 80 });
}

const report = reportCdpOutcome(
  {
    schemaVersion: 1,
    executable: basename(appPath),
    scope:
      "Normal packaged preload has no lifecycle smoke bridge; the native minimize control is test-launch-only.",
  },
  { failure, transportTimeout },
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
