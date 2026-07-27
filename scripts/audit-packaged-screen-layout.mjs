/**
 * Cross-screen layout audit for the packaged build: overlap, reach, and size.
 *
 * The packaged input smoke already checks the *table* thoroughly -- seat lanes,
 * bets, cards, and the hero dock across five viewports and every interface
 * scale. Every other screen in the game had no geometry coverage at all, and
 * the screens are where a player spends the minutes before and after a hand.
 *
 * The central check is deliberately not rectangle intersection. Two controls
 * whose boxes overlap may be perfectly usable -- nested, transparent in the
 * overlapping region, or `pointer-events: none`. What actually breaks a UI is a
 * control the player cannot hit, so this asks the browser the same question the
 * player's mouse does: `elementFromPoint` at the control's centre, and at its
 * corners. If something else answers, that control is covered, and the report
 * names what covered it. That catches real defects (a decorative layer with a
 * stray z-index, a sticky header eating the first row) and stays quiet about
 * harmless overlap, which is what makes it worth running.
 *
 * Alongside that:
 *  - controls that fall outside the viewport, which are unreachable by mouse;
 *  - controls below the WCAG 2.2 AA 24x24 CSS-pixel target-size minimum, with
 *    the standard's spacing exception applied;
 *  - text clipped by an ancestor that hides its overflow, excluding the
 *    visually-hidden pattern and deliberate ellipsis truncation.
 *
 * Screenshots of every screen at every viewport are written next to the report
 * so the aesthetic half of a review can be done by looking rather than by
 * reading numbers.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";
import {
  PackagedSession,
  argumentValue,
  delay,
  isKnownElectronSandboxDiagnostic,
} from "./lib/packaged-cdp-session.mjs";

const PROFILE_PREFIX = "poker-training-pro-screen-layout-";
// The smallest supported window, a common laptop, and a desktop. The input
// smoke's five viewports cover the table; these three cover the shells without
// tripling an already long run.
const VIEWPORTS = Object.freeze([
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1600x900", width: 1600, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
]);

const appPath = resolve(
  projectRoot,
  argumentValue("--app") ??
    "outputs/desktop/win-unpacked/Poker Training Pro.exe",
);
const outputDirectory = resolve(projectRoot, "work", "screen-layout");
const reportPath = resolve(projectRoot, "work", "packaged-screen-layout.json");
const timeoutMs = Number(argumentValue("--timeout-ms") ?? 300_000);
const captureScreenshots = !process.argv.includes("--no-screenshots");

if (process.platform !== "win32") {
  throw new Error("Packaged screen layout audit requires Windows.");
}
if (!existsSync(appPath)) {
  throw new Error(`Packaged executable not found: ${appPath}`);
}

let failure;
let transportTimeout;
let session;
const screens = [];
const findings = [];
let modalFocus;
let frameworkDiagnostics = [];

await mkdir(outputDirectory, { recursive: true });

try {
  session = await PackagedSession.launch({
    appPath,
    profilePrefix: PROFILE_PREFIX,
    timeoutMs,
  });

  // Captured before anything is dismissed: the first-run gate is the first
  // thing a player ever sees and is otherwise never measured.
  await session.waitFor(".startup-gate, .home-reference", "first screen");
  await visit(session, "first-run-setup");

  await session.reachHome();
  await visit(session, "home-menu");

  // Reachable only because the credits link is no longer covered by the
  // play-chip notice; before that fix a mouse could not get to this screen.
  await session.clickSelector(
    ".home-reference__credits-link",
    "credits & licenses link",
  );
  await session.waitFor(".credits-screen", "credits screen");
  await visit(session, "credits");
  await session.clickSelector(".credits-screen .night-back", "credits back");
  await session.waitFor(".home-reference", "home menu");

  await session.clickSelector('button[aria-label="Settings"]', "settings button");
  await session.waitFor(".night-settings", "settings panel");
  await visit(session, "settings");
  await session.clickSelector(".night-back", "settings back");
  await session.waitFor(".home-reference", "home menu");

  await session.clickSelector('button[aria-label="Play"]', "play button");
  await session.clickIfPresent(
    "#play-chip-ack-title ~ .startup-gate__actions button",
  );
  await session.waitFor(".mode-stage", "mode selection");
  await visit(session, "mode-select");

  /*
    The standalone reference (E21-003) is a dense, text-heavy screen and the
    likeliest place for a narrow viewport to break a table. Its entry point
    shares a class with the tutorial link, so it is matched by its text.
  */
  const openedReference = await session.evaluate(`(() => {
    const link = [...document.querySelectorAll('.mode-stage__tutorial-link')]
      .find((candidate) => /poker reference/i.test(candidate.textContent || ''));
    if (!(link instanceof HTMLElement)) return false;
    link.click();
    return true;
  })()`);
  if (openedReference) {
    await session.waitFor(".reference-panel", "poker reference");
    await visit(session, "poker-reference");
    await session.clickSelector(".reference-shell .night-back", "reference back");
    await session.waitFor(".mode-stage", "mode selection");
  }

  await session.clickSelector(".mode-stage__choice--normal", "Normal mode");
  await session.waitForButton("Enter event", "career event lobby");
  await visit(session, "career-lobby");

  await session.clickButton("Enter event");
  await session.waitFor(".room-flight", "championship arrival");
  await visit(session, "arrival-flythrough");

  /*
    The fly-through advances on its own. Measuring it at three viewports takes
    long enough that the skip button is often gone by the time we look for it,
    and waiting for a button that has served its purpose burned the entire
    remaining budget on the first run. Skip it if it is still offered, and
    otherwise just wait for where it was taking us.
  */
  await session.clickIfPresent(".room-flight button");
  await session.waitFor(".poker-table", "live table");
  await delay(1_500);
  await visit(session, "live-table");

  // The pause overlay sits on top of the table and is the densest stack of
  // interactive controls in the game, so it is the likeliest place for one
  // control to end up under another.
  const paused = await openPauseOverlay(session);
  if (paused) {
    await visit(session, "table-pause-overlay");
    const containment = await checkModalFocusContainment(session);
    modalFocus = containment;
    if (containment?.present && containment.focusables > 0 && !containment.contained) {
      findings.push({
        area: "modal-focus-containment",
        blocking: true,
        screen: "table-pause-overlay",
        detail: `Focus escaped the pause dialog: Tab from the last control landed on ${containment.tabFromLast.active} ${JSON.stringify(containment.tabFromLast.label)} (inside=${containment.tabFromLast.inside}), Shift+Tab from the first landed on ${containment.shiftTabFromFirst.active} ${JSON.stringify(containment.shiftTabFromFirst.label)} (inside=${containment.shiftTabFromFirst.inside}).`,
      });
    }
  }

  const fatal = session.cdp.takeFatalEvents();
  frameworkDiagnostics = fatal.filter(isKnownElectronSandboxDiagnostic);
  const applicationErrors = fatal.filter(
    (event) => !isKnownElectronSandboxDiagnostic(event),
  );
  if (applicationErrors.length > 0) {
    throw new Error(
      `renderer emitted fatal CDP events: ${JSON.stringify(applicationErrors)}`,
    );
  }

  const blocking = findings.filter((finding) => finding.blocking);
  if (blocking.length > 0) {
    failure = blocking
      .slice(0, 12)
      .map((finding) => finding.detail)
      .join(" | ");
  }
} catch (error) {
  const classified = classifyCdpFailure(error);
  if (classified.transportTimeout) {
    transportTimeout = classified.transportTimeout;
  } else {
    failure = classified.failure;
  }
} finally {
  if (session) await session.dispose();
}

