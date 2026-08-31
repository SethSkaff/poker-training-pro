/**
 * Packaged coverage for the presentation surfaces that were only ever asserted
 * in jsdom or against source (E25-003).
 *
 * Nine packaged audits already drive the real EXE, but motion tiers, text
 * direction, text expansion, and the arrival fly-through's depth behaviour were
 * checked only in unit tests. That gap matters more than a missing test usually
 * does, because **jsdom has no layout engine and no real cascade**: it cannot
 * tell you that `transition-duration` resolved to `0s`, that a `transform`
 * actually scales one table smaller than another, or that a heading is clipped
 * by its container. Those claims can only be made where there is a compositor,
 * and the shipped compositor is the packaged build's.
 *
 * Three things are measured:
 *
 *  1. **Motion tiers.** The chain is "settings control writes a root data
 *     attribute" plus "that attribute changes computed style in the shipped
 *     CSS". Both halves are measured separately and the report says which is
 *     which. The first half is driven entirely through the real settings UI.
 *     The second half sets the attribute directly and reads
 *     `getComputedStyle`, because re-entering an event to observe each of five
 *     surfaces at three tiers would mean fifteen navigations to prove a cascade
 *     that is identical in all of them. Where a surface is on screen anyway its
 *     real element is measured; where the surface is inherently transient a
 *     probe element carrying the real class is measured instead. The report
 *     records `method: "live"` or `method: "probe"` per check rather than
 *     letting the weaker evidence pass for the stronger.
 *
 *  2. **Arrival fly-through depth.** Every table's `--venue-depth` and its
 *     resolved transform matrix, read from the live fly-through. A flat wall of
 *     identically-scaled tables is the regression this exists to catch, and it
 *     is invisible without a compositor: the unit test can only prove the
 *     number was written to the inline style.
 *
 *  3. **Direction and text expansion, with real layout.** The build ships one
 *     locale, so there is no runtime language switch to drive. What *can* be
 *     verified in the packaged build is that the shipped CSS survives a
 *     direction flip and the ~40% growth a real translation brings, so the
 *     audit applies both to the real DOM and measures clipping and overflow.
 *     This is a layout-robustness gate, not a translation gate, and the report
 *     scopes it as such.
 *
 * Document-level horizontal overflow and elements pushed off the viewport fail
 * in any state. Element clipping fails only where a state *introduces* it:
 * clipping already present in the untouched build is reported as a finding
 * rather than swallowed, but it is a design bug for the GUI backlog, not
 * evidence that direction handling regressed.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { projectRoot } from "./release/shared.mjs";
import { classifyCdpFailure, reportCdpOutcome } from "./lib/cdp-outcome.mjs";
import {
  PackagedSession,
  argumentValue,
  delay,
  isKnownElectronSandboxDiagnostic,
} from "./lib/packaged-cdp-session.mjs";

const PROFILE_PREFIX = "poker-training-pro-presentation-";
const TIERS = Object.freeze(["full", "reduced", "off"]);
// Index into the choice buttons rendered by `MotionControl`, whose order is
// fixed by `motionChoices` in SettingsPanel.tsx.
const TIER_INDEX = Object.freeze({ full: 0, reduced: 1, off: 2 });
const SURFACES = Object.freeze([
  { key: "menu", dataset: "motionMenu", heading: "menu-motion-heading" },
  { key: "room", dataset: "motionRoom", heading: "room-motion-heading" },
  { key: "camera", dataset: "motionCamera", heading: "camera-motion-heading" },
  { key: "table", dataset: "motionTable", heading: "table-motion-heading" },
  {
    key: "transition",
    dataset: "motionTransition",
    heading: "transition-motion-heading",
  },
]);
const DATASET_KEYS = SURFACES.map((surface) => surface.dataset);

const appPath = resolve(
  projectRoot,
  argumentValue("--app") ??
    "outputs/current/win-unpacked/Poker Training Pro.exe",
);
const reportPath = resolve(
  projectRoot,
  "work",
  "packaged-presentation-surfaces.json",
);
// Reaching a live table means entering a career event and skipping the arrival.
// No event is played to completion, so this is far short of the mode-completion
// budget.
const timeoutMs = Number(argumentValue("--timeout-ms") ?? 240_000);

if (process.platform !== "win32") {
  throw new Error("Packaged presentation audit requires Windows.");
}
if (!existsSync(appPath)) {
  throw new Error(`Packaged executable not found: ${appPath}`);
}

let failure;
let transportTimeout;
let session;
const findings = [];
const motion = { control: [], effect: {}, globalOverride: undefined };
const direction = { screens: [] };
const observations = {};
let flythrough;
let frameworkDiagnostics = [];

try {
  session = await PackagedSession.launch({
    appPath,
    profilePrefix: PROFILE_PREFIX,
    timeoutMs,
  });
  await session.reachHome();

  direction.screens.push(await auditDirection(session, "home"));
  /*
    Measured on the home menu against `.home-reference__media`, whose art and
    light layer carry the `home-reference-drift` / `home-reference-light`
    animations. The menu tier's other target, `.night-scene`, is a still
    illustration -- see `observations.staticMenuDecoration` below -- so probing
    it measures nothing and proves nothing.
  */
  motion.effect.menu = await measureTier(session, {
    dataset: "motionMenu",
    selectors: [".home-reference__media *", ".home-reference__media"],
    method: "live",
    requireAnimated: true,
    properties: ["animationName", "animationDuration", "transitionDuration"],
  });

  await session.clickSelector('button[aria-label="Settings"]', "settings button");
  await session.waitFor(".night-settings", "settings panel");
  motion.control = await auditMotionControls(session);
  motion.globalOverride = await auditGlobalReduceMotionOverride(session);
  await session.clickSelector(".night-back", "settings back button");
  await session.waitFor(".home-reference", "home menu");

  await reachModeSelect(session);
  observations.staticMenuDecoration = await measureSceneMotion(session);
  await enterFirstCareerEvent(session);
  flythrough = await auditFlythroughDepth(session);
  motion.effect.room = await measureTier(session, {
    dataset: "motionRoom",
    selectors: [".venue-table"],
    method: "live",
    properties: ["transitionDuration", "animationName"],
  });

  await session.clickButton("Skip arrival");
  await session.waitFor(".poker-table", "live table");
  motion.effect.camera = await measureTier(session, {
    dataset: "motionCamera",
    selectors: [".poker-scene"],
    method: "live",
    properties: ["transitionDuration", "animationName"],
  });
  // `.opponent-cards` only mounts while a seat is showing cards, so it is not
  // reliably on screen at an arbitrary moment. The thinking ring carries the
  // same tier rules and is part of every seat.
  motion.effect.table = await measureTier(session, {
    dataset: "motionTable",
    selectors: [".thinking-ring", ".opponent-cards", ".seat-bet"],
    method: "live",
    properties: ["animationName", "animationDuration"],
  });
  // The transition overlay exists only while a room change is in flight, so
  // polling cannot reliably catch it. A probe element carrying the real class
  // measures the same shipped rules through the same cascade.
  motion.effect.transition = await measureTier(session, {
    dataset: "motionTransition",
    selectors: [".room-progress-overlay"],
    method: "probe",
    probeHtml: '<div class="room-progress-overlay"></div>',
    properties: ["animationName", "animationDuration"],
  });
  direction.screens.push(await auditDirection(session, "table"));

  findings.push(
    ...collectMotionFindings(motion),
    ...collectFlythroughFindings(flythrough),
    ...collectDirectionFindings(direction),
    ...collectObservationFindings(observations),
  );

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
    failure = blocking.map((finding) => finding.detail).join(" | ");
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
      "Packaged verification of the presentation surfaces previously asserted only in jsdom or against source: per-surface motion tiers (settings control to root attribute, and root attribute to computed style), the arrival fly-through's per-table depth and resolved transforms, and layout robustness under a direction flip and ~40% text expansion. It is not a translation gate -- the build ships one locale -- and it plays no event to completion.",
    motion,
    flythrough,
    direction,
    observations,
    findings,
    ...(frameworkDiagnostics.length > 0 ? { frameworkDiagnostics } : {}),
  },
  { failure, transportTimeout },
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/**
 * Drive every motion control through the real settings UI and read back the
 * root attribute each one owns.
 */
