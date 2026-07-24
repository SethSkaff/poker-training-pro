import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  arch,
  cpus,
  platform,
  release,
  tmpdir,
  totalmem,
  version as osVersion,
} from "node:os";
import {
  basename,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  CdpClient,
  captureBoundedOutput,
  terminateProcessTree,
  waitForDevToolsPort,
  waitForPageTarget,
} from "./audit-packaged-render-smoke.mjs";
import {
  assertNoFatalCdpEvents,
  waitForRenderSmoke,
} from "./release/packaged-render-smoke-lib.mjs";
import {
  OBSERVATIONAL_BUDGETS,
  RUNTIME_PROFILE_FORMAT,
  RUNTIME_PROFILE_VERSION,
  assertValidatedTemporaryProfile,
  canonicalJson,
  classifyRuntimeObservations,
  parseWindowsProcessTreeSample,
  summarizeLongTasks,
  summarizeProcessSamples,
  summarizeResourceEntries,
} from "./release/runtime-performance-profile-lib.mjs";
import { projectRoot } from "./release/shared.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_APP = join(
  projectRoot,
  "outputs",
  "desktop",
  "win-unpacked",
  "Poker Training Pro.exe",
);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 250;
const PROFILE_PREFIX = "poker-training-pro-runtime-profile-";
const JSON_OUTPUT = join(
  projectRoot,
  "work",
  "packaged-runtime-profile.json",
);
const SUMMARY_OUTPUT = join(
  projectRoot,
  "work",
  "packaged-runtime-profile.md",
);

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  throw new Error(
    `Packaged runtime profiling requires Node.js 22 or newer; current runtime is ${process.versions.node}.`,
  );
}

