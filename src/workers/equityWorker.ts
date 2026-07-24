/// <reference lib="webworker" />
import {
  createEquityWorkerRuntime,
  isEquityWorkerRequest,
} from "../modes/rationalEquityProtocol";

// Thin worker shim: all scheduling, cancellation, and error behavior lives in
// the unit-tested runtime. The worker only bridges `postMessage` to it.
const scope = self as unknown as DedicatedWorkerGlobalScope;
const runtime = createEquityWorkerRuntime((message) =>
  scope.postMessage(message),
);

scope.addEventListener("message", (event: MessageEvent) => {
  if (isEquityWorkerRequest(event.data)) {
    runtime.handle(event.data);
  }
});
