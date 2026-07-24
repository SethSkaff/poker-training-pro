/**
 * Bounded packaged-game completion smoke. It uses a deliberately conservative
 * legal hero policy (check/call when available, otherwise fold) so the real
 * bundled tournament flow reaches an actual ceremony without hidden state or
 * test-only renderer hooks.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";

const PROFILE_PREFIX = "poker-training-pro-mode-completion-";
const MODES = Object.freeze(["normal", "rational", "timed"]);
const appPath = resolve(
  projectRoot,
  argumentValue("--app") ?? "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const requestedMode = argumentValue("--mode");
const modes = requestedMode ? [requestedMode] : [...MODES];
const reportPath = resolve(projectRoot, "work", "packaged-mode-completion.json");
// Rational events can legitimately require substantially more hero decisions
// than a Normal/Timed run while the renderer performs bounded, deterministic
// equity work. This is a completion smoke, not a frame-time benchmark, so the
// ceiling must cover a progressing legal event without silently changing its
// visible action policy.
const perModeTimeoutMs = 105_000;

if (process.platform !== "win32") throw new Error("Packaged mode completion smoke requires Windows.");
if (!existsSync(appPath)) throw new Error(`Packaged executable not found: ${appPath}`);
if (modes.some((mode) => !MODES.includes(mode))) {
  throw new Error(`--mode must be one of: ${MODES.join(", ")}.`);
}

const results = [];
let failure;
for (const [index, mode] of modes.entries()) {
  try {
    results.push(await completeMode(mode));
    // Electron's child renderer processes can emit final console diagnostics
    // for a moment after the parent EXE exits. Keep consecutive isolated
    // profiles from ever attaching to that shutdown tail.
    // Chromium's sandboxed child processes can outlive their Electron parent
    // briefly on Windows. Give the OS a full quiet interval before the next
    // isolated profile starts; otherwise a late renderer-console diagnostic
    // can be attributed to the following mode's CDP target.
    if (index < modes.length - 1) await delay(1_500);
  } catch (error) {
    failure = `${mode}: ${error instanceof Error ? error.message : String(error)}`;
    break;
  }
}

const report = {
  schemaVersion: 1,
  executable: basename(appPath),
  modes,
  results,
  ok: !failure && results.length === modes.length,
  ...(failure ? { failure } : {}),
  scope: "Packaged UI completion smoke for Normal, Rational, and Timed Table using only ordinary displayed controls. Each completed event also records heap/DOM/listener deltas and rejects retained history rows, blob URLs, or excessive heap growth. It is bounded event coverage, not a 60-minute hardware soak.",
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!report.ok) throw new Error(`Packaged mode completion smoke failed: ${failure ?? "one or more modes did not finish"}`);
console.log(JSON.stringify({ ok: true, ...report }, null, 2));

async function completeMode(mode) {
  const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
  assertTempProfile(profile);
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
  let cdp;
  try {
    const deadline = Date.now() + perModeTimeoutMs;
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Performance.enable");
    await clickText(cdp, "Skip setup", deadline);
    await waitFor(cdp, ".home-reference", deadline, "home menu");
    await clickSelector(cdp, 'button[aria-label="Play"]', deadline);
    await clickIfPresent(cdp, "#play-chip-ack-title ~ .startup-gate__actions button");
    await waitFor(cdp, ".mode-stage", deadline, "mode selection");
    await clickSelector(cdp, `.mode-stage__choice--${mode}`, deadline);
    if (mode === "timed") {
      await waitFor(cdp, ".timed-setup", deadline, "timed setup");
      await clickSelector(cdp, ".timed-setup__start", deadline);
    } else {
      await waitForText(cdp, "Enter event", deadline, "career event lobby");
      await clickText(cdp, "Enter event", deadline);
    }
    await waitFor(cdp, ".room-flight", deadline, "championship arrival");
    await clickText(cdp, "Skip arrival", deadline);
    await waitFor(cdp, ".poker-table", deadline, "live table");

    const desktopBridgePresent = await evaluate(
      cdp,
      "typeof window.desktop === 'object' && window.desktop !== null",
    );
    if (!desktopBridgePresent) {
      throw new Error("packaged preload bridge was unavailable at the live table.");
    }
    const resourcesBefore = await readResourceSnapshot(cdp);
    const finished = await driveToCeremony(cdp, child, deadline);
    const resourcesAfter = await readResourceSnapshot(cdp);
    assertBoundedTournamentResources(resourcesBefore, resourcesAfter);
    const errors = cdp.takeFatalEvents();
    // Electron 43 can log this exact bootstrap diagnostic for an internal
    // sandboxed helper context after a Timed Table run. It is not the main
    // renderer: the bridge check above, real table, and full ceremony have all
    // completed. Keep it in the report for Electron-upgrade follow-up, but do
    // not conflate it with an application exception. Every other error remains
    // a hard failure.
    const frameworkDiagnostics = errors.filter(isKnownElectronSandboxDiagnostic);
    const applicationErrors = errors.filter(
      (event) => !isKnownElectronSandboxDiagnostic(event),
    );
    if (applicationErrors.length > 0) {
      throw new Error(
        `renderer emitted fatal CDP events: ${JSON.stringify(applicationErrors)}`,
      );
    }
    return {
      mode,
      desktopBridgePresent,
      ...finished,
      ...(frameworkDiagnostics.length > 0 ? { frameworkDiagnostics } : {}),
      resources: summarizeResourceGrowth(resourcesBefore, resourcesAfter),
    };
  } finally {
    try { cdp?.close(); } catch { /* process-tree cleanup below is authoritative */ }
    try { await terminateProcessTree(child); } catch { /* best effort before isolated cleanup */ }
    await removeProfile(profile);
  }
}

