import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isPromise } from "node:util/types";

import { CONTRACT_VERSIONS, FIXED_WORKFLOW_DEFINITION, FIXED_WORKFLOW_DEFINITION_ID } from "./contracts/versions.js";
import {
  deriveProfileContextId,
  deriveObservationEntryId,
  deriveProfileInvocationId,
  deriveRuntimeArrivalId,
  deriveRuntimeAttemptId,
  deriveRuntimeBoardEntryId,
  deriveRuntimeResultId,
  deriveRuntimeResponseId,
  deriveRuntimeProviderDeliveryId,
  deriveRuntimeOpaqueCompletionReceiptId,
  deriveSourceId,
  deriveRuntimeAuditCorrelationId,
  deriveRuntimeAuditEventId,
  parseArrivalId,
  parseAttemptId,
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseInboxReceiptId,
  parseInvocationId,
  parseResultId,
  parseResponseId,
  type ProviderDeliveryId,
  type OpaqueCompletionReceiptId,
  parseSourceId,
  parseWorkflowRunId,
  type AttemptId,
  type BoardEntryId,
  type BoardId,
  type CaseId,
  type ContextId,
  type InvocationId,
  type ResultId,
  type ArrivalId,
  type WorkflowRunId,
  type ResponseId,
  type SourceId,
} from "./core/ids.js";
import { persistFixedProfileContext, REVIEWER_OUTPUT_SCHEMA, REVIEWER_PROFILE_VERSION, WRITER_OUTPUT_SCHEMA, WRITER_PROFILE_VERSION } from "./profile-context.js";
import {
  assertInvocationBoundOutputContract,
  deriveDurableGenericMaterialization,
  materializeInvocationOutput,
  parseDurableGenericMaterialization,
  type DurableGenericMaterialization,
  type GenericBoardEntryCandidate,
  type GenericMaterializationCandidate,
  type InvocationBoundOutputContract,
} from "./profile-runtime.js";

/** The fixed, no-network provider boundary used by this Issue. */
export const NATIVE_BAIZHI_PROVIDER_PORT_VERSION = "accord.native-baizhi-provider-port/v1" as const;
export const RESEARCHER_PROFILE_VERSION = "accord.researcher/v1" as const;
export const ANALYST_PROFILE_VERSION = "accord.analyst/v1" as const;
export const RESEARCHER_OUTPUT_SCHEMA = "accord.researcher-output/v1" as const;
export const ANALYST_OUTPUT_SCHEMA = "accord.analyst-output/v1" as const;
export const RUNTIME_VERSION = "accord.native-turn-runtime/v1" as const;

export type Profile = "RESEARCHER" | "ANALYST" | "REVIEWER" | "WRITER";
type EntryType = GenericBoardEntryCandidate["entryType"];
export type ProviderMetadata = Readonly<{
  deploymentId: string;
  modelId: string;
  providerPortVersion: typeof NATIVE_BAIZHI_PROVIDER_PORT_VERSION;
  requestId: string;
  responseId: string;
}>;

export interface ApprovedSyntheticSource { readonly sourceId: SourceId; readonly sourceKind: string; readonly locator: string; readonly content: string; readonly observedAt: string; }
/**
 * This is repository authority, not application input.  Keeping the sole
 * approved source here makes it impossible for a first caller to install a
 * different source set into an otherwise empty authority database.
 */
export const TRUSTED_SYNTHETIC_SOURCE_INPUT = Object.freeze({
  content: "Synthetic policy permits a two-week decision window.",
  locator: "fixture://policy/two-week",
  observedAt: "2026-08-26T00:01:02.000Z",
  sourceKind: "SYNTHETIC_FIXTURE",
});
export const TRUSTED_SYNTHETIC_SOURCE_MANIFEST_VERSION = "accord.r003-approved-synthetic-sources/v1" as const;
/** Public request data only. The trusted source manifest is selected internally. */
export interface ProfileInvocationRequest { readonly caseId: CaseId; readonly profile: Profile; readonly modelId: string; readonly now: string; }
export interface ContextEntry { readonly id: BoardEntryId; readonly type: EntryType; readonly digest: string; readonly payload: Readonly<Record<string, unknown>>; }
export interface PreparedProfileInvocation {
  readonly contextId: ContextId; readonly invocationId: InvocationId; readonly caseId: CaseId; readonly workflowRunId: WorkflowRunId; readonly boardId: BoardId;
  readonly profile: Profile; readonly profileVersion: string; readonly modelId: string; readonly runtimeVersion: typeof RUNTIME_VERSION;
  readonly providerPortVersion: typeof NATIVE_BAIZHI_PROVIDER_PORT_VERSION; readonly outputSchema: string;
  readonly objective: string; readonly boardRevision: number; readonly workflowRevision: number; readonly contextDigest: string;
  readonly entries: readonly ContextEntry[]; readonly approvedSources: readonly Readonly<ApprovedSyntheticSource>[]; readonly permissionSummary: Readonly<Record<string, boolean>>;
}
export interface PreparedAttempt { readonly attemptId: AttemptId; readonly invocationId: InvocationId; readonly attemptNumber: 1 | 2; readonly noSdkRetry: true; }
export interface ResearcherOutput { readonly intents: readonly { readonly objective: string; readonly scope: string; readonly basedOn: readonly BoardEntryId[] }[]; readonly observations: readonly { readonly statement: string; readonly sourceRefs: readonly SourceId[]; readonly basedOn: readonly BoardEntryId[] }[]; readonly evidenceRefs: readonly { readonly sourceId: SourceId; readonly sourceKind: string; readonly locator: string; readonly sourceDigest: string; readonly observedAt: string }[]; }
export interface AnalystOutput { readonly claims: readonly { readonly statement: string; readonly supportingEntryIds: readonly BoardEntryId[]; readonly unsupported: boolean }[]; readonly proposals: readonly { readonly action: string; readonly supportingClaimIndexes: readonly number[]; readonly supportStatus: "SUPPORTED" | "UNSUPPORTED" }[]; }
/**
 * The provider boundary is bytes represented by one primitive JavaScript
 * string.  No caller-owned object crosses this boundary.
 */
export type ProviderWire = string;
export interface ProviderPort { readonly outputContract?: InvocationBoundOutputContract; complete(request: Readonly<{ invocation: PreparedProfileInvocation; attempt: PreparedAttempt; retry: "DISABLED" }>): ProviderWire | Promise<ProviderWire>; }
export interface ResultArbitration { readonly outcome: "WINNER" | "LATE" | "STALE" | "DUPLICATE" | "DIVERGENT" | "UNKNOWN" | "INVALID"; readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly responseId: ResponseId; readonly resultId: ResultId; readonly arrivalId: ArrivalId; readonly boardRevision: number | undefined; readonly proposalBoardRevision: number | undefined; readonly materialization?: DurableGenericMaterialization; readonly reason?: never; }
/** A rejected completion has no wire, Response, Result, or Arrival identity. */
export interface ContractRejection { readonly outcome: "CONTRACT_REJECTED"; readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly reason: "NON_STRING" | "CHARACTER_LIMIT" | "UTF8_BYTE_LIMIT" | "NON_LOSSLESS_UTF8"; }
export type ProviderResultArbitration = ResultArbitration | ContractRejection;

const permissions = Object.freeze({ canCreateApproval: false, canMutateEntries: false, canPublish: false, canSetSystemVerification: false, canUseTools: false, sourceInstructionAuthority: false });
const providerMetadataFields = ["deploymentId", "modelId", "providerPortVersion", "requestId", "responseId"] as const;
const GENERIC_AUDIT_JSON_MAX_CHARS = 524_288;

function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])); return value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex"); }
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function record(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an unsupported or missing field`); }
function string(value: unknown, label: string, max = 4096): string { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max || /[\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError(`${label} must be a bounded, trimmed scalar string`); return value; }
function instant(value: unknown, label: string): string { const result = string(value, label, 32); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || new Date(result).toISOString() !== result) throw new TypeError(`${label} must be a canonical UTC instant`); return result; }
function strings(value: unknown, label: string): readonly string[] { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); const normalized = value.map((item, index) => string(item, `${label}[${index}]`, 160)); if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must not contain duplicates`); return Object.freeze(normalized); }
function rows(database: DatabaseSync, sql: string, ...parameters: readonly (string | number | null)[]): readonly Record<string, unknown>[] { return database.prepare(sql).all(...parameters) as readonly Record<string, unknown>[]; }
function one(database: DatabaseSync, sql: string, ...parameters: readonly (string | number | null)[]): Record<string, unknown> | undefined { const result = database.prepare(sql).get(...parameters); return result === undefined ? undefined : result as Record<string, unknown>; }
let savepointSequence = 0;
function transaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  const nested = (database as unknown as { readonly isTransaction?: boolean }).isTransaction === true;
  const savepoint = `researcher_analyst_${savepointSequence += 1}`;
  database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return value;
  } catch (error) {
    database.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    throw error;
  }
}
function profileDetails(profile: Profile) { if (profile === "RESEARCHER") return { node: "RESEARCHER", profileVersion: RESEARCHER_PROFILE_VERSION, outputSchema: RESEARCHER_OUTPUT_SCHEMA } as const; if (profile === "ANALYST") return { node: "ANALYST", profileVersion: ANALYST_PROFILE_VERSION, outputSchema: ANALYST_OUTPUT_SCHEMA } as const; if (profile === "REVIEWER") return { node: "REVIEWER", profileVersion: REVIEWER_PROFILE_VERSION, outputSchema: REVIEWER_OUTPUT_SCHEMA } as const; return { node: "WRITER", profileVersion: WRITER_PROFILE_VERSION, outputSchema: WRITER_OUTPUT_SCHEMA } as const; }
function parseEntry(row: Record<string, unknown>): ContextEntry { const type = string(row["entry_type"], "entry type", 32) as EntryType; return Object.freeze({ digest: string(row["content_digest"], "entry digest", 64), id: parseBoardEntryId(row["board_entry_id"]), payload: Object.freeze(JSON.parse(string(row["payload_json"], "entry payload", 16_384)) as Record<string, unknown>), type }); }
function source(value: ApprovedSyntheticSource): Readonly<ApprovedSyntheticSource> { const checked = record(value, "approved source"); exact(checked, ["content", "locator", "observedAt", "sourceId", "sourceKind"], "approved source"); return Object.freeze({ content: string(checked["content"], "source content"), locator: string(checked["locator"], "source locator", 512), observedAt: instant(checked["observedAt"], "source observedAt"), sourceId: parseSourceId(checked["sourceId"]), sourceKind: string(checked["sourceKind"], "sourceKind", 80) }); }
function sourceReference(item: Readonly<ApprovedSyntheticSource>) { return { locator: item.locator, observedAt: item.observedAt, sourceDigest: digest(item.content), sourceId: item.sourceId, sourceKind: item.sourceKind }; }
/** Installs exactly the repository-owned manifest. No public caller supplies source content or identities. */
export function installTrustedSyntheticSourceManifest(database: DatabaseSync, installedAt: string): readonly SourceId[] {
  const at = instant(installedAt, "installedAt");
  const inputs = [TRUSTED_SYNTHETIC_SOURCE_INPUT] as const;
  return transaction(database, () => {
    const header = one(database, "SELECT manifest_digest, source_count, state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'");
    if (header === undefined) throw new Error("approved synthetic source manifest header is missing");
    const normalized = inputs.map((input) => {
    const item = record(input, "approved source input"); exact(item, ["content", "locator", "observedAt", "sourceKind"], "approved source input");
    const content = string(item["content"], "source content"); const locator = string(item["locator"], "source locator", 512); const observedAt = instant(item["observedAt"], "source observedAt"); const sourceKind = string(item["sourceKind"], "sourceKind", 80);
    const contentDigest = digest(content); const sourceId = parseSourceId(deriveSourceId({ contentDigest, locator, observedAt, sourceKind }));
    return { content, contentDigest, locator, observedAt, sourceId, sourceKind };
    });
    if (new Set(normalized.map((item) => item.sourceId)).size !== normalized.length) throw new Error("approved synthetic source manifest has duplicate source identities");
    const manifestDigest = digest({ sources: normalized.map(({ content, ...reference }) => reference).sort((left, right) => left.sourceId.localeCompare(right.sourceId)), version: TRUSTED_SYNTHETIC_SOURCE_MANIFEST_VERSION });
    if (header["state"] === "SEALED") {
      if (header["manifest_digest"] !== manifestDigest || header["source_count"] !== normalized.length) throw new Error("approved synthetic source manifest is sealed");
      for (const item of normalized) {
        const existing = one(database, "SELECT source_kind, locator, content, content_digest, observed_at, manifest_id FROM approved_synthetic_sources WHERE source_id = ?", item.sourceId);
        if (existing === undefined || existing["manifest_id"] !== "source_manifest_r003_v1" || existing["source_kind"] !== item.sourceKind || existing["locator"] !== item.locator || existing["content"] !== item.content || existing["content_digest"] !== item.contentDigest || existing["observed_at"] !== item.observedAt) throw new Error("approved synthetic source manifest drifted");
      }
      return Object.freeze(normalized.map((item) => item.sourceId));
    }
    const existingSources = rows(database, "SELECT source_id, source_kind, locator, content, content_digest, observed_at, manifest_id FROM approved_synthetic_sources WHERE manifest_id = 'source_manifest_r003_v1'");
    if (existingSources.length !== 0) {
      if (existingSources.length !== normalized.length) throw new Error("open approved synthetic source manifest contains untrusted rows");
      for (const item of normalized) {
        const existing = existingSources.find((row) => row["source_id"] === item.sourceId);
        if (existing === undefined || existing["source_kind"] !== item.sourceKind || existing["locator"] !== item.locator || existing["content"] !== item.content || existing["content_digest"] !== item.contentDigest || existing["observed_at"] !== item.observedAt) throw new Error("open approved synthetic source manifest does not match the trusted authority");
      }
    } else for (const item of normalized) database.prepare("INSERT INTO approved_synthetic_sources (source_id, schema_version, source_kind, locator, content, content_digest, observed_at, installed_at, manifest_id) VALUES (?, 'accord.approved-synthetic-source/v1', ?, ?, ?, ?, ?, ?, 'source_manifest_r003_v1')").run(item.sourceId, item.sourceKind, item.locator, item.content, item.contentDigest, item.observedAt, at);
    database.prepare("UPDATE approved_synthetic_source_manifests SET manifest_digest = ?, source_count = ?, state = 'SEALED', installed_at = ?, sealed_at = ? WHERE manifest_id = 'source_manifest_r003_v1' AND state = 'OPEN'").run(manifestDigest, normalized.length, at, at);
    return Object.freeze(normalized.map((item) => item.sourceId));
  });
}
function resolveApprovedSources(database: DatabaseSync): readonly Readonly<ApprovedSyntheticSource>[] {
  const header = one(database, "SELECT state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'");
  if (header?.["state"] !== "SEALED") throw new Error("approved synthetic source manifest is not sealed");
  const trusted = deriveSourceId({ contentDigest: digest(TRUSTED_SYNTHETIC_SOURCE_INPUT.content), locator: TRUSTED_SYNTHETIC_SOURCE_INPUT.locator, observedAt: TRUSTED_SYNTHETIC_SOURCE_INPUT.observedAt, sourceKind: TRUSTED_SYNTHETIC_SOURCE_INPUT.sourceKind });
  const ids = [trusted] as const;
  const parsed = ids.map((id) => parseSourceId(id)); if (new Set(parsed).size !== parsed.length) throw new TypeError("approved source IDs must be unique");
  const values = rows(database, `SELECT source_id, source_kind, locator, content, content_digest, observed_at FROM approved_synthetic_sources WHERE source_id IN (${parsed.map(() => "?").join(",")})`, ...parsed);
  if (values.length !== parsed.length) throw new Error("approved source ID is missing from the frozen manifest");
  const byId = new Map(values.map((row) => [row["source_id"], row]));
  return Object.freeze(parsed.map((sourceId) => { const row = byId.get(sourceId); if (row === undefined || row["content_digest"] !== digest(row["content"])) throw new Error("frozen approved source manifest drifted"); return source({ content: String(row["content"]), locator: String(row["locator"]), observedAt: String(row["observed_at"]), sourceId, sourceKind: String(row["source_kind"]) }); }));
}
function parseJson(value: unknown, label: string): unknown { try { return JSON.parse(string(value, label, 100_000)) as unknown; } catch { throw new TypeError(`${label} must be valid JSON`); } }
function persistedObjective(value: unknown, profile: Profile): string {
  if (profile !== "RESEARCHER" && value === "") return "";
  return string(value, "persisted objective");
}

function makePrepared(input: { readonly approvedSources: readonly Readonly<ApprovedSyntheticSource>[]; readonly boardId: BoardId; readonly boardRevision: number; readonly caseId: CaseId; readonly entries: readonly ContextEntry[]; readonly modelId: string; readonly objective: string; readonly profile: Profile; readonly workflowRevision: number; readonly workflowRunId: WorkflowRunId; }): PreparedProfileInvocation {
  const details = profileDetails(input.profile);
  const contextCore = { approvedSources: input.approvedSources.map(sourceReference), boardId: input.boardId, boardRevision: input.boardRevision, caseId: input.caseId, entries: input.entries.map((entry) => ({ digest: entry.digest, id: entry.id, payload: entry.payload, type: entry.type })), modelId: input.modelId, node: details.node, objective: input.objective, outputSchema: details.outputSchema, permissionSummary: permissions, profileVersion: details.profileVersion, providerPortVersion: NATIVE_BAIZHI_PROVIDER_PORT_VERSION, runtimeVersion: RUNTIME_VERSION, workflowDefinitionId: FIXED_WORKFLOW_DEFINITION_ID, workflowDefinitionVersion: FIXED_WORKFLOW_DEFINITION, workflowRevision: input.workflowRevision, workflowRunId: input.workflowRunId };
  const contextDigest = digest(contextCore);
  const invocationId = deriveProfileInvocationId({ caseId: input.caseId, workflowRunId: input.workflowRunId, nodeId: details.node, profileVersion: details.profileVersion, contextDigest });
  return Object.freeze({ approvedSources: input.approvedSources, boardId: input.boardId, boardRevision: input.boardRevision, caseId: input.caseId, contextDigest, contextId: deriveProfileContextId({ invocationId }), entries: Object.freeze(input.entries), invocationId, modelId: input.modelId, objective: input.objective, outputSchema: details.outputSchema, permissionSummary: permissions, profile: input.profile, profileVersion: details.profileVersion, providerPortVersion: NATIVE_BAIZHI_PROVIDER_PORT_VERSION, runtimeVersion: RUNTIME_VERSION, workflowRevision: input.workflowRevision, workflowRunId: input.workflowRunId });
}

/** Normalizes only public caller data; source content and identity are never accepted here. */
export function normalizeProfileInvocationRequest(value: unknown): ProfileInvocationRequest {
  const request = record(value, "Profile Invocation request");
  const requestKeys = Object.keys(request).sort();
  const expectedKeys = ["caseId", "modelId", "now", "profile"];
  if (requestKeys.length !== expectedKeys.length || requestKeys.some((key, index) => key !== expectedKeys[index])) throw new TypeError("Profile Invocation request has an unsupported or missing field");
  const profile = request["profile"];
  if (profile !== "RESEARCHER" && profile !== "ANALYST" && profile !== "REVIEWER" && profile !== "WRITER") throw new TypeError("profile is unsupported");
  return Object.freeze({ caseId: parseCaseId(request["caseId"]), modelId: string(request["modelId"], "modelId", 160), now: instant(request["now"], "now"), profile });
}

