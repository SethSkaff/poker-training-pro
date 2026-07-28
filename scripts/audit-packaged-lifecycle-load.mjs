/**
 * Packaged verification of window lifecycle and behaviour under CPU load
 * (E25-003).
 *
 * The release criterion asks for verification under "normal and heavy CPU load,
 * all supported resolutions, all UI scales, reduced motion, window blur,
 * minimize, suspend/resume, and screen lock where possible". Resolutions and
 * interface scales are covered by the packaged input smoke and reduced motion
 * by the presentation audit; this covers blur, minimize, restore, and load.
 *
 * **Suspend/resume and screen lock are deliberately not covered here.** They
 * need machine states a headless run cannot enter without disrupting the
 * machine it is running on, and they stay listed under E26-001 as deferred
 * hardware acceptance. Saying so in the report is the point: a gate that
 * quietly skipped them would read as coverage.
 *
 * Minimize and restore are driven through **real Win32 `ShowWindow` calls on
 * the app's own window handle**, not CDP emulation. `Emulation.setFocus...`
 * and friends tell the renderer a story about its visibility; they do not
 * exercise Chromium's actual background throttling, which is the behaviour the
 * power requirement depends on and the behaviour that can regress. If the
 * window handle cannot be found the audit records that it could not measure,
 * rather than substituting the weaker signal and calling it the same thing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { basename, resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";
import {
  PackagedSession,
  argumentValue,
  delay,
  isKnownElectronSandboxDiagnostic,
} from "./lib/packaged-cdp-session.mjs";

const PROFILE_PREFIX = "poker-training-pro-lifecycle-load-";
const SW_MINIMIZE = 6;
const SW_RESTORE = 9;
// Long enough for Chromium's background throttling to take hold; it does not
// clamp the very first frames after a visibility change.
const HIDDEN_OBSERVATION_MS = 2_500;
const VISIBLE_OBSERVATION_MS = 1_500;

const appPath = resolve(
  projectRoot,
  argumentValue("--app") ??
    "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const reportPath = resolve(
  projectRoot,
  "work",
  "packaged-lifecycle-load.json",
);
const timeoutMs = Number(argumentValue("--timeout-ms") ?? 240_000);

if (process.platform !== "win32") {
  throw new Error("Packaged lifecycle/load audit requires Windows.");
}
if (!existsSync(appPath)) {
  throw new Error(`Packaged executable not found: ${appPath}`);
}

let failure;
let transportTimeout;
let session;
let loadWorkers = [];
const findings = [];
const results = {};
let frameworkDiagnostics = [];

try {
  session = await PackagedSession.launch({
    appPath,
    profilePrefix: PROFILE_PREFIX,
    timeoutMs,
    // The one audit that must show its window. Every other packaged audit runs
    // with `windowsHide: true`, and a window that was never shown has no handle
    // to minimize -- the first run of this audit reported exactly that and
    // measured nothing.
    windowsHide: false,
  });
  await session.reachHome();
  await reachLiveTable(session);

  results.baseline = await observeRenderer(session, VISIBLE_OBSERVATION_MS);
  results.window = await auditMinimizeAndRestore(session);
  results.load = await auditUnderCpuLoad(session);

  findings.push(
    ...collectWindowFindings(results),
    ...collectLoadFindings(results),
  );

  const fatal = session.cdp.takeFatalEvents();
  frameworkDiagnostics = fatal.filter(isKnownElectronSandboxDiagnostic);
  const applicationErrors = fatal.filter(
    (event) => !isKnownElectronSandboxDiagnostic(event),
  );
  if (applicationErrors.length > 0) {
    throw new Error(
      `renderer emitted fatal CDP events: ${JSON.stringify(applicationErrors)}`,
    );
  }

  const blocking = findings.filter((finding) => finding.blocking);
  if (blocking.length > 0) {
    failure = blocking.map((finding) => finding.detail).join(" | ");
  }
} catch (error) {
  const classified = classifyCdpFailure(error);
  if (classified.transportTimeout) {
    transportTimeout = classified.transportTimeout;
  } else {
    failure = classified.failure;
  }
} finally {
  stopLoadWorkers(loadWorkers);
  if (session) await session.dispose();
}

const report = reportCdpOutcome(
  {
    schemaVersion: 1,
    executable: basename(appPath),
    scope:
      "Packaged window-lifecycle and CPU-load verification at a live table: real Win32 minimize/restore (not CDP emulation), background render throttling while hidden, simulation freeze while hidden, recovery on restore, and renderer responsiveness under saturated CPU. Suspend/resume and screen lock are NOT covered -- they require machine states this run cannot enter and remain deferred under E26-001.",
    notCovered: ["suspend/resume", "screen lock"],
    hostCores: cpus().length,
    ...results,
    findings,
    ...(frameworkDiagnostics.length > 0 ? { frameworkDiagnostics } : {}),
  },
  { failure, transportTimeout },
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

async function reachLiveTable(activeSession) {
  await activeSession.clickSelector('button[aria-label="Play"]', "play button");
  await activeSession.clickIfPresent(
    "#play-chip-ack-title ~ .startup-gate__actions button",
  );
  await activeSession.waitFor(".mode-stage", "mode selection");
  await activeSession.clickSelector(
    ".mode-stage__choice--normal",
    "Normal mode",
  );
  await activeSession.waitForButton("Enter event", "career event lobby");
  await activeSession.clickButton("Enter event");
  await activeSession.waitFor(".room-flight", "championship arrival");
  await activeSession.clickButton("Skip arrival");
  await activeSession.waitFor(".poker-table", "live table");
  // Let the first hand get under way so there is a live simulation to freeze.
  await delay(1_200);
}

/**
 * Count animation frames over a window, and take a coarse signature of the
 * hand, so "did rendering stop" and "did the game stop" can be told apart.
 */
