import type { InvocationBoundOutputContract } from "../profile-runtime.js";
import { MAX_PROVIDER_WIRE_CHARACTERS, MAX_PROVIDER_WIRE_UTF8_BYTES, type PreparedProfileInvocation, type ProviderPort } from "../researcher-analyst.js";

export const BAIZHI_CANCELLABLE_TRANSPORT_VERSION = "accord.baizhi-responses-transport/v2";
export const BAIZHI_TRANSPORT_VERSION = "accord.baizhi-responses-transport/v1";
export const BAIZHI_REQUEST_MAX_BYTES = 131_072;
export const BAIZHI_RESPONSE_MAX_BYTES = 1_048_576;
export const BAIZHI_TIMEOUT_MS = 120_000;
export type HttpSender = (url: string, init: RequestInit) => Promise<Response>;
export interface BaizhiConfig {
  readonly transportVersion?: typeof BAIZHI_TRANSPORT_VERSION | typeof BAIZHI_CANCELLABLE_TRANSPORT_VERSION;
  readonly responsesUrl: string;
  readonly deploymentId: string;
  readonly credential: string;
  readonly costLimitCny: null;
}

function fail(code: string): never { throw new Error(code); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("PROVIDER_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.trim() !== value || /[\p{Cc},]/u.test(value)) fail("PROVIDER_IDENTITY_INVALID");
  return value;
}
function endpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return fail("PROVIDER_ENDPOINT_INVALID"); }
  if (url.href !== value || url.protocol !== "https:" || url.hostname !== "ai-api-gateway.app.baizhi.cloud" || url.port !== "" || url.pathname === "/" || url.username || url.password || url.search || url.hash) fail("PROVIDER_ENDPOINT_INVALID");
  return url.href;
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (response.body === null) fail("PROVIDER_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BAIZHI_RESPONSE_MAX_BYTES) fail("PROVIDER_RESPONSE_TOO_LARGE");
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

function mapResponse(body: string, requestId: string | null, prepared: PreparedProfileInvocation, deploymentId: string): string {
  const response = object(JSON.parse(body) as unknown);
  if (response["status"] !== "completed" || (response["error"] !== undefined && response["error"] !== null) || !Array.isArray(response["output"])) fail("PROVIDER_RESPONSE_INVALID");
  if (response["model"] !== prepared.modelId) fail("PROVIDER_MODEL_IDENTITY_MISMATCH");
  const messages: Record<string, unknown>[] = [];
  for (const raw of response["output"]) {
    const item = object(raw);
    if (item["type"] === "reasoning") continue;
    if (item["type"] !== "message" || item["role"] !== "assistant") fail("PROVIDER_RESPONSE_INVALID");
    messages.push(item);
  }
  const message = messages[0];
  if (messages.length !== 1 || message === undefined || !Array.isArray(message["content"]) || message["content"].length !== 1) fail("PROVIDER_RESPONSE_INVALID");
  const content = object(message["content"][0]);
  if (content["type"] !== "output_text" || typeof content["text"] !== "string") fail("PROVIDER_RESPONSE_INVALID");
  const output = object(JSON.parse(content["text"]) as unknown);
  const rawUsage = object(response["usage"]);
  const inputTokens = rawUsage["input_tokens"];
  const outputTokens = rawUsage["output_tokens"];
  const totalTokens = rawUsage["total_tokens"];
  for (const value of [inputTokens, outputTokens, totalTokens]) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("PROVIDER_USAGE_INVALID");
  }
  if (Number(inputTokens) + Number(outputTokens) !== totalTokens || Number(outputTokens) > 8192) fail("PROVIDER_USAGE_INVALID");
  const wire = JSON.stringify({
    providerMetadata: { deploymentId, modelId: prepared.modelId, providerPortVersion: prepared.providerPortVersion, requestId: identity(requestId), responseId: identity(response["id"]) },
    output, receivedAt: new Date().toISOString(), usage: { inputTokens, outputTokens, totalTokens },
  });
  if (wire.length > MAX_PROVIDER_WIRE_CHARACTERS || Buffer.byteLength(wire) > MAX_PROVIDER_WIRE_UTF8_BYTES) fail("PROVIDER_WIRE_TOO_LARGE");
  return wire;
}

