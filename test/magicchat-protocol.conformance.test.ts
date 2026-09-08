import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MAGICCHAT_MAX_SEQUENCE,
  normalizeMagicChatEnvelope,
  normalizeMagicChatMessageBodyForSend,
  parseMagicChatMessageSendPayload,
  parseMagicChatMessagesListPayload,
} from "../src/contracts/magicchat.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { DeterministicMagicChatSimulator } from "../src/magicchat/simulator.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import {
  EXPECTED_INTAKE_AUTHORITY,
  MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
  magicChatAckSuccessResponse,
  magicChatMessageCreatedEnvelope,
  magicChatMessageSendSuccessResponse,
  temporaryDatabase,
} from "./fixture.js";

test("official error and ambiguous responses leave the durable RPC pending", () => {
  const temporary = temporaryDatabase("magicchat-pinned-error-response");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    const request = created.nextRequest;
    assert.ok(request);

    const officialError = {
      v: 1,
      id: "response-clarification-error",
      kind: "response",
      reply_to: request.id,
      ok: false,
      error: {
        code: "forbidden",
        message: "The synthetic App cannot send this message",
      },
    } as const;
    assert.throws(
      () => protocol.receive(officialError, "2026-08-26T00:00:03.000Z"),
      /failed with forbidden/u,
    );

    assert.throws(
      () =>
        protocol.receive(
          {
            ...officialError,
            id: "response-clarification-ambiguous",
            payload: magicChatMessageSendSuccessResponse(request.id).payload,
          },
          "2026-08-26T00:00:04.000Z",
        ),
      /MagicChat error response keys/u,
    );
    assert.throws(
      () =>
        protocol.receive(
          {
            id: request.id,
            type: "response",
            data: {
              error: { code: "forbidden", message: "synthetic dialect" },
              message: { id: "must-not-confirm" },
            },
          },
          "2026-08-26T00:00:05.000Z",
        ),
      /protocol version/u,
    );

    const pending = protocol.inspect(1);
    assert.ok(pending);
    assert.equal(pending.phase, "CLARIFICATION_PENDING");
    assert.equal(pending.ackState, "NONE");
    const replayed = protocol.receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-after-error-response" },
      "2026-08-26T00:01:00.000Z",
    );
    assert.equal(replayed.outcome, "REPLAYED");
    assert.deepEqual(replayed.nextRequest, request);
    authority.close();
  } finally {
    temporary.cleanup();
  }
});

