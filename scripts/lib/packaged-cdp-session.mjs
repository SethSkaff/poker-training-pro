/**
 * Launch the packaged EXE, attach CDP, and drive it through ordinary controls.
 *
 * Three packaged audits had each grown their own copy of this: launch into an
 * isolated temp profile, wait for the DevTools port, attach, then a private set
 * of `clickText`/`waitFor`/`evaluate` helpers. The copies had already drifted --
 * one polled every 70 ms and another every 100, one guarded its temp profile
 * against deletion outside `tmpdir` and another did not -- so a fix to a wait
 * budget or a cleanup bug landed in whichever copy the author happened to be
 * reading. This is that machinery once.
 *
 * Existing audits are deliberately left on their inlined copies. They are
 * working release gates whose thresholds were calibrated against real runs, and
 * rewriting them to prove a refactor is how a working gate stops working.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "../audit-packaged-render-smoke.mjs";

/**
 * A launched packaged app with CDP attached.
 *
 * `deadline` is an absolute timestamp shared by every helper below, so a run
 * cannot extend its own budget by making more calls.
 */
export class PackagedSession {
  #child;
  #profile;
  #profilePrefix;

  constructor({ child, cdp, profile, profilePrefix, deadline }) {
    this.#child = child;
    this.#profile = profile;
    // Kept verbatim rather than recovered from the directory name: the cleanup
    // guard below compares against it before an `rm -r`, and re-deriving it
    // from `mkdtemp`'s random suffix is not a check, it is a guess.
    this.#profilePrefix = profilePrefix;
    this.cdp = cdp;
    this.deadline = deadline;
  }

  /**
   * `windowsHide` defaults to true to match the existing packaged audits, which
   * do not need a visible window and should not steal focus from whoever is at
   * the machine. It is genuinely suppressive, not cosmetic: measured on this
   * build, a run with `windowsHide: true` leaves every process in the tree
   * reporting `MainWindowHandle = 0`, while the same build launched with it
   * false reports a real handle and title. Anything that must interact with the
   * window as a window -- minimize, restore, focus -- has to pass false.
   */
  static async launch({
    appPath,
    profilePrefix,
    timeoutMs,
    extraArguments = [],
    windowsHide = true,
  }) {
    if (!profilePrefix || !profilePrefix.endsWith("-")) {
      throw new Error("profilePrefix must be a non-empty string ending in '-'.");
    }
    const profile = await mkdtemp(join(tmpdir(), profilePrefix));
    assertTempProfile(profile, profilePrefix);
    const child = spawn(
      appPath,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        "--no-first-run",
        ...extraArguments,
      ],
      {
        cwd: dirname(appPath),
        detached: false,
        windowsHide,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    const output = captureBoundedOutput(child, 8_192);
    const deadline = Date.now() + timeoutMs;
    try {
      const port = await waitForDevToolsPort(profile, child, deadline, output);
      const target = await waitForPageTarget(port, child, deadline, output);
      const cdp = await CdpClient.connect(
        target.webSocketDebuggerUrl,
        deadline,
      );
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return new PackagedSession({
        child,
        cdp,
        profile,
        profilePrefix,
        deadline,
      });
    } catch (error) {
      try {
        await terminateProcessTree(child);
      } catch {
        /* the launch failure is the interesting one */
      }
      await removeProfile(profile, profilePrefix);
      throw error;
    }
  }

  /** The launched EXE's process id, for host-level checks such as its HWND. */
  get pid() {
    return this.#child.pid;
  }

  /** Throws if the app died, so a dead renderer is never read as a timeout. */
  assertAlive() {
    if (this.#child.exitCode !== null) {
      throw new Error(
        `packaged app exited during the audit (code ${this.#child.exitCode}).`,
      );
    }
  }

  async evaluate(expression) {
    const result = await this.cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      userGesture: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "unknown";
      throw new Error(`Runtime.evaluate raised an exception: ${description}`);
    }
    return result.result?.value;
  }

  async poll(expression, { intervalMs = 70, deadlineAt = this.deadline } = {}) {
    const deadline = Math.min(this.deadline, deadlineAt);
    while (Date.now() < deadline) {
      this.assertAlive();
      if (await this.evaluate(expression)) return true;
      await delay(intervalMs);
    }
    return false;
  }

  /**
   * Wait for a selector, and on failure say which screen was actually up.
   *
   * "X was not present" is equally true of a crashed renderer, a finished
   * event, and a screen that never got there -- the diagnostic gap that made
   * the 2026-07-26 packaged-audit failures take a day to attribute.
   */
  async waitFor(selector, label) {
    const found = await this.poll(
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
    );
    if (!found) {
      throw new Error(
        `Timed out waiting for ${label ?? selector}. ${await this.describeScreen()}`,
      );
    }
  }

