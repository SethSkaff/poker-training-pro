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
const TABLE_GEOMETRY_VIEWPORTS = [
  { width: 1100, height: 720 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
];
const TABLE_INTERFACE_SCALES = ["compact", "standard", "large", "extra-large"];
// This is the overall CDP session budget (also bounds every individual CDP
// command's timeout via CdpClient.send. Native range gestures get a bounded
// longer per-command allowance because Chromium can wait for compositor input
// acknowledgement longer than ordinary DOM evaluation.
// 35s left effectively no slack once per-check polls were widened below to
// tolerate legitimate opponent-presentation/animation variance, and the
// raise-legality poll can take several hands to reach a decision where
// raising is legal. 90s keeps a full run comfortable without masking a
// genuinely hung packaged app (the process-exit and devtools-port waits below
// still fail fast on a real crash).
const timeoutMs = 120_000;

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
let transportTimeout;

try {
  const deadline = Date.now() + timeoutMs;
  const port = await waitForDevToolsPort(profile, child, deadline, output);
  const target = await waitForPageTarget(port, child, deadline, output);
  client = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Input.setIgnoreInputEvents", { ignore: false });
  // The packaged app auto-pauses on a native window-blur lifecycle event
  // (electron/main.cjs `window.on("blur")` -> `window-focus` IPC ->
  // PokerTable's `requestPause("window-blurred")`). That is correct product
  // behavior, not a smoke defect, but if the spawned window never receives OS
  // foreground focus while this script drives it, the table can already be
  // auto-paused before a scripted step ever runs. Bring the window forward
  // once up front so the rest of the run measures real input handling instead
  // of a window-manager focus race.
  await client.send("Page.bringToFront");
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
  // E01-002 presents forced posts/deals and each opponent action as a public
  // queue. Wait for the first *legal hero decision* instead of assuming the
  // table becomes interactive in the same renderer tick as room arrival.
  await expectHeroDecisionAfterPresentation(client, 20_000);
  await dismissContextCoachIfPresent(client);
  await captureStableTableScene(client);
  await expectClearTableInformationLanes(client);

  // Exercise the production Gamepad API polling path while the live table is
  // still visible. The later lifecycle smoke deliberately minimizes this
  // same window; the product correctly suspends its visibility-aware polling
  // loop while hidden, so testing controller routing before that state change
  // keeps this an interaction assertion rather than a window-manager race.
  await client.send("Page.bringToFront");
  await delay(200);
  await pressMockGamepadAUntilRouted(client);
  /*
    The skip control moved out of the bottom dock to a prominent button over the
    table (E27-015), and its accessible name was reworded to say what is *not*
    skipped as well as what is. Selecting on the class is stable across further
    copy changes; the exact accessible name is asserted by the unit tests that
    own that wording.
  */
  await expectMouseClick(
    client,
    "button.skip-hand",
    undefined,
    "fast-forward controller action presentation",
  );
  // 20 s, matching the wait for the *opening* hero decision above. After the
  // controller action the queue has to carry a full orbit of opponents, and
  // possibly a street change, before the hero acts again -- no shorter than
  // the opening sequence, so an 8 s budget here was never consistent with the
  // 20 s one there. Post-E11-002 hands are 24-46 hands long rather than 8-9,
  // with correspondingly more milestones per orbit. Skipping only accelerates
  // the queue; it advances on its own delays regardless, so waiting is enough.
  await expectHeroDecisionDrainingPresentation(client, "table advances after Gamepad action");

  await expectMinimizePausesAndRestores(client);
  await expectMouseClick(client, ".action-context button", undefined, "hand-history mouse input");
  await expectSelector(client, ".hand-history-popover", "public hand history");
  await expectMouseClick(client, ".hand-history-popover button", undefined, "close hand history mouse input");
  await expectBoolean(
    client,
    "document.querySelector('.hand-history-popover') === null",
    "hand history closes cleanly",
  );
  // Exercise one whole live decision before raise sizing. This is both a real
  // action path and the packaged regression for E01-001: engine state must
  // advance without replacing the table DOM node. `sceneStateVersion` changes
  // on every runner action; the element reference must remain exact.
  await advanceOneDecisionWithoutRaising(client);
  await expectStableTableSceneAfterAdvance(client);
  // Raising is only sometimes legal on the very first live decision: opponent
  // stacks/actions vary with the wall-clock-derived tournament seed
  // (`career:${eventId}:${Date.now()}` in src/App.tsx), so hero may face a
  // covering all-in (call/fold only) or already be all-in themselves. That is
  // correct poker-legality logic in `canRaise`/`.action-button--raise`'s
  // `disabled` prop (src/components/PokerTable.tsx), not a bug, and forcing a
  // click on a disabled control is not a meaningful proof of raise-sizing
  // input. Instead, poll for a decision where raising truly is legal, taking
  // whatever legal non-raise action the dock currently offers to advance past
  // any decision where it is not -- deterministic seeding is not available (no
  // production-safe seed override exists; see report), so this waits for a
  // real, code-verified legal state rather than assuming one.
  await ensureRaiseIsLegalThenAdvance(client);
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
    'button.skip-hand',
    "fast-forward control after action",
  );
  await expectMouseClick(
    client,
    'button.skip-hand',
    undefined,
    "fast-forward mouse input",
  );
  // A fixed 4s poll here raced legitimate opponent-presentation/animation
  // length on at least one verification run (the remaining seats still act
  // and animate after the hero's own fast-forward click before the next
  // decision is ready). `.ceremony-board` (tournament placement, Dashboard.tsx)
  // and `.room-flight` (inter-level flythrough, RoomFlythrough.tsx) are
  // distinct full-screen navigations away from PokerTable entirely -- Escape
  // is handled by App.tsx's own back-navigation there, not PokerTable's pause
  // menu -- so accepting them here would let the script march on assuming
  // table context that no longer exists. Widen only the timeout; the very
  // next hero decision must still be a real `.action-dock`.
  await expectHeroDecisionDrainingPresentation(client, "table advances after fast-forward");

  // Keyboard uses the same running package: Escape opens the pause menu, then
  // mouse toggles audio settings inside its accessible labelled control.
  //
  // Escape is a *toggle* in PokerTable.tsx's keydown handler: if `paused` is
  // already true it closes the menu instead of opening it. The app can already
  // be paused here for a legitimate reason -- a native window-blur event (see
  // the `Page.bringToFront` note above) auto-pauses the table -- and if that
  // race lands right before this step, sending Escape would close an
  // already-open menu, which reads identically to "the pause menu was not
  // present" even though keyboard routing worked correctly both times. Bring
  // the window forward again and resume from a known, unpaused baseline
  // before measuring the keyboard open.
  await client.send("Page.bringToFront");
  await delay(200);
  await pressEscapeUntilPauseMenuOpens(client);
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

} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // CDP has its own command deadline. Record that infrastructure failure
  // independently: it proves neither a passing product interaction nor a
  // product regression, and should not be reported as the latter.
  if (/^CDP command .* timed out\.$/.test(message)) {
    transportTimeout = message;
  } else {
    failure = message;
  }
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
  ok: !failure && !transportTimeout,
  outcome: failure
    ? "product-failure"
    : transportTimeout
      ? "inconclusive-cdp-timeout"
      : "passed",
  ...(failure ? { failure } : {}),
  ...(transportTimeout ? { transportTimeout } : {}),
  scope:
    "Packaged CDP mouse, keyboard, and Gamepad API smoke for first-run motion/contrast preferences, menu navigation, card peek, drag-fold, raise slider, hand history, fast-forward, pause settings, and resume. Physical-controller ergonomics, assistive technologies, and real-device behavior remain separate acceptance work.",
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (failure) throw new Error(`Packaged input smoke failed: ${failure}`);
if (transportTimeout) {
  console.warn(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else {
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

async function expectSelector(cdp, selector, label, timeout = 8_000) {
  const found = await waitForBoolean(
    cdp,
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
    timeout,
  );
  record(label, found);
  if (!found) {
    // "X was not present" is true of a crashed renderer, a finished event, and
    // a hand still mid-presentation alike, and those have nothing in common.
    // Say which screen was actually up.
    const state = await describeScreen(cdp);
    throw new Error(`${label}: ${selector} was not present. On screen: ${state}`);
  }
}

/**
 * Waits for the hero's next decision, draining the presentation queue as it goes.
 *
 * Clicking skip once and then waiting a fixed period was enough when a hand was
 * a handful of milestones. It is not now: after the E11-002 policy correction a
 * hand runs a full orbit of five opponents and often several streets, so the
 * queue keeps producing events long after that single skip. The observed
 * failure was unambiguous -- table present, ceremony absent, action dock
 * absent, and the skip button *still there* -- so the driver was waiting on a
 * queue it had stopped advancing.
 *
 * Skipping only accelerates the queue; it advances on its own delays anyway.
 * This just stops the driver from falling behind it.
 */
async function expectHeroDecisionDrainingPresentation(cdp, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  const skipSelector =
    'button.skip-hand';
  while (Date.now() < deadline) {
    const state = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const dock = document.querySelector('.action-dock') !== null;
        const skip = document.querySelector(${JSON.stringify(skipSelector)});
        if (!dock && skip instanceof HTMLButtonElement && !skip.disabled) {
          skip.click();
          return 'skipped';
        }
        if (dock) return 'dock';
        if (document.querySelector('.ceremony-board')) return 'ceremony';
        return 'waiting';
      })()`,
      returnByValue: true,
    });
    const value = state.result?.value;
    if (value === "dock") {
      record(label, true);
      return;
    }
    if (value === "ceremony") {
      // The event ended before the hero was asked again. That is a legitimate
      // outcome of playing, not a product failure, but it means this
      // interaction assertion could not be made -- say so rather than pass.
      record(label, false);
      throw new Error(
        `${label}: the event reached its ceremony before the hero was asked to act again.`,
      );
    }
    await delay(40);
  }
  record(label, false);
  const screen = await describeScreen(cdp);
  throw new Error(
    `${label}: no hero decision within ${timeout} ms. On screen: ${screen}`,
  );
}

/** A one-line description of which screen the renderer is currently showing. */
async function describeScreen(cdp) {
  try {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const has = (selector) => document.querySelector(selector) !== null;
        const marks = {
          ceremony: has('.ceremony-board'),
          table: has('.poker-table'),
          arrival: has('.room-progress-overlay'),
          flythrough: has('.room-flight'),
          actionDock: has('.action-dock'),
          skipButton: has('button.skip-hand'),
          pause: has('.pause-overlay'),
          loading: has('.scene-loading'),
        };
        const place = document.querySelector('.ceremony-board__place');
        return JSON.stringify({
          ...marks,
          ...(place ? { placement: (place.textContent || '').trim() } : {}),
        });
      })()`,
      returnByValue: true,
    });
    return String(result.result?.value ?? "unavailable");
  } catch {
    return "unavailable (the renderer did not answer)";
  }
}