test("missing input atomically exposes one Question, active challenge, and deterministic clarification request", () => {
  const temporary = temporaryDatabase("magicchat-clarification-intent");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");

    assert.equal(created.outcome, "CREATED");
    assert.equal(created.snapshot.caseId, EXPECTED_INTAKE_AUTHORITY.caseId);
    assert.equal(created.snapshot.boardId, EXPECTED_INTAKE_AUTHORITY.boardId);
    assert.equal(created.snapshot.workflowRunId, EXPECTED_INTAKE_AUTHORITY.workflowRunId);
    assert.equal(created.snapshot.receiptId, EXPECTED_INTAKE_AUTHORITY.receiptId);
    assert.equal(created.snapshot.phase, "CLARIFICATION_PENDING");
    assert.equal(created.snapshot.workflowState, "INTAKE");
    assert.equal(created.snapshot.workflowRevision, 1);
    assert.equal(created.snapshot.boardRevision, 1);
    assert.equal(created.snapshot.ackState, "NONE");
    assert.deepEqual(created.snapshot.question.payload, {
      expectedInputContract: "accord.clarification-answer/plain-text/v1",
      missingInformation: "decision_constraint",
      prompt: "What decision constraint must the Researcher preserve?",
    });
    assert.equal(created.snapshot.question.entryType, "Question");
    assert.equal(created.snapshot.challenge.state, "ACTIVE");
    assert.equal(created.snapshot.challenge.version, 1);
    assert.equal(created.snapshot.challenge.expectedConversationId, "conversation-1");
    assert.equal(created.snapshot.challenge.expectedActorId, "actor-1");
    assert.equal(created.snapshot.challenge.clarificationMessageId, undefined);
    assert.equal(created.snapshot.challenge.expiresAt, "2026-08-27T00:00:01.000Z");
    assert.ok(created.nextRequest);
    assert.match(created.nextRequest.id, /^request_[0-9a-f]{64}$/u);
    assert.deepEqual(created.nextRequest, {
      v: 1,
      id: created.nextRequest.id,
      kind: "request",
      method: "message.send",
      payload: {
        target: {
          type: "conversation",
          conversation_id: "conversation-1",
        },
        message: {
          type: "text",
          content: "What decision constraint must the Researcher preserve?",
        },
      },
    });

    const firstSnapshot = created.snapshot;
    const firstRequest = created.nextRequest;
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const reopenedProtocol = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app");
    assert.deepEqual(reopenedProtocol.inspect(1), firstSnapshot);
    const replayed = reopenedProtocol.receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-delivery-replayed" },
      "2026-08-26T00:05:00.000Z",
    );
    assert.equal(replayed.outcome, "REPLAYED");
    assert.deepEqual(replayed.snapshot, firstSnapshot);
    assert.deepEqual(replayed.nextRequest, firstRequest);
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("clarification confirmation rejects the wrong App before WAIT_FOR_INPUT and then exposes honest ACK intent", () => {
  const temporary = temporaryDatabase("magicchat-clarification-confirmation");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    const clarificationRequest = created.nextRequest;
    assert.ok(clarificationRequest);

    assert.throws(
      () => protocol.receive(
        magicChatMessageSendSuccessResponse(clarificationRequest.id, { senderAppId: "wrong-app" }),
        "2026-08-26T00:00:03.000Z",
      ),
      /wrong App sender/u,
    );
    const rejected = protocol.inspect(1);
    assert.ok(rejected);
    assert.equal(rejected.phase, "CLARIFICATION_PENDING");
    assert.equal(rejected.workflowState, "INTAKE");
    assert.equal(rejected.ackState, "NONE");
    assert.deepEqual(protocol.pendingRequests(), [{ cursor: 1, request: clarificationRequest }]);

    const confirmed = protocol.receive(
      magicChatMessageSendSuccessResponse(clarificationRequest.id),
      "2026-08-26T00:00:04.000Z",
    );

    assert.equal(confirmed.outcome, "CONFIRMED");
    assert.equal(confirmed.snapshot.phase, "WAIT_FOR_INPUT");
    assert.equal(confirmed.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(confirmed.snapshot.workflowRevision, 2);
    assert.equal(confirmed.snapshot.boardRevision, 1);
    assert.equal(confirmed.snapshot.challenge.state, "ACTIVE");
    assert.equal(confirmed.snapshot.challenge.clarificationMessageId, "clarification-message-1");
    assert.equal(confirmed.snapshot.challenge.clarificationMessageSequence, 2);
    assert.equal(confirmed.snapshot.ackState, "ACK_INTENT");
    assert.ok(confirmed.nextRequest);
    assert.notEqual(confirmed.nextRequest.id, clarificationRequest.id);
    assert.match(confirmed.nextRequest.id, /^request_[0-9a-f]{64}$/u);
    assert.deepEqual(confirmed.nextRequest, {
      v: 1,
      id: confirmed.nextRequest.id,
      kind: "request",
      method: "events.ack",
      payload: { cursor: 1 },
    });

    const replayed = protocol.receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-after-message-confirmation" },
      "2026-08-26T00:05:00.000Z",
    );
    assert.equal(replayed.outcome, "REPLAYED");
    assert.equal(replayed.snapshot.phase, "WAIT_FOR_INPUT");
    assert.equal(replayed.snapshot.challenge.clarificationMessageId, "clarification-message-1");
    assert.deepEqual(replayed.nextRequest, confirmed.nextRequest);
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const reopened = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app").receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-after-reconnect" },
      "2026-08-26T00:06:00.000Z",
    );
    assert.equal(reopened.snapshot.phase, "WAIT_FOR_INPUT");
    assert.equal(reopened.snapshot.ackState, "ACK_INTENT");
    assert.deepEqual(reopened.nextRequest, confirmed.nextRequest);
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("a higher cursor is blocked until the lower cursor ACK intent is durably confirmed", () => {
  const temporary = temporaryDatabase("magicchat-cumulative-ack");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);

    const reply = magicChatMessageCreatedEnvelope({
      body: "Preserve a two-week decision window.",
      cursor: 2,
      envelopeEventId: "event-reply-2",
      messageCreatedAt: "2026-08-26T00:01:00Z",
      messageId: "message-reply-2",
      messageSequence: 3,
      replyToMessageId: "clarification-message-1",
    });
    assert.throws(
      () => protocol.receive(reply, "2026-08-26T00:01:01.000Z"),
      /cursor 2 is blocked by incomplete lower cursor 1/u,
    );
    assert.equal(protocol.inspect(2), undefined);

    const acknowledged = protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    assert.equal(acknowledged.outcome, "CONFIRMED");
    assert.equal(acknowledged.snapshot.phase, "WAIT_FOR_INPUT");
    assert.equal(acknowledged.snapshot.ackState, "ACK_CONFIRMED");
    assert.equal(acknowledged.nextRequest, undefined);

    const replayedAck = protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1, "response-ack-1-replayed"),
      "2026-08-26T00:00:05.000Z",
    );
    assert.equal(replayedAck.snapshot.ackState, "ACK_CONFIRMED");
    assert.equal(replayedAck.nextRequest, undefined);
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const reopenedProtocol = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app");
    const durable = reopenedProtocol.receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-after-ack-confirmation" },
      "2026-08-26T00:05:00.000Z",
    );
    assert.equal(durable.snapshot.ackState, "ACK_CONFIRMED");
    assert.equal(durable.nextRequest, undefined);
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("the matching choice-free reply clears the challenge and hands the same Case and Run to RESEARCHER", () => {
  const temporary = temporaryDatabase("magicchat-matching-resume");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    const firstAcknowledged = protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );
    assert.equal(firstAcknowledged.snapshot.ackState, "ACK_CONFIRMED");

    const reply = magicChatMessageCreatedEnvelope({
      body: "Preserve a two-week decision window.",
      cursor: 2,
      envelopeEventId: "event-matching-reply",
      messageCreatedAt: "2026-08-26T00:01:00Z",
      messageId: "message-matching-reply",
      messageSequence: 3,
      replyToMessageId: "clarification-message-1",
    });
    const resumed = protocol.receive(reply, "2026-08-26T00:01:01.000Z");
    assert.equal(resumed.outcome, "CREATED");
    assert.equal(resumed.snapshot.caseId, created.snapshot.caseId);
    assert.equal(resumed.snapshot.boardId, created.snapshot.boardId);
    assert.equal(resumed.snapshot.workflowRunId, created.snapshot.workflowRunId);
    assert.notEqual(resumed.snapshot.receiptId, created.snapshot.receiptId);
    assert.match(resumed.snapshot.receiptId, /^receipt_[0-9a-f]{64}$/u);
    assert.equal(resumed.snapshot.phase, "RESEARCHER");
    assert.equal(resumed.snapshot.workflowState, "RESEARCHER");
    assert.equal(resumed.snapshot.workflowRevision, 3); assert.equal(resumed.snapshot.boardRevision, 2);
    assert.equal(resumed.snapshot.challenge.state, "RESUMED");
    assert.equal(resumed.snapshot.challenge.clarificationMessageId, "clarification-message-1");
    assert.equal(resumed.snapshot.ackState, "ACK_INTENT");
    assert.ok(resumed.nextRequest);
    assert.equal(resumed.nextRequest.method, "events.ack");
    assert.deepEqual(resumed.nextRequest.payload, { cursor: 2 });

    assert.throws(
      () => protocol.receive(magicChatMessageCreatedEnvelope({ body: "Preserve a two-week decision window.", cursor: 2, envelopeEventId: "event-conflicting-reply-to-replay", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "message-matching-reply", messageSequence: 3, replyToMessageId: "different-message" }), "2026-08-26T00:01:02.000Z"),
      /persisted reply-to message ID/u,
    );
    const replayed = protocol.receive(
      { ...reply, id: "event-matching-reply-replayed" },
      "2026-08-26T00:02:00.000Z",
    );
    assert.equal(replayed.outcome, "REPLAYED");
    assert.equal(replayed.snapshot.receiptId, resumed.snapshot.receiptId);
    assert.equal(replayed.snapshot.workflowRunId, created.snapshot.workflowRunId);
    assert.equal(replayed.snapshot.workflowRevision, 3);
    assert.equal(replayed.snapshot.boardRevision, 2);
    assert.deepEqual(replayed.nextRequest, resumed.nextRequest);
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const reopenedProtocol = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app");
    const durable = reopenedProtocol.inspect(2);
    assert.ok(durable);
    assert.equal(durable.phase, "RESEARCHER");
    assert.equal(durable.workflowRunId, created.snapshot.workflowRunId);
    assert.equal(durable.challenge.state, "RESUMED");
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("wrong actor, conversation, and reply-to replies are acknowledged without advancing the wait", () => {
  const temporary = temporaryDatabase("magicchat-unmatched-replies");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );

    const wrongActor = magicChatMessageCreatedEnvelope({
      actorId: "actor-other",
      body: "Attempted answer from the wrong actor.",
      cursor: 2,
      envelopeEventId: "event-wrong-actor",
      messageCreatedAt: "2026-08-26T00:01:00Z",
      messageId: "message-wrong-actor",
      messageSequence: 3,
      replyToMessageId: "clarification-message-1",
    });
    const actorRejected = protocol.receive(wrongActor, "2026-08-26T00:01:01.000Z");
    assert.equal(actorRejected.outcome, "CREATED");
    assert.equal(actorRejected.snapshot.phase, "UNMATCHED_INPUT");
    assert.equal(actorRejected.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(actorRejected.snapshot.workflowRevision, 2);
    assert.equal(actorRejected.snapshot.boardRevision, 1);
    assert.equal(actorRejected.snapshot.challenge.state, "ACTIVE");
    assert.equal(actorRejected.snapshot.ackState, "ACK_INTENT");
    assert.ok(actorRejected.nextRequest);
    assert.equal(actorRejected.nextRequest.method, "events.ack");
    assert.deepEqual(actorRejected.nextRequest.payload, { cursor: 2 });
    const actorAcked = protocol.receive(
      magicChatAckSuccessResponse(actorRejected.nextRequest.id, 2),
      "2026-08-26T00:01:02.000Z",
    );
    assert.equal(actorAcked.snapshot.ackState, "ACK_CONFIRMED");

    const wrongConversation = magicChatMessageCreatedEnvelope({
      body: "Attempted answer from the wrong conversation.",
      conversationId: "conversation-other",
      conversationName: "Other Synthetic Conversation",
      cursor: 3,
      envelopeEventId: "event-wrong-conversation",
      messageCreatedAt: "2026-08-26T00:02:00Z",
      messageId: "message-wrong-conversation",
      messageSequence: 4,
      replyToMessageId: "clarification-message-1",
    });
    const conversationRejected = protocol.receive(wrongConversation, "2026-08-26T00:02:01.000Z");
    assert.equal(conversationRejected.snapshot.phase, "UNMATCHED_INPUT");
    assert.equal(conversationRejected.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(conversationRejected.snapshot.workflowRevision, 2);
    assert.equal(conversationRejected.snapshot.boardRevision, 1);
    assert.equal(conversationRejected.snapshot.challenge.state, "ACTIVE");
    assert.ok(conversationRejected.nextRequest);
    assert.equal(conversationRejected.nextRequest.method, "events.ack");
    assert.deepEqual(conversationRejected.nextRequest.payload, { cursor: 3 });
    protocol.receive(
      magicChatAckSuccessResponse(conversationRejected.nextRequest.id, 3),
      "2026-08-26T00:02:02.000Z",
    );

    const missingReplyTo = protocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "Attempted answer without a reply-to identity.", cursor: 4,
        envelopeEventId: "event-missing-reply-to", messageCreatedAt: "2026-08-26T00:03:00Z",
        messageId: "message-missing-reply-to", messageSequence: 5,
      }),
      "2026-08-26T00:03:01.000Z",
    );
    assert.equal(missingReplyTo.snapshot.phase, "UNMATCHED_INPUT");
    assert.equal(missingReplyTo.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(missingReplyTo.snapshot.challenge.state, "ACTIVE");
    assert.ok(missingReplyTo.nextRequest);
    protocol.receive(magicChatAckSuccessResponse(missingReplyTo.nextRequest.id, 4), "2026-08-26T00:03:02.000Z");

    const differentReplyTo = protocol.receive(
      magicChatMessageCreatedEnvelope({
        body: "Attempted answer to a different message.", cursor: 5,
        envelopeEventId: "event-different-reply-to", messageCreatedAt: "2026-08-26T00:04:00Z",
        messageId: "message-different-reply-to", messageSequence: 6, replyToMessageId: "different-message",
      }),
      "2026-08-26T00:04:01.000Z",
    );
    assert.equal(differentReplyTo.snapshot.phase, "UNMATCHED_INPUT");
    assert.equal(differentReplyTo.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(differentReplyTo.snapshot.challenge.state, "ACTIVE");
    assert.equal(differentReplyTo.snapshot.ackState, "ACK_INTENT");
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const durable = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app").inspect(5);
    assert.ok(durable);
    assert.equal(durable.phase, "UNMATCHED_INPUT");
    assert.equal(durable.workflowState, "WAIT_FOR_INPUT");
    assert.equal(durable.challenge.state, "ACTIVE");
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("an expired matching reply records terminal failure and cannot hand the Run to RESEARCHER", () => {
  const temporary = temporaryDatabase("magicchat-expired-reply");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );

    const expiredReply = magicChatMessageCreatedEnvelope({
      body: "This answer arrived after the challenge expired.",
      cursor: 2,
      envelopeEventId: "event-expired-reply",
      messageCreatedAt: "2026-08-27T00:00:02Z",
      messageId: "message-expired-reply",
      messageSequence: 3,
      replyToMessageId: "clarification-message-1",
    });
    const expired = protocol.receive(expiredReply, "2026-08-27T00:00:03.000Z");
    assert.equal(expired.outcome, "CREATED");
    assert.equal(expired.snapshot.caseId, created.snapshot.caseId);
    assert.equal(expired.snapshot.workflowRunId, created.snapshot.workflowRunId);
    assert.equal(expired.snapshot.phase, "EXPIRED_INPUT");
    assert.equal(expired.snapshot.workflowState, "FAILED");
    assert.equal(expired.snapshot.workflowRevision, 3);
    assert.equal(expired.snapshot.boardRevision, 1);
    assert.equal(expired.snapshot.challenge.state, "EXPIRED");
    assert.equal(expired.snapshot.ackState, "ACK_INTENT");
    assert.ok(expired.nextRequest);
    assert.equal(expired.nextRequest.method, "events.ack");
    assert.deepEqual(expired.nextRequest.payload, { cursor: 2 });
    const acknowledged = protocol.receive(
      magicChatAckSuccessResponse(expired.nextRequest.id, 2),
      "2026-08-27T00:00:04.000Z",
    );
    assert.equal(acknowledged.snapshot.ackState, "ACK_CONFIRMED");
    assert.notEqual(acknowledged.snapshot.workflowState, "RESEARCHER");
    authority.close();

    const reopenedAuthority = openAuthorityDatabase(temporary.path);
    const durable = new MagicChatProtocolAdapter(reopenedAuthority, "synthetic-app").inspect(2);
    assert.ok(durable);
    assert.equal(durable.phase, "EXPIRED_INPUT");
    assert.equal(durable.workflowState, "FAILED");
    assert.equal(durable.challenge.state, "EXPIRED");
    reopenedAuthority.close();
  } finally {
    temporary.cleanup();
  }
});

test("the deterministic simulator observes one visible clarification intent and cumulative ACKs in cursor order", () => {
  const temporary = temporaryDatabase("magicchat-deterministic-simulator");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app", firstMessageSequence: 2 });
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const replayed = protocol.receive(
      { ...MAGICCHAT_MESSAGE_CREATED_ENVELOPE, id: "event-before-simulated-send" },
      "2026-08-26T00:00:02.000Z",
    );
    assert.ok(replayed.nextRequest);
    assert.deepEqual(replayed.nextRequest, created.nextRequest);

    const firstConfirmation = simulator.respond(created.nextRequest, "2026-08-26T00:00:03.000Z");
    const duplicateConfirmation = simulator.respond(replayed.nextRequest, "2026-08-26T00:00:03.000Z");
    assert.deepEqual(duplicateConfirmation, firstConfirmation);
    assert.equal(simulator.visibleMessageCount, 1);
    const waiting = protocol.receive(firstConfirmation, "2026-08-26T00:00:04.000Z");
    assert.ok(waiting.nextRequest);
    const firstAck = simulator.respond(waiting.nextRequest, "2026-08-26T00:00:05.000Z");
    protocol.receive(firstAck, "2026-08-26T00:00:06.000Z");
    assert.deepEqual(simulator.acknowledgedCursors, [1]);

    const reply = magicChatMessageCreatedEnvelope({
      body: "Preserve a two-week decision window.",
      cursor: 2,
      envelopeEventId: "event-simulator-matching-reply",
      messageCreatedAt: "2026-08-26T00:01:00Z",
      messageId: "message-simulator-matching-reply",
      messageSequence: 3,
      replyToMessageId: waiting.snapshot.challenge.clarificationMessageId!,
    });
    const resumed = protocol.receive(reply, "2026-08-26T00:01:01.000Z");
    assert.equal(resumed.snapshot.workflowState, "RESEARCHER");
    assert.ok(resumed.nextRequest);
    const secondAck = simulator.respond(resumed.nextRequest, "2026-08-26T00:01:02.000Z");
    const complete = protocol.receive(secondAck, "2026-08-26T00:01:03.000Z");
    assert.equal(complete.snapshot.ackState, "ACK_CONFIRMED");
    assert.equal(simulator.visibleMessageCount, 1);
    assert.deepEqual(simulator.acknowledgedCursors, [1, 2]);
    authority.close();
  } finally {
    temporary.cleanup();
  }
});

