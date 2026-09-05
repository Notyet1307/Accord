import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  deriveProfileContextId,
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseInvocationId,
  parseWorkflowRunId,
  type BoardId,
  type CaseId,
  type ContextId,
  type InvocationId,
  type WorkflowRunId,
} from "./core/ids.js";

export const REVIEWER_PROFILE_VERSION = "accord.reviewer/v1" as const;
export const WRITER_PROFILE_VERSION = "accord.writer/v1" as const;
export const REVIEWER_OUTPUT_SCHEMA = "accord.reviewer-output/v1" as const;
export const WRITER_OUTPUT_SCHEMA = "accord.writer-output/v1" as const;
export type FixedContextProfile = "REVIEWER" | "WRITER";

const WORKFLOW_DEFINITION_ID = "workflow_definition_r003_fixed_v1";
const WORKFLOW_DEFINITION_VERSION = "r003-fixed/v1";

export interface FixedProfileContextInput {
  readonly invocationId: InvocationId;
  readonly caseId: CaseId;
  readonly workflowRunId: WorkflowRunId;
  readonly boardId: BoardId;
  readonly nodeId: FixedContextProfile;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: string;
  readonly profileVersion: string;
  readonly providerPortVersion: string;
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly outputSchema: string;
  readonly objective: string;
  readonly selectedEntriesJson: string;
  readonly approvedSourcesJson: string;
  readonly permissionSummaryJson: string;
  readonly contextDigest: string;
  readonly createdAt: string;
}

export interface PersistedFixedProfileContext extends FixedProfileContextInput {
  readonly contextId: ContextId;
  readonly boardRevision: number;
  readonly workflowRevision: number;
}

let savepointSequence = 0;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))]));
  return value;
}

function parseJson(value: string, expected: "array" | "object", label: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new TypeError(`${label} must be valid JSON`); }
  if ((expected === "array" && !Array.isArray(parsed)) || (expected === "object" && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)))) throw new TypeError(`${label} must be a JSON ${expected}`);
  return JSON.stringify(canonical(parsed));
}

function instant(value: string, label: string): string {
  if (new Date(Date.parse(value)).toISOString() !== value) throw new TypeError(`${label} must be a canonical UTC instant`);
  return value;
}

function hexDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError("contextDigest must be a lowercase SHA-256 digest");
  return value;
}

function profileFields(profile: FixedContextProfile): Readonly<{ profileVersion: string; outputSchema: string }> {
  return profile === "REVIEWER" ? { profileVersion: REVIEWER_PROFILE_VERSION, outputSchema: REVIEWER_OUTPUT_SCHEMA } : { profileVersion: WRITER_PROFILE_VERSION, outputSchema: WRITER_OUTPUT_SCHEMA };
}

function existing(database: DatabaseSync, invocationId: InvocationId): Record<string, unknown> | undefined {
  const value = database.prepare("SELECT * FROM profile_contexts WHERE invocation_id = ?").get(invocationId);
  return value === undefined ? undefined : value as Record<string, unknown>;
}

function selectedEntries(database: DatabaseSync, value: string, caseId: CaseId, boardId: BoardId, boardRevision: number): string {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new TypeError("selectedEntriesJson must be a JSON array");
  const normalized = parsed.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`selected entry ${index} must be an object`);
    const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "digest,id,type") throw new TypeError(`selected entry ${index} has an unsupported field`);
    const id = parseBoardEntryId(row["id"]);
    const digest = row["digest"];
    const type = row["type"];
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest) || typeof type !== "string" || type.length < 1 || type.length > 32) throw new TypeError(`selected entry ${index} is invalid`);
    const persisted = database.prepare("SELECT entry_type, content_digest, created_revision FROM board_entries WHERE board_entry_id = ? AND case_id = ? AND board_id = ?").get(id, caseId, boardId) as Record<string, unknown> | undefined;
    if (persisted === undefined || persisted["entry_type"] !== type || persisted["content_digest"] !== digest || !Number.isSafeInteger(persisted["created_revision"]) || (persisted["created_revision"] as number) > boardRevision) throw new Error("selected Context entry is outside its exact Board revision");
    return { digest, id, type };
  });
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new Error("selected Context entries must be unique");
  return JSON.stringify(normalized);
}
function recomputeContextDigest(database: DatabaseSync, input: FixedProfileContextInput, selectedJson: string, boardRevision: number, workflowRevision: number): string {
  const selected = JSON.parse(selectedJson) as readonly { readonly digest: string; readonly id: string; readonly type: string }[];
  const entries = selected.map((entry) => {
    const row = database.prepare("SELECT payload_json FROM board_entries WHERE board_entry_id = ? AND case_id = ? AND board_id = ?").get(entry.id, input.caseId, input.boardId) as Record<string, unknown> | undefined;
    if (row === undefined || typeof row["payload_json"] !== "string") throw new Error("selected Context entry payload is missing");
    return { digest: entry.digest, id: entry.id, payload: JSON.parse(row["payload_json"]), type: entry.type };
  });
  const approvedSources = JSON.parse(input.approvedSourcesJson) as unknown;
  const permissionSummary = JSON.parse(input.permissionSummaryJson) as unknown;
  const core = { approvedSources, boardId: input.boardId, boardRevision, caseId: input.caseId, entries, modelId: input.modelId, node: input.nodeId, objective: input.objective, outputSchema: input.outputSchema, permissionSummary, profileVersion: input.profileVersion, providerPortVersion: input.providerPortVersion, runtimeVersion: input.runtimeVersion, workflowDefinitionId: input.workflowDefinitionId, workflowDefinitionVersion: input.workflowDefinitionVersion, workflowRevision, workflowRunId: input.workflowRunId };
  return createHash("sha256").update(JSON.stringify(canonical(core)), "utf8").digest("hex");
}

