/**
 * Exercise the packaged corrupt-save recovery screen with a deliberately
 * isolated profile. This must never touch a real player's Electron profile.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";

const PROFILE_PREFIX = "poker-training-pro-recovery-smoke-";
const appPath = resolve(
  projectRoot,
  argumentValue("--app") ?? "outputs/next/win-unpacked/Poker Training Pro.exe",
);
const reportPath = resolve(projectRoot, "work", "packaged-save-recovery-smoke.json");
const timeoutMs = 30_000;

if (process.platform !== "win32") {
  throw new Error("Packaged save recovery smoke requires a Windows Electron executable.");
}
if (!existsSync(appPath)) throw new Error(`Packaged executable not found: ${appPath}`);

const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
assertTempProfile(profile);
const saveDirectory = join(profile, "saves");
await mkdir(saveDirectory, { recursive: true });
await writeFile(join(saveDirectory, "autosave.json"), "{ intentionally corrupt", "utf8");

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
const checks = [];
let client;
let failure;
let transportTimeout;

try {
  const deadline = Date.now() + timeoutMs;
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  client = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Input.setIgnoreInputEvents", { ignore: false });

  await expectText(client, "#recovery-title", "Your progress is still protected", "corrupt save opens recovery UI");
  await expectButton(client, "Start fresh", "recovery start-fresh control");
  await clickButton(client, "Start fresh");
  await expectButton(client, "Archive and start fresh", "explicit archive confirmation");
  await clickButton(client, "Archive and start fresh");
  await expectText(client, "#first-run-title", "Make the table comfortable", "fresh profile reaches first-run setup");

  const files = await readdir(saveDirectory);
  const archivedCorruptSave = files.some((file) => /^archive\.fresh-start\.current\..+\.json$/u.test(file));
  record("corrupt generation archived instead of silently deleted", archivedCorruptSave);
  if (!archivedCorruptSave) throw new Error("Corrupt generation was not archived during fresh start.");

  const current = JSON.parse(await readFile(join(saveDirectory, "autosave.json"), "utf8"));
  const validFreshSave =
    current?.format === "poker-training-pro-autosave" &&
    current?.boundary === "lifecycle" &&
    typeof current?.payload === "string";
  record("fresh autosave replaces recovery record", validFreshSave);
  if (!validFreshSave) throw new Error("Fresh recovery save did not have the expected durable envelope.");
} catch (error) {
  // A CDP command deadline proves neither a passing check nor a regression;
  // it must not be reported as a product failure (E25-003).
  ({ failure, transportTimeout } = classifyCdpFailure(error));
} finally {
  try { client?.close(); } catch { /* process cleanup remains authoritative */ }
  try { await terminateProcessTree(child); } catch { /* retrying profile cleanup below is safe */ }
  await removeProfile(profile);
}

const report = reportCdpOutcome(
  {
    schemaVersion: 1,
    executable: basename(appPath),
    checks,
    scope:
      "Packaged corrupt-current-save recovery: recovery UI, explicit archive confirmation, archived evidence, durable fresh profile, and first-run continuation. Previous/last-known-good restoration remains separately covered by save-store unit tests.",
  },
  { failure, transportTimeout },
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

async function expectText(cdp, selector, text, label) {
  const found = await waitForBoolean(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return element instanceof HTMLElement && (element.textContent || "").trim() === ${JSON.stringify(text)};
  })()`);
  record(label, found);
  if (!found) throw new Error(`${label}: ${selector} did not contain ${JSON.stringify(text)}.`);
}

async function expectButton(cdp, text, label) {
  const found = await waitForBoolean(cdp, buttonExpression(text));
  record(label, found);
  if (!found) throw new Error(`${label}: button ${JSON.stringify(text)} was not available.`);
}

async function clickButton(cdp, text) {
  const point = await waitForPoint(cdp, text);
  if (!point) throw new Error(`Could not find enabled button ${JSON.stringify(text)}.`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await delay(160);
}

function buttonExpression(text) {
  return `([...document.querySelectorAll("button")].some((button) => !button.disabled && (button.textContent || "").trim() === ${JSON.stringify(text)}))`;
}

async function waitForPoint(cdp, text) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = [...document.querySelectorAll("button")].find((candidate) => !candidate.disabled && (candidate.textContent || "").trim() === ${JSON.stringify(text)});
        if (!(button instanceof HTMLElement)) return null;
        const box = button.getBoundingClientRect();
        return box.width > 2 && box.height > 2 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
      })()`,
      returnByValue: true,
    });
    if (result.result?.value) return result.result.value;
    await delay(80);
  }
  return null;
}

async function waitForBoolean(cdp, expression, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return true;
    await delay(80);
  }
  return false;
}

function record(label, ok) { checks.push({ label, ok: Boolean(ok) }); }

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function assertTempProfile(target) {
  const resolved = resolve(target);
  const childPath = relative(resolve(tmpdir()), resolved);
  if (!childPath || childPath === ".." || childPath.startsWith(`..${sep}`) || !basename(resolved).startsWith(PROFILE_PREFIX)) {
    throw new Error("Refusing to operate on an unexpected temporary profile.");
  }
}

async function removeProfile(target) {
  assertTempProfile(target);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch { await delay(100 * (attempt + 1)); }
  }
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