export async function profilePackagedRuntime(options = {}) {
  if (process.platform !== "win32") {
    throw new Error("The packaged runtime profiler currently supports Windows only.");
  }
  const appPath = resolve(options.appPath ?? DEFAULT_APP);
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const sampleIntervalMs = boundedInteger(
    options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
    100,
    5_000,
  );
  await access(appPath, fsConstants.X_OK);
  if (await packageBuildInProgress()) {
    throw new Error(
      "A package build is still in progress; profile the completed artifact instead.",
    );
  }
  const freshness = await verifyFreshPackage(appPath);
  const buildIdentity = await readBuildIdentity(appPath);
  const hostIdentity = readHostIdentity();

  const profile = await mkdtemp(join(tmpdir(), PROFILE_PREFIX));
  assertValidatedTempProfile(profile);
  const launchedAtEpochMs = Date.now();
  const launchedAtMonotonicMs = performance.now();
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
  const output = captureBoundedOutput(child, 8_192);
  const deadline = Date.now() + timeoutMs;
  const processSamples = [];
  const samplingErrors = [];
  let stopSampling = false;
  let cdp;
  const sampler = sampleProcessTreeUntilStopped({
    rootPid: child.pid,
    samples: processSamples,
    errors: samplingErrors,
    intervalMs: sampleIntervalMs,
    shouldStop: () => stopSampling || Date.now() >= deadline,
  });
  let observation;
  let navigationTiming;
  let cdpMetrics;
  let startupInstrumentation;
  let coldLaunchToRecognizedMs;

  try {
    const port = await waitForDevToolsPort(
      profile,
      child,
      deadline,
      output,
    );
    const target = await waitForPageTarget(
      port,
      child,
      deadline,
      output,
    );
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl, deadline);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable");
    await cdp.send("Performance.enable");
    // Installed as early as this CDP session allows. `buffered: true` asks
    // Chromium to replay any matching performance entries already recorded
    // before this observer existed, which narrows (but does not eliminate)
    // the attach-race gap against true main-thread blocking during startup.
    await installLongTaskObserver(cdp);

    observation = await waitForRenderSmoke({
      timeoutMs: Math.max(1, deadline - Date.now()),
      pollIntervalMs: 50,
      observe: async () => {
        if (child.exitCode !== null) {
          throw new Error(
            `Packaged process exited during profiling with code ${child.exitCode}.`,
          );
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
        });
        return {
          observation: evaluation.result?.value,
          events: cdp.takeFatalEvents(),
        };
      },
    });
    coldLaunchToRecognizedMs = round(
      performance.now() - launchedAtMonotonicMs,
      3,
    );
    assertNoFatalCdpEvents(cdp.takeFatalEvents());
    navigationTiming = await readNavigationTiming(cdp);
    cdpMetrics = await readCdpPerformanceMetrics(cdp);
    startupInstrumentation = await readStartupInstrumentation(cdp);
    try {
      processSamples.push(
        await sampleWindowsProcessTree(child.pid),
      );
    } catch (error) {
      samplingErrors.push(safeErrorCode(error));
    }
  } finally {
    stopSampling = true;
    await sampler;
    try {
      cdp?.close();
    } catch {
      // Exact process-tree termination remains authoritative.
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
    if (terminationError || cleanupError) {
      throw new AggregateError(
        [terminationError, cleanupError].filter(Boolean),
        "Runtime profiler cleanup failed.",
      );
    }
  }

  if (processSamples.length === 0) {
    throw new Error(
      `No valid process-tree samples were captured (${samplingErrors.join(", ") || "unknown sampler failure"}).`,
    );
  }
  const processTree = summarizeProcessSamples(
    processSamples,
    hostIdentity.logicalCpuCount,
  );
  const longTasks = summarizeStartupLongTasks(startupInstrumentation);
  const assetTiming = summarizeStartupAssetTiming(startupInstrumentation);
  const metrics = {
    coldLaunchToRecognizedMs,
    navigationTiming,
    cdpPerformanceMetrics: cdpMetrics,
    processTree,
    longTasks,
    assetTiming,
  };
  const report = {
    format: RUNTIME_PROFILE_FORMAT,
    version: RUNTIME_PROFILE_VERSION,
    capturedAt: new Date().toISOString(),
    scope: "single-host-observation",
    build: buildIdentity,
    host: hostIdentity,
    run: {
      launchedAtEpochMs,
      timeoutMs,
      processSampleIntervalMs: sampleIntervalMs,
      validProcessSamples: processSamples.length,
      processSamplingErrorCount: samplingErrors.length,
      isolatedTemporaryProfile: true,
      documentUrl: observation.url,
      documentTitle: observation.title,
      packageFreshness: freshness,
    },
    metrics,
    observationalBudgets: OBSERVATIONAL_BUDGETS,
    classification: classifyRuntimeObservations(metrics),
    limitations: [
      "This is one cold-launch observation on one host, not a low-spec, typical, or discrete-GPU hardware matrix.",
      "CDP attachment adds detection overhead, so coldLaunchToRecognizedMs is an upper-bound observation rather than an in-app telemetry mark.",
      "Windows process data is sampled, so short working-set or CPU spikes between samples may be missed.",
      "CPU percent is normalized across the host logical CPU count and includes only the spawned Electron process tree.",
      "The profiler does not measure sustained gameplay, long-session memory growth, frame pacing, GPU memory, power, or thermal throttling.",
      "Long-task totals come from a buffered PerformanceObserver registered as soon as this profiler's CDP session attaches; tasks that ran and were evicted before that attach are not guaranteed to be replayed, so longTasks is a startup-window lower-bound proxy, not a from-process-start guarantee.",
      "Image and script asset timings are Resource Timing API durations (network fetch plus whatever in-process handling Chromium folds into that span), not isolated GPU image-decode or V8 script-compile/evaluate phases; treat assetTiming as a dependency-evaluation and decode proxy. Isolating true compile/evaluate/decode phases would require the heavier Tracing domain, which this profiler intentionally avoids.",
      "JS heap and long-task figures are a single settled-moment snapshot, not a peak or sustained measurement.",
    ],
  };
  await writeProfileArtifacts(report);
  return report;
}

