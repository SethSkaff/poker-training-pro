const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  protocol,
  session,
  shell,
} = require("electron");
const { writeFileSync } = require("node:fs");
const { mkdir, readFile } = require("node:fs/promises");
const path = require("node:path");

// Allowlisted bundled documents surfaced by the in-app Credits and About/Support
// screens. Paths are relative to the application root (repo root in development,
// the app.asar root once packaged) and are read verbatim; the renderer can only
// request one of these fixed identifiers.
const BUNDLED_DOCUMENTS = {
  "privacy-policy": "docs/privacy-policy.md",
  "third-party-packages": "THIRD-PARTY-NOTICES.packages.md",
  "third-party-runtime": "THIRD-PARTY-NOTICES.runtime.txt",
  "font-inter": "licenses/fonts/inter-OFL-1.1.txt",
  "font-barlow": "licenses/fonts/barlow-condensed-OFL-1.1.txt",
};
const {
  createDiagnosticExport,
  loadAutosaveGeneration,
  probeAutosaveGenerations,
  readSaveForExport,
  restoreAutosaveGeneration,
  startFreshAutosave,
  writeAutosaveGeneration,
} = require("./save-store.cjs");
const {
  createSaveTransferController,
} = require("./save-transfer.cjs");
const {
  createCrashLoopController,
} = require("./crash-loop.cjs");
const {
  createReplayExportController,
} = require("./replay-export.cjs");
const { createLocalLogger } = require("./local-logger.cjs");

const isDevelopment = !app.isPackaged;
const APP_PROTOCOL = "poker-training-pro";
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);
const crashLoopController = createCrashLoopSafely();
const safeModeState = crashLoopController.getPublicState();
if (safeModeState.active) {
  app.disableHardwareAcceleration();
}
let diagnosticLogger = noOpLogger();
let failureDialogOpen = false;
let isQuitting = false;
let saveTransferController;
let replayExportController;
let mainWindow = null;
let closeConfirmed = false;
let awaitingCloseDecision = false;
let nextCloseRequestId = 1;
const pendingCloseDecisions = new Map();

/**
 * Forward an OS/lifecycle signal to the renderer so it can freeze the exact
 * remaining AI-presentation and animation delays, pause its play clocks, and
 * decide when its Ready recap is required. Delivery is best-effort: a missing
 * or destroyed window must never crash the main process.
 */
function broadcastLifecycle(payload) {
  const target = mainWindow;
  if (!target || target.isDestroyed()) return;
  try {
    target.webContents.send("lifecycle:event", payload);
  } catch {
    // Lifecycle hints are advisory; failure to deliver must not crash.
  }
  diagnosticLogger.log("info", "lifecycle-event", { kind: payload.kind });
}

function createWindow() {
  let healthySessionTimer;
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#07130f",
    title: "Poker Training Pro",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: isDevelopment,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedAppUrl(targetUrl)) event.preventDefault();
  });
  window.webContents.on("did-finish-load", () => {
    clearTimeout(healthySessionTimer);
    healthySessionTimer = setTimeout(() => {
      crashLoopController.markHealthySession();
      diagnosticLogger.log("info", "healthy-session-threshold-reached", {
        safeModeActive: safeModeState.active,
      });
    }, crashLoopController.getHealthySessionMs());
    healthySessionTimer.unref?.();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (isQuitting) return;
    clearTimeout(healthySessionTimer);
    const failureCount = isRendererFailureReason(details.reason)
      ? crashLoopController.recordRendererFailure()
      : undefined;
    diagnosticLogger.log("error", "render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      ...(failureCount === undefined ? {} : { failureCount }),
    });
    void showProcessRecovery(window, "renderer");
  });
  window.on("unresponsive", () => {
    diagnosticLogger.log("warn", "window-unresponsive");
    void showProcessRecovery(window, "unresponsive");
  });
  window.on("responsive", () => {
    diagnosticLogger.log("info", "window-responsive");
  });
  window.on("minimize", () =>
    broadcastLifecycle({ kind: "window-minimized", minimized: true }),
  );
  window.on("restore", () =>
    broadcastLifecycle({ kind: "window-minimized", minimized: false }),
  );
  window.on("blur", () =>
    broadcastLifecycle({ kind: "window-focus", focused: false }),
  );
  window.on("focus", () =>
    broadcastLifecycle({ kind: "window-focus", focused: true }),
  );
  window.on("close", (event) => {
    if (isQuitting || closeConfirmed) return;
    event.preventDefault();
    void beginCloseHandshake(window);
  });
  window.on("closed", () => {
    clearTimeout(healthySessionTimer);
    if (mainWindow === window) mainWindow = null;
  });
  window.once("ready-to-show", () => window.show());
  mainWindow = window;

  if (isDevelopment) {
    window.loadURL("http://127.0.0.1:5173");
  } else {
    window.loadURL(`${APP_PROTOCOL}://app/index.html`);
  }
}

