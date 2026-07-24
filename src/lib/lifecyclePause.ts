/**
 * Aggregates every reason the game must pause its presentation clock and freeze
 * in-flight delays: an explicit pause, window blur, a hidden document, a
 * minimized window, a Windows suspend, or a locked screen.
 *
 * The coordinator is pure and deterministic. It owns no timers itself; it only
 * folds a set of boolean reasons into a single paused flag and measures the
 * exact inactive duration between the first reason appearing and the last one
 * clearing. The host maps DOM and Electron `powerMonitor` events to
 * `setReason` and uses the returned transition to freeze/resume delays, exclude
 * inactive time from Training/Timed play, and show the Ready recap.
 */

import { FreezableDelay } from "./freezableDelay";
import { formatChips, formatNumber } from "./format";

export type LifecyclePauseReason =
  | "manual"
  | "window-blurred"
  | "document-hidden"
  | "window-minimized"
  | "system-suspended"
  | "screen-locked";

const REASON_ORDER: readonly LifecyclePauseReason[] = [
  "manual",
  "system-suspended",
  "screen-locked",
  "window-minimized",
  "document-hidden",
  "window-blurred",
];

const REASON_LABELS: Record<LifecyclePauseReason, string> = {
  manual: "Paused",
  "window-blurred": "Window inactive",
  "document-hidden": "Window hidden",
  "window-minimized": "Minimized",
  "system-suspended": "System sleep",
  "screen-locked": "Screen locked",
};

export interface LifecyclePauseTransition {
  readonly reasons: readonly LifecyclePauseReason[];
  readonly paused: boolean;
  readonly justPaused: boolean;
  readonly justResumed: boolean;
  /** Inactive milliseconds for the span that just ended (0 unless justResumed). */
  readonly inactiveMs: number;
  /** Total inactive milliseconds accumulated across the coordinator's life. */
  readonly accumulatedInactiveMs: number;
}

export function primaryPauseReason(
  reasons: readonly LifecyclePauseReason[],
): LifecyclePauseReason | undefined {
  for (const reason of REASON_ORDER) {
    if (reasons.includes(reason)) return reason;
  }
  return undefined;
}

export function describePauseReason(reason: LifecyclePauseReason): string {
  return REASON_LABELS[reason];
}

export class LifecyclePauseCoordinator {
  private readonly reasons = new Set<LifecyclePauseReason>();
  private pausedSince: number | null = null;
  private accumulatedInactiveMs = 0;

  constructor(private readonly now: () => number = defaultNow) {}

  get isPaused(): boolean {
    return this.reasons.size > 0;
  }

  get activeReasons(): readonly LifecyclePauseReason[] {
    return sortReasons([...this.reasons]);
  }

  get totalInactiveMs(): number {
    return this.accumulatedInactiveMs;
  }

  setReason(
    reason: LifecyclePauseReason,
    active: boolean,
  ): LifecyclePauseTransition {
    const wasPaused = this.reasons.size > 0;
    if (active) this.reasons.add(reason);
    else this.reasons.delete(reason);
    const isPaused = this.reasons.size > 0;

    let inactiveMs = 0;
    let justPaused = false;
    let justResumed = false;
    if (!wasPaused && isPaused) {
      justPaused = true;
      this.pausedSince = this.now();
    } else if (wasPaused && !isPaused) {
      justResumed = true;
      if (this.pausedSince !== null) {
        inactiveMs = Math.max(0, this.now() - this.pausedSince);
        this.accumulatedInactiveMs += inactiveMs;
      }
      this.pausedSince = null;
    }

    return {
      reasons: sortReasons([...this.reasons]),
      paused: isPaused,
      justPaused,
      justResumed,
      inactiveMs,
      accumulatedInactiveMs: this.accumulatedInactiveMs,
    };
  }

