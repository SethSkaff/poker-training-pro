import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LifecyclePauseCoordinator } from "./lib/lifecyclePause";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

describe("career AI lifecycle progression", () => {
  it("re-wakes a cancelled advance even when resume races its finalizer", () => {
    const lifecycle = new LifecyclePauseCoordinator();
    expect(lifecycle.setReason("manual", true).justPaused).toBe(true);
    expect(lifecycle.setReason("manual", false).justResumed).toBe(true);

    const app = readFileSync(path.join(sourceRoot, "App.tsx"), "utf8");
    expect(app).toContain("tournamentPausedAtRef.current !== null");
    expect(app).toMatch(
      /tournamentPausedAtRef\.current = null;[\s\S]{0,500}setTournamentAdvanceRevision/,
    );
    expect(app).toMatch(
      /presentationAdvancePendingRef\.current = false;[\s\S]{0,500}signal\.aborted && tournamentPausedAtRef\.current === null[\s\S]{0,200}setTournamentAdvanceRevision/,
    );
    expect(app).toMatch(
      /screen,\s*tournamentAdvanceRevision,\s*\]\);/,
    );
  });
});
