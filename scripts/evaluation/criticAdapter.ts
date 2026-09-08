import {
  parseReviewerOutput,
  reviewerInputHash,
  serializeReviewerInput,
  type ReviewerInputV2,
  type ReviewerOutputV2,
} from "./criticInput";

export type ReviewerEndpointCategory = "mock" | "local" | "remote";
export type ReviewerCacheMode = "use" | "bypass";

export interface ReviewerRunReceipt {
  schemaVersion: 1;
  reviewerIdentity: string;
  reviewerVersion: string;
  promptFingerprint: string;
  schemaFingerprint: string;
  inputHash: string;
  cacheMode: ReviewerCacheMode;
  decoderSettings: Record<string, string | number | boolean | null>;
  endpointCategory: ReviewerEndpointCategory;
  requestedTokens: number | null;
  actualTokens: number | null;
  elapsedMs: number | null;
  cost: number | null;
  transportError: string | null;
  responseRef: string | null;
  validationStatus: "valid" | "invalid_response" | "unvalidated" | "promotion_pending";
}

export interface ReviewerRunResult {
  output: ReviewerOutputV2 | null;
  receipt: ReviewerRunReceipt;
  cacheHit: boolean;
}

export interface ReviewerAdapter {
  identity: string;
  version: string;
  promptFingerprint: string;
  endpointCategory: ReviewerEndpointCategory;
  review(input: ReviewerInputV2, serialized: string): Promise<unknown>;
}

export interface ReviewerRequestOptions {
  cache?: ReviewerResponseCache;
  cacheMode?: ReviewerCacheMode;
  decoderSettings?: Record<string, string | number | boolean | null>;
  requestedTokens?: number | null;
  promptFingerprint?: string;
}

export interface ReviewerResponseCache {
  get(key: string): ReviewerRunResult | undefined;
  set(key: string, value: ReviewerRunResult): void;
}

export function reviewerCacheKey(
  input: ReviewerInputV2,
  adapter: Pick<ReviewerAdapter, "identity" | "version" | "promptFingerprint">,
  decoderSettings: Record<string, string | number | boolean | null> = {},
): string {
  return [
    reviewerInputHash(input),
    input.task,
    adapter.identity,
    adapter.version,
    adapter.promptFingerprint,
    JSON.stringify(decoderSettings, Object.keys(decoderSettings).sort()),
  ].join("|");
}

export function createInMemoryReviewerCache(): ReviewerResponseCache {
  const entries = new Map<string, ReviewerRunResult>();
  return {
    get(key) {
      const value = entries.get(key);
      return value ? structuredClone(value) : undefined;
    },
    set(key, value) {
      if (entries.has(key)) throw new Error(`Reviewer cache key already exists: ${key}`);
      entries.set(key, structuredClone(value));
    },
  };
}

function mockOutput(input: ReviewerInputV2): ReviewerOutputV2 {
  return {
    schemaVersion: 2,
    caseId: input.caseId,
    assessments: {
      strategicPlausibility: "insufficient",
      wagerNumberPlausibility: "insufficient",
      styleConsistency: "insufficient",
    },
    findings: [],
    missingInformation: ["independent_human_or_exact_reference_label"],
    inputContradictions: [],
    validationStatus: "unvalidated",
  };
}

export function createMockReviewerAdapter(options: {
  identity?: string;
  version?: string;
  promptFingerprint?: string;
  response?: (input: ReviewerInputV2) => unknown;
} = {}): ReviewerAdapter {
  return {
    identity: options.identity ?? "mock-reviewer",
    version: options.version ?? "mock-v1",
    promptFingerprint: options.promptFingerprint ?? "governing-prompt-v2",
    endpointCategory: "mock",
    async review(input) {
      return options.response ? options.response(input) : mockOutput(input);
    },
  };
}