test("a clarification-boundary write failure rolls back the receipt, Case, Run, Board, Question, and action together", () => {
  const temporary = temporaryDatabase("magicchat-atomic-rollback");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const fault = new DatabaseSync(temporary.path);
    fault.exec(`
      CREATE TRIGGER synthetic_question_insert_failure
      BEFORE INSERT ON board_entries
      WHEN NEW.entry_type = 'Question'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic Question insert failure');
      END;
    `);

    assert.throws(
      () => protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z"),
      /synthetic Question insert failure/u,
    );
    assert.equal(protocol.inspect(1), undefined);
    for (const table of [
      "cases",
      "boards",
      "workflow_runs",
      "inbox_receipts",
      "inbox_deliveries",
      "board_entries",
      "pending_side_effects",
      "audit_events",
      "magicchat_inbox_states",
      "wait_challenges",
      "magicchat_rpc_actions",
    ]) {
      const count = fault.prepare(`SELECT count(*) AS count FROM ${table}`).get() as Record<string, unknown>;
      assert.equal(count["count"], 0, `${table} must roll back`);
    }
    fault.exec("DROP TRIGGER synthetic_question_insert_failure");
    fault.close();
    authority.close();

    const reopened = openAuthorityDatabase(temporary.path);
    assert.equal(new MagicChatProtocolAdapter(reopened, "synthetic-app").inspect(1), undefined);
    reopened.close();
  } finally {
    temporary.cleanup();
  }
});