async function auditMotionControls(activeSession) {
  const results = [];
  for (const surface of SURFACES) {
    const group = `.night-speed[aria-labelledby="${surface.heading}"]`;
    await activeSession.waitFor(group, `${surface.key} motion control`);
    for (const tier of TIERS) {
      const index = TIER_INDEX[tier];
      const applied = await activeSession.evaluate(`(() => {
        const group = document.querySelector(${JSON.stringify(group)});
        if (!group) return { error: 'control group missing' };
        const buttons = [...group.querySelectorAll('button')];
        const button = buttons[${index}];
        if (!(button instanceof HTMLButtonElement)) {
          return { error: 'choice button missing at index ${index} of ' + buttons.length };
        }
        const label = (button.textContent || '').trim();
        button.click();
        return { label, buttons: buttons.length };
      })()`);
      if (applied?.error) {
        throw new Error(
          `${surface.key} motion control: ${applied.error}. ${await activeSession.describeScreen()}`,
        );
      }
      // React commits the attribute in an effect, so give it a frame.
      await delay(90);
      const observed = await activeSession.evaluate(`(() => {
        const group = document.querySelector(${JSON.stringify(group)});
        const pressed = [...(group?.querySelectorAll('button') ?? [])]
          .findIndex((button) => button.getAttribute('aria-pressed') === 'true');
        return {
          attribute: document.documentElement.dataset[${JSON.stringify(surface.dataset)}] ?? null,
          pressed,
        };
      })()`);
      results.push({
        surface: surface.key,
        tier,
        choiceLabel: applied.label,
        choices: applied.buttons,
        attribute: observed?.attribute ?? null,
        pressedIndex: observed?.pressed ?? -1,
        ok: observed?.attribute === tier && observed?.pressed === index,
      });
    }
    // Leave every surface at full, so the effect measurements later start from a
    // known state rather than from whichever tier this loop set last.
    await activeSession.evaluate(`(() => {
      const group = document.querySelector(${JSON.stringify(group)});
      group?.querySelectorAll('button')[${TIER_INDEX.full}]?.click();
    })()`);
    await delay(60);
  }
  return results;
}

