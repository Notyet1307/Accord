import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { parseMagicChatMessageSendPayload, parseMagicChatMessagesListPayload } from "./contracts/magicchat.js";
import { CONTRACT_VERSIONS, FIXED_WORKFLOW_DEFINITION, FIXED_WORKFLOW_DEFINITION_ID } from "./contracts/versions.js";
import { parseCaseId, parseInvocationId, type CaseId } from "./core/ids.js";
import { reconstructPreparedProfileInvocation } from "./researcher-analyst.js";
import { parsePersistenceRow, requireHexDigest, requireInteger, requireIsoInstant, requireOneOf, requireString } from "./persistence/rows.js";
import { loadAuthorityMigrations } from "./persistence/migration.js";

export const R003_CASE_TRACE_VERSION = "accord.r003-case-trace/v1" as const;
export const R003_CASE_TRACE_REDACTION_VERSION = "accord.r003-case-trace-redaction/v1" as const;
export const R003_CASE_TRACE_MAX_BYTES = 1_048_576;

type Row = any;

export class CaseTraceError extends Error {
  public constructor(
    public readonly code: "UNKNOWN_CASE" | "INCOMPLETE_AUTHORITY" | "OUTPUT_LIMIT",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CaseTraceError";
  }
}

const BOARD_ENTRY_TYPES = ["ArtifactRef", "Claim", "Critique", "EvidenceRef", "Intent", "Observation", "Proposal", "Question", "VerificationResult"] as const;
const BOARD_ENTRY_STATUSES = ["CANDIDATE", "ACCEPTED", "REJECTED", "SUPERSEDED"] as const;
const BOARD_AUTHORS = ["SYSTEM", "HUMAN", "AGENT"] as const;
const ATTEMPT_STATES = ["READY", "RUNNING", "UNKNOWN", "RESULT_RECEIVED", "WINNER", "DISCARDED"] as const;
const ARRIVAL_OUTCOMES = ["WINNER", "LATE", "STALE", "DUPLICATE", "DIVERGENT", "UNKNOWN", "INVALID"] as const;
const ACTION_KINDS = ["CLARIFICATION", "APPROVAL_REQUEST", "PUBLICATION", "FRESHNESS_READ", "ACK"] as const;
const ACTION_STATES = ["PENDING", "CONFIRMED", "UNKNOWN", "FAILED"] as const;
const WORKFLOW_STATES = ["INTAKE", "WAIT_FOR_INPUT", "RESEARCHER", "ANALYST", "REVIEWER", "WRITER", "WAIT_FOR_APPROVAL", "FRESHNESS_CHECK", "PUBLISH", "PUBLICATION_HOLD", "COMPLETE", "FAILED", "REJECTED"] as const;
const CASE_STATUSES = ["OPEN", "COMPLETE", "FAILED", "REJECTED"] as const;
const PRIVATE_KEYS = /^(?:content|body|prompt|context|history|wire|response|request|confirmation|materialization|output|reasoning|credential|secret|environment|env|payload|details|private|privateContext|apiKey|apiKeyId|accessKey|accessToken|refreshToken|password|token|cookie|authorization|headers|variables|stack|chainOfThought|thoughts)$/iu;
const PERSISTED_JSON_MAX_BYTES = R003_CASE_TRACE_MAX_BYTES;
const PERSISTED_JSON_MAX_DEPTH = 32;
const PERSISTED_JSON_MAX_KEYS = 128;
const PERSISTED_JSON_MAX_ARRAY_ITEMS = 256;

function canonical(value: unknown, depth = 0): unknown {
  if (depth > PERSISTED_JSON_MAX_DEPTH) throw new TypeError("JSON nesting exceeds the projection limit");
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const object = value as Row;
    const keys = Object.keys(object);
    if (keys.length > PERSISTED_JSON_MAX_KEYS) throw new TypeError("JSON object exceeds the projection limit");
    return Object.fromEntries(keys.sort().map((key) => [key, canonical(object[key], depth + 1)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("JSON contains a non-finite number");
  return value;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(canonical(value));
  if (serialized === undefined) throw new TypeError("projection value is not JSON serializable");
  return serialized;
}

function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digestValue(value: unknown): string { return digest(json(value)); }

function rows(database: DatabaseSync, sql: string, ...parameters: (string | number | null)[]): readonly Row[] {
  return database.prepare(sql).all(...parameters) as readonly Row[];
}

function one(database: DatabaseSync, sql: string, ...parameters: (string | number | null)[]): Row | undefined {
  return database.prepare(sql).get(...parameters) as Row | undefined;
}

function fail(message: string): never { throw new CaseTraceError("INCOMPLETE_AUTHORITY", message); }

function text(row: Row, field: string): string { return requireString(row, field); }
function integer(row: Row, field: string): number { return requireInteger(row, field); }
function hex(row: Row, field: string): string { return requireHexDigest(row, field); }
function instant(row: Row, field: string): string { return requireIsoInstant(row, field); }
function nullableText(row: Row, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") throw new TypeError(`${field} must be nullable text`);
  return value;
}
function nullableInstant(row: Row, field: string): string | null {
  const value = nullableText(row, field);
  if (value !== null) requireIsoInstant({ [field]: value }, field);
  return value;
}
function boundedString(value: unknown, label: string, maxBytes = 16_384): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) throw new TypeError(`${label} is not bounded text`);
  return value;
}
function externalString(value: unknown, label: string): string {
  const result = boundedString(value, label, 1_024);
  if (/\p{Cc}/u.test(result)) throw new TypeError(`${label} contains control characters`);
  return result;
}
function id(row: Row, field: string, prefix: string, length: number): string {
  const value = text(row, field);
  if (value.length !== length || !value.startsWith(prefix) || !/^[0-9a-f]+$/u.test(value.slice(prefix.length))) throw new TypeError(`${field} is not a valid ${prefix} identity`);
  return value;
}
function idValue(value: unknown, label: string, prefix: string, length: number): string {
  const result = externalString(value, label);
  if (result.length !== length || !result.startsWith(prefix) || !/^[0-9a-f]+$/u.test(result.slice(prefix.length))) throw new TypeError(`${label} is not a valid ${prefix} identity`);
  return result;
}
function record(value: unknown, label: string): Row { return parsePersistenceRow(value, label); }

function assertJsonTree(value: unknown, label: string, depth = 0): void {
  if (depth > PERSISTED_JSON_MAX_DEPTH) throw new TypeError(`${label} is too deeply nested`);
  if (Array.isArray(value)) {
    if (value.length > PERSISTED_JSON_MAX_ARRAY_ITEMS) throw new TypeError(`${label} has too many array items`);
    value.forEach((item, index) => assertJsonTree(item, `${label}[${index}]`, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Row;
    if (Object.keys(object).length > PERSISTED_JSON_MAX_KEYS) throw new TypeError(`${label} has too many fields`);
    for (const [key, item] of Object.entries(object)) assertJsonTree(item, `${label}.${key}`, depth + 1);
  }
}

function parsed(row: Row, field: string): unknown {
  const raw = text(row, field);
  if (Buffer.byteLength(raw, "utf8") > PERSISTED_JSON_MAX_BYTES) throw new TypeError(`${field} exceeds the projection limit`);
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch (error) { throw new TypeError(`${field} is not valid JSON`, { cause: error }); }
  assertJsonTree(value, field);
  return value;
}

function objectJson(row: Row, field: string): Row {
  const value = parsed(row, field);
  return record(value, field);
}

function arrayJson(row: Row, field: string): readonly unknown[] {
  const value = parsed(row, field);
  if (!Array.isArray(value)) throw new TypeError(`${field} is not an array`);
  return value;
}

function strings(value: unknown, label: string, maxItems = 128): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(`${label} is not a bounded string array`);
  return value.map((item, index) => externalString(item, `${label}[${index}]`));
}

function boundedRecord(value: unknown, label: string): Row {
  const result = record(value, label);
  if (Object.keys(result).length > 32) throw new TypeError(`${label} has too many fields`);
  return result;
}

function optionalString(source: Row, key: string, label = key, maxBytes = 16_384): string | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  return boundedString(source[key], label, maxBytes);
}

function optionalInteger(source: Row, key: string, label = key): number | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError(`${label} is not an integer`);
  return value;
}

function optionalBoolean(source: Row, key: string, label = key): boolean | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  if (typeof source[key] !== "boolean") throw new TypeError(`${label} is not a boolean`);
  return source[key];
}

function typedLink(value: unknown, label: string): Row {
  const source = boundedRecord(value, label);
  const entryId = idValue(source["entryId"], `${label}.entryId`, "entry_", 70);
  const type = externalString(source["type"], `${label}.type`);
  const entryDigest = source["digest"];
  if (typeof entryDigest !== "string" || !/^[0-9a-f]{64}$/u.test(entryDigest)) throw new TypeError(`${label}.digest is invalid`);
  return { entryId, type, digest: entryDigest };
}

function materialAssertions(value: unknown, label: string): readonly Row[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError(`${label} is not a bounded array`);
  return value.map((item, index) => {
    const assertion = boundedRecord(item, `${label}[${index}]`);
    const basis = boundedRecord(assertion["basis"], `${label}[${index}].basis`);
    const ordinal = optionalInteger(assertion, "ordinal", `${label}[${index}].ordinal`);
    const kind = optionalString(basis, "kind", `${label}[${index}].basis.kind`, 128);
    const entryId = idValue(basis["entryId"], `${label}[${index}].basis.entryId`, "entry_", 70);
    const contentDigest = basis["contentDigest"];
    if (typeof ordinal !== "number" || ordinal < 1 || typeof kind !== "string" || typeof contentDigest !== "string" || !/^[0-9a-f]{64}$/u.test(contentDigest)) throw new TypeError(`${label}[${index}] is invalid`);
    return { ordinal, basis: { kind, entryId, contentDigest } };
  });
}

function typedBoardPayload(entryType: string, value: unknown): Row {
  const source = boundedRecord(value, `${entryType} payload`);
  const result: Row = {};
  const putString = (key: string, maxBytes = 16_384): void => { const value = optionalString(source, key, `${entryType}.${key}`, maxBytes); if (value !== undefined) result[key] = value; };
  switch (entryType) {
    case "Question": putString("expectedInputContract"); putString("missingInformation"); putString("prompt"); break;
    case "Observation": putString("answer"); putString("expectedInputContract"); putString("sourceMessageId", 1_024); { const sequence = optionalInteger(source, "sourceMessageSequence"); if (sequence !== undefined) result.sourceMessageSequence = sequence; } putString("statement"); break;
    case "Intent": putString("objective"); putString("scope"); break;
    case "EvidenceRef": putString("locator"); putString("observedAt", 128); putString("sourceDigest", 128); putString("sourceId", 128); putString("sourceKind"); break;
    case "Claim": putString("statement"); { const unsupported = optionalBoolean(source, "unsupported"); if (unsupported !== undefined) result.unsupported = unsupported; } break;
    case "Proposal": putString("action"); putString("supportStatus", 128); break;
    case "Critique": if (Object.hasOwn(source, "target")) result.target = typedLink(source.target, `${entryType}.target`); putString("issue", 256); putString("severity", 128); putString("disposition", 128); break;
    case "VerificationResult": if (Object.hasOwn(source, "target")) result.target = typedLink(source.target, `${entryType}.target`); putString("method", 256); putString("result", 128); if (Object.hasOwn(source, "supportingEvidenceRefs")) result.supportingEvidenceRefs = strings(source.supportingEvidenceRefs, `${entryType}.supportingEvidenceRefs`); putString("disposition", 128); break;
    case "ArtifactRef": putString("artifactId", 128); { const revision = optionalInteger(source, "artifactRevision"); if (revision !== undefined) result.artifactRevision = revision; } putString("artifactDigest", 128); putString("contentDigest", 128); putString("manifestDigest", 128); if (Object.hasOwn(source, "materialAssertions")) result.materialAssertions = materialAssertions(source.materialAssertions, `${entryType}.materialAssertions`); putString("reviewerHandoffId", 128); break;
    default: throw new CaseTraceError("INCOMPLETE_AUTHORITY", `unsupported Board entry type ${entryType}`);
  }
  if (Object.keys(result).length === 0) throw new TypeError(`${entryType} payload is empty`);
  return result;
}