test("an RPC confirmation timestamp cannot precede its durable request intent", () => {
  const temporary = temporaryDatabase("magicchat-response-before-request");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    const clarificationRequest = created.nextRequest;
    assert.ok(clarificationRequest);

    assert.throws(
      () =>
        protocol.receive(
          magicChatMessageSendSuccessResponse(clarificationRequest.id, {
            messageCreatedAt: "2026-08-25T23:59:58Z",
            messageId: "clarification-message-before-request",
          }),
          "2026-08-25T23:59:59.000Z",
        ),
      /confirmation receivedAt cannot precede its durable request intent/u,
    );
    const durable = protocol.inspect(1);
    assert.ok(durable);
    assert.equal(durable.phase, "CLARIFICATION_PENDING");
    assert.equal(durable.workflowState, "INTAKE");
    assert.equal(durable.challenge.clarificationMessageId, undefined);
    authority.close();
  } finally {
    temporary.cleanup();
  }
});

test("a mismatched actor after expiry is audited but cannot clear the actor-bound challenge", () => {
  const temporary = temporaryDatabase("magicchat-expired-wrong-actor");
  try {
    const authority = openAuthorityDatabase(temporary.path);
    const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(MAGICCHAT_MESSAGE_CREATED_ENVELOPE, "2026-08-26T00:00:01.000Z");
    assert.ok(created.nextRequest);
    const waiting = protocol.receive(
      magicChatMessageSendSuccessResponse(created.nextRequest.id),
      "2026-08-26T00:00:03.000Z",
    );
    assert.ok(waiting.nextRequest);
    protocol.receive(
      magicChatAckSuccessResponse(waiting.nextRequest.id, 1),
      "2026-08-26T00:00:04.000Z",
    );

    const wrongActorAfterExpiry = magicChatMessageCreatedEnvelope({
      actorId: "actor-other",
      body: "Late input from the wrong actor.",
      cursor: 2,
      envelopeEventId: "event-expired-wrong-actor",
      messageCreatedAt: "2026-08-27T00:00:02Z",
      messageId: "message-expired-wrong-actor",
      messageSequence: 3,
      replyToMessageId: "clarification-message-1",
    });
    const rejected = protocol.receive(wrongActorAfterExpiry, "2026-08-27T00:00:03.000Z");
    assert.equal(rejected.snapshot.phase, "UNMATCHED_INPUT");
    assert.equal(rejected.snapshot.workflowState, "WAIT_FOR_INPUT");
    assert.equal(rejected.snapshot.challenge.state, "ACTIVE");
    assert.equal(rejected.snapshot.boardRevision, 1);
    assert.ok(rejected.nextRequest);
    assert.equal(rejected.nextRequest.method, "events.ack");
    assert.deepEqual(rejected.nextRequest.payload, { cursor: 2 });
    authority.close();
  } finally {
    temporary.cleanup();
  }
});