function contextFrom(database: DatabaseSync, input: unknown): PreparedProfileInvocation {
  const request = normalizeProfileInvocationRequest(input);
  const rawCaseId = request.caseId; const now = request.now; const profile = request.profile;
  const modelId = request.modelId;
  const details = profileDetails(profile);
  const state = one(database, `SELECT c.case_id, c.objective, c.status, b.board_id, b.revision AS board_revision, w.workflow_run_id, w.revision AS workflow_revision, w.state, w.workflow_definition_id, d.definition_version FROM cases c JOIN boards b ON b.case_id = c.case_id JOIN workflow_runs w ON w.case_id = c.case_id JOIN workflow_definitions d ON d.workflow_definition_id = w.workflow_definition_id WHERE c.case_id = ?`, rawCaseId);
  if (state === undefined) throw new Error("Case does not exist"); if (state["state"] !== details.node || state["workflow_definition_id"] !== FIXED_WORKFLOW_DEFINITION_ID || state["definition_version"] !== FIXED_WORKFLOW_DEFINITION) throw new Error("Profile cannot run outside the fixed current Workflow node"); if (state["status"] !== "OPEN") throw new Error("Profile cannot run on a terminal Case");
  const caseId = parseCaseId(state["case_id"]); if (caseId !== rawCaseId) throw new Error("persisted Case identity is invalid"); const boardId = parseBoardId(state["board_id"]); const workflowRunId = parseWorkflowRunId(state["workflow_run_id"]); const caseObjective = string(state["objective"], "objective"); const objective = profile === "RESEARCHER" ? caseObjective : ""; const boardRevision = state["board_revision"]; const workflowRevision = state["workflow_revision"];
  if (!Number.isSafeInteger(boardRevision) || !Number.isSafeInteger(workflowRevision)) throw new TypeError("persisted revisions are invalid"); const persistedBoardRevision = boardRevision as number; const persistedWorkflowRevision = workflowRevision as number;
  const entries = profile === "RESEARCHER"
    ? rows(database, `SELECT entry.board_entry_id, entry.entry_type, entry.payload_json, entry.content_digest, receipt.receipt_id AS receipt_id, receipt.source_message_id AS source_message_id
        FROM board_entries entry
        LEFT JOIN wait_challenges resolved ON resolved.case_id = entry.case_id AND resolved.state = 'RESUMED'
        LEFT JOIN inbox_receipts receipt ON receipt.receipt_id = resolved.resolved_by_receipt_id
        WHERE entry.case_id = ? AND entry.status IN ('CANDIDATE', 'ACCEPTED') AND entry.visibility = 'CASE' AND entry.instruction_authority = 'NONE'
          AND ((entry.entry_type = 'Question' AND EXISTS (SELECT 1 FROM wait_challenges challenge WHERE challenge.case_id = entry.case_id AND challenge.question_entry_id = entry.board_entry_id AND challenge.state = 'ACTIVE'))
            OR (entry.entry_type = 'Intent' AND entry.author_type = 'AGENT' AND EXISTS (SELECT 1 FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE link.board_entry_id = entry.board_entry_id AND invocation.case_id = entry.case_id AND invocation.node_id = 'RESEARCHER' AND invocation.status = 'RESULT_COMMITTED'))
            OR (entry.entry_type = 'Observation' AND entry.author_type = 'HUMAN' AND entry.source_refs_json = json_array('magicchat:message:' || receipt.source_message_id)))
        ORDER BY entry.created_revision, entry.board_entry_id`, caseId)
      .filter((row) => row["entry_type"] !== "Observation" || row["board_entry_id"] === deriveObservationEntryId({ caseId: parseCaseId(caseId), workflowRunId: parseWorkflowRunId(String(state["workflow_run_id"])), receiptId: parseInboxReceiptId(row["receipt_id"]), messageId: string(row["source_message_id"], "resolved source message", 160) }))
      .map(parseEntry)
    : profile === "ANALYST"
      ? rows(database, `SELECT entry.board_entry_id, entry.entry_type, entry.payload_json, entry.content_digest
          FROM board_entries entry
          WHERE entry.case_id = ? AND entry.status IN ('CANDIDATE', 'ACCEPTED') AND entry.visibility = 'CASE' AND entry.instruction_authority = 'NONE'
            AND ((entry.entry_type IN ('EvidenceRef', 'Observation') AND entry.author_type = 'AGENT' AND EXISTS (SELECT 1 FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER' JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE link.board_entry_id = entry.board_entry_id AND invocation.case_id = entry.case_id AND invocation.workflow_run_id = ? AND invocation.node_id = 'RESEARCHER' AND invocation.status = 'RESULT_COMMITTED'))
              OR (entry.entry_type = 'Question' AND EXISTS (SELECT 1 FROM wait_challenges challenge WHERE challenge.case_id = entry.case_id AND challenge.question_entry_id = entry.board_entry_id AND challenge.state = 'ACTIVE')))
          ORDER BY entry.created_revision, entry.board_entry_id`, caseId, String(state["workflow_run_id"])).map(parseEntry)
      : rows(database, `SELECT board_entry_id, entry_type, payload_json, content_digest FROM board_entries
          WHERE case_id = ? AND created_revision <= ? AND status IN ('CANDIDATE', 'ACCEPTED') AND visibility = 'CASE' AND instruction_authority = 'NONE'
          ORDER BY created_revision, board_entry_id`, caseId, persistedBoardRevision).map(parseEntry);
  const approvedSources = profile === "RESEARCHER" ? resolveApprovedSources(database) : Object.freeze([]);
  const prepared = makePrepared({ approvedSources, boardId, boardRevision: persistedBoardRevision, caseId, entries, modelId, objective, profile, workflowRevision: persistedWorkflowRevision, workflowRunId });
  const fixedContext = profile === "REVIEWER" || profile === "WRITER" ? {
    invocationId: prepared.invocationId, caseId, workflowRunId: prepared.workflowRunId, boardId, nodeId: profile,
    workflowDefinitionId: FIXED_WORKFLOW_DEFINITION_ID, workflowDefinitionVersion: FIXED_WORKFLOW_DEFINITION,
    profileVersion: prepared.profileVersion, providerPortVersion: NATIVE_BAIZHI_PROVIDER_PORT_VERSION, modelId: prepared.modelId, runtimeVersion: RUNTIME_VERSION, outputSchema: prepared.outputSchema, objective,
    selectedEntriesJson: json(prepared.entries.map((entry) => ({ digest: entry.digest, id: entry.id, type: entry.type }))), approvedSourcesJson: json(approvedSources), permissionSummaryJson: json(permissions), contextDigest: prepared.contextDigest, createdAt: now,
  } as const : undefined;
  transaction(database, () => {
    const existing = one(database, "SELECT invocation_id, model_id, context_digest FROM runtime_invocations WHERE invocation_id = ?", prepared.invocationId);
    if (existing !== undefined) { if (existing["model_id"] !== prepared.modelId || existing["context_digest"] !== prepared.contextDigest) throw new Error("logical Invocation identity conflicts with immutable context"); if (fixedContext !== undefined) persistFixedProfileContext(database, fixedContext); return; }
    database.prepare(`INSERT INTO runtime_invocations (invocation_id, schema_version, case_id, workflow_run_id, board_id, node_id, profile_version, model_id, workflow_revision, board_revision, context_digest, status, attempt_budget, created_at) VALUES (?, 'accord.runtime-invocation/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', 2, ?)`).run(prepared.invocationId, caseId, prepared.workflowRunId, boardId, details.node, details.profileVersion, prepared.modelId, persistedWorkflowRevision, persistedBoardRevision, prepared.contextDigest, now);
    if (fixedContext === undefined) database.prepare(`INSERT INTO profile_contexts (context_id, schema_version, invocation_id, case_id, workflow_run_id, board_id, node_id, workflow_definition_id, workflow_definition_version, profile_version, provider_port_version, model_id, runtime_version, output_schema, objective, selected_entries_json, approved_sources_json, permission_summary_json, context_digest, created_at) VALUES (?, 'accord.profile-context/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(prepared.contextId, prepared.invocationId, caseId, prepared.workflowRunId, boardId, details.node, FIXED_WORKFLOW_DEFINITION_ID, FIXED_WORKFLOW_DEFINITION, prepared.profileVersion, NATIVE_BAIZHI_PROVIDER_PORT_VERSION, prepared.modelId, RUNTIME_VERSION, prepared.outputSchema, objective, json(prepared.entries.map((entry) => ({ digest: entry.digest, id: entry.id, type: entry.type }))), json(approvedSources), json(permissions), prepared.contextDigest, now);
    else persistFixedProfileContext(database, fixedContext);
    database.prepare(`INSERT INTO runtime_attempts (attempt_id, schema_version, invocation_id, attempt_number, state, no_sdk_retry, created_at) VALUES (?, 'accord.runtime-attempt/v1', ?, 1, 'READY', 1, ?)`).run(deriveRuntimeAttemptId({ invocationId: prepared.invocationId, attemptNumber: 1 }), prepared.invocationId, now);
  });
  return prepared;
}
/** Parses an exact public request before any Attempt claim or provider I/O. */
export function prepareProfileInvocation(database: DatabaseSync, input: ProfileInvocationRequest): PreparedProfileInvocation { return contextFrom(database, input); }

function canonicalPrepared(database: DatabaseSync, suppliedInvocationId: unknown): PreparedProfileInvocation {
  const invocationId = parseInvocationId(suppliedInvocationId);
  const context = one(database, "SELECT * FROM profile_contexts WHERE invocation_id = ?", invocationId); const invocation = one(database, "SELECT * FROM runtime_invocations WHERE invocation_id = ?", invocationId);
  if (context === undefined || invocation === undefined) throw new Error("provider result has no persisted Invocation context");
  const profile = context["node_id"] === "RESEARCHER" ? "RESEARCHER" : context["node_id"] === "ANALYST" ? "ANALYST" : context["node_id"] === "REVIEWER" ? "REVIEWER" : context["node_id"] === "WRITER" ? "WRITER" : (() => { throw new Error("persisted Invocation has an unsupported Profile"); })();
  const details = profileDetails(profile);
  const caseId = parseCaseId(context["case_id"]);
  const boardId = parseBoardId(context["board_id"]);
  const workflowRunId = parseWorkflowRunId(context["workflow_run_id"]);
  const modelId = string(context["model_id"], "persisted modelId", 160);
  const objective = persistedObjective(context["objective"], profile);
  const caseRow = one(database, "SELECT objective FROM cases WHERE case_id = ?", caseId);
  if (
    context["schema_version"] !== "accord.profile-context/v1" ||
    context["invocation_id"] !== invocationId ||
    context["workflow_definition_id"] !== FIXED_WORKFLOW_DEFINITION_ID ||
    context["workflow_definition_version"] !== FIXED_WORKFLOW_DEFINITION ||
    context["profile_version"] !== details.profileVersion ||
    context["provider_port_version"] !== NATIVE_BAIZHI_PROVIDER_PORT_VERSION ||
    context["runtime_version"] !== RUNTIME_VERSION ||
    context["output_schema"] !== details.outputSchema ||
    context["node_id"] !== details.node ||
    caseRow === undefined ||
    (profile === "RESEARCHER" ? objective !== string(caseRow["objective"], "Case objective") : objective !== "")
  ) throw new Error("persisted Invocation context contract fields are invalid");
  instant(context["created_at"], "persisted context createdAt");
  if (invocation["schema_version"] !== "accord.runtime-invocation/v1" || invocation["attempt_budget"] !== 2 || invocation["case_id"] !== caseId || invocation["workflow_run_id"] !== workflowRunId || invocation["board_id"] !== boardId || invocation["node_id"] !== details.node || invocation["profile_version"] !== details.profileVersion || invocation["model_id"] !== modelId) throw new Error("persisted Invocation contract fields are invalid");
  instant(invocation["created_at"], "persisted Invocation createdAt");
  const boardRevision = invocation["board_revision"];
  const workflowRevision = invocation["workflow_revision"];
  if (!Number.isSafeInteger(boardRevision) || (boardRevision as number) < 0 || !Number.isSafeInteger(workflowRevision) || (workflowRevision as number) < 1) throw new Error("persisted Invocation revisions are invalid");
  const selected = parseJson(context["selected_entries_json"], "persisted selected entries"); if (!Array.isArray(selected)) throw new Error("persisted selected entries are invalid");
  const persistedSelected = selected.map((item, index) => { const entry = record(item, `selected entry ${index}`); exact(entry, ["digest", "id", "type"], `selected entry ${index}`); return Object.freeze({ digest: hexDigest(entry["digest"], `selected entry ${index} digest`), id: parseBoardEntryId(entry["id"]), type: string(entry["type"], `selected entry ${index} type`, 32) }); });
  if (new Set(persistedSelected.map((entry) => entry.id)).size !== persistedSelected.length || context["selected_entries_json"] !== json(persistedSelected)) throw new Error("persisted selected entries are not the canonical context contract");
  const ids = persistedSelected.map((entry) => entry.id);
  const listed = ids.length === 0 ? [] : rows(database, `SELECT board_entry_id, entry_type, payload_json, content_digest FROM board_entries WHERE board_id = ? AND case_id = ? AND board_entry_id IN (${ids.map(() => "?").join(",")})`, boardId, caseId, ...ids).map(parseEntry);
  if (listed.length !== ids.length) throw new Error("persisted Invocation context references missing Board entries");
  const byId = new Map(listed.map((entry) => [entry.id, entry])); const entries = ids.map((entryId, index) => { const expected = persistedSelected[index]!; const entry = byId.get(entryId); if (entry === undefined || entry.digest !== expected.digest || entry.type !== expected.type) throw new Error("persisted Invocation context entry digest drifted"); return entry; });
  const reconstructedEntries = profile === "RESEARCHER"
    ? rows(database, `SELECT entry.board_entry_id, entry.entry_type, entry.payload_json, entry.content_digest, receipt.receipt_id AS receipt_id, receipt.source_message_id AS source_message_id
        FROM board_entries entry
        LEFT JOIN wait_challenges resolved ON resolved.case_id = entry.case_id AND resolved.state = 'RESUMED'
        LEFT JOIN inbox_receipts receipt ON receipt.receipt_id = resolved.resolved_by_receipt_id
        WHERE entry.case_id = ? AND entry.created_revision <= ? AND entry.status IN ('CANDIDATE', 'ACCEPTED') AND entry.visibility = 'CASE' AND entry.instruction_authority = 'NONE'
          AND ((entry.entry_type = 'Question' AND EXISTS (SELECT 1 FROM wait_challenges challenge WHERE challenge.case_id = entry.case_id AND challenge.question_entry_id = entry.board_entry_id AND challenge.state = 'ACTIVE'))
            OR (entry.entry_type = 'Intent' AND entry.author_type = 'AGENT' AND EXISTS (SELECT 1 FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE link.board_entry_id = entry.board_entry_id AND invocation.case_id = entry.case_id AND invocation.node_id = 'RESEARCHER' AND invocation.status = 'RESULT_COMMITTED'))
            OR (entry.entry_type = 'Observation' AND entry.author_type = 'HUMAN' AND entry.source_refs_json = json_array('magicchat:message:' || receipt.source_message_id)))
        ORDER BY entry.created_revision, entry.board_entry_id`, caseId, boardRevision as number)
      .filter((row) => row["entry_type"] !== "Observation" || row["board_entry_id"] === deriveObservationEntryId({ caseId, workflowRunId, receiptId: parseInboxReceiptId(row["receipt_id"]), messageId: string(row["source_message_id"], "resolved source message", 160) }))
      .map(parseEntry)
    : profile === "ANALYST"
      ? rows(database, `SELECT entry.board_entry_id, entry.entry_type, entry.payload_json, entry.content_digest
          FROM board_entries entry
          WHERE entry.case_id = ? AND entry.created_revision <= ? AND entry.status IN ('CANDIDATE', 'ACCEPTED') AND entry.visibility = 'CASE' AND entry.instruction_authority = 'NONE'
            AND ((entry.entry_type IN ('EvidenceRef', 'Observation') AND entry.author_type = 'AGENT' AND EXISTS (SELECT 1 FROM runtime_result_entries link JOIN runtime_results result ON result.result_id = link.result_id JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER' JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id WHERE link.board_entry_id = entry.board_entry_id AND invocation.case_id = entry.case_id AND invocation.workflow_run_id = ? AND invocation.node_id = 'RESEARCHER' AND invocation.status = 'RESULT_COMMITTED'))
              OR (entry.entry_type = 'Question' AND EXISTS (SELECT 1 FROM wait_challenges challenge WHERE challenge.case_id = entry.case_id AND challenge.question_entry_id = entry.board_entry_id AND challenge.state = 'ACTIVE')))
          ORDER BY entry.created_revision, entry.board_entry_id`, caseId, boardRevision as number, workflowRunId).map(parseEntry)
      : rows(database, `SELECT board_entry_id, entry_type, payload_json, content_digest FROM board_entries
          WHERE case_id = ? AND created_revision <= ? AND status IN ('CANDIDATE', 'ACCEPTED') AND visibility = 'CASE' AND instruction_authority = 'NONE'
          ORDER BY created_revision, board_entry_id`, caseId, boardRevision as number).map(parseEntry);
  if (json(entries) !== json(reconstructedEntries)) throw new Error("persisted Invocation selected entries do not reconstruct the Profile context");
  const persistedSources = parseJson(context["approved_sources_json"], "persisted approved sources"); if (!Array.isArray(persistedSources)) throw new Error("persisted approved sources are invalid");
  const approvedSources = Object.freeze(persistedSources.map((item) => source(item as ApprovedSyntheticSource)));
  if (profile !== "RESEARCHER" && approvedSources.length !== 0 || context["approved_sources_json"] !== json(approvedSources) || (profile === "RESEARCHER" && json(approvedSources) !== json(resolveApprovedSources(database)))) throw new Error("persisted approved sources are not the canonical context contract");
  for (const approved of approvedSources) {
    const manifest = one(database, "SELECT source_kind, locator, content, content_digest, observed_at FROM approved_synthetic_sources WHERE source_id = ?", approved.sourceId);
    if (manifest === undefined || manifest["source_kind"] !== approved.sourceKind || manifest["locator"] !== approved.locator || manifest["content"] !== approved.content || manifest["content_digest"] !== digest(approved.content) || manifest["observed_at"] !== approved.observedAt) throw new Error("persisted Invocation source does not re-derive from the frozen manifest");
  }
  const permissionSummary = parseJson(context["permission_summary_json"], "persisted permission summary");
  if (context["permission_summary_json"] !== json(permissions) || json(permissionSummary) !== json(permissions)) throw new Error("persisted permission summary is not the exact deny-all contract");
  const prepared = makePrepared({ approvedSources, boardId, boardRevision: boardRevision as number, caseId, entries, modelId, objective, profile, workflowRevision: workflowRevision as number, workflowRunId });
  if (prepared.contextId !== context["context_id"] || prepared.contextDigest !== hexDigest(context["context_digest"], "persisted context digest") || prepared.invocationId !== invocationId) throw new Error("persisted Invocation context is invalid");
  if (invocation["case_id"] !== prepared.caseId || invocation["workflow_run_id"] !== prepared.workflowRunId || invocation["board_id"] !== prepared.boardId || invocation["node_id"] !== prepared.profile || invocation["profile_version"] !== prepared.profileVersion || invocation["model_id"] !== prepared.modelId || invocation["workflow_revision"] !== prepared.workflowRevision || invocation["board_revision"] !== prepared.boardRevision || invocation["context_digest"] !== prepared.contextDigest) throw new Error("persisted Invocation identity tuple is inconsistent");
  return prepared;
}
/** Reconstructs an immutable prepared projection solely from persisted authority. */
export function reconstructPreparedProfileInvocation(database: DatabaseSync, invocationId: InvocationId): PreparedProfileInvocation { return canonicalPrepared(database, invocationId); }


/** Refuse corrupt runtime authority before startup recovery can mutate it. */
const UNKNOWN_RUNTIME_CAPSULE = json({ kind: "provider-response-unknown", retry: "DISABLED" });

function validateUnknownRuntimeArrival(database: DatabaseSync, prepared: PreparedProfileInvocation, attemptId: AttemptId, arrival: Record<string, unknown>): void {
  const arrivalId = parseArrivalId(arrival["arrival_id"]);
  const recordedAt = instant(arrival["recorded_at"], "UNKNOWN Arrival recorded time");
  if (
    arrival["schema_version"] !== CONTRACT_VERSIONS.runtimeResultArrival ||
    arrival["invocation_id"] !== prepared.invocationId ||
    arrival["attempt_id"] !== attemptId ||
    arrival["result_id"] !== null ||
    arrival["response_id"] !== null ||
    arrival["outcome"] !== "UNKNOWN" ||
    arrival["raw_response_json"] !== UNKNOWN_RUNTIME_CAPSULE ||
    arrival["raw_response_digest"] !== wireDigest(UNKNOWN_RUNTIME_CAPSULE)
  ) throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival capsule is not canonical");

  const audit = one(database, `SELECT audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at
    FROM audit_events WHERE audit_event_id = ?`, deriveRuntimeAuditEventId("runtime-unknown-arrival", [arrivalId]));
  if (audit === undefined) throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival lacks its canonical audit");
  const eventKind = audit["event_kind"];
  let eventDetails: Readonly<Record<string, unknown>>;
  if (eventKind === `RUNTIME_PROVIDER_EXCEPTION_UNKNOWN:${attemptId}`) eventDetails = {};
  else if (eventKind === "RUNTIME_ATTEMPT_RECOVERED_UNKNOWN") eventDetails = { operatorDecisionRequired: false, recovery: "startup" };
  else if (eventKind === "RUNTIME_ATTEMPT_RECOVERED_UNKNOWN_EXHAUSTED") eventDetails = { operatorDecisionRequired: true, recovery: "startup" };
  else throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival audit event kind is invalid");
  let details: string;
  try { details = json(JSON.parse(string(audit["details_json"], "UNKNOWN Arrival audit details", 100_000))); }
  catch { throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival audit details are invalid"); }
  if (
    audit["schema_version"] !== CONTRACT_VERSIONS.auditEvent ||
    audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(prepared.invocationId) ||
    audit["case_id"] !== prepared.caseId || audit["board_id"] !== prepared.boardId || audit["workflow_run_id"] !== prepared.workflowRunId ||
    audit["receipt_id"] !== null || audit["recorded_at"] !== recordedAt ||
    details !== json({ ...eventDetails, arrivalId, attemptId, invocationId: prepared.invocationId, outcome: "UNKNOWN", retry: "DISABLED" })
  ) throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival audit tuple is invalid");
}

function validatedContractRejectionTime(database: DatabaseSync, prepared: PreparedProfileInvocation, attemptId: AttemptId): string | undefined {
  const audit = one(database, `SELECT audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at
    FROM audit_events WHERE audit_event_id = ?`, deriveRuntimeAuditEventId("runtime-contract-rejected", [attemptId]));
  if (audit === undefined) return undefined;
  let details: Record<string, unknown>;
  try { details = record(JSON.parse(string(audit["details_json"], "contract rejection audit details", 100_000)), "contract rejection audit details"); }
  catch { throw new Error("persisted runtime authority integrity failed: contract rejection audit details are invalid"); }
  const reason = details["reason"];
  if (reason !== "NON_STRING" && reason !== "CHARACTER_LIMIT" && reason !== "UTF8_BYTE_LIMIT" && reason !== "NON_LOSSLESS_UTF8") throw new Error("persisted runtime authority integrity failed: contract rejection audit reason is invalid");
  const recordedAt = instant(audit["recorded_at"], "contract rejection audit time");
  if (
    audit["schema_version"] !== CONTRACT_VERSIONS.auditEvent || audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(prepared.invocationId) ||
    audit["event_kind"] !== "RUNTIME_PROVIDER_CONTRACT_REJECTED" || audit["case_id"] !== prepared.caseId || audit["board_id"] !== prepared.boardId ||
    audit["workflow_run_id"] !== prepared.workflowRunId || audit["receipt_id"] !== null ||
    json(details) !== json({ attemptId, outcome: "CONTRACT_REJECTED", reason, retry: "DISABLED" })
  ) throw new Error("persisted runtime authority integrity failed: contract rejection audit tuple is invalid");
  return recordedAt;
}

function validateInvocationAttemptStatePair(status: unknown, attempts: readonly Record<string, unknown>[]): void {
  const states = attempts.map((attempt) => attempt["state"]);
  const contiguous = attempts.every((attempt, index) => attempt["attempt_number"] === index + 1);
  const terminalPrior = (state: unknown): boolean => state === "UNKNOWN" || state === "DISCARDED";
  const valid = contiguous && (
    (status === "READY" && states.length === 1 && states[0] === "READY") ||
    (status === "RUNNING" && states.length >= 1 && states.slice(0, -1).every(terminalPrior) && (states.at(-1) === "RUNNING" || states.at(-1) === "RESULT_RECEIVED")) ||
    (status === "UNKNOWN" && states.length === 1 && terminalPrior(states[0])) ||
    (status === "FAILED" && states.length >= 1 && states.every((state) => state === "READY" || terminalPrior(state))) ||
    (status === "RESULT_COMMITTED" && states.filter((state) => state === "WINNER").length === 1 && states.at(-1) === "WINNER" && states.slice(0, -1).every(terminalPrior))
  );
  if (!valid) throw new Error("persisted runtime authority integrity failed: Invocation and Attempt state pair is illegal");
}

export function validatePersistedRuntimeAuthorityGraph(database: DatabaseSync): void {
  validateLegacyProviderDeliveryProvenance(database);
  const genericResolutionAuditIds = new Set<string>();
  const validateGenericResolutionCarrier = (prepared: PreparedProfileInvocation, attemptId: AttemptId, deliveryNumber: number, wireDigestValue: string, recordedAt: string): GenericOutputResolution => {
    const auditId = genericResolutionAuditId(attemptId, deliveryNumber);
    if (genericResolutionAuditIds.has(auditId)) throw new Error("persisted runtime authority integrity failed: generic output resolution has multiple durable carriers");
    let resolution: GenericOutputResolution;
    try { resolution = validatedGenericOutputResolution(database, prepared, attemptId, deliveryNumber, wireDigestValue, recordedAt); }
    catch { throw new Error("persisted runtime authority integrity failed: generic output resolution is invalid"); }
    genericResolutionAuditIds.add(auditId);
    return resolution;
  };
  const invocations = rows(database, "SELECT invocation_id FROM runtime_invocations ORDER BY invocation_id");
  for (const invocationRow of invocations) {
    const invocationId = parseInvocationId(invocationRow["invocation_id"]); const prepared = canonicalPrepared(database, invocationId);
    const context = one(database, "SELECT context_id FROM profile_contexts WHERE invocation_id = ?", invocationId);
    if (context === undefined || context["context_id"] !== prepared.contextId) throw new Error("persisted runtime authority integrity failed: Profile Context identity is invalid");
    const status = one(database, "SELECT status FROM runtime_invocations WHERE invocation_id = ?", invocationId)?.["status"];
    const attempts = rows(database, "SELECT attempt_id, attempt_number, state, no_sdk_retry, created_at, started_at, finished_at FROM runtime_attempts WHERE invocation_id = ? ORDER BY attempt_number", invocationId);
    if (attempts.length < 1 || attempts.length > 2) throw new Error("persisted runtime authority integrity failed: Invocation Attempt budget is invalid");
    validateInvocationAttemptStatePair(status, attempts);
    for (const attempt of attempts) {
      const number = attempt["attempt_number"]; const attemptId = parseAttemptId(attempt["attempt_id"]); if ((number !== 1 && number !== 2) || attemptId !== deriveRuntimeAttemptId({ invocationId, attemptNumber: number }) || attempt["no_sdk_retry"] !== 1 || typeof attempt["state"] !== "string") throw new Error("persisted runtime authority integrity failed: Attempt identity or retry state is invalid");
      const arrivals = rows(database, "SELECT arrival_id, schema_version, invocation_id, attempt_id, arrival_number, result_id, response_id, outcome, raw_response_json, raw_response_digest, recorded_at FROM runtime_result_arrivals WHERE attempt_id = ? ORDER BY arrival_number", attemptId);
      const unknownArrivals = arrivals.filter((arrival) => arrival["outcome"] === "UNKNOWN");
      if (unknownArrivals.length !== (attempt["state"] === "UNKNOWN" ? 1 : 0) || (unknownArrivals[0] !== undefined && attempt["finished_at"] !== unknownArrivals[0]["recorded_at"])) throw new Error("persisted runtime authority integrity failed: UNKNOWN Arrival does not bind the terminal Attempt time");
      const contractRejectionAt = validatedContractRejectionTime(database, prepared, attemptId);
      if (contractRejectionAt !== undefined && (attempt["state"] !== "DISCARDED" || attempt["finished_at"] !== contractRejectionAt)) throw new Error("persisted runtime authority integrity failed: contract rejection does not bind the terminal Attempt");
      if (attempt["state"] === "DISCARDED" && arrivals.length === 0 && contractRejectionAt === undefined) throw new Error("persisted runtime authority integrity failed: response-free DISCARDED Attempt lacks contract-rejection authority");
      const physicalResponses = rows(database, "SELECT response_id, invocation_id, envelope_digest FROM runtime_physical_responses WHERE attempt_id = ? ORDER BY response_id", attemptId);
      const deliveries = rows(database, `SELECT d.delivery_id, d.schema_version, d.invocation_id, d.attempt_id, d.response_id, d.delivery_number, d.wire_digest, d.redacted_envelope_json, d.replayable_response_json, d.trusted_received_at, d.physical_trusted_received_at, d.attempt_state_at_receipt, d.receipt_binding, d.original_attempt_state_at_receipt, d.original_receipt_state_binding, linked.arrival_id,
          p.invocation_id AS physical_invocation_id, p.attempt_id AS physical_attempt_id, p.envelope_digest, p.redacted_envelope_json AS physical_capsule, p.replayable_response_json AS physical_replay, p.trusted_received_at AS physical_received_at, p.provider_received_at AS physical_provider_received_at
        FROM runtime_provider_deliveries d JOIN runtime_physical_responses p ON p.response_id = d.response_id LEFT JOIN runtime_delivery_arrivals linked ON linked.delivery_id = d.delivery_id
        WHERE d.attempt_id = ? ORDER BY d.delivery_number`, attemptId);
      if (attempt["state"] === "RESULT_RECEIVED" && physicalResponses.length !== 1) throw new Error("persisted runtime authority integrity failed: RESULT_RECEIVED Attempt lacks its exact physical response");
      for (const physical of physicalResponses) { const envelopeDigest = String(physical["envelope_digest"]); const responseId = parseResponseId(physical["response_id"]); if (physical["invocation_id"] !== invocationId || responseId !== deriveRuntimeResponseId({ invocationId, attemptId, envelopeDigest })) throw new Error("persisted runtime authority integrity failed: physical Response identity is invalid"); if (!deliveries.some((delivery) => delivery["response_id"] === responseId) && !arrivals.some((arrival) => arrival["response_id"] === responseId)) throw new Error("persisted runtime authority integrity failed: physical Response lacks an Arrival or recoverable Delivery"); }
      const pendingDeliveries = deliveries.filter((delivery) => delivery["arrival_id"] === null);
      const responseBearingArrivals = arrivals.filter((arrival) => arrival["response_id"] !== null);
      if (pendingDeliveries.length > 1 || (attempt["state"] === "RESULT_RECEIVED" && pendingDeliveries.length !== 1)) throw new Error("persisted runtime authority integrity failed: Attempt has superseding Provider Deliveries");
      for (const [deliveryIndex, delivery] of deliveries.entries()) {
        let persistedDelivery: PersistedProviderDelivery; try { persistedDelivery = deliveryFromRow(database, delivery, { allowLegacy: delivery["schema_version"] === "accord.runtime-provider-delivery/v1", attemptId, invocationId, modelId: prepared.modelId }); } catch { throw new Error("persisted runtime authority integrity failed: Provider Delivery recovery capsule or immutable tuple is invalid"); }
        if (delivery["delivery_number"] !== deliveryIndex + 1) throw new Error("persisted runtime authority integrity failed: Provider Delivery sequence is invalid");
        const genericResolution = prepared.profile === "REVIEWER" || prepared.profile === "WRITER" ? validateGenericResolutionCarrier(prepared, attemptId, persistedDelivery.deliveryNumber, persistedDelivery.rawResponseDigest, persistedDelivery.trustedReceivedAt) : undefined;
        const linkedArrival = arrivals.find((arrival) => arrival["arrival_id"] === delivery["arrival_id"]);
        if (delivery["arrival_id"] === null) {
          if (attempt["state"] !== persistedDelivery.attemptStateAtReceipt || persistedDelivery.deliveryNumber !== responseBearingArrivals.length + 1) throw new Error("persisted runtime authority integrity failed: pending Provider Delivery is superseded or already represented by an Arrival");
          continue;
        }
        if (linkedArrival === undefined || linkedArrival["response_id"] !== persistedDelivery.responseId || linkedArrival["raw_response_json"] !== persistedDelivery.rawResponseJson || linkedArrival["raw_response_json"] !== delivery["physical_capsule"] || linkedArrival["raw_response_digest"] !== persistedDelivery.rawResponseDigest || linkedArrival["recorded_at"] !== persistedDelivery.trustedReceivedAt) throw new Error("persisted runtime authority integrity failed: Provider Delivery Arrival binding is invalid");
        if (genericResolution !== undefined && genericResolution.accepted !== (linkedArrival["outcome"] !== "INVALID")) throw new Error("persisted runtime authority integrity failed: generic output resolution does not match its Arrival disposition");
        const linkedArrivalId = parseArrivalId(linkedArrival["arrival_id"]); const audit = one(database, "SELECT schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at FROM audit_events WHERE audit_event_id = ? AND correlation_id = ?", deriveRuntimeAuditEventId("runtime-result-arrival", [linkedArrivalId]), deriveRuntimeAuditCorrelationId(invocationId));
        let materialization: DurableGenericMaterialization | undefined;
        const linkedResultId = linkedArrival["result_id"] === null ? undefined : parseResultId(linkedArrival["result_id"]);
        if ((prepared.profile === "REVIEWER" || prepared.profile === "WRITER") && linkedArrival["outcome"] === "WINNER") {
          if (audit === undefined || linkedResultId === undefined) throw new Error("persisted runtime authority integrity failed: generic winner lacks Result audit provenance");
          try { materialization = genericMaterializationFromAudit(audit["details_json"], prepared, attemptId, linkedResultId); }
          catch { throw new Error("persisted runtime authority integrity failed: generic winner materialization audit is invalid"); }
        }
        const expectedDetails = delivery["schema_version"] === "accord.runtime-provider-delivery/v1"
          ? [json({ arrivalId: linkedArrivalId, attemptId, outcome: linkedArrival["outcome"], recoveredFromSchema: 3, resultId: linkedArrival["result_id"] })]
          : [runtimeResultArrivalAuditDetails({ arrivalId: linkedArrivalId, attemptId, outcome: string(linkedArrival["outcome"], "Arrival outcome", 32), prepared, rawResponseDigest: persistedDelivery.rawResponseDigest, replayableResponseJson: persistedDelivery.replayableResponseJson, ...(linkedResultId === undefined ? {} : { resultId: linkedResultId }), ...(materialization === undefined ? {} : { materialization }) })];
        if (delivery["schema_version"] !== "accord.runtime-provider-delivery/v1" && linkedArrival["outcome"] === "INVALID") {
          const resultAudit = one(database, "SELECT provider_metadata_json, output_json, output_digest, usage_json FROM runtime_results WHERE result_id = ? AND invocation_id = ? AND attempt_id = ?", linkedArrival["result_id"] as string, invocationId, attemptId);
          const evidence = validateInvalidProviderAuditEvidenceAgainstCapsule(persistedDelivery.replayableResponseJson, prepared.modelId, persistedDelivery.rawResponseJson);
          if (resultAudit === undefined || resultAudit["provider_metadata_json"] !== json(evidence.providerMetadata ?? {}) || resultAudit["usage_json"] !== json(evidence.usage ?? {}) || resultAudit["output_json"] !== persistedDelivery.rawResponseJson || resultAudit["output_digest"] !== persistedDelivery.rawResponseDigest) throw new Error("persisted runtime authority integrity failed: invalid Result audit tuple is inconsistent");
        }
        if (delivery["schema_version"] === "accord.runtime-provider-delivery/v1") {
          const resultAudit = one(database, "SELECT provider_metadata_json, output_json, output_digest, usage_json FROM runtime_results WHERE result_id = ? AND invocation_id = ? AND attempt_id = ?", linkedArrival["result_id"] as string, invocationId, attemptId);
          try {
            if (resultAudit !== undefined) {
              const output = JSON.parse(string(resultAudit["output_json"], "legacy result output", 100_000)); const outputDigest = hexDigest(resultAudit["output_digest"], "legacy result output digest");
              if (linkedArrival["outcome"] === "INVALID") {
                const capsule = record(output, "legacy invalid Result capsule"); const deliveryCapsule = JSON.parse(persistedDelivery.rawResponseJson);
                const evidence = validateInvalidProviderAuditEvidenceAgainstCapsule(persistedDelivery.replayableResponseJson, prepared.modelId, persistedDelivery.rawResponseJson);
                if (outputDigest !== persistedDelivery.rawResponseDigest || capsule["kind"] !== "provider-response-redacted" || resultAudit["provider_metadata_json"] !== json(evidence.providerMetadata ?? {}) || resultAudit["usage_json"] !== json(evidence.usage ?? {}) || json(output) !== json(deliveryCapsule)) throw new Error("legacy invalid Result audit is invalid");
                expectedDetails.push(runtimeResultArrivalAuditDetails({ arrivalId: linkedArrivalId, attemptId, outcome: "INVALID", prepared, rawResponseDigest: persistedDelivery.rawResponseDigest, replayableResponseJson: persistedDelivery.replayableResponseJson }));
              } else {
                if (digest(output) !== outputDigest) throw new Error("legacy winner output digest mismatch");
                const providerMetadata = validateMetadata(JSON.parse(string(resultAudit["provider_metadata_json"], "legacy winner metadata", 100_000)), prepared.modelId); const usage = validateUsage(JSON.parse(string(resultAudit["usage_json"], "legacy winner usage", 100_000))); validation(prepared, output);
                expectedDetails.push(json({ arrivalId: linkedArrivalId, attemptId, boardRevision: prepared.boardRevision, contextDigest: prepared.contextDigest, modelId: prepared.modelId, node: prepared.profile, objectiveDigest: digest(prepared.objective), outcome: linkedArrival["outcome"], outputDigest, outputSchema: prepared.outputSchema, profileVersion: prepared.profileVersion, providerMetadata, providerPortVersion: prepared.providerPortVersion, rawResponseDigest: persistedDelivery.rawResponseDigest, runtimeVersion: prepared.runtimeVersion, selectedEntries: prepared.entries.map((entry) => ({ digest: entry.digest, id: entry.id })), usage, workflowDefinitionId: FIXED_WORKFLOW_DEFINITION_ID, workflowDefinitionVersion: FIXED_WORKFLOW_DEFINITION, workflowRevision: prepared.workflowRevision }));
              }
            }
          } catch { throw new Error("persisted runtime authority integrity failed: legacy Provider Delivery audit cannot be reconstructed"); }
        }
        let auditDetails: string; try { auditDetails = delivery["schema_version"] === "accord.runtime-provider-delivery/v1" ? json(JSON.parse(string(audit?.["details_json"], "legacy arrival audit details", 100_000))) : audit?.["details_json"] as string; } catch { throw new Error("persisted runtime authority integrity failed: Provider Delivery audit binding is invalid"); }
        if (audit === undefined || audit["schema_version"] !== CONTRACT_VERSIONS.auditEvent || audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(invocationId) || audit["recorded_at"] !== persistedDelivery.trustedReceivedAt || audit["event_kind"] !== `RUNTIME_RESULT:${linkedArrival["outcome"]}:${attemptId}:${linkedArrival["arrival_number"]}` || audit["case_id"] !== prepared.caseId || audit["board_id"] !== prepared.boardId || audit["workflow_run_id"] !== prepared.workflowRunId || audit["receipt_id"] !== null || !expectedDetails.includes(auditDetails)) throw new Error("persisted runtime authority integrity failed: Provider Delivery audit binding is invalid");
        if (persistedDelivery.attemptStateAtReceipt !== "RESULT_RECEIVED" && persistedDelivery.attemptStateAtReceipt !== attempt["state"]) throw new Error("persisted runtime authority integrity failed: terminal Provider Delivery disposition drifted");
      }
      if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") {
        const opaqueReceipts = rows(database, "SELECT opaque_receipt_id, schema_version, invocation_id, attempt_id, delivery_number, wire_utf8, wire_digest, trusted_received_at, attempt_state_at_receipt, receipt_binding FROM runtime_opaque_completion_receipts WHERE attempt_id = ? ORDER BY delivery_number", attemptId);
        for (const row of opaqueReceipts) {
          const receipt = opaqueReceiptFromRow(row, { invocationId, attemptId });
          validateGenericResolutionCarrier(prepared, attemptId, receipt.deliveryNumber, receipt.wireDigest, receipt.trustedReceivedAt);
        }
      }
      for (const [index, arrival] of arrivals.entries()) {
        const arrivalNumber = arrival["arrival_number"]; const arrivalId = parseArrivalId(arrival["arrival_id"]); if (!Number.isSafeInteger(arrivalNumber) || arrivalNumber !== index + 1 || arrivalId !== deriveRuntimeArrivalId({ invocationId, attemptId, arrivalNumber: arrivalNumber as number }) || typeof arrival["outcome"] !== "string") throw new Error("persisted runtime authority integrity failed: Arrival identity is invalid");
        const resultId = arrival["result_id"]; if (arrival["outcome"] === "UNKNOWN") { validateUnknownRuntimeArrival(database, prepared, attemptId, arrival); continue; }
        if (typeof arrival["response_id"] !== "string" || !physicalResponses.some((response) => response["response_id"] === arrival["response_id"])) throw new Error("persisted runtime authority integrity failed: Arrival lacks its physical Response");
        const linkedDeliveries = deliveries.filter((delivery) => delivery["arrival_id"] === arrivalId);
        if (linkedDeliveries.length !== 1 || linkedDeliveries[0]?.["response_id"] !== arrival["response_id"] || linkedDeliveries[0]?.["redacted_envelope_json"] !== arrival["raw_response_json"] || linkedDeliveries[0]?.["physical_capsule"] !== arrival["raw_response_json"] || linkedDeliveries[0]?.["wire_digest"] !== arrival["raw_response_digest"] || linkedDeliveries[0]?.["trusted_received_at"] !== arrival["recorded_at"] || linkedDeliveries[0]?.["delivery_number"] !== responseBearingArrivals.findIndex((candidate) => candidate["arrival_id"] === arrivalId) + 1) throw new Error("persisted runtime authority integrity failed: response-bearing Arrival does not have exactly one matching Provider Delivery");
        const result = one(database, "SELECT result_id, output_digest FROM runtime_results WHERE result_id = ? AND invocation_id = ? AND attempt_id = ?", resultId as string, invocationId, attemptId); if (result === undefined || parseResultId(result["result_id"]) !== deriveRuntimeResultId({ invocationId, attemptId, outputDigest: String(result["output_digest"]) })) throw new Error("persisted runtime authority integrity failed: Result identity or Arrival link is invalid");
      }
    }
    if (status === "RESULT_COMMITTED") {
      const winners = attempts.filter((attempt) => attempt["state"] === "WINNER");
      if (winners.length !== 1) throw new Error("persisted runtime authority integrity failed: committed Invocation does not have exactly one winner Attempt");
      const winner = one(database, `SELECT r.result_id, r.output_json, r.output_digest, a.arrival_id, a.response_id, a.raw_response_json, a.raw_response_digest, a.recorded_at
        FROM runtime_results r JOIN runtime_result_arrivals a ON a.result_id = r.result_id
        WHERE r.invocation_id = ? AND r.attempt_id = ? AND a.outcome = 'WINNER'`, invocationId, winners[0]?.["attempt_id"] as string);
      if (winner === undefined || typeof winner["response_id"] !== "string") throw new Error("persisted runtime authority integrity failed: winner Result lacks its Arrival response");
      const winnerAttemptId = parseAttemptId(winners[0]?.["attempt_id"]); const winnerResultId = parseResultId(winner["result_id"]); const winnerArrivalId = parseArrivalId(winner["arrival_id"]); const winnerRecordedAt = instant(winner["recorded_at"], "winner arrival time");
      let output: unknown; let envelope: Record<string, unknown>;
      try { output = JSON.parse(string(winner["output_json"], "winner output", 100_000)); envelope = record(JSON.parse(string(winner["raw_response_json"], "winner arrival", 100_000)), "winner arrival"); } catch { throw new Error("persisted runtime authority integrity failed: winner serialization is invalid"); }
      if (digest(output) !== winner["output_digest"] || envelope["envelopeDigest"] !== winner["raw_response_digest"]) throw new Error("persisted runtime authority integrity failed: winner digests are inconsistent");
      if (prepared.profile === "RESEARCHER" || prepared.profile === "ANALYST") try { validation(prepared, output); } catch { throw new Error("persisted runtime authority integrity failed: winner output no longer satisfies its schema"); }
      const response = one(database, "SELECT invocation_id, attempt_id, envelope_digest FROM runtime_physical_responses WHERE response_id = ?", winner["response_id"] as string);
      if (response === undefined || response["invocation_id"] !== invocationId || response["attempt_id"] !== winners[0]?.["attempt_id"] || response["envelope_digest"] !== winner["raw_response_digest"]) throw new Error("persisted runtime authority integrity failed: winner physical Response is inconsistent");
      const linked = rows(database, `SELECT entry.board_entry_id, entry.case_id, entry.board_id, entry.created_revision
        FROM runtime_result_entries link JOIN board_entries entry ON entry.board_entry_id = link.board_entry_id
        WHERE link.result_id = ?`, winner["result_id"] as string);
      if (linked.length === 0 || linked.some((entry) => entry["case_id"] !== prepared.caseId || entry["board_id"] !== prepared.boardId || entry["created_revision"] !== prepared.boardRevision + 1)) throw new Error("persisted runtime authority integrity failed: winner Board links leave the exact revision graph");
      if (prepared.profile === "RESEARCHER" || prepared.profile === "ANALYST") {
        try { assertExactWinnerBoardGraph(database, prepared, winnerResultId, output, winnerRecordedAt); } catch { throw new Error("persisted runtime authority integrity failed: winner Board graph does not exactly reconstruct from its output"); }
      } else {
        const audit = one(database, "SELECT details_json FROM audit_events WHERE audit_event_id = ?", deriveRuntimeAuditEventId("runtime-result-arrival", [winnerArrivalId]));
        if (audit === undefined) throw new Error("persisted runtime authority integrity failed: generic winner lacks its canonical audit");
        try { assertExactGenericWinnerBoardGraph(database, prepared, winnerResultId, genericMaterializationFromAudit(audit["details_json"], prepared, winnerAttemptId, winnerResultId), winnerRecordedAt); }
        catch { throw new Error("persisted runtime authority integrity failed: generic winner graph does not exactly reconstruct from its audit projection"); }
      }
      const board = one(database, "SELECT revision FROM boards WHERE board_id = ? AND case_id = ?", prepared.boardId, prepared.caseId);
      const workflow = one(database, "SELECT state, revision FROM workflow_runs WHERE workflow_run_id = ? AND case_id = ?", prepared.workflowRunId, prepared.caseId);
      const caseRow = one(database, "SELECT status FROM cases WHERE case_id = ?", prepared.caseId);
      const committedBoardRevision = prepared.boardRevision + 1;
      const committedWorkflowRevision = prepared.workflowRevision + 1;
      const committedWorkflowState = prepared.profile === "RESEARCHER" ? "ANALYST" : prepared.profile === "ANALYST" ? "REVIEWER" : prepared.profile === "REVIEWER" ? "WRITER" : "WAIT_FOR_APPROVAL";
      const workflowOrder = ["INTAKE", "WAIT_FOR_INPUT", "RESEARCHER", "ANALYST", "REVIEWER", "WRITER", "WAIT_FOR_APPROVAL", "FRESHNESS_CHECK", "PUBLISH", "COMPLETE"] as const;
      const currentWorkflowState = workflow?.["state"];
      const currentWorkflowRevision = workflow?.["revision"];
      const currentCaseStatus = caseRow?.["status"];
      const committedIndex = workflowOrder.indexOf(committedWorkflowState);
      const normalIndex = typeof currentWorkflowState === "string" ? workflowOrder.indexOf(currentWorkflowState as typeof workflowOrder[number]) : -1;
      const terminal = currentWorkflowState === "FAILED"
        ? { caseStatus: "FAILED", minimumAdvance: 1 }
        : currentWorkflowState === "PUBLICATION_HOLD"
          ? { caseStatus: "OPEN", minimumAdvance: workflowOrder.indexOf("PUBLISH") - committedIndex + 1 }
          : currentWorkflowState === "REJECTED"
            ? { caseStatus: "REJECTED", minimumAdvance: workflowOrder.indexOf("WAIT_FOR_APPROVAL") - committedIndex + 1 }
            : undefined;

      const normalStateIsConsistent = normalIndex >= committedIndex && currentCaseStatus === (currentWorkflowState === "COMPLETE" ? "COMPLETE" : "OPEN") && Number.isSafeInteger(currentWorkflowRevision) && (currentWorkflowRevision as number) >= committedWorkflowRevision + (normalIndex - committedIndex);
      const terminalStateIsConsistent = terminal !== undefined && currentCaseStatus === terminal.caseStatus && Number.isSafeInteger(currentWorkflowRevision) && (currentWorkflowRevision as number) >= committedWorkflowRevision + terminal.minimumAdvance;
      if (!Number.isSafeInteger(board?.["revision"]) || (board?.["revision"] as number) < committedBoardRevision || (!normalStateIsConsistent && !terminalStateIsConsistent)) throw new Error("persisted runtime authority integrity failed: winner does not retain one valid post-commit Case, Board, and Workflow state");
    }
    if (status !== "READY" && status !== "RUNNING" && status !== "UNKNOWN" && status !== "FAILED" && status !== "RESULT_COMMITTED") throw new Error("persisted runtime authority integrity failed: Invocation state is invalid");
    void prepared;
  }
  const persistedGenericResolutionAudits = rows(database, "SELECT audit_event_id FROM audit_events WHERE event_kind = ? OR event_kind GLOB ? OR json_extract(details_json, '$.schemaVersion') = ?", "RUNTIME_GENERIC_OUTPUT_RESOLUTION", "RUNTIME_GENERIC_OUTPUT_RESOLUTION:*", GENERIC_OUTPUT_RESOLUTION_VERSION);
  if (persistedGenericResolutionAudits.length !== genericResolutionAuditIds.size || persistedGenericResolutionAudits.some((audit) => !genericResolutionAuditIds.has(String(audit["audit_event_id"])))) throw new Error("persisted runtime authority integrity failed: generic output resolution audit is orphaned");
}
/** Returns the validated generic winner projection; the Result and Board graph remain authority. */
export function reconstructGenericWinnerMaterialization(database: DatabaseSync, invocationId: InvocationId): DurableGenericMaterialization | undefined {
  validatePersistedRuntimeAuthorityGraph(database);
  const prepared = canonicalPrepared(database, invocationId);
  if (prepared.profile !== "REVIEWER" && prepared.profile !== "WRITER") throw new TypeError("only generic Profile winners have a generic materialization projection");
  const winner = one(database, `SELECT result.result_id, result.attempt_id, arrival.arrival_id FROM runtime_results result JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id WHERE result.invocation_id = ? AND arrival.outcome = 'WINNER'`, prepared.invocationId);
  if (winner === undefined) return undefined;
  const resultId = parseResultId(winner["result_id"]); const attemptId = parseAttemptId(winner["attempt_id"]); const arrivalId = parseArrivalId(winner["arrival_id"]);
  const audit = one(database, "SELECT details_json FROM audit_events WHERE audit_event_id = ?", deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId]));
  if (audit === undefined) throw new Error("generic winner lacks its canonical materialization audit");
  return genericMaterializationFromAudit(audit["details_json"], prepared, attemptId, resultId);
}

function hasExactLegacyProviderDeliveryProvenance(database: DatabaseSync, delivery: Record<string, unknown>): boolean {
  return one(database, `SELECT 1 AS present FROM runtime_provider_delivery_legacy_provenance AS provenance
    JOIN runtime_provider_delivery_legacy_provenance_gate AS gate ON gate.gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'
    JOIN runtime_attempts AS attempt ON attempt.attempt_id = provenance.attempt_id AND attempt.invocation_id = provenance.invocation_id
    WHERE gate.state = 'SEALED' AND provenance.delivery_id = ?
      AND provenance.migration_id = '008_r003_opaque_completion_receipts'
      AND provenance.delivery_schema_version = 'accord.runtime-provider-delivery/v1'
      AND provenance.invocation_id = ? AND provenance.attempt_id = ? AND provenance.response_id = ?
      AND provenance.attempt_number = attempt.attempt_number
      AND provenance.delivery_number = ? AND provenance.wire_digest = ?
      AND provenance.redacted_envelope_json = ? AND provenance.replayable_response_json = ?
      AND provenance.trusted_received_at = ? AND provenance.physical_trusted_received_at = ?
      AND provenance.attempt_state_at_receipt = ? AND provenance.receipt_binding = ?
      AND provenance.original_attempt_state_at_receipt = ? AND provenance.original_receipt_state_binding = ?`,
    String(delivery["delivery_id"]), String(delivery["invocation_id"]), String(delivery["attempt_id"]), String(delivery["response_id"]), delivery["delivery_number"] as number,
    String(delivery["wire_digest"]), String(delivery["redacted_envelope_json"]), String(delivery["replayable_response_json"]), String(delivery["trusted_received_at"]), String(delivery["physical_trusted_received_at"]),
    String(delivery["attempt_state_at_receipt"]), String(delivery["receipt_binding"]), String(delivery["original_attempt_state_at_receipt"]), String(delivery["original_receipt_state_binding"])) !== undefined;
}

function legacyProviderDeliveryProvenanceSetBinding(database: DatabaseSync): string {
  return digest(rows(database, `SELECT delivery_id, migration_id, delivery_schema_version, invocation_id, attempt_id, attempt_number, response_id, delivery_number, wire_digest,
    redacted_envelope_json, replayable_response_json, trusted_received_at, physical_trusted_received_at,
    attempt_state_at_receipt, receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding
    FROM runtime_provider_delivery_legacy_provenance ORDER BY delivery_id`));
}

/** Closes the only migration-time provenance insert surface with its exact set. */
export function sealLegacyDeliveryProvenance(database: DatabaseSync): void {
  const gate = one(database, "SELECT state, provenance_count, provenance_set_binding FROM runtime_provider_delivery_legacy_provenance_gate WHERE gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'");
  const count = one(database, "SELECT count(*) AS count FROM runtime_provider_delivery_legacy_provenance")?.["count"];
  if (gate === undefined || !Number.isSafeInteger(count)) throw new Error("legacy Provider Delivery provenance gate is invalid");
  const binding = legacyProviderDeliveryProvenanceSetBinding(database);
  if (gate["state"] === "SEALED") {
    if (gate["provenance_count"] !== count || gate["provenance_set_binding"] !== binding) throw new Error("legacy Provider Delivery provenance seal is invalid");
    return;
  }
  if (gate["state"] !== "OPEN" || database.prepare("UPDATE runtime_provider_delivery_legacy_provenance_gate SET state = 'SEALED', provenance_count = ?, provenance_set_binding = ? WHERE gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1' AND state = 'OPEN'").run(count as number, binding).changes !== 1) throw new Error("legacy Provider Delivery provenance could not be sealed exactly once");
}

function validateLegacyProviderDeliveryProvenance(database: DatabaseSync): void {
  const gates = rows(database, "SELECT state, provenance_count, provenance_set_binding FROM runtime_provider_delivery_legacy_provenance_gate WHERE gate_id = 'runtime_provider_delivery_legacy_provenance_gate_v1'");
  const provenanceCount = one(database, "SELECT count(*) AS count FROM runtime_provider_delivery_legacy_provenance")?.["count"];
  if (gates.length !== 1 || gates[0]?.["state"] !== "SEALED" || !Number.isSafeInteger(gates[0]?.["provenance_count"]) || gates[0]?.["provenance_count"] !== provenanceCount || gates[0]?.["provenance_set_binding"] !== legacyProviderDeliveryProvenanceSetBinding(database)) throw new Error("persisted runtime authority integrity failed: legacy Provider Delivery provenance gate is invalid");
  const invalid = one(database, `SELECT 1 AS present
    FROM runtime_provider_delivery_legacy_provenance AS provenance
    LEFT JOIN runtime_provider_deliveries AS delivery ON delivery.delivery_id = provenance.delivery_id
    LEFT JOIN runtime_attempts AS attempt ON attempt.attempt_id = provenance.attempt_id AND attempt.invocation_id = provenance.invocation_id
    WHERE delivery.delivery_id IS NULL
      OR delivery.schema_version <> 'accord.runtime-provider-delivery/v1'
      OR delivery.original_receipt_state_binding <> '0000000000000000000000000000000000000000000000000000000000000000'
      OR provenance.migration_id <> '008_r003_opaque_completion_receipts'
      OR provenance.delivery_schema_version <> delivery.schema_version
      OR provenance.invocation_id <> delivery.invocation_id OR provenance.attempt_id <> delivery.attempt_id OR provenance.response_id <> delivery.response_id
      OR attempt.attempt_number IS NULL OR provenance.attempt_number <> attempt.attempt_number
      OR provenance.delivery_number <> delivery.delivery_number OR provenance.wire_digest <> delivery.wire_digest
      OR provenance.redacted_envelope_json <> delivery.redacted_envelope_json OR provenance.replayable_response_json <> delivery.replayable_response_json
      OR provenance.trusted_received_at <> delivery.trusted_received_at OR provenance.physical_trusted_received_at <> delivery.physical_trusted_received_at
      OR provenance.attempt_state_at_receipt <> delivery.attempt_state_at_receipt OR provenance.receipt_binding <> delivery.receipt_binding
      OR provenance.original_attempt_state_at_receipt <> delivery.original_attempt_state_at_receipt
      OR provenance.original_receipt_state_binding <> delivery.original_receipt_state_binding`);
  const missing = one(database, `SELECT 1 AS present FROM runtime_provider_deliveries AS delivery
    LEFT JOIN runtime_provider_delivery_legacy_provenance AS provenance ON provenance.delivery_id = delivery.delivery_id
    WHERE delivery.schema_version = 'accord.runtime-provider-delivery/v1'
      AND provenance.delivery_id IS NULL`);
  const currentWithLegacyBinding = one(database, `SELECT 1 AS present FROM runtime_provider_deliveries
    WHERE schema_version = 'accord.runtime-provider-delivery/v2'
      AND original_receipt_state_binding = '0000000000000000000000000000000000000000000000000000000000000000'`);
  if (invalid !== undefined || missing !== undefined || currentWithLegacyBinding !== undefined) throw new Error("persisted runtime authority integrity failed: legacy Provider Delivery provenance is invalid");
}

function assertSuppliedIdentity(supplied: PreparedProfileInvocation, prepared: PreparedProfileInvocation): void {
  const fields: readonly (keyof PreparedProfileInvocation)[] = ["boardId", "boardRevision", "caseId", "contextDigest", "contextId", "invocationId", "modelId", "objective", "outputSchema", "profile", "profileVersion", "providerPortVersion", "runtimeVersion", "workflowRevision", "workflowRunId"];
  if (fields.some((field) => supplied[field] !== prepared[field]) || json(supplied.entries) !== json(prepared.entries) || json(supplied.approvedSources) !== json(prepared.approvedSources) || json(supplied.permissionSummary) !== json(permissions)) throw new Error("provider result identity does not match its persisted Invocation");
}

function failInvocationIfExhausted(database: DatabaseSync, invocation: PreparedProfileInvocation, at: string): void {
  const count = one(database, "SELECT count(*) AS count FROM runtime_attempts WHERE invocation_id = ?", invocation.invocationId); if (count?.["count"] !== 2) return;
  database.prepare("UPDATE runtime_invocations SET status = 'FAILED' WHERE invocation_id = ? AND status <> 'RESULT_COMMITTED'").run(invocation.invocationId);
  /* An obsolete Invocation is audit-only: never fail a newer Run/Board/Case. */
  const fresh = one(database, "SELECT 1 AS present FROM runtime_invocations i JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id JOIN boards b ON b.board_id = i.board_id JOIN cases c ON c.case_id = i.case_id WHERE i.invocation_id = ? AND i.workflow_revision = ? AND i.board_revision = ? AND i.context_digest = ? AND w.state = ? AND w.revision = ? AND b.revision = ? AND c.status = 'OPEN'", invocation.invocationId, invocation.workflowRevision, invocation.boardRevision, invocation.contextDigest, invocation.profile, invocation.workflowRevision, invocation.boardRevision) !== undefined;
  if (fresh) { database.prepare("UPDATE workflow_runs SET state = 'FAILED', revision = revision + 1 WHERE workflow_run_id = ? AND state = ? AND revision = ?").run(invocation.workflowRunId, invocation.profile, invocation.workflowRevision); database.prepare("UPDATE cases SET status = 'FAILED' WHERE case_id = ? AND status = 'OPEN'").run(invocation.caseId); }
  const runtimeInvocationId = parseInvocationId(invocation.invocationId);
  database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, 'RUNTIME_ATTEMPTS_EXHAUSTED', ?, ?, ?, NULL, ?, ?)`).run(deriveRuntimeAuditEventId("runtime-exhausted", [runtimeInvocationId]), deriveRuntimeAuditCorrelationId(runtimeInvocationId), invocation.caseId, invocation.boardId, invocation.workflowRunId, json({ attemptBudget: 2, invocationId: invocation.invocationId, operatorDecisionRequired: true }), at);
}

export function beginPreparedAttempt(database: DatabaseSync, invocationId: InvocationId, now: string): PreparedAttempt {
  const prepared = canonicalPrepared(database, invocationId);
  const validInvocationId = parseInvocationId(prepared.invocationId);
  const startedAt = instant(now, "now");
  const claimed = transaction(database, () => {
    const invocation = one(database, "SELECT status FROM runtime_invocations WHERE invocation_id = ?", validInvocationId);
    if (invocation === undefined) throw new Error("unknown Invocation");
    if (invocation["status"] === "RESULT_COMMITTED" || invocation["status"] === "FAILED") throw new Error("Invocation is terminal");
    const fresh = one(database, "SELECT 1 AS present FROM runtime_invocations i JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id JOIN boards b ON b.board_id = i.board_id JOIN cases c ON c.case_id = i.case_id WHERE i.invocation_id = ? AND i.workflow_revision = ? AND i.board_revision = ? AND i.context_digest = ? AND w.state = ? AND w.revision = ? AND b.revision = ? AND c.status = 'OPEN'", validInvocationId, prepared.workflowRevision, prepared.boardRevision, prepared.contextDigest, prepared.profile, prepared.workflowRevision, prepared.boardRevision) !== undefined;
    if (!fresh) {
      database.prepare("UPDATE runtime_invocations SET status = 'FAILED' WHERE invocation_id = ? AND status IN ('READY', 'UNKNOWN')").run(validInvocationId);
      database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, 'RUNTIME_INVOCATION_STALE', ?, ?, ?, NULL, ?, ?)`)
        .run(deriveRuntimeAuditEventId("runtime-stale", [validInvocationId]), deriveRuntimeAuditCorrelationId(validInvocationId), prepared.caseId, prepared.boardId, prepared.workflowRunId, json({ invocationId: validInvocationId, outcome: "STALE", preDispatch: true }), startedAt);
      return undefined;
    }
    let attempt = one(database, "SELECT attempt_id, attempt_number FROM runtime_attempts WHERE invocation_id = ? AND state = 'READY'", validInvocationId);
    if (attempt === undefined && invocation["status"] === "UNKNOWN") {
      const count = one(database, "SELECT count(*) AS count FROM runtime_attempts WHERE invocation_id = ?", validInvocationId);
      if (count?.["count"] !== 1) throw new Error("Invocation exhausted its two-Attempt budget");
      const attemptId = deriveRuntimeAttemptId({ invocationId: validInvocationId, attemptNumber: 2 });
      database.prepare(`INSERT INTO runtime_attempts (attempt_id, schema_version, invocation_id, attempt_number, state, no_sdk_retry, created_at) VALUES (?, 'accord.runtime-attempt/v1', ?, 2, 'READY', 1, ?)`).run(attemptId, validInvocationId, startedAt);
      attempt = { attempt_id: attemptId, attempt_number: 2 };
    }
    if (attempt === undefined) throw new Error("Invocation has no claimable Attempt");
    const attemptId = parseAttemptId(attempt["attempt_id"]);
    const attemptNumber = attempt["attempt_number"];
    if (attemptNumber !== 1 && attemptNumber !== 2) throw new TypeError("invalid persisted attempt number");
    if (database.prepare("UPDATE runtime_attempts SET state = 'RUNNING', started_at = ? WHERE attempt_id = ? AND state = 'READY'").run(startedAt, attemptId).changes !== 1) throw new Error("Attempt was claimed concurrently");
    database.prepare("UPDATE runtime_invocations SET status = 'RUNNING' WHERE invocation_id = ? AND status IN ('READY', 'UNKNOWN')").run(validInvocationId);
    return Object.freeze({ attemptId, attemptNumber, invocationId: validInvocationId, noSdkRetry: true });
  });
  if (claimed === undefined) throw new Error("Invocation snapshot is stale; a fresh authorized Invocation is required");
  return claimed;
}

function researcherOutput(value: unknown, prepared: PreparedProfileInvocation): ResearcherOutput { const output = record(value, "Researcher output"); exact(output, ["evidenceRefs", "intents", "observations"], "Researcher output"); const parseItems = <T>(field: string, parser: (item: Record<string, unknown>) => T): readonly T[] => { const raw = output[field]; if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) throw new TypeError(`${field} must be a non-empty bounded array`); return Object.freeze(raw.map((item, index) => parser(record(item, `${field}[${index}]`)))); }; const contextIds = new Set(prepared.entries.map((entry) => entry.id)); const sources = new Map(prepared.approvedSources.map((item) => [item.sourceId, item])); const intents = parseItems("intents", (item) => { exact(item, ["basedOn", "objective", "scope"], "intent"); const basedOn = strings(item["basedOn"], "intent basedOn").map(parseBoardEntryId); if (!basedOn.every((entry) => contextIds.has(entry))) throw new TypeError("Intent relation leaves Researcher context"); return { basedOn, objective: string(item["objective"], "intent objective"), scope: string(item["scope"], "intent scope") }; }); const evidenceRefs = parseItems("evidenceRefs", (item) => { exact(item, ["locator", "observedAt", "sourceDigest", "sourceId", "sourceKind"], "EvidenceRef"); const sourceId = parseSourceId(item["sourceId"]); const approved = sources.get(sourceId); if (approved === undefined || item["sourceKind"] !== approved.sourceKind || item["locator"] !== approved.locator || item["sourceDigest"] !== digest(approved.content) || item["observedAt"] !== approved.observedAt) throw new TypeError("EvidenceRef must exactly reference an approved synthetic source"); return sourceReference(approved); }); const emittedSources = new Set<SourceId>(evidenceRefs.map((item) => item.sourceId)); if (emittedSources.size !== evidenceRefs.length) throw new TypeError("EvidenceRef source IDs must be unique"); const observations = parseItems("observations", (item) => { exact(item, ["basedOn", "sourceRefs", "statement"], "observation"); const basedOn = strings(item["basedOn"], "observation basedOn").map(parseBoardEntryId); const sourceRefs = strings(item["sourceRefs"], "observation sourceRefs").map(parseSourceId); if (basedOn.length + sourceRefs.length === 0 || !basedOn.every((entry) => contextIds.has(entry)) || !sourceRefs.every((ref) => emittedSources.has(ref))) throw new TypeError("Observation source references must resolve through this Researcher output's EvidenceRefs"); return { basedOn, sourceRefs, statement: string(item["statement"], "observation statement") }; }); return { evidenceRefs, intents, observations }; }
function analystOutput(value: unknown, prepared: PreparedProfileInvocation): AnalystOutput { const output = record(value, "Analyst output"); exact(output, ["claims", "proposals"], "Analyst output"); const rawClaims = output["claims"]; const rawProposals = output["proposals"]; if (!Array.isArray(rawClaims) || !Array.isArray(rawProposals) || rawClaims.length === 0 || rawProposals.length === 0 || rawClaims.length > 16 || rawProposals.length > 16) throw new TypeError("Analyst output requires bounded claims and proposals"); const allowed = new Set(prepared.entries.filter((entry) => entry.type === "EvidenceRef" || entry.type === "Observation").map((entry) => entry.id)); const claims = rawClaims.map((raw, index) => { const item = record(raw, `claim[${index}]`); exact(item, ["statement", "supportingEntryIds", "unsupported"], "claim"); const supportingEntryIds = strings(item["supportingEntryIds"], "claim supportingEntryIds").map(parseBoardEntryId); const unsupported = item["unsupported"]; if (typeof unsupported !== "boolean" || !supportingEntryIds.every((entry) => allowed.has(entry)) || (unsupported ? supportingEntryIds.length !== 0 : supportingEntryIds.length === 0)) throw new TypeError("Claim support must be explicit and within Analyst context"); return { statement: string(item["statement"], "claim statement"), supportingEntryIds, unsupported }; }); const proposals = rawProposals.map((raw, index) => { const item = record(raw, `proposal[${index}]`); exact(item, ["action", "supportStatus", "supportingClaimIndexes"], "proposal"); const rawStatus = item["supportStatus"]; if ((rawStatus !== "SUPPORTED" && rawStatus !== "UNSUPPORTED") || !Array.isArray(item["supportingClaimIndexes"])) throw new TypeError("Proposal support status is invalid"); const supportStatus: "SUPPORTED" | "UNSUPPORTED" = rawStatus; const supportingClaimIndexes = item["supportingClaimIndexes"].map((claimIndex, itemIndex) => { if (!Number.isSafeInteger(claimIndex) || claimIndex < 0 || claimIndex >= claims.length) throw new TypeError(`proposal claim reference ${itemIndex} is invalid`); return claimIndex; }); const referencesUnsupportedClaim = supportingClaimIndexes.some((claimIndex) => claims[claimIndex]?.unsupported); if (new Set(supportingClaimIndexes).size !== supportingClaimIndexes.length || (supportStatus === "SUPPORTED" ? supportingClaimIndexes.length === 0 || referencesUnsupportedClaim : supportingClaimIndexes.length !== 1 || !referencesUnsupportedClaim)) throw new TypeError("Proposal support relation is inconsistent"); return { action: string(item["action"], "proposal action"), supportStatus, supportingClaimIndexes: Object.freeze(supportingClaimIndexes) }; }); return { claims: Object.freeze(claims), proposals: Object.freeze(proposals) }; }
type ValidatedProfileOutput = ResearcherOutput | AnalystOutput | GenericMaterializationCandidate;
function validation(prepared: PreparedProfileInvocation, value: unknown, contract?: InvocationBoundOutputContract): ValidatedProfileOutput {
  if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") return materializeInvocationOutput(prepared, value, contract);
  if (prepared.profile === "RESEARCHER") return researcherOutput(value, prepared);
  const analyst = analystOutput(value, prepared);
  const plantedClaim = analyst.claims.find((claim) => claim.statement === "Customer adoption is guaranteed." && claim.unsupported && claim.supportingEntryIds.length === 0);
  const plantedClaimIndex = analyst.claims.findIndex((claim) => claim.statement === "Customer adoption is guaranteed." && claim.unsupported && claim.supportingEntryIds.length === 0);
  const plantedProposal = analyst.proposals.find((proposal) => proposal.action === "Promise adoption." && proposal.supportStatus === "UNSUPPORTED" && proposal.supportingClaimIndexes.length === 1 && proposal.supportingClaimIndexes[0] === plantedClaimIndex);
  if (plantedClaim === undefined || plantedProposal === undefined) throw new TypeError("Analyst output must retain the frozen planted unsupported Proposal and Claim");
  return analyst;
}
export interface ExpectedRuntimeBoardEntry {
  readonly authorId: "RESEARCHER" | "ANALYST";
  readonly authorType: "AGENT";
  readonly basedOn: readonly string[];
  readonly contentDigest: string;
  readonly contradicts: readonly [];
  readonly entryId: BoardEntryId;
  readonly instructionAuthority: "NONE";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schemaVersion: "accord.board-entry/v1";
  readonly sourceRefs: readonly string[];
  readonly status: "CANDIDATE";
  readonly supersedes: readonly [];
  readonly trustLevel: "CANDIDATE";
  readonly type: EntryType;
  readonly visibility: "CASE";
}
function expectedRuntimeBoardEntries(prepared: PreparedProfileInvocation, validated: ResearcherOutput | AnalystOutput): readonly ExpectedRuntimeBoardEntry[] {
  const entries: { type: EntryType; payload: Record<string, unknown>; sourceRefs: readonly string[]; basedOn: readonly string[] }[] = [];
  if (prepared.profile === "RESEARCHER") {
    const result = validated as ResearcherOutput;
    const evidenceEntryIds = new Map(result.evidenceRefs.map((item, index) => [item.sourceId, deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "EvidenceRef", index: result.intents.length + index })]));
    entries.push(...result.intents.map((item) => ({ type: "Intent" as const, payload: { objective: item.objective, scope: item.scope }, sourceRefs: [], basedOn: item.basedOn })), ...result.evidenceRefs.map((item) => ({ type: "EvidenceRef" as const, payload: { ...item }, sourceRefs: [item.sourceId], basedOn: [] })), ...result.observations.map((item) => ({ type: "Observation" as const, payload: { statement: item.statement }, sourceRefs: item.sourceRefs.map((sourceId) => evidenceEntryIds.get(sourceId) as string), basedOn: item.basedOn })));
  } else {
    const result = validated as AnalystOutput;
    const claimIds = result.claims.map((_, index) => deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "Claim", index }));
    entries.push(...result.claims.map((item) => ({ type: "Claim" as const, payload: { statement: item.statement, unsupported: item.unsupported }, sourceRefs: [], basedOn: item.supportingEntryIds })), ...result.proposals.map((item) => ({ type: "Proposal" as const, payload: { action: item.action, supportStatus: item.supportStatus }, sourceRefs: [], basedOn: item.supportingClaimIndexes.map((index) => claimIds[index] as string) })));
  }
  return Object.freeze(entries.map((entry, index) => {
    const entryId = prepared.profile === "ANALYST" && entry.type === "Claim" ? deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "Claim", index: entries.slice(0, index + 1).filter((item) => item.type === "Claim").length - 1 }) : deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: entry.type, index });
    const authorId = prepared.profile as "RESEARCHER" | "ANALYST";
    const immutable = { authorId, authorType: "AGENT", basedOn: entry.basedOn, contradicts: [], entryType: entry.type, instructionAuthority: "NONE", payload: entry.payload, sourceRefs: entry.sourceRefs, status: "CANDIDATE", supersedes: [], trustLevel: "CANDIDATE", visibility: "CASE" };
    return Object.freeze({ authorId, authorType: "AGENT", basedOn: entry.basedOn, contentDigest: digest(immutable), contradicts: [] as const, entryId, instructionAuthority: "NONE", payload: Object.freeze(entry.payload), schemaVersion: "accord.board-entry/v1", sourceRefs: entry.sourceRefs, status: "CANDIDATE", supersedes: [] as const, trustLevel: "CANDIDATE", type: entry.type, visibility: "CASE" });
  }));
}
/** Reconstructs only the exact entry graph a persisted winning output could have appended. */
export function reconstructWinnerBoardEntries(database: DatabaseSync, invocationId: InvocationId, output: unknown): readonly ExpectedRuntimeBoardEntry[] {
  const prepared = canonicalPrepared(database, invocationId);
  if (prepared.profile !== "RESEARCHER" && prepared.profile !== "ANALYST") throw new Error("generic Profile winners reconstruct from their durable materialization audit");
  return expectedRuntimeBoardEntries(prepared, validation(prepared, output) as ResearcherOutput | AnalystOutput);
}

/** The result link is not sufficient evidence: the entire committed revision
 * must be the deterministic graph derived from the schema-valid winner. */
function assertExactWinnerBoardGraph(database: DatabaseSync, prepared: PreparedProfileInvocation, resultId: ResultId, output: unknown, createdAt: string): void {
  const expected = reconstructWinnerBoardEntries(database, prepared.invocationId, output);
  const actual = rows(database, `SELECT entry.board_entry_id, entry.schema_version, entry.board_id, entry.case_id, entry.entry_type, entry.status, entry.author_type, entry.author_id,
      entry.payload_json, entry.source_refs_json, entry.based_on_json, entry.contradicts_json, entry.supersedes_json, entry.visibility, entry.trust_level,
      entry.instruction_authority, entry.created_revision, entry.content_digest, entry.created_at
    FROM board_entries entry WHERE entry.case_id = ? AND entry.board_id = ? AND entry.created_revision = ? ORDER BY entry.board_entry_id`, prepared.caseId, prepared.boardId, prepared.boardRevision + 1);
  const links = rows(database, "SELECT board_entry_id FROM runtime_result_entries WHERE result_id = ? ORDER BY board_entry_id", resultId);
  if (actual.length !== expected.length || links.length !== expected.length || new Set(links.map((link) => link["board_entry_id"])).size !== links.length) throw new Error("persisted runtime authority integrity failed: winner Board graph has extra or missing entries");
  const actualById = new Map(actual.map((entry) => [entry["board_entry_id"], entry]));
  for (const entry of expected) {
    const row = actualById.get(entry.entryId);
    if (row === undefined || !links.some((link) => link["board_entry_id"] === entry.entryId)) throw new Error("persisted runtime authority integrity failed: winner Board graph is not exactly linked");
    const immutable = { authorId: row["author_id"], authorType: row["author_type"], basedOn: JSON.parse(string(row["based_on_json"], "winner Board basedOn", 100_000)), contradicts: JSON.parse(string(row["contradicts_json"], "winner Board contradicts", 100_000)), entryType: row["entry_type"], instructionAuthority: row["instruction_authority"], payload: JSON.parse(string(row["payload_json"], "winner Board payload", 100_000)), sourceRefs: JSON.parse(string(row["source_refs_json"], "winner Board sourceRefs", 100_000)), status: row["status"], supersedes: JSON.parse(string(row["supersedes_json"], "winner Board supersedes", 100_000)), trustLevel: row["trust_level"], visibility: row["visibility"] };
    const expectedImmutable = { authorId: entry.authorId, authorType: entry.authorType, basedOn: entry.basedOn, contradicts: entry.contradicts, entryType: entry.type, instructionAuthority: entry.instructionAuthority, payload: entry.payload, sourceRefs: entry.sourceRefs, status: entry.status, supersedes: entry.supersedes, trustLevel: entry.trustLevel, visibility: entry.visibility };
    if (row["schema_version"] !== entry.schemaVersion || row["board_id"] !== prepared.boardId || row["case_id"] !== prepared.caseId || row["board_entry_id"] !== entry.entryId || row["created_revision"] !== prepared.boardRevision + 1 || row["created_at"] !== createdAt || row["content_digest"] !== digest(immutable) || row["content_digest"] !== entry.contentDigest || json(immutable) !== json(expectedImmutable)) throw new Error("persisted runtime authority integrity failed: winner Board entry does not exactly reconstruct");
  }
}

function assertExactGenericWinnerBoardGraph(database: DatabaseSync, prepared: PreparedProfileInvocation, resultId: ResultId, materialization: DurableGenericMaterialization, createdAt: string): void {
  const actual = rows(database, `SELECT board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type, author_id, payload_json, source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level, instruction_authority, created_revision, content_digest, created_at
    FROM board_entries WHERE case_id = ? AND board_id = ? AND created_revision = ? ORDER BY board_entry_id`, prepared.caseId, prepared.boardId, materialization.batchRevision);
  const links = rows(database, "SELECT board_entry_id FROM runtime_result_entries WHERE result_id = ? ORDER BY board_entry_id", resultId);
  if (actual.length !== materialization.boardEntries.length || links.length !== materialization.boardEntries.length || new Set(links.map((link) => link["board_entry_id"])).size !== links.length) throw new Error("persisted runtime authority integrity failed: generic winner Board graph has extra or missing entries");
  const actualById = new Map(actual.map((entry) => [entry["board_entry_id"], entry]));
  for (const entry of materialization.boardEntries) {
    const row = actualById.get(entry.entryId);
    if (row === undefined || !links.some((link) => link["board_entry_id"] === entry.entryId)) throw new Error("persisted runtime authority integrity failed: generic winner Board graph is not exactly linked");
    const immutable = { authorId: row["author_id"], authorType: row["author_type"], basedOn: JSON.parse(string(row["based_on_json"], "generic winner Board basedOn", 100_000)), contradicts: JSON.parse(string(row["contradicts_json"], "generic winner Board contradicts", 100_000)), entryType: row["entry_type"], instructionAuthority: row["instruction_authority"], payload: JSON.parse(string(row["payload_json"], "generic winner Board payload", 100_000)), sourceRefs: JSON.parse(string(row["source_refs_json"], "generic winner Board sourceRefs", 100_000)), status: row["status"], supersedes: JSON.parse(string(row["supersedes_json"], "generic winner Board supersedes", 100_000)), trustLevel: row["trust_level"], visibility: row["visibility"] };
    const expected = { authorId: prepared.profile, authorType: "AGENT", basedOn: entry.basedOn, contradicts: [], entryType: entry.entryType, instructionAuthority: "NONE", payload: entry.payload, sourceRefs: entry.sourceRefs, status: "CANDIDATE", supersedes: [], trustLevel: "CANDIDATE", visibility: "CASE" };
    if (row["schema_version"] !== CONTRACT_VERSIONS.boardEntry || row["board_id"] !== prepared.boardId || row["case_id"] !== prepared.caseId || row["created_revision"] !== materialization.batchRevision || row["created_at"] !== createdAt || row["content_digest"] !== entry.contentDigest || row["content_digest"] !== digest(immutable) || json(immutable) !== json(expected)) throw new Error("persisted runtime authority integrity failed: generic winner Board entry does not exactly reconstruct");
  }
}
function validateMetadata(value: unknown, modelId: string): ProviderMetadata { const metadata = record(value, "provider metadata"); exact(metadata, providerMetadataFields, "provider metadata"); for (const field of providerMetadataFields) string(metadata[field], `provider metadata ${field}`, 512); if (metadata["providerPortVersion"] !== NATIVE_BAIZHI_PROVIDER_PORT_VERSION || metadata["modelId"] !== modelId) throw new TypeError("provider metadata does not identify the configured port and model"); return Object.freeze({ deploymentId: metadata["deploymentId"] as string, modelId: metadata["modelId"] as string, providerPortVersion: metadata["providerPortVersion"] as typeof NATIVE_BAIZHI_PROVIDER_PORT_VERSION, requestId: metadata["requestId"] as string, responseId: metadata["responseId"] as string }); }
type ProviderUsage = Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
type ProviderAuditEvidence = Readonly<{ providerMetadata?: ProviderMetadata; providerReceivedAt?: string; usage?: ProviderUsage }>;
function validateUsage(value: unknown): ProviderUsage { const usage = record(value, "usage"); exact(usage, ["inputTokens", "outputTokens", "totalTokens"], "usage"); for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) if (!Number.isSafeInteger(usage[key]) || (usage[key] as number) < 0) throw new TypeError("usage must contain non-negative integers"); if ((usage["inputTokens"] as number) + (usage["outputTokens"] as number) !== usage["totalTokens"]) throw new TypeError("usage total is invalid"); return Object.freeze({ inputTokens: usage["inputTokens"] as number, outputTokens: usage["outputTokens"] as number, totalTokens: usage["totalTokens"] as number }); }

function providerAuditEvidence(response: Record<string, unknown> | undefined, modelId: string): ProviderAuditEvidence {
  if (response === undefined) return Object.freeze({});
  let providerMetadata: ProviderMetadata | undefined;
  let providerReceivedAt: string | undefined;
  let usage: ProviderUsage | undefined;
  try { providerMetadata = validateMetadata(response["providerMetadata"], modelId); } catch { /* redact only this invalid field */ }
  try { providerReceivedAt = instant(response["receivedAt"], "receivedAt"); } catch { /* redact only this invalid field */ }
  try { usage = validateUsage(response["usage"]); } catch { /* redact only this invalid field */ }
  return Object.freeze({ ...(providerMetadata === undefined ? {} : { providerMetadata }), ...(providerReceivedAt === undefined ? {} : { providerReceivedAt }), ...(usage === undefined ? {} : { usage }) });
}

const INVALID_PROVIDER_AUDIT_KIND = "accord.invalid-provider-audit/v1";
function invalidProviderAuditReplay(evidence: ProviderAuditEvidence): string {
  return json({ kind: INVALID_PROVIDER_AUDIT_KIND, providerMetadata: evidence.providerMetadata ?? null, providerReceivedAt: evidence.providerReceivedAt ?? null, usage: evidence.usage ?? null });
}
function parseInvalidProviderAuditReplay(value: string, modelId: string): ProviderAuditEvidence {
  if (value === "{}") return Object.freeze({});
  const persisted = record(JSON.parse(string(value, "invalid provider audit replay", 65_536)) as unknown, "invalid provider audit replay");
  exact(persisted, ["kind", "providerMetadata", "providerReceivedAt", "usage"], "invalid provider audit replay");
  if (persisted["kind"] !== INVALID_PROVIDER_AUDIT_KIND) throw new TypeError("invalid provider audit replay kind is invalid");
  const providerMetadata = persisted["providerMetadata"] === null ? undefined : validateMetadata(persisted["providerMetadata"], modelId);
  const providerReceivedAt = persisted["providerReceivedAt"] === null ? undefined : instant(persisted["providerReceivedAt"], "invalid provider audit receipt time");
  const usage = persisted["usage"] === null ? undefined : validateUsage(persisted["usage"]);
  return Object.freeze({ ...(providerMetadata === undefined ? {} : { providerMetadata }), ...(providerReceivedAt === undefined ? {} : { providerReceivedAt }), ...(usage === undefined ? {} : { usage }) });
}

export const MAX_PROVIDER_WIRE_CHARACTERS = 65_536;
export const MAX_PROVIDER_WIRE_UTF8_BYTES = 65_536;
const MAX_PROVIDER_WIRE_NODES = 256;
const MAX_PROVIDER_WIRE_DEPTH = 8;
const MAX_PROVIDER_WIRE_ARRAY_ITEMS = 16;
const MAX_PROVIDER_WIRE_STRING_CHARACTERS = 4_096;

function wireDigest(wire: string): string { return createHash("sha256").update(wire, "utf8").digest("hex"); }
function isLosslessUtf8(value: string): boolean { return Buffer.from(value, "utf8").toString("utf8") === value; }
type ContractRejectionReason = ContractRejection["reason"];
type AdmittedProviderWire = Readonly<{ kind: "WIRE"; wire: string }> | Readonly<{ kind: "REJECTED"; reason: ContractRejectionReason }>;
type ParsedProviderWire = Readonly<{ kind: "WIRE"; digest: string; parsed: unknown | undefined; wire: string }> | Readonly<{ kind: "REJECTED"; reason: ContractRejectionReason }>;

/**
 * Runs only on a bounded primitive string. It rejects duplicate decoded keys
 * that JSON.parse would otherwise overwrite, and caps generic JSON shape
 * before semantic validation begins.
 */
function inspectProviderWireJson(wire: string): void {
  let offset = 0; let nodes = 0;
  const whitespace = (): void => { while (/\s/u.test(wire[offset] ?? "")) offset += 1; };
  const fail = (): never => { throw new TypeError("provider wire has invalid or excessive JSON structure"); };
  const tokenString = (): string => {
    const start = offset; if (wire[offset] !== "\"") return fail(); offset += 1;
    while (offset < wire.length) {
      const code = wire.charCodeAt(offset);
      if (code === 0x22) { offset += 1; const token = wire.slice(start, offset); if (token.length > MAX_PROVIDER_WIRE_STRING_CHARACTERS) return fail(); return JSON.parse(token) as string; }
      if (code < 0x20) return fail();
      if (code === 0x5c) {
        offset += 1; const escape = wire[offset];
        if (escape === "u") { const hexadecimal = wire.slice(offset + 1, offset + 5); if (!/^[0-9a-f]{4}$/iu.test(hexadecimal)) return fail(); offset += 5; continue; }
        if (escape !== "\"" && escape !== "\\" && escape !== "/" && escape !== "b" && escape !== "f" && escape !== "n" && escape !== "r" && escape !== "t") return fail();
      }
      offset += 1;
    }
    return fail();
  };
  const number = (): void => {
    if (wire[offset] === "-") offset += 1;
    if (wire[offset] === "0") offset += 1;
    else { if (!/[1-9]/u.test(wire[offset] ?? "")) return fail(); while (/[0-9]/u.test(wire[offset] ?? "")) offset += 1; }
    if (wire[offset] === ".") { offset += 1; if (!/[0-9]/u.test(wire[offset] ?? "")) return fail(); while (/[0-9]/u.test(wire[offset] ?? "")) offset += 1; }
    if (wire[offset] === "e" || wire[offset] === "E") { offset += 1; if (wire[offset] === "+" || wire[offset] === "-") offset += 1; if (!/[0-9]/u.test(wire[offset] ?? "")) return fail(); while (/[0-9]/u.test(wire[offset] ?? "")) offset += 1; }
  };
  const value = (depth: number): void => {
    if (++nodes > MAX_PROVIDER_WIRE_NODES || depth > MAX_PROVIDER_WIRE_DEPTH) return fail(); whitespace();
    if (wire[offset] === "\"") { tokenString(); return; }
    if (wire[offset] === "{") {
      offset += 1; whitespace(); const keys = new Set<string>(); let count = 0;
      if (wire[offset] === "}") { offset += 1; return; }
      while (true) {
        const key = tokenString(); if (++count > MAX_PROVIDER_WIRE_ARRAY_ITEMS || keys.has(key)) return fail(); keys.add(key); whitespace(); if (wire[offset] !== ":") return fail(); offset += 1; value(depth + 1); whitespace();
        if (wire[offset] === "}") { offset += 1; return; } if (wire[offset] !== ",") return fail(); offset += 1; whitespace();
      }
    }
    if (wire[offset] === "[") {
      offset += 1; whitespace(); let count = 0;
      if (wire[offset] === "]") { offset += 1; return; }
      while (true) {
        if (++count > MAX_PROVIDER_WIRE_ARRAY_ITEMS) return fail(); value(depth + 1); whitespace();
        if (wire[offset] === "]") { offset += 1; return; } if (wire[offset] !== ",") return fail(); offset += 1; whitespace();
      }
    }
    if (wire.startsWith("true", offset)) { offset += 4; return; }
    if (wire.startsWith("false", offset)) { offset += 5; return; }
    if (wire.startsWith("null", offset)) { offset += 4; return; }
    number();
  };
  whitespace(); value(0); whitespace(); if (offset !== wire.length) fail();
}

/**
 * The character cap is deliberately the first operation on a primitive wire.
 * In particular, an oversized value is neither encoded, copied, hashed,
 * parsed, logged, nor used to derive an identity.
 */
function admitProviderWire(value: unknown): AdmittedProviderWire {
  if (typeof value !== "string") return Object.freeze({ kind: "REJECTED", reason: "NON_STRING" });
  if (value.length > MAX_PROVIDER_WIRE_CHARACTERS) return Object.freeze({ kind: "REJECTED", reason: "CHARACTER_LIMIT" });
  if (Buffer.byteLength(value, "utf8") > MAX_PROVIDER_WIRE_UTF8_BYTES) return Object.freeze({ kind: "REJECTED", reason: "UTF8_BYTE_LIMIT" });
  if (!isLosslessUtf8(value)) return Object.freeze({ kind: "REJECTED", reason: "NON_LOSSLESS_UTF8" });
  return Object.freeze({ kind: "WIRE", wire: value });
}

/** JSON inspection starts only after the admitted wire has a durable receipt. */
function parseProviderWire(value: unknown): ParsedProviderWire {
  const admitted = admitProviderWire(value);
  if (admitted.kind === "REJECTED") return admitted;
  const wire = admitted.wire;
  const digestValue = wireDigest(wire);
  try { inspectProviderWireJson(wire); const parsed = JSON.parse(wire) as unknown; return Object.freeze({ kind: "WIRE", digest: digestValue, parsed, wire }); } catch { return Object.freeze({ kind: "WIRE", digest: digestValue, parsed: undefined, wire }); }
}

function parsedField(value: unknown, key: string): unknown { return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; }
function safeIdentifier(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") return Object.freeze({ present: value !== undefined, valid: false });
  return Object.freeze({ bytes: Buffer.byteLength(value, "utf8"), digest: wireDigest(value), valid: value.length >= 1 && value.length <= 512 && value.trim() === value && !/[\p{Cc}\p{Cs}]/u.test(value) });
}
function safeEnvelope(parsed: unknown, digestValue: string): unknown {
  const metadata = parsedField(parsed, "providerMetadata"); const usage = parsedField(parsed, "usage"); const timestamp = parsedField(parsed, "receivedAt"); const output = parsedField(parsed, "output");
  const metadataFields = Object.fromEntries(providerMetadataFields.map((key) => [key, safeIdentifier(parsedField(metadata, key))]));
  const usageFields = Object.fromEntries(["inputTokens", "outputTokens", "totalTokens"].map((key) => { const item = parsedField(usage, key); return [key, Number.isSafeInteger(item) && typeof item === "number" && item >= 0 ? item : null]; }));
  let providerReceivedAt: string | null = null; try { providerReceivedAt = instant(timestamp, "receivedAt"); } catch { /* only bounded evidence is retained */ }
  return Object.freeze({ kind: "provider-response-redacted/v3", metadata: metadataFields, outputEvidenceDigest: output === undefined ? null : digest(output), providerReceivedAt, providerTimestampEvidence: safeIdentifier(timestamp), usage: usageFields, wireDigest: digestValue });
}
function rawResponse(parsed: unknown, digestValue: string, validationErrors: readonly string[] = []): string {
  const contents = { envelope: safeEnvelope(parsed, digestValue), envelopeDigest: digestValue, kind: "provider-response-redacted", validationErrors: validationErrors.length === 0 ? [] : ["INVALID_PROVIDER_RESULT"] };
  return json({ ...contents, capsuleDigest: digest(contents) });
}
function providerTimestamp(parsed: unknown): string | null { try { return instant(parsedField(parsed, "receivedAt"), "receivedAt"); } catch { return null; } }
function runtimeResultArrivalAuditDetails(input: Readonly<{ arrivalId: ArrivalId; attemptId: AttemptId; outcome: string; prepared: PreparedProfileInvocation; rawResponseDigest: string; replayableResponseJson: string; resultId?: ResultId; materialization?: DurableGenericMaterialization }>): string {
  if (input.outcome === "INVALID") {
    const evidence = parseInvalidProviderAuditReplay(input.replayableResponseJson, input.prepared.modelId);
    return json({ arrivalId: input.arrivalId, attemptId: input.attemptId, boardRevision: input.prepared.boardRevision, contextDigest: input.prepared.contextDigest, invalidReason: "INVALID_PROVIDER_RESULT", modelId: input.prepared.modelId, node: input.prepared.profile, objectiveDigest: digest(input.prepared.objective), outcome: input.outcome, outputSchema: input.prepared.outputSchema, profileVersion: input.prepared.profileVersion, providerMetadata: evidence.providerMetadata, providerPortVersion: input.prepared.providerPortVersion, providerReceivedAt: evidence.providerReceivedAt, rawResponseDigest: input.rawResponseDigest, runtimeVersion: input.prepared.runtimeVersion, selectedEntries: input.prepared.entries.map((entry) => ({ digest: entry.digest, id: entry.id })), usage: evidence.usage, workflowDefinitionId: FIXED_WORKFLOW_DEFINITION_ID, workflowDefinitionVersion: FIXED_WORKFLOW_DEFINITION, workflowRevision: input.prepared.workflowRevision });
  }
  const generic = input.prepared.profile === "REVIEWER" || input.prepared.profile === "WRITER";
  let invalidReason: string | undefined;
  let providerMetadata: ProviderMetadata | undefined;
  let usage: ProviderUsage | undefined;
  let outputDigest: string | undefined;
  let materialization: DurableGenericMaterialization | undefined;
  try {
    const parsed = parseProviderWire(input.replayableResponseJson);
    if (parsed.kind !== "WIRE" || parsed.parsed === undefined || parsed.digest !== input.rawResponseDigest) throw new TypeError("provider result is not replayable");
    const response = record(parsed.parsed, "provider result"); exact(response, ["output", "providerMetadata", "receivedAt", "usage"], "provider result");
    instant(response["receivedAt"], "receivedAt"); providerMetadata = validateMetadata(response["providerMetadata"], input.prepared.modelId); usage = validateUsage(response["usage"]); outputDigest = digest(response["output"]);
    if (generic && input.outcome === "WINNER") {
      if (input.resultId === undefined || input.materialization === undefined || deriveRuntimeResultId({ invocationId: input.prepared.invocationId, attemptId: input.attemptId, outputDigest }) !== input.resultId) throw new TypeError("generic winner Result identity is invalid");
      materialization = parseDurableGenericMaterialization(input.prepared, input.attemptId, input.resultId, input.materialization);
    } else if (!generic) validation(input.prepared, response["output"]);
  } catch (error) {
    if (generic && input.outcome === "WINNER") throw new Error("generic winner materialization audit cannot be reconstructed", { cause: error });
    invalidReason = "INVALID_PROVIDER_RESULT";
  }
  return json({ arrivalId: input.arrivalId, attemptId: input.attemptId, boardRevision: input.prepared.boardRevision, contextDigest: input.prepared.contextDigest, invalidReason, ...(materialization === undefined ? {} : { materialization }), modelId: input.prepared.modelId, node: input.prepared.profile, objectiveDigest: digest(input.prepared.objective), outcome: input.outcome, outputDigest, outputSchema: input.prepared.outputSchema, profileVersion: input.prepared.profileVersion, providerMetadata: invalidReason === undefined ? providerMetadata : undefined, providerPortVersion: input.prepared.providerPortVersion, rawResponseDigest: input.rawResponseDigest, runtimeVersion: input.prepared.runtimeVersion, selectedEntries: input.prepared.entries.map((entry) => ({ digest: entry.digest, id: entry.id })), usage: invalidReason === undefined ? usage : undefined, workflowDefinitionId: FIXED_WORKFLOW_DEFINITION_ID, workflowDefinitionVersion: FIXED_WORKFLOW_DEFINITION, workflowRevision: input.prepared.workflowRevision });
}

function genericMaterializationFromAudit(value: unknown, prepared: PreparedProfileInvocation, attemptId: AttemptId, resultId: ResultId): DurableGenericMaterialization {
  let details: Record<string, unknown>;
  try { details = record(JSON.parse(string(value, "generic winner audit details", GENERIC_AUDIT_JSON_MAX_CHARS)) as unknown, "generic winner audit details"); }
  catch (error) { throw new Error("generic winner audit details are invalid", { cause: error }); }
  if (!Object.hasOwn(details, "materialization")) throw new Error("generic winner audit lacks its durable materialization");
  return parseDurableGenericMaterialization(prepared, attemptId, resultId, details["materialization"]);
}

function recordContractRejection(database: DatabaseSync, prepared: PreparedProfileInvocation, attempt: PreparedAttempt, reason: ContractRejectionReason, at: string): ContractRejection {
  return transaction(database, () => {
    const persisted = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ?", attempt.attemptId);
    if (persisted === undefined) throw new Error("provider contract rejection Attempt is missing");
    if (persisted["state"] !== "RUNNING" && persisted["state"] !== "RESULT_RECEIVED") return Object.freeze({ attemptId: attempt.attemptId, invocationId: prepared.invocationId, outcome: "CONTRACT_REJECTED", reason });
    database.prepare("UPDATE runtime_attempts SET state = 'DISCARDED', finished_at = ? WHERE attempt_id = ? AND state IN ('RUNNING', 'RESULT_RECEIVED')").run(at, attempt.attemptId);
    const fresh = one(database, "SELECT 1 AS present FROM runtime_invocations i JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id JOIN boards b ON b.board_id = i.board_id JOIN cases c ON c.case_id = i.case_id WHERE i.invocation_id = ? AND i.workflow_revision = ? AND i.board_revision = ? AND i.context_digest = ? AND w.state = ? AND w.revision = ? AND b.revision = ? AND c.status = 'OPEN'", prepared.invocationId, prepared.workflowRevision, prepared.boardRevision, prepared.contextDigest, prepared.profile, prepared.workflowRevision, prepared.boardRevision) !== undefined;
    database.prepare("UPDATE runtime_invocations SET status = 'FAILED' WHERE invocation_id = ? AND status = 'RUNNING'").run(prepared.invocationId);
    if (fresh) {
      database.prepare("UPDATE workflow_runs SET state = 'FAILED', revision = revision + 1 WHERE workflow_run_id = ? AND state = ? AND revision = ?").run(prepared.workflowRunId, prepared.profile, prepared.workflowRevision);
      database.prepare("UPDATE cases SET status = 'FAILED' WHERE case_id = ? AND status = 'OPEN'").run(prepared.caseId);
    }
    database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, 'RUNTIME_PROVIDER_CONTRACT_REJECTED', ?, ?, ?, NULL, ?, ?)`)
      .run(deriveRuntimeAuditEventId("runtime-contract-rejected", [attempt.attemptId]), deriveRuntimeAuditCorrelationId(prepared.invocationId), prepared.caseId, prepared.boardId, prepared.workflowRunId, json({ attemptId: attempt.attemptId, outcome: "CONTRACT_REJECTED", reason, retry: "DISABLED" }), at);
    return Object.freeze({ attemptId: attempt.attemptId, invocationId: prepared.invocationId, outcome: "CONTRACT_REJECTED", reason });
  });
}

type GenericOutputResolution = Readonly<{ accepted: false }> | Readonly<{ accepted: true; candidate: GenericMaterializationCandidate }>;
const GENERIC_OUTPUT_RESOLUTION_VERSION = "accord.runtime-generic-output-resolution/v1" as const;

function resolveGenericOutput(prepared: PreparedProfileInvocation, value: ProviderWire, contract: InvocationBoundOutputContract): GenericOutputResolution {
  const parsed = parseProviderWire(value);
  try {
    if (parsed.kind !== "WIRE" || parsed.parsed === undefined) throw new TypeError("provider result is not JSON");
    const response = record(parsed.parsed, "provider result"); exact(response, ["output", "providerMetadata", "receivedAt", "usage"], "provider result");
    const evidence = providerAuditEvidence(response, prepared.modelId);
    if (evidence.providerMetadata === undefined || evidence.providerReceivedAt === undefined || evidence.usage === undefined) throw new TypeError("provider envelope is invalid");
    return Object.freeze({ accepted: true, candidate: materializeInvocationOutput(prepared, response["output"], contract) });
  } catch { return Object.freeze({ accepted: false }); }
}
function genericResolutionAuditId(attemptId: AttemptId, deliveryNumber: number): string {
  return `audit_${digest({ attemptId, deliveryNumber, namespace: "runtime-generic-output-resolution" })}`;
}
function genericResolutionEventKind(attemptId: AttemptId, deliveryNumber: number): string {
  return `RUNTIME_GENERIC_OUTPUT_RESOLUTION:${attemptId}:${deliveryNumber}`;
}

function validatedGenericOutputResolution(database: DatabaseSync, prepared: PreparedProfileInvocation, attemptId: AttemptId, deliveryNumber: number, wireDigestValue: string, recordedAt: string): GenericOutputResolution {
  if (prepared.profile !== "REVIEWER" && prepared.profile !== "WRITER") throw new TypeError("generic output resolution requires a generic Profile");
  const audit = one(database, "SELECT schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at FROM audit_events WHERE audit_event_id = ?", genericResolutionAuditId(attemptId, deliveryNumber));
  if (audit === undefined || audit["schema_version"] !== CONTRACT_VERSIONS.auditEvent || audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(prepared.invocationId) || audit["event_kind"] !== genericResolutionEventKind(attemptId, deliveryNumber) || audit["case_id"] !== prepared.caseId || audit["board_id"] !== prepared.boardId || audit["workflow_run_id"] !== prepared.workflowRunId || audit["receipt_id"] !== null || audit["recorded_at"] !== recordedAt) throw new Error("generic output resolution audit binding is invalid");
  const details = record(JSON.parse(string(audit["details_json"], "generic output resolution audit", GENERIC_AUDIT_JSON_MAX_CHARS)) as unknown, "generic output resolution audit");
  const accepted = details["accepted"];
  exact(details, ["accepted", "attemptId", "contextDigest", "contextId", "deliveryNumber", "invocationId", "outputSchema", "profile", "profileVersion", "schemaVersion", "wireDigest", ...(accepted === true ? ["candidate"] : [])], "generic output resolution audit");
  if ((accepted !== true && accepted !== false) || details["schemaVersion"] !== GENERIC_OUTPUT_RESOLUTION_VERSION || details["invocationId"] !== prepared.invocationId || details["attemptId"] !== attemptId || details["deliveryNumber"] !== deliveryNumber || details["wireDigest"] !== wireDigestValue || details["contextId"] !== prepared.contextId || details["contextDigest"] !== prepared.contextDigest || details["profile"] !== prepared.profile || details["profileVersion"] !== prepared.profileVersion || details["outputSchema"] !== prepared.outputSchema) throw new Error("generic output resolution immutable tuple is invalid");
  if (!accepted) return Object.freeze({ accepted: false });
  const replay: InvocationBoundOutputContract = { invocationId: prepared.invocationId, contextDigest: prepared.contextDigest, profile: prepared.profile, profileVersion: prepared.profileVersion, outputSchema: prepared.outputSchema, materialize: () => details["candidate"] as GenericMaterializationCandidate };
  const candidate = materializeInvocationOutput(prepared, undefined, replay);
  if (json(candidate) !== json(details["candidate"])) throw new Error("generic output resolution candidate is not canonical");
  return Object.freeze({ accepted: true, candidate });
}

type PersistedProviderDelivery = Readonly<{
  deliveryId: ProviderDeliveryId;
  deliveryNumber: number;
  responseId: ResponseId;
  rawResponseDigest: string;
  rawResponseJson: string;
  replayableResponseJson: string;
  trustedReceivedAt: string;
  physicalTrustedReceivedAt: string;
  /** The exact Attempt disposition when this wire was durably received. */
  originalAttemptStateAtReceipt: OpaqueReceiptState;
  attemptStateAtReceipt: "RESULT_RECEIVED" | "DISCARDED" | "UNKNOWN" | "WINNER";
  receiptBinding: string;
}>;

type OpaqueReceiptState = "RUNNING" | "RESULT_RECEIVED" | "DISCARDED" | "UNKNOWN" | "WINNER";
type PersistedOpaqueCompletionReceipt = Readonly<{
  opaqueReceiptId: OpaqueCompletionReceiptId;
  deliveryNumber: number;
  invocationId: InvocationId;
  attemptId: AttemptId;
  wire: string;
  wireDigest: string;
  trustedReceivedAt: string;
  attemptStateAtReceipt: OpaqueReceiptState;
  receiptBinding: string;
}>;

function opaqueReceiptBinding(input: Readonly<{ invocationId: InvocationId; attemptId: AttemptId; deliveryNumber: number; wire: string; wireDigest: string; trustedReceivedAt: string; attemptStateAtReceipt: OpaqueReceiptState }>): string {
  return digest({ attemptId: input.attemptId, attemptStateAtReceipt: input.attemptStateAtReceipt, deliveryNumber: input.deliveryNumber, invocationId: input.invocationId, trustedReceivedAt: input.trustedReceivedAt, wire: input.wire, wireDigest: input.wireDigest });
}

function opaqueReceiptFromRow(row: Record<string, unknown>, expected?: Readonly<{ invocationId: InvocationId; attemptId: AttemptId }>): PersistedOpaqueCompletionReceipt {
  const invocationId = parseInvocationId(row["invocation_id"]);
  const attemptId = parseAttemptId(row["attempt_id"]);
  if (expected !== undefined && (invocationId !== expected.invocationId || attemptId !== expected.attemptId)) throw new Error("opaque completion receipt is not bound to its Invocation and Attempt");
  const deliveryNumber = row["delivery_number"];
  const attemptStateAtReceipt = row["attempt_state_at_receipt"];
  if (row["schema_version"] !== CONTRACT_VERSIONS.runtimeOpaqueCompletionReceipt || !Number.isSafeInteger(deliveryNumber) || (attemptStateAtReceipt !== "RUNNING" && attemptStateAtReceipt !== "RESULT_RECEIVED" && attemptStateAtReceipt !== "DISCARDED" && attemptStateAtReceipt !== "UNKNOWN" && attemptStateAtReceipt !== "WINNER")) throw new Error("opaque completion receipt has an invalid immutable tuple");
  const wire = row["wire_utf8"];
  const admitted = admitProviderWire(wire);
  if (admitted.kind !== "WIRE") throw new Error("opaque completion receipt has an unbounded wire");
  const wireDigestValue = hexDigest(row["wire_digest"], "opaque completion receipt wire digest");
  if (wireDigest(admitted.wire) !== wireDigestValue) throw new Error("opaque completion receipt wire digest is invalid");
  const trustedReceivedAt = instant(row["trusted_received_at"], "opaque completion receipt time");
  const receiptBinding = hexDigest(row["receipt_binding"], "opaque completion receipt binding");
  const bindingInput = { attemptId, attemptStateAtReceipt: attemptStateAtReceipt as OpaqueReceiptState, deliveryNumber: deliveryNumber as number, invocationId, trustedReceivedAt, wire: admitted.wire, wireDigest: wireDigestValue };
  const opaqueReceiptId = deriveRuntimeOpaqueCompletionReceiptId({ attemptId, receiptBinding });
  if (receiptBinding !== opaqueReceiptBinding(bindingInput) || row["opaque_receipt_id"] !== opaqueReceiptId) throw new Error("opaque completion receipt identity is invalid");
  return Object.freeze({ ...bindingInput, opaqueReceiptId, receiptBinding });
}

/** Persists an admitted wire and, for generic Profiles, its pure-contract resolution atomically. */
function persistOpaqueCompletionReceipt(database: DatabaseSync, input: Readonly<{ invocationId: InvocationId; attemptId: AttemptId; wire: string; trustedReceivedAt: string; generic?: Readonly<{ prepared: PreparedProfileInvocation; resolution: GenericOutputResolution }> }>): PersistedOpaqueCompletionReceipt {
  return transaction(database, () => {
    const attempt = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ? AND invocation_id = ?", input.attemptId, input.invocationId);
    if (attempt === undefined || typeof attempt["state"] !== "string") throw new Error("opaque completion receipt Attempt is missing");
    const state = attempt["state"];
    if (state !== "RUNNING" && state !== "RESULT_RECEIVED" && state !== "DISCARDED" && state !== "UNKNOWN" && state !== "WINNER") throw new Error("opaque completion receipt Attempt is not deliverable");
    const sequence = one(database, `SELECT coalesce(max(delivery_number), 0) + 1 AS delivery_number FROM (
      SELECT delivery_number FROM runtime_provider_deliveries WHERE attempt_id = ?
      UNION ALL SELECT delivery_number FROM runtime_opaque_completion_receipts WHERE attempt_id = ?
    )`, input.attemptId, input.attemptId)?.["delivery_number"];
    if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) throw new Error("opaque completion receipt sequence is invalid");
    const deliveryNumber = sequence as number; const wireDigestValue = wireDigest(input.wire);
    const bindingInput = { attemptId: input.attemptId, attemptStateAtReceipt: state as OpaqueReceiptState, deliveryNumber, invocationId: input.invocationId, trustedReceivedAt: input.trustedReceivedAt, wire: input.wire, wireDigest: wireDigestValue };
    const receiptBinding = opaqueReceiptBinding(bindingInput); const opaqueReceiptId = deriveRuntimeOpaqueCompletionReceiptId({ attemptId: input.attemptId, receiptBinding });
    database.prepare(`INSERT INTO runtime_opaque_completion_receipts (opaque_receipt_id, schema_version, invocation_id, attempt_id, delivery_number, wire_utf8, wire_digest, trusted_received_at, attempt_state_at_receipt, receipt_binding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(opaqueReceiptId as string, CONTRACT_VERSIONS.runtimeOpaqueCompletionReceipt, input.invocationId, input.attemptId, deliveryNumber, input.wire, wireDigestValue, input.trustedReceivedAt, state as string, receiptBinding);
    if (input.generic !== undefined) {
      const { prepared, resolution } = input.generic;
      if ((prepared.profile !== "REVIEWER" && prepared.profile !== "WRITER") || prepared.invocationId !== input.invocationId) throw new Error("generic output resolution is not bound to its Invocation");
      const details = { accepted: resolution.accepted, attemptId: input.attemptId, contextDigest: prepared.contextDigest, contextId: prepared.contextId, deliveryNumber, invocationId: prepared.invocationId, outputSchema: prepared.outputSchema, profile: prepared.profile, profileVersion: prepared.profileVersion, schemaVersion: GENERIC_OUTPUT_RESOLUTION_VERSION, wireDigest: wireDigestValue, ...(resolution.accepted ? { candidate: resolution.candidate } : {}) };
      database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(genericResolutionAuditId(input.attemptId, deliveryNumber), deriveRuntimeAuditCorrelationId(prepared.invocationId), genericResolutionEventKind(input.attemptId, deliveryNumber), prepared.caseId, prepared.boardId, prepared.workflowRunId, json(details), input.trustedReceivedAt);
    }
    return Object.freeze({ ...bindingInput, opaqueReceiptId, receiptBinding });
  });
}

type DeliveryReceiptState = PersistedProviderDelivery["attemptStateAtReceipt"];
function deliveryReceiptBinding(input: Readonly<{ invocationId: InvocationId; attemptId: AttemptId; responseId: ResponseId; deliveryNumber: number; rawResponseDigest: string; rawResponseJson: string; replayableResponseJson: string; trustedReceivedAt: string; physicalTrustedReceivedAt: string; attemptStateAtReceipt: DeliveryReceiptState }>): string {
  return digest({ attemptId: input.attemptId, attemptStateAtReceipt: input.attemptStateAtReceipt, deliveryNumber: input.deliveryNumber, invocationId: input.invocationId, physicalTrustedReceivedAt: input.physicalTrustedReceivedAt, rawResponseDigest: input.rawResponseDigest, rawResponseJson: input.rawResponseJson, replayableResponseJson: input.replayableResponseJson, responseId: input.responseId, trustedReceivedAt: input.trustedReceivedAt });
}
function deliveryOriginalReceiptStateBinding(input: Readonly<{ receiptBinding: string; originalAttemptStateAtReceipt: OpaqueReceiptState }>): string {
  return digest({ originalAttemptStateAtReceipt: input.originalAttemptStateAtReceipt, receiptBinding: input.receiptBinding });
}

function deliveryFromRow(database: DatabaseSync, row: Record<string, unknown>, expected: Readonly<{ invocationId: InvocationId; attemptId: AttemptId; modelId: string; allowLegacy?: boolean }>): PersistedProviderDelivery {
  const responseId = parseResponseId(row["response_id"]); const deliveryNumber = row["delivery_number"];
  const attemptStateAtReceipt = row["attempt_state_at_receipt"];
  const originalAttemptStateAtReceipt = row["original_attempt_state_at_receipt"];
  const legacy = row["schema_version"] === "accord.runtime-provider-delivery/v1";
  if (!Number.isSafeInteger(deliveryNumber) || (attemptStateAtReceipt !== "RESULT_RECEIVED" && attemptStateAtReceipt !== "DISCARDED" && attemptStateAtReceipt !== "UNKNOWN" && attemptStateAtReceipt !== "WINNER") || (!legacy && row["schema_version"] !== CONTRACT_VERSIONS.runtimeProviderDelivery) || (legacy && !expected.allowLegacy) || row["invocation_id"] !== expected.invocationId || row["attempt_id"] !== expected.attemptId || row["physical_invocation_id"] !== expected.invocationId || row["physical_attempt_id"] !== expected.attemptId || row["envelope_digest"] !== row["wire_digest"] || row["physical_capsule"] !== row["redacted_envelope_json"] || row["physical_replay"] !== row["replayable_response_json"]) throw new Error("Provider Delivery immutable tuple is invalid");
  const rawResponseDigest = hexDigest(row["wire_digest"], "persisted delivery wire digest"); const rawResponseJson = string(row["redacted_envelope_json"], "persisted delivery capsule", 65_536); const replayableResponseJson = string(row["replayable_response_json"], "persisted delivery replay", 65_536); const trustedReceivedAt = instant(row["trusted_received_at"], "persisted delivery receipt time"); const physicalTrustedReceivedAt = instant(row["physical_trusted_received_at"], "physical receipt time");
  if (row["physical_received_at"] !== physicalTrustedReceivedAt) throw new Error("Provider Delivery physical receipt time is invalid");
  if (originalAttemptStateAtReceipt !== "RUNNING" && originalAttemptStateAtReceipt !== "RESULT_RECEIVED" && originalAttemptStateAtReceipt !== "DISCARDED" && originalAttemptStateAtReceipt !== "UNKNOWN" && originalAttemptStateAtReceipt !== "WINNER") throw new Error("Provider Delivery original receipt disposition is invalid");
  const receiptBinding = hexDigest(row["receipt_binding"], "Provider Delivery receipt binding");
  const originalReceiptStateBinding = hexDigest(row["original_receipt_state_binding"], "Provider Delivery original receipt disposition binding");
  const bindingInput = { attemptId: expected.attemptId, attemptStateAtReceipt: attemptStateAtReceipt as DeliveryReceiptState, deliveryNumber: deliveryNumber as number, invocationId: expected.invocationId, physicalTrustedReceivedAt, rawResponseDigest, rawResponseJson, replayableResponseJson, responseId, trustedReceivedAt };
  if (receiptBinding !== deliveryReceiptBinding(bindingInput) || row["delivery_id"] !== deriveRuntimeProviderDeliveryId({ attemptId: expected.attemptId, receiptBinding })) throw new Error("Provider Delivery receipt binding is invalid");
  if (legacy) {
    if (originalReceiptStateBinding !== "0000000000000000000000000000000000000000000000000000000000000000" || originalAttemptStateAtReceipt !== attemptStateAtReceipt || !hasExactLegacyProviderDeliveryProvenance(database, row)) throw new Error("legacy Provider Delivery original receipt disposition is invalid");
  } else if (originalReceiptStateBinding === "0000000000000000000000000000000000000000000000000000000000000000" || originalReceiptStateBinding !== deliveryOriginalReceiptStateBinding({ originalAttemptStateAtReceipt: originalAttemptStateAtReceipt as OpaqueReceiptState, receiptBinding })) throw new Error("Provider Delivery original receipt disposition binding is invalid");
  if (!legacy) try {
    const capsule = validateCanonicalReceiptCapsule(rawResponseJson, rawResponseDigest);
    const physicalProviderReceivedAt = row["physical_provider_received_at"] === null ? null : instant(row["physical_provider_received_at"], "physical provider receipt time");
    if (capsule.providerReceivedAt !== physicalProviderReceivedAt) throw new Error("delivery replay is inconsistent");
    if (capsule.invalid) validateInvalidProviderAuditEvidenceAgainstCapsule(replayableResponseJson, expected.modelId, rawResponseJson);
    else if (rawResponse(JSON.parse(replayableResponseJson), rawResponseDigest) !== rawResponseJson) throw new Error("delivery replay is inconsistent");
  } catch { throw new Error("Provider Delivery capsule is invalid"); }
  return Object.freeze({ ...bindingInput, deliveryId: row["delivery_id"] as ProviderDeliveryId, originalAttemptStateAtReceipt: originalAttemptStateAtReceipt as OpaqueReceiptState, receiptBinding });
}

function persistProviderReceipt(database: DatabaseSync, input: Readonly<{ attemptId: AttemptId; invocationId: InvocationId; parsed: unknown; rawResponseDigest: string; rawResponseJson: string; replayableResponseJson: string; responseId: ResponseId; trustedReceivedAt: string; opaqueReceipt?: PersistedOpaqueCompletionReceipt }>): PersistedProviderDelivery {
  return transaction(database, () => {
    const attempt = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ?", input.attemptId);
    if (attempt === undefined || typeof attempt["state"] !== "string") throw new Error("physical response Attempt is missing");
    const terminal = attempt["state"] === "DISCARDED" || attempt["state"] === "UNKNOWN" || attempt["state"] === "WINNER";
    if (!terminal && attempt["state"] !== "RUNNING" && attempt["state"] !== "RESULT_RECEIVED") throw new Error("provider receipt Attempt is not deliverable");
    const existing = one(database, "SELECT response_id, invocation_id, attempt_id, envelope_digest, redacted_envelope_json, replayable_response_json, trusted_received_at, provider_received_at FROM runtime_physical_responses WHERE response_id = ?", input.responseId);
    if (existing === undefined) {
      database.prepare("INSERT INTO runtime_physical_responses (response_id, schema_version, invocation_id, attempt_id, envelope_digest, redacted_envelope_json, trusted_received_at, provider_received_at, replayable_response_json) VALUES (?, 'accord.runtime-physical-response/v1', ?, ?, ?, ?, ?, ?, ?)").run(input.responseId, input.invocationId, input.attemptId, input.rawResponseDigest, input.rawResponseJson, input.trustedReceivedAt, providerTimestamp(input.parsed), input.replayableResponseJson);
    } else if (existing["invocation_id"] !== input.invocationId || existing["attempt_id"] !== input.attemptId || existing["envelope_digest"] !== input.rawResponseDigest || existing["redacted_envelope_json"] !== input.rawResponseJson || existing["replayable_response_json"] !== input.replayableResponseJson || existing["provider_received_at"] !== providerTimestamp(input.parsed)) {
      throw new Error("physical response identity conflicts with its immutable receipt");
    }
    const number = one(database, "SELECT count(*) + 1 AS delivery_number FROM runtime_provider_deliveries WHERE attempt_id = ?", input.attemptId)?.["delivery_number"];
    if (!Number.isSafeInteger(number)) throw new Error("provider delivery sequence is invalid");
    const deliveryNumber = number as number;
    const attemptStateAtReceipt = (terminal ? attempt["state"] : "RESULT_RECEIVED") as DeliveryReceiptState;
    const physicalTrustedReceivedAt = existing === undefined ? input.trustedReceivedAt : instant(existing["trusted_received_at"], "physical receipt time");
    const bindingInput = { attemptId: input.attemptId, attemptStateAtReceipt, deliveryNumber, invocationId: input.invocationId, physicalTrustedReceivedAt, rawResponseDigest: input.rawResponseDigest, rawResponseJson: input.rawResponseJson, replayableResponseJson: input.replayableResponseJson, responseId: input.responseId, trustedReceivedAt: input.trustedReceivedAt };
    const receiptBinding = deliveryReceiptBinding(bindingInput); const deliveryId = deriveRuntimeProviderDeliveryId({ attemptId: input.attemptId, receiptBinding });
    const originalAttemptStateAtReceipt = input.opaqueReceipt?.attemptStateAtReceipt ?? attemptStateAtReceipt;
    const originalReceiptStateBinding = deliveryOriginalReceiptStateBinding({ originalAttemptStateAtReceipt, receiptBinding });
    database.prepare(`INSERT INTO runtime_provider_deliveries (delivery_id, schema_version, invocation_id, attempt_id, response_id, delivery_number, wire_digest, redacted_envelope_json, replayable_response_json, trusted_received_at, physical_trusted_received_at, attempt_state_at_receipt, receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(deliveryId, CONTRACT_VERSIONS.runtimeProviderDelivery, input.invocationId, input.attemptId, input.responseId, deliveryNumber, input.rawResponseDigest, input.rawResponseJson, input.replayableResponseJson, input.trustedReceivedAt, physicalTrustedReceivedAt, attemptStateAtReceipt, receiptBinding, originalAttemptStateAtReceipt, originalReceiptStateBinding);
    database.prepare("UPDATE runtime_attempts SET state = 'RESULT_RECEIVED' WHERE attempt_id = ? AND state = 'RUNNING'").run(input.attemptId);
    if (input.opaqueReceipt !== undefined) {
    if (input.opaqueReceipt.invocationId !== input.invocationId || input.opaqueReceipt.attemptId !== input.attemptId || input.opaqueReceipt.deliveryNumber !== deliveryNumber || input.opaqueReceipt.wireDigest !== input.rawResponseDigest || input.opaqueReceipt.trustedReceivedAt !== input.trustedReceivedAt || input.opaqueReceipt.attemptStateAtReceipt !== originalAttemptStateAtReceipt) throw new Error("opaque completion receipt does not match its converted Delivery");
      database.prepare("DELETE FROM runtime_opaque_completion_receipts WHERE opaque_receipt_id = ?").run(input.opaqueReceipt.opaqueReceiptId);
    }
    return Object.freeze({ ...bindingInput, deliveryId, originalAttemptStateAtReceipt, receiptBinding });
  });
}

function linkDeliveryArrival(database: DatabaseSync, delivery: PersistedProviderDelivery, arrivalId: ArrivalId): void {
  database.prepare("INSERT INTO runtime_delivery_arrivals (delivery_id, arrival_id) VALUES (?, ?)").run(delivery.deliveryId, arrivalId);
}

function pendingDeliveryForAttempt(database: DatabaseSync, invocationId: InvocationId, attemptId: AttemptId, modelId: string): PersistedProviderDelivery {
  const pending = rows(database, `SELECT d.delivery_id, d.schema_version, d.invocation_id, d.attempt_id, d.response_id, d.delivery_number, d.wire_digest, d.redacted_envelope_json, d.replayable_response_json, d.trusted_received_at, d.physical_trusted_received_at, d.attempt_state_at_receipt, d.receipt_binding, d.original_attempt_state_at_receipt, d.original_receipt_state_binding,
      p.invocation_id AS physical_invocation_id, p.attempt_id AS physical_attempt_id, p.envelope_digest, p.redacted_envelope_json AS physical_capsule, p.replayable_response_json AS physical_replay, p.trusted_received_at AS physical_received_at, p.provider_received_at AS physical_provider_received_at
    FROM runtime_provider_deliveries d
    JOIN runtime_physical_responses p ON p.response_id = d.response_id
    LEFT JOIN runtime_delivery_arrivals linked ON linked.delivery_id = d.delivery_id
    WHERE d.attempt_id = ? AND linked.delivery_id IS NULL ORDER BY d.delivery_number`, attemptId);
  if (pending.length !== 1) throw new Error("RESULT_RECEIVED Attempt does not have exactly one pending durable delivery");
  const delivery = deliveryFromRow(database, pending[0]!, { attemptId, invocationId, modelId });
  if (delivery.attemptStateAtReceipt !== "RESULT_RECEIVED") throw new Error("RESULT_RECEIVED Attempt durable delivery disposition is invalid");
  return delivery;
}

function assertConsumedDelivery(delivery: PersistedProviderDelivery, input: Readonly<{ rawResponseDigest: string; rawResponseJson: string; replayableResponseJson: string; responseId: ResponseId; trustedReceivedAt: string }>): void {
  if (delivery.rawResponseDigest !== input.rawResponseDigest || delivery.rawResponseJson !== input.rawResponseJson || delivery.replayableResponseJson !== input.replayableResponseJson || delivery.responseId !== input.responseId || delivery.trustedReceivedAt !== input.trustedReceivedAt) throw new Error("persisted provider delivery does not match its exact immutable tuple");
}

/** Validates v7 chronology before migration 008 can copy or seal any Delivery. */
export function validateLegacyRuntimeDeliveryChronology(database: DatabaseSync): void {
  const attempts = rows(database, "SELECT attempt_id, state, finished_at FROM runtime_attempts ORDER BY attempt_id");
  for (const attempt of attempts) {
    const attemptId = parseAttemptId(attempt["attempt_id"]); const state = attempt["state"];
    if (state !== "READY" && state !== "RUNNING" && state !== "RESULT_RECEIVED" && state !== "DISCARDED" && state !== "UNKNOWN" && state !== "WINNER") throw new Error("legacy Provider Delivery Attempt has an invalid state");
    const chronology = rows(database, "SELECT arrival_number, response_id, outcome, recorded_at FROM runtime_result_arrivals WHERE attempt_id = ? ORDER BY arrival_number", attemptId);
    if (chronology.some((arrival, index) => arrival["arrival_number"] !== index + 1 || (arrival["response_id"] === null && arrival["outcome"] !== "UNKNOWN"))) throw new Error("legacy Provider Delivery Arrival chronology is invalid");
    if (state !== "DISCARDED" && state !== "UNKNOWN" && state !== "WINNER") continue;
    const terminalAt = instant(attempt["finished_at"], "legacy terminal Attempt time");
    const contractRejected = state === "DISCARDED" && one(database, "SELECT 1 AS present FROM audit_events WHERE event_kind = 'RUNTIME_PROVIDER_CONTRACT_REJECTED' AND recorded_at = ? AND details_json LIKE ?", terminalAt, `%${attemptId}%`) !== undefined;
    const terminal = contractRejected ? undefined : chronology.find((arrival) => arrival["recorded_at"] === terminalAt && (
      state === "UNKNOWN" ? arrival["response_id"] === null && arrival["outcome"] === "UNKNOWN" :
      state === "WINNER" ? arrival["response_id"] !== null && arrival["outcome"] === "WINNER" :
      arrival["response_id"] !== null && (arrival["outcome"] === "INVALID" || arrival["outcome"] === "STALE")
    ));
    if (!contractRejected && terminal === undefined) throw new Error("legacy Provider Delivery Attempt completion chronology is inconsistent");
    for (const arrival of chronology) if (arrival["response_id"] !== null && arrival !== terminal && instant(arrival["recorded_at"], "legacy Arrival receipt time") <= terminalAt) throw new Error("legacy Provider Delivery Arrival chronology contradicts its terminal receipt time");
  }
}
/** Reconstructs v6 delivery identities before startup graph validation. */
export function reconcileLegacyRuntimeDeliveries(database: DatabaseSync): void {
  reconcileLegacyRuntimeDeliveriesInternal(database, false);
}
function reconcileLegacyRuntimeDeliveriesInternal(database: DatabaseSync, validateOnly: boolean): void {
  const existing = one(database, "SELECT count(*) AS count FROM runtime_provider_deliveries")?.["count"];
  if (existing !== 0 && !validateOnly) return;
  const reconstruct = !validateOnly && existing === 0;
  const attempts = rows(database, "SELECT attempt_id, invocation_id, attempt_number, state, finished_at FROM runtime_attempts ORDER BY attempt_id");
  for (const attempt of attempts) {
    const attemptId = parseAttemptId(attempt["attempt_id"]); const invocationId = parseInvocationId(attempt["invocation_id"]); const state = attempt["state"];
    if (state !== "READY" && state !== "RUNNING" && state !== "RESULT_RECEIVED" && state !== "DISCARDED" && state !== "UNKNOWN" && state !== "WINNER") throw new Error("legacy Provider Delivery Attempt has an invalid state");
    const prepared = canonicalPrepared(database, invocationId);
    const chronology = rows(database, "SELECT arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, response_id, outcome, raw_response_json, raw_response_digest, recorded_at FROM runtime_result_arrivals WHERE attempt_id = ? ORDER BY arrival_number", attemptId);
    if (chronology.some((arrival, index) => !Number.isSafeInteger(arrival["arrival_number"]) || arrival["arrival_number"] !== index + 1 || (arrival["response_id"] === null && arrival["outcome"] !== "UNKNOWN"))) throw new Error("legacy Provider Delivery Arrival chronology is invalid");
    const arrivals = chronology.filter((arrival) => arrival["response_id"] !== null);
    const receiptStates = new Map<string, DeliveryReceiptState>();
    const transitions: { readonly at: string; readonly state: Exclude<DeliveryReceiptState, "RESULT_RECEIVED"> }[] = [];
    let disposition: Exclude<DeliveryReceiptState, "RESULT_RECEIVED"> | undefined;
    let terminalAt: string | undefined;
    const contractRejectionAt = validatedContractRejectionTime(database, prepared, attemptId);
    if (contractRejectionAt !== undefined) {
      if (state !== "DISCARDED" || attempt["finished_at"] !== contractRejectionAt) throw new Error("legacy Provider Delivery contract rejection does not bind its terminal Attempt");
      disposition = "DISCARDED"; terminalAt = contractRejectionAt; transitions.push({ at: contractRejectionAt, state: "DISCARDED" });
    }
    for (const arrival of chronology) {
      const recordedAt = instant(arrival["recorded_at"], "legacy Arrival receipt time");
      if (arrival["response_id"] === null) {
        if (disposition !== undefined || arrival["outcome"] !== "UNKNOWN") throw new Error("legacy Provider Delivery terminal chronology is ambiguous");
        validateUnknownRuntimeArrival(database, prepared, attemptId, arrival);
        disposition = "UNKNOWN"; terminalAt = recordedAt; transitions.push({ at: recordedAt, state: "UNKNOWN" });
        continue;
      }
      const arrivalId = parseArrivalId(arrival["arrival_id"]);
      if (terminalAt !== undefined && recordedAt <= terminalAt) throw new Error("legacy Provider Delivery Arrival chronology contradicts its terminal receipt time");
      receiptStates.set(arrivalId, disposition ?? "RESULT_RECEIVED");
      const outcome = arrival["outcome"];
      if (outcome === "WINNER") {
        if (disposition !== undefined) throw new Error("legacy Provider Delivery winner follows a terminal disposition");
        disposition = "WINNER"; terminalAt = recordedAt; transitions.push({ at: recordedAt, state: "WINNER" });
      } else if (outcome === "INVALID" || outcome === "STALE") {
        if (disposition === undefined) { disposition = "DISCARDED"; terminalAt = recordedAt; transitions.push({ at: recordedAt, state: "DISCARDED" }); }
      } else if (outcome === "LATE") {
        if (disposition !== "DISCARDED" && disposition !== "UNKNOWN") throw new Error("legacy Provider Delivery late Arrival lacks its terminal chronology");
      } else if (outcome === "DUPLICATE" || outcome === "DIVERGENT") {
        if (disposition !== "WINNER") throw new Error("legacy Provider Delivery duplicate or divergent Arrival lacks a prior winner");
      } else throw new Error("legacy Provider Delivery physical Arrival outcome is invalid");
    }
    const terminalState = state === "DISCARDED" || state === "UNKNOWN" || state === "WINNER" ? state : undefined;
    if (terminalState === undefined ? disposition !== undefined : disposition !== terminalState || terminalAt === undefined || attempt["finished_at"] !== terminalAt) throw new Error("legacy Provider Delivery Attempt completion chronology is inconsistent");
    if ((state === "READY" || state === "RUNNING") && arrivals.length !== 0) throw new Error("legacy Provider Delivery physical Arrival has no terminal Attempt state");
    if (!reconstruct) continue;
    const physical = rows(database, "SELECT response_id, invocation_id, attempt_id, envelope_digest, redacted_envelope_json, replayable_response_json, trusted_received_at, provider_received_at FROM runtime_physical_responses WHERE attempt_id = ? ORDER BY response_id", attemptId);
    const insert = (input: Readonly<{ responseId: ResponseId; deliveryNumber: number; trustedReceivedAt: string; attemptStateAtReceipt: DeliveryReceiptState; physical: Record<string, unknown> }>) => {
      const rawResponseDigest = hexDigest(input.physical["envelope_digest"], "legacy delivery wire digest"); const rawResponseJson = string(input.physical["redacted_envelope_json"], "legacy delivery capsule", 65_536); const replayableResponseJson = string(input.physical["replayable_response_json"], "legacy delivery replay", 65_536); const physicalTrustedReceivedAt = instant(input.physical["trusted_received_at"], "legacy physical receipt time");
      if (input.physical["invocation_id"] !== invocationId || input.physical["attempt_id"] !== attemptId || input.responseId !== deriveRuntimeResponseId({ invocationId, attemptId, envelopeDigest: rawResponseDigest })) throw new Error("legacy Provider Delivery physical Response is invalid");
      try {
        const capsule = validateCanonicalReceiptCapsule(rawResponseJson, rawResponseDigest);
        const providerReceivedAt = input.physical["provider_received_at"] === null ? null : instant(input.physical["provider_received_at"], "legacy physical provider receipt time");
        if (capsule.providerReceivedAt !== providerReceivedAt) throw new Error("legacy Provider Delivery physical Response capsule is invalid");
        if (capsule.invalid) validateInvalidProviderAuditEvidenceAgainstCapsule(replayableResponseJson, prepared.modelId, rawResponseJson);
        else if ((() => { const parsed = parseProviderWire(replayableResponseJson); return parsed.kind !== "WIRE" || parsed.wire !== replayableResponseJson || parsed.digest !== rawResponseDigest || rawResponse(parsed.parsed, rawResponseDigest) !== rawResponseJson; })()) throw new Error("legacy Provider Delivery physical Response capsule is invalid");
      } catch {
        let capsule: Record<string, unknown>;
        try { capsule = record(JSON.parse(rawResponseJson), "schema-3 recovered response capsule"); } catch { throw new Error("legacy Provider Delivery physical Response capsule is invalid"); }
        if (capsule["kind"] !== "provider-response-redacted" || capsule["envelopeDigest"] !== rawResponseDigest || replayableResponseJson !== "{}") throw new Error("legacy Provider Delivery physical Response capsule is invalid");
      }
      const bindingInput = { attemptId, attemptStateAtReceipt: input.attemptStateAtReceipt, deliveryNumber: input.deliveryNumber, invocationId, physicalTrustedReceivedAt, rawResponseDigest, rawResponseJson, replayableResponseJson, responseId: input.responseId, trustedReceivedAt: input.trustedReceivedAt };
      const receiptBinding = deliveryReceiptBinding(bindingInput); const deliveryId = deriveRuntimeProviderDeliveryId({ attemptId, receiptBinding });
      database.prepare(`INSERT INTO runtime_provider_deliveries (delivery_id, schema_version, invocation_id, attempt_id, response_id, delivery_number, wire_digest, redacted_envelope_json, replayable_response_json, trusted_received_at, physical_trusted_received_at, attempt_state_at_receipt, receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding) VALUES (?, 'accord.runtime-provider-delivery/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deliveryId, invocationId, attemptId, input.responseId, input.deliveryNumber, rawResponseDigest, rawResponseJson, replayableResponseJson, input.trustedReceivedAt, physicalTrustedReceivedAt, input.attemptStateAtReceipt, receiptBinding, input.attemptStateAtReceipt, "0000000000000000000000000000000000000000000000000000000000000000");
      database.prepare(`INSERT INTO runtime_provider_delivery_legacy_provenance (delivery_id, migration_id, delivery_schema_version, invocation_id, attempt_id, attempt_number, response_id, delivery_number, wire_digest, redacted_envelope_json, replayable_response_json, trusted_received_at, physical_trusted_received_at, attempt_state_at_receipt, receipt_binding, original_attempt_state_at_receipt, original_receipt_state_binding)
        VALUES (?, '008_r003_opaque_completion_receipts', 'accord.runtime-provider-delivery/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '0000000000000000000000000000000000000000000000000000000000000000')`)
        .run(deliveryId, invocationId, attemptId, attempt["attempt_number"] as number, input.responseId, input.deliveryNumber, rawResponseDigest, rawResponseJson, replayableResponseJson, input.trustedReceivedAt, physicalTrustedReceivedAt, input.attemptStateAtReceipt, receiptBinding, input.attemptStateAtReceipt);
      return deliveryId;
    };
    const deliveryEvents: { readonly arrival?: Record<string, unknown>; readonly physical: Record<string, unknown>; readonly receiptState: DeliveryReceiptState; readonly responseId: ResponseId; readonly trustedReceivedAt: string }[] = [];
    for (const arrival of arrivals) {
      const responseId = parseResponseId(arrival["response_id"]); const physicalResponse = physical.find((response) => response["response_id"] === responseId); const arrivalId = parseArrivalId(arrival["arrival_id"]);
      if (physicalResponse === undefined || !Number.isSafeInteger(arrival["arrival_number"])) throw new Error("legacy Provider Delivery Arrival is invalid");
      deliveryEvents.push({ arrival, physical: physicalResponse, receiptState: receiptStates.get(arrivalId)!, responseId, trustedReceivedAt: instant(arrival["recorded_at"], "legacy Arrival receipt time") });
    }
    for (const response of physical.filter((candidate) => !arrivals.some((arrival) => arrival["response_id"] === candidate["response_id"]))) {
      if (state !== "RESULT_RECEIVED" && terminalState === undefined) throw new Error("legacy physical Response is not recoverable");
      const trustedReceivedAt = instant(response["trusted_received_at"], "legacy orphan receipt time");
      const sameTime = transitions.some((transition) => transition.at === trustedReceivedAt);
      if (sameTime) throw new Error("legacy physical Response has ambiguous terminal ordering");
      const prior = transitions.filter((transition) => transition.at < trustedReceivedAt).at(-1);
      deliveryEvents.push({ physical: response, receiptState: prior?.state ?? "RESULT_RECEIVED", responseId: parseResponseId(response["response_id"]), trustedReceivedAt });
    }
    deliveryEvents.sort((left, right) => left.trustedReceivedAt.localeCompare(right.trustedReceivedAt) || ((left.arrival?.["arrival_number"] as number | undefined) ?? Number.MAX_SAFE_INTEGER) - ((right.arrival?.["arrival_number"] as number | undefined) ?? Number.MAX_SAFE_INTEGER));
    for (let index = 1; index < deliveryEvents.length; index += 1) {
      const previous = deliveryEvents[index - 1]!; const current = deliveryEvents[index]!;
      if (previous.trustedReceivedAt === current.trustedReceivedAt && (previous.arrival === undefined || current.arrival === undefined)) throw new Error("legacy Provider Delivery order is ambiguous");
    }
    for (const [index, event] of deliveryEvents.entries()) {
      const deliveryId = insert({ attemptStateAtReceipt: event.receiptState, deliveryNumber: index + 1, physical: event.physical, responseId: event.responseId, trustedReceivedAt: event.trustedReceivedAt });
      if (event.arrival !== undefined) database.prepare("INSERT INTO runtime_delivery_arrivals (delivery_id, arrival_id) VALUES (?, ?)").run(deliveryId, parseArrivalId(event.arrival["arrival_id"]));
    }
  }
}

function finalizeInvalidProviderReceipt(database: DatabaseSync, prepared: PreparedProfileInvocation, attempt: PreparedAttempt, receipt: PersistedProviderDelivery): ResultArbitration {
  return transaction(database, () => {
    const persistedAttempt = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ?", attempt.attemptId);
    if (persistedAttempt === undefined) throw new Error("provider result Attempt disappeared after receipt");
    const auditEvidence = validateInvalidProviderAuditEvidenceAgainstCapsule(receipt.replayableResponseJson, prepared.modelId, receipt.rawResponseJson);
    const resultId = deriveRuntimeResultId({ invocationId: prepared.invocationId, attemptId: attempt.attemptId, outputDigest: receipt.rawResponseDigest });
    const persistedOutput = JSON.parse(receipt.rawResponseJson) as unknown;
    try {
      database.prepare(`INSERT INTO runtime_results (result_id, schema_version, invocation_id, attempt_id, provider_metadata_json, output_json, output_digest, usage_json, first_received_at) VALUES (?, 'accord.runtime-result/v1', ?, ?, ?, ?, ?, ?, ?)`)
        .run(resultId, prepared.invocationId, attempt.attemptId, json(auditEvidence.providerMetadata ?? {}), json(persistedOutput), receipt.rawResponseDigest, json(auditEvidence.usage ?? {}), receipt.trustedReceivedAt);
    } catch (error) {
      const existing = one(database, "SELECT provider_metadata_json, output_json, output_digest, usage_json FROM runtime_results WHERE result_id = ?", resultId);
      if (existing === undefined || existing["output_digest"] !== receipt.rawResponseDigest || existing["output_json"] !== json(persistedOutput) || existing["provider_metadata_json"] !== json(auditEvidence.providerMetadata ?? {}) || existing["usage_json"] !== json(auditEvidence.usage ?? {})) throw error;
    }
    const number = one(database, "SELECT count(*) + 1 AS arrival_number FROM runtime_result_arrivals WHERE attempt_id = ?", attempt.attemptId)?.["arrival_number"];
    if (!Number.isSafeInteger(number)) throw new Error("invalid capsule arrival sequence is invalid");
    const arrivalNumber = number as number;
    const arrivalId = deriveRuntimeArrivalId({ invocationId: prepared.invocationId, attemptId: attempt.attemptId, arrivalNumber });
    database.prepare(`INSERT INTO runtime_result_arrivals (arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, outcome, raw_response_json, raw_response_digest, recorded_at, response_id) VALUES (?, 'accord.runtime-result-arrival/v1', ?, ?, ?, ?, 'INVALID', ?, ?, ?, ?)`)
      .run(arrivalId, prepared.invocationId, attempt.attemptId, resultId, arrivalNumber, receipt.rawResponseJson, receipt.rawResponseDigest, receipt.trustedReceivedAt, receipt.responseId);
    linkDeliveryArrival(database, receipt, arrivalId);
    database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId]), deriveRuntimeAuditCorrelationId(prepared.invocationId), `RUNTIME_RESULT:INVALID:${attempt.attemptId}:${arrivalNumber}`, prepared.caseId, prepared.boardId, prepared.workflowRunId, runtimeResultArrivalAuditDetails({ arrivalId, attemptId: attempt.attemptId, outcome: "INVALID", prepared, rawResponseDigest: receipt.rawResponseDigest, replayableResponseJson: receipt.replayableResponseJson }), receipt.trustedReceivedAt);
    if (persistedAttempt["state"] === "RUNNING" || persistedAttempt["state"] === "RESULT_RECEIVED") {
      database.prepare("UPDATE runtime_attempts SET state = 'DISCARDED', finished_at = ? WHERE attempt_id = ? AND state = 'RESULT_RECEIVED'").run(receipt.trustedReceivedAt, attempt.attemptId);
      database.prepare("UPDATE runtime_invocations SET status = 'UNKNOWN' WHERE invocation_id = ? AND status = 'RUNNING'").run(prepared.invocationId);
      failInvocationIfExhausted(database, prepared, receipt.trustedReceivedAt);
    }
    return { arrivalId, attemptId: attempt.attemptId, boardRevision: undefined, invocationId: prepared.invocationId, outcome: "INVALID", proposalBoardRevision: undefined, responseId: receipt.responseId, resultId };
  });
}

export function commitProviderResult(database: DatabaseSync, supplied: PreparedProfileInvocation, suppliedAttempt: PreparedAttempt, value: ProviderWire, recoveredTrustedReceivedAt?: string, outputContract?: InvocationBoundOutputContract): ProviderResultArbitration {
  const prepared = canonicalPrepared(database, supplied.invocationId);
  assertSuppliedIdentity(supplied, prepared);
  const generic = prepared.profile === "REVIEWER" || prepared.profile === "WRITER"; if (generic) assertInvocationBoundOutputContract(prepared, outputContract);
  const attemptId = parseAttemptId(suppliedAttempt.attemptId);
  if (suppliedAttempt.invocationId !== prepared.invocationId || suppliedAttempt.noSdkRetry !== true) throw new Error("provider result Attempt identity is invalid");
  const attempt = one(database, "SELECT invocation_id, attempt_number, state FROM runtime_attempts WHERE attempt_id = ?", attemptId);
  if (attempt === undefined || attempt["invocation_id"] !== prepared.invocationId || attempt["attempt_number"] !== suppliedAttempt.attemptNumber) throw new Error("provider result Attempt is not bound to its Invocation");
  const trustedReceivedAt = recoveredTrustedReceivedAt === undefined ? new Date().toISOString() : instant(recoveredTrustedReceivedAt, "persisted trusted receipt time");
  const admitted = admitProviderWire(value);
  if (admitted.kind === "REJECTED") {
    /* An identity-free rejection is never allowed to supersede durable
     * authority.  Consume every prior opaque wire and Delivery first. */
    transaction(database, () => {
      recoverOpaqueCompletionReceipts(database);
      recoverReceivedRuntimeAttempts(database);
    });
    return recordContractRejection(database, prepared, suppliedAttempt, admitted.reason, trustedReceivedAt);
  }
  /* Generic validation is pure and its bounded resolution is committed with
   * the first durable receipt so recovery never needs a mutable callback. */
  const genericResolution = generic ? resolveGenericOutput(prepared, admitted.wire, outputContract!) : undefined;
  const opaqueReceipt = persistOpaqueCompletionReceipt(database, { attemptId, invocationId: prepared.invocationId, trustedReceivedAt, wire: admitted.wire, ...(genericResolution === undefined ? {} : { generic: { prepared, resolution: genericResolution } }) });
  /* Validate the whole pending authority set, then advance only authorities
   * that precede this receipt.  The current receipt remains durable if that
   * ordered recovery fails, and its eventual arbitration stays its own. */
  transaction(database, () => {
    recoverOpaqueCompletionReceipts(database, opaqueReceipt);
    recoverReceivedRuntimeAttempts(database);
  });
  return commitProviderResultInternal(database, prepared, suppliedAttempt, opaqueReceipt.wire, opaqueReceipt.trustedReceivedAt, true, undefined, opaqueReceipt);
}
function commitProviderResultInternal(database: DatabaseSync, supplied: PreparedProfileInvocation, suppliedAttempt: PreparedAttempt, value: ProviderWire, recoveredTrustedReceivedAt: string | undefined, consumingPersistedReceipt: boolean, persistedDelivery?: PersistedProviderDelivery, opaqueReceipt?: PersistedOpaqueCompletionReceipt): ProviderResultArbitration {
  const prepared = canonicalPrepared(database, supplied.invocationId); assertSuppliedIdentity(supplied, prepared);
  const attemptId = parseAttemptId(suppliedAttempt.attemptId);
  if (suppliedAttempt.invocationId !== prepared.invocationId || suppliedAttempt.noSdkRetry !== true) throw new Error("provider result Attempt identity is invalid");
  const initialAttempt = one(database, "SELECT * FROM runtime_attempts WHERE attempt_id = ?", attemptId);
  if (initialAttempt === undefined || initialAttempt["invocation_id"] !== prepared.invocationId || initialAttempt["attempt_number"] !== suppliedAttempt.attemptNumber) throw new Error("provider result Attempt is not bound to its Invocation");
  if (initialAttempt["state"] === "RESULT_RECEIVED" && !consumingPersistedReceipt) {
    const delivery = pendingDeliveryForAttempt(database, prepared.invocationId, attemptId, prepared.modelId);
    const incoming = parseProviderWire(value); const capsule = validateCanonicalReceiptCapsule(delivery.rawResponseJson, delivery.rawResponseDigest);
    if (incoming.kind !== "WIRE" || incoming.digest !== delivery.rawResponseDigest || (!capsule.invalid && incoming.wire !== delivery.replayableResponseJson)) throw new Error("RESULT_RECEIVED Attempt completion conflicts with its immutable receipt");
    const immutableAttempt = Object.freeze({ attemptId, attemptNumber: suppliedAttempt.attemptNumber, invocationId: prepared.invocationId, noSdkRetry: true });
    if (capsule.invalid) return finalizeInvalidProviderReceipt(database, prepared, immutableAttempt, delivery);
    return commitProviderResultInternal(database, prepared, immutableAttempt, delivery.replayableResponseJson, delivery.trustedReceivedAt, true, delivery);
  }
  const trustedReceivedAt = persistedDelivery?.trustedReceivedAt ?? (recoveredTrustedReceivedAt === undefined ? new Date().toISOString() : instant(recoveredTrustedReceivedAt, "persisted trusted receipt time"));
  const parsedWire = parseProviderWire(value);
  if (parsedWire.kind === "REJECTED") return recordContractRejection(database, prepared, Object.freeze({ attemptId, attemptNumber: suppliedAttempt.attemptNumber, invocationId: prepared.invocationId, noSdkRetry: true }), parsedWire.reason, trustedReceivedAt);
  const rawResponseDigest = parsedWire.digest; const responseId = parseResponseId(deriveRuntimeResponseId({ invocationId: prepared.invocationId, attemptId, envelopeDigest: rawResponseDigest }));
  const response = parsedWire.parsed !== null && typeof parsedWire.parsed === "object" && !Array.isArray(parsedWire.parsed) ? parsedWire.parsed as Record<string, unknown> : undefined;
  let exactEnvelope = false;
  if (response !== undefined) try { exact(response, ["output", "providerMetadata", "receivedAt", "usage"], "provider result"); exactEnvelope = true; } catch { /* invalid output retains bounded audit evidence */ }
  const generic = prepared.profile === "REVIEWER" || prepared.profile === "WRITER";
  const resolutionReceipt = opaqueReceipt ?? persistedDelivery;
  if (generic && resolutionReceipt === undefined) throw new Error("generic provider result lacks its durable output resolution");
  const genericResolution = generic ? validatedGenericOutputResolution(database, prepared, attemptId, resolutionReceipt!.deliveryNumber, rawResponseDigest, trustedReceivedAt) : undefined;
  const auditEvidence = providerAuditEvidence(response, prepared.modelId);
  let validated: ValidatedProfileOutput | undefined; let outputDigest: string | undefined; let invalidReason: string | undefined;
  try {
    if (response === undefined || !exactEnvelope || auditEvidence.providerMetadata === undefined || auditEvidence.providerReceivedAt === undefined || auditEvidence.usage === undefined) throw new TypeError("provider envelope is invalid");
    if (generic) { if (genericResolution?.accepted !== true) throw new TypeError("generic output contract rejected the result"); validated = genericResolution.candidate; }
    else validated = validation(prepared, response["output"]);
    outputDigest = digest(response["output"]);
  } catch { invalidReason = "INVALID_PROVIDER_RESULT"; }
  const persistedOutputDigest = outputDigest ?? rawResponseDigest;
  const resultId = deriveRuntimeResultId({ invocationId: prepared.invocationId, attemptId, outputDigest: persistedOutputDigest });
  const materialization = invalidReason === undefined && generic ? deriveDurableGenericMaterialization(prepared, attemptId, resultId, validated as GenericMaterializationCandidate) : undefined;
  const rawResponseJson = invalidReason === undefined ? rawResponse(parsedWire.parsed, rawResponseDigest) : rawResponse(parsedWire.parsed, rawResponseDigest, [invalidReason]);
  const replayableResponseJson = invalidReason === undefined ? parsedWire.wire : invalidProviderAuditReplay(auditEvidence);
  const persistedOutput = validated === undefined ? JSON.parse(rawResponseJson) : response?.["output"];
  const persistedMetadata = auditEvidence.providerMetadata ?? {}; const persistedUsage = auditEvidence.usage ?? {};
  const delivery = persistedDelivery ?? persistProviderReceipt(database, { attemptId, invocationId: prepared.invocationId, ...(opaqueReceipt === undefined ? {} : { opaqueReceipt }), parsed: parsedWire.parsed, rawResponseDigest, rawResponseJson, replayableResponseJson, responseId, trustedReceivedAt });
  if (persistedDelivery !== undefined) assertConsumedDelivery(delivery, { rawResponseDigest, rawResponseJson, replayableResponseJson, responseId, trustedReceivedAt });
  if (invalidReason !== undefined) return finalizeInvalidProviderReceipt(database, prepared, Object.freeze({ attemptId, attemptNumber: suppliedAttempt.attemptNumber, invocationId: prepared.invocationId, noSdkRetry: true }), delivery);
  return transaction(database, () => {
    const persistedAttempt = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ?", attemptId);
    if (persistedAttempt === undefined) throw new Error("provider result Attempt disappeared after receipt");
    try { database.prepare(`INSERT INTO runtime_results (result_id, schema_version, invocation_id, attempt_id, provider_metadata_json, output_json, output_digest, usage_json, first_received_at) VALUES (?, 'accord.runtime-result/v1', ?, ?, ?, ?, ?, ?, ?)`)
      .run(resultId, prepared.invocationId, attemptId, json(persistedMetadata), json(persistedOutput), persistedOutputDigest, json(persistedUsage), trustedReceivedAt); }
    catch (error) { const existing = one(database, "SELECT result_id, output_json, output_digest FROM runtime_results WHERE result_id = ?", resultId); if (existing === undefined || existing["output_digest"] !== persistedOutputDigest || existing["output_json"] !== json(persistedOutput)) throw error; }
    let outcome: ResultArbitration["outcome"] = "UNKNOWN";
    const winner = one(database, "SELECT output_digest FROM runtime_results r JOIN runtime_result_arrivals a ON a.result_id = r.result_id WHERE r.invocation_id = ? AND a.outcome = 'WINNER'", prepared.invocationId);
    if (winner !== undefined) outcome = winner["output_digest"] === outputDigest ? "DUPLICATE" : "DIVERGENT";
    const priorArrivals = one(database, "SELECT count(*) AS count FROM runtime_result_arrivals WHERE attempt_id = ?", attemptId)?.["count"];
    const classifiable = persistedAttempt["state"] === "RUNNING" || (persistedAttempt["state"] === "RESULT_RECEIVED" && priorArrivals === 0);
    if (winner === undefined && !classifiable) outcome = "LATE";
    if (winner === undefined && classifiable) { const fresh = one(database, "SELECT 1 AS present FROM runtime_invocations i JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id JOIN boards b ON b.board_id = i.board_id JOIN cases c ON c.case_id = i.case_id WHERE i.invocation_id = ? AND i.status = 'RUNNING' AND i.workflow_revision = ? AND i.board_revision = ? AND i.context_digest = ? AND w.state = ? AND w.revision = ? AND b.revision = ? AND c.status = 'OPEN'", prepared.invocationId, prepared.workflowRevision, prepared.boardRevision, prepared.contextDigest, prepared.profile, prepared.workflowRevision, prepared.boardRevision) !== undefined; outcome = fresh ? "WINNER" : "STALE"; }
    const arrivalNumberValue = one(database, "SELECT count(*) + 1 AS arrival_number FROM runtime_result_arrivals WHERE attempt_id = ?", attemptId)?.["arrival_number"];
    if (!Number.isSafeInteger(arrivalNumberValue)) throw new Error("arrival audit sequence is invalid");
    const arrivalNumber = arrivalNumberValue as number; const arrivalId = deriveRuntimeArrivalId({ invocationId: prepared.invocationId, attemptId, arrivalNumber });
    database.prepare(`INSERT INTO runtime_result_arrivals (arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, outcome, raw_response_json, raw_response_digest, recorded_at, response_id) VALUES (?, 'accord.runtime-result-arrival/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(arrivalId, prepared.invocationId, attemptId, resultId, arrivalNumber, outcome, rawResponseJson, rawResponseDigest, trustedReceivedAt, responseId);
    linkDeliveryArrival(database, delivery, arrivalId);
    const winnerMaterialization = outcome === "WINNER" ? materialization : undefined;
    database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId]), deriveRuntimeAuditCorrelationId(prepared.invocationId), `RUNTIME_RESULT:${outcome}:${attemptId}:${arrivalNumber}`, prepared.caseId, prepared.boardId, prepared.workflowRunId, runtimeResultArrivalAuditDetails({ arrivalId, attemptId, outcome, prepared, rawResponseDigest, replayableResponseJson, resultId, ...(winnerMaterialization === undefined ? {} : { materialization: winnerMaterialization }) }), trustedReceivedAt);
    if (outcome !== "WINNER") {
      if (persistedAttempt["state"] === "RUNNING" || persistedAttempt["state"] === "RESULT_RECEIVED") { database.prepare("UPDATE runtime_attempts SET state = 'DISCARDED', finished_at = ? WHERE attempt_id = ? AND state = 'RESULT_RECEIVED'").run(trustedReceivedAt, attemptId); database.prepare("UPDATE runtime_invocations SET status = 'UNKNOWN' WHERE invocation_id = ? AND status = 'RUNNING'").run(prepared.invocationId); failInvocationIfExhausted(database, prepared, trustedReceivedAt); }
      return { arrivalId, attemptId, boardRevision: undefined, invocationId: prepared.invocationId, outcome, proposalBoardRevision: undefined, responseId, resultId };
    }
    const nextRevision = prepared.boardRevision + 1;
    const entries: { type: EntryType; payload: Readonly<Record<string, unknown>>; sourceRefs: readonly string[]; basedOn: readonly string[]; entryId?: BoardEntryId; contentDigest?: string }[] = [];
    if (prepared.profile === "RESEARCHER") { const result = validated as ResearcherOutput; const evidenceEntryIds = new Map(result.evidenceRefs.map((item, index) => [item.sourceId, deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "EvidenceRef", index: result.intents.length + index })])); entries.push(...result.intents.map((item) => ({ type: "Intent" as const, payload: { objective: item.objective, scope: item.scope }, sourceRefs: [], basedOn: item.basedOn })), ...result.evidenceRefs.map((item) => ({ type: "EvidenceRef" as const, payload: { ...item }, sourceRefs: [item.sourceId], basedOn: [] })), ...result.observations.map((item) => ({ type: "Observation" as const, payload: { statement: item.statement }, sourceRefs: item.sourceRefs.map((sourceId) => evidenceEntryIds.get(sourceId) as string), basedOn: item.basedOn })));
    } else if (prepared.profile === "ANALYST") { const result = validated as AnalystOutput; const claimIds = result.claims.map((_, index) => deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "Claim", index })); entries.push(...result.claims.map((item) => ({ type: "Claim" as const, payload: { statement: item.statement, unsupported: item.unsupported }, sourceRefs: [], basedOn: item.supportingEntryIds })), ...result.proposals.map((item) => ({ type: "Proposal" as const, payload: { action: item.action, supportStatus: item.supportStatus }, sourceRefs: [], basedOn: item.supportingClaimIndexes.map((index) => claimIds[index] as string) })));
    } else {
      if (winnerMaterialization === undefined) throw new Error("generic winner lacks its durable materialization");
      entries.push(...winnerMaterialization.boardEntries.map((entry) => ({ type: entry.entryType, payload: entry.payload, sourceRefs: entry.sourceRefs, basedOn: entry.basedOn, entryId: entry.entryId, contentDigest: entry.contentDigest })));
    }
    const insertedEntryIds: BoardEntryId[] = [];
    for (const [index, entry] of entries.entries()) {
      const entryId = entry.entryId ?? (prepared.profile === "ANALYST" && entry.type === "Claim" ? deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: "Claim", index: entries.slice(0, index + 1).filter((item) => item.type === "Claim").length - 1 }) : deriveRuntimeBoardEntryId({ invocationId: prepared.invocationId, entryType: entry.type, index }));
      const immutable = { authorId: prepared.profile, authorType: "AGENT", basedOn: entry.basedOn, contradicts: [], entryType: entry.type, instructionAuthority: "NONE", payload: entry.payload, sourceRefs: entry.sourceRefs, status: "CANDIDATE", supersedes: [], trustLevel: "CANDIDATE", visibility: "CASE" }; const contentDigest = digest(immutable);
      if (entry.contentDigest !== undefined && entry.contentDigest !== contentDigest) throw new Error("generic Board candidate digest drifted before commit");
      database.prepare(`INSERT INTO board_entries (board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type, author_id, payload_json, source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level, instruction_authority, created_revision, content_digest, created_at) VALUES (?, 'accord.board-entry/v1', ?, ?, ?, 'CANDIDATE', 'AGENT', ?, ?, ?, ?, '[]', '[]', 'CASE', 'CANDIDATE', 'NONE', ?, ?, ?)`)
        .run(entryId, prepared.boardId, prepared.caseId, entry.type, prepared.profile, json(entry.payload), json(entry.sourceRefs), json(entry.basedOn), nextRevision, contentDigest, trustedReceivedAt);
      insertedEntryIds.push(entryId);
    }
    for (const entryId of insertedEntryIds) database.prepare("INSERT INTO runtime_result_entries (result_id, board_entry_id) VALUES (?, ?)").run(resultId, entryId);
    const nextState = prepared.profile === "RESEARCHER" ? "ANALYST" : prepared.profile === "ANALYST" ? "REVIEWER" : prepared.profile === "REVIEWER" ? "WRITER" : "WAIT_FOR_APPROVAL";
    if (database.prepare("UPDATE boards SET revision = ? WHERE board_id = ? AND revision = ?").run(nextRevision, prepared.boardId, prepared.boardRevision).changes !== 1 || database.prepare("UPDATE workflow_runs SET state = ?, revision = revision + 1 WHERE workflow_run_id = ? AND state = ? AND revision = ?").run(nextState, prepared.workflowRunId, prepared.profile, prepared.workflowRevision).changes !== 1) throw new Error("winner lost its freshness compare-and-set");
    database.prepare("UPDATE runtime_attempts SET state = 'WINNER', finished_at = ? WHERE attempt_id = ? AND state = 'RESULT_RECEIVED'").run(trustedReceivedAt, attemptId); database.prepare("UPDATE runtime_invocations SET status = 'RESULT_COMMITTED' WHERE invocation_id = ? AND status = 'RUNNING'").run(prepared.invocationId);
    return { arrivalId, attemptId, boardRevision: nextRevision, invocationId: prepared.invocationId, outcome: "WINNER", proposalBoardRevision: prepared.profile === "ANALYST" ? nextRevision : undefined, responseId, resultId, ...(winnerMaterialization === undefined ? {} : { materialization: winnerMaterialization }) };
  });
}

export function recordUnknownRuntimeArrival(database: DatabaseSync, input: { readonly invocationId: InvocationId; readonly attemptId: AttemptId; readonly caseId: CaseId; readonly boardId: BoardId; readonly workflowRunId: WorkflowRunId; readonly recordedAt: string; readonly eventKind: string; readonly details: Readonly<Record<string, unknown>> }): void {
  const invocationId = parseInvocationId(input.invocationId); const attemptId = parseAttemptId(input.attemptId); const recordedAt = instant(input.recordedAt, "recordedAt");
  const sequence = one(database, "SELECT count(*) + 1 AS arrival_number FROM runtime_result_arrivals WHERE attempt_id = ?", attemptId)?.["arrival_number"];
  if (!Number.isSafeInteger(sequence)) throw new Error("unknown arrival audit sequence is invalid"); const arrivalNumber = sequence as number;
  const arrivalId = deriveRuntimeArrivalId({ invocationId, attemptId, arrivalNumber });
  const raw = json({ kind: "provider-response-unknown", retry: "DISABLED" }); const rawDigest = wireDigest(raw);
  database.prepare(`INSERT INTO runtime_result_arrivals (arrival_id, schema_version, invocation_id, attempt_id, result_id, arrival_number, outcome, raw_response_json, raw_response_digest, recorded_at) VALUES (?, 'accord.runtime-result-arrival/v1', ?, ?, NULL, ?, 'UNKNOWN', ?, ?, ?)`).run(arrivalId, invocationId, attemptId, arrivalNumber, raw, rawDigest, recordedAt);
  database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at) VALUES (?, 'accord.audit-event/v1', ?, ?, ?, ?, ?, NULL, ?, ?)`).run(deriveRuntimeAuditEventId("runtime-unknown-arrival", [arrivalId]), deriveRuntimeAuditCorrelationId(invocationId), input.eventKind, input.caseId, input.boardId, input.workflowRunId, json({ ...input.details, arrivalId, attemptId, invocationId, outcome: "UNKNOWN", retry: "DISABLED" }), recordedAt);
}
function hexDigest(value: unknown, label: string): string { const checked = string(value, label, 64); if (!/^[0-9a-f]{64}$/u.test(checked)) throw new TypeError(`${label} must be a SHA-256 digest`); return checked; }
function validatedSafeIdentifier(value: unknown): void {
  const item = record(value, "persisted capsule identifier");
  if (item["valid"] === false) {
    if (Object.hasOwn(item, "present")) {
      exact(item, ["present", "valid"], "persisted capsule identifier");
      if (typeof item["present"] !== "boolean") throw new TypeError("persisted capsule identifier presence is invalid");
      return;
    }
    exact(item, ["bytes", "digest", "valid"], "persisted capsule identifier");
    if (!Number.isSafeInteger(item["bytes"]) || (item["bytes"] as number) < 0 || (item["bytes"] as number) > MAX_PROVIDER_WIRE_UTF8_BYTES) throw new TypeError("persisted capsule invalid identifier bounds are invalid");
    hexDigest(item["digest"], "persisted capsule invalid identifier digest");
    return;
  }
  exact(item, ["bytes", "digest", "valid"], "persisted capsule identifier");
  if (item["valid"] !== true || !Number.isSafeInteger(item["bytes"]) || (item["bytes"] as number) < 0 || (item["bytes"] as number) > 16_384) throw new TypeError("persisted capsule identifier bounds are invalid");
  hexDigest(item["digest"], "persisted capsule identifier digest");
}
function validateCanonicalReceiptCapsule(value: unknown, expectedWireDigest: string): Readonly<{ invalid: boolean; providerReceivedAt: string | null; redactedEnvelopeJson: string }> {
  const redactedEnvelopeJson = string(value, "persisted redacted capsule", 65_536);
  let capsule: Record<string, unknown>;
  try { capsule = record(JSON.parse(redactedEnvelopeJson) as unknown, "persisted redacted capsule"); } catch { throw new Error("RESULT_RECEIVED Attempt has an invalid recovery capsule"); }
  try {
    exact(capsule, ["capsuleDigest", "envelope", "envelopeDigest", "kind", "validationErrors"], "persisted redacted capsule");
    if (capsule["kind"] !== "provider-response-redacted" || capsule["envelopeDigest"] !== expectedWireDigest || hexDigest(capsule["envelopeDigest"], "persisted capsule wire digest") !== expectedWireDigest) throw new TypeError("persisted capsule wire binding is invalid");
    const errors = capsule["validationErrors"]; if (!Array.isArray(errors) || (errors.length !== 0 && (errors.length !== 1 || errors[0] !== "INVALID_PROVIDER_RESULT"))) throw new TypeError("persisted capsule validation code is invalid");
    const envelope = record(capsule["envelope"], "persisted capsule envelope"); exact(envelope, ["kind", "metadata", "outputEvidenceDigest", "providerReceivedAt", "providerTimestampEvidence", "usage", "wireDigest"], "persisted capsule envelope");
    if (envelope["kind"] !== "provider-response-redacted/v3" || hexDigest(envelope["wireDigest"], "persisted capsule envelope wire digest") !== expectedWireDigest) throw new TypeError("persisted capsule envelope wire binding is invalid");
    const metadata = record(envelope["metadata"], "persisted capsule metadata"); exact(metadata, providerMetadataFields, "persisted capsule metadata"); for (const field of providerMetadataFields) validatedSafeIdentifier(metadata[field]);
    if (envelope["outputEvidenceDigest"] !== null) hexDigest(envelope["outputEvidenceDigest"], "persisted capsule output evidence digest");
    const providerReceivedAt = envelope["providerReceivedAt"]; if (providerReceivedAt !== null) instant(providerReceivedAt, "persisted capsule provider receipt time");
    validatedSafeIdentifier(envelope["providerTimestampEvidence"]);
    const usage = record(envelope["usage"], "persisted capsule usage"); exact(usage, ["inputTokens", "outputTokens", "totalTokens"], "persisted capsule usage"); for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) if (usage[key] !== null && (!Number.isSafeInteger(usage[key]) || (usage[key] as number) < 0)) throw new TypeError("persisted capsule usage is invalid");
    const contents = { envelope: capsule["envelope"], envelopeDigest: capsule["envelopeDigest"], kind: capsule["kind"], validationErrors: capsule["validationErrors"] };
    if (capsule["capsuleDigest"] !== digest(contents) || redactedEnvelopeJson !== json(capsule)) throw new TypeError("persisted capsule integrity binding is invalid");
    return Object.freeze({ invalid: errors.length === 1, providerReceivedAt: providerReceivedAt as string | null, redactedEnvelopeJson });
  } catch { throw new Error("RESULT_RECEIVED Attempt has an invalid recovery capsule"); }
}
function validateInvalidProviderAuditEvidenceAgainstCapsule(replayableResponseJson: string, modelId: string, rawResponseJson: string): ProviderAuditEvidence {
  const evidence = parseInvalidProviderAuditReplay(replayableResponseJson, modelId);
  if (replayableResponseJson === "{}") return evidence;
  const capsule = record(JSON.parse(rawResponseJson) as unknown, "invalid provider audit capsule");
  const envelope = record(capsule["envelope"], "invalid provider audit envelope");
  const metadata = record(envelope["metadata"], "invalid provider audit metadata evidence");
  const semanticMetadataPossible = providerMetadataFields.every((field) => record(metadata[field], `invalid provider audit metadata ${field}`)["valid"] === true)
    && json(metadata["modelId"]) === json(safeIdentifier(modelId))
    && json(metadata["providerPortVersion"]) === json(safeIdentifier(NATIVE_BAIZHI_PROVIDER_PORT_VERSION));
  if (semanticMetadataPossible !== (evidence.providerMetadata !== undefined)) throw new TypeError("invalid provider audit metadata disposition is inconsistent");
  if (evidence.providerMetadata !== undefined) for (const field of providerMetadataFields) if (json(metadata[field]) !== json(safeIdentifier(evidence.providerMetadata[field]))) throw new TypeError("invalid provider audit metadata binding is inconsistent");
  const usage = record(envelope["usage"], "invalid provider audit usage evidence");
  const semanticUsagePossible = Number.isSafeInteger(usage["inputTokens"]) && Number.isSafeInteger(usage["outputTokens"]) && Number.isSafeInteger(usage["totalTokens"])
    && Number(usage["inputTokens"]) >= 0 && Number(usage["outputTokens"]) >= 0 && Number(usage["totalTokens"]) >= 0
    && Number(usage["inputTokens"]) + Number(usage["outputTokens"]) === Number(usage["totalTokens"]);
  if (semanticUsagePossible !== (evidence.usage !== undefined) || (evidence.usage !== undefined && json(usage) !== json(evidence.usage))) throw new TypeError("invalid provider audit usage binding is inconsistent");
  const providerReceivedAt = envelope["providerReceivedAt"];
  if ((providerReceivedAt !== null) !== (evidence.providerReceivedAt !== undefined) || (evidence.providerReceivedAt !== undefined && providerReceivedAt !== evidence.providerReceivedAt)) throw new TypeError("invalid provider audit timestamp binding is inconsistent");
  return evidence;
}
/** Startup consumes opaque wires before interrupted-Attempt reconciliation. */
function hasPriorLinkedDelivery(database: DatabaseSync, attemptId: AttemptId, deliveryNumber: number): boolean {
  return one(database, `SELECT 1 AS present
    FROM runtime_provider_deliveries AS delivery
    JOIN runtime_delivery_arrivals AS linked ON linked.delivery_id = delivery.delivery_id
    WHERE delivery.attempt_id = ? AND delivery.delivery_number < ?`, attemptId, deliveryNumber) !== undefined;
}

export function recoverOpaqueCompletionReceipts(database: DatabaseSync, leaveCurrentDurable?: PersistedOpaqueCompletionReceipt): void {
  const pending = rows(database, `SELECT opaque_receipt_id, schema_version, invocation_id, attempt_id, delivery_number, wire_utf8, wire_digest, trusted_received_at, attempt_state_at_receipt, receipt_binding
    FROM runtime_opaque_completion_receipts ORDER BY attempt_id, delivery_number`);
  const receipts = pending.map((row) => opaqueReceiptFromRow(row));
  /* Validate every pending authority before a conversion can commit. */
  const recoverable = receipts.map((receipt) => {
    const attempt = one(database, "SELECT attempt_number, state FROM runtime_attempts WHERE attempt_id = ? AND invocation_id = ?", receipt.attemptId, receipt.invocationId);
    const advancedByPriorDelivery = attempt !== undefined && attempt["state"] !== receipt.attemptStateAtReceipt && hasPriorLinkedDelivery(database, receipt.attemptId, receipt.deliveryNumber);
    if (attempt === undefined || (!advancedByPriorDelivery && attempt["state"] !== receipt.attemptStateAtReceipt) || (attempt["attempt_number"] !== 1 && attempt["attempt_number"] !== 2)) throw new Error("opaque completion receipt Attempt disposition drifted before recovery");
    const delivery = one(database, "SELECT count(*) AS count FROM runtime_provider_deliveries WHERE attempt_id = ? AND delivery_number = ?", receipt.attemptId, receipt.deliveryNumber)?.["count"];
    if (delivery !== 0) throw new Error("opaque completion receipt conflicts with its exact Delivery");
    const prepared = canonicalPrepared(database, receipt.invocationId);
    if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") validatedGenericOutputResolution(database, prepared, receipt.attemptId, receipt.deliveryNumber, receipt.wireDigest, receipt.trustedReceivedAt);
    const immutableAttempt = Object.freeze({ attemptId: receipt.attemptId, attemptNumber: attempt["attempt_number"] as 1 | 2, invocationId: receipt.invocationId, noSdkRetry: true });
    return Object.freeze({ immutableAttempt, prepared, receipt });
  });
  /* A receipt captured while an earlier Delivery is RESULT_RECEIVED must not
   * classify ahead of that already-persisted authority.  It is safe to consume
   * the older Delivery here: the complete opaque set was validated first, and
   * both callers wrap startup recovery in one transaction. */
  if (recoverable.some(({ receipt }) => receipt.attemptStateAtReceipt === "RESULT_RECEIVED" && one(database, `SELECT 1 AS present
    FROM runtime_provider_deliveries AS delivery
    LEFT JOIN runtime_delivery_arrivals AS linked ON linked.delivery_id = delivery.delivery_id
    WHERE delivery.attempt_id = ? AND delivery.delivery_number < ? AND linked.delivery_id IS NULL`, receipt.attemptId, receipt.deliveryNumber) !== undefined)) {
    recoverReceivedRuntimeAttempts(database);
  }
  for (const { immutableAttempt, prepared, receipt } of recoverable) {
    if (leaveCurrentDurable?.opaqueReceiptId === receipt.opaqueReceiptId) continue;
    const current = one(database, "SELECT state FROM runtime_attempts WHERE attempt_id = ?", receipt.attemptId);
    const advancedByPriorDelivery = current !== undefined && current["state"] !== receipt.attemptStateAtReceipt && hasPriorLinkedDelivery(database, receipt.attemptId, receipt.deliveryNumber);
    if (current === undefined || (current["state"] !== receipt.attemptStateAtReceipt && !advancedByPriorDelivery)) throw new Error("opaque completion receipt Attempt disposition drifted before conversion");
    commitProviderResultInternal(database, prepared, immutableAttempt, receipt.wire, receipt.trustedReceivedAt, true, undefined, receipt);
  }
}

/** Startup consumes the exact bounded receipt; it never asks the provider to replay. */
export function recoverReceivedRuntimeAttempts(database: DatabaseSync): void {
  const pending = rows(database, `SELECT d.delivery_id, d.schema_version, d.invocation_id, d.attempt_id, d.response_id, d.delivery_number, d.wire_digest, d.redacted_envelope_json, d.replayable_response_json, d.trusted_received_at, d.physical_trusted_received_at, d.attempt_state_at_receipt, d.receipt_binding, d.original_attempt_state_at_receipt, d.original_receipt_state_binding, a.attempt_number, a.state AS current_attempt_state,
      p.invocation_id AS physical_invocation_id, p.attempt_id AS physical_attempt_id, p.envelope_digest, p.redacted_envelope_json AS physical_capsule, p.replayable_response_json AS physical_replay, p.trusted_received_at AS physical_received_at, p.provider_received_at AS physical_provider_received_at
    FROM runtime_provider_deliveries d
    JOIN runtime_attempts a ON a.attempt_id = d.attempt_id
    JOIN runtime_physical_responses p ON p.response_id = d.response_id
    LEFT JOIN runtime_delivery_arrivals linked ON linked.delivery_id = d.delivery_id
    WHERE linked.delivery_id IS NULL
    ORDER BY d.attempt_id, d.delivery_number`);
  for (const row of pending) {
    const invocationId = parseInvocationId(row["invocation_id"]); const attemptId = parseAttemptId(row["attempt_id"]); const attemptNumber = row["attempt_number"];
    if (attemptNumber !== 1 && attemptNumber !== 2) throw new Error("pending provider delivery has an invalid Attempt number");
    const prepared = canonicalPrepared(database, invocationId);
    const delivery = deliveryFromRow(database, row, { allowLegacy: row["schema_version"] === "accord.runtime-provider-delivery/v1", attemptId, invocationId, modelId: prepared.modelId });
    if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") validatedGenericOutputResolution(database, prepared, attemptId, delivery.deliveryNumber, delivery.rawResponseDigest, delivery.trustedReceivedAt);
    if (row["current_attempt_state"] !== delivery.attemptStateAtReceipt) throw new Error("pending provider delivery terminal disposition is not bound to its Attempt");
    const capsule = validateCanonicalReceiptCapsule(delivery.rawResponseJson, delivery.rawResponseDigest);
    const immutableAttempt = Object.freeze({ attemptId, attemptNumber, invocationId, noSdkRetry: true });
    if (capsule.invalid) {
      finalizeInvalidProviderReceipt(database, prepared, immutableAttempt, delivery);
    } else {
      const parsed = parseProviderWire(delivery.replayableResponseJson);
      if (parsed.kind !== "WIRE" || parsed.wire !== delivery.replayableResponseJson || parsed.digest !== delivery.rawResponseDigest || rawResponse(parsed.parsed, delivery.rawResponseDigest) !== delivery.rawResponseJson) throw new Error("pending delivery recovery capsule does not match its replayable wire");
      commitProviderResultInternal(database, prepared, immutableAttempt, delivery.replayableResponseJson, delivery.trustedReceivedAt, true, delivery);
    }
  }
}
function awaitProviderWireCompletion(value: unknown): Promise<Readonly<{ value: unknown }>> {
  if (!isPromise(value)) return Promise.resolve(Object.freeze({ value }));
  return new Promise((resolve, reject) => {
    Promise.prototype.then.call(value, (resolved: unknown) => resolve(Object.freeze({ value: resolved })), reject);
  });
}
export async function executePreparedAttempt(database: DatabaseSync, supplied: PreparedProfileInvocation, port: ProviderPort, now: string): Promise<ProviderResultArbitration> {
  const prepared = canonicalPrepared(database, supplied.invocationId); assertSuppliedIdentity(supplied, prepared);
  const suppliedOutputContract = prepared.profile === "REVIEWER" || prepared.profile === "WRITER" ? port.outputContract : undefined;
  const outputContract = suppliedOutputContract === undefined ? undefined : Object.freeze({ invocationId: suppliedOutputContract.invocationId, contextDigest: suppliedOutputContract.contextDigest, profile: suppliedOutputContract.profile, profileVersion: suppliedOutputContract.profileVersion, outputSchema: suppliedOutputContract.outputSchema, materialize: suppliedOutputContract.materialize });
  if (prepared.profile === "REVIEWER" || prepared.profile === "WRITER") assertInvocationBoundOutputContract(prepared, outputContract);
  const attempt = beginPreparedAttempt(database, prepared.invocationId, now);
  let response: unknown;
  try { const completion = port.complete(Object.freeze({ attempt, invocation: prepared, retry: "DISABLED" })); response = (await awaitProviderWireCompletion(completion)).value; }
  catch (error) { transaction(database, () => { const at = instant(now, "now"); database.prepare("UPDATE runtime_attempts SET state = 'UNKNOWN', finished_at = ? WHERE attempt_id = ? AND state = 'RUNNING'").run(at, attempt.attemptId); database.prepare("UPDATE runtime_invocations SET status = 'UNKNOWN' WHERE invocation_id = ? AND status = 'RUNNING'").run(prepared.invocationId); recordUnknownRuntimeArrival(database, { invocationId: prepared.invocationId, attemptId: attempt.attemptId, caseId: prepared.caseId, boardId: prepared.boardId, workflowRunId: prepared.workflowRunId, recordedAt: at, eventKind: `RUNTIME_PROVIDER_EXCEPTION_UNKNOWN:${attempt.attemptId}`, details: {} }); failInvocationIfExhausted(database, prepared, at); }); throw error; }
  return commitProviderResult(database, prepared, attempt, response as ProviderWire, undefined, outputContract);
}