async function readNavigationTiming(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(
        performance.getEntriesByType("paint").map((entry) => [
          entry.name,
          entry.startTime
        ])
      );
      return {
        timeOriginEpochMs: performance.timeOrigin,
        navigation: navigation ? {
          responseStartMs: navigation.responseStart,
          domContentLoadedEventEndMs: navigation.domContentLoadedEventEnd,
          loadEventEndMs: navigation.loadEventEnd,
          durationMs: navigation.duration
        } : null,
        firstPaintMs: paints["first-paint"] ?? null,
        firstContentfulPaintMs: paints["first-contentful-paint"] ?? null
      };
    })()`,
    returnByValue: true,
  });
  return sanitizeTimingValue(result.result?.value);
}

async function readCdpPerformanceMetrics(cdp) {
  const result = await cdp.send("Performance.getMetrics");
  const allowlist = new Set([
    "NavigationStart",
    "DomContentLoaded",
    "FirstMeaningfulPaint",
    "JSHeapUsedSize",
    "JSHeapTotalSize",
    "Nodes",
    "LayoutCount",
    "RecalcStyleCount",
    "LayoutDuration",
    "RecalcStyleDuration",
    "ScriptDuration",
    "TaskDuration",
  ]);
  return Object.fromEntries(
    (result.metrics ?? [])
      .filter(
        (entry) =>
          allowlist.has(entry.name) && Number.isFinite(entry.value),
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => [entry.name, round(entry.value, 6)]),
  );
}

async function installLongTaskObserver(cdp) {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      if (window.__ptpLongTaskObserverInstalled) return true;
      window.__ptpLongTaskObserverInstalled = true;
      window.__ptpLongTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__ptpLongTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch (error) {
        window.__ptpLongTaskObserverError = String(
          (error && error.message) || error,
        );
      }
      return true;
    })()`,
    returnByValue: true,
  });
}

/**
 * A single lightweight read of everything the CDP Performance/Runtime
 * domains expose without turning on the heavier Tracing domain: the
 * buffered long-task samples installed by installLongTaskObserver, and the
 * Resource Timing entries recorded for the startup document/script/image
 * fetches (used as dependency-evaluation and asset-decode proxies).
 */