test("C3 choice normalization retains real response identity and rejects malformed or backwards source facts", () => {
  const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app" });
  const request = {
    v: 1, id: "choice-request", kind: "request", method: "message.send",
    payload: {
      target: { type: "conversation", conversation_id: "conversation-1" },
      message: {
        type: "choice", content_type: "text", content: "Approve publication?", selection: "single",
        options: [{ id: "approve", label: "Approve" }, { id: "reject", label: "Reject" }],
      },
    },
  } as const;
  const confirmed = simulator.respond(request, "2026-09-08T00:00:00.000Z");
  const { sender: _sender, ...choiceMessage } = confirmed.payload.message;
  const choice = {
    v: 1, id: "choice-delivery", kind: "event", cursor: 1, event: "choice.response_created",
    payload: {
      choice_message: choiceMessage,
      conversation: confirmed.payload.conversation,
      response: { created_at: "2026-09-08T00:00:01Z", id: "choice-response", option_ids: ["approve"] },
      sender: { id: "actor-1", name: "Synthetic User", nickname: "", type: "user" },
    },
  };
  const normalized = normalizeMagicChatEnvelope(choice);
  assert.equal(normalized.kind, "CHOICE_RESPONSE_CREATED");
  if (normalized.kind !== "CHOICE_RESPONSE_CREATED") throw new Error("expected truthful choice response");
  assert.equal(normalized.messageId, confirmed.payload.message.id);
  assert.equal(normalized.messageSequence, confirmed.payload.message.seq);
  assert.equal(normalized.responseId, "choice-response");
  assert.deepEqual(normalized.optionIds, ["approve"]);
  assert.equal(normalized.responseCreatedAt, "2026-09-08T00:00:01.000Z");
  assert.deepEqual(parseMagicChatMessageSendPayload(confirmed.payload), confirmed.payload);
  assert.throws(() => simulator.observeUserMessage(choice), /message.created/u);
  assert.equal(simulator.visibleMessageCount, 1);
  for (const invalid of [
    { ...choice, payload: { ...choice.payload, invented_message: {} } },
    { ...choice, cursor: MAGICCHAT_MAX_SEQUENCE + 1 },
    { ...choice, payload: { ...choice.payload, sender: { ...choice.payload.sender, type: "app" } } },
    ...[[], ["approve", "reject"], ["unknown"]].map((option_ids) => ({
      ...choice, payload: { ...choice.payload, response: { ...choice.payload.response, option_ids } },
    })),
    {
      ...choice, payload: {
        ...choice.payload,
        choice_message: { ...choiceMessage, created_at: "2026-09-08T00:00:00.000000002Z" },
        response: { ...choice.payload.response, created_at: "2026-09-08T00:00:00.000000001Z" },
      },
    },
    {
      ...choice, payload: {
        ...choice.payload, choice_message: {
          ...choiceMessage, body: { ...request.payload.message, options: [{ id: "approve", label: "Approve" }, { id: "approve", label: "Duplicate" }] },
        },
      },
    },
  ]) assert.throws(() => normalizeMagicChatEnvelope(invalid), TypeError);
  for (const [content, expected] of [
    ["\u0085  - Exact Artifact\n", "- Exact Artifact"],
    ["\uFEFF", "\uFEFF"],
    ["\u{10400}".repeat(5_000), "\u{10400}".repeat(5_000)],
  ]) {
    assert.deepEqual(normalizeMagicChatMessageBodyForSend({ type: "markdown", content }), { type: "markdown", content: expected });
  }
  assert.throws(() => normalizeMagicChatMessageBodyForSend({ type: "markdown", content: "\u{10400}".repeat(5_001) }), /5000/u);
});