/**
 * Give the renderer a chance to commit a lifecycle save at a safe boundary and
 * report whether scored progress would be abandoned, then confirm before an
 * unsaved-progress close. The handshake fails open on timeout so a stuck
 * renderer can never trap the window.
 */
async function beginCloseHandshake(window) {
  if (awaitingCloseDecision) return;
  awaitingCloseDecision = true;
  try {
    const decision = await requestRendererCloseState(window, "close");
    if (window.isDestroyed()) return;
    if (decision && decision.hasUnsavedScoredProgress) {
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Leave Poker Training Pro?",
        message: "You have scored progress that has not finished saving.",
        detail:
          "Quitting now may lose the most recent scored result. Wait a moment and try again, or leave without saving.",
        buttons: ["Keep playing", "Leave without saving"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (window.isDestroyed()) return;
      if (choice.response !== 1) return;
    }
    closeConfirmed = true;
    isQuitting = true;
    diagnosticLogger.log("info", "close-confirmed", {
      unsavedScoredProgress: Boolean(decision?.hasUnsavedScoredProgress),
    });
    window.close();
  } finally {
    awaitingCloseDecision = false;
  }
}

function requestRendererCloseState(window, cause) {
  return new Promise((resolve) => {
    if (!window || window.isDestroyed()) {
      resolve(undefined);
      return;
    }
    const requestId = nextCloseRequestId++;
    const timer = setTimeout(() => {
      if (pendingCloseDecisions.delete(requestId)) resolve(undefined);
    }, 1500);
    timer.unref?.();
    pendingCloseDecisions.set(requestId, (state) => {
      clearTimeout(timer);
      resolve(state);
    });
    try {
      window.webContents.send("lifecycle:prepare-close", { requestId, cause });
    } catch {
      if (pendingCloseDecisions.delete(requestId)) {
        clearTimeout(timer);
        resolve(undefined);
      }
    }
  });
}

app.whenReady().then(() => {
  protocol.handle(APP_PROTOCOL, handleBundledAppRequest);
  diagnosticLogger = createLoggerSafely();
  saveTransferController = createSaveTransferController({
    saveDirectory,
  });
  replayExportController = createReplayExportController({
    selectDestination: async ({ kind, defaultName }) => {
      const selection = await dialog.showSaveDialog(
        BrowserWindow.getFocusedWindow() ?? undefined,
        {
          title:
            kind === "developer"
              ? "Export deterministic developer replay"
              : "Export player-safe replay for a bug report",
          defaultPath: defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        },
      );
      return {
        canceled: selection.canceled,
        ...(selection.filePath ? { filePath: selection.filePath } : {}),
      };
    },
    isPackaged: app.isPackaged,
    isProduction:
      app.isPackaged || process.env.NODE_ENV === "production",
    developerFlagEnabled:
      process.env.POKER_TRAINING_PRO_DEVELOPER_REPLAY_EXPORT === "1",
    buildVersion: app.getVersion(),
  });
  diagnosticLogger.log("info", "application-ready", {
    packaged: app.isPackaged,
    platform: process.platform,
    architecture: process.arch,
    safeMode: safeModeState,
  });

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on("will-download", (event) => event.preventDefault());

  ipcMain.handle("app:getVersion", (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });
  ipcMain.handle("app:getAppInfo", (event) => {
    assertTrustedSender(event);
    return {
      appVersion: app.getVersion(),
      buildId: `${app.getVersion()}+${process.platform}-${process.arch}`,
      versions: {
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node,
      },
      paths: {
        save: saveDirectory(),
        log: logDirectory(),
      },
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
    };
  });
  ipcMain.handle("docs:readBundled", async (event, id) => {
    assertTrustedSender(event);
    const relativePath = BUNDLED_DOCUMENTS[id];
    if (!relativePath) {
      throw new TypeError("Unknown bundled document identifier");
    }
    try {
      const text = await readFile(
        path.resolve(__dirname, "..", relativePath),
        "utf8",
      );
      return { ok: true, id, text };
    } catch (error) {
      diagnosticLogger.log("warn", "bundled-document-read-failed", {
        id,
        systemCode:
          error && typeof error === "object" && typeof error.code === "string"
            ? error.code
            : "unknown",
      });
      return { ok: false, error: "read-failed" };
    }
  });
  ipcMain.handle("shell:openFolder", async (event, target) => {
    assertTrustedSender(event);
    if (target !== "save" && target !== "log") {
      throw new TypeError("Unknown folder target");
    }
    const directory = target === "save" ? saveDirectory() : logDirectory();
    try {
      await mkdir(directory, { recursive: true });
      const message = await shell.openPath(directory);
      // shell.openPath resolves with a non-empty string on failure.
      return message ? { ok: false, error: message } : { ok: true };
    } catch {
      return { ok: false, error: "open-failed" };
    }
  });
  ipcMain.handle("app:quit", (event) => {
    assertTrustedSender(event);
    app.quit();
  });
  ipcMain.handle("window:setFullscreen", (event, fullscreen) => {
    assertTrustedSender(event);
    if (typeof fullscreen !== "boolean") {
      throw new TypeError("Fullscreen state must be a boolean");
    }
    const window = BrowserWindow.getFocusedWindow();
    if (window) window.setFullScreen(fullscreen);
    return fullscreen;
  });
  ipcMain.handle("recovery:getSafeModeState", (event) => {
    assertTrustedSender(event);
    return safeModeState;
  });
  ipcMain.handle("save:loadAutosave", (event) => {
    assertTrustedSender(event);
    return loadAutosaveGeneration(saveDirectory());
  });
  ipcMain.handle("save:probeAutosaves", (event) => {
    assertTrustedSender(event);
    return probeAutosaveGenerations(saveDirectory());
  });
  ipcMain.handle(
    "save:commitAutosave",
    (event, serializedSave, boundary, replay) => {
      assertTrustedSender(event);
      if (typeof serializedSave !== "string") {
        throw new TypeError("Autosave payload must be a string");
      }
      if (
        boundary !== "settings" &&
        boundary !== "action" &&
        boundary !== "hand" &&
        boundary !== "result" &&
        boundary !== "lifecycle"
      ) {
        throw new TypeError("Autosave boundary is invalid");
      }
      try {
        const result = writeAutosaveGeneration(
          saveDirectory(),
          serializedSave,
          { boundary, replay },
        );
        diagnosticLogger.log("info", "autosave-committed", { boundary });
        return { ok: true, receipt: saveReceipt(result) };
      } catch (error) {
        if (error instanceof TypeError) throw error;
        diagnosticLogger.log("error", "autosave-commit-failed", {
          boundary,
          systemCode:
            error &&
            typeof error === "object" &&
            typeof error.code === "string"
              ? error.code
              : "unknown",
        });
        return { ok: false, error: ipcFileFailure(error, "write") };
      }
    },
  );
  ipcMain.handle("save:restoreAutosave", (event, source) => {
    assertTrustedSender(event);
    if (source !== "previous" && source !== "last-known-good") {
      throw new TypeError("Recovery source is invalid");
    }
    const result = restoreAutosaveGeneration(saveDirectory(), source);
    diagnosticLogger.log(
      result.ok ? "info" : "error",
      result.ok ? "autosave-restored" : "autosave-restore-failed",
      { source, errorCode: result.error?.code },
    );
    return result.ok
      ? { ok: true, receipt: saveReceipt(result) }
      : result;
  });
  ipcMain.handle("save:startFreshAutosave", (event, serializedSave) => {
    assertTrustedSender(event);
    if (typeof serializedSave !== "string") {
      throw new TypeError("Fresh save payload must be a string");
    }
    const result = startFreshAutosave(saveDirectory(), serializedSave);
    diagnosticLogger.log(
      result.ok ? "warn" : "error",
      result.ok ? "autosave-started-fresh" : "autosave-start-fresh-failed",
      { errorCode: result.error?.code },
    );
    return result.ok
      ? { ok: true, receipt: saveReceipt(result) }
      : result;
  });
  ipcMain.handle("save:exportSave", async (event, source) => {
    assertTrustedSender(event);
    const selectedSource = source ?? "current";
    const exported = readSaveForExport(saveDirectory(), selectedSource);
    if (!exported.ok) return exported;
    return exportTextFile(
      BrowserWindow.fromWebContents(event.sender),
      `poker-training-pro-${selectedSource}.json`,
      exported.payload,
    );
  });
  ipcMain.handle("save:prepareImport", async (event) => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window ?? undefined, {
      title: "Import Poker Training Pro save",
      properties: ["openFile"],
      filters: [{ name: "Poker Training Pro save", extensions: ["json"] }],
    });
    if (selection.canceled || selection.filePaths.length !== 1) {
      return {
        ok: false,
        error: {
          code: "cancelled",
          message: "The import was cancelled.",
          retryable: false,
        },
      };
    }
    const result = saveTransferController.prepareImportFromPath(
      selection.filePaths[0],
    );
    diagnosticLogger.log(result.ok ? "info" : "warn", "save-import-preview", {
      outcome: result.ok ? "ready" : "rejected",
      errorCode: result.error?.code,
    });
    return result;
  });
  ipcMain.handle("save:confirmImport", (event, confirmationToken) => {
    assertTrustedSender(event);
    assertConfirmationToken(confirmationToken);
    const result = saveTransferController.confirmImport(confirmationToken);
    diagnosticLogger.log(
      result.ok ? "warn" : "error",
      result.ok ? "save-import-committed" : "save-import-failed",
      { errorCode: result.error?.code },
    );
    return result;
  });
  ipcMain.handle("save:prepareProgressReset", (event) => {
    assertTrustedSender(event);
    const result = saveTransferController.prepareProgressReset();
    diagnosticLogger.log(
      result.ok ? "info" : "warn",
      "progress-reset-preview",
      {
        outcome: result.ok ? "ready" : "rejected",
        errorCode: result.error?.code,
      },
    );
    return result;
  });
  ipcMain.handle(
    "save:confirmProgressReset",
    (event, confirmationToken) => {
      assertTrustedSender(event);
      assertConfirmationToken(confirmationToken);
      const result =
        saveTransferController.confirmProgressReset(confirmationToken);
      diagnosticLogger.log(
        result.ok ? "warn" : "error",
        result.ok ? "progress-reset-committed" : "progress-reset-failed",
        { errorCode: result.error?.code },
      );
      return result;
    },
  );
  ipcMain.handle("save:exportDiagnostics", async (event) => {
    assertTrustedSender(event);
    const combinedDiagnostics = JSON.stringify(
      {
        format: "poker-training-pro-diagnostics",
        version: 1,
        createdAt: new Date().toISOString(),
        save: JSON.parse(createDiagnosticExport(saveDirectory())),
        application: JSON.parse(
          diagnosticLogger.createDiagnostics({
            platform: process.platform,
            architecture: process.arch,
            packaged: app.isPackaged,
            safeMode: safeModeState,
          }),
        ),
      },
      null,
      2,
    );
    return exportTextFile(
      BrowserWindow.fromWebContents(event.sender),
      "poker-training-pro-diagnostics.json",
      combinedDiagnostics,
    );
  });
  ipcMain.handle("replay:exportPublic", async (event, replay) => {
    assertTrustedSender(event);
    const result = await replayExportController.exportPublicReplay(replay);
    diagnosticLogger.log(
      result.ok ? "info" : "warn",
      result.ok ? "public-replay-exported" : "public-replay-export-failed",
      { errorCode: result.error?.code },
    );
    return result;
  });
  ipcMain.handle("replay:exportDeveloper", async (event, replay) => {
    assertTrustedSender(event);
    const result =
      await replayExportController.exportDeveloperReplay(replay);
    diagnosticLogger.log(
      result.ok ? "warn" : "error",
      result.ok
        ? "developer-replay-exported"
        : "developer-replay-export-failed",
      { errorCode: result.error?.code },
    );
    return result;
  });

  ipcMain.handle("lifecycle:reportCloseState", (event, requestId, state) => {
    assertTrustedSender(event);
    if (!Number.isInteger(requestId)) {
      throw new TypeError("Close request id must be an integer");
    }
    const resolver = pendingCloseDecisions.get(requestId);
    if (!resolver) return { ok: false };
    pendingCloseDecisions.delete(requestId);
    resolver({
      hasUnsavedScoredProgress: Boolean(
        state && state.hasUnsavedScoredProgress,
      ),
    });
    return { ok: true };
  });

  powerMonitor.on("suspend", () =>
    broadcastLifecycle({ kind: "system-suspend", suspended: true }),
  );
  powerMonitor.on("resume", () =>
    broadcastLifecycle({ kind: "system-suspend", suspended: false }),
  );
  powerMonitor.on("lock-screen", () =>
    broadcastLifecycle({ kind: "screen-lock", locked: true }),
  );
  powerMonitor.on("unlock-screen", () =>
    broadcastLifecycle({ kind: "screen-lock", locked: false }),
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Windows delivers `session-end` on logoff/shutdown/update-driven restart. This
// is a last safe boundary to flush a lifecycle save before the OS tears the
// process down; delivery is best-effort because the window may already be gone.
app.on("session-end", () => {
  isQuitting = true;
  broadcastLifecycle({ kind: "session-end" });
  diagnosticLogger.log("warn", "session-end");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (!isQuitting) {
    crashLoopController.recordNormalQuit();
  }
  isQuitting = true;
  broadcastLifecycle({ kind: "before-quit" });
  diagnosticLogger.log("info", "application-before-quit");
});

function saveDirectory() {
  return path.join(app.getPath("userData"), "saves");
}

function logDirectory() {
  return path.join(app.getPath("userData"), "logs");
}

function createCrashLoopSafely() {
  try {
    const controller = createCrashLoopController({
      directory: path.join(app.getPath("userData"), "recovery"),
    });
    return {
      getPublicState: () => controller.getPublicState(),
      getHealthySessionMs: () => controller.getHealthySessionMs(),
      markHealthySession: () => {
        try {
          controller.markHealthySession();
        } catch {
          // Recovery state must never prevent the app from remaining usable.
        }
      },
      recordNormalQuit: () => {
        try {
          controller.recordNormalQuit();
        } catch {
          // A clean quit must remain possible when userData is unavailable.
        }
      },
      recordRendererFailure: () => {
        try {
          return controller.recordRendererFailure();
        } catch {
          return undefined;
        }
      },
    };
  } catch {
    const unavailableState = Object.freeze({
      available: false,
      active: false,
      failureCount: 0,
      recoveryMarkerRecovered: false,
    });
    return {
      getPublicState: () => unavailableState,
      getHealthySessionMs: () => 60 * 1000,
      markHealthySession: () => undefined,
      recordNormalQuit: () => undefined,
      recordRendererFailure: () => undefined,
    };
  }
}

function isRendererFailureReason(reason) {
  return (
    reason === "abnormal-exit" ||
    reason === "killed" ||
    reason === "crashed" ||
    reason === "oom" ||
    reason === "launch-failed" ||
    reason === "integrity-failure"
  );
}

function createLoggerSafely() {
  try {
    const logger = createLocalLogger({
      directory: path.join(app.getPath("userData"), "logs"),
      maxFileBytes: 256 * 1024,
      maxFiles: 4,
      buildVersion: app.getVersion(),
      engineVersion: "trainer-1.0",
    });
    return {
      log: (...arguments_) => {
        try {
          return logger.log(...arguments_);
        } catch {
          return undefined;
        }
      },
      createDiagnostics: (metadata) => {
        try {
          return logger.createDiagnostics(metadata);
        } catch {
          return noOpLogger().createDiagnostics(metadata);
        }
      },
    };
  } catch {
    return noOpLogger();
  }
}

function noOpLogger() {
  return {
    log: () => undefined,
    createDiagnostics: (metadata = {}) =>
      JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          buildVersion: "unknown",
          engineVersion: "unknown",
          metadata,
          logs: [],
          loggingUnavailable: true,
        },
        null,
        2,
      ),
  };
}

