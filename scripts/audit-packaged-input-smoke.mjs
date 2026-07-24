/**
 * Bounded Windows-package input smoke. Unlike a DOM `.click()` unit probe,
 * this sends genuine CDP mouse and keyboard events to the packaged Electron
 * renderer so React pointer handlers, focus, range controls, and keyboard
 * routing are exercised together. It is intentionally a smoke, not a claim of
 * real-controller or assistive-technology certification.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";

const PROFILE_PREFIX = "poker-training-pro-input-smoke-";
const projectRoot = resolve(new URL("..", import.meta.url).pathname.slice(1));
const appPath = resolve(
  projectRoot,
  argumentValue("--app") ?? "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const reportPath = resolve(projectRoot, "work", "packaged-input-smoke.json");
const timeoutMs = 35_000;

if (process.platform !== "win32") {
  throw new Error("Packaged input smoke requires a Windows Electron executable.");
}
if (!existsSync(appPath)) {
  throw new Error(`Packaged executable not found: ${appPath}`);
}

const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
const child = spawn(
  appPath,
  [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--ptp-lifecycle-smoke",
  ],
  {
    cwd: dirname(appPath),
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);
const output = captureBoundedOutput(child, 8_192);
const checks = [];
let client;
let failure;

try {
  const deadline = Date.now() + timeoutMs;
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  client = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Input.setIgnoreInputEvents", { ignore: false });
  await delay(350);

  await expectMouseClick(
    client,
    ".first-run-options label:nth-of-type(1) input[type=checkbox]",
    undefined,
    "reduced-motion setup toggle",
  );
  await expectMouseClick(
    client,
    ".first-run-options label:nth-of-type(2) input[type=checkbox]",
    undefined,
    "high-contrast setup toggle",
  );
  await expectMouseClick(client, "button", "Save and continue", "first-run accessibility setup save");
  await expectSelector(client, ".home-reference", "home menu after setup");
  await expectBoolean(
    client,
    "document.documentElement.classList.contains('reduced-motion')",
    "reduced-motion preference reaches the packaged renderer",
  );
  await expectBoolean(
    client,
    "document.documentElement.classList.contains('high-contrast')",
    "high-contrast preference reaches the packaged renderer",
  );
  await expectMouseClick(client, 'button[aria-label="Play"]', undefined, "Play mouse input");
  await delay(250);
  await clickIfPresent(
    client,
    "#play-chip-ack-title ~ .startup-gate__actions button",
    "play-chip acknowledgement mouse input",
  );
  await expectSelector(client, ".mode-stage", "mode selection");
  await expectMouseClick(client, ".mode-stage__choice--training", undefined, "Training mouse input");
  await expectSelector(client, ".poker-table", "Training table");

  await expectMouseClick(client, ".hero-hole-cards", undefined, "card peek pointer input");
  await expectBoolean(
    client,
    "document.querySelector('.hero-hole-cards')?.classList.contains('is-peeked') === true",
    "cards are visibly peeked",
  );
  await dragSelector(client, ".hero-hole-cards", 0, -132);
  await expectBoolean(
    client,
    "document.querySelector('.hero-hole-cards')?.classList.contains('is-folded') === true",
    "drag-to-fold pointer path",
  );

  // Exit this scored result and enter a live tournament for raise sizing. The
  // first Training item intentionally may not advertise a raise, so using it
  // here would turn a legal-action guard into a false input failure.
  await expectMouseClick(client, ".table-exit", undefined, "table exit mouse input");
  await expectSelector(client, ".home-reference", "home after table exit");
  await expectMouseClick(client, 'button[aria-label="Play"]', undefined, "Play tournament run");
  await expectSelector(client, ".mode-stage", "mode selection second run");
  await expectMouseClick(client, ".mode-stage__choice--normal", undefined, "Normal mode mouse input");
  await expectMouseClick(client, "button", "Enter event", "enter event mouse input");
  await expectSelector(client, ".room-flight", "tournament arrival");
  await expectMouseClick(client, "button", "Skip arrival", "skip arrival mouse input");
  await expectSelector(client, ".poker-table", "live tournament table");
  await expectClearTableInformationLanes(client);
  await expectMinimizePausesAndRestores(client);
  await expectMouseClick(client, ".action-context button", undefined, "hand-history mouse input");
  await expectSelector(client, ".hand-history-popover", "public hand history");
  await expectMouseClick(client, ".hand-history-popover button", undefined, "close hand history mouse input");
  await expectBoolean(
    client,
    "document.querySelector('.hand-history-popover') === null",
    "hand history closes cleanly",
  );
  await expectMouseClick(client, ".action-button--raise", undefined, "raise mouse input");
  await expectSelector(client, ".bet-composer", "raise composer");
  await clickRangeAtFraction(client, ".bet-slider-row input[type=range]", 0.72);
  await expectBoolean(
    client,
    "Number(document.querySelector('.bet-slider-row input[type=range]')?.value) > Number(document.querySelector('.bet-slider-row input[type=range]')?.min)",
    "raise slider pointer sizing",
  );
  await expectMouseClick(client, ".bet-composer .primary-button", undefined, "confirm raise mouse input");
  await expectSelector(
    client,
    'button[aria-label="Skip opponent presentation and continue the hand"]',
    "fast-forward control after action",
  );
  await expectMouseClick(
    client,
    'button[aria-label="Skip opponent presentation and continue the hand"]',
    undefined,
    "fast-forward mouse input",
  );
  await expectSelector(client, ".action-dock", "table advances after fast-forward");

  // Keyboard uses the same running package: Escape opens the pause menu, then
  // mouse toggles audio settings inside its accessible labelled control.
  await sendKey(client, "Escape", "Escape", 27);
  await expectSelector(client, ".pause-menu", "keyboard pause input");
  await expectMouseClick(client, ".pause-menu__actions button:nth-of-type(3)", undefined, "pause settings mouse input");
  await expectBoolean(
    client,
    "document.querySelector('.pause-settings input[type=checkbox]') instanceof HTMLInputElement",
    "pause settings controls available",
  );
  await expectMouseClick(client, ".pause-settings input[type=checkbox]", undefined, "mute checkbox mouse input");
  await sendKey(client, "Escape", "Escape", 27);
  await expectBoolean(
    client,
    "document.querySelector('.pause-menu') === null",
    "keyboard resume input",
  );

  await pressMockGamepadA(client);
  await expectSelector(client, ".spectator-dock", "Gamepad API check or call routing");
  await expectMouseClick(
    client,
    'button[aria-label="Skip opponent presentation and continue the hand"]',
    undefined,
    "fast-forward controller action presentation",
  );
  await expectAnySelector(
    client,
    [".action-dock", ".ceremony-board", ".room-flight"],
    "table advances after Gamepad action",
    8_000,
  );

} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  try {
    client?.close();
  } catch {
    // Process-tree cleanup remains authoritative.
  }
  try {
    await terminateProcessTree(child);
  } catch {
    // Best effort; the temporary profile removal below catches leftovers.
  }
  await removeProfile(profile);
}

const report = {
  schemaVersion: 1,
  executable: basename(appPath),
  checks,
  ok: !failure,
  ...(failure ? { failure } : {}),
  scope:
    "Packaged CDP mouse, keyboard, and Gamepad API smoke for first-run motion/contrast preferences, menu navigation, card peek, drag-fold, raise slider, hand history, fast-forward, pause settings, and resume. Physical-controller ergonomics, assistive technologies, and real-device behavior remain separate acceptance work.",
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (failure) throw new Error(`Packaged input smoke failed: ${failure}`);
console.log(JSON.stringify({ ok: true, ...report }, null, 2));

async function expectSelector(cdp, selector, label) {
  const found = await waitForBoolean(
    cdp,
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
  );
  record(label, found);
  if (!found) throw new Error(`${label}: ${selector} was not present.`);
}

async function expectAnySelector(cdp, selectors, label, timeout = 4_000) {
  const found = await waitForBoolean(
    cdp,
    selectors
      .map((selector) => `document.querySelector(${JSON.stringify(selector)}) !== null`)
      .join(" || "),
    timeout,
  );
  record(label, found);
  if (!found) throw new Error(`${label}: no expected post-action screen appeared.`);
}

async function expectBoolean(cdp, expression, label) {
  const value = await waitForBoolean(cdp, expression);
  record(label, value);
  if (!value) throw new Error(`${label} did not produce the expected state.`);
}

/**
 * No visible information lane may collide in the shipped six-seat table. This
 * keeps the user's card-corner and bet-versus-stack requirements covered by a
 * package-level test instead of a one-time screenshot review.
 */