test("the pinned RPC cache expires for reads while durable send uniqueness retains the original stored body", () => {
  const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app" });
  const list = {
    v: 1, id: "history-request", kind: "request", method: "conversation.messages.list",
    payload: { conversation_id: "conversation-1", before_or_equal_seq: MAGICCHAT_MAX_SEQUENCE, limit: 100 },
  } as const;
  const before = simulator.respond(list, "2026-09-08T00:00:00.000Z");
  assert.deepEqual(before.payload.messages, []);
  simulator.observeUserMessage(MAGICCHAT_MESSAGE_CREATED_ENVELOPE);
  assert.deepEqual(simulator.respond(list, "2026-09-08T00:00:01.000Z"), before);
  assert.equal(simulator.respond({ ...list, id: "fresh-history" }, "2026-09-08T00:00:01.000Z").payload.messages.length, 1);
  assert.equal(simulator.respond(list, "2026-09-08T00:10:00.000Z").payload.messages.length, 1);
  const send = {
    v: 1, id: "publication-request", kind: "request", method: "message.send",
    payload: {
      target: { type: "conversation", conversation_id: "conversation-1" },
      message: { type: "markdown", content: "- Exact Artifact\n" },
    },
  } as const;
  const first = simulator.respond(send, "2026-09-08T00:10:01.000Z");
  assert.equal(first.payload.created, true);
  assert.equal(send.payload.message.content, "- Exact Artifact\n");
  assert.equal(first.payload.message.body.content, "- Exact Artifact");
  assert.equal(first.payload.message.summary, "Synthetic Markdown artifact");
  assert.deepEqual(simulator.respond(send, "2026-09-08T00:10:02.000Z"), first);
  const changed = { ...send, payload: { ...send.payload, message: { type: "markdown", content: "Different bytes" } } } as const;
  assert.throws(() => simulator.respond(changed, "2026-09-08T00:10:02.000Z"), /request_id_conflict/u);
  const reconciled = simulator.respond(changed, "2026-09-08T00:20:01.000Z");
  assert.equal(reconciled.payload.created, false);
  assert.deepEqual(reconciled.payload.message, first.payload.message);
  assert.equal(simulator.visibleMessageCount, 2);
});