  async waitForButton(text, label) {
    const found = await this.poll(buttonExpression(text, false));
    if (!found) {
      throw new Error(
        `Timed out waiting for ${label ?? `button ${JSON.stringify(text)}`}. ${await this.describeScreen()}`,
      );
    }
  }

  async clickSelector(selector, label) {
    await this.waitFor(selector, label);
    const clicked = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      if (element instanceof HTMLButtonElement && element.disabled) return false;
      element.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error(
        `Could not click ${label ?? selector}. ${await this.describeScreen()}`,
      );
    }
    await delay(110);
  }

  async clickButton(text, label) {
    await this.waitForButton(text, label);
    const clicked = await this.evaluate(buttonExpression(text, true));
    if (!clicked) {
      throw new Error(
        `Could not click button ${JSON.stringify(text)}. ${await this.describeScreen()}`,
      );
    }
    await delay(110);
  }

  async clickIfPresent(selector) {
    const clicked = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      if (element instanceof HTMLButtonElement && element.disabled) return false;
      element.click();
      return true;
    })()`);
    if (clicked) await delay(110);
    return Boolean(clicked);
  }

  /** A one-line description of the current screen, for failure messages. */
  async describeScreen() {
    try {
      const description = await this.evaluate(`(() => {
        const marks = ['.home-reference', '.mode-stage', '.room-flight', '.poker-table',
          '.ceremony-board', '.night-settings', '.review-shell', '.career-travel',
          '.recovery-shell', '.startup-gate', '.scene-loading'];
        const present = marks.filter((mark) => document.querySelector(mark) !== null);
        const heading = (document.querySelector('h1, h2')?.textContent || '').trim().slice(0, 80);
        return JSON.stringify({ present, heading });
      })()`);
      return `Screen at the time: ${description}.`;
    } catch {
      return "The screen could not be described (the renderer did not answer).";
    }
  }

  /** Navigate past the first-run gates to the home menu. */
  async reachHome() {
    await this.clickButton("Skip setup");
    await this.waitFor(".home-reference", "home menu");
  }

  async dispose() {
    try {
      this.cdp?.close();
    } catch {
      /* process-tree cleanup below is authoritative */
    }
    try {
      await terminateProcessTree(this.#child);
    } catch {
      /* best effort before isolated cleanup */
    }
    await removeProfile(this.#profile, this.#profilePrefix);
  }
}

export function buttonExpression(text, click) {
  return `(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) =>
      candidate instanceof HTMLButtonElement && !candidate.disabled &&
      (candidate.textContent || '').trim() === ${JSON.stringify(text)}
    );
    ${
      click
        ? "if (button instanceof HTMLButtonElement) { button.click(); return true; } return false;"
        : "return button instanceof HTMLButtonElement;"
    }
  })()`;
}

/**
 * Refuse to delete anything that is not our own freshly-made temp profile.
 *
 * `rm -r --force` on a path assembled from a flag is worth one guard.
 */
export function assertTempProfile(target, profilePrefix) {
  const resolved = resolve(target);
  const childPath = relative(resolve(tmpdir()), resolved);
  if (
    !childPath ||
    childPath === ".." ||
    childPath.startsWith(`..${sep}`) ||
    !basename(resolved).startsWith(profilePrefix)
  ) {
    throw new Error("Refusing to operate on an unexpected temporary profile.");
  }
}

async function removeProfile(target, profilePrefix) {
  assertTempProfile(target, profilePrefix);
  // Windows holds Electron's profile files briefly after the tree exits.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch {
      await delay(100 * (attempt + 1));
    }
  }
}

/**
 * Electron 43 can log this bootstrap diagnostic for an internal sandboxed
 * helper context. It is not the main renderer -- audits that see it have
 * already proved the preload bridge, a real screen, and real interaction -- so
 * it is reported for Electron-upgrade follow-up rather than conflated with an
 * application exception. Every other fatal event stays a hard failure.
 */
export function isKnownElectronSandboxDiagnostic(event) {
  if (
    event?.kind !== "console-error" ||
    event?.sourceUrl !== "node:electron/js2c/sandbox_bundle"
  ) {
    return false;
  }
  const description = String(event.description ?? "");
  return (
    description === "Electron sandboxed_renderer.bundle.js script failed to run" ||
    description.includes(
      "Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null",
    )
  );
}

export function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}
