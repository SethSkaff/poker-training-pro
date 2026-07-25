/**
 * Best-effort delivery of an IPC message to a `BrowserWindow`'s renderer.
 *
 * Electron's own `webContents.send()` / `webFrameMain` plumbing can throw
 * "Render frame was disposed before WebFrameMain could be accessed" (or a
 * generic "Object has been destroyed") when the render frame is torn down in
 * the window between a caller's liveness check and the actual send call.
 * Window/webContents/frame teardown during blur, minimize, close, quit,
 * navigation, or a renderer crash is not atomic with respect to a synchronous
 * `isDestroyed()` check performed a moment earlier — so a guard alone is not
 * enough. This helper guards against the common case (window or webContents
 * already destroyed) *and* defensively catches the remaining race, so a
 * lifecycle broadcast or close-handshake request can never throw out of an
 * Electron event handler or crash the main process.
 *
 * This module intentionally does not `require("electron")` so it can be unit
 * tested with plain stub objects outside the Electron runtime, following the
 * pattern already used for `crash-loop.cjs` / `replay-export.cjs`.
 *
 * @param {{ isDestroyed?: () => boolean, webContents?: { isDestroyed?: () => boolean, send?: (...args: unknown[]) => void } } | null | undefined} win
 * @param {string} channel
 * @param {unknown} payload
 * @param {{ log?: (level: string, event: string, details?: Record<string, unknown>) => void }} [options]
 * @returns {boolean} true if the message was handed to Electron for delivery, false if it was a safe no-op
 */
function safeSendToRenderer(win, channel, payload, options = {}) {
  const log = typeof options.log === "function" ? options.log : () => undefined;
  let webContents;
  try {
    if (!win || typeof win.isDestroyed !== "function" || win.isDestroyed()) {
      return false;
    }
    webContents = win.webContents;
    if (
      !webContents ||
      typeof webContents.isDestroyed !== "function" ||
      webContents.isDestroyed()
    ) {
      return false;
    }
  } catch (error) {
    // Even the liveness checks themselves can throw on a partially torn-down
    // window/webContents pair; treat that exactly like "already gone".
    log("warn", "renderer-send-precheck-failed", {
      channel,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  try {
    webContents.send(channel, payload);
    return true;
  } catch (error) {
    // The race window between the checks above and this call: the frame can
    // still be disposed out from under us. Delivery of lifecycle/close-state
    // messages is always best-effort, so log and continue rather than throw.
    log("warn", "renderer-send-failed", {
      channel,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

module.exports = { safeSendToRenderer };
