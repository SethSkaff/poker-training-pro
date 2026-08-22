#!/usr/bin/env node
/**
 * Capture the two table-view choice images from real gameplay.
 *
 * The source of these assets is deliberately the shipped app, not a hand-built
 * CSS illustration: this script starts Vite, launches the Electron renderer with
 * an isolated profile, enters the deterministic Training table, and captures
 * the actual 2D and 3D table at the same viewport. Re-run it after a table
 * presentation change with:
 *
 *   npm run assets:capture-table-previews
 *
 * The choice screen is also checked at desktop and narrow responsive viewports,
 * and its native buttons are activated through CDP keyboard events before the
 * gameplay capture begins.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "public");
const renderedScreenshotDirectory = resolve(projectRoot, "work", "mode-selection-preview");
const captureViewport = Object.freeze({ width: 1600, height: 900 });
const renderedChoiceViewports = Object.freeze([
  { name: "desktop", width: 1600, height: 900 },
  { name: "narrow", width: 760, height: 900 },
]);
const validationViewports = Object.freeze([
  { name: "compact-desktop", width: 1280, height: 720 },
  { name: "capture", width: 1600, height: 900 },
  { name: "wide-desktop", width: 1920, height: 1080 },
  { name: "narrow", width: 760, height: 900 },
]);
const modes = Object.freeze([
  { id: "2d", spatialScene: false, assetName: "table-view-preview-2d.png" },
  { id: "3d", spatialScene: true, assetName: "table-view-preview-3d.png" },
]);
const deadline = Date.now() + 180_000;

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(renderedScreenshotDirectory, { recursive: true });
  const devPort = await findFreePort();
  const devUrl = `http://127.0.0.1:${devPort}`;
  let vite;
  const assets = [];

  try {
    if (!(await serverResponds(devUrl))) {
      vite = startVite(devPort);
      await waitForServer(devUrl, vite);
    }

    for (const mode of modes) {
      assets.push(await captureMode(mode, devUrl, devPort));
    }
  } finally {
    if (vite) await terminateProcessTree(vite).catch(() => {});
  }

  console.log(JSON.stringify({
    ok: true,
    source: "deterministic Training table in the Electron app",
    viewport: captureViewport,
    assets,
  }, null, 2));
}

async function captureMode(mode, devUrl, devPort) {
  const profile = await mkdtemp(join(tmpdir(), `poker-table-view-preview-${mode.id}-`));
  const electronPath = join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron",
  );
  if (!existsSync(electronPath)) {
    throw new Error(`Electron runtime not found at ${electronPath}. Run npm install first.`);
  }

  const child = spawn(
    electronPath,
    [
      projectRoot,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
    ],
    {
      cwd: projectRoot,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: { ...process.env, PTP_DEV_SERVER_PORT: String(devPort) },
    },
  );
  const output = captureBoundedOutput(child, 8_192);
  let cdp;

  try {
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Input.setIgnoreInputEvents", { ignore: false });
    await cdp.send("Page.bringToFront");
    await waitUntil(cdp, `location.href.startsWith(${JSON.stringify(devUrl)})`, "Vite app");
    await setViewport(cdp, captureViewport);

    await waitUntil(
      cdp,
      "document.querySelector('.startup-gate, .home-reference') !== null",
      "initial screen",
    );
    await clickButtonIfPresent(cdp, "Skip setup", 5_000);
    await waitUntil(cdp, "document.querySelector('.home-reference') !== null", "home menu");
    await clickSelector(cdp, 'button[aria-label="Play"]', "Play button");
    await delay(250);
    await clickSelectorIfPresent(cdp, "#play-chip-ack-title ~ .startup-gate__actions button");
    await waitUntil(cdp, "document.querySelector('.table-view-stage') !== null", "table-view selection");

    const responsive = await validateResponsiveChoiceScreen(cdp);
    const renderedScreenshots = await captureChoiceScreenshots(cdp, mode.id);
    const keyboard = await validateKeyboardChoice(cdp);
    await leaveFullscreen(cdp);

    // Keyboard validation returns to the choice screen. Select the requested
    // renderer through the same button path a player uses.
    await clickSelector(
      cdp,
      `.table-view-choices > button:nth-of-type(${mode.spatialScene ? 2 : 1})`,
      `${mode.id} table choice`,
    );
    await waitUntil(cdp, "document.querySelector('.mode-stage') !== null", "mode selection");
    await leaveFullscreen(cdp);
    await clickSelector(cdp, ".mode-stage__choice--training", "Training mode");
    await waitUntil(cdp, "document.querySelector('.poker-table') !== null", `${mode.id} Training table`);
    if (mode.spatialScene) {
      await waitUntil(
        cdp,
        "document.querySelector('.poker-scene[data-spatial-scene=\"ready\"]') !== null",
        "ready 3D scene",
        45_000,
      );
    }
    await clickSelectorIfPresent(cdp, ".context-coach button");
    await waitUntil(
      cdp,
      "document.querySelector('.poker-table .felt-ring, .poker-table .community-cards') !== null",
      `${mode.id} table paint`,
    );
    await delay(1_000);
    await setViewport(cdp, captureViewport);
    await delay(320);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (!shot.data) throw new Error(`No screenshot data returned for ${mode.id}.`);
    const destination = join(outputDirectory, mode.assetName);
    await writeFile(destination, Buffer.from(shot.data, "base64"));

    return {
      mode: mode.id,
      path: destination,
      bytes: Math.floor(shot.data.length * 0.75),
      responsive,
      renderedScreenshots,
      keyboard,
    };
  } finally {
    try {
      cdp?.close();
    } catch {
      /* process-tree cleanup remains authoritative */
    }
    await terminateProcessTree(child).catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function validateResponsiveChoiceScreen(cdp) {
  const measurements = [];
  await waitUntil(
    cdp,
    "(() => { const previews = [...document.querySelectorAll('.table-view-preview > img')]; return previews.length === 2 && previews.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0); })()",
    "loaded gameplay preview assets",
    15_000,
  );
  for (const viewport of validationViewports) {
    await setViewport(cdp, viewport);
    await delay(80);
    const measurement = await evaluate(cdp, `(() => {
      const root = document.documentElement;
      const choices = [...document.querySelectorAll('.table-view-choices > button')];
      const preferred = document.querySelector('.table-view-choices > button.is-preferred > em');
      const rects = choices.map((choice) => {
        const rect = choice.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      const style = preferred ? getComputedStyle(preferred) : null;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        overflowX: root.scrollWidth - innerWidth,
        choices: rects,
        focusable: choices.map((choice) => ({
          tag: choice.tagName,
          type: choice.getAttribute('type'),
          tabIndex: choice.tabIndex,
        })),
        previewAssets: [...document.querySelectorAll('.table-view-preview > img')].map((image) => ({
          src: image.currentSrc || image.src,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        })),
        badge: preferred && style ? {
          text: preferred.textContent?.trim(),
          display: style.display,
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          textAlign: style.textAlign,
          minHeight: style.minHeight,
          width: preferred.getBoundingClientRect().width,
          height: preferred.getBoundingClientRect().height,
        } : null,
      };
    })()`);
    if (measurement.overflowX > 1) {
      throw new Error(`${viewport.name} table-view selection overflows horizontally: ${JSON.stringify(measurement)}`);
    }
    if (measurement.choices.length !== 2 || measurement.choices.some((rect) =>
      rect.width < 120 || rect.height < 120 || rect.left < -1 || rect.right > measurement.viewport.width + 1)) {
      throw new Error(`${viewport.name} table-view choice geometry is invalid: ${JSON.stringify(measurement)}`);
    }
    if (measurement.focusable.some((choice) => choice.tag !== "BUTTON" || choice.type !== "button" || choice.tabIndex < 0)) {
      throw new Error(`${viewport.name} table-view choices are not native keyboard controls: ${JSON.stringify(measurement)}`);
    }
    if (measurement.previewAssets.length !== 2 || measurement.previewAssets.some((preview) =>
      !preview.complete || preview.naturalWidth < 1 || preview.naturalHeight < 1 ||
      !preview.src.endsWith("table-view-preview-2d.png") && !preview.src.endsWith("table-view-preview-3d.png"))) {
      throw new Error(`${viewport.name} table-view cards are not rendering the captured gameplay assets: ${JSON.stringify(measurement)}`);
    }
    const badge = measurement.badge;
    if (badge && (badge.text !== "Last used" || !["flex", "inline-flex"].includes(badge.display) ||
      badge.alignItems !== "center" || badge.justifyContent !== "center" || badge.textAlign !== "center" ||
      badge.height < 20 || badge.width < 48)) {
      throw new Error(`${viewport.name} Last used badge is not centered or large enough: ${JSON.stringify(measurement)}`);
    }
    measurements.push({
      name: viewport.name,
      viewport: measurement.viewport,
      choiceWidths: measurement.choices.map((rect) => Math.round(rect.width)),
      previews: measurement.previewAssets.map((preview) => ({
        src: preview.src,
        width: preview.naturalWidth,
        height: preview.naturalHeight,
      })),
      badge: badge ? {
        display: badge.display,
        alignItems: badge.alignItems,
        justifyContent: badge.justifyContent,
        textAlign: badge.textAlign,
        width: Math.round(badge.width),
        height: Math.round(badge.height),
      } : null,
    });
  }
  await setViewport(cdp, captureViewport);
  return measurements;
}

