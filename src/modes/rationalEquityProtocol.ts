import {
  estimateRangeEquitySliced,
  type EquityEstimate,
  type EquityRequest,
} from "./rational";

/**
 * Versioned request/response protocol for the off-main-thread Rational equity
 * boundary. The protocol carries only public information, the policy seed, and
 * the deterministic work budget, so a worker result is bit-for-bit identical to
 * the synchronous path for a fixed request.
 */
export const EQUITY_PROTOCOL_VERSION = "rational-equity-protocol-v1";

export interface EquityEstimateRequestMessage {
  kind: "estimate";
  protocol: typeof EQUITY_PROTOCOL_VERSION;
  token: number;
  request: EquityRequest;
}

export interface EquityCancelRequestMessage {
  kind: "cancel";
  protocol: typeof EQUITY_PROTOCOL_VERSION;
  token: number;
}

export type EquityWorkerRequestMessage =
  | EquityEstimateRequestMessage
  | EquityCancelRequestMessage;

export interface EquityResultResponseMessage {
  kind: "result";
  protocol: typeof EQUITY_PROTOCOL_VERSION;
  token: number;
  estimate: EquityEstimate;
}

export interface EquityCancelledResponseMessage {
  kind: "cancelled";
  protocol: typeof EQUITY_PROTOCOL_VERSION;
  token: number;
}

export interface EquityErrorResponseMessage {
  kind: "error";
  protocol: typeof EQUITY_PROTOCOL_VERSION;
  token: number;
  message: string;
}

export type EquityWorkerResponseMessage =
  | EquityResultResponseMessage
  | EquityCancelledResponseMessage
  | EquityErrorResponseMessage;

/** Thrown inside the worker runtime when a request is cancelled between slices. */
export class EquityWorkCancelled extends Error {
  constructor(public readonly token: number) {
    super(`Equity work for token ${token} was cancelled`);
    this.name = "EquityWorkCancelled";
  }
}

export function estimateRequest(
  token: number,
  request: EquityRequest,
): EquityEstimateRequestMessage {
  return {
    kind: "estimate",
    protocol: EQUITY_PROTOCOL_VERSION,
    token,
    request,
  };
}

export function cancelRequest(token: number): EquityCancelRequestMessage {
  return { kind: "cancel", protocol: EQUITY_PROTOCOL_VERSION, token };
}

export function isEquityWorkerResponse(
  value: unknown,
): value is EquityWorkerResponseMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === EQUITY_PROTOCOL_VERSION &&
    ["result", "cancelled", "error"].includes(
      (value as { kind?: unknown }).kind as string,
    )
  );
}

export function isEquityWorkerRequest(
  value: unknown,
): value is EquityWorkerRequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === EQUITY_PROTOCOL_VERSION &&
    ["estimate", "cancel"].includes((value as { kind?: unknown }).kind as string)
  );
}

export interface EquityWorkerRuntime {
  handle(message: EquityWorkerRequestMessage): void;
}

export interface EquityWorkerRuntimeOptions {
  /**
   * Yields control between simulation-count slices so a queued cancel message
   * can be delivered. Defaults to a zero-delay macrotask. Never reads elapsed
   * time and never influences the sampled outcome.
   */
  yieldBetweenSlices?: () => Promise<void>;
  estimate?: typeof estimateRangeEquitySliced;
}

/**
 * The worker-side runtime. It runs the deterministic sliced estimator and
 * honors cancellation between slices. Extracted from the worker shim so the
 * scheduling, cancellation, and error behavior are unit-testable without an
 * actual `Worker`.
 */
export function createEquityWorkerRuntime(
  post: (message: EquityWorkerResponseMessage) => void,
  options: EquityWorkerRuntimeOptions = {},
): EquityWorkerRuntime {
  const cancelled = new Set<number>();
  const estimate = options.estimate ?? estimateRangeEquitySliced;
  const yieldBetweenSlices =
    options.yieldBetweenSlices ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  return {
    handle(message: EquityWorkerRequestMessage): void {
      if (message.kind === "cancel") {
        cancelled.add(message.token);
        return;
      }
      void run(message.token, message.request);
    },
  };

  async function run(token: number, request: EquityRequest): Promise<void> {
    if (cancelled.has(token)) {
      cancelled.delete(token);
      post({
        kind: "cancelled",
        protocol: EQUITY_PROTOCOL_VERSION,
        token,
      });
      return;
    }
    try {
      const result = await estimate(
        request.informationSet,
        request.legalActions,
        request.seed,
        request.simulations,
        {
          simulationsPerSlice: request.simulationsPerSlice,
          yieldControl: async () => {
            await yieldBetweenSlices();
            if (cancelled.has(token)) throw new EquityWorkCancelled(token);
          },
        },
      );
      if (cancelled.has(token)) {
        cancelled.delete(token);
        post({ kind: "cancelled", protocol: EQUITY_PROTOCOL_VERSION, token });
        return;
      }
      post({
        kind: "result",
        protocol: EQUITY_PROTOCOL_VERSION,
        token,
        estimate: result,
      });
    } catch (error) {
      cancelled.delete(token);
      if (error instanceof EquityWorkCancelled) {
        post({ kind: "cancelled", protocol: EQUITY_PROTOCOL_VERSION, token });
        return;
      }
      post({
        kind: "error",
        protocol: EQUITY_PROTOCOL_VERSION,
        token,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