export function createHttpReviewerAdapter(options: {
  endpoint: string;
  model: string;
  fetchImpl?: (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
  identity?: string;
  version?: string;
  promptFingerprint?: string;
  endpointCategory?: "local" | "remote";
}): ReviewerAdapter {
  if (!options.endpoint || !options.model) throw new Error("HTTP reviewer adapter requires an explicit endpoint and model");
  return {
    identity: options.identity ?? options.model,
    version: options.version ?? "http-adapter-v1",
    promptFingerprint: options.promptFingerprint ?? "governing-prompt-v2",
    endpointCategory: options.endpointCategory ?? "remote",
    async review(input, serialized) {
      if (!options.fetchImpl) throw new Error("Network reviewer adapter requires an explicitly supplied fetch implementation");
      const response = await options.fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-reviewer-model": options.model },
        body: JSON.stringify({ schemaVersion: 2, task: input.task, input: JSON.parse(serialized) }),
      });
      if (!response.ok) throw new Error(`Reviewer endpoint returned HTTP ${String(response.status ?? "unknown")}`);
      return response.json();
    },
  };
}

export async function runReviewerRequest(
  input: ReviewerInputV2,
  adapter: ReviewerAdapter,
  options: ReviewerRequestOptions = {},
): Promise<ReviewerRunResult> {
  const cacheMode = options.cacheMode ?? "use";
  const decoderSettings = { ...(options.decoderSettings ?? {}) };
  const key = reviewerCacheKey(input, adapter, decoderSettings);
  if (options.cache && cacheMode === "use") {
    const cached = options.cache.get(key);
    if (cached) return { ...cached, cacheHit: true };
  }
  const started = Date.now();
  const serialized = serializeReviewerInput(input);
  let output: ReviewerOutputV2 | null = null;
  let transportError: string | null = null;
  let validationStatus: ReviewerRunReceipt["validationStatus"] = "unvalidated";
  try {
    const raw = await adapter.review(input, serialized);
    output = parseReviewerOutput(input, raw);
    validationStatus = adapter.endpointCategory === "mock" ? "unvalidated" : "valid";
  } catch (error) {
    transportError = error instanceof Error ? error.message : String(error);
    validationStatus = transportError.startsWith("invalid_response:") ? "invalid_response" : "unvalidated";
  }
  const result: ReviewerRunResult = {
    output,
    receipt: {
      schemaVersion: 1,
      reviewerIdentity: adapter.identity,
      reviewerVersion: adapter.version,
      promptFingerprint: options.promptFingerprint ?? adapter.promptFingerprint,
      schemaFingerprint: "reviewer-io-v2",
      inputHash: reviewerInputHash(input),
      cacheMode,
      decoderSettings,
      endpointCategory: adapter.endpointCategory,
      requestedTokens: options.requestedTokens ?? null,
      actualTokens: null,
      elapsedMs: Date.now() - started,
      cost: null,
      transportError,
      responseRef: output ? `review-response:${key}` : null,
      validationStatus,
    },
    cacheHit: false,
  };
  if (options.cache && cacheMode === "use" && !transportError) options.cache.set(key, result);
  return result;
}

export async function runCriticBatch(
  inputs: readonly ReviewerInputV2[],
  adapter: ReviewerAdapter,
  options: ReviewerRequestOptions & { independentRepeats?: number } = {},
): Promise<ReviewerRunResult[]> {
  const repeats = Math.max(1, Math.floor(options.independentRepeats ?? 1));
  const results: ReviewerRunResult[] = [];
  for (const input of inputs) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      results.push(await runReviewerRequest(input, adapter, {
        ...options,
        cacheMode: repeat === 0 ? options.cacheMode : "bypass",
      }));
    }
  }
  return results;
}

export function assertReviewerRequestHasNoEndpointFallback(source: string): void {
  if (/process\.env|Deno\.env|Bun\.env/.test(source)) throw new Error("Reviewer adapter may not use environment endpoint fallback");
}