async function expectClearTableInformationLanes(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const intersects = (left, right) =>
        left.left < right.right && left.right > right.left &&
        left.top < right.bottom && left.bottom > right.top;
      const seats = [...document.querySelectorAll('.player-seat:not(.player-seat--hero)')]
        .filter((seat) => seat.getBoundingClientRect().width > 2)
        .map((seat) => {
          const cards = [...seat.querySelectorAll('.opponent-cards .playing-card')];
          const label = seat.querySelector('.seat-label');
          const bet = seat.querySelector('.seat-bet');
          return {
            player: seat.getAttribute('aria-label') || 'unknown player',
            cardsOverlap: cards.length === 2 && intersects(
              cards[0].getBoundingClientRect(), cards[1].getBoundingClientRect(),
            ),
            betOverlapsStack: Boolean(label && bet && intersects(
              label.getBoundingClientRect(), bet.getBoundingClientRect(),
            )),
          };
        });
      return {
        seats,
        ok: seats.length >= 5 && seats.every((seat) => !seat.cardsOverlap && !seat.betOverlapsStack),
      };
    })()`,
    returnByValue: true,
  });
  const observation = result.result?.value;
  const ok = observation?.ok === true;
  record("table card and bet/stack lanes do not overlap", ok);
  if (!ok) {
    throw new Error(
      `Table information lanes overlap or are incomplete: ${JSON.stringify(observation)}.`,
    );
  }
}

/**
 * Exercise Electron's actual native minimize/restore path. Source-level blur
 * handlers are not enough: the package must receive the main-process lifecycle
 * event, freeze table work, and leave an explicit safe resume route.
 */
async function expectMinimizePausesAndRestores(cdp) {
  const minimized = await evaluateValue(
    cdp,
    "window.desktop?.testLifecycleWindow?.('minimize')",
  );
  if (minimized?.ok !== true) throw new Error("Packaged lifecycle test hook could not minimize the window.");
  await expectSelector(cdp, ".pause-menu", "native minimize pauses table presentation");

  const restored = await evaluateValue(
    cdp,
    "window.desktop?.testLifecycleWindow?.('restore')",
  );
  if (restored?.ok !== true) throw new Error("Packaged lifecycle test hook could not restore the window.");
  await expectMouseClick(cdp, ".pause-menu .primary-button", "Resume table", "native restore keeps an explicit resume action");
  await expectBoolean(
    cdp,
    "document.querySelector('.pause-menu') === null",
    "native restore resumes only after player confirmation",
  );
}

async function expectMouseClick(cdp, selector, exactText, label) {
  const point = await selectorPoint(cdp, selector, exactText);
  if (!point) {
    record(label, false);
    throw new Error(`${label}: no enabled target found.`);
  }
  await mouseClick(cdp, point.x, point.y);
  record(label, true);
  await delay(180);
}

async function clickIfPresent(cdp, selector, label) {
  const point = await selectorPoint(cdp, selector);
  if (!point) return false;
  await mouseClick(cdp, point.x, point.y);
  record(label, true);
  await delay(180);
  return true;
}

async function selectorPoint(cdp, selector, exactText) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const target = candidates.find((element) => {
        if (!(element instanceof HTMLElement) || element.matches(':disabled')) return false;
        return ${exactText === undefined ? "true" : `(element.textContent || '').trim() === ${JSON.stringify(exactText)}`};
      });
      if (!(target instanceof HTMLElement)) return null;
      const box = target.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1,
  });
}

async function dragSelector(cdp, selector, deltaX, deltaY) {
  const point = await selectorPoint(cdp, selector);
  if (!point) throw new Error(`Drag target ${selector} was not present.`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  for (const factor of [0.25, 0.55, 0.8, 1]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x + deltaX * factor, y: point.y + deltaY * factor, button: "left", buttons: 1,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x + deltaX, y: point.y + deltaY, button: "left", buttons: 0, clickCount: 1,
  });
  await delay(140);
}

async function clickRangeAtFraction(cdp, selector, fraction) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return null;
      const box = input.getBoundingClientRect();
      return {
        x: box.left + box.width * ${Math.max(0.08, Math.min(0.92, fraction))},
        y: box.top + box.height / 2,
      };
    })()`,
    returnByValue: true,
  });
  const point = result.result?.value;
  if (!point) throw new Error(`Range ${selector} was not present.`);
  // Start directly at the requested point. Chromium's native range control
  // maps the first press to that value; starting the gesture at the minimum
  // thumb can be swallowed as a thumb-focus gesture when the app is running
  // with its high-contrast preference enabled.
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await delay(100);
}