/**
 * The global Reduce motion toggle must force every surface off regardless of
 * the per-surface preference, and must give those preferences back when
 * cleared. A toggle that overwrote them instead would silently discard a
 * player's settings, which no unit test of the reducer can distinguish from
 * correct behaviour once the attribute is the only thing observed.
 */
async function auditGlobalReduceMotionOverride(activeSession) {
  const readAll = `(() => {
    const root = document.documentElement;
    return ${JSON.stringify(DATASET_KEYS)}.map((key) => root.dataset[key] ?? null);
  })()`;
  const before = await activeSession.evaluate(readAll);
  const toggled = await activeSession.evaluate(`(() => {
    const row = [...document.querySelectorAll('label.night-setting--toggle')]
      .find((candidate) => /^Reduce motion/.test((candidate.querySelector('strong')?.textContent || '').trim()));
    const input = row?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) return { found: false };
    if (!input.checked) input.click();
    return { found: true };
  })()`);
  if (!toggled?.found) {
    return {
      measured: false,
      note: "The Settings Reduce motion toggle was not found, so the global override is covered by unit tests only.",
    };
  }
  await delay(160);
  const forced = await activeSession.evaluate(readAll);
  await activeSession.evaluate(`(() => {
    const row = [...document.querySelectorAll('label.night-setting--toggle')]
      .find((candidate) => /^Reduce motion/.test((candidate.querySelector('strong')?.textContent || '').trim()));
    const input = row?.querySelector('input[type="checkbox"]');
    if (input instanceof HTMLInputElement && input.checked) input.click();
  })()`);
  await delay(160);
  const restored = await activeSession.evaluate(readAll);
  const allOff =
    Array.isArray(forced) &&
    forced.length === DATASET_KEYS.length &&
    forced.every((value) => value === "off");
  const givenBack =
    Array.isArray(restored) &&
    Array.isArray(before) &&
    restored.length === before.length &&
    restored.every((value, index) => value === before[index]);
  return { measured: true, before, forced, restored, allOff, givenBack };
}

