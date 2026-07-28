/** Package-only CDP proof that the optional 3D room never replaces the accessible table. */
import { resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import { PackagedSession } from "./lib/packaged-cdp-session.mjs";

const appPath = resolve(projectRoot, "outputs/desktop/win-unpacked/Poker Training Pro.exe");
const timeoutMs = 75_000;
const normal = await runCase("webgl2", []);
const fallback = await runCase("forced-webgl-failure", ["--ptp-force-webgl2-failure"]);

if (!normal.canvas || normal.webgl2 !== true || normal.sceneReady !== true) {
  throw new Error(`Normal WebGL2 scene did not become ready: ${JSON.stringify(normal)}`);
}
if (fallback.forceFlag !== true || fallback.sceneReady !== false) {
  throw new Error(`Forced WebGL fallback did not preserve the DOM table: ${JSON.stringify(fallback)}`);
}
for (const result of [normal, fallback]) {
  if (result.tableCount !== 1 || result.seatCount < 2 || result.buttonCount < 1 || result.tableTextLength < 1) {
    throw new Error(`Accessible table DOM was not mounted: ${JSON.stringify(result)}`);
  }
}
console.log(JSON.stringify({ ok: true, normal, fallback, note: "CDP screenshots were captured in both cases; this report records their byte counts." }, null, 2));

async function runCase(name, extraArguments) {
  const session = await PackagedSession.launch({ appPath, profilePrefix: `poker-training-pro-scene3d-${name}-`, timeoutMs, extraArguments });
  try {
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
    await session.clickSelector(".mode-stage__choice--normal", "normal mode");
    await session.waitForButton("Enter event", "event lobby");
    await session.clickButton("Enter event");
    await session.waitFor(".room-flight", "room arrival");
    await session.clickButton("Skip arrival");
    await session.waitFor(".poker-table", "live table");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const observation = await session.evaluate(`(() => {
      const table = document.querySelector('.poker-table');
      const canvas = document.querySelector('.table-scene-3d');
      let webgl2 = false;
      try { webgl2 = canvas?.getContext('webgl2') !== null; } catch { /* blocked */ }
      return {
        tableCount: document.querySelectorAll('.poker-table').length,
        seatCount: document.querySelectorAll('.player-seat').length,
        buttonCount: document.querySelectorAll('button').length,
        canvas: canvas instanceof HTMLCanvasElement,
        webgl2,
        sceneReady: table?.dataset.spatialScene === 'ready',
        forceFlag: window.desktop?.forceWebGl2Failure === true,
        tableTextLength: (table?.textContent || '').trim().length,
      };
    })()`);
    const screenshot = await session.cdp.send("Page.captureScreenshot", { format: "png" });
    return { name, ...observation, screenshotBytes: Math.floor((screenshot.data?.length ?? 0) * 0.75) };
  } finally {
    await session.dispose();
  }
}
