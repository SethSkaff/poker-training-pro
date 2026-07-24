import { describe, expect, it } from "vitest";
import { FreezableDelay, type FreezableDelayHost } from "./freezableDelay";

interface ScheduledTask {
  id: number;
  fireAt: number;
  callback: () => void;
}

class FakeClock implements FreezableDelayHost {
  private current = 0;
  private nextId = 1;
  private tasks: ScheduledTask[] = [];

  now(): number {
    return this.current;
  }

  schedule(callback: () => void, ms: number): unknown {
    const task: ScheduledTask = {
      id: this.nextId++,
      fireAt: this.current + ms,
      callback,
    };
    this.tasks.push(task);
    return task.id;
  }

  cancel(handle: unknown): void {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  }

  advance(ms: number): void {
    const target = this.current + ms;
    // Fire tasks in order until we reach the target time.
    for (;;) {
      const due = this.tasks
        .filter((task) => task.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((task) => task.id !== due.id);
      this.current = due.fireAt;
      due.callback();
    }
    this.current = target;
  }
}

describe("FreezableDelay", () => {
  it("fires after the full duration when never frozen", () => {
    const clock = new FakeClock();
    let fired = 0;
    new FreezableDelay(clock, 1000, () => (fired += 1));
    clock.advance(999);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  it("freezes the exact remaining milliseconds and resumes with that remainder", () => {
    const clock = new FakeClock();
    let fired = 0;
    const delay = new FreezableDelay(clock, 1000, () => (fired += 1));
    clock.advance(300);
    delay.freeze();
    expect(delay.remaining).toBe(700);
    // Real time passing while frozen must not consume the remainder.
    clock.advance(10_000);
    expect(fired).toBe(0);
    expect(delay.remaining).toBe(700);
    delay.resume();
    clock.advance(699);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  it("survives repeated freeze/resume cycles without drift", () => {
    const clock = new FakeClock();
    let fired = 0;
    const delay = new FreezableDelay(clock, 900, () => (fired += 1));
    clock.advance(200);
    delay.freeze();
    clock.advance(5000);
    delay.resume();
    clock.advance(300);
    delay.freeze();
    expect(delay.remaining).toBe(400);
    clock.advance(1000);
    delay.resume();
    clock.advance(399);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
  });

  it("is idempotent for duplicate freeze and resume calls", () => {
    const clock = new FakeClock();
    let fired = 0;
    const delay = new FreezableDelay(clock, 500, () => (fired += 1));
    clock.advance(100);
    delay.freeze();
    delay.freeze();
    expect(delay.remaining).toBe(400);
    delay.resume();
    delay.resume();
    clock.advance(400);
    expect(fired).toBe(1);
  });

  it("never fires after cancel", () => {
    const clock = new FakeClock();
    let fired = 0;
    const delay = new FreezableDelay(clock, 500, () => (fired += 1));
    clock.advance(200);
    delay.cancel();
    expect(delay.isPending).toBe(false);
    clock.advance(1000);
    expect(fired).toBe(0);
    // A resume after cancel is a no-op.
    delay.resume();
    clock.advance(1000);
    expect(fired).toBe(0);
  });

  it("reports zero remaining once fired", () => {
    const clock = new FakeClock();
    const delay = new FreezableDelay(clock, 100, () => undefined);
    clock.advance(100);
    expect(delay.isPending).toBe(false);
    expect(delay.remaining).toBe(0);
  });
});
