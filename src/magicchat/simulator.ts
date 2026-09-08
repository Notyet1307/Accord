import { createHash } from "node:crypto";

import {
  MAGICCHAT_MAX_SEQUENCE,
  normalizeMagicChatEnvelope,
  normalizeMagicChatMessageBodyForSend,
  parseCanonicalInstant,
  type MagicChatMessageBody,
  type MagicChatMessageSendPayload,
  type MagicChatMessagesListPayload,
  type MagicChatWireMessage,
} from "../contracts/magicchat.js";
import type {
  MagicChatAckRequest,
  MagicChatMessageSendRequest,
  MagicChatMessagesListRequest,
  MagicChatRequestEnvelope,
} from "./adapter.js";

export interface DeterministicMagicChatSimulatorOptions {
  readonly appId: string;
  readonly firstMessageSequence?: number;
}

export interface SimulatedMagicChatMessageResponse<Body extends MagicChatMessageBody = MagicChatMessageBody> {
  readonly v: 1;
  readonly id: string;
  readonly kind: "response";
  readonly reply_to: string;
  readonly ok: true;
  readonly payload: Omit<MagicChatMessageSendPayload, "message"> & {
    readonly message: Omit<MagicChatWireMessage, "body"> & { readonly body: Body };
  };
}

export interface SimulatedMagicChatAckResponse {
  readonly v: 1;
  readonly id: string;
  readonly kind: "response";
  readonly reply_to: string;
  readonly ok: true;
  readonly payload: { readonly cursor: number };
}

export interface SimulatedMagicChatMessagesListResponse {
  readonly v: 1;
  readonly id: string;
  readonly kind: "response";
  readonly reply_to: string;
  readonly ok: true;
  readonly payload: MagicChatMessagesListPayload;
}

export type SimulatedMagicChatResponse =
  | SimulatedMagicChatMessageResponse
  | SimulatedMagicChatAckResponse
  | SimulatedMagicChatMessagesListResponse;

interface RecordedSimulation {
  readonly requestFingerprint: string;
  readonly response: SimulatedMagicChatResponse;
  readonly expiresAt: number;
}

function parseFirstMessageSequence(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("firstMessageSequence must be a positive safe integer");
  }
  return value;
}

function parseAppId(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 160 || value.trim() !== value ||
    /[\p{White_Space}\p{Cc}]/u.test(value)
  ) {
    throw new TypeError("appId must be a non-whitespace stable identifier of at most 160 characters");
  }
  return value;
}

/**
 * In-memory, no-network synthetic peer, not real MagicChat qualification.
 * Models the pinned ten-minute RPC cache (including reads), durable send dedup,
 * bounded latest-page history ordering, and stored body normalization.
 * Goldmark display-summary rendering and cache capacity eviction are not modeled.
 */
export class DeterministicMagicChatSimulator {
  readonly #recordedByRequestId = new Map<string, RecordedSimulation>();
  readonly #sentByClientMessageId = new Map<string, SimulatedMagicChatMessageResponse>();
  readonly #messagesByConversation = new Map<string, MagicChatWireMessage[]>();
  readonly #acknowledgedCursors: number[] = [];
  readonly #appId: string;
  #nextMessageSequence: number;
  #visibleMessageCount = 0;

  public constructor(options: DeterministicMagicChatSimulatorOptions) {
    this.#appId = parseAppId(options.appId);
    this.#nextMessageSequence = parseFirstMessageSequence(options.firstMessageSequence);
  }

  public get visibleMessageCount(): number {
    return this.#visibleMessageCount;
  }

  public get acknowledgedCursors(): readonly number[] {
    return Object.freeze([...this.#acknowledgedCursors]);
  }

  /** Adds an actual user message to visibility; a choice response never does this. */
  public observeUserMessage(envelope: unknown): void {
    const message = normalizeMagicChatEnvelope(envelope);
    if (message.kind !== "MESSAGE_CREATED") throw new TypeError("visible user input must be message.created");
    const messages = this.#messagesByConversation.get(message.conversationId) ?? [];
    const visible: MagicChatWireMessage = Object.freeze({
      id: message.messageId,
      seq: message.messageSequence,
      body: Object.freeze({ type: "text", content: message.body }),
      created_at: message.messageCreatedAt,
      summary: message.body,
      sender: Object.freeze({ id: message.actorId, type: "user", name: "Synthetic User", nickname: "Synthetic User" }),
    });
    const existing = messages.find((item) => item.id === visible.id || item.seq === visible.seq);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(visible)) throw new Error("visible message identity conflict");
      return;
    }
    messages.push(visible);
    messages.sort((left, right) => left.seq - right.seq);
    this.#messagesByConversation.set(message.conversationId, messages);
    this.#nextMessageSequence = Math.max(this.#nextMessageSequence, message.messageSequence + 1);
    this.#visibleMessageCount += 1;
  }

