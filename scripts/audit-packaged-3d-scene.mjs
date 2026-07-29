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

const timeoutMs = 80_000;
const sceneBudgets = Object.freeze({
  drawCalls: 150,
  triangles: 250_000,
  frameP95Ms: 25,
  textureEstimateMiB: 128,
});
const appPath = resolve(
  projectRoot,
  argumentValue("--app") ?? "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);

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
  for (const [kind, extraArguments] of cases) results.push(await runCase(kind, extraArguments));
  for (const result of results) assertCase(result);
  await mkdir(resolve(projectRoot, "work"), { recursive: true });
  for (const result of results) {
    await writeFile(
      resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}.png`),
      Buffer.from(result.screenshotPngBase64, "base64"),
    );
    for (const beat of result.publicBeats ?? []) {
      await writeFile(
        resolve(projectRoot, "work", `packaged-3d-scene-${result.kind}-${beat.street}.png`),
        Buffer.from(beat.screenshotPngBase64, "base64"),
      );
      delete beat.screenshotPngBase64;
    }
    delete result.screenshotPngBase64;
  }
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    executable: basename(appPath),
    results,
    note: "Read-only scene diagnostics plus CDP screenshots; metrics are evidence for the packaged preview, not a quality-tier promotion.",
  }, null, 2)}\n`, "utf8");
  return { ok: true, reportPath, results };
}

async function runCase(kind, extraArguments) {
  const session = await PackagedSession.launch({
    appPath,
    profilePrefix: `poker-training-pro-3d-audit-${kind}-`,
    timeoutMs,
    extraArguments: ["--ptp-lifecycle-smoke", ...extraArguments],
    // Keep both paths foregrounded. Hidden Windows Electron windows throttle
    // the presentation queue, which makes the forced-DOM audit skip readable
    // public runout beats rather than exercising its real cadence.
    windowsHide: false,
  });
  try {
    await session.cdp.send("Log.enable");
    await reachTableWithScene(session);
    const publicBeats = [];
    await capturePublicBeat(session, publicBeats);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
    const before = await observe(session);
    let lifecycle;
    let recovery;
    if (kind === "webgl2") {
      lifecycle = await minimizeAndRestore(session);
      recovery = await repeatContextRecovery(session, before.diagnostics.resources, before.diagnostics.contextLosses);
    }
    // Keep the fixture's one-event-at-a-time presentation queue intact. The
    // native lifecycle checks run against the stable pre-action table rather
    // than pausing midway through the audit's first legal all-in action.
    const initialInteraction = await exerciseCameraAndOneLegalAction(session);
    const interaction = {
      ...initialInteraction,
      completedHand: await completeCurrentHand(session, initialInteraction.handId, publicBeats),
    };
    const screenshot = await session.cdp.send("Page.captureScreenshot", { format: "png" });
    const fatalEvents = session.cdp.takeFatalEvents();
    const fatal = fatalEvents.filter((event) => !isKnownElectronSandboxDiagnostic(event));
    return {
      kind,
      before,
      interaction,
      publicBeats,
      ...(lifecycle ? { lifecycle } : {}),
      ...(recovery ? { recovery } : {}),
      screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75),
      screenshotPngBase64: screenshot.data ?? "",
      fatal,
      knownElectronSandboxDiagnostics: fatalEvents.length - fatal.length,
    };
  } finally {
    await session.dispose();
  }
}