async function showProcessRecovery(window, failureKind) {
  if (failureDialogOpen || window.isDestroyed()) return;
  failureDialogOpen = true;
  try {
    const unresponsive = failureKind === "unresponsive";
    const buttons = unresponsive
      ? ["Wait", "Reload app", "Quit"]
      : ["Reload app", "Quit"];
    const selection = await dialog.showMessageBox(window, {
      type: "error",
      title: "Poker Training Pro needs attention",
      message: unresponsive
        ? "The game window stopped responding."
        : "The game window closed unexpectedly.",
      detail:
        "Your last acknowledged autosave is kept separately. Reload the app to recover it, or quit without deleting progress.",
      buttons,
      defaultId: unresponsive ? 0 : 0,
      cancelId: unresponsive ? 0 : 1,
      noLink: true,
    });
    if (window.isDestroyed()) return;
    if (unresponsive && selection.response === 0) return;
    const reloadIndex = unresponsive ? 1 : 0;
    if (selection.response === reloadIndex) {
      diagnosticLogger.log("warn", "process-recovery-reload", {
        failureKind,
      });
      window.webContents.reloadIgnoringCache();
    } else {
      diagnosticLogger.log("warn", "process-recovery-quit", { failureKind });
      app.quit();
    }
  } finally {
    failureDialogOpen = false;
  }
}