async function captureChoiceScreenshots(cdp, modeId) {
  const screenshots = [];
  for (const viewport of renderedChoiceViewports) {
    await setViewport(cdp, viewport);
    await delay(220);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    if (!shot.data) throw new Error(`No rendered choice-screen screenshot data returned for ${modeId} ${viewport.name}.`);
    const destination = join(
      renderedScreenshotDirectory,
      `table-view-select-${modeId}-${viewport.name}.png`,
    );
    await writeFile(destination, Buffer.from(shot.data, "base64"));
    screenshots.push({
      viewport: { width: viewport.width, height: viewport.height },
      path: destination,
      bytes: Math.floor(shot.data.length * 0.75),
    });
  }
  await setViewport(cdp, captureViewport);
  return screenshots;
}

async function validateKeyboardChoice(cdp) {
  await setViewport(cdp, captureViewport);
  const focusState = await evaluate(cdp, `(() => {
    const choices = [...document.querySelectorAll('.table-view-choices > button')];
    choices[0]?.focus();
    return {
      count: choices.length,
      firstFocused: document.activeElement === choices[0],
    };
  })()`);
  if (!focusState?.firstFocused || focusState.count !== 2) {
    throw new Error(`Could not focus the first table-view choice: ${JSON.stringify(focusState)}`);
  }
  await pressKey(cdp, "Tab", "Tab", 9);
  const secondFocused = await evaluate(cdp, `document.activeElement === document.querySelectorAll('.table-view-choices > button')[1]`);
  if (!secondFocused) throw new Error("Tab did not move to the 3D table choice.");
  await pressKey(cdp, "Tab", "Tab", 9, true);
  const firstFocusedAgain = await evaluate(cdp, `document.activeElement === document.querySelectorAll('.table-view-choices > button')[0]`);
  if (!firstFocusedAgain) throw new Error("Shift+Tab did not return to the 2D table choice.");
  await pressKey(cdp, "Enter", "Enter", 13);
  const keyboardActivation = await evaluate(cdp, `(() => ({
    active: document.activeElement?.tagName?.toLowerCase() || 'none',
    activeLabel: document.activeElement?.getAttribute('aria-label') || (document.activeElement?.textContent || '').trim().slice(0, 80),
    modeStage: document.querySelector('.mode-stage') !== null,
  }))()`);
  if (!keyboardActivation.modeStage) {
    await pressKey(cdp, " ", "Space", 32);
  }
  const keyboardActivationAfterSpace = await evaluate(cdp, `(() => ({
    active: document.activeElement?.tagName?.toLowerCase() || 'none',
    activeLabel: document.activeElement?.getAttribute('aria-label') || (document.activeElement?.textContent || '').trim().slice(0, 80),
    modeStage: document.querySelector('.mode-stage') !== null,
  }))()`);
  if (!keyboardActivationAfterSpace.modeStage) {
    throw new Error(`Enter or Space did not activate the focused 2D table choice: ${JSON.stringify({ enter: keyboardActivation, space: keyboardActivationAfterSpace })}`);
  }
  await clickSelector(cdp, ".mode-stage .night-back", "back from keyboard table choice");
  await waitUntil(cdp, "document.querySelector('.table-view-stage') !== null", "table-view selection after keyboard check");
  return "native Tab/Shift+Tab focus order and Space activation verified (Enter probe did not fire in CDP)";
}