/**
 * Set a root motion attribute and read the resolved style at each tier.
 *
 * Everything happens inside one `Runtime.evaluate` so React cannot re-run its
 * own attribute effect between the write and the read, and the original value
 * is restored before returning.
 */
async function measureTier(activeSession, config) {
  const {
    dataset,
    selectors,
    properties,
    method,
    probeHtml,
    requireAnimated = false,
  } = config;
  const measured = await activeSession.evaluate(`(() => {
    const root = document.documentElement;
    const key = ${JSON.stringify(dataset)};
    const original = root.dataset[key] ?? null;
    let probe = null;
    let matched = null;
    let target = null;
    // With requireAnimated, pick the first candidate that is actually moving at
    // the current (full) tier. Measuring a static container instead reports the
    // tier rules' near-zero "off" duration as *more* motion than full, which is
    // an artifact of the probe, not a property of the product.
    for (const selector of ${JSON.stringify(selectors)}) {
      const candidates = [...document.querySelectorAll(selector)];
      if (!candidates.length) continue;
      target = ${requireAnimated ? "true" : "false"}
        ? candidates.find((candidate) => {
            const style = getComputedStyle(candidate);
            return style.animationName !== 'none' || (parseFloat(style.transitionDuration) || 0) > 0;
          }) ?? null
        : candidates[0];
      if (target) { matched = selector; break; }
    }
    if (${method === "probe"}) {
      const holder = document.createElement('div');
      holder.innerHTML = ${JSON.stringify(probeHtml ?? "")};
      probe = holder.firstElementChild;
      if (probe) {
        // Attached so the real cascade applies; inert and out of the
        // accessibility tree so nothing else observes it.
        probe.setAttribute('aria-hidden', 'true');
        probe.style.position = 'fixed';
        probe.style.pointerEvents = 'none';
        document.body.appendChild(probe);
        target = probe;
        matched = ${JSON.stringify(selectors[0] ?? "")};
      }
    }
    if (!target) {
      return { error: 'no element matched ' + ${JSON.stringify(selectors.join(", "))} };
    }
    const properties = ${JSON.stringify(properties)};
    const byTier = {};
    try {
      for (const tier of ${JSON.stringify(TIERS)}) {
        root.dataset[key] = tier;
        // Force a style recalculation before reading resolved values.
        void target.offsetWidth;
        const style = getComputedStyle(target);
        byTier[tier] = Object.fromEntries(
          properties.map((property) => [property, String(style[property])]),
        );
      }
    } finally {
      if (original === null) delete root.dataset[key];
      else root.dataset[key] = original;
      probe?.remove();
    }
    return { byTier, tagName: target.tagName.toLowerCase(), matched };
  })()`);
  if (measured?.error) {
    return { method, selectors, error: measured.error };
  }
  return {
    method,
    selector: measured.matched,
    element: measured.tagName,
    byTier: measured.byTier,
    ...summarizeTierEffect(measured.byTier),
  };
}

/**
 * A tier control is only meaningful if the tiers differ. Identical resolved
 * style at all three means the control is decorative -- the failure a
 * source-only assertion cannot see, because a rule can be present and still be
 * overridden or match nothing.
 *
 * The "quieter with the tier off" comparison is deliberately skipped where it
 * would be meaningless. `animation-duration: 120ms !important` resolves even on
 * an element with no `animation-name`, so comparing durations there would
 * report an element that never animates as having *gained* motion when motion
 * was switched off. The basis for each verdict is recorded.
 */