const AUDIT_SCALAR_KEYS = new Set([
  "actionId", "approvalId", "artifactId", "artifactRevision", "arrivalId", "attemptBudget", "attemptId", "boardEntryId", "boardRevision", "candidateEntryId", "challengeId", "challengeVersion", "claimId", "claimVersion", "confirmedAt", "contextDigest", "contextId", "contractVersion", "correlationId", "createdAt", "decisionDigest", "deliveryId", "deliveryNumber", "entryId", "expiresAt", "firstReceivedAt", "freshnessId", "invalidReason", "invocationId", "manifestDigest", "messageCreatedAt", "messageId", "messageSequence", "modelId", "node", "objectiveDigest", "observedAt", "observedCursor", "option", "outcome", "outputDigest", "outputSchema", "profile", "profileVersion", "providerPortVersion", "rawResponseDigest", "readActionId", "reasonCode", "receiptId", "requestEnvelopeId", "requestDigest", "responseClaimId", "responseId", "resultId", "rpcMethod", "schemaVersion", "sequence", "sourceId", "sourceMessageId", "sourceMessageSequence", "sourceReceiptId", "state", "status", "tokenDigest", "triggerMessageId", "workflowDefinitionId", "workflowDefinitionVersion", "workflowRevision", "workflowRunId",
]);
const AUDIT_ARRAY_KEYS = new Set(["boardEntryIds", "entryIds", "sourceIds"]);

function auditDetails(value: unknown): Row {
  const source = boundedRecord(value, "audit details");
  const result: Row = {};
  for (const key of Object.keys(source).sort()) {
    if (!AUDIT_SCALAR_KEYS.has(key) || PRIVATE_KEYS.test(key)) continue;
    const item = source[key];
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (typeof item === "string" && Buffer.byteLength(item, "utf8") > 1_024) throw new TypeError(`audit ${key} is too long`);
      result[key] = item;
    } else if (AUDIT_ARRAY_KEYS.has(key)) result[key] = strings(item, `audit ${key}`);
  }
  return result;
}

function providerMetadata(value: unknown): Row {
  const source = boundedRecord(value, "provider metadata");
  const result: Row = {};
  for (const key of ["deploymentId", "modelId", "providerPortVersion", "requestId", "responseId"] as const) {
    if (Object.hasOwn(source, key)) result[key] = externalString(source[key], `provider metadata ${key}`);
  }
  return result;
}

function usage(value: unknown): Row {
  const source = boundedRecord(value, "provider usage");
  const result: Row = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) {
    if (!Object.hasOwn(source, key)) throw new TypeError(`provider usage ${key} is missing`);
    result[key] = optionalInteger(source, key, `provider usage ${key}`);
  }
  return result;
}

function permissions(value: unknown): Row {
  const source = boundedRecord(value, "permission summary");
  const expected = ["canCreateApproval", "canMutateEntries", "canPublish", "canSetSystemVerification", "canUseTools", "sourceInstructionAuthority"] as const;
  const result: Row = {};
  for (const key of expected) {
    if (typeof source[key] !== "boolean") throw new TypeError(`permission ${key} is invalid`);
    result[key] = source[key];
  }
  return result;
}

function validateMessageConfirmation(value: unknown): Row {
  const source = boundedRecord(value, "message.send confirmation");
  if (Object.keys(source).sort().join(",") === "conversation_id,created_at,id,sender_app_id,sequence") {
    const messageId = externalString(source["id"], "message confirmation id");
    const conversationId = externalString(source["conversation_id"], "message confirmation conversation");
    const senderAppId = externalString(source["sender_app_id"], "message confirmation sender");
    const sequence = source["sequence"];
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("message confirmation sequence is invalid");
    if (typeof source["created_at"] !== "string") throw new TypeError(`message confirmation createdAt type: ${typeof source["created_at"]}`);
    requireIsoInstant({ created_at: source["created_at"] }, "created_at");
    return { messageId, conversationId, senderAppId, sequence, createdAt: source["created_at"] };
  }
  const parsedPayload = parseMagicChatMessageSendPayload(source);
  return { messageId: parsedPayload.message.id, conversationId: parsedPayload.conversation.id, senderAppId: parsedPayload.message.sender.id, sequence: parsedPayload.message.seq, createdAt: parsedPayload.message.created_at };
}

function validateRpcEnvelope(method: string, value: unknown): void {
  const envelope = boundedRecord(value, `${method} request`);
  const envelopeKeys = Object.keys(envelope).sort().join(",");
  if (envelope["v"] !== 1 || envelope["kind"] !== "request" || envelope["method"] !== method || typeof envelope["id"] !== "string") throw new TypeError(`${method} request envelope is invalid`);
  const payload = boundedRecord(envelope["payload"], `${method} request payload`);
  if (method === "events.ack") {
    if (envelopeKeys !== "id,kind,method,payload,v" || Object.keys(payload).sort().join(",") !== "cursor" || typeof payload["cursor"] !== "number" || !Number.isSafeInteger(payload["cursor"])) throw new TypeError("ACK request envelope is invalid");
  } else if (method === "conversation.messages.list") {
    if (envelopeKeys !== "id,kind,method,payload,v" || Object.keys(payload).sort().join(",") !== "before_or_equal_seq,conversation_id,limit" || typeof payload["conversation_id"] !== "string" || typeof payload["before_or_equal_seq"] !== "number" || typeof payload["limit"] !== "number") throw new TypeError("freshness request envelope is invalid");
  } else if (method === "message.send") {
    if (envelopeKeys !== "id,kind,method,payload,v" || Object.keys(payload).sort().join(",") !== "message,target") throw new TypeError("message request envelope is invalid");
    const target = boundedRecord(payload["target"], "message target");
    if (Object.keys(target).sort().join(",") !== "conversation_id,type" || target["type"] !== "conversation" || typeof target["conversation_id"] !== "string") throw new TypeError("message target is invalid");
    const message = boundedRecord(payload["message"], "message request body");
    if (message["type"] !== "text" && message["type"] !== "markdown" && message["type"] !== "choice") throw new TypeError("message request type is invalid");
    if (message["type"] === "markdown" && typeof message["content"] !== "string") throw new TypeError("markdown request content is invalid");
    if (message["type"] === "choice" && (message["content_type"] !== "text" || message["selection"] !== "single" || !Array.isArray(message["options"]))) throw new TypeError("choice request body is invalid");
  } else throw new TypeError(`unsupported RPC method ${method}`);
}

