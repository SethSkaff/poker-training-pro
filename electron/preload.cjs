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
});