async function expectAnySelector(cdp, selectors, label, timeout = 8_000) {
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

/** Contextual teaching is optional and intentionally modal; clear it before
 * asserting physical table controls beneath it so this smoke measures input
 * routing rather than a coach-overlay flow. */
async function dismissContextCoachIfPresent(cdp) {
  const appeared = await waitForBoolean(
    cdp,
    "document.querySelector('.context-coach button') !== null",
    500,
  );
  if (!appeared) return;
  await expectMouseClick(
    cdp,
    ".context-coach button",
    undefined,
    "dismiss contextual table tip",
  );
}

async function expectHeroDecisionAfterPresentation(cdp, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const dock = await waitForBoolean(
      cdp,
      "document.querySelector('.action-dock') !== null",
      Math.min(5_000, Math.max(250, deadline - Date.now())),
    );
    if (dock) {
      record("public presentation queue reaches the first hero decision", true);
      return;
    }
    await ensureNotPaused(cdp);
  }
  record("public presentation queue reaches the first hero decision", false);
  throw new Error("public presentation queue did not reach a hero decision.");
}

async function captureStableTableScene(cdp) {
  const observation = await evaluateValue(cdp, `(() => {
    const table = document.querySelector('.poker-table');
    if (!(table instanceof HTMLElement)) return { ok: false };
    window.__ptpStableTableScene = table;
    window.__ptpStableTableSceneVersion = table.dataset.tableStateVersion;
    return {
      ok: Boolean(table.dataset.tableHandId) && Boolean(table.dataset.tableStateVersion),
      handId: table.dataset.tableHandId,
      stateVersion: table.dataset.tableStateVersion,
    };
  })()`);
  const ok = observation?.ok === true;
  record("capture stable live table scene", ok);
  if (!ok) throw new Error(`Could not capture the live table scene: ${JSON.stringify(observation)}.`);
}

