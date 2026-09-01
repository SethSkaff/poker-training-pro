import { describe, expect, it } from "vitest";
import { FreezableDelay, type FreezableDelayHost } from "./freezableDelay";
import {
  DelayFreezeGroup,
  LifecyclePauseCoordinator,
  buildResumeRecap,
  describePauseReason,
  formatInactiveDuration,
  primaryPauseReason,
} from "./lifecyclePause";

function makeClock() {
  let value = 0;
  return {
    now: () => value,
    set: (next: number) => {
      value = next;
    },
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe("LifecyclePauseCoordinator", () => {
  it("pauses on the first reason and resumes only when all clear", () => {
    const clock = makeClock();
    const coordinator = new LifecyclePauseCoordinator(clock.now);

    let t = coordinator.setReason("window-blurred", true);
    expect(t.paused).toBe(true);
    expect(t.justPaused).toBe(true);

    clock.advance(1000);
    t = coordinator.setReason("system-suspended", true);
    expect(t.paused).toBe(true);
    expect(t.justPaused).toBe(false);
    expect(t.justResumed).toBe(false);

    clock.advance(1000);
    t = coordinator.setReason("window-blurred", false);
    expect(t.paused).toBe(true);
    expect(t.justResumed).toBe(false);

    clock.advance(500);
    t = coordinator.setReason("system-suspended", false);
    expect(t.paused).toBe(false);
    expect(t.justResumed).toBe(true);
    expect(t.inactiveMs).toBe(2500);
    expect(t.accumulatedInactiveMs).toBe(2500);
  });

  it("accumulates inactive time across separate pause spans", () => {
    const clock = makeClock();
    const coordinator = new LifecyclePauseCoordinator(clock.now);

    coordinator.setReason("manual", true);
    clock.advance(400);
    let t = coordinator.setReason("manual", false);
    expect(t.inactiveMs).toBe(400);

    clock.advance(1000);
    coordinator.setReason("document-hidden", true);
    clock.advance(600);
    t = coordinator.setReason("document-hidden", false);
    expect(t.inactiveMs).toBe(600);
    expect(t.accumulatedInactiveMs).toBe(1000);
  });

  it("is idempotent for a repeated identical reason", () => {
    const clock = makeClock();
    const coordinator = new LifecyclePauseCoordinator(clock.now);
    coordinator.setReason("window-minimized", true);
    clock.advance(100);
    const t = coordinator.setReason("window-minimized", true);
    expect(t.justPaused).toBe(false);
    expect(coordinator.activeReasons).toEqual(["window-minimized"]);
  });

  it("orders reasons by severity", () => {
    const coordinator = new LifecyclePauseCoordinator();
    coordinator.setReason("window-blurred", true);
    coordinator.setReason("system-suspended", true);
    coordinator.setReason("document-hidden", true);
    expect(coordinator.activeReasons[0]).toBe("system-suspended");
    expect(primaryPauseReason(coordinator.activeReasons)).toBe(
      "system-suspended",
    );
  });

  it("reports inactive time when cleared all at once", () => {
    const clock = makeClock();
    const coordinator = new LifecyclePauseCoordinator(clock.now);
    coordinator.setReason("screen-locked", true);
    clock.advance(750);
    const t = coordinator.clearAll();
    expect(t.paused).toBe(false);
    expect(t.inactiveMs).toBe(750);
  });
});

class FakeClockHost implements FreezableDelayHost {
  private current = 0;
  private nextId = 1;
  private tasks: Array<{ id: number; fireAt: number; cb: () => void }> = [];
  now() {
    return this.current;
  }
  schedule(cb: () => void, ms: number) {
    const id = this.nextId++;
    this.tasks.push({ id, fireAt: this.current + ms, cb });
    return id;
  }
  cancel(handle: unknown) {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  }
  advance(ms: number) {
    const target = this.current + ms;
    for (;;) {
      const due = this.tasks
        .filter((task) => task.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((task) => task.id !== due.id);
      this.current = due.fireAt;
      due.cb();
    }
    this.current = target;
  }
}

describe("DelayFreezeGroup", () => {
  it("freezes and resumes every registered delay with its own remainder", () => {
    const host = new FakeClockHost();
    const group = new DelayFreezeGroup();
    let firedA = 0;
    let firedB = 0;
    group.add(new FreezableDelay(host, 1000, () => (firedA += 1)));
    host.advance(200);
    group.add(new FreezableDelay(host, 400, () => (firedB += 1)));

    host.advance(100); // A: 700 left, B: 300 left
    group.freezeAll();
    host.advance(10_000);
    expect(firedA).toBe(0);
    expect(firedB).toBe(0);

    group.resumeAll();
    host.advance(300);
    expect(firedB).toBe(1);
    expect(firedA).toBe(0);
    host.advance(400);
    expect(firedA).toBe(1);
  });

  it("freezes a delay added while already frozen", () => {
    const host = new FakeClockHost();
    const group = new DelayFreezeGroup();
    let fired = 0;
    group.freezeAll();
    group.add(new FreezableDelay(host, 500, () => (fired += 1)));
    host.advance(5000);
    expect(fired).toBe(0);
    group.resumeAll();
    host.advance(500);
    expect(fired).toBe(1);
  });

  it("cancels all pending delays", () => {
    const host = new FakeClockHost();
    const group = new DelayFreezeGroup();
    let fired = 0;
    group.add(new FreezableDelay(host, 500, () => (fired += 1)));
    group.cancelAll();
    host.advance(1000);
    expect(fired).toBe(0);
    expect(group.size).toBe(0);
  });
});

describe("buildResumeRecap", () => {
  it("summarizes decision state and states inactive time is excluded", () => {
    const recap = buildResumeRecap({
      reason: "system-suspended",
      inactiveMs: 90_000,
      potChips: 4200,
      tournamentPlayersRemaining: 5,
      lastAction: "Riverboat: raise to 1,200",
      currentDecision: "Call 600 to continue",
      handNumber: 12,
      street: "Turn",
      countsAgainstPlay: false,
    });
    expect(recap.title).toBe("Resumed from system sleep");
    expect(recap.lines).toContain("Hand 12 · Turn");
    expect(recap.lines).toContain("Last action: Riverboat: raise to 1,200");
    expect(recap.lines).toContain(
      "Pot: 4,200 chips · 5 players remain in tournament",
    );
    expect(recap.lines).toContain("Your decision: Call 600 to continue");
    expect(recap.lines.at(-1)).toContain("not counted against your play");
  });

  it("notes when inactive time does count", () => {
    const recap = buildResumeRecap({
      inactiveMs: 5000,
      countsAgainstPlay: true,
    });
    expect(recap.title).toBe("Resumed");
    expect(recap.lines.at(-1)).toBe("Away for 5 seconds.");
  });
});

describe("formatInactiveDuration", () => {
  it("formats seconds and minutes readably", () => {
    expect(formatInactiveDuration(1000)).toBe("1 second");
    expect(formatInactiveDuration(45_000)).toBe("45 seconds");
    expect(formatInactiveDuration(60_000)).toBe("1 minute");
    expect(formatInactiveDuration(90_000)).toBe("1 min 30 s");
  });
});

describe("describePauseReason", () => {
  it("maps every reason to a readable label", () => {
    expect(describePauseReason("screen-locked")).toBe("Screen locked");
    expect(describePauseReason("window-minimized")).toBe("Minimized");
  });
});
