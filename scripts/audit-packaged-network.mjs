import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import {
  buildRepresentativePlayPlan,
  summarizeNetworkPlayAudit,
} from "./release/packaged-network-play-lib.mjs";
import { isCdpTransportTimeout } from "./lib/cdp-outcome.mjs";

const NETWORK_PROFILE_PREFIX = "poker-training-pro-network-audit-";

const projectRoot = resolve(new URL("..", import.meta.url).pathname.slice(1));
const appArgument = argumentValue("--app");
const appPath = resolve(
  projectRoot,
  appArgument ?? "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const observationMs = numberArgument("--duration-ms", 45_000);
const reportPath = resolve(projectRoot, "work", "packaged-network-audit.json");

if (process.platform !== "win32") {
  throw new Error(
    "The current packaged-network audit expects a Windows Electron executable.",
  );
}
if (!existsSync(appPath)) {
  throw new Error(
    `Packaged executable not found: ${appPath}. Pass --app <path> after packaging.`,
  );
}
if (observationMs < 5_000 || observationMs > 120_000) {
  throw new Error("--duration-ms must be between 5000 and 120000.");
}

const observations = [];
const sockets = new Set();
const proxy = createServer((socket) => {
  sockets.add(socket);
  const record = { connectedAtMs: Date.now(), bytes: 0, firstLine: "" };
  observations.push(record);
  let buffered = "";
  socket.on("data", (chunk) => {
    record.bytes += chunk.length;
    if (!record.firstLine) {
      buffered += chunk.toString("utf8");
      const lineEnd = buffered.indexOf("\r\n");
      if (lineEnd >= 0) record.firstLine = buffered.slice(0, lineEnd).slice(0, 512);
    }
    socket.end(
      "HTTP/1.1 502 Network disabled by release audit\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
});

await new Promise((resolveListen, rejectListen) => {
  proxy.once("error", rejectListen);
  proxy.listen(0, "127.0.0.1", resolveListen);
});
const address = proxy.address();
if (!address || typeof address === "string") {
  throw new Error("Could not resolve the audit proxy port.");
}

const profile = await mkdtemp(join(tmpdir(), NETWORK_PROFILE_PREFIX));
const child = spawn(
  appPath,
  [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
    `--proxy-server=http://127.0.0.1:${address.port}`,
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
  ],
  {
    cwd: dirname(appPath),
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);

const processOutput = captureBoundedOutput(child, 8_192);
let launchError = null;
child.once("error", (error) => {
  launchError = error.message;
});

const plan = buildRepresentativePlayPlan();
const reachedModes = new Set();
const completedStepIds = [];
let cdp;
let playError = null;
let transportTimeout = null;

try {
  const deadline = Date.now() + observationMs;
  const port = await waitForDevToolsPort(profile, child, deadline, processOutput);
  const target = await waitForPageTarget(port, child, deadline, processOutput);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
  await delay(500);
  await cdp.send("Page.reload", { ignoreCache: true });
  await delay(500);

  for (const step of plan.steps) {
    if (child.exitCode !== null) break;
    const ok = await runStep(cdp, step, deadline);
    if (ok) {
      completedStepIds.push(step.id);
      // Menu/home expectations prove routing, but only a real gameplay table
      // or tutorial proves that a representative mode was actually exercised.
      if (
        step.kind === "expectScreen" &&
        step.mode &&
        ["poker-table", "tutorial"].includes(step.screen)
      ) {
        reachedModes.add(step.mode);
      }
    }
  }
} catch (error) {
  // A CDP command deadline proves neither a clean network observation nor a
  // policy violation; it must not be reported as a product failure (E25-003).
  // The network *observations* collected before the timeout still stand and are
  // reported, since a request that was made was made.
  if (isCdpTransportTimeout(error)) {
    transportTimeout = error instanceof Error ? error.message : String(error);
  } else {
    playError = error instanceof Error ? error.message : String(error);
  }
} finally {
  try {
    cdp?.close();
  } catch {
    // process-tree termination is authoritative
  }
  try {
    await terminateProcessTree(child);
  } catch {
    // best effort
  }
  for (const socket of sockets) socket.destroy();
  await new Promise((resolveClose) => proxy.close(resolveClose));
  await removeProfile(profile);
}

const remainedRunning = launchError === null && playError === null;
const report = summarizeNetworkPlayAudit({
  executable: basename(appPath),
  observationMs,
  launched: launchError === null,
  remainedRunning,
  observations,
  reachedModes: [...reachedModes],
  completedStepIds,
  plan,
});
if (launchError) report.launchError = launchError;
if (playError) report.playError = playError;
if (transportTimeout) {
  report.transportTimeout = transportTimeout;
  // The walk-through did not finish, so "reached every mode" cannot be
  // claimed. Say so as inconclusive rather than as a violation.
  report.ok = false;
  report.outcome = "inconclusive-cdp-timeout";
}

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (transportTimeout) {
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 2;
} else if (!report.ok) {
  throw new Error(
    `Packaged network audit failed:\n${report.failures
      .map((error) => `- ${error}`)
      .join("\n")}${playError ? `\n- play error: ${playError}` : ""}`,
  );
} else {
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

async function runStep(client, step, deadline) {
  switch (step.kind) {
    case "clickText":
      return clickByText(client, step.text);
    case "clickSelector":
      return clickBySelector(client, step.selector);
    case "heroAction":
      return dispatchHeroAction(client, step.key);
    case "expectScreen":
      return waitForScreen(client, step.screen, deadline, step.expectedText);
    case "settle":
      await delay(step.delayMs ?? 250);
      return true;
    default:
      return false;
  }
}

async function clickByText(client, text) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const label = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll("button")].find(
        (candidate) =>
          (candidate.textContent || "").trim() === label ||
          [...candidate.querySelectorAll("strong")].some(
            (strong) => (strong.textContent || "").trim() === label
          )
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  return result.result?.value === true;
}

async function clickBySelector(client, selector) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  return result.result?.value === true;
}

async function dispatchHeroAction(client, key) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const target = document.activeElement || document.body;
      const options = { key: ${JSON.stringify(key)}, bubbles: true };
      target.dispatchEvent(new KeyboardEvent("keydown", options));
      target.dispatchEvent(new KeyboardEvent("keyup", options));
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  await delay(200);
  return result.result?.value === true;
}

async function waitForScreen(client, screen, deadline, expectedText) {
  const limit = Math.min(deadline, Date.now() + 6_000);
  while (Date.now() < limit) {
    if (child.exitCode !== null) return false;
    const result = await client.send("Runtime.evaluate", {
      expression: `(() => {
        if (document.querySelector('.home-reference')) return 'home';
        if (document.querySelector('.mode-stage')) return 'mode-select';
        if (document.querySelector('.room-flight')) return 'room-flight';
        if (document.querySelector('.playable-tutorial')) return 'tutorial';
        if (document.querySelector('.poker-table')) return 'poker-table';
        return 'other';
      })()`,
      returnByValue: true,
    });
    if (result.result?.value !== screen) {
      await delay(100);
      continue;
    }
    if (!expectedText) return true;
    const text = await client.send("Runtime.evaluate", {
      expression: `(document.querySelector('#root')?.textContent || '')`,
      returnByValue: true,
    });
    if (String(text.result?.value ?? "").includes(expectedText)) return true;
    await delay(100);
  }
  return false;
}

async function removeProfile(target) {
  const resolved = resolve(target);
  if (!basename(resolved).startsWith(NETWORK_PROFILE_PREFIX)) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(resolved, { recursive: true, force: true });
      return;
    } catch {
      await delay(100 * (attempt + 1));
    }
  }
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function numberArgument(flag, fallback) {
  const value = argumentValue(flag);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer.`);
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