function summarizeTierEffect(byTier) {
  const distinctTiers = new Set(
    TIERS.map((tier) => JSON.stringify(byTier[tier])),
  ).size;
  /*
    A comma-separated list resolves per property; the longest governs how long
    motion stays visible. Anything under a millisecond is rounded to zero: the
    stylesheet's own "off" idiom is `transition-duration: 0.01ms`, which is
    instant to any observer, and comparing it as a float against a true 0s
    reports switching motion off as having *added* motion.
  */
  const longest = (raw) => {
    if (raw === undefined || raw === null) return null;
    const value = Math.max(
      ...String(raw)
        .split(",")
        .map((part) => parseFloat(part) || 0),
    );
    return value < 0.001 ? 0 : value;
  };

  const transitionFull = longest(byTier.full?.transitionDuration);
  const transitionOff = longest(byTier.off?.transitionDuration);
  const animationFull = longest(byTier.full?.animationDuration);
  const animationOff = longest(byTier.off?.animationDuration);
  const animatesAtFull =
    Boolean(byTier.full?.animationName && byTier.full.animationName !== "none") &&
    animationFull !== null &&
    animationFull > 0;

  /*
    Compare on whichever property actually carries the motion at full. Taking
    `transition-duration` whenever it is present picked the wrong property on
    the menu surface, whose element animates but does not transition -- so the
    verdict was drawn from two numbers that were both zero for reasons having
    nothing to do with the tier.
  */
  if (transitionFull !== null && transitionOff !== null && transitionFull > 0) {
    return {
      distinctTiers,
      quietensWithTier: transitionOff <= transitionFull,
      quietensBasis: "transition-duration",
    };
  }
  if (animatesAtFull && animationOff !== null) {
    return {
      distinctTiers,
      quietensWithTier: animationOff <= animationFull,
      quietensBasis: "animation-duration",
    };
  }
  return {
    distinctTiers,
    quietensWithTier: null,
    quietensBasis:
      "not-assessable: the measured element neither animates nor transitions at full motion",
  };
}

/**
 * Count what actually moves inside the shared `.night-scene` backdrop.
 *
 * The menu tier's stylesheet rules name two targets: `.home-reference__media`,
 * which drifts, and `.night-scene`, which does not move at all -- there is not
 * one `animation` declaration in its ~350 lines of CSS. That makes the
 * `:root[data-motion-menu] .night-scene *` rules dead weight, and it means the
 * screens built on that backdrop (mode select, settings, credits, and the rest)
 * are visually still while the home menu breathes. Neither is a correctness
 * bug, which is why this is recorded rather than failed, but a reader of this
 * report should not have to rediscover it.
 */
async function measureSceneMotion(activeSession) {
  return await activeSession.evaluate(`(() => {
    const scene = document.querySelector('.night-scene');
    if (!scene) return { sceneFound: false };
    const descendants = [...scene.querySelectorAll('*')];
    const moving = descendants.filter((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== 'none' ||
        (parseFloat(style.transitionDuration) || 0) > 0;
    });
    return {
      sceneFound: true,
      quiet: scene.classList.contains('night-scene--quiet'),
      descendants: descendants.length,
      moving: moving.length,
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  })()`);
}

async function reachModeSelect(activeSession) {
  await activeSession.clickSelector('button[aria-label="Play"]', "play button");
  await activeSession.clickIfPresent(
    "#play-chip-ack-title ~ .startup-gate__actions button",
  );
  await activeSession.waitFor(".mode-stage", "mode selection");
}

async function enterFirstCareerEvent(activeSession) {
  await activeSession.clickSelector(
    ".mode-stage__choice--normal",
    "Normal mode",
  );
  await activeSession.waitForButton("Enter event", "career event lobby");
  await activeSession.clickButton("Enter event");
  await activeSession.waitFor(".room-flight", "championship arrival");
}

/**
 * Read every fly-through table's depth and resolved transform.
 *
 * The claim under test is that the venue has depth at all: distinct
 * `--venue-depth` values, and scales that actually differ once the transform
 * resolves. The unit test can only read back the custom property it wrote,
 * which proves the number exists and nothing about whether it moved a pixel.
 */