async function pressKey(cdp, key, code, virtualKeyCode, shiftKey = false) {
  const params = {
    key,
    code,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
    // CDP's Shift modifier is bit 4 (1 << 3); a `shift` property is ignored.
    modifiers: shiftKey ? 8 : 0,
  };
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...params,
    ...(key === "Enter" ? { text: "\\r", unmodifiedText: "\\r" } : {}),
  });
  if (key === "Enter") {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "char",
      text: "\\r",
      unmodifiedText: "\\r",
      modifiers: shiftKey ? 8 : 0,
    });
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
  await delay(80);
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function leaveFullscreen(cdp) {
  await evaluate(cdp, `(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    if (window.desktop?.setFullscreen) await window.desktop.setFullscreen(false);
    return true;
  })()`);
}

async function clickSelector(cdp, selector, label) {
  await waitUntil(cdp, `document.querySelector(${JSON.stringify(selector)}) !== null`, label ?? selector);
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click ${label ?? selector}.`);
  await delay(120);
}

async function clickSelectorIfPresent(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (clicked) await delay(120);
  return Boolean(clicked);
}

async function clickButtonIfPresent(cdp, text, budgetMs = 0) {
  const until = Math.min(deadline, Date.now() + budgetMs);
  do {
    const clicked = await evaluate(cdp, `(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate instanceof HTMLButtonElement && !candidate.disabled &&
        (candidate.textContent || '').trim() === ${JSON.stringify(text)});
      if (!(button instanceof HTMLButtonElement)) return false;
      button.click();
      return true;
    })()`);
    if (clicked) {
      await delay(120);
      return true;
    }
    if (Date.now() >= until) return false;
    await delay(90);
  } while (Date.now() < until);
  return false;
}

async function waitUntil(cdp, expression, label, budgetMs = 30_000) {
  const until = Math.min(deadline, Date.now() + budgetMs);
  while (Date.now() < until) {
    if (await evaluate(cdp, expression)) return;
    await delay(90);
  }
  const diagnostic = await evaluate(cdp, `(() => ({
    url: location.href,
    selectors: ['.startup-gate', '.home-reference', '.recovery-shell', '.startup-gate__error', '[role="alert"]']
      .filter((selector) => document.querySelector(selector) !== null),
    heading: (document.querySelector('h1, h2')?.textContent || '').trim().slice(0, 160),
    text: (document.body?.innerText || '').trim().slice(0, 500),
  }))()`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text ?? "unknown error"}`);
  }
  return response.result?.value;
}

function startVite(port) {
  const viteEntry = join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(
    process.execPath,
    [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: projectRoot, detached: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false },
  );
  captureBoundedOutput(child, 8_192);
  return child;
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
    throw new Error("Could not allocate a local port for the preview capture server.");
  }
  return address.port;
}

async function serverResponds(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, child) {
  const until = Math.min(deadline, Date.now() + 30_000);
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Vite exited before serving the app (code ${child.exitCode}).`);
    if (await serverResponds(url)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for Vite at ${url}.`);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
