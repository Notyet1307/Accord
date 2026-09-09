import { normalizeMagicChatEnvelope, parseMagicChatMessageBody } from "../contracts/magicchat.js";
import type { MagicChatRequestEnvelope } from "../magicchat/adapter.js";

export const MAGICCHAT_TRANSPORT_VERSION = "accord.magicchat-websocket-transport/v1";
export const MAGICCHAT_FRAME_MAX_BYTES = 1_048_576;
export const MAGICCHAT_QUEUE_MAX_BYTES = 4_194_304;
export const MAGICCHAT_QUEUE_MAX_ENVELOPES = 64;
export interface MagicChatSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  send(data: string, callback: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
}
export interface SocketOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly handshakeTimeout: number;
  readonly closeTimeout: number;
  readonly maxPayload: number;
  readonly perMessageDeflate: false;
  readonly followRedirects: false;
  readonly autoPong: true;
  readonly rejectUnauthorized: true;
  readonly skipUTF8Validation: false;
}
export type SocketFactory = (url: string, options: SocketOptions) => MagicChatSocket;
export interface MagicChatTransportConfig { readonly url: string; readonly appId: string; readonly credential: string; }
export interface MagicChatTransport {
  /** Submits synchronously; resolves only after a correlated response passes the receiver. */
  send(request: MagicChatRequestEnvelope): Promise<void>;
  close(): void;
  readonly closed: Promise<string>;
}

function fail(code: string): never { throw new Error(code); }
function configUrl(config: MagicChatTransportConfig): string {
  let url: URL;
  try { url = new URL(config.url); } catch { return fail("MAGICCHAT_ENDPOINT_INVALID"); }
  if (url.href !== config.url || url.protocol !== "wss:" || url.pathname !== "/api/app/ws" || url.username || url.password || url.search || url.hash) fail("MAGICCHAT_ENDPOINT_INVALID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(config.appId)) fail("MAGICCHAT_APP_INVALID");
  if (typeof config.credential !== "string" || config.credential.length === 0 || config.credential.length > 4096 || /[\p{White_Space}\p{Cc}]/u.test(config.credential)) fail("MAGICCHAT_CREDENTIAL_INVALID");
  return url.href;
}
function requestBytes(request: MagicChatRequestEnvelope): string {
  if (request.v !== 1 || request.kind !== "request" || typeof request.id !== "string" || request.id.length === 0 || request.id.length > 512 || /[\p{White_Space}\p{Cc}]/u.test(request.id)) fail("MAGICCHAT_REQUEST_INVALID");
  exactKeys(request, ["v", "kind", "id", "method", "payload"]);
  if (request.method === "message.send") {
    exactKeys(request.payload, ["target", "message"]);
    exactKeys(request.payload.target, ["type", "conversation_id"]);
    if (request.payload.target.type !== "conversation") fail("MAGICCHAT_REQUEST_INVALID");
    stableId(request.payload.target.conversation_id);
    parseMagicChatMessageBody(request.payload.message);
  } else if (request.method === "conversation.messages.list") {
    exactKeys(request.payload, ["conversation_id", "before_or_equal_seq", "limit"]);
    stableId(request.payload.conversation_id);
    if (!Number.isSafeInteger(request.payload.before_or_equal_seq) || request.payload.before_or_equal_seq < 1 || !Number.isSafeInteger(request.payload.limit) || request.payload.limit < 1 || request.payload.limit > 100) fail("MAGICCHAT_REQUEST_INVALID");
  } else {
    exactKeys(request.payload, ["cursor"]);
    if (request.method !== "events.ack" || !Number.isSafeInteger(request.payload.cursor) || request.payload.cursor < 1) fail("MAGICCHAT_REQUEST_INVALID");
  }
  const bytes = JSON.stringify(request);
  if (Buffer.byteLength(bytes) > MAGICCHAT_FRAME_MAX_BYTES) fail("MAGICCHAT_REQUEST_TOO_LARGE");
  return bytes;
}
function stableId(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\p{White_Space}\p{Cc}]/u.test(value)) fail("MAGICCHAT_REQUEST_INVALID");
}
function exactKeys(value: object, keys: string[]): void {
  if (value === null || typeof value !== "object" || Object.keys(value).sort().join(",") !== keys.sort().join(",")) fail("MAGICCHAT_REQUEST_INVALID");
}