async function expectStableTableSceneAfterAdvance(cdp) {
  const observation = await evaluateValue(cdp, `(() => {
    const table = document.querySelector('.poker-table');
    const original = window.__ptpStableTableScene;
    return {
      sameNode: table === original,
      currentStateVersion: table instanceof HTMLElement ? table.dataset.tableStateVersion : undefined,
      originalStateVersion: window.__ptpStableTableSceneVersion,
    };
  })()`);
  const ok = observation?.sameNode === true &&
    observation.currentStateVersion !== observation.originalStateVersion;
  record("table remains mounted while authoritative action state advances", ok);
  if (!ok) {
    throw new Error(
      `Table remounted or did not advance after a live action: ${JSON.stringify(observation)}.`,
    );
  }
}

/**
 * No visible information lane may collide in the shipped six-seat table. This
 * keeps the user's card-corner and bet-versus-stack requirements covered by a
 * package-level test instead of a one-time screenshot review.
 */
async function expectClearTableInformationLanes(cdp) {
  const observations = [];
  try {
    for (const viewport of TABLE_GEOMETRY_VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      for (const scale of TABLE_INTERFACE_SCALES) {
        await cdp.send("Runtime.evaluate", {
          expression: `document.documentElement.dataset.interfaceScale = ${JSON.stringify(scale)}`,
          awaitPromise: false,
        });
        // `zoom` changes layout on the next rendering turn. Sampling after a
        // frame makes this a real stylesheet/DOM geometry assertion rather
        // than an attribute-only source check.
        await delay(40);
        const observation = await inspectTableInformationLanes(cdp);
        observations.push({ viewport, scale, ...observation });
      }
    }
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await cdp.send("Runtime.evaluate", {
      expression: 'document.documentElement.dataset.interfaceScale = "standard"',
      awaitPromise: false,
    });
    await delay(40);
  }
  const ok = observations.every((observation) => observation.ok === true);
  record("table information lanes remain visible and non-overlapping across supported viewports and UI scales", ok);
  if (!ok) {
    throw new Error(
      `Table information lanes overlap, are clipped, or are too small: ${JSON.stringify(observations.filter((observation) => !observation.ok))}.`,
    );
  }
}