/** Call before executePreparedAttempt: construction validates and freezes the complete request. */
export function prepareBaizhiResponsesPort(
  config: BaizhiConfig,
  invocation: PreparedProfileInvocation,
  instructions: string,
  send: HttpSender = (url, init) => globalThis.fetch(url, init),
  outputContract?: InvocationBoundOutputContract,
  signal?: AbortSignal,
): ProviderPort {
  if ((config.transportVersion ?? BAIZHI_TRANSPORT_VERSION) !== (signal === undefined ? BAIZHI_TRANSPORT_VERSION : BAIZHI_CANCELLABLE_TRANSPORT_VERSION)) fail("PROVIDER_TRANSPORT_VERSION_MISMATCH");
  if (signal?.aborted) fail("PROVIDER_ABORTED");
  const responsesUrl = endpoint(config.responsesUrl);
  if (config.costLimitCny !== null) fail("COST_LIMIT_NOT_IMPLEMENTED");
  const deploymentId = identity(config.deploymentId);
  const credential = config.credential;
  if (typeof credential !== "string" || credential.length === 0 || credential.length > 4096 || /[\p{White_Space}\p{Cc}]/u.test(credential)) fail("PROVIDER_CREDENTIAL_INVALID");
  if (typeof instructions !== "string" || instructions.trim().length === 0) fail("PROVIDER_INSTRUCTIONS_INVALID");
  const binding = JSON.stringify(invocation);
  const prepared = JSON.parse(binding) as PreparedProfileInvocation;
  if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") {
    if (outputContract === undefined || outputContract.invocationId !== prepared.invocationId || outputContract.contextDigest !== prepared.contextDigest || outputContract.profile !== prepared.profile || outputContract.profileVersion !== prepared.profileVersion || outputContract.outputSchema !== prepared.outputSchema) fail("PROVIDER_OUTPUT_CONTRACT_MISMATCH");
  } else if (outputContract !== undefined) fail("PROVIDER_OUTPUT_CONTRACT_MISMATCH");
  if (signal !== undefined && (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") && outputContract?.providerInput === undefined) fail("PROVIDER_INPUT_CONTRACT_MISSING");
  const body = JSON.stringify({
    model: prepared.modelId, store: false, stream: false, tools: [], max_output_tokens: 8192,
    instructions, input: JSON.stringify(signal !== undefined && outputContract !== undefined ? { objective: prepared.objective, outputSchema: prepared.outputSchema, context: outputContract.providerInput } : { objective: prepared.objective, outputSchema: prepared.outputSchema, entries: prepared.entries, approvedSources: prepared.approvedSources }),
  });
  if (Buffer.byteLength(body) > BAIZHI_REQUEST_MAX_BYTES) fail("PROVIDER_REQUEST_TOO_LARGE");
  if (body.includes(JSON.stringify(credential).slice(1, -1))) fail("PROVIDER_CREDENTIAL_REFLECTION");
  const safeCodes = new Set(["PROVIDER_RESPONSE_TOO_LARGE", "PROVIDER_RESPONSE_INVALID", "PROVIDER_MODEL_IDENTITY_MISMATCH", "PROVIDER_IDENTITY_INVALID", "PROVIDER_USAGE_INVALID", "PROVIDER_WIRE_TOO_LARGE", "PROVIDER_TIMEOUT", "PROVIDER_ABORTED", "PROVIDER_CREDENTIAL_REFLECTION"]);
  const attempted = new Set<string>();
  return Object.freeze({
    ...(outputContract === undefined ? {} : { outputContract }),
    async complete(request: Parameters<ProviderPort["complete"]>[0]): Promise<string> {
      if (signal?.aborted) fail("PROVIDER_ABORTED");
      if (JSON.stringify(request.invocation) !== binding || request.retry !== "DISABLED" || request.attempt.invocationId !== prepared.invocationId || !request.attempt.noSdkRetry || ![1, 2].includes(request.attempt.attemptNumber)) fail("PROVIDER_INVOCATION_MISMATCH");
      if (attempted.has(request.attempt.attemptId)) fail("PROVIDER_ATTEMPT_ALREADY_SENT");
      attempted.add(request.attempt.attemptId);
      const controller = new AbortController();
      let abort: () => void = () => undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => { controller.abort(); reject(new Error("PROVIDER_ABORTED")); };
        signal?.addEventListener("abort", abort, { once: true });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error("PROVIDER_TIMEOUT")); controller.abort(); }, BAIZHI_TIMEOUT_MS);
      });
      try {
        return await Promise.race([timeout, cancelled, (async () => {
          const response = await send(responsesUrl, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` }, body, signal: controller.signal });
          if (controller.signal.aborted || response.redirected || (response.url !== "" && response.url !== responsesUrl)) {
            void response.body?.cancel().catch(() => undefined);
            fail(controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_RESPONSE_INVALID");
          }
          if (!response.ok) { void response.body?.cancel().catch(() => undefined); fail("PROVIDER_HTTP_ERROR"); }
          const raw = await boundedBody(response, controller.signal);
          const wire = mapResponse(raw, response.headers.get("x-request-id"), prepared, deploymentId);
          if (wire.includes(JSON.stringify(credential).slice(1, -1))) fail("PROVIDER_CREDENTIAL_REFLECTION");
          return wire;
        })()]);
      } catch (error) {
        controller.abort();
        const code = error instanceof Error && safeCodes.has(error.message) ? error.message : "PROVIDER_TRANSPORT_ERROR";
        throw new Error(code);
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    },
  });
}
