export const MAGICCHAT_SOURCE_COMMIT = "29dfa1c85377e69c3810e28b76a3f5580c3e198d" as const;
export const MAGICCHAT_APP_WEBSOCKET_CONTRACT =
  `magicchat.app-websocket/${MAGICCHAT_SOURCE_COMMIT}/v1` as const;
export const MAGICCHAT_PROTOCOL_VERSION = 1 as const;

export interface NormalizedMagicChatMessageCreated {
  readonly contractVersion: typeof MAGICCHAT_APP_WEBSOCKET_CONTRACT;
  readonly sourceCommit: typeof MAGICCHAT_SOURCE_COMMIT;
  readonly kind: "MESSAGE_CREATED";
  readonly envelopeEventId: string;
  readonly cursor: number;
  readonly conversationId: string;
  readonly messageId: string;
  readonly messageSequence: number;
  readonly replyToMessageId?: string;
  readonly actorId: string;
  readonly body: string;
  readonly messageCreatedAt: string;
}

interface NormalizedMagicChatResponseBase {
  readonly contractVersion: typeof MAGICCHAT_APP_WEBSOCKET_CONTRACT;
  readonly sourceCommit: typeof MAGICCHAT_SOURCE_COMMIT;
  readonly kind: "RESPONSE";
  readonly responseEnvelopeId: string;
  readonly requestEnvelopeId: string;
}

export interface NormalizedMagicChatSuccessResponse extends NormalizedMagicChatResponseBase {
  readonly ok: true;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NormalizedMagicChatErrorResponse extends NormalizedMagicChatResponseBase {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type NormalizedMagicChatResponse =
  | NormalizedMagicChatSuccessResponse
  | NormalizedMagicChatErrorResponse;

export type NormalizedMagicChatEnvelope = NormalizedMagicChatMessageCreated | NormalizedMagicChatResponse;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactObjectKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} keys must be exactly ${sortedExpected.join(", ")}`);
  }
}

function requireObjectKeys(
  value: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const unexpected = actualKeys.find((key) => !allowedKeys.has(key));
  const missing = requiredKeys.find((key) => !Object.hasOwn(value, key));
  if (unexpected !== undefined || missing !== undefined) {
    throw new TypeError(
      `${label} must contain ${requiredKeys.join(", ")} and only optional ${optionalKeys.join(", ") || "fields"}`,
    );
  }
}

function parseWireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 4_096 || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must be protocol text of at most 4096 characters`);
  }
  return value;
}

function parseStableIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    /[\p{White_Space}\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a non-whitespace stable identifier of at most 160 characters`);
  }
  return value;
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function parseCanonicalInstant(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical UTC ISO-8601 instant`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${label} must be a valid canonical UTC ISO-8601 instant`);
  }
  return value;
}

export function parseMagicChatInstant(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a MagicChat UTC RFC3339 instant`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be a valid MagicChat UTC RFC3339 instant`);
  }
  const normalized = new Date(milliseconds).toISOString();
  if (normalized.slice(0, 19) !== value.slice(0, 19)) {
    throw new TypeError(`${label} must be a valid MagicChat UTC RFC3339 instant`);
  }
  return normalized;
}

function parseChoiceFreeText(value: unknown): string {
  const body = asRecord(value, "message body");
  requireExactObjectKeys(body, ["type", "content"], "message body");
  if (body["type"] !== "text" || typeof body["content"] !== "string") {
    throw new TypeError("message body must contain choice-free text");
  }
  const normalized = body["content"].normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized.length < 1 || normalized.length > 4_096) {
    throw new TypeError("choice-free text must contain between 1 and 4096 normalized characters");
  }
  return normalized;
}

export function normalizeMagicChatEnvelope(value: unknown): NormalizedMagicChatEnvelope {
  const envelope = asRecord(value, "MagicChat App WebSocket envelope");
  if (envelope["v"] !== MAGICCHAT_PROTOCOL_VERSION) {
    throw new TypeError(`MagicChat protocol version must be ${MAGICCHAT_PROTOCOL_VERSION}`);
  }
  if (envelope["kind"] === "response") {
    const responseBase = {
      contractVersion: MAGICCHAT_APP_WEBSOCKET_CONTRACT,
      kind: "RESPONSE" as const,
      requestEnvelopeId: parseStableIdentifier(envelope["reply_to"], "request Envelope ID"),
      responseEnvelopeId: parseStableIdentifier(envelope["id"], "response Envelope ID"),
      sourceCommit: MAGICCHAT_SOURCE_COMMIT,
    };
    if (envelope["ok"] === true) {
      requireExactObjectKeys(
        envelope,
        ["v", "id", "kind", "reply_to", "ok", "payload"],
        "MagicChat success response",
      );
      return Object.freeze({
        ...responseBase,
        ok: true,
        payload: Object.freeze({ ...asRecord(envelope["payload"], "MagicChat response payload") }),
      });
    }
    if (envelope["ok"] === false) {
      requireExactObjectKeys(
        envelope,
        ["v", "id", "kind", "reply_to", "ok", "error"],
        "MagicChat error response",
      );
      const error = asRecord(envelope["error"], "MagicChat response error");
      requireExactObjectKeys(error, ["code", "message"], "MagicChat response error");
      const message = error["message"];
      if (typeof message !== "string" || message.length < 1 || message.length > 4_096 || message.trim() !== message) {
        throw new TypeError("MagicChat response error message must be non-empty, trimmed text of at most 4096 characters");
      }
      return Object.freeze({
        ...responseBase,
        error: Object.freeze({
          code: parseStableIdentifier(error["code"], "MagicChat response error code"),
          message,
        }),
        ok: false,
      });
    }
    throw new TypeError("MagicChat response ok must be a boolean");
  }
  if (envelope["kind"] !== "event") {
    throw new TypeError("MagicChat input must be an event or response envelope");
  }
  requireExactObjectKeys(
    envelope,
    ["v", "id", "kind", "cursor", "event", "payload"],
    "MagicChat reliable event",
  );
  if (envelope["event"] !== "message.created") {
    throw new TypeError("MagicChat reliable event must be message.created");
  }
  const payload = asRecord(envelope["payload"], "message.created payload");
  const conversation = asRecord(payload["conversation"], "message.created conversation");
  const message = asRecord(payload["message"], "message.created message");
  const sender = asRecord(payload["sender"], "message sender");
  requireExactObjectKeys(payload, ["conversation", "message", "sender"], "message.created payload");
  requireObjectKeys(
    conversation,
    ["id", "name", "type"],
    ["created_by_app_id", "parent", "source_message"],
    "message.created conversation",
  );
  requireObjectKeys(
    message,
    ["body", "created_at", "id", "seq", "summary"],
    ["reply_to_message_id"],
    "message.created message",
  );
  requireObjectKeys(sender, ["id", "name", "nickname", "type"], ["email"], "message sender");
  parseWireString(conversation["name"], "conversation name");
  if (conversation["type"] !== "app" && conversation["type"] !== "group" && conversation["type"] !== "topic") {
    throw new TypeError("message.created conversation type must be app, group, or topic");
  }
  if (conversation["created_by_app_id"] !== undefined) {
    parseStableIdentifier(conversation["created_by_app_id"], "conversation created_by_app_id");
  }
  if (conversation["parent"] !== undefined) {
    const parent = asRecord(conversation["parent"], "message.created parent conversation");
    requireExactObjectKeys(parent, ["id", "name", "type"], "message.created parent conversation");
    parseStableIdentifier(parent["id"], "parent conversation ID");
    parseWireString(parent["name"], "parent conversation name");
    parseStableIdentifier(parent["type"], "parent conversation type");
  }
  if (conversation["source_message"] !== undefined) {
    const source = asRecord(conversation["source_message"], "message.created source message");
    requireExactObjectKeys(source, ["id", "seq"], "message.created source message");
    parseStableIdentifier(source["id"], "source message ID");
    parsePositiveInteger(source["seq"], "source message sequence");
  }
  parseWireString(message["summary"], "message summary");
  const replyToMessageId =
    message["reply_to_message_id"] === undefined
      ? undefined
      : parseStableIdentifier(message["reply_to_message_id"], "reply-to message ID");
  parseWireString(sender["name"], "sender name");
  parseWireString(sender["nickname"], "sender nickname");
  if (sender["email"] !== undefined) {
    parseWireString(sender["email"], "sender email");
  }
  if (sender["type"] !== "user") {
    throw new TypeError("message.created sender must be a user");
  }

  return Object.freeze({
    contractVersion: MAGICCHAT_APP_WEBSOCKET_CONTRACT,
    sourceCommit: MAGICCHAT_SOURCE_COMMIT,
    kind: "MESSAGE_CREATED",
    envelopeEventId: parseStableIdentifier(envelope["id"], "envelope Event ID"),
    cursor: parsePositiveInteger(envelope["cursor"], "cursor"),
    conversationId: parseStableIdentifier(conversation["id"], "conversation ID"),
    messageId: parseStableIdentifier(message["id"], "message ID"),
    messageSequence: parsePositiveInteger(message["seq"], "message sequence"),
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    actorId: parseStableIdentifier(sender["id"], "actor ID"),
    body: parseChoiceFreeText(message["body"]),
    messageCreatedAt: parseMagicChatInstant(message["created_at"], "message created_at"),
  });
}
