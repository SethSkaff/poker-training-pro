import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import {
  ASSET_FAULT_PROFILE_PREFIX,
  assertNoUnexpectedRendererEvents,
  removeValidatedAssetFaultProfile,
  validateAudioDeviceLossObservation,
  validateFontFallbackObservation,
  validateRoomFallbackObservation,
  validateSlowDiskObservation,
  validateStartMenuFallbackObservation,
} from "./release/packaged-asset-fault-smoke-lib.mjs";
import { RenderSmokeFailure } from "./release/packaged-render-smoke-lib.mjs";
import { canonicalJson } from "./release/runtime-performance-profile-lib.mjs";
import { projectRoot } from "./release/shared.mjs";
import { isCdpTransportTimeout } from "./lib/cdp-outcome.mjs";

const DEFAULT_APP = join(
  projectRoot,
  "outputs",
  "desktop",
  "win-unpacked",
  "Poker Training Pro.exe",
);
const DEFAULT_EVIDENCE = join(
  projectRoot,
  "work",
  "packaged-asset-fault-smoke.json",
);
const DEFAULT_TIMEOUT_MS = 45_000;
const FRESHNESS_INPUTS = Object.freeze([
  "dist/index.html",
  "src/App.tsx",
  "src/components/Dashboard.tsx",
  "src/components/RoomFlythrough.tsx",
  "src/lib/useResilientAsset.ts",
  "src/styles.css",
]);

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  throw new Error(
    `Packaged asset-fault smoke requires Node.js 22 or newer; current runtime is ${process.versions.node}.`,
  );
}