async function readStartupInstrumentation(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const longTasks = Array.isArray(window.__ptpLongTasks)
        ? window.__ptpLongTasks.map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          }))
        : [];
      const resources = performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        transferSize: entry.transferSize || 0,
      }));
      return {
        longTasks,
        longTaskObserverError: window.__ptpLongTaskObserverError ?? null,
        resources,
      };
    })()`,
    returnByValue: true,
  });
  return (
    result.result?.value ?? {
      longTasks: [],
      longTaskObserverError: "evaluate-produced-no-value",
      resources: [],
    }
  );
}

function summarizeStartupLongTasks(startupInstrumentation) {
  const rawEntries = Array.isArray(startupInstrumentation?.longTasks)
    ? startupInstrumentation.longTasks
    : [];
  const validEntries = rawEntries.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Number.isFinite(entry.startTime) &&
      entry.startTime >= 0 &&
      Number.isFinite(entry.duration) &&
      entry.duration >= 0 &&
      entry.duration < 60_000,
  );
  const summary = summarizeLongTasks(validEntries);
  return {
    ...summary,
    droppedInvalidSampleCount: rawEntries.length - validEntries.length,
    observerError:
      typeof startupInstrumentation?.longTaskObserverError === "string"
        ? startupInstrumentation.longTaskObserverError.slice(0, 200)
        : null,
  };
}

const IMAGE_RESOURCE_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|avif|ico)(?:\?|#|$)/i;
const SCRIPT_RESOURCE_PATTERN = /\.m?js(?:\?|#|$)/i;

function summarizeStartupAssetTiming(startupInstrumentation) {
  const rawResources = Array.isArray(startupInstrumentation?.resources)
    ? startupInstrumentation.resources
    : [];
  const validResources = rawResources.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.name === "string" &&
      entry.name.length > 0 &&
      Number.isFinite(entry.startTime) &&
      entry.startTime >= 0 &&
      Number.isFinite(entry.responseEnd) &&
      entry.responseEnd >= 0 &&
      Number.isFinite(entry.transferSize) &&
      entry.transferSize >= 0,
  );
  const imageEntries = validResources.filter(
    (entry) =>
      entry.initiatorType === "img" || IMAGE_RESOURCE_PATTERN.test(entry.name),
  );
  const scriptEntries = validResources.filter(
    (entry) =>
      entry.initiatorType === "script" ||
      SCRIPT_RESOURCE_PATTERN.test(entry.name),
  );
  return {
    imageDecodeProxy: summarizeResourceEntries(imageEntries),
    scriptEvaluateProxy: summarizeResourceEntries(scriptEntries),
    droppedInvalidSampleCount: rawResources.length - validResources.length,
  };
}

function sanitizeTimingValue(value) {
  if (!value || typeof value !== "object") return undefined;
  const finiteOrNull = (candidate) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? round(candidate, 3)
      : null;
  const navigation =
    value.navigation && typeof value.navigation === "object"
      ? {
          responseStartMs: finiteOrNull(value.navigation.responseStartMs),
          domContentLoadedEventEndMs: finiteOrNull(
            value.navigation.domContentLoadedEventEndMs,
          ),
          loadEventEndMs: finiteOrNull(value.navigation.loadEventEndMs),
          durationMs: finiteOrNull(value.navigation.durationMs),
        }
      : null;
  return {
    timeOriginEpochMs: finiteOrNull(value.timeOriginEpochMs),
    navigation,
    firstPaintMs: finiteOrNull(value.firstPaintMs),
    firstContentfulPaintMs: finiteOrNull(
      value.firstContentfulPaintMs,
    ),
  };
}

async function sampleProcessTreeUntilStopped(options) {
  while (!options.shouldStop()) {
    const started = Date.now();
    try {
      options.samples.push(
        await sampleWindowsProcessTree(options.rootPid),
      );
    } catch (error) {
      options.errors.push(safeErrorCode(error));
    }
    const remaining = options.intervalMs - (Date.now() - started);
    if (remaining > 0 && !options.shouldStop()) {
      await delay(remaining);
    }
  }
}

async function sampleWindowsProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new TypeError("Profiler root PID is invalid.");
  }
  const script = `
$ErrorActionPreference = "Stop"
$rootPid = ${rootPid}
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime)
$ids = New-Object "System.Collections.Generic.HashSet[int]"
[void]$ids.Add($rootPid)
do {
  $changed = $false
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {
      [void]$ids.Add([int]$process.ProcessId)
      $changed = $true
    }
  }
} while ($changed)
$selected = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
if ($selected.Count -lt 1) { exit 3 }
$working = [UInt64](($selected | Measure-Object -Property WorkingSetSize -Sum).Sum)
$kernel = [UInt64](($selected | Measure-Object -Property KernelModeTime -Sum).Sum)
$user = [UInt64](($selected | Measure-Object -Property UserModeTime -Sum).Sum)
[ordered]@{
  timestampMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  rootPid = $rootPid
  processCount = $selected.Count
  workingSetBytes = $working
  cpuTime100ns = ($kernel + $user)
} | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    },
  );
  return parseWindowsProcessTreeSample(stdout.trim(), rootPid);
}

