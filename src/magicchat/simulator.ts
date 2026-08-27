import { createHash } from "node:crypto";

import { parseCanonicalInstant } from "../contracts/magicchat.js";
import type {
  MagicChatAckRequest,
  MagicChatMessageSendRequest,
  MagicChatRequestEnvelope,
} from "./adapter.js";

export interface DeterministicMagicChatSimulatorOptions {
  readonly appId: string;
  readonly firstMessageSequence?: number;
}

export interface SimulatedMagicChatMessageResponse {
  readonly v: 1;
  readonly id: string;
  readonly kind: "response";
  readonly reply_to: string;
  readonly ok: true;
  readonly payload: {
    readonly conversation: {
      readonly id: string;
      readonly name: string;
      readonly type: "app";
    };
    readonly created: true;
    readonly message: {
      readonly id: string;
      readonly seq: number;
      readonly body: {
        readonly type: "text";
        readonly content: string;
      };
      readonly summary: string;
      readonly sender: {
        readonly id: string;
        readonly type: "app";
      };
      readonly created_at: string;
    };
  };
}

export interface SimulatedMagicChatAckResponse {
  readonly v: 1;
  readonly id: string;
  readonly kind: "response";
  readonly reply_to: string;
  readonly ok: true;
  readonly payload: {
    readonly cursor: number;
  };
}

export type SimulatedMagicChatResponse = SimulatedMagicChatMessageResponse | SimulatedMagicChatAckResponse;

interface RecordedSimulation {
  readonly requestFingerprint: string;
  readonly response: SimulatedMagicChatResponse;
}

function parseFirstMessageSequence(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
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

function fingerprintRequest(request: MagicChatRequestEnvelope): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function simulatedMessageId(requestEnvelopeId: string): string {
  return `simulated-message-${createHash("sha256").update(requestEnvelopeId, "utf8").digest("hex")}`;
}

function simulatedResponseId(requestEnvelopeId: string): string {
  return `simulated-response-${createHash("sha256").update(requestEnvelopeId, "utf8").digest("hex")}`;
}

function isMessageSendRequest(request: MagicChatRequestEnvelope): request is MagicChatMessageSendRequest {
  return "method" in request && request.method === "message.send";
}

/**
 * A deliberately in-memory, no-network peer for protocol conformance tests.
 * It models idempotent request handling and cumulative ACK ordering, but it is
 * not evidence of a real MagicChat resource or primary-seam behavior.
 */
export class DeterministicMagicChatSimulator {
  readonly #recordedByRequestId = new Map<string, RecordedSimulation>();
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

  public respond(request: MagicChatRequestEnvelope, respondedAt: unknown): SimulatedMagicChatResponse {
    const requestFingerprint = fingerprintRequest(request);
    const recorded = this.#recordedByRequestId.get(request.id);
    if (recorded !== undefined) {
      if (recorded.requestFingerprint !== requestFingerprint) {
        throw new Error(`request Envelope ID ${request.id} was reused with different content`);
      }
      return recorded.response;
    }

    const canonicalRespondedAt = parseCanonicalInstant(respondedAt, "simulated response time");
    const response = isMessageSendRequest(request)
      ? this.#respondToMessageSend(request, canonicalRespondedAt)
      : this.#respondToAck(request);
    this.#recordedByRequestId.set(request.id, Object.freeze({ requestFingerprint, response }));
    return response;
  }

  #respondToMessageSend(
    request: MagicChatMessageSendRequest,
    respondedAt: string,
  ): SimulatedMagicChatMessageResponse {
    if (!Number.isSafeInteger(this.#nextMessageSequence)) {
      throw new RangeError("simulated message sequence is exhausted");
    }
    const response = Object.freeze({
      id: simulatedResponseId(request.id),
      kind: "response" as const,
      ok: true as const,
      payload: Object.freeze({
        conversation: Object.freeze({
          id: request.payload.target.conversation_id,
          name: "Simulated App Conversation",
          type: "app" as const,
        }),
        created: true as const,
        message: Object.freeze({
          body: request.payload.message,
          created_at: respondedAt,
          id: simulatedMessageId(request.id),
          sender: Object.freeze({ id: this.#appId, type: "app" as const }),
          seq: this.#nextMessageSequence,
          summary: request.payload.message.content,
        }),
      }),
      reply_to: request.id,
      v: 1 as const,
    });
    this.#nextMessageSequence += 1;
    this.#visibleMessageCount += 1;
    return response;
  }

  #respondToAck(
    request: MagicChatAckRequest,
  ): SimulatedMagicChatAckResponse {
    const cursor = request.payload.cursor;
    const previousCursor = this.#acknowledgedCursors.at(-1);
    if (previousCursor !== undefined && cursor <= previousCursor) {
      throw new Error(`cumulative ACK cursor ${cursor} must be greater than confirmed cursor ${previousCursor}`);
    }
    const response = Object.freeze({
      id: simulatedResponseId(request.id),
      kind: "response" as const,
      ok: true as const,
      payload: Object.freeze({ cursor }),
      reply_to: request.id,
      v: 1 as const,
    });
    this.#acknowledgedCursors.push(cursor);
    return response;
  }
}