async function exerciseCameraAndOneLegalAction(session) {
  await session.clickSelector('button[aria-label="Look one seat right"]', "camera right");
  if (!await session.poll("document.querySelector('button[aria-label=\"Recenter the table view\"]') instanceof HTMLButtonElement && !document.querySelector('button[aria-label=\"Recenter the table view\"]')?.disabled")) {
    throw new Error("Camera did not move through its ordinary table control.");
  }
  await session.clickSelector('button[aria-label="Recenter the table view"]', "camera recenter");
  const deadline = Date.now() + 20_000;
  let presentationSkips = 0;
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
      choice.click();
      return choice.classList.contains('action-button--raise') ? "preparing-all-in" : "hero-action";
    })()`);
    if (result === "hero-action") {
      const handId = await session.evaluate("document.querySelector('.poker-table')?.getAttribute('data-table-hand-id') ?? null");
      return { cameraMoved: true, presentationSkips, heroAction: true, handId };
    }
    if (result === "presentation") presentationSkips += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 45));
  }
  throw new Error(`No legal hero action appeared after ${presentationSkips} presentation skips.`);
}

async function completeCurrentHand(session, initialHandId, publicBeats = []) {
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
    if (state?.action) {
      actions += 1;
      lastSubmittedStateVersion = state.stateVersion;
    }
    // Sample on the browser-frame cadence so a minimum-readable 120ms event
    // cannot be skipped between CDP polls on a busy fallback renderer.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, state?.action ? 120 : 16));
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

async function capturePublicBeat(session, beats) {
  const readObservation = `(() => {
    const table = document.querySelector('.poker-table');
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

async function reachTableWithScene(session) {
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
}

async function observe(session) {
  const observation = await session.evaluate(`(() => {
    const table = document.querySelector('.poker-table');
    const canvas = document.querySelector('.table-scene-3d');
    const canvasStyle = canvas instanceof HTMLCanvasElement ? getComputedStyle(canvas) : null;
    const canvasBounds = canvas instanceof HTMLCanvasElement ? canvas.getBoundingClientRect() : null;
    const tableStyle = table ? getComputedStyle(table) : null;
    const opacityOf = (selector) => {
      const element = table?.querySelector(selector);
      return element ? Number(getComputedStyle(element).opacity) : null;
    };
    return {
      diagnostics: window.__ptpSceneDiagnostics?.snapshot?.() ?? null,
      forceFlag: window.desktop?.forceWebGl2Failure === true,
      scene: table?.dataset.spatialScene ?? 'fallback',
      tableCount: document.querySelectorAll('.poker-table').length,
      seatCount: document.querySelectorAll('.player-seat').length,
      liveRegionCount: document.querySelectorAll('[aria-live]').length,
      canvas: canvas instanceof HTMLCanvasElement,
      ariaHidden: canvas?.getAttribute('aria-hidden'),
      tabIndex: canvas?.getAttribute('tabindex'),
      canvasVisible: Boolean(canvasBounds && canvasBounds.width > 0 && canvasBounds.height > 0
        && canvasStyle?.display !== 'none' && canvasStyle?.visibility !== 'hidden'
        && Number(canvasStyle?.opacity) > 0),
      tableOpacity: table ? Number(tableStyle?.opacity) : null,
      // Read computed styles rather than pixels: this catches the exact
      // regression where a healthy canvas was mounted behind an opaque DOM
      // felt, while keeping renderer output and accessibility separate.
      composition: {
        surfaceTransparent: tableStyle?.backgroundImage === 'none'
          && tableStyle?.boxShadow === 'none'
          && tableStyle?.borderTopColor === 'rgba(0, 0, 0, 0)',
        surfaceRestored: tableStyle?.backgroundImage !== 'none'
          && tableStyle?.boxShadow !== 'none'
          && tableStyle?.borderTopColor !== 'rgba(0, 0, 0, 0)',
        duplicateFurnitureFaded: ['.seat-figure', '.seat-chip-stack', '.center-pot']
          .every((selector) => (opacityOf(selector) ?? 1) <= 0.06),
        readableHudMounted: Boolean(
          table?.querySelector('.seat-label')
          && table?.querySelector('.seat-position-marker')
          && document.querySelector('.camera-controls'),
        ),
      },
    };
  })()`);
  if (!observation) throw new Error("Could not observe packaged scene diagnostics.");
  return observation;
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

async function repeatContextRecovery(session, baselineResources, baselineContextLosses) {
  const attempts = [];
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
    if (restored.diagnostics?.resources !== baselineResources
      || restored.diagnostics.contextLosses !== baselineContextLosses + attempt + 1) {
      throw new Error(`Context recovery allocation drift at attempt ${attempt + 1}: ${JSON.stringify(restored.diagnostics)}`);
    }
    attempts.push({ loss, restore, fallback, restored });
  }
  return { attempts };
}

export function assertCase(result) {
  const before = result.before;
  if (result.fatal.length > 0) throw new Error(`Fatal renderer event: ${JSON.stringify(result.fatal)}`);
  if (before.tableCount !== 1 || before.seatCount < 2 || before.liveRegionCount < 1 || !before.canvas) {
    throw new Error(`Accessible DOM/canvas missing: ${JSON.stringify(before)}`);
  }
  if (before.ariaHidden !== "true" || before.tabIndex !== "-1") {
    throw new Error(`Canvas accessibility contract changed: ${JSON.stringify(before)}`);
  }
  if (!before.diagnostics) throw new Error("Scene diagnostics bridge was unavailable.");
  assertDiagnosticSchema(before.diagnostics, result.kind === "webgl2");
  if (before.diagnostics.drawCalls > sceneBudgets.drawCalls
    || before.diagnostics.triangles > sceneBudgets.triangles
    || before.diagnostics.textureEstimateMiB > sceneBudgets.textureEstimateMiB
    || before.diagnostics.frameP95Ms > sceneBudgets.frameP95Ms) {
    throw new Error(`Scene budget exceeded: ${JSON.stringify(before.diagnostics)}`);
  }
  if (!result.interaction?.cameraMoved || !result.interaction?.heroAction || !result.interaction?.completedHand?.completed) {
    throw new Error(`Scene audit did not complete a legal hand through camera and ordinary controls: ${JSON.stringify(result.interaction)}`);
  }
  const expectedPublicBeats = [["preflop", 0], ["flop", 3], ["turn", 4], ["river", 5]];
  if (!Array.isArray(result.publicBeats) || result.publicBeats.length !== expectedPublicBeats.length
    || result.publicBeats.some((beat, index) => beat?.street !== expectedPublicBeats[index][0]
      || beat?.boardCards !== expectedPublicBeats[index][1]
      || beat?.unrevealedOpponentFaceCount !== 0
      || !Number.isFinite(beat?.screenshotBytes) || beat.screenshotBytes <= 0
      || typeof beat?.screenshotPngBase64 !== "string" || beat.screenshotPngBase64.length === 0)) {
    const publicBeatSummary = result.publicBeats?.map(({ screenshotPngBase64, ...beat }) => beat);
    throw new Error(`Packaged public street captures were incomplete or exposed an unrevealed opponent card: ${JSON.stringify(publicBeatSummary)}. Interaction: ${JSON.stringify(result.interaction)}`);
  }
  if (result.kind === "webgl2") {
    for (const beat of result.publicBeats) assertPublicObjectParity(beat);
  }
  if (result.kind === "webgl2") {
    if (before.scene !== "ready" || before.diagnostics.availability !== "ready" || !before.canvasVisible) {
      throw new Error(`WebGL scene did not become ready: ${JSON.stringify(before)}`);
    }
    if (!before.composition?.surfaceTransparent || !before.composition?.duplicateFurnitureFaded
      || !before.composition?.readableHudMounted) {
      throw new Error(`WebGL scene composition did not reveal 3D furniture while retaining the DOM HUD: ${JSON.stringify(before.composition)}`);
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
        || recovery.restored.diagnostics.resources !== before.diagnostics.resources) {
        throw new Error(`Context restore did not rebuild stable scene resources: ${JSON.stringify(recovery)}`);
      }
    }
  } else if (before.forceFlag !== true || before.scene !== "fallback" || before.tableOpacity !== 1
    || !before.composition?.surfaceRestored || before.diagnostics.availability !== "failed"
    || typeof before.diagnostics.reason !== "string") {
    throw new Error(`Forced WebGL failure did not stay on DOM fallback: ${JSON.stringify(before)}`);
  }
}

function assertPublicObjectParity(beat) {
  const objects = beat?.sceneObjects;
  if (!objects || !Array.isArray(objects.boardCardCodes) || !Array.isArray(objects.seats)
    || !objects.markers || !Number.isFinite(beat.scenePot)) {
    throw new Error(`Renderer object diagnostics were unavailable: ${JSON.stringify(beat)}`);
  }
  if (JSON.stringify(objects.boardCardCodes) !== JSON.stringify(beat.boardCardCodes)
    || objects.potChipCount !== chipCountForAmount(beat.scenePot)) {
    throw new Error(`Physical board or pot did not match mounted DOM: ${JSON.stringify(beat)}`);
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
    }, null, 2)}\n`, "utf8");
    throw error;
  }
}