async function verifyFreshPackage(appPath) {
  const asarPath = join(resolve(appPath, ".."), "resources", "app.asar");
  const inputs = [
    join(projectRoot, "dist", "index.html"),
    join(projectRoot, "electron", "main.cjs"),
    join(projectRoot, "electron", "preload.cjs"),
  ];
  const [asarMetadata, ...inputMetadata] = await Promise.all([
    stat(asarPath),
    ...inputs.map((filePath) => stat(filePath)),
  ]);
  const newestInputMs = Math.max(
    ...inputMetadata.map((metadata) => metadata.mtimeMs),
  );
  if (asarMetadata.mtimeMs < newestInputMs) {
    throw new Error(
      "The unpacked app.asar is older than renderer/main-process inputs. Rebuild the package before profiling.",
    );
  }
  return {
    appAsarAtLeastAsNewAsInputs: true,
    comparedInputCount: inputs.length,
  };
}

async function readBuildIdentity(appPath) {
  const packageManifest = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const base = resolve(appPath, "..");
  const asarPath = join(base, "resources", "app.asar");
  const [exeMetadata, asarMetadata, electronVersion] = await Promise.all([
    stat(appPath),
    stat(asarPath),
    readFile(join(base, "version"), "utf8"),
  ]);
  return {
    applicationVersion:
      typeof packageManifest.version === "string"
        ? packageManifest.version
        : "unknown",
    electronVersion: electronVersion.trim(),
    executable: {
      fileName: basename(appPath),
      sizeBytes: exeMetadata.size,
      sha256: await sha256File(appPath),
    },
    appAsar: {
      sizeBytes: asarMetadata.size,
      sha256: await sha256File(asarPath),
    },
  };
}

function readHostIdentity() {
  const cpuList = cpus();
  const cpuModels = [
    ...new Set(cpuList.map((cpu) => cpu.model.trim())),
  ].sort();
  const identity = {
    platform: platform(),
    osRelease: release(),
    osVersion: osVersion(),
    architecture: arch(),
    logicalCpuCount: cpuList.length,
    cpuModels,
    totalMemoryBytes: totalmem(),
    nodeVersion: process.versions.node,
  };
  return {
    ...identity,
    anonymousFingerprintSha256: createHash("sha256")
      .update(canonicalJson(identity))
      .digest("hex"),
  };
}

async function packageBuildInProgress() {
  const command =
    '(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match "electron-builder" }).Count';
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        timeout: 3_000,
        windowsHide: true,
        maxBuffer: 8 * 1024,
      },
    );
    return Number.parseInt(stdout.trim(), 10) > 0;
  } catch {
    throw new Error("Could not determine whether package creation is active.");
  }
}

async function writeProfileArtifacts(report) {
  await mkdir(join(projectRoot, "work"), { recursive: true });
  const summary = [
    "# Packaged runtime performance observation",
    "",
    `- Scope: one host, one cold launch (${report.capturedAt})`,
    `- Build: app ${report.build.applicationVersion}, Electron ${report.build.electronVersion}, ASAR ${report.build.appAsar.sha256.slice(0, 12)}`,
    `- Host: ${report.host.osVersion}, ${report.host.logicalCpuCount} logical CPUs, ${formatMiB(report.host.totalMemoryBytes)} MiB RAM`,
    `- Cold launch to recognized renderer: ${report.metrics.coldLaunchToRecognizedMs} ms (${report.classification.coldLaunch})`,
    `- First paint / FCP: ${displayOptionalMs(report.metrics.navigationTiming?.firstPaintMs)} / ${displayOptionalMs(report.metrics.navigationTiming?.firstContentfulPaintMs)} (FCP: ${report.classification.firstContentfulPaint})`,
    `- Peak Electron process-tree working set: ${formatMiB(report.metrics.processTree.peakWorkingSetBytes)} MiB (${report.classification.peakWorkingSet})`,
    `- Peak normalized process-tree CPU: ${report.metrics.processTree.peakNormalizedCpuPercent}% (${report.classification.peakNormalizedCpu})`,
    `- Samples: ${report.metrics.processTree.sampleCount} across ${report.metrics.processTree.sampleWindowMs} ms; peak ${report.metrics.processTree.peakProcessCount} processes`,
    `- Main-thread long tasks during startup: ${report.metrics.longTasks.count} totaling ${report.metrics.longTasks.totalDurationMs} ms (${report.classification.longTaskTotal})`,
    `- JS heap used after settle: ${displayOptionalBytesMiB(report.metrics.cdpPerformanceMetrics?.JSHeapUsedSize)} MiB / total ${displayOptionalBytesMiB(report.metrics.cdpPerformanceMetrics?.JSHeapTotalSize)} MiB (${report.classification.jsHeapUsed})`,
    `- Image asset network+decode-inclusive proxy: ${report.metrics.assetTiming.imageDecodeProxy.count} assets, ${report.metrics.assetTiming.imageDecodeProxy.totalDurationMs} ms total`,
    `- Script bundle network+evaluate-inclusive proxy: ${report.metrics.assetTiming.scriptEvaluateProxy.count} chunks, ${report.metrics.assetTiming.scriptEvaluateProxy.totalDurationMs} ms total`,
    "",
    "This observation does not establish the low-spec, typical, or discrete-GPU hardware matrix. See the JSON limitations field.",
    "",
  ].join("\n");
  await atomicWrite(JSON_OUTPUT, canonicalJson(report));
  await atomicWrite(SUMMARY_OUTPUT, summary);
}