function ingress(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  return rows(database, `SELECT r.receipt_id, r.schema_version, r.app_id, r.cursor, r.envelope_event_id, r.event_type, r.payload_digest,
      r.source_conversation_id, r.source_message_id, r.source_message_sequence, r.source_actor_id, r.source_response_id,
      r.case_id, r.board_id, r.workflow_run_id, r.processing_status, r.received_at,
      s.receipt_id AS state_receipt_id, s.schema_version AS state_schema_version, s.app_id AS state_app_id, s.cursor AS state_cursor,
      s.case_id AS state_case_id, s.board_id AS state_board_id, s.workflow_run_id AS state_workflow_run_id, s.correlation_id,
      s.event_role, s.normalized_body, s.reply_to_message_id, s.message_created_at, s.event_payload_json,
      s.business_outcome, s.business_stable, s.ack_state, s.ack_action_id, s.created_at AS state_created_at,
      s.stable_at, s.ack_confirmed_at
    FROM inbox_receipts r LEFT JOIN magicchat_inbox_states s ON s.receipt_id = r.receipt_id
    WHERE r.case_id = ? ORDER BY r.cursor, r.receipt_id`, caseId).map((row) => {
      const receiptId = id(row, "receipt_id", "receipt_", 72);
      if (text(row, "schema_version") !== CONTRACT_VERSIONS.inboxReceipt || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Ingress receipt ${receiptId} binding is invalid`);
      const receiptAt = instant(row, "received_at");
      if (row["state_receipt_id"] === null) fail(`Ingress receipt ${receiptId} has no state`);
      if (text(row, "state_receipt_id") !== receiptId || text(row, "state_schema_version") !== CONTRACT_VERSIONS.magicChatInboxState || text(row, "state_app_id") !== text(row, "app_id") || integer(row, "state_cursor") !== integer(row, "cursor") || text(row, "state_case_id") !== caseId || text(row, "state_board_id") !== boardId || text(row, "state_workflow_run_id") !== workflowRunId) fail(`Ingress receipt ${receiptId} state binding is invalid`);
      const payload = row["event_payload_json"] === null ? undefined : objectJson(row, "event_payload_json");
      if (payload !== undefined) {
        if (digestValue(payload) !== hex(row, "payload_digest")) fail(`Ingress receipt ${receiptId} payload digest is invalid`);
        if (payload["cursor"] !== integer(row, "cursor") || payload["conversationId"] !== text(row, "source_conversation_id") || payload["messageId"] !== text(row, "source_message_id") || payload["messageSequence"] !== integer(row, "source_message_sequence") || payload["actorId"] !== text(row, "source_actor_id")) fail(`Ingress receipt ${receiptId} payload identity is invalid`);
        const payloadMessageAt = payload["messageCreatedAt"];
        if (typeof payloadMessageAt !== "string") fail(`Ingress receipt ${receiptId} lacks message timestamp`);
        requireIsoInstant({ messageCreatedAt: payloadMessageAt }, "messageCreatedAt");
        const responseAt = payload["responseCreatedAt"];
        if (text(row, "event_type") === "choice.response_created") {
          if (typeof responseAt !== "string") fail(`Choice receipt ${receiptId} lacks response timestamp`);
          requireIsoInstant({ responseCreatedAt: responseAt }, "responseCreatedAt");
          if (text(row, "source_response_id") === "") fail(`Choice receipt ${receiptId} lacks response identity`);
        } else if (responseAt !== undefined) fail(`Message receipt ${receiptId} has a response timestamp`);
      }
      const deliveries = rows(database, `SELECT delivery_id, schema_version, receipt_id, case_id, envelope_event_id, received_at
        FROM inbox_deliveries WHERE receipt_id = ? ORDER BY received_at, delivery_id`, receiptId).map((delivery) => {
        const deliveryId = id(delivery, "delivery_id", "delivery_", 73);
        if (text(delivery, "schema_version") !== CONTRACT_VERSIONS.inboxDelivery || text(delivery, "receipt_id") !== receiptId || text(delivery, "case_id") !== caseId) fail(`Ingress delivery ${deliveryId} binding is invalid`);
        return { deliveryId, schemaVersion: text(delivery, "schema_version"), envelopeEventId: externalString(delivery["envelope_event_id"], "delivery envelope event"), receivedAt: instant(delivery, "received_at") };
      });
      if (deliveries.length === 0) fail(`Ingress receipt ${receiptId} has no delivery`);
      const sourceMessageCreatedAt = nullableInstant(row, "message_created_at");
      const sourceResponseCreatedAt = payload === undefined || !Object.hasOwn(payload, "responseCreatedAt") ? null : (() => { const value = payload["responseCreatedAt"]; if (typeof value !== "string") throw new TypeError("responseCreatedAt is not text"); requireIsoInstant({ responseCreatedAt: value }, "responseCreatedAt"); return value; })();
      if (text(row, "event_role") !== "APPROVAL_RESPONSE" && text(row, "event_role") !== "OBSERVED_INPUT" && text(row, "event_role") !== "INTAKE" && text(row, "event_role") !== "CLARIFICATION_REPLY") fail(`Ingress receipt ${receiptId} role is invalid`);
      return {
        receiptId, schemaVersion: text(row, "schema_version"), appId: externalString(row["app_id"], "ingress appId"), cursor: integer(row, "cursor"), envelopeEventId: externalString(row["envelope_event_id"], "ingress envelope event"), eventKind: text(row, "event_type"), payloadDigest: hex(row, "payload_digest"), conversationId: externalString(row["source_conversation_id"], "ingress conversationId"), sourceMessageId: externalString(row["source_message_id"], "ingress source messageId"), sourceMessageSequence: integer(row, "source_message_sequence"), sourceResponseId: nullableText(row, "source_response_id"), sourceActorId: externalString(row["source_actor_id"], "ingress actorId"), sourceMessageCreatedAt, sourceResponseCreatedAt, processingStatus: requireOneOf(row, "processing_status", ["RECEIVED", "PROCESSED", "FAILED"] as const), receivedAt: receiptAt, correlationId: externalString(row["correlation_id"], "ingress correlationId"), role: text(row, "event_role"), outcome: text(row, "business_outcome"), stable: integer(row, "business_stable") === 1, ack: { state: requireOneOf(row, "ack_state", ["NONE", "ACK_INTENT", "ACK_CONFIRMED"] as const), actionId: nullableText(row, "ack_action_id"), confirmedAt: nullableInstant(row, "ack_confirmed_at") }, stableAt: nullableInstant(row, "stable_at"), deliveries,
      };
    });
}

function waitChallenges(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  return rows(database, `SELECT challenge_id, schema_version, case_id, board_id, workflow_run_id, question_entry_id, challenge_version,
      expected_app_id, expected_conversation_id, expected_actor_id, expected_input_contract, source_receipt_id, source_cursor,
      source_message_id, source_message_sequence, clarification_action_id, clarification_message_id, clarification_message_sequence,
      expires_at, state, resolved_by_receipt_id, created_at, ready_at, resolved_at
    FROM wait_challenges WHERE case_id = ? ORDER BY challenge_version, challenge_id`, caseId).map((row) => {
    const challengeId = id(row, "challenge_id", "challenge_", 74);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.waitChallenge || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Wait challenge ${challengeId} binding is invalid`);
    return { challengeId, schemaVersion: text(row, "schema_version"), questionEntryId: id(row, "question_entry_id", "entry_", 70), challengeVersion: integer(row, "challenge_version"), expectedAppId: externalString(row["expected_app_id"], "wait appId"), expectedConversationId: externalString(row["expected_conversation_id"], "wait conversationId"), expectedActorId: externalString(row["expected_actor_id"], "wait actorId"), expectedInputContract: text(row, "expected_input_contract"), sourceReceiptId: id(row, "source_receipt_id", "receipt_", 72), sourceCursor: integer(row, "source_cursor"), sourceMessageId: externalString(row["source_message_id"], "wait source messageId"), sourceMessageSequence: integer(row, "source_message_sequence"), clarificationActionId: id(row, "clarification_action_id", "action_", 71), clarificationMessageId: nullableText(row, "clarification_message_id"), clarificationMessageSequence: row["clarification_message_sequence"] === null ? null : integer(row, "clarification_message_sequence"), expiresAt: instant(row, "expires_at"), state: requireOneOf(row, "state", ["ACTIVE", "RESUMED", "EXPIRED"] as const), resolvedByReceiptId: nullableText(row, "resolved_by_receipt_id"), createdAt: instant(row, "created_at"), readyAt: nullableInstant(row, "ready_at"), resolvedAt: nullableInstant(row, "resolved_at") };
  });
}

function boardEntries(database: DatabaseSync, caseId: string, boardId: string, boardRevision: number) {
  return rows(database, `SELECT board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type, author_id,
      payload_json, source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level,
      instruction_authority, created_revision, content_digest, created_at
    FROM board_entries WHERE case_id = ? AND board_id = ? AND visibility = 'CASE'
    ORDER BY created_revision, board_entry_id`, caseId, boardId).map((row) => {
    const entryId = id(row, "board_entry_id", "entry_", 70);

    const entryType = requireOneOf(row, "entry_type", BOARD_ENTRY_TYPES);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.boardEntry || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "visibility") !== "CASE" || text(row, "instruction_authority") !== "NONE") fail(`Board entry ${entryId} binding is invalid`);
    const createdRevision = integer(row, "created_revision");
    if (createdRevision > boardRevision) fail(`Board entry ${entryId} is outside the Board revision`);
    const payload = objectJson(row, "payload_json");
    const sourceRefs = strings(arrayJson(row, "source_refs_json"), `Board ${entryId} sourceRefs`);
    const basedOn = strings(arrayJson(row, "based_on_json"), `Board ${entryId} basedOn`);
    const contradicts = strings(arrayJson(row, "contradicts_json"), `Board ${entryId} contradicts`);
    const supersedes = strings(arrayJson(row, "supersedes_json"), `Board ${entryId} supersedes`);
    const status = requireOneOf(row, "status", BOARD_ENTRY_STATUSES);
    const authorType = requireOneOf(row, "author_type", BOARD_AUTHORS);
    const authorId = externalString(row["author_id"], `Board ${entryId} authorId`);
    const trustLevel = requireOneOf(row, "trust_level", ["UNTRUSTED", "CANDIDATE", "VERIFIED"] as const);
    const immutable = { authorId, authorType, basedOn, contradicts, entryType, instructionAuthority: "NONE", payload, sourceRefs, status, supersedes, trustLevel, visibility: "CASE" };
    const contentDigest = hex(row, "content_digest");
    if (contentDigest !== digestValue(immutable)) fail(`Board entry ${entryId} digest is invalid`);
    return { entryId, schemaVersion: text(row, "schema_version"), entryType, status, author: { type: authorType, id: authorId }, payload: typedBoardPayload(entryType, payload), sourceRefs, basedOn, contradicts, supersedes, visibility: "CASE", trustLevel, instructionAuthority: "NONE", createdRevision, contentDigest, createdAt: instant(row, "created_at") };
  });
}