async function inspectTableInformationLanes(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const intersects = (left, right) =>
        left.left < right.right && left.right > right.left &&
        left.top < right.bottom && left.bottom > right.top;
      const roundRect = (rect) => ({
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
      });
      const readable = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width >= 16 && rect.height >= 12 && rect.right > 0 &&
          rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight &&
          style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      };
      const seats = [...document.querySelectorAll('.player-seat:not(.player-seat--hero)')]
        .filter((seat) => seat.getBoundingClientRect().width > 2)
        .map((seat) => {
          const cards = [...seat.querySelectorAll('.opponent-cards .playing-card')];
          const label = seat.querySelector('.seat-label');
          const bet = seat.querySelector('.seat-bet');
          return {
            player: seat.getAttribute('aria-label') || 'unknown player',
            // Which seat position this is. The lanes are laid out per position,
            // so a failure that names only the player says nothing about where
            // to look -- and the roster is reseeded each run, so the same
            // player never lands in the same chair twice.
            seatClass: [...seat.classList]
              .filter((name) => name.startsWith('player-seat--'))
              .join(' '),
            rects: {
              label: label ? roundRect(label.getBoundingClientRect()) : null,
              bet: bet ? roundRect(bet.getBoundingClientRect()) : null,
              cards: cards.map((card) => roundRect(card.getBoundingClientRect())),
            },
          cardsOverlap: cards.length === 2 && intersects(
              cards[0].getBoundingClientRect(), cards[1].getBoundingClientRect(),
            ),
            betOverlapsStack: Boolean(label && bet && intersects(
              label.getBoundingClientRect(), bet.getBoundingClientRect(),
            )),
            labelReadable: readable(label),
            betReadable: !bet || readable(bet),
            dealerReadable: !seat.querySelector('.dealer-button') || readable(seat.querySelector('.dealer-button')),
            positionReadable: !seat.querySelector('.seat-position-marker') || readable(seat.querySelector('.seat-position-marker')),
          };
        });
      // The hero's stack moved to the hero's seat and the corner panel became
      // a global tournament readout (E27-008). The geometry contract is
      // unchanged in substance: whatever occupies that corner must stay
      // readable and must not cover the hero's cards or the action dock.
      const heroHud = document.querySelector('.tournament-hud');
      const heroCards = document.querySelector('.hero-hole-cards');
      const actionDock = document.querySelector('.action-dock');
      const heroHudRect = heroHud?.getBoundingClientRect();
      const heroCardsRect = heroCards?.getBoundingClientRect();
      const actionDockRect = actionDock?.getBoundingClientRect();
      const hero = {
        readable: readable(heroHud),
        overlapsCards: Boolean(heroHudRect && heroCardsRect && intersects(heroHudRect, heroCardsRect)),
        overlapsActions: Boolean(heroHudRect && actionDockRect && intersects(heroHudRect, actionDockRect)),
      };
      // State-dependent surfaces: present only in the situations that produce
      // them, so each is "absent, or readable and not covering the table".
      // Checking them only when present is what lets one smoke run cover
      // surfaces that cannot all coexist in a single frame.
      const conditional = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return { present: false, ok: true };
        const rect = element.getBoundingClientRect();
        // Each clause is reported separately. "present, not ok" on its own
        // says nothing about whether the surface was too small, off-screen,
        // invisible, or simply sitting on top of something -- and those have
        // completely different fixes.
        const isReadable = readable(element);
        const overCards = Boolean(heroCardsRect && intersects(rect, heroCardsRect));
        const overActions = Boolean(actionDockRect && intersects(rect, actionDockRect));
        const ok = isReadable && !overCards && !overActions;
        return {
          present: true,
          ok,
          ...(ok
            ? {}
            : {
                why: { readable: isReadable, overCards, overActions },
                rect: {
                  x: Math.round(rect.x), y: Math.round(rect.y),
                  w: Math.round(rect.width), h: Math.round(rect.height),
                },
                opacity: getComputedStyle(element).opacity,
              }),
        };
      };
      const surfaces = {
        // Scoped to opponents. The hero seat is visibility:hidden by design --
        // the hero's presence is the stack HUD and the action dock, not an
        // avatar -- so an unscoped .thinking-ring selector finds the hero's
        // ring inside that hidden seat and reports the surface broken. This
        // smoke waits for a hero decision before measuring, so that was not an
        // edge case: it failed at all 20 viewport/scale combinations, every
        // run. The check is about an indicator a player can actually see,
        // which is an opponent's.
        actingIndicator: conditional(
          '.player-seat:not(.player-seat--hero) .thinking-ring',
        ),
        sidePots: conditional('.side-pot-strip'),
        equityReadout: conditional('.all-in-equity-strip'),
        showdownHighlight: conditional('.showdown-card.is-winning'),
      };
      return {
        seats,
        hero,
        surfaces,
        ok: seats.length >= 5 && hero.readable && !hero.overlapsCards && !hero.overlapsActions &&
          Object.values(surfaces).every((surface) => surface.ok) &&
          seats.every((seat) => !seat.cardsOverlap && !seat.betOverlapsStack &&
            seat.labelReadable && seat.betReadable && seat.dealerReadable && seat.positionReadable),
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? { ok: false, reason: "no geometry observation" };
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

/**
 * Poll for a decision at which `.action-button--raise` is genuinely enabled,
 * advancing past any decision where it is legitimately disabled instead of
 * forcing a click on it. Legal-action state is not seedable in this build (no
 * production-safe deterministic-seed hook exists -- see the audit report), so
 * this proves the raise control's enabled/disabled wiring is correct *and*
 * still exercises real raise-sizing input, rather than weakening the check
 * into a skip.
 */
async function ensureRaiseIsLegalThenAdvance(cdp) {
  const maxAdvances = 12;
  // Each advance can legitimately cost several seconds (opponent presentation
  // + the next hand's dealing), so this is bounded by wall-clock time as well
  // as iteration count -- 12 iterations at worst-case per-step cost could
  // otherwise dwarf the whole script's CDP session budget.
  const overallDeadline = Date.now() + 45_000;
  for (let attempt = 0; attempt <= maxAdvances; attempt += 1) {
    const raiseIsLegal = await waitForBoolean(
      cdp,
      `(() => {
        const button = document.querySelector(".action-button--raise");
        return button instanceof HTMLButtonElement && !button.disabled &&
          button.getBoundingClientRect().width > 2;
      })()`,
      attempt === 0 ? 1_500 : 6_000,
    );
    if (raiseIsLegal) {
      record(
        attempt === 0
          ? "raise was legal on the first live decision"
          : `raise became legal after advancing past ${attempt} illegal-to-raise decision(s)`,
        true,
      );
      return;
    }
    if (attempt === maxAdvances || Date.now() >= overallDeadline) {
      throw new Error(
        `raise mouse input: raise never became a legal action across ${attempt + 1} decision(s) ` +
          "(hero may be perpetually short-stacked/all-in-covered in this run); this is either a " +
          "real legality-gate defect or the bound needs to grow, not something to click through.",
      );
    }
    await advanceOneDecisionWithoutRaising(cdp);
  }
}

/**
 * Take a legal, non-raise action then fast-forward through the opponent
 * presentation back to the next decision. Prefer fold: an unseeded packaged
 * run can make call a stack-committing all-in, which turns an input smoke into
 * a random tournament-bust test rather than a queue test. Fold is legal at
 * every hero decision and guarantees the next hand can be reached.
 */
async function advanceOneDecisionWithoutRaising(cdp) {
  // The caller only just observed the raise button as (still) disabled; the
  // rest of `.action-dock` (including call/fold) can legitimately still be
  // mid-render at that exact instant. `selectorPoint` is a single, un-polled
  // snapshot, so wait for the dock itself before snapshotting its buttons --
  // otherwise a dock that renders a beat late reads as "neither call/check nor
  // fold available" even though both are about to appear.
  const dockReady = await waitForBoolean(
    cdp,
    "document.querySelector('.action-dock') !== null",
    6_000,
  );
  if (!dockReady) {
    throw new Error(
      "The action dock was not present while advancing past a non-raise decision.",
    );
  }
  const foldPoint = await selectorPoint(cdp, ".action-button--fold");
  if (foldPoint) {
    await mouseClick(cdp, foldPoint.x, foldPoint.y);
    record("advance past non-raise decision: fold mouse input", true);
  } else {
    const callPoint = await selectorPoint(cdp, ".action-button--call");
    if (!callPoint) {
      throw new Error(
        "Neither fold nor call/check was an enabled target while advancing past a non-raise decision.",
      );
    }
    await mouseClick(cdp, callPoint.x, callPoint.y);
    record("advance past non-raise decision: call/check mouse input", true);
  }
  await delay(200);

  const fastForwardSelector =
    'button.skip-hand';
  const fastForwardAppeared = await waitForBoolean(
    cdp,
    `document.querySelector(${JSON.stringify(fastForwardSelector)}) !== null`,
    6_000,
  );
  if (fastForwardAppeared) {
    const fastForwardPoint = await selectorPoint(cdp, fastForwardSelector);
    if (fastForwardPoint) {
      await mouseClick(cdp, fastForwardPoint.x, fastForwardPoint.y);
      record("queue fast-forward mouse input", true);
      await delay(150);
    }
  }

  const returnDeadline = Date.now() + 30_000;
  let dockReturned = false;
  while (Date.now() < returnDeadline) {
    dockReturned = await waitForBoolean(
      cdp,
      "document.querySelector('.action-dock') !== null",
      Math.min(5_000, Math.max(250, returnDeadline - Date.now())),
    );
    if (dockReturned) break;
    // Packaging/CDP focus changes can correctly pause the table mid-queue.
    // Resume through the same visible player confirmation used elsewhere in
    // this audit, then continue waiting for the queued hand to reach hero.
    await ensureNotPaused(cdp);
  }
  if (!dockReturned) {
    const tableState = await evaluateValue(
      cdp,
      "document.querySelector('.table-screen')?.innerText?.slice(0, 2000)",
    );
    throw new Error(
      "The table did not return to a new decision after advancing past a non-raise decision " +
        `(the tournament may have ended, e.g. hero busted); the raise-legality poll cannot continue. State: ${JSON.stringify(tableState)}`,
    );
  }
}

/**
 * Resume from a known, unpaused baseline before a keyboard step that depends
 * on Escape's toggle semantics. The table can already be paused for a
 * legitimate reason (see the `Page.bringToFront` notes above), and resuming
 * first makes the following Escape press unambiguous.
 */
async function ensureNotPaused(cdp) {
  const alreadyPaused = await waitForBoolean(
    cdp,
    "document.querySelector('.pause-menu') !== null",
    400,
  );
  if (!alreadyPaused) return;
  record("pre-existing auto-pause observed before keyboard check (native window-blur pause)", true);
  await expectMouseClick(
    cdp,
    ".pause-menu .primary-button",
    "Resume table",
    "dismiss pre-existing auto-pause before keyboard check",
  );
  await expectBoolean(
    cdp,
    "document.querySelector('.pause-menu') === null",
    "auto-pause dismissed to a known baseline before keyboard check",
  );
}

/**
 * Send Escape and confirm `.pause-menu` opens, retrying a bounded number of
 * times against a known, resumed baseline. Escape toggles pause state, so a
 * native window-blur auto-pause that lands in the split second between the
 * baseline check and the keypress can still close a menu that just opened
 * from the blur itself, reading as "no pause menu" once. Retrying from a
 * freshly-resumed baseline resolves that race without weakening what is
 * checked: the final assertion is still a real Escape press producing a real
 * `.pause-menu`.
 */
async function pressEscapeUntilPauseMenuOpens(cdp) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await ensureNotPaused(cdp);
    await sendKey(cdp, "Escape", "Escape", 27);
    const opened = await waitForBoolean(
      cdp,
      "document.querySelector('.pause-menu') !== null",
      attempt === maxAttempts ? 8_000 : 3_000,
    );
    if (opened) {
      record("keyboard pause input", true);
      return;
    }
    if (attempt === maxAttempts) {
      record("keyboard pause input", false);
      throw new Error(
        `keyboard pause input: .pause-menu was not present after ${maxAttempts} Escape attempts.`,
      );
    }
    record(`keyboard pause input attempt ${attempt} did not land (possible auto-pause race); retrying`, true);
  }
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
  // Chromium can apply a native range-pointer event while never replying to
  // the corresponding CDP request under Electron. Send the same real CDP
  // pointer traffic without awaiting that acknowledgement, then the caller
  // verifies the observable range value changed. This is stricter than a DOM
  // assignment and avoids classifying a transport quirk as a product failure.
  dispatchMouseEventWithoutAcknowledgement(cdp, {
    type: "mouseMoved", x: point.x, y: point.y, button: "none", buttons: 0,
  });
  dispatchMouseEventWithoutAcknowledgement(cdp, {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
  });
  dispatchMouseEventWithoutAcknowledgement(cdp, {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
  });
  await delay(100);
}

