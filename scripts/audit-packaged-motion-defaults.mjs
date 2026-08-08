import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import { projectRoot } from "./release/shared.mjs";

const appPath = resolve(projectRoot, "outputs/next/win-unpacked/Poker Training Pro.exe");
const timeoutMs = 45_000;

const settings = {
  masterVolume: 100, muted: false, musicVolume: 35, effectsVolume: 70, fullscreen: false,
  reducedMotion: false, reducedMotionExplicit: false, dealSpeed: "standard", colorAssist: false,
  cameraSensitivity: "standard", cameraView: "standard", autoCameraMovement: true,
  menuMotion: "full", roomMotion: "full", cameraMotion: "full", tableMotion: "full",
  transitionMotion: "full", interfaceScale: "standard", spatialScene: false,
};
const progress = {
  onboardingCompleted: true, playChipsAcknowledged: true, playerName: "Motion QA",
  decisionElo: 1000, mathElo: 1000, tournamentElo: 1000, trainingCompleted: 0,
  currentStreak: 0, bestStreak: 0, totalDecisionMs: 0, results: [], unlockedCircuit: 1,
  career: { normal: { results: [] }, rational: { results: [] } },
  reviewTotals: { roundsReviewed: 0, decisions: 0, bestDecisions: 0, totalRegretBigBlinds: 0 },
};

async function launch(profile, extraArguments = []) {
  const child = spawn(appPath, [
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run", ...extraArguments,
  ], { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
  const output = captureBoundedOutput(child, 8_192);
  const deadline = Date.now() + timeoutMs;
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await cdp.send("Runtime.enable");
  return { child, cdp };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Packaged motion probe failed.");
  return result.result?.value;
}

async function poll(cdp, expression) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  }
  return false;
}

async function readMotion(cdp) {
  await poll(cdp, "document.documentElement?.dataset.motionMenu !== undefined");
  return evaluate(cdp, `(() => ({
    mediaReduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    reducedClass: document.documentElement.classList.contains('reduced-motion'),
    datasets: Object.fromEntries(Object.entries(document.documentElement.dataset).filter(([key]) => key.startsWith('motion'))),
  }))()`);
}

async function close(child) {
  try { await terminateProcessTree(child); } catch { /* report below */ }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
}

async function run() {
  const results = [];
  const freshOff = await mkdtemp(join(tmpdir(), "poker-motion-fresh-off-"));
  const freshOn = await mkdtemp(join(tmpdir(), "poker-motion-fresh-on-"));
  const saved = await mkdtemp(join(tmpdir(), "poker-motion-saved-"));
  const reset = await mkdtemp(join(tmpdir(), "poker-motion-reset-"));
  try {
    for (const [name, profile, args, expected] of [
      ["fresh-os-off", freshOff, [], { mediaReduced: false, reducedClass: false, dataset: "full" }],
      ["fresh-os-on", freshOn, ["--force-prefers-reduced-motion"], { mediaReduced: true, reducedClass: true, dataset: "off" }],
    ]) {
      const session = await launch(profile, args);
      try {
        const observed = await readMotion(session.cdp);
        if (observed.mediaReduced !== expected.mediaReduced || observed.reducedClass !== expected.reducedClass
          || Object.values(observed.datasets).some((value) => value !== expected.dataset)) throw new Error(`${name} did not resolve the expected motion profile: ${JSON.stringify(observed)}`);
        results.push({ name, observed });
      } finally { await close(session.child); }
    }
    const savedPayload = { ...settings, reducedMotion: true, reducedMotionExplicit: true };
    const savedSession = await launch(saved);
    try {
    await evaluate(savedSession.cdp, `(() => {
      const value = ${JSON.stringify(savedPayload)};
      localStorage.setItem('poker-training-pro:settings', JSON.stringify(value));
      return window.desktop?.commitAutosave?.(JSON.stringify({ format: 'poker-training-pro-save', version: 1, data: { settings: value, progress: ${JSON.stringify(progress)} } }), 'settings');
    })()`);
      await evaluate(savedSession.cdp, "location.reload(); true");
      const observed = await readMotion(savedSession.cdp);
      if (!observed.reducedClass || Object.values(observed.datasets).some((value) => value !== "off")) throw new Error(`saved-disabled did not survive launch: ${JSON.stringify(observed)}`);
      results.push({ name: "saved-disabled", observed });
    } finally { await close(savedSession.child); }

    const resetSession = await launch(reset);
    try {
    await evaluate(resetSession.cdp, `(() => {
      const value = ${JSON.stringify(savedPayload)};
      localStorage.setItem('poker-training-pro:settings', JSON.stringify(value));
      return window.desktop?.commitAutosave?.(JSON.stringify({ format: 'poker-training-pro-save', version: 1, data: { settings: value, progress: ${JSON.stringify(progress)} } }), 'settings');
    })()`);
      await evaluate(resetSession.cdp, "location.reload(); true");
      await poll(resetSession.cdp, "document.querySelector('button[aria-label=\\\"Settings\\\"]') !== null");
      await evaluate(resetSession.cdp, "document.querySelector('button[aria-label=\\\"Settings\\\"]')?.click(); true");
      await poll(resetSession.cdp, "document.querySelector('.night-reset') !== null");
      const resetButton = await evaluate(resetSession.cdp, `(() => {
        const button = document.querySelector('button.night-reset');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { text: button.textContent, disabled: button.disabled, visible: !!(button.offsetWidth || button.offsetHeight), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (!resetButton || resetButton.disabled || !resetButton.visible) throw new Error(`reset control was not actionable: ${JSON.stringify(resetButton)}`);
      await evaluate(resetSession.cdp, `(() => {
        const button = document.querySelector('button.night-reset');
        if (button) setTimeout(() => button.click(), 0);
        return true;
      })()`);
      if (!await poll(resetSession.cdp, "!document.documentElement.classList.contains('reduced-motion')")) {
        throw new Error(`reset click did not update the rendered motion state: ${JSON.stringify(await readMotion(resetSession.cdp))}`);
      }
      const observed = await readMotion(resetSession.cdp);
      if (observed.reducedClass || Object.values(observed.datasets).some((value) => value !== "full")) throw new Error(`reset did not return to full motion: ${JSON.stringify(observed)}`);
      results.push({ name: "reset-os-off", observed });
    } finally { await close(resetSession.child); }
    const reportPath = resolve(projectRoot, "work", "packaged-motion-defaults.json");
    await mkdir(resolve(projectRoot, "work"), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({ schemaVersion: 1, appPath, results }, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ok: true, reportPath, results }, null, 2));
  } finally {
    for (const profile of [freshOff, freshOn, saved, reset]) {
      try { await rm(profile, { recursive: true, force: true }); } catch { /* Electron's WAL may outlive its process by one tick. */ }
    }
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
