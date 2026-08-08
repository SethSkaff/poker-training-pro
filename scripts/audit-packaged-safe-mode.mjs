import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import {
  EXPECTED_DOCUMENT_URL,
  EXPECTED_TITLE,
  RenderSmokeFailure,
  assertNoFatalCdpEvents,
} from "./release/packaged-render-smoke-lib.mjs";
import { projectRoot } from "./release/shared.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";

const APP = join(
  projectRoot,
  "outputs",
    "next",
  "win-unpacked",
  "Poker Training Pro.exe",
);
const PROFILE_PREFIX = "poker-training-pro-safe-mode-smoke-";
const TIMEOUT_MS = 30_000;
const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
assertSafeProfile(profile);
const recoveryDirectory = join(profile, "recovery");
await mkdir(recoveryDirectory, { recursive: true });
const now = Date.now();
await writeFile(
  join(recoveryDirectory, "crash-loop.json"),
  JSON.stringify({
    format: "poker-training-pro-crash-loop",
    version: 1,
    consecutiveFailures: 3,
    sessionPending: false,
    lastFailureAt: now,
    lastFailureKind: "renderer",
    lastStartupAt: now,
  }),
  "utf8",
);

const child = spawn(
  APP,
  [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
  ],
  {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);
const output = captureBoundedOutput(child, 8_192);
const deadline = Date.now() + TIMEOUT_MS;
let cdp;

try {
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");

  const safeMode = await waitForObservation(async () =>
    evaluate(`(() => {
      const root = document.querySelector("#root");
      return {
        url: location.href,
        title: document.title,
        rootChildren: root?.childElementCount ?? 0,
        text: (root?.textContent || "").slice(0, 10000),
        reducedMotion: document.documentElement.classList.contains("reduced-motion"),
        buttons: [...document.querySelectorAll("button")].map((button) =>
          (button.textContent || "").trim()
        )
      };
    })()`),
  (value) =>
    value.url === EXPECTED_DOCUMENT_URL &&
    value.title === EXPECTED_TITLE &&
    value.rootChildren > 0 &&
    value.text.includes("Safe mode is protecting this session") &&
    value.text.includes("Recovery count: 3") &&
    value.text.includes("repeated startup or renderer failures") &&
    value.reducedMotion === true &&
    ["Continue in safe mode", "Export diagnostics", "Quit safely"].every(
      (label) => value.buttons.includes(label),
    ));

  await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => (candidate.textContent || "").trim() === "Continue in safe mode"
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, true);

  const continued = await waitForObservation(
    async () =>
      evaluate(`(() => ({
        reducedMotion: document.documentElement.classList.contains("reduced-motion"),
        text: (document.querySelector("#root")?.textContent || "").slice(0, 10000)
      }))()`),
    (value) => {
      const text = String(value.text).toLowerCase();
      return (
        value.reducedMotion === true &&
        (text.includes("first-time setup") ||
          (text.includes("play") && text.includes("settings")))
      );
    },
  );

  reportCdpOutcome({
    documentUrl: safeMode.url,
    failureCount: 3,
    recoveryControls: safeMode.buttons,
    reducedMotionBeforeContinue: safeMode.reducedMotion,
    reducedMotionAfterContinue: continued.reducedMotion,
    runtimeExceptions: 0,
    consoleErrors: 0,
  });
} catch (error) {
  // A CDP command deadline proves neither a working safe mode nor a broken
  // one; it must not be reported as a product failure (E25-003).
  reportCdpOutcome(
    { documentUrl: EXPECTED_DOCUMENT_URL, failureCount: 3 },
    classifyCdpFailure(error),
  );
} finally {
  try {
    cdp?.close();
  } catch {
    // Exact process-tree termination remains authoritative.
  }
  await terminateProcessTree(child);
  assertSafeProfile(profile);
  await rm(profile, { recursive: true, force: true });
}

async function waitForObservation(observe, accept) {
  let last;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new RenderSmokeFailure(
        "process-exited",
        `Packaged app exited during safe-mode smoke (code ${child.exitCode}).`,
      );
    }
    assertNoFatalCdpEvents(cdp.takeFatalEvents());
    last = await observe();
    if (accept(last)) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new RenderSmokeFailure(
    "safe-mode-timeout",
    `Safe-mode renderer did not reach the required state: ${JSON.stringify(last)}`,
  );
}

async function evaluate(expression, userGesture = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    userGesture,
  });
  if (result.exceptionDetails) {
    throw new RenderSmokeFailure(
      "runtime-exception",
      "Safe-mode Runtime.evaluate raised an exception.",
    );
  }
  return result.result?.value;
}

function assertSafeProfile(candidate) {
  const resolvedProfile = resolve(candidate);
  const resolvedTemp = resolve(tmpdir());
  const childPath = relative(resolvedTemp, resolvedProfile);
  if (
    !childPath ||
    childPath === ".." ||
    childPath.startsWith(`..${sep}`) ||
    isAbsolute(childPath) ||
    !basename(resolvedProfile).startsWith(PROFILE_PREFIX)
  ) {
    throw new Error("Refusing to operate on an unexpected safe-mode profile.");
  }
}