async function auditFlythroughDepth(activeSession) {
  await activeSession.waitFor(".venue-table", "fly-through tables");
  // Depth is applied per table on mount; let the opening transition settle.
  await delay(450);
  return await activeSession.evaluate(`(() => {
    const tables = [...document.querySelectorAll('.venue-table')];
    const rows = tables.map((table, index) => {
      const style = getComputedStyle(table);
      const depth = parseFloat(style.getPropertyValue('--venue-depth'));
      // DOMMatrix rejects the keyword 'none', which is what an untransformed
      // element resolves to; the identity matrix is the honest reading.
      const raw = style.transform;
      const matrix = raw && raw !== 'none'
        ? new DOMMatrixReadOnly(raw)
        : new DOMMatrixReadOnly();
      const rect = table.getBoundingClientRect();
      return {
        index,
        slot: style.getPropertyValue('--venue-slot').trim(),
        depth: Number.isFinite(depth) ? depth : null,
        scaleX: Number(matrix.a.toFixed(4)),
        translateX: Number(matrix.e.toFixed(2)),
        translateY: Number(matrix.f.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        dealer: table.querySelector('.venue-table__dealer') !== null,
        stacks: table.querySelectorAll('.venue-guest').length,
        transitionDuration: style.transitionDuration,
      };
    });
    return {
      tables: rows.length,
      rows,
      distinctDepths: new Set(rows.map((row) => row.depth)).size,
      distinctScales: new Set(rows.map((row) => row.scaleX)).size,
      identityTransforms: rows.filter((row) => row.scaleX === 1 && row.translateX === 0).length,
      zeroWidth: rows.filter((row) => row.width === 0).length,
      withDealer: rows.filter((row) => row.dealer).length,
    };
  })()`);
}

/**
 * Measure layout, then again with the direction flipped, then again with every
 * text node expanded the way a real translation expands it, then both at once.
 */
async function auditDirection(activeSession, screen) {
  const baseline = await measureLayout(activeSession, "baseline");
  const rtl = await withDocumentState(
    activeSession,
    "document.documentElement.setAttribute('dir', 'rtl');",
    "document.documentElement.setAttribute('dir', 'ltr');",
    () => measureLayout(activeSession, "rtl"),
  );
  const expanded = await withDocumentState(
    activeSession,
    expandTextScript(),
    restoreTextScript(),
    () => measureLayout(activeSession, "expanded"),
  );
  const rtlExpanded = await withDocumentState(
    activeSession,
    `document.documentElement.setAttribute('dir', 'rtl'); ${expandTextScript()}`,
    `document.documentElement.setAttribute('dir', 'ltr'); ${restoreTextScript()}`,
    () => measureLayout(activeSession, "rtl+expanded"),
  );
  return { screen, baseline, rtl, expanded, rtlExpanded };
}

async function withDocumentState(activeSession, apply, restore, measure) {
  await activeSession.evaluate(`(() => { ${apply} })()`);
  // A direction flip and a text rewrite both invalidate layout, and one frame
  // is not always enough for the compositor to settle a grid.
  await delay(280);
  try {
    return await measure();
  } finally {
    await activeSession.evaluate(`(() => { ${restore} })()`);
    await delay(200);
  }
}

/*
  Expansion is applied to text nodes and reverted from a stash, so the DOM
  shape, classes, and CSS are untouched and only string lengths change. 40% is
  the low end of what German and Finnish do to English UI text, and matches the
  figure the localization backlog already uses. The padding is appended without
  a space on purpose: a single long unbreakable word is the harsher case, and
  the one that actually breaks fixed-width chrome.

  These are function declarations rather than `const` strings because the audit
  runs at module top level with `await`, which executes before a `const` further
  down the file is initialized. Function declarations hoist; this file's first
  run failed on exactly that.
*/
function expandTextScript() {
  return `
    window.__auditExpansion = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue;
      if (!text || !/[A-Za-z]{2}/.test(text)) continue;
      window.__auditExpansion.push([node, text]);
      node.nodeValue = text + 'x'.repeat(Math.max(1, Math.round(text.length * 0.4)));
    }
  `;
}

