export const MAGICCHAT_SOURCE_COMMIT = "29dfa1c85377e69c3810e28b76a3f5580c3e198d" as const;
export const MAGICCHAT_APP_WEBSOCKET_CONTRACT =
  `magicchat.app-websocket/${MAGICCHAT_SOURCE_COMMIT}/v1` as const;
export const MAGICCHAT_PROTOCOL_VERSION = 1 as const;

// The pinned backend accepts positive int64 bounds; this is the largest exact JS number.
export const MAGICCHAT_MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

export interface MagicChatChoiceBody {
  readonly type: "choice";
  readonly content_type: "text" | "markdown";
  readonly content: string;
  readonly selection: "single";
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

export type MagicChatMessageBody =
  | { readonly type: "text" | "markdown"; readonly content: string }
  | MagicChatChoiceBody;

export interface NormalizedMagicChatChoiceResponseCreated {
  readonly contractVersion: typeof MAGICCHAT_APP_WEBSOCKET_CONTRACT;
  readonly sourceCommit: typeof MAGICCHAT_SOURCE_COMMIT;
  readonly kind: "CHOICE_RESPONSE_CREATED";
  readonly envelopeEventId: string;
  readonly cursor: number;
  readonly conversationId: string;
  readonly messageId: string;
  readonly messageSequence: number;
  readonly messageCreatedAt: string;
  readonly choiceBody: MagicChatChoiceBody;
  readonly responseId: string;
  readonly optionIds: readonly string[];
  readonly actorId: string;
  readonly responseCreatedAt: string;
}

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

export type NormalizedMagicChatEnvelope =
  | NormalizedMagicChatMessageCreated
  | NormalizedMagicChatChoiceResponseCreated
  | NormalizedMagicChatResponse;

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

function trimMagicChatText(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

export function parseMagicChatChoiceBody(value: unknown): MagicChatChoiceBody {
  const body = asRecord(value, "choice body");
  requireExactObjectKeys(body, ["type", "content_type", "content", "selection", "options"], "choice body");
  if (
    body["type"] !== "choice" || body["selection"] !== "single" ||
    (body["content_type"] !== "text" && body["content_type"] !== "markdown")
  ) {
    throw new TypeError("choice body must contain a single-choice text or Markdown card");
  }
  const content = body["content"];
  if (typeof content !== "string" || !content || trimMagicChatText(content) !== content || [...content].length > 5_000) {
    throw new TypeError("choice content must be trimmed text of between 1 and 5000 Unicode characters");
  }
  if (!Array.isArray(body["options"]) || body["options"].length < 2 || body["options"].length > 20) {
    throw new TypeError("choice options must contain between 2 and 20 options");
  }
  const ids = new Set<string>();
  const options = body["options"].map((value: unknown) => {
    const option = asRecord(value, "choice option");
    requireExactObjectKeys(option, ["id", "label"], "choice option");
    const id = option["id"];
    const label = option["label"];
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(id) || ids.has(id)) {
      throw new TypeError("choice option IDs must be unique ASCII identifiers of between 1 and 64 characters");
    }
    if (
      typeof label !== "string" || !label || trimMagicChatText(label) !== label || [...label].length > 200 ||
      /[\p{Cc}\u2028\u2029]/u.test(label)
    ) {
      throw new TypeError("choice option label must be trimmed, control-free text of between 1 and 200 characters");
    }
    ids.add(id);
    return Object.freeze({ id, label });
  });
  return Object.freeze({
    type: "choice",
    content_type: body["content_type"],
    content,
    selection: "single",
    options: Object.freeze(options),
  });
}

function normalizeChoiceResponse(envelope: Readonly<Record<string, unknown>>): NormalizedMagicChatChoiceResponseCreated {
  const payload = asRecord(envelope["payload"], "choice.response_created payload");
  requireExactObjectKeys(payload, ["choice_message", "conversation", "response", "sender"], "choice.response_created payload");
  const card = asRecord(payload["choice_message"], "choice message");
  requireExactObjectKeys(card, ["body", "created_at", "id", "seq", "summary"], "choice message");
  const conversation = asRecord(payload["conversation"], "choice conversation");
  requireObjectKeys(conversation, ["id", "name", "type"], ["parent", "source_message"], "choice conversation");
  parseWireString(conversation["name"], "choice conversation name");
  if (conversation["type"] !== "app" && conversation["type"] !== "group" && conversation["type"] !== "topic") {
    throw new TypeError("choice conversation type must be app, group, or topic");
  }
  if (conversation["parent"] !== undefined) {
    const parent = asRecord(conversation["parent"], "choice parent conversation");
    requireExactObjectKeys(parent, ["id", "name", "type"], "choice parent conversation");
    parseStableIdentifier(parent["id"], "choice parent conversation ID");
    parseWireString(parent["name"], "choice parent conversation name");
    parseStableIdentifier(parent["type"], "choice parent conversation type");
  }
  if (conversation["source_message"] !== undefined) {
    const source = asRecord(conversation["source_message"], "choice source message");
    requireExactObjectKeys(source, ["id", "seq"], "choice source message");
    parseStableIdentifier(source["id"], "choice source message ID");
    parsePositiveInteger(source["seq"], "choice source message sequence");
  }
  const sender = asRecord(payload["sender"], "choice sender");
  requireObjectKeys(sender, ["id", "name", "nickname", "type"], ["email"], "choice sender");
  parseWireString(sender["name"], "choice sender name");
  parseWireString(sender["nickname"], "choice sender nickname");
  if (sender["email"] !== undefined) parseWireString(sender["email"], "choice sender email");
  if (sender["type"] !== "user") throw new TypeError("choice sender must be a user");
  const response = asRecord(payload["response"], "choice response");
  requireExactObjectKeys(response, ["created_at", "id", "option_ids"], "choice response");
  const choiceBody = parseMagicChatChoiceBody(card["body"]);
  const optionIds = response["option_ids"];
  if (
    !Array.isArray(optionIds) || optionIds.length !== 1 ||
    typeof optionIds[0] !== "string" || !choiceBody.options.some((option) => option.id === optionIds[0])
  ) {
    throw new TypeError("single-choice response must select exactly one defined option");
  }
  const summary = card["summary"];
  if (typeof summary !== "string" || [...summary].length > 5_005) {
    throw new TypeError("choice summary must be bounded protocol text");
  }
  const messageCreatedAt = parseMagicChatInstant(card["created_at"], "choice message created_at");
  const responseCreatedAt = parseMagicChatInstant(response["created_at"], "choice response created_at");
  const messageInstant = String(card["created_at"]).slice(0, -1).split(".");
  const responseInstant = String(response["created_at"]).slice(0, -1).split(".");
  const messageNanoseconds = `${messageInstant[0]}.${(messageInstant[1] ?? "").padEnd(9, "0")}`;
  const responseNanoseconds = `${responseInstant[0]}.${(responseInstant[1] ?? "").padEnd(9, "0")}`;
  if (responseNanoseconds < messageNanoseconds) {
    throw new TypeError("choice response cannot precede its choice message");
  }
  return Object.freeze({
    contractVersion: MAGICCHAT_APP_WEBSOCKET_CONTRACT,
    sourceCommit: MAGICCHAT_SOURCE_COMMIT,
    kind: "CHOICE_RESPONSE_CREATED",
    envelopeEventId: parseStableIdentifier(envelope["id"], "envelope Event ID"),
    cursor: parsePositiveInteger(envelope["cursor"], "cursor"),
    conversationId: parseStableIdentifier(conversation["id"], "conversation ID"),
    messageId: parseStableIdentifier(card["id"], "choice message ID"),
    messageSequence: parsePositiveInteger(card["seq"], "choice message sequence"),
    messageCreatedAt,
    choiceBody,
    responseId: parseStableIdentifier(response["id"], "choice response ID"),
    optionIds: Object.freeze([optionIds[0]]),
    actorId: parseStableIdentifier(sender["id"], "choice actor ID"),
    responseCreatedAt,
  });
}

export interface MagicChatWireMessage {
  readonly id: string;
  readonly seq: number;
  readonly body?: MagicChatMessageBody;
  readonly created_at: string;
  readonly summary: string;
  readonly sender: {
    readonly id: string;
    readonly name: string;
    readonly nickname: string;
    readonly type: "app" | "user";
    readonly email?: string;
  };
}

export interface MagicChatMessageSendPayload {
  readonly conversation: { readonly id: string; readonly name: string; readonly type: "app" | "group" | "topic" };
  readonly created: boolean;
  readonly message: MagicChatWireMessage & { readonly body: MagicChatMessageBody };
}

export interface MagicChatMessagesListPayload {
  readonly limit: number;
  readonly messages: readonly MagicChatWireMessage[];
}

export function parseMagicChatMessageBody(value: unknown): MagicChatMessageBody {
  const body = asRecord(value, "message body");
  if (body["type"] === "choice") return parseMagicChatChoiceBody(body);
  requireExactObjectKeys(body, ["type", "content"], "message body");
  const content = body["content"];
  if (
    (body["type"] !== "text" && body["type"] !== "markdown") ||
    typeof content !== "string" || !trimMagicChatText(content) || [...trimMagicChatText(content)].length > 5_000
  ) {
    throw new TypeError("message body must contain text or Markdown of between 1 and 5000 Unicode characters");
  }
  return Object.freeze({ type: body["type"], content });
}

function parseWireMessage(value: unknown): MagicChatWireMessage {
  const message = asRecord(value, "MagicChat message");
  requireObjectKeys(message, ["id", "seq", "created_at", "summary", "sender"], ["body"], "MagicChat message");
  const sender = asRecord(message["sender"], "MagicChat message sender");
  requireObjectKeys(sender, ["id", "name", "nickname", "type"], ["email"], "MagicChat message sender");
  if (sender["type"] !== "user" && sender["type"] !== "app") {
    throw new TypeError("MagicChat message sender type must be app or user");
  }
  const summary = message["summary"];
  if (typeof summary !== "string" || [...summary].length > 5_005) {
    throw new TypeError("MagicChat message summary must be bounded protocol text");
  }
  return Object.freeze({
    id: parseStableIdentifier(message["id"], "MagicChat message ID"),
    seq: parsePositiveInteger(message["seq"], "MagicChat message sequence"),
    created_at: parseMagicChatInstant(message["created_at"], "MagicChat message created_at"),
    summary,
    ...(message["body"] === undefined ? {} : { body: parseMagicChatMessageBody(message["body"]) }),
    sender: Object.freeze({
      id: parseStableIdentifier(sender["id"], "MagicChat sender ID"),
      name: parseWireString(sender["name"], "MagicChat sender name"),
      nickname: parseWireString(sender["nickname"], "MagicChat sender nickname"),
      type: sender["type"],
      ...(sender["email"] === undefined ? {} : { email: parseWireString(sender["email"], "MagicChat sender email") }),
    }),
  });
}

/** Mirrors Go strings.TrimSpace and the pinned text/Markdown Normalize handlers. */
export function normalizeMagicChatMessageBodyForSend(value: unknown): MagicChatMessageBody {
  const body = parseMagicChatMessageBody(value);
  const content = trimMagicChatText(body.content);
  if (!content || [...content].length > 5_000) {
    throw new TypeError("MagicChat normalized content must contain between 1 and 5000 Unicode characters");
  }
  return Object.freeze({ ...body, content });
}

export function parseMagicChatMessageSendPayload(value: unknown): MagicChatMessageSendPayload {
  const payload = asRecord(value, "MagicChat message.send payload");
  requireExactObjectKeys(payload, ["conversation", "created", "message"], "MagicChat message.send payload");
  const conversation = asRecord(payload["conversation"], "MagicChat sent conversation");
  requireObjectKeys(conversation, ["id", "name", "type"], ["created_by_app_id"], "MagicChat sent conversation");
  if (conversation["created_by_app_id"] !== undefined) {
    parseStableIdentifier(conversation["created_by_app_id"], "MagicChat conversation creator");
  }
  if (conversation["type"] !== "app" && conversation["type"] !== "group" && conversation["type"] !== "topic") {
    throw new TypeError("MagicChat sent conversation type is unsupported");
  }
  if (typeof payload["created"] !== "boolean") throw new TypeError("MagicChat message created must be a boolean");
  const message = parseWireMessage(payload["message"]);
  if (message.body === undefined) throw new TypeError("MagicChat message.send must confirm a message body");
  return Object.freeze({
    conversation: Object.freeze({
      id: parseStableIdentifier(conversation["id"], "MagicChat sent conversation ID"),
      name: parseWireString(conversation["name"], "MagicChat sent conversation name"),
      type: conversation["type"],
    }),
    created: payload["created"],
    message: Object.freeze({ ...message, body: message.body }),
  });
}

export function parseMagicChatMessagesListPayload(value: unknown): MagicChatMessagesListPayload {
  const payload = asRecord(value, "MagicChat conversation.messages.list payload");
  requireExactObjectKeys(payload, ["limit", "messages"], "MagicChat conversation.messages.list payload");
  const limit = parsePositiveInteger(payload["limit"], "MagicChat messages limit");
  if (limit > 100 || !Array.isArray(payload["messages"]) || payload["messages"].length > limit) {
    throw new TypeError("MagicChat messages page exceeds its bounded limit");
  }
  const messages = payload["messages"].map((message: unknown) => parseWireMessage(message));
  let previousSequence = 0;
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.seq <= previousSequence || ids.has(message.id)) {
      throw new TypeError("MagicChat messages must have unique IDs and strictly ascending sequences");
    }
    previousSequence = message.seq;
    ids.add(message.id);
  }
  return Object.freeze({ limit, messages: Object.freeze(messages) });
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
  if (envelope["event"] === "choice.response_created") {
    return normalizeChoiceResponse(envelope);
  }
  if (envelope["event"] !== "message.created") {
    throw new TypeError("MagicChat reliable event must be message.created or choice.response_created");
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