  /** Clear every reason at once (e.g. on unmount), reporting inactive time. */
  clearAll(): LifecyclePauseTransition {
    const wasPaused = this.reasons.size > 0;
    this.reasons.clear();
    let inactiveMs = 0;
    if (wasPaused && this.pausedSince !== null) {
      inactiveMs = Math.max(0, this.now() - this.pausedSince);
      this.accumulatedInactiveMs += inactiveMs;
    }
    this.pausedSince = null;
    return {
      reasons: [],
      paused: false,
      justPaused: false,
      justResumed: wasPaused,
      inactiveMs,
      accumulatedInactiveMs: this.accumulatedInactiveMs,
    };
  }
}

function sortReasons(
  reasons: readonly LifecyclePauseReason[],
): LifecyclePauseReason[] {
  return [...reasons].sort(
    (left, right) => REASON_ORDER.indexOf(left) - REASON_ORDER.indexOf(right),
  );
}

function defaultNow(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/**
 * Tracks a set of in-flight freezable delays so a lifecycle pause can freeze
 * their exact remaining durations together and a resume can continue every one
 * with precisely the milliseconds still owed.
 */
export class DelayFreezeGroup {
  private readonly delays = new Set<FreezableDelay>();
  private frozen = false;

  get isFrozen(): boolean {
    return this.frozen;
  }

  get size(): number {
    return this.delays.size;
  }

  add(delay: FreezableDelay): FreezableDelay {
    this.prune();
    this.delays.add(delay);
    if (this.frozen) delay.freeze();
    return delay;
  }

  remove(delay: FreezableDelay): void {
    this.delays.delete(delay);
  }

  freezeAll(): void {
    this.frozen = true;
    for (const delay of this.delays) delay.freeze();
    this.prune();
  }

  resumeAll(): void {
    this.frozen = false;
    for (const delay of this.delays) delay.resume();
    this.prune();
  }

  cancelAll(): void {
    for (const delay of this.delays) delay.cancel();
    this.delays.clear();
  }

  private prune(): void {
    for (const delay of this.delays) {
      if (!delay.isPending) this.delays.delete(delay);
    }
  }
}

export interface ResumeRecapInput {
  reason?: LifecyclePauseReason;
  inactiveMs: number;
  potChips?: number;
  playersRemaining?: number;
  lastAction?: string;
  currentDecision?: string;
  handNumber?: number;
  street?: string;
  countsAgainstPlay: boolean;
}

export interface ResumeRecap {
  readonly title: string;
  readonly lines: readonly string[];
  readonly inactiveLabel: string;
  readonly countsAgainstPlay: boolean;
}

/**
 * Builds the brief, readable recap shown on resume: who acted, the pot, the
 * decision the player faces, and an explicit statement that the paused time was
 * not counted against Training or Timed Table play.
 */
export function buildResumeRecap(input: ResumeRecapInput): ResumeRecap {
  const lines: string[] = [];
  if (input.handNumber !== undefined) {
    const street = input.street ? ` · ${input.street}` : "";
    lines.push(`Hand ${input.handNumber}${street}`);
  }
  if (input.lastAction) lines.push(`Last action: ${input.lastAction}`);
  if (input.potChips !== undefined) {
    const players =
      input.playersRemaining !== undefined
        ? ` · ${input.playersRemaining} players left`
        : "";
    lines.push(`Pot: ${formatChips(input.potChips)} chips${players}`);
  }
  if (input.currentDecision) {
    lines.push(`Your decision: ${input.currentDecision}`);
  }
  const inactiveLabel = formatInactiveDuration(input.inactiveMs);
  lines.push(
    input.countsAgainstPlay
      ? `Away for ${inactiveLabel}.`
      : `Away for ${inactiveLabel}; that time was not counted against your play.`,
  );
  return {
    title: input.reason
      ? `Resumed from ${describePauseReason(input.reason).toLowerCase()}`
      : "Resumed",
    lines,
    inactiveLabel,
    countsAgainstPlay: input.countsAgainstPlay,
  };
}

export function formatInactiveDuration(inactiveMs: number): string {
  const totalSeconds = Math.max(0, Math.round(inactiveMs / 1000));
  if (totalSeconds < 60) {
    return `${formatNumber(totalSeconds)} second${totalSeconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${formatNumber(minutes)} minute${minutes === 1 ? "" : "s"}`;
  return `${formatNumber(minutes)} min ${formatNumber(seconds)} s`;
}
