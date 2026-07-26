import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "./release/shared.mjs";
import {
  RenderSmokeFailure,
  assertNoFatalCdpEvents,
  waitForRenderSmoke,
} from "./release/packaged-render-smoke-lib.mjs";
import { isCdpTransportTimeout } from "./lib/cdp-outcome.mjs";

const DEFAULT_APP = join(
  projectRoot,
  "outputs",
  "desktop",
  "win-unpacked",
  "Poker Training Pro.exe",
);
const DEFAULT_TIMEOUT_MS = 30_000;
const PROFILE_PREFIX = "poker-training-pro-render-smoke-";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  throw new Error(
    `Packaged renderer smoke requires Node.js 22 or newer; current runtime is ${process.versions.node}.`,
  );
}

export async function runPackagedRenderSmoke(options = {}) {
  const appPath = resolve(options.appPath ?? DEFAULT_APP);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  await access(appPath, fsConstants.X_OK);

  const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
  assertValidatedTempProfile(profile);
  const child = spawn(
    appPath,
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
    ],
    {
      cwd: projectRoot,
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  const processOutput = captureBoundedOutput(child, 8_192);
  let cdp;

  try {
    const deadline = Date.now() + timeoutMs;
    const port = await waitForDevToolsPort(
      profile,
      child,
      deadline,
      processOutput,
    );
    const target = await waitForPageTarget(
      port,
      child,
      deadline,
      processOutput,
    );
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");

    // Let the initial navigation settle, then reload under full CDP
    // instrumentation so an ASAR/custom-protocol regression is observable.
    await delay(500);
    assertNoFatalCdpEvents(cdp.takeFatalEvents());
    await cdp.send("Page.reload", { ignoreCache: true });

    return await waitForRenderSmoke({
      timeoutMs: Math.max(1, deadline - Date.now()),
      pollIntervalMs: 100,
      observe: async () => {
        if (child.exitCode !== null) {
          throw processExitedFailure(child, processOutput);
        }
        const evaluation = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const root = document.querySelector("#root");
            return {
              url: location.href,
              title: document.title,
              readyState: document.readyState,
              rootChildCount: root ? root.childElementCount : 0,
              rootText: root ? (root.textContent || "").slice(0, 10000) : ""
            };
          })()`,
          returnByValue: true,
          awaitPromise: false,
        });
        if (evaluation.exceptionDetails) {
          throw new RenderSmokeFailure(
            "runtime-exception",
            "Runtime.evaluate raised an exception.",
          );
        }
        return {
          observation: evaluation.result?.value,
          events: cdp.takeFatalEvents(),
        };
      },
    });
  } finally {
    try {
      cdp?.close();
    } catch {
      // Process-tree termination below remains authoritative.
    }
    let terminationError;
    let cleanupError;
    try {
      await terminateProcessTree(child);
    } catch (error) {
      terminationError = error;
    }
    try {
      await removeValidatedTempProfile(profile);
    } catch (error) {
      cleanupError = error;
    }
    if (terminationError && cleanupError) {
      throw new AggregateError(
        [terminationError, cleanupError],
        "The smoke process and temporary profile could not be cleaned up.",
      );
    }
    if (terminationError) throw terminationError;
    if (cleanupError) throw cleanupError;
  }
}

export class CdpClient {
  static async connect(webSocketUrl, deadline) {
    if (typeof globalThis.WebSocket !== "function") {
      throw new RenderSmokeFailure(
        "websocket-unavailable",
        "Node.js WebSocket support is unavailable.",
      );
    }
    const remaining = Math.max(1, deadline - Date.now());
    const socket = new WebSocket(webSocketUrl);
    await promiseWithTimeout(
      new Promise((resolvePromise, reject) => {
        socket.addEventListener("open", resolvePromise, { once: true });
        socket.addEventListener(
          "error",
          () =>
            reject(
              new RenderSmokeFailure(
                "cdp-connect-failed",
                "Could not connect to the packaged renderer CDP target.",
              ),
            ),
          { once: true },
        );
      }),
      remaining,
      "CDP WebSocket connection timed out.",
    );
    return new CdpClient(socket, deadline);
  }

  constructor(socket, deadline) {
    this.socket = socket;
    this.deadline = deadline;
    this.nextId = 1;
    this.pending = new Map();
    this.fatalEvents = [];
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (Number.isInteger(message.id)) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(
            new RenderSmokeFailure(
              "cdp-command-failed",
              `CDP command failed: ${message.error.message ?? "unknown error"}.`,
            ),
          );
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }
      const normalized = normalizeFatalEvent(message);
      if (normalized) this.fatalEvents.push(normalized);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new RenderSmokeFailure(
            "cdp-closed",
            "The packaged renderer CDP target closed unexpectedly.",
          ),
        );
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, maximumCommandTimeoutMs = 5_000) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new RenderSmokeFailure(
          "cdp-closed",
          "The packaged renderer CDP target is not open.",
        ),
      );
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const commandTimeoutMs = Math.max(
        1,
        Math.min(maximumCommandTimeoutMs, this.deadline - Date.now()),
      );
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RenderSmokeFailure(
            "cdp-command-timeout",
            `CDP command ${method} timed out.`,
          ),
        );
      }, commandTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  takeFatalEvents() {
    return this.fatalEvents.splice(0);
  }

  close() {
    this.socket.close();
  }
}

function normalizeFatalEvent(message) {
  if (message.method === "Runtime.exceptionThrown") {
    return {
      kind: "runtime-exception",
      description:
        message.params?.exceptionDetails?.exception?.description ??
        message.params?.exceptionDetails?.text,
    };
  }
  if (message.method === "Network.loadingFailed") {
    return {
      kind: "network-loading-failed",
      errorText: message.params?.errorText,
      requestType: message.params?.type,
    };
  }
  if (
    message.method === "Runtime.consoleAPICalled" &&
    message.params?.type === "error"
  ) {
    return {
      kind: "console-error",
      level: "error",
      description: (message.params?.args ?? [])
        .map((argument) => argument?.description ?? argument?.value ?? "")
        .join(" ")
        .slice(0, 500),
      ...(typeof message.params?.stackTrace?.callFrames?.[0]?.url === "string"
        ? { sourceUrl: message.params.stackTrace.callFrames[0].url }
        : {}),
    };
  }
  if (
    message.method === "Log.entryAdded" &&
    message.params?.entry?.level === "error"
  ) {
    return {
      kind: "console-error",
      level: "error",
      description: String(message.params?.entry?.text ?? "").slice(0, 500),
      ...(typeof message.params?.entry?.url === "string"
        ? { sourceUrl: message.params.entry.url }
        : {}),
      ...(typeof message.params?.entry?.source === "string"
        ? { source: message.params.entry.source }
        : {}),
    };
  }
  return undefined;
}

export async function waitForDevToolsPort(
  profile,
  child,
  deadline,
  output,
) {
  const portFile = join(profile, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw processExitedFailure(child, output);
    }
    try {
      const contents = await readFile(portFile, "utf8");
      const port = Number.parseInt(contents.split(/\r?\n/, 1)[0], 10);
      if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
        return port;
      }
    } catch (error) {
      if (!isTransientDevToolsFileError(error)) throw error;
    }
    await delay(50);
  }
  throw new RenderSmokeFailure(
    "devtools-timeout",
    "Timed out waiting for the packaged app remote-debugging port.",
  );
}

export async function waitForPageTarget(
  port,
  child,
  deadline,
  output,
) {
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw processExitedFailure(child, output);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(1_000, deadline - Date.now())),
        ),
      });
      if (response.ok) {
        const targets = await response.json();
        const page = Array.isArray(targets)
          ? targets.find(
              (target) =>
                target?.type === "page" &&
                typeof target.webSocketDebuggerUrl === "string",
            )
          : undefined;
        if (page) return page;
      }
    } catch {
      // CDP HTTP discovery commonly races Chromium startup.
    }
    await delay(50);
  }
  throw new RenderSmokeFailure(
    "target-timeout",
    "Timed out waiting for a packaged renderer CDP target.",
  );
}

export function captureBoundedOutput(child, maximumBytes) {
  const state = { stdout: "", stderr: "" };
  for (const [key, stream] of [
    ["stdout", child.stdout],
    ["stderr", child.stderr],
  ]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      state[key] = `${state[key]}${chunk}`.slice(-maximumBytes);
    });
  }
  return state;
}

function processExitedFailure(child, output) {
  const diagnostic = `${output.stderr}\n${output.stdout}`
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return new RenderSmokeFailure(
    "process-exited",
    `Packaged app exited before render verification (code ${child.exitCode})${
      diagnostic ? `: ${diagnostic}` : "."
    }`,
  );
}

export async function terminateProcessTree(child) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
    });
  } else if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolvePromise) =>
        child.once("close", resolvePromise),
      ),
      delay(5_000),
    ]);
  }
  if (child.exitCode === null) {
    throw new RenderSmokeFailure(
      "process-termination-failed",
      "The packaged smoke process tree did not terminate.",
    );
  }
}

async function removeValidatedTempProfile(profile) {
  assertValidatedTempProfile(profile);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function assertValidatedTempProfile(profile) {
  const resolvedProfile = resolve(profile);
  const resolvedTemp = resolve(tmpdir());
  const childPath = relative(resolvedTemp, resolvedProfile);
  if (
    !childPath ||
    childPath === ".." ||
    childPath.startsWith(`..${sep}`) ||
    isAbsolute(childPath) ||
    !basename(resolvedProfile).startsWith(PROFILE_PREFIX)
  ) {
    throw new Error("Refusing to operate on an unexpected profile path.");
  }
}

function parseArguments(arguments_) {
  let appPath = DEFAULT_APP;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--app") {
      appPath = requireValue(arguments_, ++index, "--app");
    } else if (argument === "--timeout-ms") {
      timeoutMs = Number.parseInt(
        requireValue(arguments_, ++index, "--timeout-ms"),
        10,
      );
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return {
    appPath,
    timeoutMs: boundedInteger(timeoutMs, 1_000, 120_000),
  };
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function boundedInteger(value, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `Expected an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new RenderSmokeFailure("timeout", message)),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function isTransientDevToolsFileError(error) {
  return (
    error &&
    typeof error === "object" &&
    new Set(["ENOENT", "EBUSY", "EACCES", "EPERM"]).has(error.code)
  );
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) try {
  const options = parseArguments(process.argv.slice(2));
  const observation = await runPackagedRenderSmoke(options);
  console.log(
    `Packaged renderer smoke passed: ${observation.url}, title=${JSON.stringify(observation.title)}, rootChildren=${observation.rootChildCount}, startText=true, CDP errors=0.`,
  );
} catch (error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "smoke-failed";
  const message =
    error instanceof Error ? error.message : "Unknown renderer smoke failure.";
  // A CDP command deadline proves neither a rendered app nor a broken one.
  // Exit 2 so a caller can tell an inconclusive run from a regression without
  // parsing this text (E25-003).
  if (isCdpTransportTimeout(error)) {
    console.error(
      `Packaged renderer smoke inconclusive [cdp-transport-timeout]: ${message}`,
    );
    process.exitCode = 2;
  } else {
    console.error(`Packaged renderer smoke failed [${code}]: ${message}`);
    process.exitCode = 1;
  }
}