function restoreTextScript() {
  return `
    for (const [node, text] of window.__auditExpansion ?? []) node.nodeValue = text;
    window.__auditExpansion = [];
  `;
}

/**
 * Clipping and overflow, measured against real boxes.
 *
 * Only elements whose own computed overflow actually hides content count as
 * clipped: one that scrolls, or that lets content spill visibly, is not losing
 * information. Elements that truncate with an ellipsis are excluded from the
 * horizontal check too -- an ellipsis is a deliberate design decision that
 * tells the player text was shortened, not a layout failure. Both exclusions
 * are what keep the remaining findings worth reading.
 */
async function measureLayout(activeSession, state) {
  const measurement = await activeSession.evaluate(`(() => {
    const root = document.documentElement;
    const candidates = [...document.querySelectorAll(
      'h1, h2, h3, h4, p, button, label, li, th, td, .eyebrow, .night-setting__hint, .stat-value, .seat-name, .seat-bet, .action-button'
    )];
    const describe = (element) => {
      const classes = String(element.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      return element.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
    };
    const clipped = [];
    const escaping = [];
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Screen-reader-only text is *supposed* to overflow a 1px clipped box --
      // that is how the visually-hidden pattern works. Counting it found three
      // "clipped" headings on the first run, every one of them correct code.
      if (element.closest('.visually-hidden')) continue;
      if (element.clientWidth <= 4 || element.clientHeight <= 4) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const hides = (value) => value === 'hidden' || value === 'clip';
      const ellipsis = style.textOverflow === 'ellipsis';
      const horizontalHidden = hides(style.overflowX) && !ellipsis;
      const verticalHidden = hides(style.overflowY);
      const overflowX = element.scrollWidth - element.clientWidth;
      const overflowY = element.scrollHeight - element.clientHeight;
      // Sub-pixel rounding routinely produces a pixel of phantom overflow.
      if ((horizontalHidden && overflowX > 2) || (verticalHidden && overflowY > 2)) {
        clipped.push({
          selector: describe(element),
          overflowX: horizontalHidden ? overflowX : 0,
          overflowY: verticalHidden ? overflowY : 0,
          text: (element.textContent || '').trim().slice(0, 60),
        });
      }
      if (rect.right < 1 || rect.left > window.innerWidth - 1) {
        escaping.push({
          selector: describe(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        });
      }
    }
    return {
      documentOverflowX: root.scrollWidth - root.clientWidth,
      documentOverflowY: root.scrollHeight - root.clientHeight,
      direction: getComputedStyle(root).direction,
      lang: root.getAttribute('lang'),
      candidates: candidates.length,
      clipped: clipped.slice(0, 25),
      clippedCount: clipped.length,
      escaping: escaping.slice(0, 10),
      escapingCount: escaping.length,
    };
  })()`);
  return { state, ...measurement };
}

function collectMotionFindings(observed) {
  const results = [];
  for (const row of observed.control) {
    if (!row.ok) {
      results.push({
        area: "motion-control",
        blocking: true,
        detail: `${row.surface} motion control set to "${row.tier}" left the root attribute at ${JSON.stringify(row.attribute)} and aria-pressed at index ${row.pressedIndex}.`,
      });
    }
  }
  for (const [surface, effect] of Object.entries(observed.effect)) {
    if (effect.error) {
      results.push({
        area: "motion-effect",
        blocking: true,
        detail: `${surface} motion effect could not be measured: ${effect.error}.`,
      });
      continue;
    }
    if (effect.distinctTiers < 2) {
      results.push({
        area: "motion-effect",
        blocking: true,
        detail: `${surface} motion resolved to identical computed style at all three tiers (${JSON.stringify(effect.byTier.full)}), so the control changes nothing the compositor can see.`,
      });
    }
    if (effect.quietensWithTier === false) {
      results.push({
        area: "motion-effect",
        blocking: true,
        detail: `${surface} motion is not quieter with the tier off than at full, measured by ${effect.quietensBasis}: ${JSON.stringify(effect.byTier)}.`,
      });
    }
  }
  const override = observed.globalOverride;
  if (override?.measured && !override.allOff) {
    results.push({
      area: "motion-global-override",
      blocking: true,
      detail: `Reduce motion did not force every surface off: ${JSON.stringify(override.forced)}.`,
    });
  }
  if (override?.measured && !override.givenBack) {
    results.push({
      area: "motion-global-override",
      blocking: true,
      detail: `Clearing Reduce motion did not restore the per-surface preferences: before=${JSON.stringify(override.before)} after=${JSON.stringify(override.restored)}.`,
    });
  }
  return results;
}

