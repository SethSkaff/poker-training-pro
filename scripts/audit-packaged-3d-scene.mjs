/**
 * Evidence-gated package audit for the optional 3D scene.
 *
 * It uses only the app's read-only diagnostic snapshot and ordinary controls;
 * the audit cannot mutate poker state except through the same menu/table UI a
 * player uses. Its isolated profile and lifecycle hook are package-only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import {
  isKnownElectronSandboxDiagnostic,
  PackagedSession,
} from "./lib/packaged-cdp-session.mjs";

// The primary native window remains attached while six independent real-size
// windows complete the composition matrix. The seeded side-pot proof then
// advances several real hands. This is a total audit budget, not a render wait;
// 80 seconds could expire during otherwise healthy package evidence work.
/*
  Raised from 180s: the primary session now also collects the six terminal
  opponent-action stills, which needs several more real hands while it still
  holds the foreground. Its deadline is absolute from launch and keeps running
  through the ~150s composition matrix, so the budget has to cover
  reach-table + first hand + the still collection + the matrix + lifecycle +
  three context recoveries. Matrix and side-pot sessions get their own budgets.
*/
const timeoutMs = 480_000;
/** Wall-clock share of the above reserved for the opponent-action collection. */
const OPPONENT_ACTION_BUDGET_MS = 140_000;
const sceneBudgets = Object.freeze({
  drawCalls: 150,
  triangles: 250_000,
  frameP95Ms: 25,
  textureEstimateMiB: 128,
});
/**
 * Did the native window actually come up at the requested size?
 *
 * `window.outerWidth` is CSS pixels: Chromium divides the real window rect by
 * the display scale and rounds. On a 100%-scaled display that is lossless and
 * the comparison is exact, which is how this was calibrated. On a fractionally
 * scaled display -- 150% is the Windows default on a lot of laptops -- a window
 * created at 1366 device-independent pixels reads back as 1367, and no amount of
 * correctness in the app can change that. Asserting equality there was testing
 * the reviewer's monitor, not the build.
 *
 * So: exact at 1x, and one CSS pixel of slack when the readback is lossy. That
 * is tight enough to still catch the failure this guards -- a window that
 * silently came up at the default 1440x920, or at a CDP-emulated size with no
 * native resize behind it -- both of which are hundreds of pixels out.
 */
function nativeWindowMatches(nativeWindow, viewport) {
  if (!nativeWindow) return false;
  const ratio = nativeWindow.devicePixelRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  const slack = ratio === 1 ? 0 : 1;
  return Math.abs(nativeWindow.outerWidth - viewport.width) <= slack
    && Math.abs(nativeWindow.outerHeight - viewport.height) <= slack;
}

const compositionViewports = Object.freeze([
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1100x720", width: 1100, height: 720 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1080", width: 2560, height: 1080 },
]);
const appPath = resolve(
  projectRoot,
  argumentValue("--app") ?? "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const motionMode = argumentValue("--motion") ?? "full";
const sceneAuditSeed = argumentValue("--seed") ?? "runner-showdown-3";
if (!["runner-showdown-3", "scene-side-pot-0"].includes(sceneAuditSeed)) {
  throw new Error(`Unknown --seed ${sceneAuditSeed}.`);
}
if (!['full', 'reduced', 'off'].includes(motionMode)) {
  throw new Error(`Unknown --motion ${motionMode}. Expected full, reduced, or off.`);
}

export async function runAudit() {
  const reportPath = resolve(projectRoot, "work", "packaged-3d-scene-audit.json");
  const selectedKind = argumentValue("--kind");
  const cases = selectedKind === undefined
    ? [["webgl2", []], ["forced-webgl-failure", ["--ptp-force-webgl2-failure"]]]
    : selectedKind === "webgl2"
      ? [["webgl2", []]]
      : selectedKind === "forced-webgl-failure"
        ? [["forced-webgl-failure", ["--ptp-force-webgl2-failure"]]]
        : (() => { throw new Error(`Unknown --kind ${selectedKind}.`); })();
  const results = [];
  const primarySeed = sceneAuditSeed === "scene-side-pot-0"
    ? "runner-showdown-3"
    : sceneAuditSeed;
  for (const [kind, extraArguments] of cases) {
    results.push(await runCase(kind, extraArguments, motionMode, primarySeed, sceneAuditSeed));
  }
  for (const result of results) assertCase(result);
  assertForcedFallbackRunoutParity(results);
  await mkdir(resolve(projectRoot, "work"), { recursive: true });
  for (const result of results) {
    await writeFile(
      resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}.png`),
      Buffer.from(result.screenshotPngBase64, "base64"),
    );
    for (const beat of result.publicBeats ?? []) {
      await writeFile(
        resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-${beat.street}.png`),
        Buffer.from(beat.screenshotPngBase64, "base64"),
      );
      delete beat.screenshotPngBase64;
    }
    for (const heroState of result.interaction?.heroDecisionStates ?? []) {
      await writeFile(
        resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-hero-${heroState.state}.png`),
        Buffer.from(heroState.screenshotPngBase64, "base64"),
      );
      delete heroState.screenshotPngBase64;
    }
    for (const still of result.opponentActions?.stills ?? []) {
      await writeFile(
        resolve(
          projectRoot,
          "work",
          `packaged-3d-scene-${result.kind}-${result.motionMode}-opponent-${still.action}.png`,
        ),
        Buffer.from(still.screenshotPngBase64, "base64"),
      );
      delete still.screenshotPngBase64;
    }
    if (result.sidePotCapture) {
      await writeFile(
        resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-side-pots.png`),
        Buffer.from(result.sidePotCapture.screenshotPngBase64, "base64"),
      );
      delete result.sidePotCapture.screenshotPngBase64;
    }
    for (const capture of result.compositionMatrix ?? []) {
      await writeFile(resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-${capture.viewport}.png`), Buffer.from(capture.screenshotPngBase64, "base64"));
      if (capture.silentReview?.screenshotPngBase64) {
        await writeFile(
          resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-${capture.viewport}-silent-5s.png`),
          Buffer.from(capture.silentReview.screenshotPngBase64, "base64"),
        );
        delete capture.silentReview.screenshotPngBase64;
      }
      for (const pan of capture.panFrames ?? []) {
        await writeFile(resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${result.motionMode}-${capture.viewport}-${pan.pose}.png`), Buffer.from(pan.screenshotPngBase64, "base64"));
        delete pan.screenshotPngBase64;
      }
      delete capture.screenshotPngBase64;
    }
    delete result.screenshotPngBase64;
  }
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    executable: basename(appPath),
    results,
    note: "Read-only scene diagnostics plus CDP screenshots; metrics are evidence for the packaged preview, not a quality-tier promotion.",
  }, null, 2)}\n`, "utf8");
  for (const result of results) {
    await writeFile(
      resolve(
        projectRoot,
        "work",
        `packaged-3d-scene-audit-${result.kind}-${result.motionMode}-${result.sceneAuditSeed}.json`,
      ),
      `${JSON.stringify({
        schemaVersion: 1,
        executable: basename(appPath),
        results: [result],
        note: "Per-run durable evidence. The aggregate audit report may be replaced by a later run.",
      }, null, 2)}\n`,
      "utf8",
    );
  }
  return { ok: true, reportPath, results };
}