/** No I/O on module import. The optional factory is the offline conformance seam. */
export async function connectMagicChatTransport(
  config: MagicChatTransportConfig,
  receive: (envelope: unknown) => void | Promise<void>,
  factory?: SocketFactory,
): Promise<MagicChatTransport> {
  const url = configUrl(config);
  const credential = config.credential;
  const options: SocketOptions = Object.freeze({
    headers: Object.freeze({ "X-MagicChat-App-ID": config.appId, Authorization: `Bearer ${credential}` }),
    handshakeTimeout: 10_000, closeTimeout: 5_000, maxPayload: MAGICCHAT_FRAME_MAX_BYTES,
    perMessageDeflate: false, followRedirects: false, autoPong: true, rejectUnauthorized: true, skipUTF8Validation: false,
  });
  let socket: MagicChatSocket;
  try {
    // Import only on explicit live construction, so offline tests cannot acquire network modules.
    if (factory !== undefined) socket = factory(url, options);
    else { const { default: WebSocketClient } = await import("ws"); socket = new WebSocketClient(url, options); }
  } catch { return fail("MAGICCHAT_CONNECT_FAILED"); }

  let stopped = false;
  let opened = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveOpen: (value: MagicChatTransport) => void = () => undefined;
  let rejectOpen: (error: Error) => void = () => undefined;
  let resolveClosed: (code: string) => void = () => undefined;
  const closed = new Promise<string>((resolve) => { resolveClosed = resolve; });
  const ready = new Promise<MagicChatTransport>((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const seenResponses = new Set<string>();
  const queue: { value: unknown; bytes: number; replyTo?: string }[] = [];
  let bufferedBytes = 0;
  let bufferedCount = 0;
  let draining = false;

  const stop = (code: string): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(handshakeTimer);
    if (!opened) rejectOpen(new Error(code));
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(code)); }
    pending.clear();
    queue.length = 0;
    resolveClosed(code);
    closeTimer = setTimeout(() => { try { socket.terminate(); } catch { /* owned socket only */ } }, 5_000);
    try { socket.close(); } catch { try { socket.terminate(); } catch { /* closed socket */ } }
  };
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (!stopped) {
        const next = queue.shift();
        if (next === undefined) break;
        try { await receive(next.value); } catch { stop("MAGICCHAT_RECEIVER_FAILED"); break; }
        bufferedBytes -= next.bytes;
        bufferedCount -= 1;
        if (!stopped && next.replyTo !== undefined) {
          const request = pending.get(next.replyTo);
          if (request !== undefined) { clearTimeout(request.timer); pending.delete(next.replyTo); request.resolve(); }
          seenResponses.delete(next.replyTo);
        }
      }
    } finally { draining = false; }
  };
  const transport: MagicChatTransport = Object.freeze({
    closed,
    close: () => stop("MAGICCHAT_CLOSED"),
    send(request: MagicChatRequestEnvelope): Promise<void> {
      if (stopped || !opened || socket.readyState !== 1 || socket.bufferedAmount !== 0) fail("MAGICCHAT_NOT_READY");
      let bytes: string;
      try { bytes = requestBytes(request); } catch { return fail("MAGICCHAT_REQUEST_INVALID"); }
      if (bytes.includes(JSON.stringify(credential).slice(1, -1))) fail("MAGICCHAT_CREDENTIAL_REFLECTION");
      if (pending.has(request.id)) fail("MAGICCHAT_REQUEST_PENDING");
      if (pending.size >= MAGICCHAT_QUEUE_MAX_ENVELOPES) fail("MAGICCHAT_PENDING_LIMIT");
      const id = request.id;
      const response = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => stop("MAGICCHAT_RPC_TIMEOUT"), 30_000);
        pending.set(id, { resolve, reject, timer });
      });
      try { socket.send(bytes, (error) => { if (error !== undefined) stop("MAGICCHAT_SEND_FAILED"); }); }
      catch { stop("MAGICCHAT_SEND_FAILED"); }
      return response;
    },
  });
  socket.on("open", () => { if (stopped) return; opened = true; clearTimeout(handshakeTimer); resolveOpen(transport); });
  socket.on("error", () => stop("MAGICCHAT_SOCKET_FAILED"));
  socket.on("unexpected-response", () => stop("MAGICCHAT_HANDSHAKE_REJECTED"));
  socket.on("close", () => { stop("MAGICCHAT_CONNECTION_CLOSED"); clearTimeout(closeTimer); });
  socket.on("message", (data, binary) => {
    if (stopped) return;
    try {
      if (!opened || binary === true || !(typeof data === "string" || data instanceof Uint8Array)) fail("MAGICCHAT_ENVELOPE_INVALID");
      const size = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
      if (size > MAGICCHAT_FRAME_MAX_BYTES || bufferedBytes + size > MAGICCHAT_QUEUE_MAX_BYTES || bufferedCount + 1 > MAGICCHAT_QUEUE_MAX_ENVELOPES) fail("MAGICCHAT_QUEUE_LIMIT");
      const text = typeof data === "string" ? data : new TextDecoder("utf-8", { fatal: true }).decode(data);
      const value: unknown = JSON.parse(text);
      if (JSON.stringify(value).includes(JSON.stringify(credential).slice(1, -1))) fail("MAGICCHAT_CREDENTIAL_REFLECTION");
      normalizeMagicChatEnvelope(value);
      const envelope = value as Record<string, unknown>;
      let replyTo: string | undefined;
      if (envelope["kind"] === "response") {
        const id = envelope["reply_to"];
        if (typeof id !== "string" || !pending.has(id) || seenResponses.has(id)) fail("MAGICCHAT_RESPONSE_UNMATCHED");
        replyTo = id;
        seenResponses.add(id);
      }
      bufferedBytes += size;
      bufferedCount += 1;
      queue.push({ value, bytes: size, ...(replyTo === undefined ? {} : { replyTo }) });
      void drain();
    } catch { stop("MAGICCHAT_ENVELOPE_REJECTED"); }
  });
  handshakeTimer = setTimeout(() => stop("MAGICCHAT_HANDSHAKE_TIMEOUT"), 10_000);
  return ready;
}
