const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_DOCUMENT_IDS = new Set([
  "privacy-policy",
  "third-party-packages",
  "third-party-runtime",
  "font-inter",
  "font-barlow",
]);
const ALLOWED_FOLDER_TARGETS = new Set(["save", "log"]);
const lifecycleSmokeEnabled = process.argv.includes("--ptp-lifecycle-smoke");
const forceWebGl2Failure = process.argv.includes("--ptp-force-webgl2-failure");
const sceneAuditSeedArgument = process.argv.find((argument) => argument.startsWith("--ptp-scene-audit-seed="));
const requestedSceneAuditSeed = sceneAuditSeedArgument?.slice("--ptp-scene-audit-seed=".length);
const sceneAuditSeed = lifecycleSmokeEnabled
  && ["runner-showdown-3", "scene-side-pot-0"].includes(requestedSceneAuditSeed)
  ? requestedSceneAuditSeed
  : "runner-showdown-3";

contextBridge.exposeInMainWorld("desktop", {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getAppInfo: () => ipcRenderer.invoke("app:getAppInfo"),
  readBundledDocument: (id) =>
    ALLOWED_DOCUMENT_IDS.has(id)
      ? ipcRenderer.invoke("docs:readBundled", id)
      : Promise.resolve({ ok: false, error: "unknown-document" }),
  openFolder: (target) =>
    ALLOWED_FOLDER_TARGETS.has(target)
      ? ipcRenderer.invoke("shell:openFolder", target)
      : Promise.resolve({ ok: false, error: "unknown-target" }),
  quit: () => ipcRenderer.invoke("app:quit"),
  // This bridge is absent from normal app windows. Electron's main process
  // explicitly forwards the isolated package-smoke flag to the preload.
  testLifecycleWindow: lifecycleSmokeEnabled
    ? (action) => ipcRenderer.invoke("test:lifecycleWindow", action)
    : undefined,
  // Renderer diagnostics are intentionally available only to the isolated
  // packaged smoke/audit process. They expose no game state and must not become
  // an ordinary production-window debugging surface.
  sceneDiagnosticsEnabled: lifecycleSmokeEnabled || undefined,
  // A fixed public runner seed makes packaged scene captures reproducible. It
  // exists only alongside the lifecycle-smoke bridge and never reaches a
  // normal player window or persisted save.
  sceneAuditSeed: lifecycleSmokeEnabled ? sceneAuditSeed : undefined,
  // This capability override exists only for the isolated packaged fallback
  // audit. Normal launches do not expose it, so it cannot become a user
  // setting or a renderer-controlled hardware policy.
  forceWebGl2Failure: forceWebGl2Failure || undefined,
  setFullscreen: (fullscreen) =>
    ipcRenderer.invoke("window:setFullscreen", Boolean(fullscreen)),
  getSafeModeState: () =>
    ipcRenderer.invoke("recovery:getSafeModeState"),
  loadAutosave: () => ipcRenderer.invoke("save:loadAutosave"),
  probeAutosaves: () => ipcRenderer.invoke("save:probeAutosaves"),
  commitAutosave: (serializedSave, boundary, replay) =>
    ipcRenderer.invoke(
      "save:commitAutosave",
      serializedSave,
      boundary,
      replay,
    ),
  restoreAutosave: (source) =>
    ipcRenderer.invoke("save:restoreAutosave", source),
  startFreshAutosave: (serializedSave) =>
    ipcRenderer.invoke("save:startFreshAutosave", serializedSave),
  exportSave: (source) => ipcRenderer.invoke("save:exportSave", source),
  prepareSaveImport: () => ipcRenderer.invoke("save:prepareImport"),
  confirmSaveImport: (confirmationToken) =>
    ipcRenderer.invoke("save:confirmImport", confirmationToken),
  prepareProgressReset: () =>
    ipcRenderer.invoke("save:prepareProgressReset"),
  confirmProgressReset: (confirmationToken) =>
    ipcRenderer.invoke("save:confirmProgressReset", confirmationToken),
  exportSaveDiagnostics: () =>
    ipcRenderer.invoke("save:exportDiagnostics"),
  exportPublicReplay: (replay) =>
    ipcRenderer.invoke("replay:exportPublic", replay),
  exportDeveloperReplay: (replay) =>
    ipcRenderer.invoke("replay:exportDeveloper", replay),
  onLifecycleEvent: (listener) => {
    if (typeof listener !== "function") return () => {};
    const channelListener = (_event, payload) => {
      const event = sanitizeLifecycleEvent(payload);
      if (event) listener(event);
    };
    ipcRenderer.on("lifecycle:event", channelListener);
    return () => ipcRenderer.removeListener("lifecycle:event", channelListener);
  },
  onPrepareClose: (listener) => {
    if (typeof listener !== "function") return () => {};
    const channelListener = (_event, payload) => {
      const requestId =
        payload && Number.isInteger(payload.requestId)
          ? payload.requestId
          : undefined;
      if (requestId === undefined) return;
      const cause =
        payload && payload.cause === "close" ? "close" : "lifecycle";
      listener({
        requestId,
        cause,
        report: (state) =>
          ipcRenderer.invoke("lifecycle:reportCloseState", requestId, {
            hasUnsavedScoredProgress: Boolean(
              state && state.hasUnsavedScoredProgress,
            ),
          }),
      });
    };
    ipcRenderer.on("lifecycle:prepare-close", channelListener);
    return () =>
      ipcRenderer.removeListener("lifecycle:prepare-close", channelListener);
  },
});

const LIFECYCLE_KINDS = new Set([
  "window-minimized",
  "window-focus",
  "system-suspend",
  "screen-lock",
  "session-end",
  "before-quit",
]);

function sanitizeLifecycleEvent(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  const kind = payload.kind;
  if (typeof kind !== "string" || !LIFECYCLE_KINDS.has(kind)) return undefined;
  const event = { kind };
  if (kind === "window-minimized") event.minimized = Boolean(payload.minimized);
  if (kind === "window-focus") event.focused = Boolean(payload.focused);
  if (kind === "system-suspend") event.suspended = Boolean(payload.suspended);
  if (kind === "screen-lock") event.locked = Boolean(payload.locked);
  return event;
}