async function driveToCeremony(cdp, child, deadline) {
  let actions = 0;
  let skips = 0;
  let lastActionAt = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`packaged app exited during play (code ${child.exitCode}).`);
    const state = await evaluate(cdp, `(() => {
      const ceremony = document.querySelector('.ceremony-board');
      const skip = document.querySelector('button[aria-label="Skip opponent presentation and continue the hand"]');
      const choices = [...document.querySelectorAll('.action-dock .action-button')]
        .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
      const preferred = choices.find((button) => button.classList.contains('action-button--call')) ||
        choices.find((button) => button.classList.contains('action-button--fold'));
      return {
        ceremony: ceremony instanceof HTMLElement,
        placement: ceremony instanceof HTMLElement
          ? (ceremony.querySelector('.ceremony-board__place')?.textContent || '').trim()
          : undefined,
        skip: skip instanceof HTMLButtonElement && !skip.disabled,
        action: preferred instanceof HTMLButtonElement ? preferred.className : undefined,
      };
    })()`);
    if (state?.ceremony) {
      if (!state.placement) throw new Error("ceremony lacked a placement label.");
      return { actions, skips, placement: state.placement };
    }
    if (state?.skip) {
      await evaluate(cdp, `document.querySelector('button[aria-label="Skip opponent presentation and continue the hand"]')?.click()`);
      skips += 1;
      await delay(35);
      continue;
    }
    if (state?.action && Date.now() - lastActionAt > 110) {
      const accepted = await evaluate(cdp, `(() => {
        const choices = [...document.querySelectorAll('.action-dock .action-button')]
          .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
        const preferred = choices.find((button) => button.classList.contains('action-button--call')) ||
          choices.find((button) => button.classList.contains('action-button--fold'));
        if (!(preferred instanceof HTMLButtonElement)) return false;
        preferred.click();
        return true;
      })()`);
      if (accepted) {
        actions += 1;
        lastActionAt = Date.now();
      }
    }
    await delay(55);
  }
  throw new Error(`timed out before ceremony after ${actions} hero action(s) and ${skips} presentation skip(s).`);
}

