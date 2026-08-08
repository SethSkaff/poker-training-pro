#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const saveFlag = args.indexOf("--save");
const requestedSave = saveFlag >= 0 ? args[saveFlag + 1] : undefined;
if (saveFlag >= 0 && !requestedSave) {
  throw new Error("--save requires an autosave.json path");
}

const defaultSettings = {
  reducedMotion: false,
  reducedMotionExplicit: false,
  dealSpeed: "standard",
  menuMotion: "full",
  roomMotion: "full",
  cameraMotion: "full",
  tableMotion: "full",
  transitionMotion: "full",
};

function defaultSavePath() {
  const roaming = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(roaming, "poker-training-pro", "saves", "autosave.json");
}

function readHostPrefersReducedMotion() {
  if (process.platform !== "win32") {
    return { value: null, source: "unavailable outside Windows" };
  }
  const command = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MotionPreference { [DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(uint action, uint parameter, ref int value, uint flags); }'",
    "$enabled = 0",
    "if ([MotionPreference]::SystemParametersInfo(0x1042, 0, [ref]$enabled, 0)) { if ($enabled -eq 0) { 'true' } else { 'false' } } else { 'unknown' }",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  const value = result.status === 0 ? result.stdout.trim() : "unknown";
  if (value === "true" || value === "false") {
    return {
      value: value === "true",
      source: "Windows SPI_GETCLIENTAREAANIMATION (inferred prefers-reduced-motion)",
    };
  }
  return { value: null, source: "Windows animation preference unavailable" };
}

function loadSettings(savePath) {
  if (!existsSync(savePath)) return { ...defaultSettings, saveFound: false };
  const record = JSON.parse(readFileSync(savePath, "utf8"));
  const payload = typeof record.payload === "string" ? JSON.parse(record.payload) : record;
  const settings = payload?.data?.settings;
  if (!settings || typeof settings !== "object") {
    throw new Error(`No settings object found in ${savePath}`);
  }
  return { ...defaultSettings, ...settings, saveFound: true };
}

const savePath = resolve(requestedSave ?? defaultSavePath());
const persisted = loadSettings(savePath);
const host = readHostPrefersReducedMotion();
const resolvedReducedMotion = persisted.reducedMotionExplicit || host.value === null
  ? persisted.reducedMotion
  : host.value;

console.log(JSON.stringify({
  savePath,
  saveFound: persisted.saveFound,
  hostPrefersReducedMotion: host,
  persisted: {
    reducedMotion: persisted.reducedMotion,
    reducedMotionExplicit: persisted.reducedMotionExplicit,
    dealSpeed: persisted.dealSpeed,
    menuMotion: persisted.menuMotion,
    roomMotion: persisted.roomMotion,
    cameraMotion: persisted.cameraMotion,
    tableMotion: persisted.tableMotion,
    transitionMotion: persisted.transitionMotion,
  },
  resolved: {
    reducedMotion: resolvedReducedMotion,
    reason: persisted.reducedMotionExplicit
      ? "explicit in-app choice"
      : host.value === null
        ? "persisted fallback because host preference could not be read"
        : "live host preference",
  },
}, null, 2));