function runtime(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  return rows(database, `SELECT invocation_id, schema_version, case_id, workflow_run_id, board_id, node_id, profile_version,
      model_id, workflow_revision, board_revision, context_digest, status, attempt_budget, created_at
    FROM runtime_invocations WHERE case_id = ? AND board_id = ? AND workflow_run_id = ? ORDER BY node_id, invocation_id`, caseId, boardId, workflowRunId).map((row) => {
    const invocationId = id(row, "invocation_id", "invocation_", 75);
    const nodeId = requireOneOf(row, "node_id", ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"] as const);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.runtimeInvocation || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Invocation ${invocationId} binding is invalid`);
    const prepared = reconstructPreparedProfileInvocation(database, parseInvocationId(invocationId));
    if (prepared.caseId !== caseId || prepared.boardId !== boardId || prepared.workflowRunId !== workflowRunId || prepared.profile !== nodeId || prepared.profileVersion !== text(row, "profile_version") || prepared.modelId !== text(row, "model_id") || prepared.contextDigest !== hex(row, "context_digest") || prepared.workflowRevision !== integer(row, "workflow_revision") || prepared.boardRevision !== integer(row, "board_revision")) fail(`Invocation ${invocationId} Context identity is invalid`);
    const context = one(database, `SELECT context_id, schema_version, invocation_id, case_id, workflow_run_id, board_id, node_id,
        workflow_definition_id, workflow_definition_version, profile_version, provider_port_version, model_id, runtime_version,
        output_schema, objective, selected_entries_json, approved_sources_json, permission_summary_json, context_digest, created_at
      FROM profile_contexts WHERE invocation_id = ?`, invocationId);
    if (context === undefined) fail(`Invocation ${invocationId} has no Context`);
    const selectedEntryIds = strings(arrayJson(context, "selected_entries_json").map((item, index) => { const selected = boundedRecord(item, `selected entry ${index}`); return selected["id"]; }), "selected Context entry IDs").slice().sort();
    const sourceIds = strings(arrayJson(context, "approved_sources_json").map((item, index) => { const source = boundedRecord(item, `approved source ${index}`); return source["sourceId"]; }), "Context source IDs").slice().sort();
    const contextProjection = { contextId: id(context, "context_id", "context_", 72), schemaVersion: text(context, "schema_version"), workflowDefinitionId: text(context, "workflow_definition_id"), workflowDefinitionVersion: text(context, "workflow_definition_version"), profileVersion: text(context, "profile_version"), providerPortVersion: text(context, "provider_port_version"), modelId: externalString(context["model_id"], "Context modelId"), runtimeVersion: text(context, "runtime_version"), outputSchema: text(context, "output_schema"), objectiveDigest: digest(text(context, "objective")), selectedEntryIds, sourceIds, permissionSummary: permissions(objectJson(context, "permission_summary_json")), contextDigest: hex(context, "context_digest"), createdAt: instant(context, "created_at") };
    const attempts = rows(database, `SELECT attempt_id, schema_version, invocation_id, attempt_number, state, no_sdk_retry, created_at, started_at, finished_at
      FROM runtime_attempts WHERE invocation_id = ? ORDER BY attempt_number`, invocationId).map((attempt) => {
      const attemptId = id(attempt, "attempt_id", "attempt_", 72);
      if (text(attempt, "schema_version") !== CONTRACT_VERSIONS.runtimeAttempt || text(attempt, "invocation_id") !== invocationId || integer(attempt, "no_sdk_retry") !== 1) fail(`Attempt ${attemptId} binding is invalid`);
      const attemptNumber = integer(attempt, "attempt_number");
      const createdAt = instant(attempt, "created_at");
      const startedAt = nullableInstant(attempt, "started_at");
      const finishedAt = nullableInstant(attempt, "finished_at");
      if (startedAt !== null && startedAt < createdAt || finishedAt !== null && (startedAt === null || finishedAt < startedAt)) fail(`Attempt ${attemptId} chronology is invalid`);
      const resultRows = rows(database, `SELECT result_id, schema_version, invocation_id, attempt_id, provider_metadata_json, output_json,
          output_digest, usage_json, first_received_at
        FROM runtime_results WHERE invocation_id = ? AND attempt_id = ? ORDER BY result_id`, invocationId, attemptId).map((result) => {
        const resultId = id(result, "result_id", "result_", 71);
        if (text(result, "schema_version") !== CONTRACT_VERSIONS.runtimeResult || text(result, "invocation_id") !== invocationId || text(result, "attempt_id") !== attemptId) fail(`Result ${resultId} binding is invalid`);
        const output = objectJson(result, "output_json");
        if (hex(result, "output_digest") !== digestValue(output)) fail(`Result ${resultId} output digest is invalid`);
        const linkedEntries = rows(database, `SELECT link.board_entry_id, entry.case_id, entry.board_id
          FROM runtime_result_entries link LEFT JOIN board_entries entry ON entry.board_entry_id = link.board_entry_id
          WHERE link.result_id = ? ORDER BY link.board_entry_id`, resultId).map((link) => {
          const linked = id(link, "board_entry_id", "entry_", 70);
          if (link["case_id"] !== caseId || link["board_id"] !== boardId) fail(`Result ${resultId} Board link is cross-bound`);
          return linked;
        });
        return { resultId, schemaVersion: text(result, "schema_version"), outputDigest: hex(result, "output_digest"), providerMetadata: providerMetadata(objectJson(result, "provider_metadata_json")), usage: usage(objectJson(result, "usage_json")), firstReceivedAt: instant(result, "first_received_at"), boardEntryIds: linkedEntries };
      });
      const arrivalRows = rows(database, `SELECT arrival_id, schema_version, invocation_id, attempt_id, result_id, response_id, arrival_number, outcome,
          raw_response_json, raw_response_digest, recorded_at
        FROM runtime_result_arrivals WHERE invocation_id = ? AND attempt_id = ? ORDER BY arrival_number`, invocationId, attemptId).map((arrival) => {
        const arrivalId = id(arrival, "arrival_id", "arrival_", 72);
        if (text(arrival, "schema_version") !== CONTRACT_VERSIONS.runtimeResultArrival || text(arrival, "invocation_id") !== invocationId || text(arrival, "attempt_id") !== attemptId) fail(`Arrival ${arrivalId} binding is invalid`);
        void parsed(arrival, "raw_response_json");
        const responseId = nullableText(arrival, "response_id");
        if (responseId !== null) {
          const physical = one(database, `SELECT response_id, schema_version, invocation_id, attempt_id, envelope_digest, trusted_received_at, provider_received_at
            FROM runtime_physical_responses WHERE response_id = ?`, responseId);
          if (physical === undefined || id(physical, "response_id", "response_", 73) !== responseId || text(physical, "schema_version") !== CONTRACT_VERSIONS.runtimePhysicalResponse || text(physical, "invocation_id") !== invocationId || text(physical, "attempt_id") !== attemptId || hex(physical, "envelope_digest") !== hex(arrival, "raw_response_digest")) fail(`Arrival ${arrivalId} physical Response binding is invalid`);
          nullableInstant(physical, "provider_received_at"); instant(physical, "trusted_received_at");
        } else if (requireOneOf(arrival, "outcome", ARRIVAL_OUTCOMES) !== "UNKNOWN") fail(`Arrival ${arrivalId} without a Response is not UNKNOWN`);
        return { arrivalId, schemaVersion: text(arrival, "schema_version"), resultId: nullableText(arrival, "result_id") === null ? null : idValue(arrival["result_id"], "arrival resultId", "result_", 71), responseId, arrivalNumber: integer(arrival, "arrival_number"), outcome: requireOneOf(arrival, "outcome", ARRIVAL_OUTCOMES), rawResponseDigest: hex(arrival, "raw_response_digest"), recordedAt: instant(arrival, "recorded_at") };
      });
      const deliveryRows = rows(database, `SELECT d.delivery_id, d.schema_version, d.invocation_id, d.attempt_id, d.response_id, d.delivery_number,
          d.wire_digest, d.trusted_received_at, d.physical_trusted_received_at, d.attempt_state_at_receipt,
          d.original_attempt_state_at_receipt, linked.arrival_id
        FROM runtime_provider_deliveries d LEFT JOIN runtime_delivery_arrivals linked ON linked.delivery_id = d.delivery_id
        WHERE d.invocation_id = ? AND d.attempt_id = ? ORDER BY d.delivery_number`, invocationId, attemptId).map((delivery) => {
        const deliveryId = id(delivery, "delivery_id", "delivery_", 73);
        if (text(delivery, "invocation_id") !== invocationId || text(delivery, "attempt_id") !== attemptId || text(delivery, "schema_version") !== CONTRACT_VERSIONS.runtimeProviderDelivery) fail(`Provider Delivery ${deliveryId} binding is invalid`);
        const responseId = id(delivery, "response_id", "response_", 73);
        if (one(database, "SELECT 1 AS present FROM runtime_physical_responses WHERE response_id = ? AND invocation_id = ? AND attempt_id = ?", responseId, invocationId, attemptId) === undefined) fail(`Provider Delivery ${deliveryId} Response is missing`);
        const arrivalId = nullableText(delivery, "arrival_id");
        if (arrivalId !== null) idValue(arrivalId, "provider delivery arrivalId", "arrival_", 72);
        return { deliveryId, schemaVersion: text(delivery, "schema_version"), responseId, deliveryNumber: integer(delivery, "delivery_number"), wireDigest: hex(delivery, "wire_digest"), trustedReceivedAt: instant(delivery, "trusted_received_at"), physicalTrustedReceivedAt: instant(delivery, "physical_trusted_received_at"), attemptStateAtReceipt: externalString(delivery["attempt_state_at_receipt"], "delivery attempt state"), originalAttemptStateAtReceipt: externalString(delivery["original_attempt_state_at_receipt"], "delivery original attempt state"), arrivalId };
      });
      const state = requireOneOf(attempt, "state", ATTEMPT_STATES);
      return { attemptId, schemaVersion: text(attempt, "schema_version"), attemptNumber, state, noSdkRetry: true, createdAt, startedAt, finishedAt, results: resultRows, arrivals: arrivalRows, deliveries: deliveryRows };
    });
    const invocationStatus = requireOneOf(row, "status", ["READY", "RUNNING", "UNKNOWN", "RESULT_COMMITTED", "FAILED"] as const);
    const attemptBudget = integer(row, "attempt_budget");
    if (attemptBudget !== 2 || attempts.length === 0) fail(`Invocation ${invocationId} retry contract is invalid`);
    return { invocationId, schemaVersion: text(row, "schema_version"), nodeId, profileVersion: text(row, "profile_version"), modelId: externalString(row["model_id"], "Invocation modelId"), workflowRevision: integer(row, "workflow_revision"), boardRevision: integer(row, "board_revision"), contextDigest: hex(row, "context_digest"), status: invocationStatus, attemptBudget, createdAt: instant(row, "created_at"), context: contextProjection, attempts };
  });
}

function artifactAndDecision(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  const artifacts = rows(database, `SELECT artifact_id, artifact_revision, schema_version, case_id, workflow_run_id, board_id,
      source_invocation_id, source_result_id, reviewer_result_id, reviewer_handoff_id, reviewer_handoff_json, content_markdown,
      content_digest, material_assertions_json, manifest_digest, artifact_digest, created_board_revision, created_at
    FROM artifacts WHERE case_id = ? AND board_id = ? AND workflow_run_id = ? ORDER BY artifact_id, artifact_revision`, caseId, boardId, workflowRunId).map((row) => {
    const artifactId = id(row, "artifact_id", "artifact_", 73);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.artifact || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Artifact ${artifactId} binding is invalid`);
    boundedString(row["content_markdown"], "Artifact content", R003_CASE_TRACE_MAX_BYTES);
    const assertions = materialAssertions(arrayJson(row, "material_assertions_json"), `Artifact ${artifactId} material assertions`);
    return { artifactId, artifactRevision: integer(row, "artifact_revision"), schemaVersion: text(row, "schema_version"), sourceInvocationId: id(row, "source_invocation_id", "invocation_", 75), sourceResultId: id(row, "source_result_id", "result_", 71), reviewerResultId: id(row, "reviewer_result_id", "result_", 71), reviewerHandoffId: id(row, "reviewer_handoff_id", "handoff_", 72), contentDigest: hex(row, "content_digest"), materialAssertionBases: assertions.map((assertion) => ({ ordinal: assertion.ordinal, kind: record(assertion.basis, "material assertion basis").kind, entryId: idValue(record(assertion.basis, "material assertion basis").entryId, "material assertion entryId", "entry_", 70), contentDigest: String(record(assertion.basis, "material assertion basis").contentDigest) })), manifestDigest: hex(row, "manifest_digest"), artifactDigest: hex(row, "artifact_digest"), createdBoardRevision: integer(row, "created_board_revision"), createdAt: instant(row, "created_at") };
  });
  const challenges = rows(database, `SELECT challenge_id, schema_version, case_id, board_id, workflow_run_id, artifact_id, artifact_revision, artifact_digest,
      challenge_version, expected_app_id, expected_conversation_id, expected_actor_id, expected_board_revision, expected_workflow_revision,
      source_receipt_id, source_cursor, source_message_sequence, approval_action_id, binding_json, binding_digest, options_json, expires_at,
      state, choice_message_id, choice_message_sequence, ready_at, resolved_by_receipt_id, resolved_at, created_at
    FROM approval_challenges WHERE case_id = ? AND board_id = ? AND workflow_run_id = ? ORDER BY challenge_version, challenge_id`, caseId, boardId, workflowRunId).map((row) => {
    const challengeId = id(row, "challenge_id", "challenge_", 74);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.approvalChallenge || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Approval challenge ${challengeId} binding is invalid`);
    const binding = objectJson(row, "binding_json");
    if (hex(row, "binding_digest") !== digestValue(binding)) fail(`Approval challenge ${challengeId} binding digest is invalid`);
    if (json(arrayJson(row, "options_json")) !== "[\"approve\",\"reject\"]") fail(`Approval challenge ${challengeId} options are invalid`);
    return { challengeId, schemaVersion: text(row, "schema_version"), artifactId: id(row, "artifact_id", "artifact_", 73), artifactRevision: integer(row, "artifact_revision"), artifactDigest: hex(row, "artifact_digest"), challengeVersion: integer(row, "challenge_version"), expectedAppId: externalString(row["expected_app_id"], "approval appId"), expectedConversationId: externalString(row["expected_conversation_id"], "approval conversationId"), expectedActorId: externalString(row["expected_actor_id"], "approval actorId"), expectedBoardRevision: integer(row, "expected_board_revision"), expectedWorkflowRevision: integer(row, "expected_workflow_revision"), sourceReceiptId: id(row, "source_receipt_id", "receipt_", 72), sourceCursor: integer(row, "source_cursor"), sourceMessageSequence: integer(row, "source_message_sequence"), approvalActionId: id(row, "approval_action_id", "action_", 71), bindingDigest: hex(row, "binding_digest"), options: ["approve", "reject"], expiresAt: instant(row, "expires_at"), state: requireOneOf(row, "state", ["REQUEST_PENDING", "WAIT_FOR_APPROVAL", "APPROVED", "REJECTED", "PUBLICATION_HOLD", "COMPLETE"] as const), choiceMessageId: nullableText(row, "choice_message_id"), choiceMessageSequence: row["choice_message_sequence"] === null ? null : integer(row, "choice_message_sequence"), readyAt: nullableInstant(row, "ready_at"), resolvedByReceiptId: nullableText(row, "resolved_by_receipt_id"), resolvedAt: nullableInstant(row, "resolved_at"), createdAt: instant(row, "created_at") };
  });
  const approvals = rows(database, `SELECT approval_id, schema_version, case_id, workflow_run_id, artifact_id, artifact_revision, artifact_digest,
      expected_actor_id, choice_message_id, state, challenge_id, response_id, receipt_id, request_action_id, decision_digest, decision_json, created_at, decided_at
    FROM approvals WHERE case_id = ? AND workflow_run_id = ? ORDER BY approval_id`, caseId, workflowRunId).map((row) => {
    const approvalId = id(row, "approval_id", "approval_", 73);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.approval || text(row, "case_id") !== caseId || text(row, "workflow_run_id") !== workflowRunId) fail(`Approval ${approvalId} binding is invalid`);
    const decisionJson = row["decision_json"] === null ? null : objectJson(row, "decision_json");
    if (decisionJson !== null && hex(row, "decision_digest") !== digestValue(decisionJson)) fail(`Approval ${approvalId} decision digest is invalid`);
    const decision = decisionJson === null ? null : projectDecision(decisionJson);
    return { approvalId, schemaVersion: text(row, "schema_version"), artifactId: nullableText(row, "artifact_id"), artifactRevision: integer(row, "artifact_revision"), artifactDigest: hex(row, "artifact_digest"), expectedActorId: externalString(row["expected_actor_id"], "approval actorId"), choiceMessageId: externalString(row["choice_message_id"], "approval choiceMessageId"), state: requireOneOf(row, "state", ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const), challengeId: nullableText(row, "challenge_id"), responseId: nullableText(row, "response_id"), receiptId: nullableText(row, "receipt_id"), requestActionId: nullableText(row, "request_action_id"), decisionDigest: nullableText(row, "decision_digest"), decision, createdAt: instant(row, "created_at"), decidedAt: nullableInstant(row, "decided_at") };
  });
  return { artifacts, challenges, approvals };
}