async function runCase(kind, extraArguments, requestedMotionMode, requestedSeed, sidePotSeed = requestedSeed) {
  let stage = "launch";
  const session = await PackagedSession.launch({
    appPath,
    profilePrefix: `poker-training-pro-3d-audit-${kind}-`,
    timeoutMs,
    extraArguments: ["--ptp-lifecycle-smoke", `--ptp-scene-audit-seed=${requestedSeed}`, ...extraArguments],
    // Keep both paths foregrounded. Hidden Windows Electron windows throttle
    // the presentation queue, which makes the forced-DOM audit skip readable
    // public runout beats rather than exercising its real cadence.
    windowsHide: false,
  });
  try {
    stage = "reach-table";
    await session.cdp.send("Log.enable");
    await reachTableWithScene(session, requestedMotionMode);
    stage = "resume-primary";
    await resumeTableIfPaused(session);
    const publicBeats = [];
    stage = "initial-public-beat";
    await capturePublicBeat(session, publicBeats);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    let before;
    let lifecycle;
    let recovery;
    let compositionMatrix;
    let primaryFrame;
    let publicRunout;
    if (kind !== "webgl2") {
      before = await observe(session);
    }
    // Complete the first real hand before opening six other native windows.
    // This keeps the primary CDP target short-lived instead of leaving it
    // inactive behind the matrix while its presentation queue advances.
    stage = "hero-interaction";
    const initialInteraction = await exerciseCameraAndOneLegalAction(session, requestedMotionMode);
    stage = "complete-hand";
    const opponentActionStills = [];
    const interaction = {
      ...initialInteraction,
      completedHand: await completeCurrentHand(
        session,
        initialInteraction.handId,
        publicBeats,
        opponentActionStills,
      ),
    };
    let opponentActions;
    if (kind === "webgl2") {
      /*
        Stage order here is load-bearing, and two orderings were tried and
        rejected before this one:

        1. The lifecycle and context-recovery proofs need a *live* table, and
           they come first because playing extra hands for the opponent-action
           stills can end the hero's tournament. Collecting first left an
           "Eliminated" ceremony where the pause menu was expected.
        2. Everything that uses this primary CDP target finishes before the
           six-window composition matrix opens. The matrix takes minutes of wall
           clock while this session's deadline runs from launch, so running it in
           the middle starved these stages of budget -- and once six other
           windows have opened over this one it is occluded, so
           `Page.captureScreenshot` can no longer obtain a compositor frame.
      */
      stage = "lifecycle";
      await resumeTableIfPaused(session);
      before = await observe(session);
      lifecycle = await minimizeAndRestore(session);
      stage = "context-recovery";
      recovery = await repeatContextRecovery(session, before.diagnostics.contextLosses);
      stage = "opponent-action-stills";
      opponentActions = await collectOpponentActionStills(
        session,
        opponentActionStills,
        OPPONENT_ACTION_BUDGET_MS,
      );
      stage = "primary-frame";
      // Taken here, not after the matrix: by then six other native windows have
      // opened and closed over this one and an occluded window yields no
      // compositor frame for `Page.captureScreenshot` to return.
      primaryFrame = await session.cdp.send("Page.captureScreenshot", { format: "png" });
      stage = "public-runout";
      publicRunout = await readPublicRunout(session);
      stage = "composition-matrix";
      compositionMatrix = await captureCompositionMatrix(extraArguments, requestedMotionMode, requestedSeed);
    }
    // The two-side-pot state is its own fresh package session. It avoids
    // coupling five real hands of evidence to the six-window visual matrix.
    const sidePotCapture = kind === "webgl2" && sidePotSeed === "scene-side-pot-0"
      ? await captureSidePotSession(
          extraArguments,
          requestedMotionMode,
          sidePotSeed,
          opponentActionStills,
        )
      : undefined;
    const screenshot = primaryFrame
      ?? await session.cdp.send("Page.captureScreenshot", { format: "png" });
    const fatalEvents = session.cdp.takeFatalEvents();
    const fatal = fatalEvents.filter((event) => !isKnownElectronSandboxDiagnostic(event));
    return {
      kind,
      motionMode: requestedMotionMode,
      sceneAuditSeed: sidePotSeed,
      primarySceneAuditSeed: requestedSeed,
      before,
      interaction,
      publicBeats,
      publicRunout: publicRunout ?? await readPublicRunout(session),
      // Recomputed after the side-pot session, which contributes the all-in still.
      ...(opponentActions ? { opponentActions: summariseOpponentActions(opponentActions, opponentActionStills) } : {}),
      ...(sidePotCapture ? { sidePotCapture } : {}),
      ...(compositionMatrix ? { compositionMatrix } : {}),
      ...(lifecycle ? { lifecycle } : {}),
      ...(recovery ? { recovery } : {}),
      screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75),
      screenshotPngBase64: screenshot.data ?? "",
      fatal,
      knownElectronSandboxDiagnostics: fatalEvents.length - fatal.length,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene audit failed during ${stage}: ${detail}`, { cause: error });
  } finally {
    await session.dispose();
  }
}

/** Default camera bindings from src/lib/actionMap.ts. */
const CAMERA_KEYS = Object.freeze({
  left: { key: "q", code: "KeyQ", windowsVirtualKeyCode: 81 },
  right: { key: "e", code: "KeyE", windowsVirtualKeyCode: 69 },
  center: { key: "x", code: "KeyX", windowsVirtualKeyCode: 88 },
});
const CAMERA_GAMEPAD_BUTTONS = Object.freeze({ left: 14, right: 15, center: 13 });

function readCameraPanExpression() {
  return `(() => {
    const table = document.querySelector('.poker-table');
    const canvas = document.querySelector('.table-scene-3d');
    return {
      pan: table?.getAttribute('data-table-camera-pan') ?? null,
      // Direction A forbids focus ever entering the decorative canvas, so every
      // camera input has to be proven against that too, not just the yaw state.
      canvasFocused: document.activeElement === canvas,
      activeElement: document.activeElement?.className ?? null,
    };
  })()`;
}

async function settleCameraPan(session, expected, via) {
  const settled = await session.poll(
    `document.querySelector('.poker-table')?.getAttribute('data-table-camera-pan') === ${JSON.stringify(String(expected))}`,
    { intervalMs: 32 },
  );
  const state = await session.evaluate(readCameraPanExpression());
  if (!settled || state?.canvasFocused) {
    throw new Error(`Camera ${via} did not reach pan ${expected} without focusing the canvas: ${JSON.stringify(state)}`);
  }
  return state;
}

async function sendCameraKey(session, direction) {
  const { key, code, windowsVirtualKeyCode } = CAMERA_KEYS[direction];
  await session.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await session.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

/**
 * Hold a mock D-pad press long enough for the app's requestAnimationFrame
 * gamepad poll to sample it. The edge-triggered intent fires once regardless of
 * hold length, so this proves the real Gamepad API route rather than widening it
 * (same technique as scripts/audit-packaged-input-smoke.mjs).
 */
async function pressCameraGamepadButton(session, direction) {
  const index = CAMERA_GAMEPAD_BUTTONS[direction];
  /*
    The provider is edge-triggered: it fires once on the press-to-release
    transition it observes. Two presses in a row therefore need an observed
    *released* state between them, or the second is not a new edge and the
    camera advances only one step. The released pad is installed first and held
    for several polls, then the press replaces it; the press is released again
    only when the next step installs its own released pad.
  */
  await session.evaluate(`(() => {
    const released = Array.from({ length: 16 }, () => ({ pressed: false, value: 0, touched: false }));
    const pad = { buttons: released, axes: [0, 0], connected: true, mapping: "standard", index: 0, id: "ptp-audit-pad" };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event("gamepadconnected"));
    window.__ptpAuditPad = pad;
    return true;
  })()`);
  // Give even a throttled requestAnimationFrame poll several frames to observe
  // the released baseline before the press edge.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 260));
  await session.evaluate(`(() => {
    const pad = window.__ptpAuditPad;
    if (!pad) return false;
    pad.buttons[${index}] = { pressed: true, value: 1, touched: true };
    return true;
  })()`);
}

/**
 * Direction A requires pointer, keyboard, and controller to reach *identical*
 * yaw and recenter states, and requires focus never to enter the decorative
 * canvas. The existing input smoke proves the Gamepad API reaches the table at
 * all; this proves the three routes agree on the scene camera specifically.
 */
async function captureCameraInputParity(session) {
  const start = await session.evaluate(readCameraPanExpression());
  if (start?.pan === null) {
    throw new Error("Packaged table did not expose its public camera pan for input parity.");
  }
  if (start.pan !== "0") {
    await session.clickSelector('button[aria-label="Recenter the table view"]', "camera parity baseline");
    await settleCameraPan(session, 0, "baseline recenter");
  }
  const routes = [];
  // Settle after every individual step rather than after a pair: it pins the
  // exact yaw each input produced, and it is the only way an edge-triggered
  // controller press can be distinguished from one that was never observed.
  const exercise = async (via, step) => {
    await step("left");
    await settleCameraPan(session, -1, `${via} left step 1`);
    await step("left");
    const left = await settleCameraPan(session, -2, `${via} left limit`);
    await step("center");
    const centered = await settleCameraPan(session, 0, `${via} recenter`);
    await step("right");
    await settleCameraPan(session, 1, `${via} right step 1`);
    await step("right");
    const right = await settleCameraPan(session, 2, `${via} right limit`);
    await step("center");
    await settleCameraPan(session, 0, `${via} recenter after right`);
    routes.push({ via, left: left.pan, center: centered.pan, right: right.pan, canvasFocused: false });
  };

  await exercise("pointer", async (direction) => {
    const label = direction === "left"
      ? "Look one seat left"
      : direction === "right" ? "Look one seat right" : "Recenter the table view";
    await session.clickSelector(`button[aria-label="${label}"]`, `pointer camera ${direction}`);
  });
  await exercise("keyboard", (direction) => sendCameraKey(session, direction));
  await exercise("gamepad", (direction) => pressCameraGamepadButton(session, direction));

  // Restore the ordinary getGamepads so nothing later in the run sees a pad.
  await session.evaluate(`(() => {
    delete window.__ptpAuditPad;
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
    return true;
  })()`);
  return { routes, agreed: routes.every((route) => route.left === "-2" && route.center === "0" && route.right === "2") };
}

/**
 * Top up the terminal opponent-action stills in the *primary* session.
 *
 * A dedicated extra window was tried first and proved unreliable: a long-lived
 * secondary window loses the foreground while the composition matrix opens and
 * closes six others, and `Page.captureScreenshot` waits for a compositor frame
 * an occluded Electron window never produces. The primary session's capture path
 * is already exercised successfully many times per run by the public-beat and
 * hero-decision frames, so collection rides on that instead. Advancement is only
 * ever through the mounted action controls.
 *
 * `stills` already holds whatever the first hand produced.
 */
async function collectOpponentActionStills(session, stills, budgetMs) {
  const deadline = Math.min(
    Date.now() + budgetMs,
    Math.max(Date.now() + 1, session.deadline - 20_000),
  );
  let heroActions = 0;
  const handsSeen = new Set();
  {
    while (Date.now() < deadline) {
      await captureOpponentActionStills(session, stills);
      if (stills.length >= TERMINAL_OPPONENT_ACTIONS.length) break;
      /*
        Opponents only re-raise when they are facing pressure, so while 'raise'
        is outstanding the hero applies some -- through the same raise control a
        player uses, never by injecting an action.

        Deliberately a bounded raise and never the all-in preset: shoving the
        hero's whole stack to force opponent all-ins busted the hero out of the
        tournament, which left an "Eliminated" ceremony where the lifecycle and
        context-recovery proofs need a live table. Opponent all-ins come instead
        from the `scene-side-pot-0` fixture, whose unequal caps exist precisely
        because several players are all-in.
      */
      const needAggression = !stills.some((still) => still.action === "raise");
      /*
        Only pressure opponents while the hero is comfortably deep. Repeated
        raises off a short stack end the tournament, and although the proofs that
        need a live table now run before this stage, busting also cuts the
        collection itself short.
      */
      const heroDeepEnough = await session.evaluate(`(() => {
        const hero = document.querySelector('.player-seat--hero[data-scene-stack]');
        return hero ? Number(hero.getAttribute('data-scene-stack')) > 4_000 : false;
      })()`);
      const step = await session.evaluate(`(() => {
        const aggressive = ${JSON.stringify(needAggression)} && ${JSON.stringify(heroDeepEnough === true)};
        const handId = document.querySelector('.poker-table')?.getAttribute('data-table-hand-id') ?? null;
        // A native blur auto-pauses the table. Left unresumed the loop would
        // spin against a pause card until its deadline and report every action
        // as missing, which reads as an app failure rather than a focus race.
        const resume = document.querySelector('.pause-menu .primary-button');
        if (resume instanceof HTMLButtonElement) {
          resume.click();
          return { resumed: true, handId };
        }
        // The hero must survive: an elimination ceremony ends the table that the
        // remaining proofs depend on.
        if (document.querySelector('.ceremony-board')) return { ceremony: true, handId };
        const composer = document.querySelector('.bet-composer');
        if (composer instanceof HTMLElement) {
          const confirm = composer.querySelector('.primary-button');
          if (confirm instanceof HTMLButtonElement && !confirm.disabled) {
            confirm.click();
            return { acted: true, handId };
          }
          return { handId };
        }
        const choices = [...document.querySelectorAll('.action-dock .action-button')]
          .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
        // Cheap actions keep a hand alive across more streets, which is what
        // produces check/call/bet/fold; raise is preferred only while the
        // aggressive kinds are still missing.
        const choice = (aggressive
          ? choices.find((button) => button.classList.contains('action-button--raise'))
          : undefined)
          ?? choices.find((button) => button.classList.contains('action-button--call'))
          ?? choices.find((button) => button.classList.contains('action-button--fold'))
          ?? choices.find((button) => button.classList.contains('action-button--raise'));
        if (choice instanceof HTMLButtonElement) {
          choice.click();
          return { acted: true, handId };
        }
        return { handId };
      })()`);
      if (step?.ceremony) break;
      if (step?.handId) handsSeen.add(step.handId);
      if (step?.acted) heroActions += 1;
      // Sample on the browser-frame cadence: a terminal action plaque holds for
      // about 1.5 s, but a fast package can retire one between slower polls.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 24));
    }
    const captured = stills.map((still) => still.action);
    return {
      stills,
      capturedActions: captured,
      missingActions: TERMINAL_OPPONENT_ACTIONS.filter((action) => !captured.includes(action)),
      heroActions,
      handsObserved: handsSeen.size,
    };
  }
}

async function captureSidePotSession(extraArguments, requestedMotionMode, requestedSeed, opponentActionStills) {
  const session = await PackagedSession.launch({
    appPath,
    profilePrefix: "poker-training-pro-3d-audit-side-pots-",
    timeoutMs,
    extraArguments: ["--ptp-lifecycle-smoke", `--ptp-scene-audit-seed=${requestedSeed}`, ...extraArguments],
    windowsHide: false,
  });
  try {
    await session.cdp.send("Log.enable");
    await reachTableWithScene(session, requestedMotionMode);
    await resumeTableIfPaused(session);
    const capture = await captureTwoSidePotLanes(session, opponentActionStills);
    const fatal = session.cdp.takeFatalEvents().filter((event) => !isKnownElectronSandboxDiagnostic(event));
    if (fatal.length > 0) throw new Error(`Side-pot capture emitted fatal renderer events: ${JSON.stringify(fatal)}`);
    return capture;
  } finally {
    await session.dispose();
  }
}

async function exerciseCameraAndOneLegalAction(session, requestedMotionMode) {
  const fixedCamera = requestedMotionMode === "reduced" || requestedMotionMode === "off";
  if (fixedCamera) {
    if (!await session.poll(fixedCameraControlExpression())) {
      throw new Error("Reduced/off camera did not remain visibly centered and disabled.");
    }
  } else {
    await session.clickSelector('button[aria-label="Look one seat right"]', "camera right");
    if (!await session.poll("document.querySelector('button[aria-label=\"Recenter the table view\"]') instanceof HTMLButtonElement && !document.querySelector('button[aria-label=\"Recenter the table view\"]')?.disabled")) {
      throw new Error("Camera did not move through its ordinary table control.");
    }
    await session.clickSelector('button[aria-label="Recenter the table view"]', "camera recenter");
  }
  // Pointer/keyboard/controller parity is only meaningful where the camera
  // controls are live; reduced and off deliberately disable them and are proven
  // instead by the fixed-pose assertion above.
  const cameraInputParity = fixedCamera ? undefined : await captureCameraInputParity(session);
  const deadline = Date.now() + 20_000;
  let presentationSkips = 0;
  let heroDecisionStates;
  while (Date.now() < deadline) {
    const result = await session.evaluate(`(() => {
      const composer = document.querySelector('.bet-composer');
      if (composer instanceof HTMLElement) {
        const allInPreset = [...composer.querySelectorAll('.bet-presets button')]
          .find((button) => /all[- ]in/i.test(button.textContent || ''));
        if (allInPreset instanceof HTMLButtonElement && !allInPreset.classList.contains('is-active')) {
          allInPreset.click();
          return "preparing-all-in";
        }
        const confirm = composer.querySelector('.primary-button');
        if (confirm instanceof HTMLButtonElement && !confirm.disabled
          && /all[- ]in/i.test(confirm.textContent || '')) {
          confirm.click();
          return "hero-action";
        }
        return null;
      }
      const choices = [...document.querySelectorAll('.action-dock .action-button')]
        .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
      const choice = choices.find((button) => button.classList.contains('action-button--raise'))
        ?? choices.find((button) => button.classList.contains('action-button--call'))
        ?? choices.find((button) => button.classList.contains('action-button--fold'));
      if (!(choice instanceof HTMLButtonElement)) return null;
      return "hero-decision";
    })()`);
    if (result === "hero-decision") {
      heroDecisionStates ??= await captureHeroDecisionStates(session);
      const submitted = await session.evaluate(`(() => {
        const choices = [...document.querySelectorAll('.action-dock .action-button')]
          .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
        const choice = choices.find((button) => button.classList.contains('action-button--raise'))
          ?? choices.find((button) => button.classList.contains('action-button--call'))
          ?? choices.find((button) => button.classList.contains('action-button--fold'));
        if (!(choice instanceof HTMLButtonElement)) return null;
        choice.click();
        return choice.classList.contains('action-button--raise') ? "preparing-all-in" : "hero-action";
      })()`);
      if (submitted === "hero-action") {
        const handId = await session.evaluate("document.querySelector('.poker-table')?.getAttribute('data-table-hand-id') ?? null");
        return { cameraMoved: !fixedCamera, fixedCamera, presentationSkips, heroAction: true, handId, heroDecisionStates, ...(cameraInputParity ? { cameraInputParity } : {}) };
      }
    }
    if (result === "hero-action") {
      const handId = await session.evaluate("document.querySelector('.poker-table')?.getAttribute('data-table-hand-id') ?? null");
      if (!heroDecisionStates) throw new Error('All-in confirmation appeared before a hero-decision capture.');
      return { cameraMoved: !fixedCamera, fixedCamera, presentationSkips, heroAction: true, handId, heroDecisionStates, ...(cameraInputParity ? { cameraInputParity } : {}) };
    }
    if (result === "presentation") presentationSkips += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 45));
  }
  throw new Error(`No legal hero action appeared after ${presentationSkips} presentation skips.`);
}

/**
 * The physical cards are the ready-mode paint owner, but this uses the same
 * DOM button a player uses to peek. Saving both states proves that the
 * accessibility control remains mounted without reintroducing a visual DOM
 * duplicate over the world cards.
 */
async function captureHeroDecisionStates(session) {
  const stateExpression = `(() => {
    const cards = document.querySelector('.hero-hole-cards');
    const scene = document.querySelector('.poker-scene');
    return cards instanceof HTMLButtonElement ? {
      mounted: true,
      peeked: cards.classList.contains('is-peeked'),
      disabled: cards.disabled,
      scene: scene?.getAttribute('data-spatial-scene') ?? null,
    } : { mounted: false };
  })()`;
  const initial = await session.evaluate(stateExpression);
  if (!initial?.mounted || initial.peeked || initial.disabled) {
    throw new Error(`Hero decision cards were not in the expected unpeeked state: ${JSON.stringify(initial)}`);
  }
  const unpeekedFrame = await session.cdp.send('Page.captureScreenshot', { format: 'png' });
  await session.evaluate(`window.dispatchEvent(new CustomEvent('ptp:gameaction', {
    detail: { actionId: 'game.peek' }, bubbles: true,
  }))`);
  const peeked = await session.poll(`(() => document.querySelector('.hero-hole-cards')?.classList.contains('is-peeked') === true)()`);
  if (!peeked) throw new Error('Hero cards did not enter their ordinary peek state.');
  const peekedFrame = await session.cdp.send('Page.captureScreenshot', { format: 'png' });
  await session.evaluate(`window.dispatchEvent(new CustomEvent('ptp:gameaction', {
    detail: { actionId: 'game.peek' }, bubbles: true,
  }))`);
  const restored = await session.poll(`(() => document.querySelector('.hero-hole-cards')?.classList.contains('is-peeked') === false)()`);
  if (!restored) throw new Error('Hero cards did not return to their unpeeked state.');
  return [
    {
      state: 'unpeeked',
      ...initial,
      screenshotBytes: Math.floor((unpeekedFrame.data?.length ?? 0) * 0.75),
      screenshotPngBase64: unpeekedFrame.data ?? '',
    },
    {
      state: 'peeked',
      mounted: true,
      peeked: true,
      disabled: false,
      scene: initial.scene,
      screenshotBytes: Math.floor((peekedFrame.data?.length ?? 0) * 0.75),
      screenshotPngBase64: peekedFrame.data ?? '',
    },
  ];
}

async function completeCurrentHand(session, initialHandId, publicBeats = [], opponentActionStills = []) {
  if (typeof initialHandId !== "string" || initialHandId.length === 0) {
    throw new Error("Live table did not expose its public hand identifier.");
  }
  // Hands vary with legal all-ins and public queue length. Keep this below the
  // shared CDP deadline, but allow a full legal sequence rather than treating
  // a slow deterministic hand as a recovery failure.
  const deadline = Date.now() + 45_000;
  let actions = 0;
  let presentationSkips = 0;
  let lastSubmittedStateVersion = null;
  let lastState = null;
  const observedBoardCardCounts = new Set();
  while (Date.now() < deadline) {
    const state = await session.evaluate(`(() => {
      const table = document.querySelector('.poker-table');
      const currentHandId = table?.getAttribute('data-table-hand-id') ?? null;
      const stateVersion = table?.getAttribute('data-table-state-version') ?? null;
      const boardCards = document.querySelectorAll('.community-cards .playing-card').length;
      if (currentHandId && currentHandId !== ${JSON.stringify(initialHandId)}) {
        return { complete: true, currentHandId, boardCards };
      }
      if (document.querySelector('.ceremony-board')) return { complete: true, currentHandId, ceremony: true, boardCards };
      const composer = document.querySelector('.bet-composer');
      if (composer instanceof HTMLElement) {
        const allInPreset = [...composer.querySelectorAll('.bet-presets button')]
          .find((button) => /all[- ]in/i.test(button.textContent || ''));
        if (allInPreset instanceof HTMLButtonElement && !allInPreset.classList.contains('is-active')) {
          allInPreset.click();
          return { preparingAllIn: true, currentHandId, stateVersion, boardCards };
        }
        const confirm = composer.querySelector('.primary-button');
        if (confirm instanceof HTMLButtonElement && !confirm.disabled
          && /all[- ]in/i.test(confirm.textContent || '')
          && stateVersion !== ${JSON.stringify(lastSubmittedStateVersion)}) {
          confirm.click();
          return { action: true, currentHandId, stateVersion, boardCards };
        }
        return { currentHandId, stateVersion, boardCards };
      }
      const choices = [...document.querySelectorAll('.action-dock .action-button')]
        .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
      const choice = choices.find((button) => button.classList.contains('action-button--raise'))
        ?? choices.find((button) => button.classList.contains('action-button--call'))
        ?? choices.find((button) => button.classList.contains('action-button--fold'));
      if (!(choice instanceof HTMLButtonElement) || stateVersion === ${JSON.stringify(lastSubmittedStateVersion)}) {
        return { currentHandId, stateVersion, boardCards };
      }
      choice.click();
      return { action: true, currentHandId, stateVersion, boardCards };
    })()`);
    lastState = state;
    if (Number.isInteger(state?.boardCards)) observedBoardCardCounts.add(state.boardCards);
    if (state?.complete) return {
      completed: true,
      actions,
      presentationSkips,
      observedBoardCardCounts: [...observedBoardCardCounts],
      ...(state.ceremony ? { ceremony: true } : {}),
    };
    await capturePublicBeat(session, publicBeats);
    await captureOpponentActionStills(session, opponentActionStills);
    if (state?.action) {
      actions += 1;
      lastSubmittedStateVersion = state.stateVersion;
    }
    // Keep post-action sampling on the browser-frame cadence too. A legal
    // all-in can enqueue several 120ms public beats; waiting one full beat
    // after the click can jump from flop directly to river on a fast package.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 16));
  }
  const domSummary = await session.evaluate(`(() => ({
    table: document.querySelector('.poker-table')?.dataset ?? null,
    pause: Boolean(document.querySelector('.pause-menu')),
    presentation: document.querySelector('.spectator-dock')?.textContent?.trim() ?? null,
    composer: document.querySelector('.bet-composer')?.textContent?.trim() ?? null,
    actionButtons: [...document.querySelectorAll('.action-dock .action-button')].map((button) => ({
      className: button.className,
      disabled: button.disabled,
      text: button.textContent?.trim(),
    })),
  }))()`);
  throw new Error(`Timed out completing hand ${initialHandId} after ${actions} hero actions and ${presentationSkips} presentation skips. Observed board counts: ${JSON.stringify([...observedBoardCardCounts])}. Last state: ${JSON.stringify(lastState)}. DOM: ${JSON.stringify(domSummary)}`);
}

/**
 * Captures the real unequal-cap state used for Direction A's side-pot review.
 * It never reaches into the tournament runner: all advancement is through the
 * mounted action and Skip controls that a player uses. The seed is deliberately
 * allowlisted at the Electron bridge, so this remains package-audit-only.
 */
async function captureTwoSidePotLanes(session, opponentActionStills) {
  // The fixture's two capped side pots occur only after several genuine hands.
  // Stay within this isolated session's audit deadline instead of imposing an
  // unrelated one-minute cap that expires while healthy actions are advancing.
  const deadline = Math.max(Date.now() + 1, session.deadline - 2_000);
  let heroActions = 0;
  let presentationSkips = 0;
  let lastStateVersion = null;
  let lastObservation = null;
  while (Date.now() < deadline) {
    const observation = await session.evaluate(`(() => {
      const table = document.querySelector('.poker-table');
      const potLanes = [...document.querySelectorAll('.pot-group[data-pot-kind]')].map((lane) => ({
        kind: lane.getAttribute('data-pot-kind'),
        amount: Number(lane.getAttribute('data-pot-amount')),
      }));
      return {
        handId: table?.getAttribute('data-table-hand-id') ?? null,
        stateVersion: table?.getAttribute('data-table-state-version') ?? null,
        potLanes,
        sceneObjects: window.__ptpSceneDiagnostics?.snapshot?.().objects ?? null,
      };
    })()`);
    lastObservation = observation;
    /*
      This fixture's unequal caps exist because several players are all-in, so
      it is the natural source of the 'all-in' terminal still. Collecting it here
      is why the primary loop can stay bounded: it never has to shove the hero's
      whole stack, which was busting the hero out of the tournament.
    */
    if (opponentActionStills) await captureOpponentActionStills(session, opponentActionStills);
    const sideLanes = observation?.potLanes?.filter((lane) => lane.kind === "side") ?? [];
    if (sideLanes.length >= 2) {
      // The DOM commits before the renderer frame. Wait one short real-frame
      // interval, then compare both public paint owners before screenshotting.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 48));
      const settled = await session.evaluate(`(() => {
        const lanes = [...document.querySelectorAll('.pot-group[data-pot-kind]')].map((lane) => ({
          kind: lane.getAttribute('data-pot-kind'),
          amount: Number(lane.getAttribute('data-pot-amount')),
        }));
        return {
          handId: document.querySelector('.poker-table')?.getAttribute('data-table-hand-id') ?? null,
          potLanes: lanes,
          sceneObjects: window.__ptpSceneDiagnostics?.snapshot?.().objects ?? null,
        };
      })()`);
      assertSidePotParity(settled);
      const screenshot = await session.cdp.send("Page.captureScreenshot", { format: "png" });
      return {
        ...settled,
        heroActions,
        presentationSkips,
        screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75),
        screenshotPngBase64: screenshot.data ?? "",
      };
    }

    // Skip is intentionally presentation-only: it advances the runner straight
    // to its next hero decision. The fixture's two-lane state occurs in hand 5,
    // so preserve that hand's public queue long enough to inspect its real
    // `side-pot-formed` beats instead of skipping past them invisibly.
    const preserveSidePotHand = /:hand-5$/.test(observation?.handId ?? "");
    const action = await session.evaluate(`(() => {
      const skip = document.querySelector('.skip-hand');
      if (!${JSON.stringify(preserveSidePotHand)} && skip instanceof HTMLButtonElement) {
        skip.click();
        return 'skip';
      }
      const table = document.querySelector('.poker-table');
      const stateVersion = table?.getAttribute('data-table-state-version') ?? null;
      const composer = document.querySelector('.bet-composer');
      if (composer instanceof HTMLElement) {
        const allInPreset = [...composer.querySelectorAll('.bet-presets button')]
          .find((button) => /all[- ]in/i.test(button.textContent || ''));
        if (allInPreset instanceof HTMLButtonElement && !allInPreset.classList.contains('is-active')) {
          allInPreset.click();
          return 'prepare-all-in';
        }
        const confirm = composer.querySelector('.primary-button');
        if (confirm instanceof HTMLButtonElement && !confirm.disabled && /all[- ]in/i.test(confirm.textContent || '')) {
          confirm.click();
          return 'hero-action';
        }
        return null;
      }
      if (stateVersion === ${JSON.stringify(lastStateVersion)}) return null;
      const choices = [...document.querySelectorAll('.action-dock .action-button')]
        .filter((button) => button instanceof HTMLButtonElement && !button.disabled);
      const choice = choices.find((button) => button.classList.contains('action-button--raise'))
        ?? choices.find((button) => button.classList.contains('action-button--call'))
        ?? choices.find((button) => button.classList.contains('action-button--fold'));
      if (!(choice instanceof HTMLButtonElement)) return null;
      choice.click();
      return 'hero-action';
    })()`);
    if (action === "skip") presentationSkips += 1;
    if (action === "hero-action") {
      heroActions += 1;
      lastStateVersion = observation?.stateVersion ?? lastStateVersion;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 24));
  }
  throw new Error(`Timed out before reaching two side-pot lanes after ${heroActions} hero actions and ${presentationSkips} presentation skips. Last observation: ${JSON.stringify(lastObservation)}`);
}

/**
 * Terminal opponent-action stills: fold, check, call, bet, raise, and all-in.
 *
 * Reads the stable `data-seat-action` kind rather than the visible plaque text,
 * which is localized. It only observes the real runner through the same mounted
 * controls the rest of the audit uses -- no engine mocks and no seeded action
 * injection -- so a kind is captured when the tournament actually produces it.
 */
const TERMINAL_OPPONENT_ACTIONS = Object.freeze([
  "fold", "check", "call", "bet", "raise", "all-in",
]);

async function captureOpponentActionStills(session, stills) {
  const pending = TERMINAL_OPPONENT_ACTIONS.filter(
    (action) => !stills.some((still) => still.action === action),
  );
  if (pending.length === 0) return;
  // A screenshot is the one expensive call here; never start one that could
  // straddle the shared CDP deadline and fail an otherwise healthy run.
  if (session.deadline - Date.now() < 8_000) return;
  const observed = await session.evaluate(`(() => {
    /*
      Two sources, both public DOM:

      - the data-seat-action attribute is the presented action beat
        (fold/check/call/bet/raise).
      - the is-all-in class is the *terminal* all-in state, which is what the
        acceptance criterion actually asks for ("each preserve a readable
        terminal state; none relies on the camera move or animation alone"). An
        opponent who calls a shove is presented as a call, so the all-in beat is
        not reliably emitted for them -- but the seat genuinely holds the all-in
        state, and unlike a 1.5 s plaque it persists, which is better evidence.
    */
    const seats = [...document.querySelectorAll('.player-seat[data-seat-action]')];
    for (const seat of document.querySelectorAll(
      '.player-seat.is-all-in:not(.player-seat--hero):not(.is-out)',
    )) {
      if (!seats.includes(seat)) seats.push(seat);
    }
    return seats.map((seat) => ({
      action: seat.classList.contains('is-all-in') && !seat.classList.contains('player-seat--hero')
        ? 'all-in'
        : seat.getAttribute('data-seat-action'),
      playerId: seat.getAttribute('data-scene-player-id'),
      label: seat.querySelector('.seat-action-label')?.textContent?.trim() ?? null,
      stack: Number(seat.getAttribute('data-scene-stack')),
      bet: Number(seat.getAttribute('data-scene-bet')),
      /*
        The action must be *readable* in the still, not merely present.

        This used to read the seat nameplate's opacity. Ready-mode nameplates were
        then removed on purpose -- the owner asked for no floating UI and
        PokerStars VR carries none at its poker tables -- which broke this check
        even though every action was captured correctly. Readability now comes
        from the action plaque that survived, or, for an all-in, from the seat's
        own terminal state class, which is what that still is evidencing anyway.
      */
      plaqueVisible: (() => {
        const label = seat.querySelector('.seat-action-label');
        if (label instanceof HTMLElement) {
          const box = label.getBoundingClientRect();
          if (box.width > 0 && box.height > 0
            && Number(getComputedStyle(label).opacity) > 0.5) return true;
        }
        return seat.classList.contains('is-all-in');
      })(),
    }));
  })()`);
  const match = (observed ?? []).find((seat) => pending.includes(seat.action));
  if (!match) return;
  /*
    Wait for the action plaque to finish fading in before capturing.

    The plaque animates from transparent, and this samples the moment the action
    first appears -- so a screenshot taken immediately caught it mid-fade and the
    readability check failed on a still that was otherwise perfectly good. Polling
    for the settled opacity keeps the assertion strict rather than lowering the
    threshold to accommodate a frame that genuinely was not readable yet.
  */
  await session.poll(`(() => {
    const seat = [...document.querySelectorAll('.player-seat')].find((entry) =>
      entry.getAttribute('data-scene-player-id') === ${JSON.stringify(match.playerId)});
    if (!seat) return false;
    if (seat.classList.contains('is-all-in')) return true;
    const label = seat.querySelector('.seat-action-label');
    if (!(label instanceof HTMLElement)) return false;
    const box = label.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      && Number(getComputedStyle(label).opacity) > 0.5;
  })()`, { intervalMs: 16 });
  // Re-read so the recorded state is the one the screenshot actually shows.
  const settled = await session.evaluate(`(() => {
    const seat = [...document.querySelectorAll('.player-seat')].find((entry) =>
      entry.getAttribute('data-scene-player-id') === ${JSON.stringify(match.playerId)});
    if (!seat) return null;
    const label = seat.querySelector('.seat-action-label');
    const box = label instanceof HTMLElement ? label.getBoundingClientRect() : null;
    return {
      plaqueVisible: seat.classList.contains('is-all-in') || Boolean(box && box.width > 0
        && box.height > 0 && Number(getComputedStyle(label).opacity) > 0.5),
      label: label?.textContent?.trim() ?? null,
    };
  })()`);
  if (settled?.plaqueVisible !== true) return;
  match.plaqueVisible = true;
  match.label = settled.label ?? match.label;
  /*
    `Page.captureScreenshot` waits for a compositor frame, and an occluded or
    unfocused Electron window may not produce one -- the same window-manager
    race the input smoke handles with `Page.bringToFront`. A timeout here means
    "this frame was not capturable", not "the app is broken", so it must not
    abort an otherwise healthy audit: the plaque holds for about 1.5 s, so the
    next poll gets another chance at the same action.
  */
  let frame;
  try {
    frame = await session.cdp.send("Page.captureScreenshot", { format: "png" });
  } catch (error) {
    if (!/timed out/i.test(error instanceof Error ? error.message : String(error))) throw error;
    await session.cdp.send("Page.bringToFront").catch(() => {});
    return;
  }
  if (typeof frame?.data !== "string" || frame.data.length === 0) return;
  stills.push({
    ...match,
    screenshotBytes: Math.floor(frame.data.length * 0.75),
    screenshotPngBase64: frame.data,
  });
}

/**
 * Record one public snapshot per street from inside the page.
 *
 * The forced-DOM fallback has no renderer loop, so its presentation queue can
 * advance through a legal all-in runout *between* two CDP round trips -- which
 * is why that path previously proved only its initial preflop capture. An
 * in-page observer cannot miss a street it actually rendered, so the two paths
 * become comparable across the whole runout rather than at one beat.
 *
 * It is pure observation of the same public DOM the screenshots show; it never
 * reads engine state or hole cards.
 */
async function installPublicRunoutRecorder(session) {
  const installed = await session.evaluate(`(() => {
    if (window.__ptpRunoutRecorder) return true;
    const byHandStreet = new Map();
    const read = () => {
      const table = document.querySelector('.poker-table');
      if (!table) return;
      const cards = [...document.querySelectorAll('.community-cards .playing-card')];
      const street = ({ 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' })[cards.length];
      if (!street) return;
      const handId = table.getAttribute('data-table-hand-id');
      const key = handId + ':' + street;
      if (byHandStreet.has(key)) return;
      byHandStreet.set(key, {
        handId,
        street,
        boardCards: cards.length,
        boardCardCodes: cards.map((card) => {
          const rank = card.querySelector('b')?.textContent?.trim() ?? '';
          const suit = card.querySelector('i')?.textContent?.trim() ?? '';
          return rank && suit ? rank + suit : null;
        }),
        scenePot: Number(table.getAttribute('data-scene-pot')),
        potLanes: [...document.querySelectorAll('.pot-group[data-pot-kind]')].map((lane) => ({
          kind: lane.getAttribute('data-pot-kind'),
          amount: Number(lane.getAttribute('data-pot-amount')),
        })),
        seats: [...document.querySelectorAll('.player-seat[data-scene-player-id]:not(.is-out)')]
          .map((seat) => ({
            id: seat.getAttribute('data-scene-player-id'),
            stack: Number(seat.getAttribute('data-scene-stack')),
            bet: Number(seat.getAttribute('data-scene-bet')),
          })),
        unrevealedOpponentFaceCount: document.querySelectorAll(
          '.player-seat:not(.player-seat--hero):not(.is-revealed) .playing-card:not(.playing-card--back)',
        ).length,
      });
    };
    // Sample on every commit *and* every frame: a MutationObserver alone can
    // coalesce, and a frame loop alone can be throttled.
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    const tick = () => { read(); window.requestAnimationFrame(tick); };
    window.requestAnimationFrame(tick);
    window.__ptpRunoutRecorder = { records: byHandStreet, read };
    return true;
  })()`);
  if (installed !== true) throw new Error("Could not install the public runout recorder.");
}

async function readPublicRunout(session) {
  const records = await session.evaluate(`(() => {
    const recorder = window.__ptpRunoutRecorder;
    if (!recorder) return null;
    recorder.read();
    return [...recorder.records.values()];
  })()`);
  if (!Array.isArray(records)) throw new Error("Public runout recorder was unavailable.");
  return records;
}

async function capturePublicBeat(session, beats) {
  const readObservation = `(() => {
    const table = document.querySelector('.poker-table');
    const sceneRoot = table?.closest('.poker-scene');
    const boardCards = document.querySelectorAll('.community-cards .playing-card').length;
    const street = ({ 0: 'preflop', 3: 'flop', 4: 'turn', 5: 'river' })[boardCards];
    if (!street) return null;
    const codeFor = (card) => {
      const rank = card.querySelector('b')?.textContent?.trim() ?? '';
      const suit = card.querySelector('i')?.textContent?.trim() ?? '';
      return rank && suit ? rank + suit : null;
    };
    const playerIdFor = (element) => element?.closest('.player-seat')?.getAttribute('data-scene-player-id') ?? null;
    const markerPlayerId = (label) => playerIdFor([...document.querySelectorAll('.seat-position-marker')]
      .find((marker) => marker.textContent?.trim() === label));
    return {
      street,
      boardCards,
      boardCardCodes: [...document.querySelectorAll('.community-cards .playing-card')].map(codeFor),
      scenePot: Number(table?.getAttribute('data-scene-pot')),
      potLanes: [...document.querySelectorAll('.pot-group[data-pot-kind]')].map((lane) => ({
        kind: lane.getAttribute('data-pot-kind'),
        amount: Number(lane.getAttribute('data-pot-amount')),
      })),
      seats: [...document.querySelectorAll('.player-seat[data-scene-player-id]:not(.is-out)')].map((seat) => ({
        id: seat.getAttribute('data-scene-player-id'),
        stack: Number(seat.getAttribute('data-scene-stack')),
        bet: Number(seat.getAttribute('data-scene-bet')),
      })),
      markerPlayerIds: {
        button: playerIdFor(document.querySelector('.dealer-button')),
        smallBlind: markerPlayerId('SB'),
        bigBlind: markerPlayerId('BB'),
      },
      actingPlayerId: document.querySelector('.player-seat[data-scene-acting="true"]')?.getAttribute('data-scene-player-id') ?? null,
      sceneObjects: window.__ptpSceneDiagnostics?.snapshot?.().objects ?? null,
      unrevealedOpponentFaceCount: document.querySelectorAll(
        '.player-seat:not(.player-seat--hero):not(.is-revealed) .playing-card:not(.playing-card--back)',
      ).length,
    };
  })()`;
  let observation = await session.evaluate(readObservation);
  if (!observation || beats.some((beat) => beat.street === observation.street)) return;
  // React commits the accessible DOM before the next renderer frame.  Capture
  // only after that frame has reconciled the publicly visible board; a fixed
  // sleep here would make a slow GPU look like an object-parity failure.
  if (observation.sceneObjects) {
    const settled = await session.poll(`(() => {
      const objects = window.__ptpSceneDiagnostics?.snapshot?.().objects;
      const codes = [...document.querySelectorAll('.community-cards .playing-card')].map((card) => {
        const rank = card.querySelector('b')?.textContent?.trim() ?? '';
        const suit = card.querySelector('i')?.textContent?.trim() ?? '';
        return rank && suit ? rank + suit : null;
      });
      return Array.isArray(objects?.boardCardCodes)
        && JSON.stringify(objects.boardCardCodes) === JSON.stringify(codes);
    })()`, { intervalMs: 16 });
    if (!settled) {
      throw new Error(`Renderer did not reconcile the public ${observation.street} board before the CDP deadline.`);
    }
    observation = await session.evaluate(readObservation);
  }
  const screenshot = await session.cdp.send('Page.captureScreenshot', { format: 'png' });
  beats.push({ ...observation, screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75), screenshotPngBase64: screenshot.data ?? '' });
}

async function reachTableWithScene(session, requestedMotionMode = "full") {
  await session.reachHome();
  await session.clickSelector('button[aria-label="Settings"]', "settings");
  const enabled = await session.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find((entry) =>
      (entry.textContent || '').includes('3D room (preview)'));
    const input = label?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) return false;
    if (!input.checked) input.click();
    return input.checked;
  })()`);
  if (!enabled) throw new Error("Could not enable the 3D room preview.");
  const configuredMotion = await session.evaluate(`(() => {
    const requested = ${JSON.stringify(requestedMotionMode)};
    const reducedLabel = [...document.querySelectorAll('label')].find((entry) =>
      (entry.textContent || '').includes('Reduce motion'));
    const reducedInput = reducedLabel?.querySelector('input[type="checkbox"]');
    if (!(reducedInput instanceof HTMLInputElement)) return false;
    if (requested === 'reduced') {
      if (!reducedInput.checked) reducedInput.click();
      return reducedInput.checked;
    }
    if (reducedInput.checked) reducedInput.click();
    const group = document.querySelector('[aria-labelledby="camera-motion-heading"]');
    const button = [...(group?.querySelectorAll('button') ?? [])]
      .find((entry) => entry.textContent?.trim().toLowerCase() === requested);
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!configuredMotion) throw new Error(`Could not configure ${requestedMotionMode} motion for the 3D audit.`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  await session.clickSelector(".night-back", "settings back");
  await session.clickSelector('button[aria-label="Play"]', "play");
  await session.clickIfPresent("#play-chip-ack-title ~ .startup-gate__actions button");
  await session.waitFor(".mode-stage", "mode selection");
  await session.clickSelector(".mode-stage__choice--normal", "normal mode");
  await session.waitForButton("Enter event", "event lobby");
  await session.clickButton("Enter event");
  await session.waitFor(".room-flight", "room arrival");
  await session.clickButton("Skip arrival");
  await session.waitFor(".poker-table", "live table");
  await installPublicRunoutRecorder(session);
}

/**
 * A newly launched visible native audit window can receive a transient blur
 * while Electron finishes sizing it. The application correctly pauses in that
 * case; the evidence harness must explicitly resume rather than screenshot a
 * healthy scene behind a pause card.
 */
async function resumeTableIfPaused(session) {
  const paused = await session.evaluate("document.querySelector('.pause-menu .primary-button') instanceof HTMLButtonElement");
  if (!paused) return;
  await session.clickSelector(".pause-menu .primary-button", "resume table before matrix capture");
  await session.waitFor(".poker-table", "live table after matrix resume");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
}

async function observe(session) {
  const observation = await session.evaluate(`(() => {
    const table = document.querySelector('.poker-table');
    const sceneRoot = table?.closest('.poker-scene');
    const canvas = document.querySelector('.table-scene-3d');
    const canvasStyle = canvas instanceof HTMLCanvasElement ? getComputedStyle(canvas) : null;
    const canvasBounds = canvas instanceof HTMLCanvasElement ? canvas.getBoundingClientRect() : null;
    const tableStyle = table ? getComputedStyle(table) : null;
    const opacityOf = (selector) => {
      const element = sceneRoot?.querySelector(selector);
      return element ? Number(getComputedStyle(element).opacity) : null;
    };
    const duplicateFurnitureOpacity = Object.fromEntries(
      ['.seat-figure', '.seat-chip-stack', '.center-pot'].map((selector) => [selector, opacityOf(selector)]),
    );
    /*
      These are the same violation but only mounted for part of a hand, so an
      absent element is legitimately "not painting".  They are checked because a
      *running animation* with fill 'both' keyframes opacity, which outranks the
      ready-mode 'opacity: 0' declaration in the cascade: '.opponent-cards' and
      '.seat-bet' kept painting DOM duplicates over the physical scene while this
      check sampled only the three selectors that happen to have no animation.
      getComputedStyle reports the animated value, which is what closes the gap.
    */
    const conditionalDuplicateOpacity = Object.fromEntries(
      ['.opponent-cards', '.opponent-card-hand', '.seat-bet', '.dealer-button']
        .map((selector) => [selector, opacityOf(selector)]),
    );
    const readableHud = {
      seatLabelCount: sceneRoot?.querySelectorAll('.seat-label').length ?? 0,
      publicBoardMounted: Boolean(table?.querySelector('.community-cards')),
      cameraControls: Boolean(document.querySelector('.camera-controls')),
    };
    return {
      diagnostics: window.__ptpSceneDiagnostics?.snapshot?.() ?? null,
      forceFlag: window.desktop?.forceWebGl2Failure === true,
      scene: table?.dataset.spatialScene ?? 'fallback',
      tableCount: document.querySelectorAll('.poker-table').length,
      seatCount: document.querySelectorAll('.player-seat').length,
      liveRegionCount: document.querySelectorAll('[aria-live]').length,
      pauseMenu: Boolean(document.querySelector('.pause-menu')),
      motion: {
        reducedMotion: document.documentElement.classList.contains('reduced-motion'),
        rootCamera: document.documentElement.dataset.motionCamera ?? null,
        tableCamera: document.querySelector('.table-screen')?.getAttribute('data-camera-motion') ?? null,
      },
      canvas: canvas instanceof HTMLCanvasElement,
      ariaHidden: canvas?.getAttribute('aria-hidden'),
      tabIndex: canvas?.getAttribute('tabindex'),
      canvasVisible: Boolean(canvasBounds && canvasBounds.width > 0 && canvasBounds.height > 0
        && canvasStyle?.display !== 'none' && canvasStyle?.visibility !== 'hidden'
        && Number(canvasStyle?.opacity) > 0),
      tableOpacity: table ? Number(tableStyle?.opacity) : null,
      nativeWindow: {
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio,
        compactHeightMediaActive: window.matchMedia('(max-height: 800px)').matches,
      },
      // Read computed styles rather than pixels: this catches the exact
      // regression where a healthy canvas was mounted behind an opaque DOM
      // felt, while keeping renderer output and accessibility separate.
      composition: {
        // open-arc-v1 changes the DOM anchor from an ellipse into a full
        // viewport, so chromium no longer serializes the old transparent
        // shorthand consistently.  The explicit ready attribute plus an
        // unfaded physical mirror is the stable ownership contract.
        surfaceTransparent: table?.dataset.spatialScene === 'ready'
          && Object.values(duplicateFurnitureOpacity).every((opacity) => opacity !== null && opacity <= 0.06),
        surfaceRestored: tableStyle?.backgroundImage !== 'none'
          && tableStyle?.boxShadow !== 'none'
          && tableStyle?.borderTopColor !== 'rgba(0, 0, 0, 0)',
        duplicateFurnitureOpacity,
        duplicateFurnitureFaded: Object.values(duplicateFurnitureOpacity)
          .every((opacity) => opacity !== null && opacity <= 0.06),
        conditionalDuplicateOpacity,
        // Absent is fine; mounted and painting is not.
        conditionalDuplicatesFaded: Object.values(conditionalDuplicateOpacity)
          .every((opacity) => opacity === null || opacity <= 0.06),
        readableHud,
        readableHudMounted: readableHud.seatLabelCount >= 2
          && readableHud.publicBoardMounted && readableHud.cameraControls,
      },
    };
  })()`);
  if (!observation) throw new Error("Could not observe packaged scene diagnostics.");
  return observation;
}

async function captureCompositionMatrix(extraArguments, requestedMotionMode, requestedSeed) {
  const captures = [];
  for (const viewport of compositionViewports) {
    // A separate native window per target prevents the visual-viewport-only
    // CDP emulation trap: Electron's compact-height CSS is driven by actual
    // window geometry, so this is the only matrix that proves the breakpoint.
    const session = await PackagedSession.launch({
      appPath,
      profilePrefix: `poker-training-pro-3d-audit-webgl2-${viewport.name}-`,
      timeoutMs,
      extraArguments: [
        "--ptp-lifecycle-smoke",
        `--ptp-scene-audit-seed=${requestedSeed}`,
        ...extraArguments,
        `--ptp-audit-window-size=${viewport.width}x${viewport.height}`,
      ],
      windowsHide: false,
    });
    try {
      await session.cdp.send("Log.enable");
      await reachTableWithScene(session, requestedMotionMode);
      await resumeTableIfPaused(session);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      const observation = await observe(session);
      const screenshot = await session.cdp.send("Page.captureScreenshot", { format: "png" });
      // Direction A requires an actual five-second silent native review at
      // its two desktop reference targets. Keep the same native window and
      // intentionally send no input while it settles, rather than treating an
      // immediate boot frame as perceptual evidence.
      let silentReview;
      if (viewport.name === "1366x768" || viewport.name === "1920x1080") {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
        const silentFrame = await session.cdp.send("Page.captureScreenshot", { format: "png" });
        silentReview = {
          durationMs: 5_000,
          screenshotBytes: Math.floor((silentFrame.data?.length ?? 0) * 0.75),
          screenshotPngBase64: silentFrame.data ?? "",
        };
      }
      const fixedCamera = requestedMotionMode === "reduced" || requestedMotionMode === "off";
      const capturePan = async (pose) => {
        await resumeTableIfPaused(session);
        const frame = await session.cdp.send("Page.captureScreenshot", { format: "png" });
        const fixed = fixedCamera ? await session.evaluate(fixedCameraControlExpression()) : undefined;
        return { pose, ...(fixedCamera ? { fixedCamera: fixed } : {}), screenshotBytes: Math.floor((frame.data?.length ?? 0) * 0.75), screenshotPngBase64: frame.data ?? "" };
      };
      const panFrames = [await capturePan("recenter")];
      if (!fixedCamera) {
        await session.clickSelector('button[aria-label="Look one seat left"]', "matrix camera left 1");
        await session.clickSelector('button[aria-label="Look one seat left"]', "matrix camera left 2");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
      }
      panFrames.push(await capturePan("left"));
      if (!fixedCamera) {
        await session.clickSelector('button[aria-label="Recenter the table view"]', "matrix camera recenter");
        await session.clickSelector('button[aria-label="Look one seat right"]', "matrix camera right 1");
        await session.clickSelector('button[aria-label="Look one seat right"]', "matrix camera right 2");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
      }
      panFrames.push(await capturePan("right"));
      captures.push({ viewport: viewport.name, ...observation, screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75), screenshotPngBase64: screenshot.data ?? "", ...(silentReview ? { silentReview } : {}), panFrames });
    } finally {
      await session.dispose();
    }
  }
  return captures;
}

async function minimizeAndRestore(session) {
  // Observe immediately before the native transition for diagnostic context.
  // Electron's native minimize acknowledgement can itself span frames, so the
  // actual freeze assertion below compares two post-suspend observations.
  const beforeMinimize = await observe(session);
  const minimized = await session.evaluate("window.desktop?.testLifecycleWindow?.('minimize')");
  if (minimized?.ok !== true) throw new Error("Lifecycle bridge could not minimize the packaged window.");
  await session.waitFor(".pause-menu", "pause menu after native minimize");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const minimizedStart = await observe(session);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const minimizedObservation = await observe(session);
  const restored = await session.evaluate("window.desktop?.testLifecycleWindow?.('restore')");
  if (restored?.ok !== true) throw new Error("Lifecycle bridge could not restore the packaged window.");
  await session.clickSelector(".pause-menu .primary-button", "explicit table resume");
  await session.waitFor(".poker-table", "table after explicit resume");
  return {
    beforeMinimize,
    minimizedStart,
    minimized: minimizedObservation,
    restored: await observe(session),
  };
}

async function repeatContextRecovery(session, baselineContextLosses) {
  const attempts = [];
  let rebuiltResourceBaseline = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const loss = await session.evaluate(`(() => {
      const canvas = document.querySelector('.table-scene-3d');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const context = canvas.getContext('webgl2');
      const extension = context?.getExtension('WEBGL_lose_context');
      if (!extension) return { supported: false };
      // A genuinely lost context is no longer reacquirable from the canvas.
      // Retain this browser-provided extension object solely in the isolated
      // CDP page so its paired restore call reaches the same context.
      window.__ptpAuditWebglLoseContext = extension;
      extension.loseContext();
      return { supported: true, mechanism: 'WEBGL_lose_context' };
    })()`);
    if (loss?.supported !== true) {
      throw new Error("Packaged WebGL2 did not expose WEBGL_lose_context for a real context-loss audit.");
    }
    if (!await session.poll("window.__ptpSceneDiagnostics?.snapshot?.().availability === 'lost'")) {
      throw new Error("Scene diagnostics did not classify context loss.");
    }
    const fallback = await observe(session);
    const restore = await session.evaluate(`(() => {
      const extension = window.__ptpAuditWebglLoseContext;
      if (!extension) return { supported: false };
      extension.restoreContext();
      delete window.__ptpAuditWebglLoseContext;
      return { supported: true };
    })()`);
    if (restore?.supported !== true) throw new Error("Lost WebGL2 context could not be restored by WEBGL_lose_context.");
    if (!await session.poll("window.__ptpSceneDiagnostics?.snapshot?.().availability === 'ready'")) {
      throw new Error("Scene diagnostics did not return to ready after context restore.");
    }
    const restored = await observe(session);
    if (!Number.isFinite(restored.diagnostics?.resources)
      || (rebuiltResourceBaseline !== null && restored.diagnostics.resources !== rebuiltResourceBaseline)
      || restored.diagnostics.contextLosses !== baselineContextLosses + attempt + 1) {
      throw new Error(`Context recovery allocation drift at attempt ${attempt + 1}: ${JSON.stringify(restored.diagnostics)}`);
    }
    // A context rebuild deliberately projects the latest public state. The
    // original scene can be one presentation frame behind it, so attempt one
    // establishes the rebuilt-state allocation baseline; attempts two and
    // three must then be byte-for-byte stable.
    rebuiltResourceBaseline ??= restored.diagnostics.resources;
    attempts.push({ loss, restore, fallback, restored });
  }
  return { attempts };
}

export function assertCase(result) {
  const before = result.before;
  const expectedRootCameraMotion = result.motionMode === "reduced" ? "off" : result.motionMode;
  // Global reduced motion overrides the effective root policy without
  // overwriting the player's stored per-surface preference. Fixed-camera off
  // is the only case that intentionally changes the stored table preference.
  const expectedTableCameraMotion = result.motionMode === "off" ? "off" : "full";
  const expectedReducedMotion = result.motionMode === "reduced";
  if (result.fatal.length > 0) throw new Error(`Fatal renderer event: ${JSON.stringify(result.fatal)}`);
  if (before.tableCount !== 1 || before.seatCount < 2 || before.liveRegionCount < 1 || !before.canvas) {
    throw new Error(`Accessible DOM/canvas missing: ${JSON.stringify(before)}`);
  }
  if (before.ariaHidden !== "true" || before.tabIndex !== "-1") {
    throw new Error(`Canvas accessibility contract changed: ${JSON.stringify(before)}`);
  }
  if (before.pauseMenu || before.motion?.rootCamera !== expectedRootCameraMotion
    || before.motion?.tableCamera !== expectedTableCameraMotion
    || before.motion?.reducedMotion !== expectedReducedMotion) {
    throw new Error(`Packaged motion preference or active-table state was not preserved: ${JSON.stringify(before.motion)}`);
  }
  if (!before.diagnostics) throw new Error("Scene diagnostics bridge was unavailable.");
  assertDiagnosticSchema(before.diagnostics, result.kind === "webgl2");
  if (before.diagnostics.drawCalls > sceneBudgets.drawCalls
    || before.diagnostics.triangles > sceneBudgets.triangles
    || before.diagnostics.textureEstimateMiB > sceneBudgets.textureEstimateMiB
    || before.diagnostics.frameP95Ms > sceneBudgets.frameP95Ms) {
    throw new Error(`Scene budget exceeded: ${JSON.stringify(before.diagnostics)}`);
  }
  const fixedCamera = result.motionMode === "reduced" || result.motionMode === "off";
  if ((fixedCamera ? !result.interaction?.fixedCamera || result.interaction?.cameraMoved : !result.interaction?.cameraMoved)
    || !result.interaction?.heroAction || !result.interaction?.completedHand?.completed) {
    throw new Error(`Scene audit did not complete a legal hand through camera and ordinary controls: ${JSON.stringify(result.interaction)}`);
  }
  if (!fixedCamera) {
    const parity = result.interaction?.cameraInputParity;
    const routes = parity?.routes;
    if (!parity?.agreed || !Array.isArray(routes) || routes.length !== 3
      || ["pointer", "keyboard", "gamepad"].some((via, index) => routes[index]?.via !== via)
      || routes.some((route) => route.canvasFocused !== false)) {
      throw new Error(`Pointer, keyboard, and controller did not reach identical scene-camera states: ${JSON.stringify(parity)}`);
    }
  }
  const heroDecisionStates = result.interaction?.heroDecisionStates;
  if (!Array.isArray(heroDecisionStates) || heroDecisionStates.length !== 2
    || heroDecisionStates[0]?.state !== 'unpeeked' || heroDecisionStates[0]?.peeked !== false
    || heroDecisionStates[1]?.state !== 'peeked' || heroDecisionStates[1]?.peeked !== true
    || heroDecisionStates.some((state) => !Number.isFinite(state?.screenshotBytes) || state.screenshotBytes <= 0
      || typeof state?.screenshotPngBase64 !== 'string' || state.screenshotPngBase64.length === 0)) {
    throw new Error(`Packaged hero decision/peek evidence was incomplete: ${JSON.stringify(heroDecisionStates)}`);
  }
  const expectedPublicBeats = [["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5]];
  // WebGL owns physical card reconciliation, so it must expose every public
  // street.  The forced path intentionally has no renderer loop: its DOM
  // staging may advance through a legal all-in runout between CDP samples.
  // There we require an initial public capture plus the completed authoritative
  // hand/fallback checks below, not renderer-frame cadence it cannot provide.
  const publicBeatFailure = result.kind === "webgl2"
    ? !Array.isArray(result.publicBeats) || result.publicBeats.length !== expectedPublicBeats.length
      || result.publicBeats.some((beat, index) => beat?.street !== expectedPublicBeats[index][0]
        || beat?.boardCards !== expectedPublicBeats[index][1]
        || beat?.unrevealedOpponentFaceCount !== 0
        || !Number.isFinite(beat?.screenshotBytes) || beat.screenshotBytes <= 0
        || typeof beat?.screenshotPngBase64 !== "string" || beat.screenshotPngBase64.length === 0)
    : !Array.isArray(result.publicBeats) || result.publicBeats.length < 1
      || result.publicBeats.some((beat) => beat?.unrevealedOpponentFaceCount !== 0
        || !Number.isFinite(beat?.screenshotBytes) || beat.screenshotBytes <= 0
        || typeof beat?.screenshotPngBase64 !== "string" || beat.screenshotPngBase64.length === 0);
  if (publicBeatFailure) {
    const publicBeatSummary = result.publicBeats?.map(({ screenshotPngBase64, ...beat }) => beat);
    throw new Error(`Packaged public street captures were incomplete or exposed an unrevealed opponent card: ${JSON.stringify(publicBeatSummary)}. Interaction: ${JSON.stringify(result.interaction)}`);
  }
  if (result.kind === "webgl2") {
    assertOpponentActionStills(
      result.opponentActions,
      result.sceneAuditSeed === "scene-side-pot-0",
    );
    for (const beat of result.publicBeats) assertPublicObjectParity(beat);
    if (result.sceneAuditSeed === "scene-side-pot-0") {
      const capture = result.sidePotCapture;
      if (!capture || !Number.isFinite(capture.screenshotBytes) || capture.screenshotBytes <= 0
        || typeof capture.screenshotPngBase64 !== "string" || capture.screenshotPngBase64.length === 0) {
        throw new Error(`Two-side-pot packaged capture was incomplete: ${JSON.stringify(capture)}`);
      }
      assertSidePotParity(capture);
    }
  }
  if (result.kind === "webgl2") {
    if (before.scene !== "ready" || before.diagnostics.availability !== "ready" || !before.canvasVisible) {
      throw new Error(`WebGL scene did not become ready: ${JSON.stringify(before)}`);
    }
    if (!before.composition?.surfaceTransparent || !before.composition?.duplicateFurnitureFaded
      || !before.composition?.conditionalDuplicatesFaded
      || !before.composition?.readableHudMounted) {
      throw new Error(`WebGL scene composition did not reveal 3D furniture while retaining the DOM HUD: ${JSON.stringify(before.composition)}`);
    }
    if (!Array.isArray(result.compositionMatrix) || result.compositionMatrix.length !== compositionViewports.length
      || result.compositionMatrix.some((capture, index) => capture?.viewport !== compositionViewports[index].name
        || capture?.pauseMenu || capture?.motion?.rootCamera !== expectedRootCameraMotion
        || capture?.motion?.tableCamera !== expectedTableCameraMotion
        || capture?.motion?.reducedMotion !== expectedReducedMotion
        || capture?.scene !== "ready" || !capture?.canvasVisible || !capture?.composition?.surfaceTransparent
        || !capture?.composition?.duplicateFurnitureFaded
        || !capture?.composition?.conditionalDuplicatesFaded
        || !capture?.composition?.readableHudMounted
        || !nativeWindowMatches(capture?.nativeWindow, compositionViewports[index])
        || capture?.nativeWindow?.compactHeightMediaActive !== (compositionViewports[index].height <= 800)
        || !Number.isFinite(capture?.screenshotBytes) || capture.screenshotBytes <= 0
        || typeof capture?.screenshotPngBase64 !== "string" || capture.screenshotPngBase64.length === 0
        || (["1366x768", "1920x1080"].includes(capture?.viewport)
          && (capture?.silentReview?.durationMs !== 5_000
            || !Number.isFinite(capture?.silentReview?.screenshotBytes)
            || capture.silentReview.screenshotBytes <= 0
            || typeof capture.silentReview.screenshotPngBase64 !== "string"
            || capture.silentReview.screenshotPngBase64.length === 0))
        || !Array.isArray(capture?.panFrames) || capture.panFrames.length !== 3
        || capture.panFrames.some((frame, panIndex) => frame?.pose !== ["recenter", "left", "right"][panIndex]
          || (fixedCamera && frame?.fixedCamera !== true)
          || !Number.isFinite(frame?.screenshotBytes) || frame.screenshotBytes <= 0
          || typeof frame?.screenshotPngBase64 !== "string" || frame.screenshotPngBase64.length === 0))) {
      throw new Error(`Scene-ready composition matrix was incomplete: ${JSON.stringify(result.compositionMatrix)}`);
    }
    if (before.diagnostics.frameCount < 2 || !before.diagnostics.renderer) {
      throw new Error(`Renderer diagnostics were incomplete: ${JSON.stringify(before.diagnostics)}`);
    }
    const minimized = result.lifecycle?.minimized?.diagnostics;
    const minimizedStart = result.lifecycle?.minimizedStart?.diagnostics;
    if (!minimizedStart?.suspended || minimizedStart.running
      || !minimized?.suspended || minimized.running || minimized.frameCount !== minimizedStart.frameCount) {
      throw new Error(`Scene rendered while minimized: ${JSON.stringify(result.lifecycle)}`);
    }
    const recoveryAttempts = result.recovery?.attempts;
    if (!Array.isArray(recoveryAttempts) || recoveryAttempts.length !== 3) {
      throw new Error(`Scene did not complete three bounded recovery attempts: ${JSON.stringify(result.recovery)}`);
    }
    let rebuiltResourceBaseline = null;
    for (const [index, recovery] of recoveryAttempts.entries()) {
      const fallback = recovery?.fallback;
      if (recovery?.loss?.supported !== true || recovery?.loss?.mechanism !== "WEBGL_lose_context"
        || recovery?.restore?.supported !== true || fallback?.diagnostics?.lastContextLossTrusted !== true
        || fallback?.diagnostics?.lastContextLossDefaultPrevented !== true
        || fallback?.scene !== "fallback"
        || fallback?.diagnostics?.availability !== "lost" || fallback.tableOpacity !== 1
        || !fallback?.composition?.surfaceRestored
        || fallback.tableCount !== 1 || fallback.seatCount < 2 || fallback.liveRegionCount < 1) {
        throw new Error(`Context loss did not restore DOM fallback: ${JSON.stringify(recovery)}`);
      }
      if (recovery.restored?.scene !== "ready" || recovery.restored.diagnostics?.availability !== "ready"
        || recovery.restored.diagnostics.contextLosses !== before.diagnostics.contextLosses + index + 1
        || !Number.isFinite(recovery.restored.diagnostics.resources)
        || (rebuiltResourceBaseline !== null
          && recovery.restored.diagnostics.resources !== rebuiltResourceBaseline)) {
        throw new Error(`Context restore did not rebuild stable scene resources: ${JSON.stringify(recovery)}`);
      }
      rebuiltResourceBaseline ??= recovery.restored.diagnostics.resources;
    }
  } else if (before.forceFlag !== true || before.scene !== "fallback" || before.tableOpacity !== 1
    || !before.composition?.surfaceRestored || before.diagnostics.availability !== "failed"
    || typeof before.diagnostics.reason !== "string") {
    throw new Error(`Forced WebGL failure did not stay on DOM fallback: ${JSON.stringify(before)}`);
  }
}

function fixedCameraControlExpression() {
  return `(() => {
    const left = document.querySelector('button[aria-label="Look one seat left"]');
    const right = document.querySelector('button[aria-label="Look one seat right"]');
    const center = document.querySelector('button[aria-label="Recenter the table view"]');
    return left instanceof HTMLButtonElement && right instanceof HTMLButtonElement
      && center instanceof HTMLButtonElement && left.disabled && right.disabled
      && center.disabled && /Centered/i.test(center.textContent || '');
  })()`;
}

function assertPublicObjectParity(beat) {
  const objects = beat?.sceneObjects;
  if (!objects || !Array.isArray(objects.boardCardCodes) || !Array.isArray(objects.seats)
    || !objects.markers || !Number.isFinite(beat.scenePot)) {
    throw new Error(`Renderer object diagnostics were unavailable: ${JSON.stringify(beat)}`);
  }
  // Direction A renders each public main/side lane as a physical pile.  A
  // split pot therefore has more visible chips than a single compressed pile
  // for the same aggregate amount; require the aggregate's readable minimum
  // rather than incorrectly treating multiple lanes as one object.
  if (JSON.stringify(objects.boardCardCodes) !== JSON.stringify(beat.boardCardCodes)
    || objects.potChipCount < chipCountForAmount(beat.scenePot)) {
    throw new Error(`Physical board or pot did not match mounted DOM: ${JSON.stringify(beat)}`);
  }
  const expectedPotLanes = beat.potLanes ?? [];
  if (!Array.isArray(objects.potLanes) || objects.potLanes.length !== expectedPotLanes.length
    || objects.potLanes.some((lane, index) => lane.amount !== expectedPotLanes[index]?.amount)) {
    throw new Error(`Physical pot lanes did not match mounted DOM: ${JSON.stringify(beat)}`);
  }
  const expectedSeats = new Map(beat.seats.map((seat) => [seat.id, seat]));
  if (objects.seats.some((seat) => {
    const expected = expectedSeats.get(seat.id);
    return !expected || Object.hasOwn(seat, "cardCodes")
      || seat.stackChipCount !== chipCountForAmount(expected.stack)
      || seat.betChipCount !== chipCountForAmount(expected.bet);
  }) || objects.seats.length !== expectedSeats.size) {
    if (objects.seats.some((seat) => Object.hasOwn(seat, "cardCodes"))) {
      throw new Error(`Renderer object diagnostics leaked seat card identities: ${JSON.stringify(beat)}`);
    }
    throw new Error(`Physical seat chips did not match mounted DOM: ${JSON.stringify(beat)}`);
  }
  if (JSON.stringify(objects.markers) !== JSON.stringify(beat.markerPlayerIds)
    || objects.actingPlayerId !== beat.actingPlayerId) {
    throw new Error(`Physical markers or acting object did not match mounted DOM: ${JSON.stringify(beat)}`);
  }
}

/**
 * Re-derive the captured/missing sets after later sessions have added stills.
 * `stills` is the same array the collector filled, so this only refreshes the
 * summary the report and the gate read.
 */
function summariseOpponentActions(opponentActions, stills) {
  const captured = stills.map((still) => still.action);
  return {
    ...opponentActions,
    stills,
    capturedActions: captured,
    missingActions: TERMINAL_OPPONENT_ACTIONS.filter((action) => !captured.includes(action)),
  };
}

/**
 * Every terminal opponent action must have a real packaged still whose seat
 * plaque was actually readable in that frame. A present-but-invisible plaque is
 * the exact failure mode that let scattered DOM mirrors pass review before.
 */
function assertOpponentActionStills(opponentActions, requiresEveryAction) {
  const stills = opponentActions?.stills;
  /*
    Only the `scene-side-pot-0` invocation is required to evidence all six kinds,
    because 'all-in' comes from that fixture's capped lanes. A `runner-showdown-3`
    run legitimately cannot produce an opponent all-in without shoving the hero's
    whole stack and busting them out of the tournament, so it is held to the five
    kinds its hands do produce and records the remainder.
  */
  const required = requiresEveryAction
    ? TERMINAL_OPPONENT_ACTIONS
    : TERMINAL_OPPONENT_ACTIONS.filter((action) => action !== "all-in");
  const missing = required.filter(
    (action) => !(stills ?? []).some((still) => still.action === action),
  );
  if (!Array.isArray(stills) || missing.length > 0) {
    throw new Error(`Terminal opponent-action stills were incomplete: ${JSON.stringify({
      required,
      captured: opponentActions?.capturedActions,
      missing,
      handsObserved: opponentActions?.handsObserved,
      heroActions: opponentActions?.heroActions,
    })}`);
  }
  for (const action of required) {
    const still = stills.find((entry) => entry.action === action);
    if (!still || !still.plaqueVisible || typeof still.playerId !== "string"
      || !Number.isFinite(still.screenshotBytes) || still.screenshotBytes <= 0
      || typeof still.screenshotPngBase64 !== "string" || still.screenshotPngBase64.length === 0) {
      throw new Error(`Terminal opponent ${action} still was unusable: ${JSON.stringify(still)}`);
    }
  }
}

/**
 * Compare the *whole* public runout between normal WebGL and forced fallback,
 * not just the initial preflop capture.
 *
 * Both paths run the same deterministic seed through the same mounted controls,
 * so every public street they both reached must agree exactly on board, pots,
 * stacks, and bets. Only runs together (no `--kind`) can check this; a
 * single-kind invocation records its own runout for the report and skips here.
 */
export function assertForcedFallbackRunoutParity(results) {
  const webgl = results.find((result) => result.kind === "webgl2");
  const forced = results.find((result) => result.kind === "forced-webgl-failure");
  if (!webgl || !forced) return { compared: false, reason: "single-kind invocation" };
  const streetsOf = (result) => new Map(
    (result.publicRunout ?? [])
      .filter((record) => record.handId === (result.publicRunout?.[0]?.handId))
      .map((record) => [record.street, record]),
  );
  const webglStreets = streetsOf(webgl);
  const forcedStreets = streetsOf(forced);
  if (forcedStreets.size === 0 || webglStreets.size === 0) {
    throw new Error(`Public runout recorder produced no streets: ${JSON.stringify({
      webgl: [...webglStreets.keys()], forced: [...forcedStreets.keys()],
    })}`);
  }
  const shared = [...webglStreets.keys()].filter((street) => forcedStreets.has(street));
  if (shared.length < webglStreets.size) {
    throw new Error(`Forced fallback did not reach every public street WebGL reached: ${JSON.stringify({
      webgl: [...webglStreets.keys()], forced: [...forcedStreets.keys()],
    })}`);
  }
  const comparable = (record) => ({
    street: record.street,
    boardCardCodes: record.boardCardCodes,
    potLanes: record.potLanes,
    seats: [...record.seats].sort((left, right) => left.id.localeCompare(right.id)),
    unrevealedOpponentFaceCount: record.unrevealedOpponentFaceCount,
  });
  for (const street of shared) {
    const left = JSON.stringify(comparable(webglStreets.get(street)));
    const right = JSON.stringify(comparable(forcedStreets.get(street)));
    if (left !== right) {
      throw new Error(`Forced fallback public ${street} did not match normal WebGL: ${JSON.stringify({ webgl: left, forced: right })}`);
    }
  }
  return { compared: true, streets: shared };
}

function assertSidePotParity(capture) {
  const domLanes = capture?.potLanes;
  const sceneLanes = capture?.sceneObjects?.potLanes;
  const domSideLanes = Array.isArray(domLanes)
    ? domLanes.filter((lane) => lane?.kind === "side" && Number.isFinite(lane.amount) && lane.amount > 0)
    : [];
  if (domSideLanes.length < 2 || !Array.isArray(sceneLanes)
    || sceneLanes.length !== domLanes.length
    || sceneLanes.some((lane, index) => lane?.amount !== domLanes[index]?.amount
      || !Number.isInteger(lane?.chipCount) || lane.chipCount < chipCountForAmount(lane.amount))) {
    throw new Error(`Physical two-side-pot lanes did not match mounted DOM: ${JSON.stringify(capture)}`);
  }
}

function chipCountForAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(1, Math.min(18, Math.round(Math.log10(amount + 1) * 4)));
}

function assertDiagnosticSchema(diagnostics, requiresFrames) {
  const finite = [
    "drawCalls",
    "triangles",
    "textures",
    "textureEstimateMiB",
    "resources",
    "frameCount",
    "firstFrameMs",
    "frameP50Ms",
    "frameP95Ms",
    "contextLosses",
  ];
  if (diagnostics.availability !== "ready" && diagnostics.availability !== "failed") {
    throw new Error(`Unclassified scene diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  if (typeof diagnostics.qualityTier !== "string" || diagnostics.qualityTier.length === 0) {
    throw new Error(`Incomplete scene diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  if (requiresFrames && finite.some((field) => !Number.isFinite(diagnostics[field]))) {
    throw new Error(`Incomplete scene diagnostics: ${JSON.stringify(diagnostics)}`);
  }
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const outcome = await runAudit();
    console.log(JSON.stringify(outcome, null, 2));
  } catch (error) {
    const failurePath = resolve(projectRoot, "work", "packaged-3d-scene-audit.failure.json");
    await mkdir(resolve(projectRoot, "work"), { recursive: true });
    await writeFile(failurePath, `${JSON.stringify({
      schemaVersion: 1,
      executable: basename(appPath),
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    }, null, 2)}\n`, "utf8");
    throw error;
  }
}
