const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  quit: () => ipcRenderer.invoke("app:quit"),
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
