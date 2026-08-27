import type {
  BoardEntryId,
  BoardId,
  CaseId,
  InboxReceiptId,
  PendingActionId,
  WaitChallengeId,
  WorkflowRunId,
} from "../core/ids.js";
import type { AuthorityDatabase } from "../persistence/sqlite-authority.js";

export interface MagicChatMessageSendRequest {
  readonly v: 1;
  readonly id: string;
  readonly kind: "request";
  readonly method: "message.send";
  readonly payload: {
    readonly target: {
      readonly type: "conversation";
      readonly conversation_id: string;
    };
    readonly message: {
      readonly type: "text";
      readonly content: string;
    };
  };
}

export interface MagicChatAckRequest {
  readonly v: 1;
  readonly id: string;
  readonly kind: "request";
  readonly method: "events.ack";
  readonly payload: {
    readonly cursor: number;
  };
}

export type MagicChatRequestEnvelope = MagicChatMessageSendRequest | MagicChatAckRequest;

export interface MagicChatPendingRequest {
  readonly cursor: number;
  readonly request: MagicChatRequestEnvelope;
}

export interface MagicChatQuestionSnapshot {
  readonly questionId: BoardEntryId;
  readonly entryType: "Question";
  readonly payload: {
    readonly expectedInputContract: "accord.clarification-answer/plain-text/v1";
    readonly missingInformation: "decision_constraint";
    readonly prompt: "What decision constraint must the Researcher preserve?";
  };
}

export interface MagicChatChallengeSnapshot {
  readonly challengeId: WaitChallengeId;
  readonly version: 1;
  readonly state: "ACTIVE" | "RESUMED" | "EXPIRED";
  readonly expectedConversationId: string;
  readonly expectedActorId: string;
  readonly expectedInputContract: "accord.clarification-answer/plain-text/v1";
  readonly sourceCursor: number;
  readonly sourceMessageId: string;
  readonly clarificationActionId: PendingActionId;
  readonly clarificationMessageId?: string;
  readonly clarificationMessageSequence?: number;
  readonly expiresAt: string;
}

export type MagicChatWorkflowState =
  | "INTAKE"
  | "WAIT_FOR_INPUT"
  | "RESEARCHER"
  | "ANALYST"
  | "REVIEWER"
  | "WRITER"
  | "WAIT_FOR_APPROVAL"
  | "FRESHNESS_CHECK"
  | "PUBLISH"
  | "PUBLICATION_HOLD"
  | "COMPLETE"
  | "FAILED"
  | "REJECTED";

export interface MagicChatProtocolSnapshot {
  readonly appId: string;
  readonly cursor: number;
  readonly receiptId: InboxReceiptId;
  readonly caseId: CaseId;
  readonly boardId: BoardId;
  readonly workflowRunId: WorkflowRunId;
  readonly phase: "CLARIFICATION_PENDING" | "WAIT_FOR_INPUT" | "UNMATCHED_INPUT" | "EXPIRED_INPUT" | "RESEARCHER";
  readonly workflowState: MagicChatWorkflowState;
  readonly workflowRevision: number;
  readonly boardRevision: number;
  readonly ackState: "NONE" | "ACK_INTENT" | "ACK_CONFIRMED";
  readonly question: MagicChatQuestionSnapshot;
  readonly challenge: MagicChatChallengeSnapshot;
}

export interface MagicChatProtocolResult {
  readonly outcome: "CREATED" | "REPLAYED" | "CONFIRMED";
  readonly snapshot: MagicChatProtocolSnapshot;
  readonly nextRequest?: MagicChatRequestEnvelope;
}

function parseAppId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    /[\p{White_Space}\p{Cc}]/u.test(value)
  ) {
    throw new TypeError("appId must be a non-whitespace stable identifier of at most 160 characters");
  }
  return value;
}

export class MagicChatProtocolAdapter {
  readonly #authority: AuthorityDatabase;
  readonly #appId: string;

  public constructor(authority: AuthorityDatabase, appId: unknown) {
    this.#authority = authority;
    this.#appId = parseAppId(appId);
  }

  public receive(envelope: unknown, receivedAt: unknown): MagicChatProtocolResult {
    return this.#authority.processMagicChatEnvelope(this.#appId, envelope, receivedAt);
  }

  public inspect(cursor: unknown): MagicChatProtocolSnapshot | undefined {
    return this.#authority.inspectMagicChatProtocol(this.#appId, cursor);
  }

  public pendingRequests(): readonly MagicChatPendingRequest[] {
    return this.#authority.inspectPendingMagicChatRequests(this.#appId);
  }
}