const report = reportCdpOutcome(
  {
    schemaVersion: 1,
    executable: basename(appPath),
    scope:
      "Packaged cross-screen layout audit: for every major screen at three viewports, every interactive control is hit-tested with elementFromPoint at its centre and corners to prove nothing covers it, checked against the viewport bounds, and checked against the WCAG 2.2 AA 24x24 minimum target size with the standard's spacing exception. Text clipped by an overflow-hiding ancestor is reported, excluding the visually-hidden pattern and deliberate ellipsis truncation. Screenshots are written to work/screen-layout for visual review. The table's own seat geometry is covered in more depth by the packaged input smoke.",
    viewports: VIEWPORTS,
    screenshotDirectory: captureScreenshots
      ? "work/screen-layout"
      : "not captured",
    screens,
    ...(modalFocus ? { modalFocus } : {}),
    findings,
    ...(frameworkDiagnostics.length > 0 ? { frameworkDiagnostics } : {}),
  },
  { failure, transportTimeout },
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/** Measure one screen at every viewport, capturing a screenshot of each. */
async function visit(activeSession, name) {
  const measurements = [];
  try {
    for (const viewport of VIEWPORTS) {
      await activeSession.cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Layout settles on the next rendering turn; a grid re-flow can take more
      // than one frame.
      await delay(320);
      measurements.push({
        viewport: viewport.name,
        ...(await inspectLayout(activeSession)),
      });
      if (captureScreenshots) {
        await capture(activeSession, `${name}@${viewport.name}.png`);
      }
    }
  } finally {
    await activeSession.cdp.send("Emulation.clearDeviceMetricsOverride");
    await delay(220);
  }
  /*
    Recorded as each screen is measured, not in one pass at the end. A failure
    on a later screen used to discard every finding gathered before it: the
    first run navigated six screens, found a covered control on the home menu,
    then timed out on the fly-through and filed a report saying "0 findings".
  */
  const screen = { screen: name, measurements };
  screens.push(screen);
  findings.push(...collectScreenFindings(screen));
}

async function capture(activeSession, fileName) {
  const shot = await activeSession.cdp.send("Page.captureScreenshot", {
    format: "png",
  });
  if (shot?.data) {
    await writeFile(join(outputDirectory, fileName), Buffer.from(shot.data, "base64"));
  }
}

/**
 * Hit-test every interactive control, and look for clipped text.
 */
async function inspectLayout(activeSession) {
  return await activeSession.evaluate(`(() => {
    const describe = (element) => {
      if (!element) return 'nothing';
      const classes = String(element.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      const id = element.id ? '#' + element.id : '';
      return element.tagName.toLowerCase() + id + (classes.length ? '.' + classes.join('.') : '');
    };
    const label = (element) => (
      element.getAttribute('aria-label') ||
      (element.textContent || '').trim() ||
      element.getAttribute('title') ||
      ''
    ).slice(0, 48);

    const CONTROL_SELECTOR =
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

    /*
      When a modal is open, the reachable surface *is* the modal. Everything
      behind it is meant to be unclickable, and the scrim covering it is the
      feature working. Without this the pause menu produced 30 "covered
      control" failures naming the table's own buttons -- every one of them
      correct behaviour.

      The exposure count below is recorded as data, not judged. Leaving
      background controls outside an \`inert\` or \`aria-hidden\` subtree only
      matters if focus can actually reach them, and a JS focus trap can contain
      Tab without either attribute -- which is exactly what this app does. The
      containment check that follows tests the behaviour with real key events
      instead of inferring it from markup.
    */
    const modalRoot = document.querySelector('[aria-modal="true"], [role="dialog"]');
    const scope = modalRoot ?? document;
    const modal = modalRoot
      ? {
          present: true,
          selector: describe(modalRoot),
          backgroundControlsExposed: [...document.querySelectorAll(CONTROL_SELECTOR)]
            .filter((element) => !modalRoot.contains(element))
            .filter((element) => {
              if (element.closest('[inert]') || element.closest('[aria-hidden="true"]')) return false;
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length,
        }
      : { present: false };

    const controls = [...scope.querySelectorAll(CONTROL_SELECTOR)].filter((element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) === 0) return false;
      if (element.disabled) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const covered = [];
    const offscreen = [];
    const undersized = [];

    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      const horizontallyOut = rect.right <= 0 || rect.left >= innerWidth;
      const verticallyOut = rect.bottom <= 0 || rect.top >= innerHeight;
      if (horizontallyOut || verticallyOut) {
        /*
          Out of view is not the same as out of reach. A settings panel that
          scrolls has most of its controls below the fold at any moment, and the
          first version of this counted all of them -- 176 "unreachable"
          controls on one screen, every one of them a scroll away. Only report a
          control that no scrollable ancestor can bring into view.
        */
        const scrollable = (axis) => {
          for (let node = control.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            const overflow = axis === 'y' ? style.overflowY : style.overflowX;
            const scrolls = overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
            const extent = axis === 'y'
              ? node.scrollHeight - node.clientHeight
              : node.scrollWidth - node.clientWidth;
            if (scrolls && extent > 4) return true;
          }
          const root = document.documentElement;
          return axis === 'y'
            ? root.scrollHeight - root.clientHeight > 4
            : root.scrollWidth - root.clientWidth > 4;
        };
        const reachable =
          (!horizontallyOut || scrollable('x')) && (!verticallyOut || scrollable('y'));
        if (!reachable) {
          offscreen.push({
            control: describe(control), label: label(control),
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            axis: horizontallyOut ? 'horizontal' : 'vertical',
          });
        }
        // Either way it is not on screen now, so it cannot be hit-tested.
        continue;
      }

      /*
        WCAG 2.2 AA 2.5.8: a target under 24x24 passes if a 24px circle centred
        on it does not touch the circle of any other target. Approximated by
        requiring 24px of centre-to-centre distance from every other control,
        which is the check the standard's spacing exception describes.
      */
      if (rect.width < 24 || rect.height < 24) {
        const centreX = rect.left + rect.width / 2;
        const centreY = rect.top + rect.height / 2;
        const crowdedBy = controls.filter((other) => {
          if (other === control) return false;
          const otherRect = other.getBoundingClientRect();
          const dx = (otherRect.left + otherRect.width / 2) - centreX;
          const dy = (otherRect.top + otherRect.height / 2) - centreY;
          return Math.hypot(dx, dy) < 24;
        });
        if (crowdedBy.length > 0) {
          undersized.push({
            control: describe(control), label: label(control),
            size: { w: Math.round(rect.width), h: Math.round(rect.height) },
            crowdedBy: crowdedBy.slice(0, 3).map(describe),
          });
        }
      }

      // Hit-test the centre and the four inset corners. A control only counts
      // as covered when its centre is blocked, or when three or more of the
      // five probes are: one blocked corner is usually a rounded border or a
      // neighbouring control's shadow, not an unusable control.
      const probes = [
        { name: 'centre', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { name: 'top-left', x: rect.left + Math.min(6, rect.width / 4), y: rect.top + Math.min(6, rect.height / 4) },
        { name: 'top-right', x: rect.right - Math.min(6, rect.width / 4), y: rect.top + Math.min(6, rect.height / 4) },
        { name: 'bottom-left', x: rect.left + Math.min(6, rect.width / 4), y: rect.bottom - Math.min(6, rect.height / 4) },
        { name: 'bottom-right', x: rect.right - Math.min(6, rect.width / 4), y: rect.bottom - Math.min(6, rect.height / 4) },
      ];
      const blocked = [];
      for (const probe of probes) {
        if (probe.x < 0 || probe.y < 0 || probe.x > innerWidth || probe.y > innerHeight) continue;
        const hit = document.elementFromPoint(probe.x, probe.y);
        if (!hit) { blocked.push({ ...probe, by: 'nothing' }); continue; }
        // The control itself, an ancestor, or one of its own children all mean
        // the player's click reaches it.
        if (hit === control || control.contains(hit) || hit.contains(control)) continue;
        blocked.push({ probe: probe.name, by: describe(hit) });
      }
      const centreBlocked = blocked.some((entry) => entry.probe === 'centre');
      if (centreBlocked || blocked.length >= 3) {
        covered.push({
          control: describe(control), label: label(control),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          centreBlocked, blockedProbes: blocked.length, blocked: blocked.slice(0, 5),
        });
      }
    }

    const clipped = [];
    for (const element of document.querySelectorAll('h1, h2, h3, h4, p, button, label, li, .eyebrow, .stat-value')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (element.closest('.visually-hidden')) continue;
      if (element.clientWidth <= 4 || element.clientHeight <= 4) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const hides = (value) => value === 'hidden' || value === 'clip';
      const ellipsis = style.textOverflow === 'ellipsis';
      const overflowX = element.scrollWidth - element.clientWidth;
      const overflowY = element.scrollHeight - element.clientHeight;
      if ((hides(style.overflowX) && !ellipsis && overflowX > 2) || (hides(style.overflowY) && overflowY > 2)) {
        clipped.push({
          element: describe(element),
          overflowX: hides(style.overflowX) && !ellipsis ? overflowX : 0,
          overflowY: hides(style.overflowY) ? overflowY : 0,
          text: (element.textContent || '').trim().slice(0, 60),
        });
      }
    }

    return {
      controls: controls.length,
      modal,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      covered, coveredCount: covered.length,
      offscreen, offscreenCount: offscreen.length,
      undersized, undersizedCount: undersized.length,
      clipped: clipped.slice(0, 20), clippedCount: clipped.length,
    };
  })()`);
}

/**
 * Test the modal's focus contract with real key events.
 *
 * A modal promises that Tab does not wander out of it. Markup cannot tell you
 * whether that holds: `aria-modal` is advice to assistive technology and does
 * not stop Tab, while a JS trap contains Tab with no attribute to show for it.
 * So this focuses the last control inside the dialog, presses Tab through CDP,
 * and asks where focus actually went -- then does the same with Shift+Tab from
 * the first control, which is the direction wraparound traps usually miss.
 */
async function checkModalFocusContainment(activeSession) {
  const focusableExpression = `[...modal.querySelectorAll(
    'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.disabled && element.getBoundingClientRect().width > 0)`;

  const focusEdge = async (edge) =>
    await activeSession.evaluate(`(() => {
      const modal = document.querySelector('[aria-modal="true"], [role="dialog"]');
      if (!modal) return { present: false };
      const focusables = ${focusableExpression};
      if (focusables.length === 0) return { present: true, focusables: 0 };
      const target = ${edge === "last" ? "focusables[focusables.length - 1]" : "focusables[0]"};
      target.focus();
      return {
        present: true,
        focusables: focusables.length,
        focused: document.activeElement === target,
      };
    })()`);

  const activeInsideModal = async () =>
    await activeSession.evaluate(`(() => {
      const modal = document.querySelector('[aria-modal="true"], [role="dialog"]');
      const active = document.activeElement;
      return {
        inside: Boolean(modal && active && modal.contains(active)),
        active: active
          ? active.tagName.toLowerCase() + (active.className ? '.' + String(active.className).trim().split(/\\s+/)[0] : '')
          : 'none',
        label: active ? (active.getAttribute('aria-label') || (active.textContent || '').trim()).slice(0, 40) : '',
      };
    })()`);

  const pressTab = async (shift) => {
    for (const type of ["keyDown", "keyUp"]) {
      await activeSession.cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
        ...(shift ? { modifiers: 8 } : {}),
      });
    }
    await delay(160);
  };

  const forwardStart = await focusEdge("last");
  if (!forwardStart?.present || !forwardStart.focusables) return forwardStart;
  await pressTab(false);
  const afterTab = await activeInsideModal();

  await focusEdge("first");
  await pressTab(true);
  const afterShiftTab = await activeInsideModal();

  return {
    present: true,
    focusables: forwardStart.focusables,
    tabFromLast: afterTab,
    shiftTabFromFirst: afterShiftTab,
    contained: afterTab.inside && afterShiftTab.inside,
  };
}

