import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  parseAuditCorrelationId, parseAuditEventId, parseBoardEntryId, parseBoardId, parseCaseId,
  parseContextId, parseInvocationId, parseResultId, parseSourceId, parseWorkflowRunId,
  type AuditCorrelationId, type AuditEventId, type BoardEntryId,
} from "./core/ids.js";
import { readFixedProfileContext } from "./profile-context.js";
import { reconstructGenericWinnerMaterialization, reconstructWinnerBoardEntries, type ExpectedRuntimeBoardEntry } from "./researcher-analyst.js";
import type { DurableGenericMaterialization } from "./profile-runtime.js";
import {
  PROFILE_CONTEXT_AUDIT_EVENT_KIND, PROFILE_CONTEXT_DECISION_VERSION, PROFILE_CONTEXT_REQUEST_VERSION,
  PROFILE_CONTEXT_VIEW_VERSION, type ProfileContextDecision, type ProfileContextDecisionReason,
  type ProfileContextDecisionRequest, type ProfileContextDecisionValue, type ProfileContextEntryRef,
  type ProfileContextEntryType, type ProfileContextOperation, type ProjectedProfileContextEntry,
  type ReviewerContextView, type WriterContextBoundary,
} from "./contracts/profile-context.js";
import type { ReviewerHandoffTarget } from "./contracts/researcher-analyst-handoff.js";
const OPERATIONS: Record<ProfileContextOperation, true> = {
  READ_CONTEXT: true, READ_BOARD_ENTRY: true, READ_CREDENTIALS: true, READ_HIDDEN_REASONING: true,
  READ_PRIVATE_RUNTIME_HISTORY: true, READ_UNRELATED_SOURCE: true, APPEND_EVIDENCE: true, MUTATE_TARGET: true,
  CREATE_APPROVAL: true, PUBLISH_RESPONSE: true, SET_ARTIFACT_ELIGIBILITY: true, MUTATE_WORKFLOW_INSTRUCTIONS: true,
};
const REASONS: Record<ProfileContextDecisionReason, true> = {
  CURRENT_CONTEXT: true, CONTEXT_NOT_FOUND: true, CONTEXT_BINDING_MISMATCH: true, STALE_CONTEXT: true, TARGET_MISMATCH: true,
  INCOMPLETE_CITED_GRAPH: true, ENTRY_OUTSIDE_CONTEXT: true, PROTECTED_RESOURCE: true, AUTHORITY_ESCALATION: true, OPERATION_NOT_ALLOWED: true,
};
const ENTRY_TYPES: Record<ProfileContextEntryType, true> = { Proposal: true, Claim: true, Observation: true, EvidenceRef: true, Critique: true, VerificationResult: true };
const PROTECTED: Partial<Record<ProfileContextOperation, true>> = { READ_CREDENTIALS: true, READ_HIDDEN_REASONING: true, READ_PRIVATE_RUNTIME_HISTORY: true, READ_UNRELATED_SOURCE: true };
const AUTHORITY: Partial<Record<ProfileContextOperation, true>> = { APPEND_EVIDENCE: true, MUTATE_TARGET: true, CREATE_APPROVAL: true, PUBLISH_RESPONSE: true, SET_ARTIFACT_ELIGIBILITY: true, MUTATE_WORKFLOW_INSTRUCTIONS: true };
const ENTRY_ID = /^entry_[0-9a-f]{64}$/u;
const SOURCE_ID = /^source_[0-9a-f]{64}$/u;
const MAX_RELATION_ENTRIES = 16;
const MAX_SELECTED_ENTRIES = 128;
const MAX_RELATION_JSON_BYTES = 2_048;
const MAX_SELECTED_JSON_BYTES = 64 * 1_024;
const MAX_WINNER_OUTPUT_BYTES = 256 * 1_024;
const MAX_CLOSURE_ENTRIES = 96;
const MAX_REVIEW_ENTRIES = 16;
const MAX_VIEW_ENTRIES = MAX_CLOSURE_ENTRIES + MAX_REVIEW_ENTRIES;
const MAX_PAYLOAD_BYTES = 16_384;
const MAX_VIEW_BYTES = 2 * 1_024 * 1_024;
const MAX_AUDIT_BYTES = 3 * 1_024 * 1_024;
let savepointSequence = 0;
type Row = Record<string, unknown>;
type LoadedEntry = Readonly<{ projected: ProjectedProfileContextEntry; basedOn: readonly string[]; sourceRefs: readonly string[]; createdRevision: number }>;
type RequestIdentity = Readonly<{ requestId: string; correlationId: AuditCorrelationId }>;
class ProjectionFailure extends Error { constructor(readonly reason: ProfileContextDecisionReason, message: string = reason) { super(message); } }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])); return value; }
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function sha(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : json(value), "utf8").digest("hex"); }
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function record(value: unknown, label: string): Row { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Row; }
function exact(value: Row, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an unsupported or missing field`); }
function scalar(value: unknown, label: string, max = 160): string { if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /[\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError(`${label} must be a bounded trimmed string`); return value; }
function hex(value: unknown, label: string): string { const result = scalar(value, label, 64); if (!/^[0-9a-f]{64}$/u.test(result)) throw new TypeError(`${label} must be a SHA-256 digest`); return result; }
function integer(value: unknown, label: string, minimum = 0): number { if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new TypeError(`${label} must be a safe integer`); return value as number; }
function instant(value: unknown, label: string): string { const result = scalar(value, label, 32); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || new Date(result).toISOString() !== result) throw new TypeError(`${label} must be a canonical UTC instant`); return result; }
function relation(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_RELATION_ENTRIES || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH", `${label} is invalid`);
  return value as readonly string[];
}
function parsedJson(value: unknown, label: string, maxBytes?: number): unknown {
  if (typeof value !== "string" || maxBytes !== undefined && Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} is invalid`);
  try { return JSON.parse(value) as unknown; } catch { throw new Error(`${label} is invalid`); }
}
function entryRef(value: unknown, label: string): ProfileContextEntryRef { const item = record(value, label); exact(item, ["id", "type", "digest"], label); const type = item["type"]; if (ENTRY_TYPES[type as ProfileContextEntryType] !== true) throw new TypeError(`${label}.type is unsupported`); return freeze({ id: parseBoardEntryId(item["id"]), type: type as ProfileContextEntryType, digest: hex(item["digest"], `${label}.digest`) }); }
function selectedEntry(value: unknown): Readonly<{ id: BoardEntryId; digest: string }> { const item = record(value, "selected Context entry"); exact(item, ["id", "type", "digest"], "selected Context entry"); scalar(item["type"], "selected Context entry.type", 32); return { id: parseBoardEntryId(item["id"]), digest: hex(item["digest"], "selected Context entry.digest") }; }
function target(value: unknown): ReviewerHandoffTarget { const item = record(value, "target"); exact(item, ["boardId", "caseId", "invocationId", "proposalBoardRevision", "proposalDigest", "proposalId", "resultId", "runId", "supportStatus", "workflowNode"], "target"); if (item["supportStatus"] !== "UNSUPPORTED" || item["workflowNode"] !== "REVIEWER") throw new TypeError("target contract is invalid"); return freeze({ boardId: parseBoardId(item["boardId"]), caseId: parseCaseId(item["caseId"]), invocationId: parseInvocationId(item["invocationId"]), proposalBoardRevision: integer(item["proposalBoardRevision"], "target.proposalBoardRevision", 1), proposalDigest: hex(item["proposalDigest"], "target.proposalDigest"), proposalId: parseBoardEntryId(item["proposalId"]), resultId: parseResultId(item["resultId"]), runId: parseWorkflowRunId(item["runId"]), supportStatus: "UNSUPPORTED", workflowNode: "REVIEWER" }); }
function normalizeRequest(value: unknown): ProfileContextDecisionRequest { const item = record(value, "Profile Context request"); exact(item, ["schemaVersion", "requestId", "requestTime", "operation", "caseId", "workflowRunId", "boardId", "boardRevision", "workflowRevision", "profile", "context", "target", "requestedEntry"], "Profile Context request"); if (item["schemaVersion"] !== PROFILE_CONTEXT_REQUEST_VERSION) throw new TypeError("request schemaVersion is unsupported"); const operation = item["operation"]; const profile = item["profile"]; if (OPERATIONS[operation as ProfileContextOperation] !== true || (profile !== "REVIEWER" && profile !== "WRITER")) throw new TypeError("request operation or Profile is unsupported"); const context = record(item["context"], "request.context"); exact(context, ["invocationId", "contextId", "contextDigest"], "request.context"); return freeze({ schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId: scalar(item["requestId"], "requestId"), requestTime: instant(item["requestTime"], "requestTime"), operation: operation as ProfileContextOperation, caseId: parseCaseId(item["caseId"]), workflowRunId: parseWorkflowRunId(item["workflowRunId"]), boardId: parseBoardId(item["boardId"]), boardRevision: integer(item["boardRevision"], "boardRevision"), workflowRevision: integer(item["workflowRevision"], "workflowRevision", 1), profile, context: freeze({ invocationId: parseInvocationId(context["invocationId"]), contextId: parseContextId(context["contextId"]), contextDigest: hex(context["contextDigest"], "contextDigest") }), target: target(item["target"]), requestedEntry: item["requestedEntry"] === null ? null : entryRef(item["requestedEntry"], "requestedEntry") }); }
function requestIdentity(requestId: string): RequestIdentity {
  return { requestId, correlationId: parseAuditCorrelationId(`corr_${sha(`accord.r003/profile-context-request\0${json([requestId])}`)}`) };
}
function decisionAuditEventId(requestId: string, fingerprint: string, dispositionDigest: string): AuditEventId {
  return parseAuditEventId(`audit_${sha(`accord.r003/profile-context-decision\0${json([requestId, fingerprint, dispositionDigest])}`)}`);
}
function queryDecision(database: DatabaseSync, identity: RequestIdentity): Row | undefined {
  const rows = database.prepare("SELECT * FROM audit_events WHERE event_kind = ? AND (correlation_id = ? OR json_extract(details_json, '$.request.requestId') = ?) LIMIT 2").all(PROFILE_CONTEXT_AUDIT_EVENT_KIND, identity.correlationId, identity.requestId) as Row[];
  if (rows.length > 1) throw new Error("persisted Profile Context decision identity is corrupt");
  return rows[0];
}
function projected(value: unknown, label: string): ProjectedProfileContextEntry {
  const item = record(value, label); exact(item, ["kind", "id", "type", "digest", "payload", "basedOn", "sourceRefs"], label);
  if (item["kind"] !== "BOARD_ENTRY") throw new Error(`${label} kind is invalid`);
  const ref = entryRef({ id: item["id"], type: item["type"], digest: item["digest"] }, label);
  const payload = freeze(canonical(record(item["payload"], `${label}.payload`)) as Record<string, unknown>); const basedOnRaw = relation(item["basedOn"], `${label}.basedOn`); const sourceRefsRaw = relation(item["sourceRefs"], `${label}.sourceRefs`);
  if (new Set([...basedOnRaw, ...sourceRefsRaw]).size !== basedOnRaw.length + sourceRefsRaw.length || Buffer.byteLength(json(payload), "utf8") > MAX_PAYLOAD_BYTES) throw new Error(`${label} projection is invalid`);
  const basedOn = Object.freeze(basedOnRaw.map(parseBoardEntryId)); const sourceRefs = Object.freeze(sourceRefsRaw.map((reference) => ref.type === "EvidenceRef" ? parseSourceId(reference) : parseBoardEntryId(reference)));
  return freeze({ kind: "BOARD_ENTRY", ...ref, payload, basedOn, sourceRefs });
}
function normalizeValue(value: unknown, request: ProfileContextDecisionRequest): ProfileContextDecisionValue {
  const item = record(value, "decision value");
  if (item["kind"] === "BOARD_ENTRY") {
    const entry = projected(item, "decision value");
    if (request.profile !== "REVIEWER" || request.operation !== "READ_BOARD_ENTRY" || request.requestedEntry === null || entry.id !== request.requestedEntry.id || entry.type !== request.requestedEntry.type || entry.digest !== request.requestedEntry.digest) throw new Error("persisted Board-entry decision binding is invalid");
    return entry;
  }
  const common = ["schemaVersion", "kind", "caseId", "workflowRunId", "boardId", "boardRevision", "workflowRevision", "profile", "profileVersion", "outputSchema", "context", "target", "entries"] as const;
  exact(item, item["kind"] === "WRITER_BOUNDARY" ? [...common, "outputAvailable"] : common, "decision value");
  if (item["schemaVersion"] !== PROFILE_CONTEXT_VIEW_VERSION || item["caseId"] !== request.caseId || item["workflowRunId"] !== request.workflowRunId || item["boardId"] !== request.boardId || item["boardRevision"] !== request.boardRevision || item["workflowRevision"] !== request.workflowRevision || json(item["context"]) !== json(request.context) || json(item["target"]) !== json(request.target) || item["profile"] !== request.profile) throw new Error("persisted decision view binding is invalid");
  const entries = item["entries"];
  if (!Array.isArray(entries) || entries.length > MAX_VIEW_ENTRIES) throw new Error("persisted decision entries are invalid");
  const base = { schemaVersion: PROFILE_CONTEXT_VIEW_VERSION, caseId: request.caseId, workflowRunId: request.workflowRunId, boardId: request.boardId, boardRevision: request.boardRevision, workflowRevision: request.workflowRevision, context: request.context, target: request.target, profileVersion: scalar(item["profileVersion"], "profileVersion"), outputSchema: scalar(item["outputSchema"], "outputSchema") } as const;
  let normalized: ReviewerContextView | WriterContextBoundary;
  if (item["kind"] === "REVIEWER_CONTEXT" && request.profile === "REVIEWER") normalized = freeze({ ...base, kind: "REVIEWER_CONTEXT", profile: "REVIEWER", entries: entries.map((entry, index) => projected(entry, `entries[${index}]`)) });
  else if (item["kind"] === "WRITER_BOUNDARY" && request.profile === "WRITER" && item["outputAvailable"] === false) normalized = freeze({ ...base, kind: "WRITER_BOUNDARY", profile: "WRITER", entries: entries.map((entry, index) => entryRef(entry, `entries[${index}]`)), outputAvailable: false as const });
  else throw new Error("persisted decision view kind is invalid");
  const ids = normalized.entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || Buffer.byteLength(json(normalized), "utf8") > MAX_VIEW_BYTES) throw new Error("persisted decision view exceeds its bounds");
  return normalized;
}
function replay(database: DatabaseSync, fingerprint: string, identity: RequestIdentity): ProfileContextDecision | undefined {
  const row = queryDecision(database, identity);
  if (row === undefined) return undefined;
  if (row["schema_version"] !== "accord.audit-event/v1" || row["correlation_id"] !== identity.correlationId || row["event_kind"] !== PROFILE_CONTEXT_AUDIT_EVENT_KIND || row["receipt_id"] !== null) throw new Error("persisted Profile Context decision row is invalid");
  const details = record(parsedJson(row["details_json"], "decision details", MAX_AUDIT_BYTES), "decision details");
  exact(details, ["schemaVersion", "request", "requestFingerprint", "decision", "decisionDigest"], "decision details");
  if (details["schemaVersion"] !== PROFILE_CONTEXT_DECISION_VERSION) throw new Error("persisted decision schema is invalid");
  const storedRequest = normalizeRequest(details["request"]); const storedFingerprint = hex(details["requestFingerprint"], "stored request fingerprint");
  if (requestIdentity(storedRequest.requestId).correlationId !== identity.correlationId || storedFingerprint !== sha(storedRequest)) throw new Error("persisted request fingerprint is invalid");
  const decision = record(details["decision"], "persisted decision");
  exact(decision, ["schemaVersion", "auditEventId", "correlationId", "requestId", "requestFingerprint", "requestTime", "operation", "outcome", "reason", "value"], "persisted decision");
  const dispositionDigest = sha({ outcome: decision["outcome"], reason: decision["reason"], value: decision["value"] });
  const expectedAuditEventId = decisionAuditEventId(storedRequest.requestId, storedFingerprint, dispositionDigest);
  if (row["audit_event_id"] !== expectedAuditEventId || hex(details["decisionDigest"], "decision digest") !== sha(decision) || decision["schemaVersion"] !== PROFILE_CONTEXT_DECISION_VERSION || decision["auditEventId"] !== expectedAuditEventId || decision["correlationId"] !== identity.correlationId || decision["requestId"] !== storedRequest.requestId || decision["requestFingerprint"] !== storedFingerprint || decision["requestTime"] !== storedRequest.requestTime || decision["operation"] !== storedRequest.operation || row["recorded_at"] !== storedRequest.requestTime) throw new Error("persisted Profile Context decision tuple is invalid");
  if (storedFingerprint !== fingerprint) throw new Error("Profile Context request identity conflict");
  const outcome = decision["outcome"]; const reason = decision["reason"];
  if ((outcome !== "ALLOW" && outcome !== "DENY") || REASONS[reason as ProfileContextDecisionReason] !== true || (outcome === "ALLOW") !== (reason === "CURRENT_CONTEXT") || (outcome === "DENY") !== (decision["value"] === null)) throw new Error("persisted Profile Context decision disposition is invalid");
  const value = outcome === "ALLOW" ? normalizeValue(decision["value"], storedRequest) : null;
  const normalized = freeze({ schemaVersion: PROFILE_CONTEXT_DECISION_VERSION, auditEventId: expectedAuditEventId, correlationId: identity.correlationId, requestId: storedRequest.requestId, requestFingerprint: storedFingerprint, requestTime: storedRequest.requestTime, operation: storedRequest.operation, outcome, reason: reason as ProfileContextDecisionReason, value } satisfies ProfileContextDecision);
  if (json(decision) !== json(normalized) || row["case_id"] !== (outcome === "ALLOW" ? storedRequest.caseId : null) || row["board_id"] !== (outcome === "ALLOW" ? storedRequest.boardId : null) || row["workflow_run_id"] !== (outcome === "ALLOW" ? storedRequest.workflowRunId : null)) throw new Error("persisted Profile Context decision snapshot is invalid");
  return normalized;
}
function loaded(row: Row, boardRevision: number): LoadedEntry {
  try {
    const type = row["entry_type"];
    if (ENTRY_TYPES[type as ProfileContextEntryType] !== true || row["status"] !== "CANDIDATE" && row["status"] !== "ACCEPTED" || row["visibility"] !== "CASE" || row["instruction_authority"] !== "NONE") throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    const createdRevision = integer(row["created_revision"], "entry revision", 1);
    if (createdRevision > boardRevision) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    const payload = freeze(canonical(record(parsedJson(row["payload_json"], "entry payload", MAX_PAYLOAD_BYTES), "entry payload")) as Record<string, unknown>);
    if (Buffer.byteLength(json(payload), "utf8") > MAX_PAYLOAD_BYTES) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    const basedOn = relation(parsedJson(row["based_on_json"], "basedOn", MAX_RELATION_JSON_BYTES), "basedOn"); const sourceRefs = relation(parsedJson(row["source_refs_json"], "sourceRefs", MAX_RELATION_JSON_BYTES), "sourceRefs");
    if (new Set([...basedOn, ...sourceRefs]).size !== basedOn.length + sourceRefs.length) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    const projectionBasedOn = Object.freeze(basedOn.map(parseBoardEntryId)); const projectionSourceRefs = Object.freeze(sourceRefs.map((reference) => type === "EvidenceRef" ? parseSourceId(reference) : parseBoardEntryId(reference)));
    return freeze({ projected: freeze({ kind: "BOARD_ENTRY", id: parseBoardEntryId(row["board_entry_id"]), type: type as ProfileContextEntryType, digest: hex(row["content_digest"], "entry digest"), payload, basedOn: projectionBasedOn, sourceRefs: projectionSourceRefs }), basedOn, sourceRefs, createdRevision });
  } catch (error) {
    if (error instanceof ProjectionFailure) throw error;
    throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH", "persisted cited entry is invalid");
  }
}
function fetchEntry(database: DatabaseSync, id: BoardEntryId, request: ProfileContextDecisionRequest): LoadedEntry {
  const row = database.prepare("SELECT * FROM board_entries WHERE board_entry_id = ? AND case_id = ? AND board_id = ?").get(id, request.caseId, request.boardId) as Row | undefined;
  if (row === undefined) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
  return loaded(row, request.boardRevision);
}
function exactTarget(database: DatabaseSync, request: ProfileContextDecisionRequest, selected: ReadonlyMap<string, string>): LoadedEntry {
  if (request.target.caseId !== request.caseId || request.target.runId !== request.workflowRunId || request.target.boardId !== request.boardId || request.target.proposalBoardRevision > request.boardRevision) throw new ProjectionFailure("TARGET_MISMATCH");
  const winners = database.prepare(`SELECT result.output_json, invocation.board_revision
    FROM runtime_results result
    JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER'
    JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id
    WHERE result.result_id = ? AND invocation.invocation_id = ? AND invocation.case_id = ? AND invocation.workflow_run_id = ? AND invocation.board_id = ? AND invocation.node_id = 'ANALYST' AND invocation.status = 'RESULT_COMMITTED' LIMIT 2`)
    .all(request.target.resultId, request.target.invocationId, request.caseId, request.workflowRunId, request.boardId) as Row[];
  if (winners.length !== 1) throw new ProjectionFailure("TARGET_MISMATCH");
  let expectedEntries: readonly ExpectedRuntimeBoardEntry[];
  try { expectedEntries = reconstructWinnerBoardEntries(database, request.target.invocationId, parsedJson(winners[0]!["output_json"], "Analyst winner output", MAX_WINNER_OUTPUT_BYTES)); }
  catch { throw new ProjectionFailure("TARGET_MISMATCH"); }
  const claims = expectedEntries.filter((entry) => entry.type === "Claim" && json(entry.payload) === json({ statement: "Customer adoption is guaranteed.", unsupported: true }) && entry.basedOn.length === 0 && entry.sourceRefs.length === 0);
  const proposals = expectedEntries.filter((entry) => entry.type === "Proposal" && json(entry.payload) === json({ action: "Promise adoption.", supportStatus: "UNSUPPORTED" }) && entry.basedOn.length === 1 && entry.basedOn[0] === claims[0]?.entryId && entry.sourceRefs.length === 0);
  if (claims.length !== 1 || proposals.length !== 1) throw new ProjectionFailure("TARGET_MISMATCH");
  const proposal = proposals[0]!; const proposalBoardRevision = integer(winners[0]!["board_revision"], "Analyst Board revision") + 1;
  const expectedTarget = { boardId: request.boardId, caseId: request.caseId, invocationId: request.target.invocationId, proposalBoardRevision, proposalDigest: proposal.contentDigest, proposalId: proposal.entryId, resultId: request.target.resultId, runId: request.workflowRunId, supportStatus: "UNSUPPORTED", workflowNode: "REVIEWER" };
  if (json(request.target) !== json(expectedTarget)) throw new ProjectionFailure("TARGET_MISMATCH");
  const root = fetchEntry(database, proposal.entryId, request);
  if (root.projected.digest !== proposal.contentDigest || selected.get(root.projected.id) !== root.projected.digest) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
  return root;
}
function project(database: DatabaseSync, request: ProfileContextDecisionRequest, selected: ReadonlyMap<string, string>, profileVersion: string, outputSchema: string): ReviewerContextView | WriterContextBoundary {
  const root = exactTarget(database, request, selected);
  const byId = new Map<string, LoadedEntry>([[root.projected.id, root]]); const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (entry: LoadedEntry): void => {
    if (visiting.has(entry.projected.id)) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    if (visited.has(entry.projected.id)) return;
    visiting.add(entry.projected.id);
    if (entry.projected.type === "EvidenceRef") {
      if (entry.basedOn.length !== 0 || entry.sourceRefs.length === 0 || entry.sourceRefs.some((reference) => !SOURCE_ID.test(reference))) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    } else {
      if (entry.basedOn.some((reference) => !ENTRY_ID.test(reference)) || entry.sourceRefs.some((reference) => !ENTRY_ID.test(reference))) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
      for (const [relationKind, references] of [["basedOn", entry.basedOn], ["sourceRefs", entry.sourceRefs]] as const) {
        for (const reference of references) {
          let child = byId.get(reference);
          if (child === undefined) {
            child = fetchEntry(database, parseBoardEntryId(reference), request);
            if (selected.get(child.projected.id) !== child.projected.digest || byId.size >= MAX_CLOSURE_ENTRIES) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
            byId.set(reference, child);
          }
          const childType = child.projected.type;
          const legal = relationKind === "sourceRefs" ? childType === "EvidenceRef" : entry.projected.type === "Proposal" ? childType === "Claim" || childType === "EvidenceRef" : entry.projected.type === "Claim" ? childType === "EvidenceRef" || childType === "Observation" : entry.projected.type === "Observation" && childType === "Observation";
          if (!legal || childType === "Critique" || childType === "VerificationResult" || childType === "Proposal") throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
          visit(child);
        }
      }
    }
    visiting.delete(entry.projected.id); visited.add(entry.projected.id);
  };
  visit(root);
  const plantedClaim = byId.get(root.basedOn[0] ?? "");
  if (json(root.projected.payload) !== json({ action: "Promise adoption.", supportStatus: "UNSUPPORTED" }) || root.basedOn.length !== 1 || root.sourceRefs.length !== 0 || plantedClaim?.projected.type !== "Claim" || json(plantedClaim.projected.payload) !== json({ statement: "Customer adoption is guaranteed.", unsupported: true }) || plantedClaim.basedOn.length !== 0 || plantedClaim.sourceRefs.length !== 0) throw new ProjectionFailure("TARGET_MISMATCH");
  const reviewRows = database.prepare(`SELECT entry.*, result.result_id AS review_result_id, invocation.invocation_id AS review_invocation_id
    FROM board_entries entry
    JOIN runtime_result_entries link ON link.board_entry_id = entry.board_entry_id
    JOIN runtime_results result ON result.result_id = link.result_id
    JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER'
    JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id
    WHERE entry.case_id = ? AND entry.board_id = ? AND entry.entry_type IN ('Critique','VerificationResult') AND entry.created_revision <= ? AND entry.status IN ('CANDIDATE','ACCEPTED') AND entry.visibility = 'CASE' AND entry.instruction_authority = 'NONE' AND invocation.node_id = 'REVIEWER' AND invocation.case_id = entry.case_id AND invocation.workflow_run_id = ? AND invocation.status = 'RESULT_COMMITTED'
    ORDER BY entry.created_revision, entry.board_entry_id LIMIT ${MAX_REVIEW_ENTRIES + 1}`).all(request.caseId, request.boardId, request.boardRevision, request.workflowRunId) as Row[];
  if (reviewRows.length > MAX_REVIEW_ENTRIES) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
  const relevant: LoadedEntry[] = []; const materializations = new Map<string, DurableGenericMaterialization | undefined>();
  for (const row of reviewRows) {
    const entry = loaded(row, request.boardRevision); const payloadTarget = Reflect.get(entry.projected.payload, "target"); const payloadTargetsEntry = payloadTarget !== null && typeof payloadTarget === "object" && Reflect.get(payloadTarget, "entryId") === request.target.proposalId; const pointsToTarget = entry.basedOn.includes(request.target.proposalId);
    if (!pointsToTarget && !payloadTargetsEntry) continue;
    if (!pointsToTarget || json(payloadTarget) !== json({ digest: request.target.proposalDigest, entryId: request.target.proposalId, type: "Proposal" }) || row["author_type"] !== "AGENT" || row["author_id"] !== "REVIEWER" || selected.get(entry.projected.id) !== entry.projected.digest) throw new ProjectionFailure("TARGET_MISMATCH");
    const invocationId = parseInvocationId(row["review_invocation_id"]); let materialization = materializations.get(invocationId);
    if (!materializations.has(invocationId)) {
      try { materialization = reconstructGenericWinnerMaterialization(database, invocationId); }
      catch { throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH"); }
      materializations.set(invocationId, materialization);
    }
    const exactEntry = materialization === undefined || materialization.resultId !== row["review_result_id"] ? undefined : materialization.boardEntries.find((candidate) => candidate.entryId === entry.projected.id);
    if (exactEntry === undefined || exactEntry.entryType !== entry.projected.type || exactEntry.contentDigest !== entry.projected.digest || json(exactEntry.payload) !== json(entry.projected.payload) || json(exactEntry.basedOn) !== json(entry.basedOn) || json(exactEntry.sourceRefs) !== json(entry.sourceRefs)) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
    relevant.push(entry);
  }
  const cited = [...byId.values()].filter((entry) => entry !== root).sort((a, b) => a.createdRevision - b.createdRevision || a.projected.id.localeCompare(b.projected.id));
  const projectedEntries = [root, ...cited, ...relevant].map((entry) => entry.projected); const entryIds = projectedEntries.map((entry) => entry.id);
  if (projectedEntries.length > MAX_VIEW_ENTRIES || new Set(entryIds).size !== entryIds.length) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
  const common = { schemaVersion: PROFILE_CONTEXT_VIEW_VERSION, caseId: request.caseId, workflowRunId: request.workflowRunId, boardId: request.boardId, boardRevision: request.boardRevision, workflowRevision: request.workflowRevision, context: request.context, target: request.target, profileVersion, outputSchema } as const;
  const view: ReviewerContextView | WriterContextBoundary = request.profile === "REVIEWER" ? freeze({ ...common, kind: "REVIEWER_CONTEXT", profile: "REVIEWER", entries: projectedEntries }) : freeze({ ...common, kind: "WRITER_BOUNDARY", profile: "WRITER", entries: projectedEntries.map(({ id, type, digest }) => freeze({ id, type, digest })), outputAvailable: false as const });
  if (Buffer.byteLength(json(view), "utf8") > MAX_VIEW_BYTES) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
  return view;
}
function append(database: DatabaseSync, request: ProfileContextDecisionRequest, fingerprint: string, identity: RequestIdentity, reason: ProfileContextDecisionReason, value: ProfileContextDecisionValue | null): ProfileContextDecision {
  const outcome = value === null ? "DENY" : "ALLOW";
  if ((outcome === "ALLOW") !== (reason === "CURRENT_CONTEXT")) throw new Error("Profile Context decision disposition is invalid");
  const dispositionDigest = sha({ outcome, reason, value }); const auditEventId = decisionAuditEventId(request.requestId, fingerprint, dispositionDigest);
  const decision = freeze({ schemaVersion: PROFILE_CONTEXT_DECISION_VERSION, auditEventId, correlationId: identity.correlationId, requestId: request.requestId, requestFingerprint: fingerprint, requestTime: request.requestTime, operation: request.operation, outcome, reason, value } satisfies ProfileContextDecision);
  const details = { schemaVersion: PROFILE_CONTEXT_DECISION_VERSION, request, requestFingerprint: fingerprint, decision, decisionDigest: sha(decision) }; const detailsJson = json(details);
  if (Buffer.byteLength(detailsJson, "utf8") > MAX_AUDIT_BYTES) throw new Error("Profile Context decision audit exceeds its bound");
  database.prepare("INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)").run(auditEventId, identity.correlationId, PROFILE_CONTEXT_AUDIT_EVENT_KIND, outcome === "ALLOW" ? request.caseId : null, outcome === "ALLOW" ? request.boardId : null, outcome === "ALLOW" ? request.workflowRunId : null, detailsJson, request.requestTime);
  return decision;
}
/** Decides and durably records one least-privilege fixed-Profile Context request. */
export function decideProfileContextAccess(database: DatabaseSync, input: ProfileContextDecisionRequest): ProfileContextDecision {
  const request = normalizeRequest(input); const fingerprint = sha(request); const identity = requestIdentity(request.requestId); const prior = replay(database, fingerprint, identity);
  if (prior !== undefined) return prior;
  const nested = (database as unknown as { readonly isTransaction?: boolean }).isTransaction === true; const savepoint = `reviewer_context_${savepointSequence += 1}`; database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const raced = replay(database, fingerprint, identity);
    if (raced !== undefined) { database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT"); return raced; }
    const fixedReason = PROTECTED[request.operation] === true ? "PROTECTED_RESOURCE" : AUTHORITY[request.operation] === true ? "AUTHORITY_ESCALATION" : request.operation === "READ_CONTEXT" && request.requestedEntry !== null || request.operation === "READ_BOARD_ENTRY" && (request.profile === "WRITER" || request.requestedEntry === null) ? "OPERATION_NOT_ALLOWED" : undefined;
    if (fixedReason !== undefined) {
      const denied = append(database, request, fingerprint, identity, fixedReason, null); database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT"); return denied;
    }
    const fixed = readFixedProfileContext(database, request.context.invocationId);
    let reason: ProfileContextDecisionReason; let value: ProfileContextDecisionValue | null = null;
    if (fixed === undefined) reason = "CONTEXT_NOT_FOUND";
    else if (fixed.caseId !== request.caseId || fixed.workflowRunId !== request.workflowRunId || fixed.boardId !== request.boardId || fixed.nodeId !== request.profile || fixed.invocationId !== request.context.invocationId || fixed.contextId !== request.context.contextId || fixed.contextDigest !== request.context.contextDigest) reason = "CONTEXT_BINDING_MISMATCH";
    else {
      const current = database.prepare("SELECT c.status, b.revision AS board_revision, w.revision AS workflow_revision, w.state FROM cases c JOIN boards b ON b.case_id = c.case_id JOIN workflow_runs w ON w.case_id = c.case_id AND w.board_id = b.board_id WHERE c.case_id = ? AND b.board_id = ? AND w.workflow_run_id = ?").get(request.caseId, request.boardId, request.workflowRunId) as Row | undefined;
      if (current === undefined) reason = "CONTEXT_BINDING_MISMATCH";
      else if (fixed.boardRevision !== request.boardRevision || fixed.workflowRevision !== request.workflowRevision || current["status"] !== "OPEN" || current["state"] !== request.profile || current["board_revision"] !== request.boardRevision || current["workflow_revision"] !== request.workflowRevision) reason = "STALE_CONTEXT";
      else {
        try {
          let selectedRaw: unknown;
          try { selectedRaw = parsedJson(fixed.selectedEntriesJson, "selected Context entries", MAX_SELECTED_JSON_BYTES); }
          catch { throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH"); }
          if (!Array.isArray(selectedRaw) || selectedRaw.length > MAX_SELECTED_ENTRIES) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH");
          const selected = new Map<string, string>();
          for (const item of selectedRaw) {
            let ref: Readonly<{ id: BoardEntryId; digest: string }>;
            try { ref = selectedEntry(item); } catch { throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH"); }
            if (selected.has(ref.id)) throw new ProjectionFailure("INCOMPLETE_CITED_GRAPH"); selected.set(ref.id, ref.digest);
          }
          const view = project(database, request, selected, fixed.profileVersion, fixed.outputSchema);
          if (request.operation === "READ_CONTEXT") { reason = "CURRENT_CONTEXT"; value = view; }
          else if (request.operation === "READ_BOARD_ENTRY" && view.kind === "REVIEWER_CONTEXT") { const found = view.entries.find((entry) => entry.id === request.requestedEntry!.id && entry.type === request.requestedEntry!.type && entry.digest === request.requestedEntry!.digest); if (found === undefined) reason = "ENTRY_OUTSIDE_CONTEXT"; else { reason = "CURRENT_CONTEXT"; value = found; } }
          else reason = "OPERATION_NOT_ALLOWED";
        } catch (error) { if (!(error instanceof ProjectionFailure)) throw error; reason = error.reason; }
      }
    }
    const decision = append(database, request, fingerprint, identity, reason, value); database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT"); return decision;
  } catch (error) { try { database.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK"); } catch { /* preserve original error */ } throw error; }
}
