import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NORMALIZED_INTAKE_CONTRACT } from "../src/contracts/versions.js";

export const SYNTHETIC_INTAKE = {
  schemaVersion: NORMALIZED_INTAKE_CONTRACT,
  synthetic: true,
  eventType: "message.created",
  appId: "synthetic-app",
  cursor: 1,
  envelopeEventId: "event-1",
  conversationId: "conversation-1",
  messageId: "message-1",
  messageSequence: 1,
  actorId: "actor-1",
  objective: "Synthetic objective",
  receivedAt: "2026-08-26T00:00:00.000Z",
} as const;

export const LEGACY_MAGICCHAT_MESSAGE_CREATED_ENVELOPE = {
  id: "event-delivery-1",
  type: "event",
  data: {
    event: "message.created",
    cursor: 1,
    payload: {
      conversation_id: "conversation-1",
      message: {
        id: "message-1",
        sequence: 1,
        sender: {
          type: "user",
          id: "actor-1",
        },
        body: {
          type: "text",
          content: "Synthetic objective",
        },
        created_at: "2026-08-26T00:00:00.000Z",
      },
    },
  },
} as const;

interface MagicChatMessageCreatedOverrides {
  readonly actorId?: string;
  readonly body?: string;
  readonly conversationId?: string;
  readonly conversationName?: string;
  readonly conversationType?: "app" | "group" | "topic";
  readonly cursor?: number;
  readonly envelopeEventId?: string;
  readonly messageCreatedAt?: string;
  readonly messageId?: string;
  readonly messageSequence?: number;
  readonly replyToMessageId?: string;
}

export function magicChatMessageCreatedEnvelope(overrides: MagicChatMessageCreatedOverrides = {}) {
  const body = overrides.body ?? "Synthetic objective";
  return {
    v: 1,
    id: overrides.envelopeEventId ?? "event-delivery-1",
    kind: "event",
    cursor: overrides.cursor ?? 1,
    event: "message.created",
    payload: {
      conversation: {
        id: overrides.conversationId ?? "conversation-1",
        name: overrides.conversationName ?? "Synthetic App Conversation",
        type: overrides.conversationType ?? "app",
      },
      sender: {
        type: "user",
        id: overrides.actorId ?? "actor-1",
        name: "Synthetic User",
        nickname: "Synthetic User",
        email: "synthetic@example.invalid",
      },
      message: {
        id: overrides.messageId ?? "message-1",
        seq: overrides.messageSequence ?? 1,
        body: {
          type: "text",
          content: body,
        },
        summary: body,
        created_at: overrides.messageCreatedAt ?? "2026-08-26T00:00:00Z",
        ...(overrides.replyToMessageId === undefined ? {} : { reply_to_message_id: overrides.replyToMessageId }),
      },
    },
  } as const;
}

export const MAGICCHAT_MESSAGE_CREATED_ENVELOPE = magicChatMessageCreatedEnvelope();
export const PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE = MAGICCHAT_MESSAGE_CREATED_ENVELOPE;

interface MagicChatMessageSendSuccessOverrides {
  readonly conversationId?: string;
  readonly messageCreatedAt?: string;
  readonly messageId?: string;
  readonly messageSequence?: number;
  readonly responseEnvelopeId?: string;
  readonly senderAppId?: string;
}

export function magicChatMessageSendSuccessResponse(
  requestEnvelopeId: string,
  overrides: MagicChatMessageSendSuccessOverrides = {},
) {
  const prompt = "What decision constraint must the Researcher preserve?";
  return {
    v: 1,
    id: overrides.responseEnvelopeId ?? "response-clarification-1",
    kind: "response",
    reply_to: requestEnvelopeId,
    ok: true,
    payload: {
      conversation: {
        id: overrides.conversationId ?? "conversation-1",
        name: "Synthetic App Conversation",
        type: "app",
      },
      created: true,
      message: {
        id: overrides.messageId ?? "clarification-message-1",
        seq: overrides.messageSequence ?? 2,
        body: { type: "text", content: prompt },
        summary: prompt,
        sender: { id: overrides.senderAppId ?? "synthetic-app", type: "app" },
        created_at: overrides.messageCreatedAt ?? "2026-08-26T00:00:02Z",
      },
    },
  } as const;
}

export function magicChatAckSuccessResponse(
  requestEnvelopeId: string,
  cursor: number,
  responseEnvelopeId = `response-ack-${cursor}`,
) {
  return {
    v: 1,
    id: responseEnvelopeId,
    kind: "response",
    reply_to: requestEnvelopeId,
    ok: true,
    payload: { cursor },
  } as const;
}

export const EXPECTED_INTAKE_AUTHORITY = {
  auditCorrelationId: "corr_5bdf4d0b9c7cf43d8b652a42614e1dbda90870192106a002d5a4ec4663ae89b6",
  auditEventId: "audit_a89f8af426f877ba61c31b2446c38d85619ad4bae804fafb43d8e0c12bb77bed",
  boardId: "board_dcd6a646142077c99ec0d7e9ebd037a96b28dc91ee96a459f19d0fe446ee56ca",
  caseId: "case_ed9412d89c54f8e029c2fd99f4d726a48003db6d63c0d334c7a8dbb012517bc5",
  payloadDigest: "65e13d98a5fb87fe94c77c09cb160b87e9ced2bcb821fedaa7ed87afeeded6b4",
  receiptId: "receipt_1d463319242dbeab9df2cb0f8487ad75704e609b178b19b76e34b5d7b98b7b68",
  workflowRunId: "run_d3da30a0f60b3aff55b9aa13a0b3dafcd5d09109c7fa0d368ec5cb10ae74bcf7",
} as const;

export interface TemporaryDatabase {
  readonly directory: string;
  readonly path: string;
  readonly cleanup: () => void;
}

export function temporaryDatabase(label: string): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), `accord-${label}-`));
  return {
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    path: join(directory, "authority.sqlite"),
  };
}