function projectDecision(value: unknown): Row {
  const source = boundedRecord(value, "Approval decision");
  const result: Row = {};
  const stringKeys = ["actionKind", "actorId", "artifactDigest", "artifactId", "challengeId", "choiceMessageId", "conversationId", "decidedAt", "decision", "receiptId", "requestActionId", "responseId", "workflowRunId"] as const;
  for (const key of stringKeys) if (Object.hasOwn(source, key)) result[key] = externalString(source[key], `Approval decision ${key}`);
  if (Object.hasOwn(source, "artifactRevision")) result.artifactRevision = optionalInteger(source, "artifactRevision", "Approval decision artifactRevision");
  if (Object.hasOwn(source, "version")) result.version = optionalInteger(source, "version", "Approval decision version");
  if (typeof result.decision !== "string" || (result.decision !== "APPROVED" && result.decision !== "REJECTED")) throw new TypeError("Approval decision action is invalid");
  if (typeof result.decidedAt === "string") requireIsoInstant({ decidedAt: result.decidedAt }, "decidedAt");
  return result;
}

function publication(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  const claims = rows(database, `SELECT response_claim_id, schema_version, case_id, workflow_run_id, approval_id, publication_slot, claim_version,
      board_revision, workflow_revision, freshness_token_digest, state, artifact_id, artifact_revision, artifact_digest, owner_id, expires_at, created_at
    FROM response_claims WHERE case_id = ? AND workflow_run_id = ? ORDER BY response_claim_id`, caseId, workflowRunId).map((row) => {
    const claimId = id(row, "response_claim_id", "response_claim_", 79);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.responseClaim || text(row, "case_id") !== caseId || text(row, "workflow_run_id") !== workflowRunId || text(row, "publication_slot") !== "FINAL_RESPONSE") fail(`Response Claim ${claimId} binding is invalid`);
    return { responseClaimId: claimId, schemaVersion: text(row, "schema_version"), approvalId: id(row, "approval_id", "approval_", 73), publicationSlot: text(row, "publication_slot"), claimVersion: integer(row, "claim_version"), boardRevision: integer(row, "board_revision"), workflowRevision: integer(row, "workflow_revision"), freshnessTokenDigest: nullableText(row, "freshness_token_digest"), state: requireOneOf(row, "state", ["CLAIMED", "HELD", "CONFIRMED", "EXPIRED"] as const), artifactId: nullableText(row, "artifact_id"), artifactRevision: row["artifact_revision"] === null ? null : integer(row, "artifact_revision"), artifactDigest: nullableText(row, "artifact_digest"), ownerId: nullableText(row, "owner_id"), expiresAt: nullableInstant(row, "expires_at"), createdAt: instant(row, "created_at") };
  });
  const freshness = rows(database, `SELECT freshness_id, schema_version, case_id, workflow_run_id, board_id, artifact_id, artifact_revision, artifact_digest,
      approval_id, response_claim_id, claim_version, app_id, conversation_id, source_message_sequence, trigger_message_id,
      trigger_message_sequence, board_revision, workflow_revision, read_action_id, snapshot_json, snapshot_digest, token_json,
      token_digest, state, expires_at, created_at, confirmed_at, invalidated_at, consumed_at
    FROM publication_freshness WHERE case_id = ? AND board_id = ? AND workflow_run_id = ? ORDER BY freshness_id`, caseId, boardId, workflowRunId).map((row) => {
    const freshnessId = id(row, "freshness_id", "freshness_", 74);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.publicationFreshness || text(row, "case_id") !== caseId || text(row, "board_id") !== boardId || text(row, "workflow_run_id") !== workflowRunId) fail(`Freshness ${freshnessId} binding is invalid`);
    const snapshot = objectJson(row, "snapshot_json");
    if (hex(row, "snapshot_digest") !== digestValue(snapshot)) fail(`Freshness ${freshnessId} snapshot digest is invalid`);
    if (row["token_json"] !== null) {
      const token = objectJson(row, "token_json");
      if (hex(row, "token_digest") !== digestValue(token)) fail(`Freshness ${freshnessId} token digest is invalid`);
    } else if (row["token_digest"] !== null) fail(`Freshness ${freshnessId} has an unbound token digest`);
    const observedCursor = snapshot["observedCursor"]; const observedSourceMessageSequence = snapshot["sourceMessageSequence"];
    if (typeof observedCursor !== "number" || !Number.isSafeInteger(observedCursor) || typeof observedSourceMessageSequence !== "number" || !Number.isSafeInteger(observedSourceMessageSequence)) fail(`Freshness ${freshnessId} snapshot cutoff is invalid`);
    return { freshnessId, schemaVersion: text(row, "schema_version"), responseClaimId: id(row, "response_claim_id", "response_claim_", 79), approvalId: id(row, "approval_id", "approval_", 73), claimVersion: integer(row, "claim_version"), appId: externalString(row["app_id"], "freshness appId"), conversationId: externalString(row["conversation_id"], "freshness conversationId"), artifactId: id(row, "artifact_id", "artifact_", 73), artifactRevision: integer(row, "artifact_revision"), artifactDigest: hex(row, "artifact_digest"), sourceMessageSequence: integer(row, "source_message_sequence"), triggerMessageId: externalString(row["trigger_message_id"], "freshness triggerMessageId"), triggerMessageSequence: integer(row, "trigger_message_sequence"), boardRevision: integer(row, "board_revision"), workflowRevision: integer(row, "workflow_revision"), readActionId: id(row, "read_action_id", "action_", 71), snapshotDigest: hex(row, "snapshot_digest"), observedCursor, observedSourceMessageSequence, tokenDigest: nullableText(row, "token_digest"), state: requireOneOf(row, "state", ["PENDING", "VALID", "INVALID", "CONSUMED"] as const), expiresAt: instant(row, "expires_at"), createdAt: instant(row, "created_at"), confirmedAt: nullableInstant(row, "confirmed_at"), invalidatedAt: nullableInstant(row, "invalidated_at"), consumedAt: nullableInstant(row, "consumed_at") };
  });
  const actions = rows(database, `SELECT p.action_id, p.schema_version, p.case_id, p.workflow_run_id, p.receipt_id, p.action_kind,
      p.idempotency_key, p.payload_digest, p.state, p.created_at,
      r.schema_version AS rpc_schema_version, r.case_id AS rpc_case_id, r.workflow_run_id AS rpc_workflow_run_id,
      r.receipt_id AS rpc_receipt_id, r.request_envelope_id, r.rpc_method, r.request_json, r.request_digest,
      r.confirmed_external_id, r.created_at AS rpc_created_at, r.confirmed_at, r.dispatched_at, r.confirmation_json
    FROM pending_side_effects p LEFT JOIN magicchat_rpc_actions r ON r.action_id = p.action_id AND r.case_id = p.case_id AND r.workflow_run_id = p.workflow_run_id AND (r.receipt_id IS p.receipt_id OR (r.receipt_id IS NULL AND p.receipt_id IS NULL))
    WHERE p.case_id = ? AND p.workflow_run_id = ? ORDER BY p.created_at, p.action_id`, caseId, workflowRunId).map((row) => {
    const actionId = id(row, "action_id", "action_", 71);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.pendingSideEffect || text(row, "case_id") !== caseId || text(row, "workflow_run_id") !== workflowRunId) fail(`Action ${actionId} binding is invalid`);
    if (row["request_json"] !== null && text(row, "rpc_schema_version") !== CONTRACT_VERSIONS.magicChatRpcAction) fail(`Action ${actionId} RPC schema binding is invalid`);
    if (row["request_json"] !== null && (text(row, "rpc_case_id") !== caseId || text(row, "rpc_workflow_run_id") !== workflowRunId || text(row, "rpc_receipt_id") !== text(row, "receipt_id"))) fail(`Action ${actionId} RPC authority binding is invalid`);
    const requestJson = row["request_json"] === null ? null : objectJson(row, "request_json");
    const rpcMethod = nullableText(row, "rpc_method");
    if (requestJson !== null && rpcMethod !== null) {
      validateRpcEnvelope(rpcMethod, requestJson);
      if (hex(row, "request_digest") !== digestValue(requestJson) || text(row, "request_envelope_id") !== text(row, "idempotency_key")) fail(`Action ${actionId} request identity is invalid`);
      if (row["confirmation_json"] !== null) {
        const confirmation = objectJson(row, "confirmation_json");
        if (rpcMethod === "message.send") validateMessageConfirmation(confirmation);
        else if (rpcMethod === "conversation.messages.list") parseMagicChatMessagesListPayload(confirmation);
        else if (rpcMethod === "events.ack") { if (Object.keys(confirmation).sort().join(",") !== "cursor" || typeof confirmation["cursor"] !== "number") fail(`Action ${actionId} ACK confirmation is invalid`); }
      }
    } else if (row["request_json"] !== null || rpcMethod !== null || row["confirmation_json"] !== null) fail(`Action ${actionId} has a partial RPC record`);
    return { actionId, schemaVersion: text(row, "schema_version"), receiptId: nullableText(row, "receipt_id"), actionKind: requireOneOf(row, "action_kind", ACTION_KINDS), idempotencyKey: externalString(row["idempotency_key"], "action idempotency key"), payloadDigest: hex(row, "payload_digest"), state: requireOneOf(row, "state", ACTION_STATES), createdAt: instant(row, "created_at"), requestEnvelopeId: nullableText(row, "request_envelope_id"), rpcMethod, requestDigest: nullableText(row, "request_digest"), confirmedExternalId: nullableText(row, "confirmed_external_id"), rpcCreatedAt: nullableInstant(row, "rpc_created_at"), dispatchedAt: nullableInstant(row, "dispatched_at"), confirmedAt: nullableInstant(row, "confirmed_at") };
  });
  const messages = rows(database, `SELECT message_record_id, schema_version, case_id, workflow_run_id, receipt_id, action_id,
      challenge_id, approval_challenge_id, purpose, conversation_id, message_id, message_sequence, confirmed_at
    FROM magicchat_messages WHERE case_id = ? AND workflow_run_id = ? ORDER BY message_sequence, message_record_id`, caseId, workflowRunId).map((row) => {
    const messageRecordId = id(row, "message_record_id", "mc_message_", 75);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.magicChatMessage || text(row, "case_id") !== caseId || text(row, "workflow_run_id") !== workflowRunId) fail(`Message ${messageRecordId} binding is invalid`);
    return { messageRecordId, schemaVersion: text(row, "schema_version"), receiptId: nullableText(row, "receipt_id"), actionId: id(row, "action_id", "action_", 71), challengeId: nullableText(row, "challenge_id"), approvalChallengeId: nullableText(row, "approval_challenge_id"), purpose: requireOneOf(row, "purpose", ["CLARIFICATION", "APPROVAL_REQUEST", "PUBLICATION"] as const), conversationId: externalString(row["conversation_id"], "message conversationId"), messageId: externalString(row["message_id"], "message external ID"), messageSequence: integer(row, "message_sequence"), confirmedAt: instant(row, "confirmed_at") };
  });
  return { claims, freshness, actions, messages };
}