  public respond<Body extends MagicChatMessageBody>(
    request: MagicChatMessageSendRequest<Body>, respondedAt: unknown,
  ): SimulatedMagicChatMessageResponse<Body>;
  public respond(request: MagicChatAckRequest, respondedAt: unknown): SimulatedMagicChatAckResponse;
  public respond(request: MagicChatMessagesListRequest, respondedAt: unknown): SimulatedMagicChatMessagesListResponse;
  public respond(request: MagicChatRequestEnvelope, respondedAt: unknown): SimulatedMagicChatResponse;
  public respond(request: MagicChatRequestEnvelope, respondedAt: unknown): SimulatedMagicChatResponse {
    const canonicalRespondedAt = parseCanonicalInstant(respondedAt, "simulated response time");
    const now = Date.parse(canonicalRespondedAt);
    const requestFingerprint = createHash("sha256")
      .update(request.method).update("\0").update(JSON.stringify(request.payload)).digest("hex");
    const recorded = this.#recordedByRequestId.get(request.id);
    if (recorded !== undefined && now < recorded.expiresAt) {
      if (recorded.requestFingerprint !== requestFingerprint) {
        throw new Error(`request_id_conflict: request Envelope ID ${request.id} was reused with different content`);
      }
      return recorded.response;
    }
    // The backend re-executes reads after its cache TTL; request identity is not perpetual read idempotence.
    const response = request.method === "message.send"
      ? this.#respondToMessageSend(request, canonicalRespondedAt)
      : request.method === "conversation.messages.list"
        ? this.#respondToMessagesList(request)
        : this.#respondToAck(request);
    this.#recordedByRequestId.set(request.id, Object.freeze({ requestFingerprint, response, expiresAt: now + 600_000 }));
    return response;
  }

  #respondToMessageSend(request: MagicChatMessageSendRequest, respondedAt: string): SimulatedMagicChatMessageResponse {
    const body = normalizeMagicChatMessageBodyForSend(request.payload.message);
    const conversationId = request.payload.target.conversation_id;
    const clientMessageKey = JSON.stringify([conversationId, request.id]);
    const previous = this.#sentByClientMessageId.get(clientMessageKey);
    if (previous !== undefined) {
      // Durable dedup returns the stored body, even if the retry submitted different bytes after cache expiry.
      return Object.freeze({ ...previous, payload: Object.freeze({ ...previous.payload, created: false }) });
    }
    if (!Number.isSafeInteger(this.#nextMessageSequence)) throw new RangeError("simulated message sequence is exhausted");
    // Deliberately synthetic display metadata; no claim to reproduce Goldmark's Markdown summary rendering.
    const summary = body.type === "markdown"
      ? "Synthetic Markdown artifact"
      : body.type === "choice"
        ? `[选择] ${body.content_type === "markdown" ? "Synthetic Markdown choice" : body.content}`
        : body.content;
    const message = Object.freeze({
      body,
      created_at: respondedAt,
      id: `simulated-message-${createHash("sha256").update(clientMessageKey).digest("hex")}`,
      sender: Object.freeze({ id: this.#appId, type: "app" as const, name: "", nickname: "" }),
      seq: this.#nextMessageSequence,
      summary,
    });
    const response: SimulatedMagicChatMessageResponse = Object.freeze({
      id: `simulated-response-${createHash("sha256").update(request.id).digest("hex")}`,
      kind: "response",
      ok: true,
      payload: Object.freeze({
        conversation: Object.freeze({ id: conversationId, name: "Simulated App Conversation", type: "app" }),
        created: true,
        message,
      }),
      reply_to: request.id,
      v: 1,
    });
    const messages = this.#messagesByConversation.get(conversationId) ?? [];
    messages.push(message);
    this.#messagesByConversation.set(conversationId, messages);
    this.#sentByClientMessageId.set(clientMessageKey, response);
    this.#nextMessageSequence += 1;
    this.#visibleMessageCount += 1;
    return response;
  }

  #respondToMessagesList(request: MagicChatMessagesListRequest): SimulatedMagicChatMessagesListResponse {
    const { before_or_equal_seq: upperBound, conversation_id: conversationId } = request.payload;
    if (!Number.isSafeInteger(upperBound) || upperBound < 1 || upperBound > MAGICCHAT_MAX_SEQUENCE) {
      throw new TypeError("before_or_equal_seq must be a positive safe integer");
    }
    if (!Number.isSafeInteger(request.payload.limit)) throw new TypeError("messages limit must be an integer");
    const limit = request.payload.limit <= 0 ? 30 : Math.min(request.payload.limit, 100);
    const messages = (this.#messagesByConversation.get(conversationId) ?? [])
      .filter((message) => message.seq <= upperBound).slice(-limit);
    return Object.freeze({
      id: `simulated-response-${createHash("sha256").update(request.id).digest("hex")}`,
      kind: "response",
      ok: true,
      payload: Object.freeze({ limit, messages: Object.freeze(messages) }),
      reply_to: request.id,
      v: 1,
    });
  }

  #respondToAck(request: MagicChatAckRequest): SimulatedMagicChatAckResponse {
    const cursor = request.payload.cursor;
    if (!Number.isSafeInteger(cursor) || cursor < 1) throw new TypeError("ACK cursor must be a positive safe integer");
    const previousCursor = this.#acknowledgedCursors.at(-1);
    if (previousCursor === undefined || cursor > previousCursor) this.#acknowledgedCursors.push(cursor);
    return Object.freeze({
      id: `simulated-response-${createHash("sha256").update(request.id).digest("hex")}`,
      kind: "response",
      ok: true,
      payload: Object.freeze({ cursor }),
      reply_to: request.id,
      v: 1,
    });
  }
}