export async function runPackagedAssetFaultSmoke(options = {}) {
  const appPath = resolve(options.appPath ?? DEFAULT_APP);
  const evidencePath = resolve(options.evidencePath ?? DEFAULT_EVIDENCE);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    5_000,
    120_000,
  );
  await access(appPath);
  const appAsarPath = join(dirname(appPath), "resources", "app.asar");
  await access(appAsarPath);
  const packageHashBefore = await sha256File(appAsarPath);
  const packageFreshness = await inspectPackageFreshness(appAsarPath);

  const profile = await mkdtemp(
    join(tmpdir(), ASSET_FAULT_PROFILE_PREFIX),
  );
  const child = spawn(
    appPath,
    [
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
    },
  );
  const processOutput = captureBoundedOutput(child, 8_192);
  let cdp;
  let startMenuObservation;
  let roomObservation;
  let slowDiskObservation;
  let fontFallbackObservation;
  let audioDeviceLossObservation;
  let primaryError;
  let terminationError;
  let cleanupError;

  try {
    const deadline = Date.now() + timeoutMs;
    const port = await waitForDevToolsPort(
      profile,
      child,
      deadline,
      processOutput,
    );
    const target = await waitForPageTarget(
      port,
      child,
      deadline,
      processOutput,
    );
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: assetFaultBootstrapSource(),
    });
    await cdp.send("Page.reload", { ignoreCache: true });

    await waitForButtonAndClick(
      cdp,
      child,
      processOutput,
      deadline,
      "Skip setup",
    );
    startMenuObservation = await waitForValidatedObservation({
      cdp,
      child,
      output: processOutput,
      deadline,
      label: "start-menu fallback",
      observe: () => evaluateStartMenu(cdp),
      validate: validateStartMenuFallbackObservation,
    });
    if (startMenuObservation.faultCounts.corruptStartMenuResponses < 1) {
      throw new RenderSmokeFailure(
        "fault-not-injected",
        "The corrupt start-menu source override was not applied.",
      );
    }

    await clickSelector(cdp, 'button[aria-label="Play"]', "Play");
    await waitForSelectorAndClick(
      cdp,
      child,
      processOutput,
      deadline,
      "#play-chip-ack-title ~ .startup-gate__actions button",
      "play-chip acknowledgment",
    );
    await waitForButtonAndClick(
      cdp,
      child,
      processOutput,
      deadline,
      "Normal",
    );
    await waitForButtonAndClick(
      cdp,
      child,
      processOutput,
      deadline,
      "Enter event",
    );
    roomObservation = await waitForValidatedObservation({
      cdp,
      child,
      output: processOutput,
      deadline: Math.min(deadline, Date.now() + 4_000),
      label: "championship-room fallback",
      observe: () => evaluateRoom(cdp),
      validate: validateRoomFallbackObservation,
      pollIntervalMs: 25,
    });
    if (roomObservation.faultCounts.missingRoomResponses < 1) {
      throw new RenderSmokeFailure(
        "fault-not-injected",
        "The missing room source override was not applied.",
      );
    }
    // Use a separate fresh process for the delayed-read case: the image-fault
    // session intentionally makes the canonical artwork fail permanently, so
    // it cannot also prove late recovery from a slow but successful read.
    slowDiskObservation = await runSlowDiskFault({ appPath, timeoutMs });
    // Font requests are cached per renderer, so this also uses a clean process
    // and an isolated profile. The custom protocol package remains immutable.
    fontFallbackObservation = await runFontFallbackFault({ appPath, timeoutMs });
    audioDeviceLossObservation = await runAudioDeviceLossFault({ appPath, timeoutMs });
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cdp?.close();
    } catch {
      // Exact process-tree termination remains authoritative.
    }
    try {
      await terminateProcessTree(child);
    } catch (error) {
      terminationError = error;
    }
    try {
      await removeValidatedAssetFaultProfile(profile);
    } catch (error) {
      cleanupError = error;
    }
  }

  const packageHashAfter = await sha256File(appAsarPath);
  const packageUnchanged = packageHashAfter === packageHashBefore;
  if (!packageUnchanged) {
    primaryError ??= new RenderSmokeFailure(
      "canonical-package-mutated",
      "Canonical resources/app.asar changed during the isolated fault test.",
    );
  }
  if (terminationError || cleanupError) {
    const cleanupFailures = [terminationError, cleanupError].filter(Boolean);
    primaryError = primaryError
      ? new AggregateError(
          [primaryError, ...cleanupFailures],
          "Asset-fault smoke failed and cleanup was incomplete.",
        )
      : new AggregateError(
          cleanupFailures,
          "Asset-fault smoke cleanup was incomplete.",
        );
  }
  if (primaryError) throw primaryError;

  const evidence = {
    format: "poker-training-pro-packaged-asset-fault-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    appPath,
    packageIntegrity: {
      appAsarPath,
      sha256Before: packageHashBefore,
      sha256After: packageHashAfter,
      unchanged: packageUnchanged,
    },
    packageFreshness,
    injection: {
      mechanism:
        "CDP new-document image source override in isolated packaged renderer profile",
      limitation:
        "Electron custom-protocol image responses bypassed CDP Fetch interception, while embedded ASAR integrity prevents safely altering even an isolated package copy. This in-memory override is the strongest non-mutating packaged-render test.",
      startMenu: {
        path: "/start-menu-reference.png",
        fault: "image src replaced with invalid image/png data before decode",
        overriddenSources:
          startMenuObservation.faultCounts.corruptStartMenuResponses,
      },
      championshipRoom: {
        path: "/start-menu-room.png",
        fault: "image src replaced with a nonexistent custom-protocol asset",
        overriddenSources:
          roomObservation.faultCounts.missingRoomResponses,
      },
      slowDisk: {
        path: "/start-menu-reference.png",
        fault: "in-memory delayed image source assignment before decode",
        delayMs: slowDiskObservation.delayMs,
      },
      fonts: {
        paths: "all bundled .woff/.woff2/.ttf resources",
        fault: "CDP Network.setBlockedURLs before a cache-disabled packaged reload",
        failedFaces: fontFallbackObservation.failedFaces,
      },
      audioDeviceLoss: {
        fault: "AudioContext constructor throws before the packaged renderer loads",
        mechanism: "CDP new-document Web Audio override in an isolated profile",
      },
    },
    observations: {
      startMenu: startMenuObservation,
      championshipRoom: roomObservation,
      slowDisk: slowDiskObservation,
      fontFallback: fontFallbackObservation,
      audioDeviceLoss: audioDeviceLossObservation,
    },
    rendererFaults: {
      runtimeExceptions: 0,
      consoleErrors: 0,
    },
    cleanup: {
      exactProcessTreeTerminated: true,
      isolatedProfileRemoved: true,
    },
    scope: {
      verified: [
        "corrupt start-menu image decode failure via in-memory source override",
        "missing championship-room image failure via in-memory source override",
        "delayed start-menu asset read reaches a visible loading fallback then recovers",
        "bundled font loading fails in an isolated renderer while declared local fallbacks keep critical text and controls readable",
        "AudioContext failure leaves an announced silent fallback and a legal poker action usable",
        "visible CSS/DOM fallbacks",
        "usable Play, Settings, and Skip arrival controls",
        "nonblank packaged renderer root",
      ],
      notClaimed: [
        "video decode or fallback (no runtime video is currently shipped)",
      ],
    },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, canonicalJson(evidence), "utf8");
  return { evidence, evidencePath };
}