function audit(database: DatabaseSync, caseId: string, boardId: string, workflowRunId: string) {
  return rows(database, `SELECT audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at
    FROM audit_events WHERE case_id = ? ORDER BY recorded_at, audit_event_id`, caseId).map((row) => {
    const auditEventId = id(row, "audit_event_id", "audit_", 70);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.auditEvent || text(row, "case_id") !== caseId || (row["board_id"] !== null && row["board_id"] !== boardId) || (row["workflow_run_id"] !== null && row["workflow_run_id"] !== workflowRunId)) fail(`Audit event ${auditEventId} binding is invalid`);
    const raw = objectJson(row, "details_json");
    return { auditEventId, schemaVersion: text(row, "schema_version"), correlationId: externalString(row["correlation_id"], "audit correlationId"), eventKind: externalString(row["event_kind"], "audit eventKind"), boardId: nullableText(row, "board_id"), workflowRunId: nullableText(row, "workflow_run_id"), receiptId: nullableText(row, "receipt_id"), detailsDigest: digestValue(raw), references: auditDetails(raw), recordedAt: instant(row, "recorded_at") };
  });
}

function sourceRows(database: DatabaseSync, sourceIds: readonly string[]) {
  if (sourceIds.length === 0) return [] as readonly Row[];
  const placeholders = sourceIds.map(() => "?").join(",");
  const all = rows(database, `SELECT source.source_id, source.schema_version, source.source_kind, source.locator, source.content, source.content_digest,
      source.observed_at, source.manifest_id, manifest.schema_version AS manifest_schema_version, manifest.manifest_digest,
      manifest.state AS manifest_state, manifest.source_count
    FROM approved_synthetic_sources source JOIN approved_synthetic_source_manifests manifest ON manifest.manifest_id = source.manifest_id
    WHERE source.source_id IN (${placeholders}) ORDER BY source.source_id`, ...sourceIds);
  const manifestRows = rows(database, `SELECT source_id, source_kind, locator, content_digest, observed_at FROM approved_synthetic_sources WHERE manifest_id = 'source_manifest_r003_v1' ORDER BY source_id`);
  const manifest = one(database, "SELECT manifest_id, schema_version, manifest_digest, source_count, state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'");
  if (manifest === undefined || text(manifest, "schema_version") !== "accord.approved-synthetic-source-manifest/v1" || text(manifest, "state") !== "SEALED" || integer(manifest, "source_count") !== manifestRows.length) fail("approved source manifest is incomplete");
  const manifestDigest = digestValue({ sources: manifestRows.map((row) => ({ contentDigest: hex(row, "content_digest"), locator: text(row, "locator"), observedAt: instant(row, "observed_at"), sourceId: id(row, "source_id", "source_", 71), sourceKind: text(row, "source_kind") })).sort((left, right) => left.sourceId.localeCompare(right.sourceId)), version: "accord.r003-approved-synthetic-sources/v1" });
  if (hex(manifest, "manifest_digest") !== manifestDigest) fail("approved source manifest digest is invalid");
  if (all.length !== sourceIds.length) fail("a referenced source is missing");
  return all.map((row) => {
    const sourceId = id(row, "source_id", "source_", 71);
    const content = boundedString(row["content"], "source content", R003_CASE_TRACE_MAX_BYTES);
    if (text(row, "schema_version") !== CONTRACT_VERSIONS.approvedSyntheticSource || text(row, "manifest_id") !== "source_manifest_r003_v1" || hex(row, "content_digest") !== digestValue(content)) fail(`Source ${sourceId} digest is invalid`);
    const manifestDigestValue = hex(row, "manifest_digest");
    return { sourceId, schemaVersion: text(row, "schema_version"), sourceKind: externalString(row["source_kind"], "source kind"), locator: externalString(row["locator"], "source locator"), contentDigest: hex(row, "content_digest"), observedAt: instant(row, "observed_at"), manifestId: text(row, "manifest_id"), manifestSchemaVersion: text(row, "manifest_schema_version"), manifestDigest: manifestDigestValue, manifestState: text(row, "manifest_state"), sourceCount: integer(row, "source_count") };
  });
}

function uniqueMap(values: readonly Row[], key: string, label: string): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const value of values) {
    const item = value[key];
    if (typeof item !== "string" || result.has(item)) fail(`duplicate ${label} identity ${String(item)}`);
    result.set(item, value);
  }
  return result;
}

function requireMap(map: ReadonlyMap<string, Row>, value: unknown, label: string): Row {
  if (typeof value !== "string" || map.get(value) === undefined) fail(`${label} does not resolve: ${String(value)}`);
  return map.get(value)!;
}

