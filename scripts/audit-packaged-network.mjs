import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname.slice(1));
const appArgument = argumentValue("--app");
const appPath = resolve(
  projectRoot,
  appArgument ??
    "outputs/fuse-test4/win-unpacked/Poker Training Pro.exe",
);
const observationMs = numberArgument("--duration-ms", 8_000);
const reportPath = resolve(projectRoot, "work", "packaged-network-audit.json");

if (process.platform !== "win32") {
  throw new Error(
    "The current packaged-network audit expects a Windows Electron executable.",
  );
}
if (!existsSync(appPath)) {
  throw new Error(
    `Packaged executable not found: ${appPath}. Pass --app <path> after packaging.`,
  );
}
if (observationMs < 2_000 || observationMs > 60_000) {
  throw new Error("--duration-ms must be between 2000 and 60000.");
}

const observations = [];
const sockets = new Set();
const proxy = createServer((socket) => {
  sockets.add(socket);
  const record = {
    connectedAtMs: Date.now(),
    bytes: 0,
    firstLine: "",
  };
  observations.push(record);
  let buffered = "";

  socket.on("data", (chunk) => {
    record.bytes += chunk.length;
    if (!record.firstLine) {
      buffered += chunk.toString("utf8");
      const lineEnd = buffered.indexOf("\r\n");
      if (lineEnd >= 0) {
        record.firstLine = buffered.slice(0, lineEnd).slice(0, 512);
      }
    }
    socket.end(
      "HTTP/1.1 502 Network disabled by release audit\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
});

await new Promise((resolveListen, rejectListen) => {
  proxy.once("error", rejectListen);
  proxy.listen(0, "127.0.0.1", resolveListen);
});
const address = proxy.address();
if (!address || typeof address === "string") {
  throw new Error("Could not resolve the audit proxy port.");
}

const child = spawn(
  appPath,
  [
    `--proxy-server=http://127.0.0.1:${address.port}`,
    "--proxy-bypass-list=<-loopback>",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
  ],
  {
    cwd: dirname(appPath),
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  },
);

let launchError = null;
let exitResult = null;
child.once("error", (error) => {
  launchError = error.message;
});
child.once("exit", (code, signal) => {
  exitResult = { code, signal };
});

await delay(observationMs);
const remainedRunning = child.exitCode === null && !launchError;
if (remainedRunning) {
  child.kill();
  await Promise.race([onceExit(child), delay(3_000)]);
}

for (const socket of sockets) socket.destroy();
await new Promise((resolveClose) => proxy.close(resolveClose));

const report = {
  schemaVersion: 1,
  executable: basename(appPath),
  observationMs,
  launched: launchError === null,
  remainedRunningForObservation: remainedRunning,
  observedProxyConnections: observations.length,
  observedBytes: observations.reduce(
    (total, observation) => total + observation.bytes,
    0,
  ),
  requests: observations.map((observation) => ({
    firstLine: observation.firstLine || "(connection without request line)",
    bytes: observation.bytes,
  })),
  launchError,
  earlyExit: remainedRunning ? null : exitResult,
  scope:
    "Launch/idle smoke with all Chromium HTTP(S) traffic forced through a deny proxy and host resolution disabled. Static source/CSP scans cover bundled runtime references separately.",
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const errors = [];
if (launchError) errors.push(`packaged app failed to launch: ${launchError}`);
if (!remainedRunning) {
  errors.push(
    `packaged app did not remain running for ${observationMs} ms: ${JSON.stringify(exitResult)}`,
  );
}
if (observations.length > 0) {
  errors.push(
    `ordinary packaged launch attempted ${observations.length} network connection(s)`,
  );
}
if (errors.length > 0) {
  throw new Error(
    `Packaged network audit failed:\n${errors
      .map((error) => `- ${error}`)
      .join("\n")}`,
  );
}

console.log(JSON.stringify({ ok: true, ...report }, null, 2));

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function numberArgument(flag, fallback) {
  const value = argumentValue(flag);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer.`);
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function onceExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => processHandle.once("exit", resolveExit));
}