async function observeRenderer(activeSession, durationMs) {
  const started = Date.now();
  const observed = await activeSession.evaluate(`(async () => {
    /*
      A coarse fingerprint of where the hand has got to. Every field is read
      from a real rendered element -- the first version of this guessed at a
      pot selector, matched nothing, and reported a constant empty string that
      would have made the freeze check pass no matter what the game did.
    */
    const signature = () => ({
      pot: (document.querySelector('.center-pot')?.textContent || '').trim().slice(0, 40),
      sidePots: document.querySelectorAll('.side-pot-strip').length,
      community: document.querySelectorAll('.community-cards .playing-card').length,
      placeholders: document.querySelectorAll('.community-placeholder').length,
      folded: document.querySelectorAll('.player-seat.is-folded').length,
      acting: document.querySelectorAll('.player-seat.is-acting, .player-seat.is-active').length,
      bets: [...document.querySelectorAll('.seat-bet')].map((element) => (element.textContent || '').trim()).join('|').slice(0, 80),
      seats: document.querySelectorAll('.player-seat').length,
    });
    const before = signature();
    let frames = 0;
    const tick = () => { frames += 1; requestAnimationFrame(tick); };
    const handle = requestAnimationFrame(tick);
    const startedAt = performance.now();
    await new Promise((done) => setTimeout(done, ${durationMs}));
    cancelAnimationFrame(handle);
    const elapsed = performance.now() - startedAt;
    return {
      frames,
      elapsedMs: Math.round(elapsed),
      fps: Number((frames / (elapsed / 1000)).toFixed(2)),
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      before,
      after: signature(),
    };
  })()`);
  return { ...observed, wallClockMs: Date.now() - started };
}

/**
 * Minimize the real window, observe, restore, observe again.
 */
async function auditMinimizeAndRestore(activeSession) {
  const handle = await findMainWindowHandle(activeSession.pid);
  if (!handle || handle === "0") {
    return {
      measured: false,
      note: "The app's main window handle could not be read, so real minimize/restore was not exercised. No emulated substitute was used.",
    };
  }

  await showWindow(handle, SW_MINIMIZE);
  // Chromium does not throttle the first frames after a visibility change.
  await delay(700);
  const hidden = await observeRenderer(activeSession, HIDDEN_OBSERVATION_MS);

  await showWindow(handle, SW_RESTORE);
  await delay(800);
  const restored = await observeRenderer(activeSession, VISIBLE_OBSERVATION_MS);

  const screenStillUp = await activeSession.evaluate(
    "document.querySelector('.poker-table') !== null",
  );
  return { measured: true, handle, hidden, restored, screenStillUp };
}

/**
 * Saturate the CPU and check the renderer still answers and still paints.
 *
 * The bar is responsiveness, not throughput: a machine with every core busy is
 * allowed to render fewer frames. A renderer that stops answering entirely, or
 * that drops to a slideshow, is the regression worth catching.
 */
async function auditUnderCpuLoad(activeSession) {
  const workers = Math.max(1, cpus().length - 1);
  loadWorkers = startLoadWorkers(workers);
  try {
    // Let the scheduler settle under contention before measuring.
    await delay(1_500);
    const roundTrips = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = Date.now();
      await activeSession.evaluate("1 + 1");
      roundTrips.push(Date.now() - started);
      await delay(120);
    }
    const underLoad = await observeRenderer(activeSession, VISIBLE_OBSERVATION_MS);
    return {
      measured: true,
      workers,
      roundTripMs: roundTrips,
      worstRoundTripMs: Math.max(...roundTrips),
      underLoad,
    };
  } finally {
    stopLoadWorkers(loadWorkers);
    loadWorkers = [];
    await delay(600);
  }
}

function startLoadWorkers(count) {
  const started = [];
  for (let index = 0; index < count; index += 1) {
    // A tight arithmetic loop with no allocation: it burns a core without
    // creating memory pressure that would confound the renderer measurement.
    const child = spawn(
      process.execPath,
      ["-e", "let x = 0; for (;;) { x = (x + Math.sqrt(x + 1)) % 1e9; }"],
      { stdio: "ignore", windowsHide: true, detached: false },
    );
    started.push(child);
  }
  return started;
}