function assertRelations(trace: Row): void {
  const identity = record(trace.identity, "Trace identity");
  const entries = trace.boardEntries as readonly Row[];
  const ingressRows = trace.ingress as readonly Row[];
  const waitRows = trace.waitChallenges as readonly Row[];
  const runtimeRows = trace.runtime as readonly Row[];
  const sources = trace.sources as readonly Row[];
  const decision = record(trace.artifactAndDecision, "Trace artifact decision");
  const publicationData = record(trace.publication, "Trace publication");
  const auditRows = trace.audit as readonly Row[];
  const entryMap = uniqueMap(entries, "entryId", "Board entry");
  const sourceMap = uniqueMap(sources, "sourceId", "source");
  const receiptMap = uniqueMap(ingressRows, "receiptId", "receipt");
  const waitMap = uniqueMap(waitRows, "challengeId", "wait challenge");
  const invocationMap = uniqueMap(runtimeRows, "invocationId", "Invocation");
  const attemptMap = new Map<string, Row>(); const resultMap = new Map<string, Row>(); const arrivalMap = new Map<string, Row>(); const providerDeliveryMap = new Map<string, Row>();
  for (const invocation of runtimeRows) {
    const context = record(invocation.context, "runtime Context");
    for (const entryId of context.selectedEntryIds as readonly unknown[]) requireMap(entryMap, entryId, "Context entry");
    for (const sourceId of context.sourceIds as readonly unknown[]) requireMap(sourceMap, sourceId, "Context source");
    for (const attempt of invocation.attempts as readonly Row[]) {
      const attemptId = String(attempt.attemptId); if (attemptMap.has(attemptId)) fail(`duplicate Attempt identity ${attemptId}`); attemptMap.set(attemptId, attempt);
      for (const result of attempt.results as readonly Row[]) { const resultId = String(result.resultId); if (resultMap.has(resultId)) fail(`duplicate Result identity ${resultId}`); resultMap.set(resultId, result); for (const entryId of result.boardEntryIds as readonly unknown[]) requireMap(entryMap, entryId, "Result Board entry"); }
      for (const arrival of attempt.arrivals as readonly Row[]) { const arrivalId = String(arrival.arrivalId); if (arrivalMap.has(arrivalId)) fail(`duplicate Arrival identity ${arrivalId}`); arrivalMap.set(arrivalId, arrival); const resultId = arrival.resultId; if (resultId !== null) requireMap(resultMap, resultId, "Arrival Result"); }
      for (const delivery of attempt.deliveries as readonly Row[]) { const deliveryId = String(delivery.deliveryId); if (providerDeliveryMap.has(deliveryId)) fail(`duplicate Provider Delivery identity ${deliveryId}`); providerDeliveryMap.set(deliveryId, delivery); if (delivery.arrivalId !== null) requireMap(arrivalMap, delivery.arrivalId, "Provider Delivery Arrival"); }
    }
  }
  const artifacts = decision.artifacts as readonly Row[]; const challenges = decision.challenges as readonly Row[]; const approvals = decision.approvals as readonly Row[];
  const claims = publicationData.claims as readonly Row[]; const freshness = publicationData.freshness as readonly Row[]; const actions = publicationData.actions as readonly Row[]; const messages = publicationData.messages as readonly Row[];
  const artifactMap = uniqueMap(artifacts, "artifactId", "Artifact"); const approvalChallengeMap = uniqueMap(challenges, "challengeId", "approval challenge"); const approvalMap = uniqueMap(approvals, "approvalId", "Approval"); const claimMap = uniqueMap(claims, "responseClaimId", "Response Claim"); const freshnessMap = uniqueMap(freshness, "freshnessId", "Freshness"); const actionMap = uniqueMap(actions, "actionId", "Action");
  const externalMessageMap = new Map<string, Row>();
  const sourceMessageIds = new Set<string>();
  for (const receipt of ingressRows) { sourceMessageIds.add(String(receipt.sourceMessageId)); if (receipt.ack.actionId !== null) requireMap(actionMap, receipt.ack.actionId, "Ingress ACK action"); for (const delivery of receipt.deliveries as readonly Row[]) { if (delivery.deliveryId === undefined) fail("Ingress delivery lacks identity"); } }
  for (const message of messages) { const messageId = String(message.messageId); const prior = externalMessageMap.get(messageId); if (prior !== undefined && prior.messageRecordId !== message.messageRecordId) fail(`duplicate external message identity ${messageId}`); externalMessageMap.set(messageId, message); }
  const resolveExternalMessage = (value: unknown, label: string): void => { if (typeof value !== "string" || (!sourceMessageIds.has(value) && !externalMessageMap.has(value))) fail(`${label} does not resolve: ${String(value)}`); };
  for (const wait of waitRows) { requireMap(entryMap, wait.questionEntryId, "Wait question"); requireMap(receiptMap, wait.sourceReceiptId, "Wait source receipt"); requireMap(actionMap, wait.clarificationActionId, "Wait clarification action"); if (wait.clarificationMessageId !== null) resolveExternalMessage(wait.clarificationMessageId, "Wait clarification message"); if (wait.resolvedByReceiptId !== null) requireMap(receiptMap, wait.resolvedByReceiptId, "Wait resolved receipt"); }
  for (const entry of entries) {
    for (const field of ["basedOn", "contradicts", "supersedes"] as const) for (const reference of entry[field] as readonly unknown[]) requireMap(entryMap, reference, `Board ${field}`);
    for (const reference of entry.sourceRefs as readonly unknown[]) {
      if (typeof reference !== "string") fail("Board source reference is invalid");
      if (reference.startsWith("magicchat:message:")) resolveExternalMessage(reference.slice(18), "Board external source message");
      else if (reference.startsWith("source_")) requireMap(sourceMap, reference, "Board source");
      else requireMap(entryMap, reference, "Board entry source");
    }
    const payload = record(entry.payload, "Board payload");
    if (entry.entryType === "EvidenceRef") { requireMap(sourceMap, payload.sourceId, "EvidenceRef source"); const source = requireMap(sourceMap, payload.sourceId, "EvidenceRef source"); if (payload.sourceDigest !== source.contentDigest || payload.locator !== source.locator || payload.observedAt !== source.observedAt || payload.sourceKind !== source.sourceKind) fail("EvidenceRef source binding is invalid"); }
    if (entry.entryType === "Observation" && payload.sourceMessageId !== undefined) resolveExternalMessage(payload.sourceMessageId, "Observation source message");
    if (entry.entryType === "Critique" || entry.entryType === "VerificationResult") { if (payload.target !== undefined) { const target = typedLink(payload.target, `${entry.entryType} target`); const targetEntry = requireMap(entryMap, target.entryId, "Board target"); if (target.type !== targetEntry.entryType || target.digest !== targetEntry.contentDigest) fail("Board target digest/type binding is invalid"); } }
    if (entry.entryType === "ArtifactRef") { const artifact = requireMap(artifactMap, payload.artifactId, "ArtifactRef Artifact"); if (payload.artifactRevision !== artifact.artifactRevision || payload.artifactDigest !== artifact.artifactDigest || payload.contentDigest !== artifact.contentDigest) fail("ArtifactRef does not match its Artifact"); }
  }
  for (const invocation of runtimeRows) {
    for (const attempt of invocation.attempts as readonly Row[]) for (const result of attempt.results as readonly Row[]) for (const entryId of result.boardEntryIds as readonly unknown[]) requireMap(entryMap, entryId, "runtime result Board entry");
  }
  for (const artifact of artifacts) { requireMap(invocationMap, artifact.sourceInvocationId, "Artifact source Invocation"); const sourceResult = requireMap(resultMap, artifact.sourceResultId, "Artifact source Result"); const reviewerResult = requireMap(resultMap, artifact.reviewerResultId, "Artifact Reviewer Result"); if (sourceResult.resultId !== artifact.sourceResultId || reviewerResult.resultId !== artifact.reviewerResultId) fail("Artifact Result binding is invalid"); for (const basis of artifact.materialAssertionBases as readonly Row[]) { const entry = requireMap(entryMap, basis.entryId, "Artifact basis entry"); if (basis.contentDigest !== entry.contentDigest) fail("Artifact basis digest is invalid"); } }
  for (const challenge of challenges) { const artifact = requireMap(artifactMap, challenge.artifactId, "Approval challenge Artifact"); if (artifact.artifactRevision !== challenge.artifactRevision || artifact.artifactDigest !== challenge.artifactDigest) fail("Approval challenge Artifact binding is invalid"); requireMap(receiptMap, challenge.sourceReceiptId, "Approval challenge source receipt"); requireMap(actionMap, challenge.approvalActionId, "Approval challenge action"); if (challenge.choiceMessageId !== null) resolveExternalMessage(challenge.choiceMessageId, "Approval challenge choice message"); if (challenge.resolvedByReceiptId !== null) requireMap(receiptMap, challenge.resolvedByReceiptId, "Approval challenge resolved receipt"); }
  for (const approval of approvals) { if (approval.artifactId !== null) requireMap(artifactMap, approval.artifactId, "Approval Artifact"); if (approval.challengeId !== null) requireMap(approvalChallengeMap, approval.challengeId, "Approval challenge"); if (approval.receiptId !== null) requireMap(receiptMap, approval.receiptId, "Approval receipt"); if (approval.requestActionId !== null) requireMap(actionMap, approval.requestActionId, "Approval action"); resolveExternalMessage(approval.choiceMessageId, "Approval choice message"); if (approval.responseId !== null) { const receipt = approval.receiptId === null ? undefined : receiptMap.get(approval.receiptId); if (receipt === undefined || receipt.sourceResponseId !== approval.responseId) fail("Approval response binding is invalid"); } if (approval.decision !== null) { const d = approval.decision; if (d.artifactId !== approval.artifactId || d.artifactDigest !== approval.artifactDigest || d.challengeId !== approval.challengeId || d.choiceMessageId !== approval.choiceMessageId || d.receiptId !== approval.receiptId || d.requestActionId !== approval.requestActionId || d.responseId !== approval.responseId) fail("Approval H3 binding is invalid"); } }
  for (const claim of claims) { requireMap(approvalMap, claim.approvalId, "Claim Approval"); if (claim.artifactId !== null) { const artifact = requireMap(artifactMap, claim.artifactId, "Claim Artifact"); if (claim.artifactRevision !== artifact.artifactRevision || claim.artifactDigest !== artifact.artifactDigest) fail("Claim Artifact binding is invalid"); } }
  for (const fresh of freshness) { requireMap(claimMap, fresh.responseClaimId, "Freshness Claim"); requireMap(approvalMap, fresh.approvalId, "Freshness Approval"); const artifact = requireMap(artifactMap, fresh.artifactId, "Freshness Artifact"); if (artifact.artifactRevision !== fresh.artifactRevision || artifact.artifactDigest !== fresh.artifactDigest) fail("Freshness Artifact binding is invalid"); requireMap(actionMap, fresh.readActionId, "Freshness read action"); resolveExternalMessage(fresh.triggerMessageId, "Freshness trigger message"); }
  for (const action of actions) { if (action.receiptId !== null) requireMap(receiptMap, action.receiptId, "Action receipt"); if (action.requestEnvelopeId !== null && action.requestEnvelopeId !== action.idempotencyKey) fail("Action request identity is invalid"); }
  for (const message of messages) { requireMap(actionMap, message.actionId, "Message action"); if (message.receiptId !== null) requireMap(receiptMap, message.receiptId, "Message receipt"); if (message.challengeId !== null) requireMap(waitMap, message.challengeId, "Message wait challenge"); if (message.approvalChallengeId !== null) requireMap(approvalChallengeMap, message.approvalChallengeId, "Message approval challenge"); }
  const identityCaseId = text(identity, "caseId"); const identityBoardId = text(identity, "boardId"); const identityRunId = text(identity, "workflowRunId");
  for (const auditEvent of auditRows) { if (auditEvent.boardId !== null && auditEvent.boardId !== identityBoardId || auditEvent.workflowRunId !== null && auditEvent.workflowRunId !== identityRunId) fail("Audit direct binding is invalid"); if (auditEvent.receiptId !== null) requireMap(receiptMap, auditEvent.receiptId, "Audit receipt"); const refs = record(auditEvent.references, "Audit references"); for (const [key, value] of Object.entries(refs)) { if (key === "actionId" || key === "readActionId") requireMap(actionMap, value, `Audit ${key}`); else if (["approvalId"].includes(key)) requireMap(approvalMap, value, `Audit ${key}`); else if (["artifactId"].includes(key)) requireMap(artifactMap, value, `Audit ${key}`); else if (["challengeId"].includes(key)) { if (typeof value !== "string" || (!approvalChallengeMap.has(value) && !waitMap.has(value))) fail(`Audit ${key} does not resolve`); } else if (["claimId", "responseClaimId"].includes(key)) requireMap(claimMap, value, `Audit ${key}`); else if (["freshnessId"].includes(key)) requireMap(freshnessMap, value, `Audit ${key}`); else if (["arrivalId"].includes(key)) requireMap(arrivalMap, value, `Audit ${key}`); else if (["attemptId"].includes(key)) requireMap(attemptMap, value, `Audit ${key}`); else if (["invocationId"].includes(key)) requireMap(invocationMap, value, `Audit ${key}`); else if (["resultId"].includes(key)) requireMap(resultMap, value, `Audit ${key}`); else if (["deliveryId"].includes(key)) { if (typeof value !== "string" || (!providerDeliveryMap.has(value) && ![...ingressRows].some((row) => (row.deliveries as readonly Row[]).some((delivery) => delivery.deliveryId === value)))) fail(`Audit ${key} does not resolve`); } else if (["entryId", "boardEntryId", "candidateEntryId", "questionEntryId", "observationEntryId"].includes(key)) requireMap(entryMap, value, `Audit ${key}`); else if (["sourceId"].includes(key)) requireMap(sourceMap, value, `Audit ${key}`); else if (["sourceMessageId", "messageId", "clarificationMessageId"].includes(key)) resolveExternalMessage(value, `Audit ${key}`); else if (["requestEnvelopeId"].includes(key)) { if (![...actionMap.values()].some((action) => action.requestEnvelopeId === value)) fail(`Audit ${key} does not resolve`); } else if (["boardEntryIds", "entryIds"].includes(key)) for (const entryId of strings(value, `Audit ${key}`)) requireMap(entryMap, entryId, `Audit ${key}`); }
  }
  if (identityCaseId === "" || identityBoardId === "" || identityRunId === "") fail("Trace identity is incomplete");
}

const PHASE_RANK: Readonly<Record<string, number>> = { INTAKE: 0, WAIT_FOR_INPUT: 1, RESEARCHER: 2, ANALYST: 3, REVIEWER: 4, WRITER: 5, WAIT_FOR_APPROVAL: 6, FRESHNESS_CHECK: 7, PUBLICATION_HOLD: 7, PUBLISH: 8, COMPLETE: 9 };

function winnerFor(invocation: Row): Row | undefined {
  for (const attempt of invocation.attempts as readonly Row[]) if (attempt.state === "WINNER") return attempt;
  return undefined;
}

