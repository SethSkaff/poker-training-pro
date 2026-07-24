import {
  estimateRangeEquity,
  type EquityEstimate,
  type EquityEstimator,
  type EquityRequest,
} from "./rational";
import {
  cancelRequest,
  estimateRequest,
  isEquityWorkerResponse,
  type EquityWorkerRequestMessage,
  type EquityWorkerResponseMessage,
} from "./rationalEquityProtocol";

/**
 * A minimal structural subset of {@link Worker} used by the service so the
 * cancellation and stale-result behavior can be exercised with a fake worker in
 * tests without a real thread.
 */
export interface EquityWorkerLike {
  postMessage(message: EquityWorkerRequestMessage): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  terminate(): void;
}

/** Rejected when a newer request supersedes a pending one. */
export class StaleEquityRequestError extends Error {
  constructor() {
    super("Equity request was superseded by a newer decision");
    this.name = "StaleEquityRequestError";
  }
}

/** Rejected when a pending request is explicitly cancelled. */
export class CancelledEquityRequestError extends Error {
  constructor() {
    super("Equity request was cancelled");
    this.name = "CancelledEquityRequestError";
  }
}

export interface RationalEquityService {
  /** Deterministic estimator usable directly by `decideRationalActionAsync`. */
  readonly estimate: EquityEstimator;
  /**
   * Cancels the currently pending request, if any, rejecting its promise with
   * {@link CancelledEquityRequestError}. Used when a decision becomes obsolete
   * (navigation, hand advancement, restart).
   */
  cancelPending(): void;
  /** Tears down the worker and rejects any in-flight request. */
  dispose(): void;
  /** True when a real worker is driving the estimation. */
  readonly usesWorker: boolean;
}

export interface CreateRationalEquityServiceOptions {
  /** Factory for the worker; omit to run on the calling thread. */
  createWorker?: () => EquityWorkerLike;
  /** Synchronous fallback; defaults to the deterministic in-thread estimator. */
  synchronousEstimate?: (request: EquityRequest) => EquityEstimate;
  /**
   * When true (the default), a single pending request is enforced: dispatching
   * a new request supersedes and rejects the previous one with
   * {@link StaleEquityRequestError}. This mirrors live tournament progression,
   * where only the current hero decision matters.
   */
  supersedePending?: boolean;
}

interface PendingRequest {
  token: number;
  resolve(estimate: EquityEstimate): void;
  reject(error: Error): void;
  settled: boolean;
}

const defaultSynchronousEstimate = (request: EquityRequest): EquityEstimate =>
  estimateRangeEquity(
    request.informationSet,
    request.legalActions,
    request.seed,
    request.simulations,
    { simulationsPerSlice: request.simulationsPerSlice },
  );

export function createRationalEquityService(
  options: CreateRationalEquityServiceOptions = {},
): RationalEquityService {
  const supersedePending = options.supersedePending ?? true;
  const synchronousEstimate =
    options.synchronousEstimate ?? defaultSynchronousEstimate;
  const worker = options.createWorker ? options.createWorker() : null;
  const pending = new Map<number, PendingRequest>();
  let nextToken = 1;
  let disposed = false;

  const listener = (event: { data: unknown }): void => {
    if (!isEquityWorkerResponse(event.data)) return;
    handleResponse(event.data);
  };
  if (worker) worker.addEventListener("message", listener);

  function settle(
    entry: PendingRequest,
    action: () => void,
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    pending.delete(entry.token);
    action();
  }

  function handleResponse(message: EquityWorkerResponseMessage): void {
    const entry = pending.get(message.token);
    // A response for an already-superseded/cancelled token is silently dropped:
    // stale-result rejection at the boundary.
    if (!entry) return;
    if (message.kind === "result") {
      settle(entry, () => entry.resolve(message.estimate));
    } else if (message.kind === "cancelled") {
      settle(entry, () => entry.reject(new CancelledEquityRequestError()));
    } else {
      settle(entry, () => entry.reject(new Error(message.message)));
    }
  }

  function supersede(error: () => Error): void {
    if (!supersedePending) return;
    for (const entry of [...pending.values()]) {
      if (worker) worker.postMessage(cancelRequest(entry.token));
      settle(entry, () => entry.reject(error()));
    }
  }

  const estimate: EquityEstimator = (request) => {
    if (disposed) {
      return Promise.reject(new Error("Equity service is disposed"));
    }
    const token = nextToken;
    nextToken += 1;

    if (!worker) {
      // In-thread fallback (tests, iOS bundle, or no worker support). A newer
      // request cannot arrive before this resolves, so no staleness is possible.
      supersede(() => new StaleEquityRequestError());
      try {
        return Promise.resolve(synchronousEstimate(request));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    supersede(() => new StaleEquityRequestError());
    return new Promise<EquityEstimate>((resolve, reject) => {
      pending.set(token, { token, resolve, reject, settled: false });
      worker.postMessage(estimateRequest(token, request));
    });
  };

  return {
    estimate,
    usesWorker: worker !== null,
    cancelPending(): void {
      supersede(() => new CancelledEquityRequestError());
      // When superseding is disabled we still cancel every in-flight request.
      if (!supersedePending) {
        for (const entry of [...pending.values()]) {
          if (worker) worker.postMessage(cancelRequest(entry.token));
          settle(entry, () => entry.reject(new CancelledEquityRequestError()));
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of [...pending.values()]) {
        if (worker) worker.postMessage(cancelRequest(entry.token));
        settle(entry, () => entry.reject(new CancelledEquityRequestError()));
      }
      if (worker) {
        worker.removeEventListener("message", listener);
        worker.terminate();
      }
    },
  };
}

/**
 * Constructs a worker-backed service for the desktop/browser renderer. The
 * worker is a Vite module worker served from the packaged custom protocol under
 * the strict CSP (`worker-src 'self' blob:`). Falls back to the in-thread
 * estimator when `Worker` is unavailable (tests, iOS bundle).
 */
export function createDesktopEquityService(): RationalEquityService {
  // Electron's hardened renderer uses Chromium's sandbox. Its module Worker
  // bootstrap currently emits a sandbox_bundle startupData error in packaged
  // builds (and then falls back anyway), so do not create that broken worker
  // there. The in-thread path remains deterministic and strictly capped per
  // decision; regular browser builds keep the worker-backed boundary.
  const sandboxedElectronRenderer =
    typeof window !== "undefined" && Boolean(window.desktop);
  if (typeof Worker === "undefined" || sandboxedElectronRenderer) {
    return createRationalEquityService();
  }
  return createRationalEquityService({
    createWorker: () =>
      new Worker(new URL("../workers/equityWorker.ts", import.meta.url), {
        type: "module",
      }) as unknown as EquityWorkerLike,
  });
}
