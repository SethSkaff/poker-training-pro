import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const safeSend = require("../../electron/safe-send.cjs") as {
  safeSendToRenderer(
    win: unknown,
    channel: string,
    payload: unknown,
    options?: { log?: (level: string, event: string, details?: Record<string, unknown>) => void },
  ): boolean;
};

/**
 * These tests exercise the shared guard used by every main-process ->
 * renderer broadcast (lifecycle events and the close handshake). The
 * production bug this guards against — Electron's webFrameMain throwing
 * "Render frame was disposed before WebFrameMain could be accessed" out of a
 * window `blur`/`close` handler when the renderer's frame is torn down
 * mid-teardown — cannot be reproduced with a real Electron BrowserWindow
 * inside a Vitest/Node process, so it is modeled here with stub
 * win/webContents objects whose `.isDestroyed()`/`.send()` behave the same
 * way Electron's do in that race: pre-checks can pass, and the send call
 * itself can still throw.
 */
function fakeWindow(overrides: {
  windowDestroyed?: boolean;
  webContentsDestroyed?: boolean;
  send?: (channel: string, payload: unknown) => void;
} = {}) {
  const send =
    overrides.send ??
    vi.fn((_channel: string, _payload: unknown) => undefined);
  return {
    isDestroyed: () => Boolean(overrides.windowDestroyed),
    webContents: {
      isDestroyed: () => Boolean(overrides.webContentsDestroyed),
      send,
    },
    send,
  };
}

describe("safeSendToRenderer", () => {
  it("delivers a message when the window and webContents are alive", () => {
    const win = fakeWindow();
    const delivered = safeSend.safeSendToRenderer(win, "lifecycle:event", {
      kind: "window-focus",
      focused: true,
    });
    expect(delivered).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledWith("lifecycle:event", {
      kind: "window-focus",
      focused: true,
    });
  });

  it("is a safe no-op when the window itself is destroyed", () => {
    const win = fakeWindow({ windowDestroyed: true });
    const delivered = safeSend.safeSendToRenderer(win, "lifecycle:event", {
      kind: "before-quit",
    });
    expect(delivered).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("is a safe no-op when only the webContents is destroyed", () => {
    const win = fakeWindow({ webContentsDestroyed: true });
    const delivered = safeSend.safeSendToRenderer(win, "lifecycle:event", {
      kind: "before-quit",
    });
    expect(delivered).toBe(false);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("is a safe no-op (never throws) when win is null or undefined", () => {
    expect(() =>
      safeSend.safeSendToRenderer(null, "lifecycle:event", { kind: "x" }),
    ).not.toThrow();
    expect(safeSend.safeSendToRenderer(null, "lifecycle:event", { kind: "x" })).toBe(
      false,
    );
    expect(
      safeSend.safeSendToRenderer(undefined, "lifecycle:event", { kind: "x" }),
    ).toBe(false);
  });

  it("catches the frame-disposed race: checks pass but send() still throws", () => {
    const throwingSend = vi.fn(() => {
      throw new Error(
        "Render frame was disposed before WebFrameMain could be accessed",
      );
    });
    const win = fakeWindow({ send: throwingSend });
    const log = vi.fn();
    expect(() =>
      safeSend.safeSendToRenderer(win, "lifecycle:event", { kind: "window-focus" }, {
        log,
      }),
    ).not.toThrow();
    const delivered = safeSend.safeSendToRenderer(
      win,
      "lifecycle:event",
      { kind: "window-focus" },
      { log },
    );
    expect(delivered).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "renderer-send-failed",
      expect.objectContaining({ channel: "lifecycle:event" }),
    );
  });

  it("logs and returns false, without throwing, when isDestroyed() itself throws", () => {
    const win = {
      isDestroyed: () => {
        throw new Error("Object has been destroyed");
      },
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    const log = vi.fn();
    let delivered: boolean | undefined;
    expect(() => {
      delivered = safeSend.safeSendToRenderer(win, "lifecycle:event", {}, { log });
    }).not.toThrow();
    expect(delivered).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "renderer-send-precheck-failed",
      expect.objectContaining({ channel: "lifecycle:event" }),
    );
  });

  it("works with no options object supplied (log is optional)", () => {
    const win = fakeWindow();
    expect(() =>
      safeSend.safeSendToRenderer(win, "lifecycle:event", { kind: "x" }),
    ).not.toThrow();
  });
});