async function atomicWrite(destination, contents) {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporary, destination);
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
  assertValidatedTemporaryProfile(profile, tmpdir(), PROFILE_PREFIX);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function parseArguments(arguments_) {
  let appPath = DEFAULT_APP;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--app") {
      appPath = requireValue(arguments_, ++index, "--app");
    } else if (argument === "--timeout-ms") {
      timeoutMs = Number.parseInt(
        requireValue(arguments_, ++index, "--timeout-ms"),
        10,
      );
    } else if (argument === "--sample-interval-ms") {
      sampleIntervalMs = Number.parseInt(
        requireValue(arguments_, ++index, "--sample-interval-ms"),
        10,
      );
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { appPath, timeoutMs, sampleIntervalMs };
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

function displayOptionalMs(value) {
  return typeof value === "number" ? `${value} ms` : "not exposed";
}

function displayOptionalBytesMiB(value) {
  return typeof value === "number" ? formatMiB(value) : "not exposed";
}

function formatMiB(bytes) {
  return round(bytes / 1024 / 1024, 1);
}

function safeErrorCode(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 64);
  }
  return error instanceof Error
    ? error.name.slice(0, 64)
    : "unknown";
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const report = await profilePackagedRuntime(
      parseArguments(process.argv.slice(2)),
    );
    console.log(
      [
        "Packaged runtime profile passed.",
        `Cold launch: ${report.metrics.coldLaunchToRecognizedMs} ms (${report.classification.coldLaunch}).`,
        `Peak working set: ${formatMiB(report.metrics.processTree.peakWorkingSetBytes)} MiB.`,
        `Peak normalized CPU: ${report.metrics.processTree.peakNormalizedCpuPercent}%.`,
        `Long tasks: ${report.metrics.longTasks.count} (${report.metrics.longTasks.totalDurationMs} ms total, ${report.classification.longTaskTotal}).`,
        `JS heap used: ${displayOptionalBytesMiB(report.metrics.cdpPerformanceMetrics?.JSHeapUsedSize)} MiB (${report.classification.jsHeapUsed}).`,
        "Scope: one host only; no low-spec/typical/discrete hardware claim.",
        `JSON: ${relative(projectRoot, JSON_OUTPUT).split(sep).join("/")}.`,
        `Summary: ${relative(projectRoot, SUMMARY_OUTPUT).split(sep).join("/")}.`,
      ].join(" "),
    );
  } catch (error) {
    console.error(
      `Packaged runtime profile failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    process.exitCode = 1;
  }
}