function assertPhaseCompleteness(trace: Row): void {
  const identity = record(trace.identity, "Trace identity");
  const caseStatus = requireOneOf(identity, "caseStatus", CASE_STATUSES);
  const workflowState = requireOneOf(identity, "workflowState", WORKFLOW_STATES);
  const entries = trace.boardEntries as readonly Row[]; const runtimeRows = trace.runtime as readonly Row[]; const waitRows = trace.waitChallenges as readonly Row[]; const decision = record(trace.artifactAndDecision, "artifact decision"); const publicationData = record(trace.publication, "publication");
  const invocations = new Map(runtimeRows.map((row) => [row.nodeId as string, row]));
  if (caseStatus === "COMPLETE" || workflowState === "COMPLETE") {
    if (caseStatus !== "COMPLETE" || workflowState !== "COMPLETE") fail("completed Case/Workflow state diverges");
    const requiredNodes = ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"] as const;
    if (runtimeRows.length !== requiredNodes.length || requiredNodes.some((node) => invocations.get(node) === undefined || invocations.get(node)!.status !== "RESULT_COMMITTED" || winnerFor(invocations.get(node)!) === undefined)) fail("completed Case lacks its four fixed winning Invocations");
    const types = new Set(entries.map((entry) => entry.entryType));
    if (BOARD_ENTRY_TYPES.some((type) => !types.has(type))) fail("completed Case lacks a fixed Board entry type");
    const artifacts = decision.artifacts as readonly Row[]; const challenges = decision.challenges as readonly Row[]; const approvals = decision.approvals as readonly Row[]; const claims = publicationData.claims as readonly Row[]; const freshness = publicationData.freshness as readonly Row[]; const actions = publicationData.actions as readonly Row[]; const messages = publicationData.messages as readonly Row[];
    if (artifacts.length !== 1 || challenges.length !== 1 || approvals.length !== 1 || approvals[0]!.state !== "APPROVED" || claims.length !== 1 || claims[0]!.state !== "CONFIRMED" || freshness.length !== 1 || freshness[0]!.state !== "CONSUMED") fail("completed Case lacks its approval/publication chain");
    if (!actions.some((action) => action.actionKind === "PUBLICATION" && action.state === "CONFIRMED" && action.dispatchedAt !== null && action.confirmedAt !== null) || !messages.some((message) => message.purpose === "PUBLICATION")) fail("completed Case lacks confirmed publication");
    if (!trace.ingress.some((receipt: Row) => receipt.eventKind === "choice.response_created" && receipt.ack.state === "ACK_CONFIRMED")) fail("completed Case lacks confirmed choice receipt ACK");
    return;
  }
  if (caseStatus === "OPEN" && ["FAILED", "REJECTED"].includes(workflowState)) fail("open Case has terminal Workflow state");
  if (caseStatus === "FAILED" && workflowState !== "FAILED") fail("failed Case has a non-terminal Workflow state");
  if (caseStatus === "REJECTED" && workflowState !== "REJECTED") fail("rejected Case has a non-terminal Workflow state");
  let rank = PHASE_RANK[workflowState] ?? 0;
  if (workflowState === "FAILED" || workflowState === "REJECTED") {
    rank = waitRows.length > 0 ? 1 : 0;
    for (const node of ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"] as const) { const invocation = invocations.get(node); if (invocation !== undefined) { const nodeRank = PHASE_RANK[node]!; rank = Math.max(rank, nodeRank); if (winnerFor(invocation) !== undefined) rank = Math.max(rank, nodeRank + 0.5); } }
    if ((decision.artifacts as readonly Row[]).length > 0) rank = Math.max(rank, 6);
    if ((publicationData.claims as readonly Row[]).length > 0 || (publicationData.freshness as readonly Row[]).length > 0) rank = Math.max(rank, 7);
    if (workflowState === "REJECTED" && (decision.approvals as readonly Row[]).some((approval) => approval.state === "REJECTED")) rank = 6;
  }
  if (trace.ingress.length === 0) fail("active or terminal Case lacks ingress authority");
  if (rank >= 1 && waitRows.length === 0 && workflowState !== "INTAKE") fail("Case phase lacks clarification authority");
  const requiredNodes = rank >= 2 ? ["RESEARCHER"] : [];
  if (rank >= 3) requiredNodes.push("ANALYST");
  if (rank >= 4) requiredNodes.push("REVIEWER");
  if (rank >= 5) requiredNodes.push("WRITER");
  for (const node of requiredNodes) { const invocation = invocations.get(node); if (invocation === undefined) fail(`Case phase lacks ${node} Invocation`); if (rank > PHASE_RANK[node]! && (invocation.status !== "RESULT_COMMITTED" || winnerFor(invocation) === undefined)) fail(`Case phase lacks completed ${node} result`); }
  if (rank >= 6) { const artifacts = decision.artifacts as readonly Row[]; const challenges = decision.challenges as readonly Row[]; if (artifacts.length === 0 || challenges.length === 0) fail("approval phase lacks Artifact/challenge authority"); if (workflowState === "REJECTED" && !(decision.approvals as readonly Row[]).some((approval) => approval.state === "REJECTED")) fail("rejected Case lacks its rejection decision"); }
  if (rank >= 7 && (publicationData.claims as readonly Row[]).length === 0 && workflowState !== "FAILED") fail("publication phase lacks Response Claim");
  if (rank >= 8 && (publicationData.freshness as readonly Row[]).length === 0 && workflowState !== "FAILED") fail("publish phase lacks Freshness authority");
}

export interface GeneratedR003CaseTrace {
  readonly trace: Readonly<Record<string, unknown>>;
  readonly canonicalBytes: string;
  readonly sha256: string;
}

function validateAuthoritySnapshot(database: DatabaseSync): void {
  const actual = rows(database, "SELECT version, migration_id, migration_sha256, schema_fingerprint FROM accord_schema_migrations ORDER BY version");
  const expected = loadAuthorityMigrations();
  if (actual.length !== expected.length || actual.some((row, index) => { const migration = expected[index]; return migration === undefined || integer(row, "version") !== migration.version || text(row, "migration_id") !== migration.id || hex(row, "migration_sha256") !== migration.sha256 || hex(row, "schema_fingerprint") !== migration.schemaFingerprint; })) fail("authority schema is not at the pinned R003 migration chain");
  if (one(database, "PRAGMA integrity_check")?.["integrity_check"] !== "ok") fail("SQLite integrity check failed");
  if (rows(database, "PRAGMA foreign_key_check").length !== 0) fail("SQLite foreign-key check failed");
}

function assertTraceBudget(database: DatabaseSync, maxBytes: number): void {
  const auditCount = Number((one(database, "SELECT COUNT(*) AS count FROM audit_events") ?? { count: 0 }).count);
  if (auditCount > Math.max(1, Math.floor(maxBytes / 128))) throw new CaseTraceError("OUTPUT_LIMIT", "Case Trace exceeds its output limit");
}

/** Projects one complete, allowlisted and deterministic Case Trace from a validated authority snapshot. */
export function generateR003CaseTrace(database: DatabaseSync, suppliedCaseId: unknown, maxBytes = R003_CASE_TRACE_MAX_BYTES): GeneratedR003CaseTrace {
  const caseId: CaseId = parseCaseId(suppliedCaseId);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > R003_CASE_TRACE_MAX_BYTES) throw new TypeError("maxBytes must be a positive integer no greater than 1 MiB");
  try {
    database.exec("BEGIN DEFERRED");
    validateAuthoritySnapshot(database);
    assertTraceBudget(database, maxBytes);
    const identity = one(database, `SELECT c.case_id, c.schema_version AS case_schema_version, c.status AS case_status, c.board_id, c.workflow_run_id,
        c.source_app_id, c.source_conversation_id, c.source_message_id, c.created_at AS case_created_at,
        b.schema_version AS board_schema_version, b.revision AS board_revision, b.created_at AS board_created_at,
        w.schema_version AS workflow_schema_version, w.workflow_definition_id, w.state AS workflow_state, w.revision AS workflow_revision, w.created_at AS workflow_created_at,
        d.definition_version, d.definition_digest
      FROM cases c LEFT JOIN boards b ON b.board_id = c.board_id AND b.case_id = c.case_id
      LEFT JOIN workflow_runs w ON w.workflow_run_id = c.workflow_run_id AND w.case_id = c.case_id
      LEFT JOIN workflow_definitions d ON d.workflow_definition_id = w.workflow_definition_id WHERE c.case_id = ?`, caseId);
    if (identity === undefined) throw new CaseTraceError("UNKNOWN_CASE", `unknown Case ${caseId}`);
    if (identity["board_schema_version"] === null || identity["workflow_schema_version"] === null || identity["workflow_definition_id"] === null || identity["definition_version"] === null || identity["definition_digest"] === null) fail(`Case ${caseId} has missing Board, Workflow or definition authority`);
    const boardId = id(identity, "board_id", "board_", 70); const workflowRunId = id(identity, "workflow_run_id", "run_", 68); const boardRevision = integer(identity, "board_revision");
    const input = ingress(database, caseId, boardId, workflowRunId);
    const entries = boardEntries(database, caseId, boardId, boardRevision);
    const waits = waitChallenges(database, caseId, boardId, workflowRunId);
    const runtimeRows = runtime(database, caseId, boardId, workflowRunId);
    const decision = artifactAndDecision(database, caseId, boardId, workflowRunId);
    const publicationRows = publication(database, caseId, boardId, workflowRunId);
    const auditRows = audit(database, caseId, boardId, workflowRunId);
    const referencedSourceIds = new Set<string>();
    for (const entry of entries) { for (const reference of entry.sourceRefs as readonly string[]) if (reference.startsWith("source_")) referencedSourceIds.add(reference); const payload = record(entry.payload, "Board payload"); if (typeof payload.sourceId === "string") referencedSourceIds.add(payload.sourceId); }
    for (const invocation of runtimeRows) for (const sourceId of record(invocation.context, "Context").sourceIds as readonly string[]) referencedSourceIds.add(sourceId);
    const sources = sourceRows(database, [...referencedSourceIds].sort());
    const trace: Row = {
      schemaVersion: R003_CASE_TRACE_VERSION,
      redactionPolicyVersion: R003_CASE_TRACE_REDACTION_VERSION,
      identity: { caseId, caseSchemaVersion: text(identity, "case_schema_version"), caseStatus: text(identity, "case_status"), boardId, boardSchemaVersion: text(identity, "board_schema_version"), boardRevision, workflowRunId, workflowSchemaVersion: text(identity, "workflow_schema_version"), workflowDefinitionId: text(identity, "workflow_definition_id"), workflowDefinitionVersion: text(identity, "definition_version"), workflowDefinitionDigest: hex(identity, "definition_digest"), workflowState: text(identity, "workflow_state"), workflowRevision: integer(identity, "workflow_revision"), sourceAppId: externalString(identity["source_app_id"], "source appId"), sourceConversationId: externalString(identity["source_conversation_id"], "source conversationId"), sourceMessageId: externalString(identity["source_message_id"], "source messageId"), caseCreatedAt: instant(identity, "case_created_at"), boardCreatedAt: instant(identity, "board_created_at"), workflowCreatedAt: instant(identity, "workflow_created_at") },
      ingress: input,
      sources,
      runtime: runtimeRows,
      boardEntries: entries,
      waitChallenges: waits,
      artifactAndDecision: decision,
      publication: publicationRows,
      audit: auditRows,
    };
    const identityProjection = record(trace.identity, "identity");
    if (text(identityProjection, "workflowDefinitionId") !== FIXED_WORKFLOW_DEFINITION_ID || text(identityProjection, "workflowDefinitionVersion") !== FIXED_WORKFLOW_DEFINITION || text(identityProjection, "caseSchemaVersion") !== CONTRACT_VERSIONS.case || text(identityProjection, "boardSchemaVersion") !== CONTRACT_VERSIONS.board || text(identityProjection, "workflowSchemaVersion") !== CONTRACT_VERSIONS.workflowRun) fail("Case uses an unsupported fixed authority definition");
    assertRelations(trace);
    assertPhaseCompleteness(trace);
    const canonicalBytes = json(trace);
    if (Buffer.byteLength(canonicalBytes, "utf8") > maxBytes) throw new CaseTraceError("OUTPUT_LIMIT", "Case Trace exceeds its output limit");
    database.exec("COMMIT");
    return Object.freeze({ trace: canonical(trace) as Readonly<Record<string, unknown>>, canonicalBytes, sha256: digest(canonicalBytes) });
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Preserve the projection failure. */ }
    if (error instanceof CaseTraceError) throw error;
    throw new CaseTraceError("INCOMPLETE_AUTHORITY", "Case Trace projection failed", { cause: error });
  }
}