test("history selects the latest bounded page and returns ascending unique message sequences", () => {
  const simulator = new DeterministicMagicChatSimulator({ appId: "synthetic-app" });
  for (let sequence = 1; sequence <= 105; sequence += 1) {
    simulator.observeUserMessage(magicChatMessageCreatedEnvelope({
      cursor: sequence, messageSequence: sequence, messageId: `visible-${sequence}`, envelopeEventId: `delivery-${sequence}`,
    }));
  }
  const list = {
    v: 1, id: "latest-history", kind: "request", method: "conversation.messages.list",
    payload: { conversation_id: "conversation-1", before_or_equal_seq: MAGICCHAT_MAX_SEQUENCE, limit: 100 },
  } as const;
  const payload = simulator.respond(list, "2026-09-08T00:00:00.000Z").payload;
  assert.deepEqual(parseMagicChatMessagesListPayload(payload), payload);
  assert.equal(payload.messages.length, 100);
  assert.equal(payload.messages[0]!.seq, 6);
  assert.equal(payload.messages.at(-1)!.seq, 105);
  const bounded = simulator.respond({
    ...list, id: "bounded-history", payload: { ...list.payload, before_or_equal_seq: 50, limit: 3 },
  }, "2026-09-08T00:00:00.000Z");
  assert.deepEqual(bounded.payload.messages.map((message) => message.seq), [48, 49, 50]);
  for (const invalid of [
    { ...payload, messages: [...payload.messages].reverse() },
    { ...payload, messages: [payload.messages[0], payload.messages[0]] },
    { ...payload, limit: 1 },
    { ...payload, conversation_id: "invented-response-field" },
  ]) assert.throws(() => parseMagicChatMessagesListPayload(invalid), TypeError);
  assert.throws(() => simulator.respond({
    ...list, id: "invalid-bound", payload: { ...list.payload, before_or_equal_seq: 0 },
  }, "2026-09-08T00:00:00.000Z"), /positive safe integer/u);
});