function isTrustedAppUrl(value) {
  try {
    const url = new URL(value);
    if (isDevelopment) {
      return (
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        url.port === "5173"
      );
    }
    return (
      url.protocol === `${APP_PROTOCOL}:` &&
      url.hostname === "app" &&
      url.pathname === "/index.html"
    );
  } catch {
    return false;
  }
}

async function handleBundledAppRequest(request) {
  try {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      url.protocol !== `${APP_PROTOCOL}:` ||
      url.hostname !== "app"
    ) {
      return new Response("Not found", { status: 404 });
    }
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relativePath || relativePath.includes("\0")) {
      return new Response("Not found", { status: 404 });
    }
    const distDirectory = path.resolve(__dirname, "..", "dist");
    const targetPath = path.resolve(distDirectory, relativePath);
    if (
      targetPath !== distDirectory &&
      !targetPath.startsWith(`${distDirectory}${path.sep}`)
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    const bytes = await readFile(targetPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": bundledContentType(targetPath),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function bundledContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedAppUrl(senderUrl)) {
    throw new Error("Rejected IPC request from an untrusted renderer");
  }
}

function assertConfirmationToken(token) {
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 256
  ) {
    throw new TypeError("Save confirmation token is invalid");
  }
}

function saveReceipt(result) {
  return {
    boundary: result.record.boundary,
    savedAt: result.record.savedAt,
    checksum: result.record.checksum,
    journalVersion: result.record.version,
    payloadVersion: 1,
    rotatedPrevious: result.rotatedPrevious,
    ignoredCorruptCurrent: result.ignoredCorruptCurrent,
  };
}