/** Open the in-table pause overlay, by button if there is one, else by Escape. */
async function openPauseOverlay(activeSession) {
  const byButton = await activeSession.clickIfPresent(
    'button[aria-label="Pause table"]',
  );
  if (!byButton) {
    await activeSession.cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await activeSession.cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
  }
  await delay(500);
  return await activeSession.evaluate(
    "document.querySelector('.pause-menu, .pause-scrim') !== null",
  );
}

function collectScreenFindings(screen) {
  const results = [];
  for (const measurement of screen.measurements) {
    const where = `${screen.screen} @ ${measurement.viewport}`;
    for (const control of measurement.covered) {
      results.push({
        area: "covered-control",
        blocking: true,
        screen: screen.screen,
        viewport: measurement.viewport,
        detail: `${where}: ${control.control} ${JSON.stringify(control.label)} is covered -- ${control.centreBlocked ? "its centre" : `${control.blockedProbes} of 5 probes`} hit ${control.blocked.map((entry) => entry.by).join(", ")} instead.`,
      });
    }
    for (const control of measurement.offscreen) {
      results.push({
        area: "offscreen-control",
        blocking: true,
        screen: screen.screen,
        viewport: measurement.viewport,
        detail: `${where}: ${control.control} ${JSON.stringify(control.label)} sits outside the viewport at ${JSON.stringify(control.rect)}, so it cannot be clicked.`,
      });
    }
    if (measurement.documentOverflowX > 2) {
      results.push({
        area: "document-overflow",
        blocking: true,
        screen: screen.screen,
        viewport: measurement.viewport,
        detail: `${where}: the document scrolls sideways by ${measurement.documentOverflowX}px.`,
      });
    }
    for (const control of measurement.undersized) {
      results.push({
        area: "target-size",
        blocking: false,
        screen: screen.screen,
        viewport: measurement.viewport,
        detail: `${where}: ${control.control} ${JSON.stringify(control.label)} is ${control.size.w}x${control.size.h}, under the 24x24 minimum, and sits within 24px of ${control.crowdedBy.join(", ")}.`,
      });
    }
    if (measurement.clippedCount > 0) {
      results.push({
        area: "clipped-text",
        blocking: false,
        screen: screen.screen,
        viewport: measurement.viewport,
        detail: `${where}: ${measurement.clippedCount} element(s) clipped by an overflow-hiding ancestor: ${JSON.stringify(measurement.clipped.slice(0, 4))}.`,
      });
    }
  }
  return results;
}