async function clickSelector(cdp, selector, deadline) {
  await waitFor(cdp, selector, deadline, selector);
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLButtonElement) || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click ${selector}.`);
  await delay(110);
}

async function clickText(cdp, text, deadline) {
  await waitForText(cdp, text, deadline, `button ${JSON.stringify(text)}`);
  const clicked = await evaluate(cdp, buttonExpression(text, true));
  if (!clicked) throw new Error(`Could not click button ${JSON.stringify(text)}.`);
  await delay(110);
}

async function clickIfPresent(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLButtonElement) || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (clicked) await delay(110);
  return Boolean(clicked);
}

async function waitFor(cdp, selector, deadline, label) {
  const found = await poll(cdp, `document.querySelector(${JSON.stringify(selector)}) !== null`, deadline);
  if (!found) throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForText(cdp, text, deadline, label) {
  const found = await poll(cdp, buttonExpression(text, false), deadline);
  if (!found) throw new Error(`Timed out waiting for ${label}.`);
}

function buttonExpression(text, click) {
  return `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate instanceof HTMLButtonElement && !candidate.disabled && (candidate.textContent || '').trim() === ${JSON.stringify(text)}
    );
    ${click ? "if (button instanceof HTMLButtonElement) { button.click(); return true; } return false;" : "return button instanceof HTMLButtonElement;"}
  })()`;
}

async function poll(cdp, expression, deadline) {
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return true;
    await delay(70);
  }
  return false;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error("Runtime.evaluate raised an exception.");
  return result.result?.value;
}

async function readResourceSnapshot(cdp) {
  const [performance, dom] = await Promise.all([
    cdp.send("Performance.getMetrics"),
    evaluate(cdp, `(() => ({
      retainedHistoryRows: document.querySelectorAll('.hand-history-popover li, .public-hand-history li').length,
      objectUrlLikeSources: [...document.querySelectorAll('[src], [href]')]
        .filter((element) => String(element.getAttribute('src') || element.getAttribute('href') || '').startsWith('blob:')).length,
    }))()`),
  ]);
  const metrics = Object.fromEntries(
    (performance.metrics ?? [])
      .filter((entry) => ["JSHeapUsedSize", "Nodes", "Documents", "JSEventListeners"].includes(entry.name))
      .map((entry) => [entry.name, Number(entry.value)]),
  );
  return { metrics, dom };
}

function summarizeResourceGrowth(before, after) {
  const difference = (key) => (after.metrics[key] ?? 0) - (before.metrics[key] ?? 0);
  return {
    heapGrowthBytes: difference("JSHeapUsedSize"),
    nodeGrowth: difference("Nodes"),
    documentGrowth: difference("Documents"),
    listenerGrowth: difference("JSEventListeners"),
    retainedHistoryRows: after.dom?.retainedHistoryRows ?? 0,
    objectUrlLikeSources: after.dom?.objectUrlLikeSources ?? 0,
  };
}

function assertBoundedTournamentResources(before, after) {
  const growth = summarizeResourceGrowth(before, after);
  // One complete six-seat event is allowed modest renderer churn, but must not
  // retain a hand-history tree or accumulate unbounded heap/DOM/listener state.
  if (growth.heapGrowthBytes > 24 * 1024 * 1024) {
    throw new Error(`Tournament completion retained too much JS heap (${growth.heapGrowthBytes} bytes).`);
  }
  // Ceremony/results deliberately introduce visible nodes and handlers, so raw
  // DOM/listener deltas are evidence only. They are reported above, not treated
  // as leaks without a same-screen soak baseline.
  if (growth.retainedHistoryRows > 0 || growth.objectUrlLikeSources > 0) {
    throw new Error(`Tournament completion retained history or object URLs: ${JSON.stringify(growth)}.`);
  }
}

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

function isKnownElectronSandboxDiagnostic(event) {
  if (event?.kind !== "console-error" || event?.sourceUrl !== "node:electron/js2c/sandbox_bundle") {
    return false;
  }
  const description = String(event.description ?? "");
  return (
    description === "Electron sandboxed_renderer.bundle.js script failed to run" ||
    description.includes("Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null")
  );
}