function dispatchMouseEventWithoutAcknowledgement(cdp, params) {
  if (cdp.socket.readyState !== WebSocket.OPEN) {
    throw new Error("Packaged renderer CDP target closed before pointer dispatch.");
  }
  const id = cdp.nextId;
  cdp.nextId += 1;
  cdp.socket.send(JSON.stringify({ id, method: "Input.dispatchMouseEvent", params }));
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
 *
 * The app's polling loop only notices a press by sampling `getGamepads()` on
 * its own requestAnimationFrame callback (src/components/
 * GamepadNavigationProvider.tsx), which Electron can throttle heavily whenever
 * the window is not genuinely focused/unoccluded (`backgroundThrottling`,
 * default on). A short press can fall entirely between two throttled frames
 * and never be sampled at all -- no amount of waiting afterward fixes that,
 * since the edge-triggered intent (press-then-release) already came and went.
 * Holding the mock press for several seconds instead of one frame's worth
 * gives even a heavily throttled loop many chances to observe it; the
 * edge-trigger logic in readGamepadIntents only fires once regardless of how
 * long the button stays down, so this does not change what is proven.
 */
async function pressMockGamepadA(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      // Keep a renderer-side trace of the public event boundary. This is
      // deliberately observation only: the smoke still has to enter through
      // the browser Gamepad API and the table still has to react on its own.
      // It distinguishes a throttled/unobserved browser poll from a real
      // provider-to-table routing failure when a packaged run is inconclusive.
      const audit = window.__ptpGamepadAudit ?? { events: [], samples: [] };
      if (!window.__ptpGamepadAudit) {
        window.__ptpGamepadAudit = audit;
        window.addEventListener("ptp:gameaction", (event) => {
          audit.events.push({
            actionId: event.detail?.actionId ?? null,
            hidden: document.hidden,
            table: Boolean(document.querySelector(".table-screen")),
            paused: Boolean(document.querySelector(".pause-menu")),
            at: performance.now(),
          });
        });
      }
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
      audit.samples.push({
        hidden: document.hidden,
        visibilityState: document.visibilityState,
        hasTable: Boolean(document.querySelector(".table-screen")),
        hasActionDock: Boolean(document.querySelector(".action-dock")),
        paused: Boolean(document.querySelector(".pause-menu")),
        at: performance.now(),
      });
      setTimeout(() => { buttons[0].pressed = false; buttons[0].value = 0; }, 3_000);
      return true;
    })()`,
    returnByValue: true,
    userGesture: true,
  });
  if (result.result?.value !== true) throw new Error("Could not inject Gamepad API snapshot.");
  record("Gamepad API A-button input", true);
  await delay(400);
}

/**
 * Press the mock gamepad A button and confirm it actually routed to a game
 * action (`.spectator-dock`), retrying a bounded number of times. Even a
 * multi-second held press can still be missed if the app's rAF polling loop
 * is heavily throttled at that exact moment, or if a stray auto-pause
 * (see the `Page.bringToFront`/`detectContext` note above) rerouted the press
 * to menu-activate instead of a game action. Both are real, evidenced races
 * this script cannot fully rule out from outside the process; retrying from a
 * freshly-resumed baseline is the same technique already used for the
 * keyboard pause check, and still requires a genuine press-to-action-routing
 * proof to pass.
 */
async function pressMockGamepadAUntilRouted(cdp) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await ensureNotPaused(cdp);
    await pressMockGamepadA(cdp);
    const routed = await waitForBoolean(
      cdp,
      "document.querySelector('.spectator-dock') !== null",
      attempt === maxAttempts ? 8_000 : 3_000,
    );
    if (routed) {
      record("Gamepad API check or call routing", true);
      return;
    }
    if (attempt === maxAttempts) {
      record("Gamepad API check or call routing", false);
      const audit = await evaluateValue(
        cdp,
        "JSON.stringify(window.__ptpGamepadAudit ?? null)",
      );
      throw new Error(
        `Gamepad API check or call routing: .spectator-dock was not present after ${maxAttempts} press attempts. Renderer trace: ${audit ?? "unavailable"}`,
      );
    }
    record(`Gamepad API check or call routing attempt ${attempt} did not land; retrying`, true);
  }
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

async function waitForBoolean(cdp, expression, timeout = 8_000) {
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