async function waitForButtonAndClick(
  cdp,
  child,
  output,
  deadline,
  buttonText,
) {
  while (Date.now() < deadline) {
    ensureProcessAlive(child, output);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const label = ${JSON.stringify(buttonText)};
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
    if (result.exceptionDetails) {
      throw new RenderSmokeFailure(
        "runtime-exception",
        `Runtime.evaluate failed while clicking ${buttonText}.`,
      );
    }
    if (result.result?.value === true) return;
    assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
    await delay(50);
  }
  throw new RenderSmokeFailure(
    "ui-timeout",
    `Timed out waiting for the ${buttonText} button.`,
  );
}

async function clickSelector(cdp, selector, label) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails || result.result?.value !== true) {
    throw new RenderSmokeFailure(
      "ui-action-failed",
      `Could not activate the ${label} control.`,
    );
  }
}

async function waitForSelectorAndClick(
  cdp,
  child,
  output,
  deadline,
  selector,
  label,
) {
  while (Date.now() < deadline) {
    ensureProcessAlive(child, output);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new RenderSmokeFailure(
        "runtime-exception",
        `Runtime.evaluate failed while clicking ${label}.`,
      );
    }
    if (result.result?.value === true) return;
    assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
    await delay(50);
  }
  throw new RenderSmokeFailure(
    "ui-timeout",
    `Timed out waiting for the ${label} control.`,
  );
}

async function waitForValidatedObservation(options) {
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  let lastObservation;
  let lastFailures = ["renderer did not produce an observation"];
  while (Date.now() < options.deadline) {
    ensureProcessAlive(options.child, options.output);
    assertNoUnexpectedRendererEvents(options.cdp.takeFatalEvents());
    lastObservation = await options.observe();
    lastFailures = options.validate(lastObservation);
    if (lastFailures.length === 0) return lastObservation;
    await delay(pollIntervalMs);
  }
  throw new RenderSmokeFailure(
    "fallback-timeout",
    `Timed out waiting for ${options.label}: ${lastFailures.join("; ")}.`,
    { lastObservation },
  );
}

/**
 * Slow reads need a clean renderer because the primary image-fault session is
 * deliberately terminal. The delay exists only in the CDP-injected document;
 * neither the package nor its ASAR are modified.
 */