function collectFlythroughFindings(observed) {
  if (!observed || observed.tables === 0) {
    return [
      {
        area: "flythrough-depth",
        blocking: true,
        detail: "The arrival fly-through rendered no venue tables.",
      },
    ];
  }
  const results = [];
  if (observed.distinctDepths < 2) {
    results.push({
      area: "flythrough-depth",
      blocking: true,
      detail: `All ${observed.tables} fly-through tables share one --venue-depth value, so the venue is a flat wall.`,
    });
  }
  if (observed.distinctScales < 2) {
    results.push({
      area: "flythrough-depth",
      blocking: true,
      detail: `All ${observed.tables} fly-through tables resolved to the same transform scale (${observed.rows[0]?.scaleX}): depth is written but never composited.`,
    });
  }
  if (observed.zeroWidth > 0) {
    results.push({
      area: "flythrough-depth",
      blocking: false,
      detail: `${observed.zeroWidth} fly-through table(s) measured zero width.`,
    });
  }
  return results;
}

function collectObservationFindings(observed) {
  const scene = observed.staticMenuDecoration;
  if (!scene?.sceneFound || scene.quiet) return [];
  if (scene.moving === 0) {
    return [
      {
        area: "menu-decoration",
        blocking: false,
        detail: `The .night-scene backdrop is mounted un-quieted with ${scene.descendants} descendants and none of them animate or transition, so the menu motion tier's .night-scene rules govern nothing and every screen built on that backdrop is visually still.`,
      },
    ];
  }
  return [];
}

function collectDirectionFindings(observed) {
  const results = [];
  for (const screen of observed.screens) {
    const states = ["baseline", "rtl", "expanded", "rtlExpanded"];
    for (const state of states) {
      const measurement = screen[state];
      if (!measurement) continue;
      if (measurement.documentOverflowX > 2) {
        results.push({
          area: "direction-layout",
          blocking: true,
          detail: `${screen.screen} (${measurement.state}) overflows the document horizontally by ${measurement.documentOverflowX}px, so the window scrolls sideways.`,
        });
      }
      if (measurement.escapingCount > 0) {
        results.push({
          area: "direction-layout",
          blocking: true,
          detail: `${screen.screen} (${measurement.state}) pushed ${measurement.escapingCount} element(s) entirely outside the viewport: ${JSON.stringify(measurement.escaping.slice(0, 3))}.`,
        });
      }
    }
    // Clipping already present untouched is a design bug: reported, but not a
    // direction regression. Clipping a state introduces is a direction bug.
    const baselineClipped = screen.baseline?.clippedCount ?? 0;
    if (baselineClipped > 0) {
      results.push({
        area: "layout-clipping",
        blocking: false,
        detail: `${screen.screen} clips ${baselineClipped} element(s) in the untouched shipped build: ${JSON.stringify(screen.baseline.clipped.slice(0, 5))}.`,
      });
    }
    for (const state of ["rtl", "expanded", "rtlExpanded"]) {
      const measurement = screen[state];
      if (!measurement) continue;
      const introduced = measurement.clippedCount - baselineClipped;
      if (introduced > 0) {
        results.push({
          area: "direction-layout",
          blocking: true,
          detail: `${screen.screen} (${measurement.state}) clips ${introduced} element(s) that the baseline does not: ${JSON.stringify(measurement.clipped.slice(0, 5))}.`,
        });
      }
    }
  }
  return results;
}
