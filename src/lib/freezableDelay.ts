/**
 * A single-shot delay whose exact remaining duration can be frozen and later
 * resumed with precisely that remainder.
 *
 * This exists so lifecycle pauses (minimize, screen lock, Windows suspend,
 * document hidden) can suspend an in-flight AI-presentation or animation delay
 * without either delivering the action early or restarting the whole wait. When
 * frozen, the delay records the milliseconds that were still owed; when resumed
 * it schedules exactly that many milliseconds again.
 *
 * The host seam keeps the module deterministic under test: production wires it
 * to `performance.now`/`window.setTimeout`, tests pass a controllable clock.
 */

export interface FreezableDelayHost {
  now(): number;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export const realFreezableDelayHost: FreezableDelayHost = {
  now: () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now(),
  schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class FreezableDelay {
  private handle: unknown = null;
  private remainingMs: number;
  private runningSince: number | null = null;
  private frozen = false;
  private settled = false;

  constructor(
    private readonly host: FreezableDelayHost,
    totalMs: number,
    private readonly onComplete: () => void,
  ) {
    this.remainingMs = Number.isFinite(totalMs) ? Math.max(0, totalMs) : 0;
    this.arm();
  }

  /** Milliseconds still owed before completion (0 once fired or cancelled). */
  get remaining(): number {
    if (this.settled) return 0;
    if (this.runningSince === null) return this.remainingMs;
    return Math.max(0, this.remainingMs - (this.host.now() - this.runningSince));
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get isPending(): boolean {
    return !this.settled;
  }

  /** Stop the countdown, preserving the exact remaining milliseconds. */
  freeze(): void {
    if (this.settled || this.frozen) return;
    this.frozen = true;
    this.remainingMs = this.remaining;
    this.runningSince = null;
    if (this.handle !== null) {
      this.host.cancel(this.handle);
      this.handle = null;
    }
  }

  /** Continue the countdown with exactly the frozen remainder. */
  resume(): void {
    if (this.settled || !this.frozen) return;
    this.frozen = false;
    this.arm();
  }

  /** Abandon the delay without ever completing. */
  cancel(): void {
    if (this.settled) return;
    this.settled = true;
    this.runningSince = null;
    if (this.handle !== null) {
      this.host.cancel(this.handle);
      this.handle = null;
    }
  }

  /**
   * Complete the delay immediately. This is intentionally separate from
   * `cancel()`: a player-requested presentation skip still performs the queued
   * game action, while lifecycle teardown must not.
   */
  finish(): void {
    if (this.settled) return;
    if (this.handle !== null) {
      this.host.cancel(this.handle);
      this.handle = null;
    }
    this.fire();
  }

  private arm(): void {
    if (this.settled || this.frozen) return;
    this.runningSince = this.host.now();
    this.handle = this.host.schedule(() => this.fire(), this.remainingMs);
  }

  private fire(): void {
    if (this.settled) return;
    this.settled = true;
    this.handle = null;
    this.runningSince = null;
    this.remainingMs = 0;
    this.onComplete();
  }
}