function sameRow(row: Record<string, unknown>, input: FixedProfileContextInput, contextId: ContextId): boolean {
  const expected: Record<string, unknown> = {
    context_id: contextId, schema_version: "accord.profile-context/v1", invocation_id: input.invocationId, case_id: input.caseId, workflow_run_id: input.workflowRunId, board_id: input.boardId, node_id: input.nodeId,
    workflow_definition_id: input.workflowDefinitionId, workflow_definition_version: input.workflowDefinitionVersion, profile_version: input.profileVersion, provider_port_version: input.providerPortVersion, model_id: input.modelId, runtime_version: input.runtimeVersion, output_schema: input.outputSchema, objective: input.objective,
    selected_entries_json: input.selectedEntriesJson, approved_sources_json: input.approvedSourcesJson, permission_summary_json: input.permissionSummaryJson, context_digest: input.contextDigest, created_at: input.createdAt,
  };
  return Object.keys(expected).every((key) => row[key] === expected[key]);
}

/** Persists only fixed Reviewer/Writer Contexts; it performs no provider or runtime execution. */
function persistFixedProfileContextInternal(database: DatabaseSync, input: FixedProfileContextInput, allowHistorical: boolean): PersistedFixedProfileContext {
  const nested = (database as unknown as { readonly isTransaction?: boolean }).isTransaction === true;
  const savepoint = `profile_context_${savepointSequence += 1}`;
  database.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    if (input.nodeId !== "REVIEWER" && input.nodeId !== "WRITER") throw new TypeError("only fixed Reviewer and Writer Contexts are supported");
    const fields = profileFields(input.nodeId);
    if (input.workflowDefinitionId !== WORKFLOW_DEFINITION_ID || input.workflowDefinitionVersion !== WORKFLOW_DEFINITION_VERSION || input.profileVersion !== fields.profileVersion || input.outputSchema !== fields.outputSchema) throw new Error("fixed Profile Context contract is invalid");
    const caseId = parseCaseId(input.caseId); const workflowRunId = parseWorkflowRunId(input.workflowRunId); const boardId = parseBoardId(input.boardId); const invocationId = parseInvocationId(input.invocationId); const contextId = deriveProfileContextId({ invocationId });
    const approvedSourcesJson = parseJson(input.approvedSourcesJson, "array", "approvedSourcesJson"); const permissionSummaryJson = parseJson(input.permissionSummaryJson, "object", "permissionSummaryJson"); const contextDigest = hexDigest(input.contextDigest); const createdAt = instant(input.createdAt, "createdAt");
    const invocation = database.prepare(`SELECT i.case_id, i.workflow_run_id, i.board_id, i.node_id, i.profile_version, i.workflow_revision, i.board_revision, i.context_digest, b.revision AS current_board_revision, w.revision AS current_workflow_revision, w.state, c.status, d.definition_version FROM runtime_invocations i JOIN cases c ON c.case_id = i.case_id JOIN boards b ON b.board_id = i.board_id AND b.case_id = i.case_id JOIN workflow_runs w ON w.workflow_run_id = i.workflow_run_id AND w.case_id = i.case_id JOIN workflow_definitions d ON d.workflow_definition_id = w.workflow_definition_id WHERE i.invocation_id = ?`).get(invocationId) as Record<string, unknown> | undefined;
    if (invocation === undefined || invocation["case_id"] !== caseId || invocation["workflow_run_id"] !== workflowRunId || invocation["board_id"] !== boardId || invocation["node_id"] !== input.nodeId || invocation["profile_version"] !== input.profileVersion || invocation["context_digest"] !== contextDigest || invocation["definition_version"] !== WORKFLOW_DEFINITION_VERSION || !Number.isSafeInteger(invocation["workflow_revision"]) || !Number.isSafeInteger(invocation["board_revision"]) || (!allowHistorical && (invocation["state"] !== input.nodeId || invocation["status"] !== "OPEN" || invocation["workflow_revision"] !== invocation["current_workflow_revision"] || invocation["board_revision"] !== invocation["current_board_revision"]))) throw new Error("Profile Context is not exactly bound to its Invocation graph");
    const selectedEntriesJson = selectedEntries(database, parseJson(input.selectedEntriesJson, "array", "selectedEntriesJson"), caseId, boardId, invocation["board_revision"] as number);
    if (recomputeContextDigest(database, { ...input, caseId, workflowRunId, boardId, invocationId, approvedSourcesJson, permissionSummaryJson }, selectedEntriesJson, invocation["board_revision"] as number, invocation["workflow_revision"] as number) !== contextDigest) throw new Error("Profile Context digest does not match its immutable graph");
    const normalized = { ...input, invocationId, caseId, workflowRunId, boardId, contextId, selectedEntriesJson, approvedSourcesJson, permissionSummaryJson, contextDigest, createdAt };
    const old = existing(database, invocationId);
    if (old !== undefined) { if (!sameRow(old, normalized, contextId)) throw new Error("Profile Context identity conflicts with immutable persisted context"); }
    else database.prepare(`INSERT INTO profile_contexts (context_id, schema_version, invocation_id, case_id, workflow_run_id, board_id, node_id, workflow_definition_id, workflow_definition_version, profile_version, provider_port_version, model_id, runtime_version, output_schema, objective, selected_entries_json, approved_sources_json, permission_summary_json, context_digest, created_at) VALUES (?, 'accord.profile-context/v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contextId, invocationId, caseId, workflowRunId, boardId, input.nodeId, input.workflowDefinitionId, input.workflowDefinitionVersion, input.profileVersion, input.providerPortVersion, input.modelId, input.runtimeVersion, input.outputSchema, input.objective, selectedEntriesJson, approvedSourcesJson, permissionSummaryJson, contextDigest, createdAt);
    const result = Object.freeze({ ...normalized, boardRevision: invocation["board_revision"] as number, workflowRevision: invocation["workflow_revision"] as number });
    database.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) { try { database.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK"); } catch { /* preserve original failure */ } throw error; }
}

export function persistFixedProfileContext(database: DatabaseSync, input: FixedProfileContextInput): PersistedFixedProfileContext { return persistFixedProfileContextInternal(database, input, false); }

export function readFixedProfileContext(database: DatabaseSync, invocationId: InvocationId): PersistedFixedProfileContext | undefined {
  const row = existing(database, parseInvocationId(invocationId));
  if (row === undefined) return undefined;
  if (row["node_id"] !== "REVIEWER" && row["node_id"] !== "WRITER") throw new Error("Researcher/Analyst Context is outside the fixed C01 seam");
  const input: FixedProfileContextInput = {
    invocationId: parseInvocationId(row["invocation_id"]), caseId: parseCaseId(row["case_id"]), workflowRunId: parseWorkflowRunId(row["workflow_run_id"]), boardId: parseBoardId(row["board_id"]), nodeId: row["node_id"], workflowDefinitionId: String(row["workflow_definition_id"]), workflowDefinitionVersion: String(row["workflow_definition_version"]), profileVersion: String(row["profile_version"]), providerPortVersion: String(row["provider_port_version"]), modelId: String(row["model_id"]), runtimeVersion: String(row["runtime_version"]), outputSchema: String(row["output_schema"]), objective: String(row["objective"]), selectedEntriesJson: String(row["selected_entries_json"]), approvedSourcesJson: String(row["approved_sources_json"]), permissionSummaryJson: String(row["permission_summary_json"]), contextDigest: hexDigest(String(row["context_digest"])), createdAt: instant(String(row["created_at"]), "createdAt"),
  };
  return persistFixedProfileContextInternal(database, input, true);
}