async function sendKey(cdp, key, code, windowsVirtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  await delay(150);
}

/**
 * Exercise the production Gamepad API polling path, rather than directly
 * dispatching the application's internal action event. Physical-controller
 * ergonomics still need hardware acceptance, but this proves the bundled
 * browser API adapter, connection event, polling loop, mapping, and table
 * route cooperate in the packaged renderer.
 */
async function pressMockGamepadA(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const buttons = Array.from({ length: 16 }, (_, index) => ({
        pressed: index === 0,
        value: index === 0 ? 1 : 0,
        touched: index === 0,
      }));
      const pad = { buttons, axes: [0, 0], connected: true, mapping: "standard" };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [pad],
      });
      window.dispatchEvent(new Event("gamepadconnected"));
      setTimeout(() => { buttons[0].pressed = false; buttons[0].value = 0; }, 160);
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  if (result.result?.value !== true) throw new Error("Could not inject Gamepad API snapshot.");
  record("Gamepad API A-button input", true);
  await delay(260);
}

async function evaluateBoolean(cdp, expression) {
  return (await evaluateValue(cdp, expression)) === true;
}

async function evaluateValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
}

async function waitForBoolean(cdp, expression, timeout = 4_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluateBoolean(cdp, expression)) return true;
    await delay(80);
  }
  return false;
}

function record(label, ok) {
  checks.push({ label, ok: Boolean(ok) });
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

async function removeProfile(target) {
  const resolved = resolve(target);
  if (!basename(resolved).startsWith(PROFILE_PREFIX)) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(resolved, { recursive: true, force: true });
      return;
    } catch {
      await delay(100 * (attempt + 1));
    }
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
