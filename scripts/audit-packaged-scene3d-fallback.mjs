/** Package-only CDP proof that the optional 3D room never replaces the accessible table. */
import { resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import {
  isKnownElectronSandboxDiagnostic,
  PackagedSession,
} from "./lib/packaged-cdp-session.mjs";

const appPath = resolve(projectRoot, "outputs/next/win-unpacked/Poker Training Pro.exe");
const timeoutMs = 75_000;
const modes = ["normal", "rational"];
const results = [];
for (const mode of modes) {
  results.push(await runCase(mode, "webgl2", []));
  results.push(await runCase(mode, "forced-webgl-failure", ["--ptp-force-webgl2-failure"]));
}

for (const result of results) {
  if (result.kind === "webgl2" && (!result.canvas || result.webgl2 !== true || result.sceneReady !== true)) {
    throw new Error(`WebGL2 scene did not become ready: ${JSON.stringify(result)}`);
  }
  if (result.kind === "forced-webgl-failure" && (result.forceFlag !== true || result.sceneReady !== false)) {
    throw new Error(`Forced WebGL fallback did not preserve the DOM table: ${JSON.stringify(result)}`);
  }
  if (result.tableCount !== 1 || result.seatCount < 2 || result.buttonCount < 1 || result.tableTextLength < 1) {
    throw new Error(`Accessible table DOM was not mounted: ${JSON.stringify(result)}`);
  }
  if (result.projectedSeatCount !== result.renderableSeatCount || result.invalidProjectedSeatCount !== 0 || result.duplicateProjectedSeatCount !== 0 || result.heroSeatVisibility !== "shown") {
    throw new Error(`DOM seats diverged from the public scene projection: ${JSON.stringify(result)}`);
  }
}
console.log(JSON.stringify({ ok: true, results, note: "CDP screenshots were captured for Normal and Rational, with WebGL2 and forced-fallback cases; this report records their byte counts." }, null, 2));

async function runCase(mode, kind, extraArguments) {
  const session = await PackagedSession.launch({ appPath, profilePrefix: `poker-training-pro-scene3d-${mode}-${kind}-`, timeoutMs, extraArguments });
  try {
    // Console and runtime events are consumed through the same CDP client as
    // the DOM assertions, so a quiet fallback cannot hide a renderer error.
    await session.cdp.send("Log.enable");
    await session.reachHome();
    await session.clickSelector('button[aria-label="Settings"]', "settings button");
    const enabled = await session.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find((candidate) => (candidate.textContent || '').includes('3D room (preview)'));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) return false;
      if (!input.checked) input.click();
      return input.checked;
    })()`);
    if (!enabled) throw new Error("Could not enable the ordinary 3D room setting.");
    await session.clickSelector(".night-back", "back from settings");
    await session.clickSelector('button[aria-label="Play"]', "play button");
    await session.clickIfPresent("#play-chip-ack-title ~ .startup-gate__actions button");
    await session.waitFor(".mode-stage", "mode selection");
    await session.clickSelector(`.mode-stage__choice--${mode}`, `${mode} mode`);
    await session.waitForButton("Enter event", "event lobby");
    await session.clickButton("Enter event");
    await session.waitFor(".room-flight", "room arrival");
    await session.clickButton("Skip arrival");
    await session.waitFor(".poker-table", "live table");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const observation = await session.evaluate(`(() => {
      const table = document.querySelector('.poker-table');
      const canvas = document.querySelector('.table-scene-3d');
      const seats = [...document.querySelectorAll('.player-seat')];
      // The DOM keeps eliminated-seat history readable while the public scene
      // adapter intentionally omits its chair/body. A transient elimination
      // presentation can still have a valid live projection, so exclude only
      // retained out-history that has no adapter attributes at all.
      const renderableSeats = seats.filter((seat) =>
        !seat.classList.contains('is-out') || seat.hasAttribute('data-scene-canonical-seat'),
      );
      const projectedSeats = renderableSeats.filter((seat) =>
        seat.hasAttribute('data-scene-canonical-seat') &&
        seat.hasAttribute('data-scene-relative-seat') &&
        seat.hasAttribute('data-scene-card-visibility'),
      );
      const invalidProjectedSeatCount = projectedSeats.filter((seat) => {
        const canonical = Number(seat.getAttribute('data-scene-canonical-seat'));
        const relative = Number(seat.getAttribute('data-scene-relative-seat'));
        const visibility = seat.getAttribute('data-scene-card-visibility');
        return !Number.isInteger(canonical) || !Number.isInteger(relative) || relative < 0 || relative > 9 || (visibility !== 'hidden' && visibility !== 'shown');
      }).length;
      const duplicateProjectedSeatCount = projectedSeats.length - new Set(
        projectedSeats.map((seat) => [
          seat.getAttribute('data-scene-canonical-seat'),
          seat.getAttribute('data-scene-relative-seat'),
        ].join(':')),
      ).size;
      const heroSeat = document.querySelector('.player-seat--hero');
      let webgl2 = false;
      try { webgl2 = canvas?.getContext('webgl2') !== null; } catch { /* blocked */ }
      return {
        tableCount: document.querySelectorAll('.poker-table').length,
        seatCount: seats.length,
        renderableSeatCount: renderableSeats.length,
        projectedSeatCount: projectedSeats.length,
        invalidProjectedSeatCount,
        duplicateProjectedSeatCount,
        heroSeatVisibility: heroSeat?.getAttribute('data-scene-card-visibility') ?? null,
        buttonCount: document.querySelectorAll('button').length,
        canvas: canvas instanceof HTMLCanvasElement,
        webgl2,
        sceneReady: table?.dataset.spatialScene === 'ready',
        forceFlag: window.desktop?.forceWebGl2Failure === true,
        tableTextLength: (table?.textContent || '').trim().length,
      };
    })()`);
    const screenshot = await session.cdp.send("Page.captureScreenshot", { format: "png" });
    const fatalEvents = session.cdp.takeFatalEvents();
    const unexpectedFatalEvents = fatalEvents.filter(
      (event) => !isKnownElectronSandboxDiagnostic(event),
    );
    if (unexpectedFatalEvents.length > 0) {
      throw new Error(`Renderer emitted fatal CDP events: ${JSON.stringify(unexpectedFatalEvents)}`);
    }
    return {
      mode,
      kind,
      ...observation,
      consoleFatalEvents: unexpectedFatalEvents.length,
      knownElectronSandboxDiagnostics: fatalEvents.length - unexpectedFatalEvents.length,
      screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75),
    };
  } finally {
    await session.dispose();
  }
}