async function exportTextFile(window, defaultName, contents) {
  const selection = await dialog.showSaveDialog(window ?? undefined, {
    title: "Export Poker Training Pro save",
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (selection.canceled || !selection.filePath) {
    return {
      ok: false,
      error: {
        code: "cancelled",
        message: "The export was cancelled",
        retryable: false,
      },
    };
  }
  try {
    writeFileSync(selection.filePath, contents, {
      encoding: "utf8",
      flag: "w",
    });
    return { ok: true, fileName: path.basename(selection.filePath) };
  } catch (error) {
    return { ok: false, error: ipcFileFailure(error, "write") };
  }
}

function ipcFileFailure(error, operation) {
  const systemCode =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : undefined;
  let code = operation === "read" ? "read-failed" : "write-failed";
  if (systemCode === "ENOSPC") code = "disk-full";
  if (systemCode === "EDQUOT") code = "quota-exceeded";
  if (
    systemCode === "EACCES" ||
    systemCode === "EPERM" ||
    systemCode === "EROFS"
  ) {
    code = "permission-denied";
  }
  return {
    code,
    message:
      operation === "read"
        ? "The save could not be read"
        : "The save could not be written",
    retryable: true,
    ...(systemCode &&
    new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO"]).has(
      systemCode,
    )
      ? { systemCode }
      : {}),
  };
}
