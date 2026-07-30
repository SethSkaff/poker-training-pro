#!/usr/bin/env node
/**
 * Capture the 3D table from a development build, for looking at.
 *
 * This is a design tool, not a gate. The packaged 3D audit is the gate, and it
 * takes a full package plus eight minutes; that is the right cost for evidence
 * and the wrong cost for "is the rail the right colour". Every composition
 * defect this project has shipped was found by opening a capture and none were
 * found by a passing assertion, so the loop that finds them needs to be cheap.
 *
 * Requires a Vite dev server on 127.0.0.1:5173 (`npx vite --host 127.0.0.1`).
 *
 *     node scripts/preview-3d-scene.mjs --out work/preview --width 1600 --height 900
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const outDir = resolve(projectRoot, option("out", "work/preview"));
const width = Number(option("width", 1600));
const height = Number(option("height", 900));
const devUrl = option("url", "http://127.0.0.1:5173");
const deadline = Date.now() + 180_000;

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.exceptionDetails.text} ${expression.slice(0, 120)}`);
  }
  return response.result?.value;
}

async function waitUntil(cdp, expression, label, budgetMs = 30_000) {
  const until = Math.min(deadline, Date.now() + budgetMs);
  while (Date.now() < until) {
    if (await evaluate(cdp, expression)) return;
    await new Promise((done) => setTimeout(done, 90));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const clickSelector = (selector) => `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!(node instanceof HTMLElement)) return false;
  node.click();
  return true;
})()`;

const clickButton = (text) => `(() => {
  const button = [...document.querySelectorAll('button')].find((entry) =>
    (entry.textContent || '').trim() === ${JSON.stringify(text)});
  if (!(button instanceof HTMLButtonElement)) return false;
  button.click();
  return true;
})()`;

async function shoot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const path = join(outDir, `${name}.png`);
  await writeFile(path, Buffer.from(data, "base64"));
  console.log(`  ${path}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const profile = await mkdtemp(join(tmpdir(), "poker-3d-preview-"));
  const electron = join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
  const child = spawn(
    electron,
    [
      projectRoot,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
    ],
    { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false },
  );
  const output = captureBoundedOutput(child, 8_192);
  try {
    const port = await waitForDevToolsPort(profile, child, deadline, output);
    const target = await waitForPageTarget(port, child, deadline, output);
    const cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await waitUntil(cdp, `location.href.startsWith(${JSON.stringify(devUrl)})`, "dev server page");

    await waitUntil(cdp, clickButton("Skip setup"), "skip setup");
    await waitUntil(cdp, "document.querySelector('.home-reference') !== null", "home menu");
    await waitUntil(cdp, clickSelector('button[aria-label="Settings"]'), "settings");
    await waitUntil(cdp, `(() => {
      const label = [...document.querySelectorAll('label')].find((entry) =>
        (entry.textContent || '').includes('3D room (preview)'));
      const input = label?.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) return false;
      if (!input.checked) input.click();
      return input.checked;
    })()`, "3D preview toggle");
    await waitUntil(cdp, clickSelector(".night-back"), "settings back");
    await waitUntil(cdp, clickSelector('button[aria-label="Play"]'), "play");
    await evaluate(cdp, clickSelector("#play-chip-ack-title ~ .startup-gate__actions button"));
    await waitUntil(cdp, "document.querySelector('.mode-stage') !== null", "mode stage");
    await waitUntil(cdp, clickSelector(".mode-stage__choice--normal"), "normal mode");
    await waitUntil(cdp, clickButton("Enter event"), "enter event");
    // A saved checkpoint from an earlier hand offers to restore the seat first.
    await evaluate(cdp, clickButton("Resume tournament"));
    await waitUntil(cdp, "document.querySelector('.room-flight') !== null", "room flight");
    await waitUntil(cdp, clickButton("Skip arrival"), "skip arrival");
    await waitUntil(cdp, "document.querySelector('.poker-table') !== null", "live table");
    await new Promise((done) => setTimeout(done, 2_500));

    console.log("captures:");
    await shoot(cdp, "table-preflop");

    // Deal out to the river so the board, the pot pile and several committed
    // stacks are all on the felt at once -- the frame the design is judged on.
    for (const name of ["flop", "turn", "river"]) {
      // Poll: the hero only acts on their own turn, so the first attempt after
      // a street opens usually lands on the opponents' thinking time.
      let boardCards = 0;
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        await evaluate(cdp, `(() => {
          const check = [...document.querySelectorAll('.poker-table button')].find((entry) =>
            /^(check|call)\\b/i.test((entry.textContent || '').trim()) && !entry.disabled);
          if (check instanceof HTMLButtonElement) { check.click(); return true; }
          return false;
        })()`);
        await new Promise((done) => setTimeout(done, 900));
        boardCards = await evaluate(cdp, "document.querySelectorAll('.community-cards > *:not(.community-placeholder)').length");
        if (boardCards >= ["flop", "turn", "river"].indexOf(name) + 3) break;
      }
      await new Promise((done) => setTimeout(done, 1_200));
      await shoot(cdp, `table-${name}`);
    }

    for (const pan of [-2, 2]) {
      await evaluate(cdp, `(() => {
        const label = ${pan < 0 ? "'left'" : "'right'"};
        const button = [...document.querySelectorAll('button')].find((entry) =>
          (entry.getAttribute('aria-label') || '').toLowerCase().includes('look ' + label));
        if (button instanceof HTMLButtonElement) { button.click(); button.click(); return true; }
        return false;
      })()`);
      await new Promise((done) => setTimeout(done, 1_400));
      await shoot(cdp, `table-look-${pan < 0 ? "left" : "right"}`);
    }

    const stats = await evaluate(cdp, "JSON.stringify(window.__tableScene3dStats?.() ?? null)");
    if (stats) console.log("stats:", stats.slice(0, 400));
  } finally {
    await terminateProcessTree(child).catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