async function runSlowDiskFault({ appPath, timeoutMs }) {
  const profile = await mkdtemp(join(tmpdir(), ASSET_FAULT_PROFILE_PREFIX));
  const child = spawn(
    appPath,
    [
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
    },
  );
  const output = captureBoundedOutput(child, 8_192);
  let cdp;
  let primaryError;
  let observation;
  try {
    const deadline = Date.now() + Math.min(timeoutMs, 12_000);
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: slowDiskBootstrapSource(),
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForButtonAndClick(
      cdp,
      child,
      output,
      deadline,
      "Skip setup",
    );

    let sawLoadingState = false;
    const delayMs = 1_850;
    const loadingDeadline = Math.min(deadline, Date.now() + 4_500);
    while (Date.now() < loadingDeadline) {
      ensureProcessAlive(child, output);
      assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
      const current = await evaluateSlowDisk(cdp);
      if (current.canonicalStatus === "slow") {
        sawLoadingState = true;
        break;
      }
      await delay(40);
    }

    const readyDeadline = Math.min(deadline, Date.now() + 5_500);
    let eventuallyReady = false;
    let current;
    while (Date.now() < readyDeadline) {
      ensureProcessAlive(child, output);
      assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
      current = await evaluateSlowDisk(cdp);
      if (current.canonicalStatus === "ready" && current.screen === "home") {
        eventuallyReady = true;
        break;
      }
      await delay(40);
    }
    observation = {
      ...(current ?? (await evaluateSlowDisk(cdp))),
      delayMs,
      sawLoadingState,
      eventuallyReady,
      timedOut: !eventuallyReady,
    };
    const failures = validateSlowDiskObservation(observation);
    if (failures.length > 0) {
      throw new RenderSmokeFailure(
        "slow-disk-fallback-timeout",
        `Slow-disk packaged fault failed: ${failures.join("; ")}. Last observation: ${JSON.stringify(observation)}`,
        { observation },
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cdp?.close();
    } catch {
      // Process-tree cleanup below remains authoritative.
    }
    try {
      await terminateProcessTree(child);
    } catch (error) {
      primaryError ??= error;
    }
    try {
      await removeValidatedAssetFaultProfile(profile);
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError) throw primaryError;
  return observation;
}

/**
 * Blocks only bundled font resources before a cache-disabled reload. Unlike a
 * CSS override, this exercises Chromium's real failed-font path and the
 * application's declared system fallback stacks. Network failures are expected
 * in this deliberately isolated fault process; any runtime or console error
 * remains a release failure.
 */
async function runFontFallbackFault({ appPath, timeoutMs }) {
  const profile = await mkdtemp(join(tmpdir(), ASSET_FAULT_PROFILE_PREFIX));
  const child = spawn(
    appPath,
    [
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
    },
  );
  const output = captureBoundedOutput(child, 8_192);
  let cdp;
  let primaryError;
  let observation;
  try {
    const deadline = Date.now() + Math.min(timeoutMs, 12_000);
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*.woff2", "*.woff", "*.ttf"],
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForButtonAndClickWithoutNetworkAssertion(
      cdp,
      child,
      output,
      deadline,
      "Skip setup",
    );
    const observationDeadline = Math.min(deadline, Date.now() + 4_000);
    while (Date.now() < observationDeadline) {
      ensureProcessAlive(child, output);
      observation = await evaluateFontFallback(cdp);
      if (observation.fontStatus === "failed") break;
      await delay(40);
    }
    observation ??= await evaluateFontFallback(cdp);
    const unexpected = cdp.takeFatalEvents().filter(
      (event) => event.kind !== "network-loading-failed",
    );
    assertNoUnexpectedRendererEvents(unexpected);
    const failures = validateFontFallbackObservation(observation);
    if (failures.length > 0) {
      throw new RenderSmokeFailure(
        "font-fallback-timeout",
        `Bundled-font packaged fault failed: ${failures.join("; ")}. Last observation: ${JSON.stringify(observation)}`,
        { observation },
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cdp?.close();
    } catch {
      // Exact process-tree termination remains authoritative.
    }
    try {
      await terminateProcessTree(child);
    } catch (error) {
      primaryError ??= error;
    }
    try {
      await removeValidatedAssetFaultProfile(profile);
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError) throw primaryError;
  return observation;
}

/**
 * A Web Audio constructor failure is the portable equivalent of an unavailable
 * output device in a packaged automated run. The application must announce the
 * silent fallback and still accept an ordinary poker decision.
 */
async function runAudioDeviceLossFault({ appPath, timeoutMs }) {
  const profile = await mkdtemp(join(tmpdir(), ASSET_FAULT_PROFILE_PREFIX));
  const child = spawn(
    appPath,
    [
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
    },
  );
  const output = captureBoundedOutput(child, 8_192);
  let cdp;
  let primaryError;
  let observation;
  try {
    const deadline = Date.now() + Math.min(timeoutMs, 15_000);
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: audioDeviceLossBootstrapSource(),
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForButtonAndClick(cdp, child, output, deadline, "Skip setup");
    await nativeClickSelector(
      cdp,
      child,
      output,
      deadline,
      'button[aria-label="Settings"]',
      "Settings",
    );
    await nativeClickSelector(
      cdp,
      child,
      output,
      deadline,
      'button[aria-label^="Preview Master volume"]',
      "audio preview",
    );
    const statusReady = await waitForValidatedObservation({
      cdp,
      child,
      output,
      deadline: Math.min(deadline, Date.now() + 3_000),
      label: "audio unavailable status",
      observe: () => evaluateAudioDeviceLoss(cdp, false),
      validate: (value) =>
        value.audioContextFailed && value.silentFallbackActive
          ? []
          : ["audio fallback status has not appeared"],
    });
    await waitForButtonAndClick(cdp, child, output, deadline, "Main menu");
    await clickSelector(cdp, 'button[aria-label="Play"]', "Play");
    await waitForSelectorAndClick(
      cdp,
      child,
      output,
      deadline,
      "#play-chip-ack-title ~ .startup-gate__actions button",
      "play-chip acknowledgment",
    );
    await waitForButtonAndClick(cdp, child, output, deadline, "Training");
    await waitForValidatedObservation({
      cdp,
      child,
      output,
      deadline,
      label: "training table under audio fault",
      observe: () => evaluateByValue(cdp, "Boolean(document.querySelector('.poker-table'))"),
      validate: (value) => (value ? [] : ["training table is not ready"]),
    });
    const pokerActionUsable = await clickFirstLegalPokerAction(
      cdp,
      child,
      output,
      deadline,
    );
    observation = await evaluateAudioDeviceLoss(cdp, pokerActionUsable);
    // Preserve the proven status even after navigation from Settings: it is the
    // player-facing acknowledgement that audio failure did not block play.
    observation = {
      ...observation,
      silentFallbackActive: statusReady.silentFallbackActive,
      statusText: statusReady.statusText,
    };
    assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
    const failures = validateAudioDeviceLossObservation(observation);
    if (failures.length > 0) {
      throw new RenderSmokeFailure(
        "audio-device-loss-fallback-failed",
        `Audio-device packaged fault failed: ${failures.join("; ")}. Last observation: ${JSON.stringify(observation)}`,
        { observation },
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      cdp?.close();
    } catch {
      // Exact process-tree termination remains authoritative.
    }
    try {
      await terminateProcessTree(child);
    } catch (error) {
      primaryError ??= error;
    }
    try {
      await removeValidatedAssetFaultProfile(profile);
    } catch (error) {
      primaryError ??= error;
    }
  }
  if (primaryError) throw primaryError;
  return observation;
}

async function clickFirstLegalPokerAction(cdp, child, output, deadline) {
  while (Date.now() < deadline) {
    ensureProcessAlive(child, output);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = [...document.querySelectorAll(".action-dock .action-button")]
          .find((candidate) => candidate instanceof HTMLButtonElement && !candidate.disabled);
        if (!(button instanceof HTMLButtonElement)) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new RenderSmokeFailure(
        "runtime-exception",
        "Runtime.evaluate failed while taking a poker action under audio fault.",
      );
    }
    if (result.result?.value === true) return true;
    assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
    await delay(50);
  }
  return false;
}

async function nativeClickSelector(cdp, child, output, deadline, selector, label) {
  while (Date.now() < deadline) {
    ensureProcessAlive(child, output);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement) || element.matches(":disabled")) return null;
        const box = element.getBoundingClientRect();
        return box.width > 2 && box.height > 2
          ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
          : null;
      })()`,
      returnByValue: true,
    });
    const point = result.result?.value;
    if (point) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
      });
      await delay(120);
      return;
    }
    assertNoUnexpectedRendererEvents(cdp.takeFatalEvents());
    await delay(50);
  }
  throw new RenderSmokeFailure("ui-timeout", `Timed out waiting for the ${label} control.`);
}

async function evaluateAudioDeviceLoss(cdp, pokerActionUsable) {
  return evaluateByValue(
    cdp,
    `(() => ({
      url: location.href,
      title: document.title,
      rootChildCount: document.querySelector("#root")?.childElementCount || 0,
      rootText: (document.querySelector("#root")?.textContent || "").slice(0, 10000),
      audioContextFailed: Number(window.__PTP_AUDIO_CONTEXT_FAILURES__ || 0) > 0,
      silentFallbackActive: /audio preview is unavailable/i.test(
        document.querySelector("#audio-preview-status")?.textContent || ""
      ),
      pokerActionUsable: ${Boolean(pokerActionUsable)},
      statusText: document.querySelector("#audio-preview-status")?.textContent?.trim() || ""
    }))()`,
  );
}

async function waitForButtonAndClickWithoutNetworkAssertion(
  cdp,
  child,
  output,
  deadline,
  buttonText,
) {
  while (Date.now() < deadline) {
    ensureProcessAlive(child, output);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const label = ${JSON.stringify(buttonText)};
        const button = [...document.querySelectorAll("button")].find(
          (candidate) => (candidate.textContent || "").trim() === label
        );
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new RenderSmokeFailure(
        "runtime-exception",
        `Runtime.evaluate failed while clicking ${buttonText}.`,
      );
    }
    if (result.result?.value === true) return;
    await delay(50);
  }
  throw new RenderSmokeFailure(
    "ui-timeout",
    `Timed out waiting for the ${buttonText} button under the font fault.`,
  );
}

async function evaluateFontFallback(cdp) {
  return evaluateByValue(
    cdp,
    `(() => {
      const root = document.querySelector("#root");
      const play = document.querySelector('button[aria-label="Play"]');
      const settings = document.querySelector('button[aria-label="Settings"]');
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" &&
          Number(style.opacity) > 0 && box.width > 2 && box.height > 2;
      };
      const usable = (element) =>
        element instanceof HTMLButtonElement && !element.disabled && visible(element);
      const faces = [...document.fonts]
        .filter((face) => /Inter|Barlow Condensed/i.test(face.family))
        .map((face) => ({ family: face.family, status: face.status }));
      const rootFamily = getComputedStyle(document.documentElement).fontFamily;
      const titleFamily = getComputedStyle(document.documentElement).fontFamily;
      return {
        url: location.href,
        title: document.title,
        rootChildCount: root ? root.childElementCount : 0,
        rootText: root ? (root.textContent || "").slice(0, 10000) : "",
        fontStatus: faces.some((face) => face.status === "error") ? "failed" : "pending",
        failedFaces: faces.filter((face) => face.status === "error").length,
        usedFallbackFamily: /Segoe UI|Arial Narrow|sans-serif/i.test(String(rootFamily) + " " + String(titleFamily)),
        textReadable: usable(play) && usable(settings) &&
          (root?.textContent || "").includes("Play") &&
          (root?.textContent || "").includes("Settings"),
        rootFamily,
        titleFamily,
      };
    })()`,
  );
}

async function evaluateStartMenu(cdp) {
  return evaluateByValue(
    cdp,
    `(() => {
      const root = document.querySelector("#root");
      const media = document.querySelector(".home-reference__media");
      const fallback = document.querySelector(".home-reference__fallback");
      const canonical = document.querySelector(".home-reference__canonical");
      const play = document.querySelector('button[aria-label="Play"]');
      const settings = document.querySelector('button[aria-label="Settings"]');
      const notice = document.querySelector(".asset-fallback-notice");
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" &&
          Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const usable = (element) =>
        element instanceof HTMLButtonElement && !element.disabled &&
        getComputedStyle(element).pointerEvents !== "none" &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0;
      return {
        url: location.href,
        title: document.title,
        rootChildCount: root ? root.childElementCount : 0,
        rootText: root ? (root.textContent || "").slice(0, 10000) : "",
        screen: document.querySelector(".home-reference") ? "home" : "other",
        canonicalStatus: media?.getAttribute("data-canonical-status") || null,
        fallbackExists: Boolean(fallback),
        fallbackVisible: visible(fallback),
        canonicalArtHidden: canonical ? Number(getComputedStyle(canonical).opacity) === 0 : false,
        playUsable: usable(play),
        settingsUsable: usable(settings),
        noticeText: notice ? (notice.textContent || "").trim() : "",
        faultCounts: window.__PTP_ASSET_FAULT_COUNTS__ || {
          corruptStartMenuResponses: 0,
          missingRoomResponses: 0
        }
      };
    })()`,
  );
}

async function evaluateSlowDisk(cdp) {
  return evaluateByValue(
    cdp,
    `(() => {
      const root = document.querySelector("#root");
      const media = document.querySelector(".home-reference__media");
      return {
        url: location.href,
        title: document.title,
        rootChildCount: root ? root.childElementCount : 0,
        rootText: root ? (root.textContent || "").slice(0, 10000) : "",
        screen: document.querySelector(".home-reference") ? "home" : "other",
        canonicalStatus: media?.getAttribute("data-canonical-status") || null,
      };
    })()`,
  );
}

async function evaluateRoom(cdp) {
  return evaluateByValue(
    cdp,
    `(() => {
      const root = document.querySelector("#root");
      const room = document.querySelector(".room-flight");
      const venue = document.querySelector(".room-flight__venue");
      const art = document.querySelector(".room-flight__background-art");
      const skip = document.querySelector(".room-flight__skip");
      const notice = document.querySelector(".asset-fallback-notice--room");
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" &&
          Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const usable = (element) =>
        element instanceof HTMLButtonElement && !element.disabled &&
        getComputedStyle(element).pointerEvents !== "none" &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0;
      return {
        url: location.href,
        title: document.title,
        rootChildCount: root ? root.childElementCount : 0,
        rootText: root ? (root.textContent || "").slice(0, 10000) : "",
        screen: room ? "room-flight" : "other",
        backgroundStatus: room?.getAttribute("data-background-status") || null,
        venueExists: Boolean(venue),
        venueVisible: visible(venue),
        backgroundArtHidden: art ? Number(getComputedStyle(art).opacity) === 0 : false,
        skipUsable: usable(skip),
        noticeText: notice ? (notice.textContent || "").trim() : "",
        faultCounts: window.__PTP_ASSET_FAULT_COUNTS__ || {
          corruptStartMenuResponses: 0,
          missingRoomResponses: 0
        }
      };
    })()`,
  );
}

async function evaluateByValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new RenderSmokeFailure(
      "runtime-exception",
      "Runtime.evaluate raised an exception.",
    );
  }
  return result.result?.value;
}

function ensureProcessAlive(child, output) {
  if (child.exitCode === null) return;
  const diagnostic = `${output.stderr}\n${output.stdout}`
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  throw new RenderSmokeFailure(
    "process-exited",
    `Packaged app exited before fallback verification (code ${child.exitCode})${
      diagnostic ? `: ${diagnostic}` : "."
    }`,
  );
}

function assetFaultBootstrapSource() {
  return `(() => {
    const corrupt = "data:image/png;base64,aW50ZW50aW9uYWxseS1jb3JydXB0";
    const missing = "poker-training-pro://app/__asset-fault-missing-room.png";
    const counts = {
      corruptStartMenuResponses: 0,
      missingRoomResponses: 0
    };
    Object.defineProperty(window, "__PTP_ASSET_FAULT_COUNTS__", {
      value: counts,
      configurable: false,
      enumerable: false,
      writable: false
    });
    const substitute = (value) => {
      if (typeof value !== "string") return value;
      let pathname;
      try {
        pathname = new URL(value, location.href).pathname;
      } catch {
        return value;
      }
      if (pathname === "/start-menu-reference.png") {
        counts.corruptStartMenuResponses += 1;
        return corrupt;
      }
      if (pathname === "/start-menu-room.png") {
        counts.missingRoomResponses += 1;
        return missing;
      }
      return value;
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "src"
    );
    if (descriptor?.get && descriptor?.set) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          descriptor.set.call(this, substitute(value));
        }
      });
    }
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      const next =
        this instanceof HTMLImageElement && String(name).toLowerCase() === "src"
          ? substitute(String(value))
          : value;
      return nativeSetAttribute.call(this, name, next);
    };
  })();`;
}

function audioDeviceLossBootstrapSource() {
  return `(() => {
    let failures = 0;
    class UnavailableAudioContext {
      constructor() {
        failures += 1;
        throw new Error("Injected audio output unavailable");
      }
    }
    Object.defineProperty(window, "__PTP_AUDIO_CONTEXT_FAILURES__", {
      get: () => failures,
      configurable: false,
      enumerable: false,
    });
    Object.defineProperty(window, "AudioContext", {
      value: UnavailableAudioContext,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      value: UnavailableAudioContext,
      configurable: true,
      writable: true,
    });
    // CDP DOM activation is not always reflected by Chromium's
    // navigator.userActivation flag. The production graph itself still only
    // initializes after a real activation; this isolated fault harness marks
    // the synthetic click as activated so its failure path can be exercised.
    try {
      Object.defineProperty(navigator, "userActivation", {
        value: { hasBeenActive: true, isActive: true },
        configurable: true,
      });
    } catch {
      // Native user activation in the package is still sufficient on builds
      // where the platform exposes a non-configurable UserActivation object.
    }
  })();`;
}

function slowDiskBootstrapSource() {
  return `(() => {
    const delayMs = 1850;
    const delayedPath = "/start-menu-reference.png";
    const shouldDelay = (value) => {
      if (typeof value !== "string") return false;
      try {
        return new URL(value, location.href).pathname === delayedPath;
      } catch {
        return false;
      }
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "src"
    );
    if (descriptor?.get && descriptor?.set) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          if (!shouldDelay(value)) return descriptor.set.call(this, value);
          const element = this;
          setTimeout(() => descriptor.set.call(element, value), delayMs);
        }
      });
    }
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if (
        this instanceof HTMLImageElement &&
        String(name).toLowerCase() === "src" &&
        shouldDelay(String(value))
      ) {
        const element = this;
        setTimeout(
          () => nativeSetAttribute.call(element, name, value),
          delayMs
        );
        return;
      }
      return nativeSetAttribute.call(this, name, value);
    };
  })();`;
}

async function inspectPackageFreshness(appAsarPath) {
  const appAsar = await stat(appAsarPath);
  const inputs = await Promise.all(
    FRESHNESS_INPUTS.map(async (path) => {
      const absolutePath = join(projectRoot, path);
      const metadata = await stat(absolutePath);
      return {
        path,
        mtimeUtc: metadata.mtime.toISOString(),
        newerThanPackage: metadata.mtimeMs > appAsar.mtimeMs,
      };
    }),
  );
  return {
    appAsarMtimeUtc: appAsar.mtime.toISOString(),
    freshAgainstCheckedRendererInputs: inputs.every(
      (input) => !input.newerThanPackage,
    ),
    checkedInputs: inputs,
  };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseArguments(arguments_) {
  let appPath = DEFAULT_APP;
  let evidencePath = DEFAULT_EVIDENCE;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--app") {
      appPath = requireValue(arguments_, ++index, "--app");
    } else if (argument === "--evidence") {
      evidencePath = requireValue(arguments_, ++index, "--evidence");
    } else if (argument === "--timeout-ms") {
      timeoutMs = Number.parseInt(
        requireValue(arguments_, ++index, "--timeout-ms"),
        10,
      );
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { appPath, evidencePath, timeoutMs };
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `Expected an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const result = await runPackagedAssetFaultSmoke(
      parseArguments(process.argv.slice(2)),
    );
    const freshness =
      result.evidence.packageFreshness.freshAgainstCheckedRendererInputs
        ? "fresh"
        : "STALE";
    console.log(
      `Packaged asset-fault smoke passed: corrupt start-menu=${result.evidence.injection.startMenu.overriddenSources}, missing room=${result.evidence.injection.championshipRoom.overriddenSources}, renderer faults=0, package unchanged=true, package freshness=${freshness}.`,
    );
    console.log(
      `Evidence: ${relative(projectRoot, result.evidencePath)}`,
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : "asset-fault-smoke-failed";
    const message =
      error instanceof Error
        ? error.message
        : "Unknown packaged asset-fault smoke failure.";
    // A CDP command deadline proves neither a graceful asset fallback nor a
    // broken one. Exit 2 so a caller can tell an inconclusive run from a
    // regression without parsing this text (E25-003).
    if (isCdpTransportTimeout(error)) {
      console.error(
        `Packaged asset-fault smoke inconclusive [cdp-transport-timeout]: ${message}`,
      );
      process.exitCode = 2;
    } else {
      console.error(
        `Packaged asset-fault smoke failed [${code}]: ${message}`,
      );
      process.exitCode = 1;
    }
  }
}