function stopLoadWorkers(workers) {
  for (const worker of workers ?? []) {
    try {
      worker.kill("SIGKILL");
    } catch {
      /* the process may already be gone */
    }
  }
}

/**
 * Read the app's main window handle via PowerShell.
 *
 * Electron spawns helper processes, so the handle is taken from the process
 * tree rooted at the launched EXE rather than from whichever process happens
 * to answer first.
 */
async function findMainWindowHandle(pid) {
  const script = pid
    ? `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.MainWindowHandle.ToString() } else { '0' }`
    : `$p = Get-Process -Name 'Poker Training Pro' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $p.MainWindowHandle.ToString() } else { '0' }`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const handle = (await runPowerShell(script)).trim();
    if (handle && handle !== "0") return handle;
    await delay(400);
  }
  return null;
}

async function showWindow(handle, command) {
  await runPowerShell(`
    Add-Type -Namespace PokerAudit -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
    [PokerAudit.Win32]::ShowWindow([IntPtr]${handle}, ${command}) | Out-Null
  `);
}

function runPowerShell(script) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`PowerShell exited ${code}: ${stderr.trim()}`));
    });
  });
}

function collectWindowFindings(observed) {
  const window = observed.window;
  if (!window?.measured) {
    return [
      {
        area: "window-lifecycle",
        blocking: false,
        detail: window?.note ?? "Window lifecycle was not measured.",
      },
    ];
  }
  const results = [];
  const baselineFps = observed.baseline?.fps ?? 0;

  // Electron's CDP target can retain `visibilityState === "visible"` after a
  // real Win32 minimize even while Chromium demonstrably applies background
  // throttling. The lifecycle signal used by the application is the main
  // process minimize event, not this debugger-only DOM hint. Treat the hint as
  // diagnostic and gate the measured behaviour below: low frame rate and a
  // frozen public hand signature.
  if (window.hidden.visibilityState !== "hidden") {
    results.push({
      area: "window-lifecycle",
      blocking: false,
      detail: `CDP retained document.visibilityState="${window.hidden.visibilityState}" after the real minimize; frame throttling and simulation freeze remain the authoritative measurements.`,
    });
  }
  // Chromium throttles background rAF to roughly 1 fps. Allowing a quarter of
  // the visible rate leaves generous headroom while still failing a renderer
  // that keeps painting at full speed behind a minimized window.
  if (baselineFps > 0 && window.hidden.fps > baselineFps * 0.25) {
    results.push({
      area: "window-lifecycle",
      blocking: true,
      detail: `While minimized the renderer kept painting at ${window.hidden.fps} fps against a visible baseline of ${baselineFps} fps, so hidden-window rendering is not being throttled.`,
    });
  }
  if (
    JSON.stringify(window.hidden.before) !== JSON.stringify(window.hidden.after)
  ) {
    results.push({
      area: "window-lifecycle",
      blocking: true,
      detail: `The hand advanced while the window was minimized: ${JSON.stringify(window.hidden.before)} became ${JSON.stringify(window.hidden.after)}. Play is meant to freeze while the player is away.`,
    });
  }
  if (window.restored.visibilityState !== "visible") {
    results.push({
      area: "window-lifecycle",
      blocking: true,
      detail: `After restore document.visibilityState was "${window.restored.visibilityState}".`,
    });
  }
  if (baselineFps > 0 && window.restored.fps < baselineFps * 0.5) {
    results.push({
      area: "window-lifecycle",
      blocking: true,
      detail: `Rendering did not recover after restore: ${window.restored.fps} fps against a baseline of ${baselineFps} fps.`,
    });
  }
  if (!window.screenStillUp) {
    results.push({
      area: "window-lifecycle",
      blocking: true,
      detail: "The table was gone after minimize and restore.",
    });
  }
  return results;
}

function collectLoadFindings(observed) {
  const load = observed.load;
  if (!load?.measured) return [];
  const results = [];
  // The renderer is allowed to be slow with every core contended; it is not
  // allowed to stop answering.
  if (load.worstRoundTripMs > 5_000) {
    results.push({
      area: "cpu-load",
      blocking: true,
      detail: `With ${load.workers} cores saturated the renderer took ${load.worstRoundTripMs}ms to answer a trivial evaluation.`,
    });
  }
  if (load.underLoad.fps < 5) {
    results.push({
      area: "cpu-load",
      blocking: true,
      detail: `With ${load.workers} cores saturated the table rendered at ${load.underLoad.fps} fps, which is below the point where play is followable.`,
    });
  }
  if (load.underLoad.visibilityState !== "visible") {
    results.push({
      area: "cpu-load",
      blocking: false,
      detail: `The window lost visibility during the load run (${load.underLoad.visibilityState}); the frame-rate figure is not comparable.`,
    });
  }
  return results;
}
