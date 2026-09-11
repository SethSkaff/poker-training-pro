/**
 * The native minimize/restore IPC used by the package smoke must not appear in
 * a normal production renderer. This launches the exact unpacked executable
 * without the smoke flag and checks that neither audit capability reaches the
 * public preload/window surface.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    : "outputs/current/win-unpacked/Poker Training Pro.exe",
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

  /*
    Wait for the bridge before judging it.

    The page target exists before `contextBridge` has exposed `window.desktop`,
    so evaluating immediately can win the race against the preload and read an
    empty window. This check and the leak check used to be one expression, and
    an empty window failed it -- accusing the product of exposing an audit-only
    bridge because the preload had not attached yet. Observed once as a false
    product failure directly after a heavy local package run.

    Waiting cannot hide a leak. `electron/preload.cjs` exposes
    `testLifecycleWindow`, `sceneDiagnosticsEnabled`, and `sceneAuditSeed` in
    the same single `exposeInMainWorld("desktop", ...)` call, so the object
    never exists without its full key set; and `__ptpSceneDiagnostics` is
    installed by the renderer only when that same object carries
    `sceneDiagnosticsEnabled`. So the surface either appears clean or appears
    leaking -- never clean first and leaking later.
  */
  if (!(await waitForValue(client, "typeof window.desktop === 'object' && window.desktop !== null", deadline))) {
    throw new Error("Normal packaged preload never exposed its bridge.");
  }
  const result = await client.send("Runtime.evaluate", {
    expression:
      "typeof window.desktop.testLifecycleWindow === 'undefined' && typeof window.desktop.sceneDiagnosticsEnabled === 'undefined' && typeof window.desktop.sceneAuditSeed === 'undefined' && typeof window.__ptpSceneDiagnostics === 'undefined'",
    returnByValue: true,
  });
  if (result.result?.value !== true) {
    throw new Error("Normal packaged preload exposed an audit-only lifecycle/diagnostics bridge.");
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
      "Normal packaged preload has no lifecycle, diagnostics, or deterministic-seed audit bridge; the native minimize control, renderer metrics, and fixed capture seed are test-launch-only.",
  },
  { failure, transportTimeout },
);
// A clean checkout has no ignored `work/`, and this audit runs standalone as
// well as after the stages that happen to create it. Writing the evidence is
// part of passing, so do not depend on another stage having gone first.
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/** Poll an expression until it is truthy, bounded by the audit's own deadline. */
async function waitForValue(cdp, expression, deadline) {
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result.result?.value) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 70));
  }
  return false;
}
