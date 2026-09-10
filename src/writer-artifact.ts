import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { ReviewerDispositionHandoff } from "./contracts/reviewer-disposition.js";
import {
  deriveAcceptedEvidenceEntryId,
  deriveArtifactId,
  deriveEvidenceAcceptanceAuditEventId,
  deriveRuntimeAuditCorrelationId,
  deriveSourceId,
  parseArtifactId,
  parseBoardEntryId,
  type ArtifactId,
  type BoardEntryId,
  type ResultId,
} from "./core/ids.js";
import type { DurableGenericMaterialization, InvocationBoundOutputContract } from "./profile-runtime.js";
import { selectAnalystWinnerTarget, type PreparedProfileInvocation } from "./researcher-analyst.js";
import { projectPreparedProfileTarget } from "./reviewer-context.js";

export const ARTIFACT_SCHEMA_VERSION = "accord.artifact/v1" as const;
export const WRITER_ARTIFACT_HANDOFF_KIND = "WRITER_ARTIFACT" as const;
export const WRITER_ARTIFACT_HANDOFF_VERSION = "accord.writer-artifact-handoff/v1" as const;
const EVIDENCE_ACCEPTANCE_AUTHOR = "EVIDENCE_ACCEPTANCE" as const;

type Row = Record<string, unknown>;
type AssertionBasis = Readonly<{
  kind: "ACCEPTED_EVIDENCE" | "NON_ISSUE_REVIEWER_VERIFICATION";
  entryId: BoardEntryId;
  contentDigest: string;
}>;
type MaterialAssertion = Readonly<{
  ordinal: number;
  statement: string;
  basis: AssertionBasis;
}>;
type WriterArtifactCarrier = Readonly<{
  artifactId: ArtifactId;
  artifactRevision: 1;
  contentMarkdown: string;
  contentDigest: string;
  materialAssertions: readonly MaterialAssertion[];
  manifestDigest: string;
  artifactDigest: string;
  reviewerHandoffId: string;
  reviewerResultId: ResultId;
  reviewerHandoff: ReviewerDispositionHandoff;
}>;
export type AcceptedEvidenceRef = Readonly<{
  candidateEntryId: BoardEntryId;
  entryId: BoardEntryId;
  contentDigest: string;
  boardRevision: number;
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))]));
  return value;
}
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return createHash("sha256").update(json(value), "utf8").digest("hex"); }
function record(value: unknown, label: string): Row { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Row; }
function exact(value: Row, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an unsupported or missing field`); }
function hex(value: unknown, label: string): string { if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new TypeError(`${label} must be a SHA-256 digest`); return value; }
function instant(value: unknown, label: string): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) throw new TypeError(`${label} must be a canonical UTC instant`); return value; }
function statement(value: unknown): string { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 2_048 || /[\r\n\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError("material assertion statement must be one bounded line"); return value; }

function parseEvidencePayload(value: unknown): Readonly<{ sourceId: string; sourceKind: string; locator: string; sourceDigest: string; observedAt: string }> {
  const payload = record(value, "EvidenceRef payload");
  exact(payload, ["locator", "observedAt", "sourceDigest", "sourceId", "sourceKind"], "EvidenceRef payload");
  const scalar = (field: string): string => { const item = payload[field]; if (typeof item !== "string" || item.length < 1) throw new TypeError(`EvidenceRef ${field} is invalid`); return item; };
  return Object.freeze({ sourceId: scalar("sourceId"), sourceKind: scalar("sourceKind"), locator: scalar("locator"), sourceDigest: hex(payload["sourceDigest"], "EvidenceRef sourceDigest"), observedAt: instant(payload["observedAt"], "EvidenceRef observedAt") });
}

type SealedSource = Readonly<{ sourceId: string; sourceKind: string; locator: string; content: string; contentDigest: string; observedAt: string }>;
function sealedSources(database: DatabaseSync): ReadonlyMap<string, SealedSource> {
  const header = database.prepare("SELECT schema_version, manifest_digest, source_count, state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'").get() as Row | undefined;
  const sourceRows = database.prepare("SELECT source_id, schema_version, source_kind, locator, content, content_digest, observed_at, manifest_id FROM approved_synthetic_sources WHERE manifest_id = 'source_manifest_r003_v1' ORDER BY source_id").all() as readonly Row[];
  if (header === undefined || header["schema_version"] !== "accord.approved-synthetic-source-manifest/v1" || header["state"] !== "SEALED" || header["source_count"] !== sourceRows.length) throw new Error("approved synthetic source manifest header or set is invalid");
  const sources = sourceRows.map((row): SealedSource => {
    const source = Object.freeze({ sourceId: String(row["source_id"]), sourceKind: String(row["source_kind"]), locator: String(row["locator"]), content: String(row["content"]), contentDigest: hex(row["content_digest"], "approved source content digest"), observedAt: instant(row["observed_at"], "approved source observedAt") });
    if (row["schema_version"] !== "accord.approved-synthetic-source/v1" || source.contentDigest !== digest(source.content) || source.sourceId !== deriveSourceId({ sourceKind: source.sourceKind, locator: source.locator, contentDigest: source.contentDigest, observedAt: source.observedAt })) throw new Error("approved synthetic source manifest member is invalid");
    return source;
  });
  const references = sources.map(({ content: _content, contentDigest, locator, observedAt, sourceId, sourceKind }) => ({ contentDigest, locator, observedAt, sourceId, sourceKind }));
  if (header["manifest_digest"] !== digest({ sources: references, version: "accord.r003-approved-synthetic-sources/v1" })) throw new Error("approved synthetic source manifest digest is invalid");
  return new Map(sources.map((source) => [source.sourceId, source]));
}

function acceptedImmutable(payload: Readonly<Record<string, unknown>>, sourceId: string, candidateEntryId: BoardEntryId) {
  return { authorId: EVIDENCE_ACCEPTANCE_AUTHOR, authorType: "SYSTEM", basedOn: [], contradicts: [], entryType: "EvidenceRef", instructionAuthority: "NONE", payload, sourceRefs: [sourceId], status: "ACCEPTED", supersedes: [candidateEntryId], trustLevel: "VERIFIED", visibility: "CASE" } as const;
}

/** Appends the sole immutable system acceptance of an exact sealed-manifest EvidenceRef. */
export function acceptSyntheticEvidence(database: DatabaseSync, candidateEntryId: BoardEntryId, acceptedAt: string): AcceptedEvidenceRef {
  const candidateId = parseBoardEntryId(candidateEntryId); const at = instant(acceptedAt, "acceptedAt");
  const sources = sealedSources(database); const manifest = database.prepare("SELECT manifest_digest FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'").get() as Row; const manifestDigest = hex(manifest["manifest_digest"], "source manifest digest");
  const row = database.prepare(`SELECT entry.*, board.revision AS board_revision, workflow.workflow_run_id, workflow.state AS workflow_state,
      result.result_id, invocation.invocation_id, invocation.status AS invocation_status
    FROM board_entries entry
    JOIN boards board ON board.board_id = entry.board_id AND board.case_id = entry.case_id
    JOIN workflow_runs workflow ON workflow.board_id = board.board_id AND workflow.case_id = entry.case_id
    JOIN runtime_result_entries link ON link.board_entry_id = entry.board_entry_id
    JOIN runtime_results result ON result.result_id = link.result_id
    JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER'
    JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id AND invocation.workflow_run_id = workflow.workflow_run_id
    WHERE entry.board_entry_id = ? AND entry.entry_type = 'EvidenceRef' AND invocation.node_id = 'RESEARCHER'`).get(candidateId) as Row | undefined;
  if (row === undefined || row["schema_version"] !== "accord.board-entry/v1" || row["status"] !== "CANDIDATE" || row["trust_level"] !== "CANDIDATE" || row["author_type"] !== "AGENT" || row["author_id"] !== "RESEARCHER" || row["visibility"] !== "CASE" || row["instruction_authority"] !== "NONE" || row["invocation_status"] !== "RESULT_COMMITTED") throw new Error("EvidenceRef is not an exact current Researcher candidate over a sealed manifest");
  const payload = parseEvidencePayload(JSON.parse(String(row["payload_json"]))); const source = sources.get(payload.sourceId);
  const sourceRefs = JSON.parse(String(row["source_refs_json"])); const basedOn = JSON.parse(String(row["based_on_json"])); const contradicts = JSON.parse(String(row["contradicts_json"])); const supersedes = JSON.parse(String(row["supersedes_json"]));
  const candidateImmutable = { authorId: row["author_id"], authorType: row["author_type"], basedOn, contradicts, entryType: row["entry_type"], instructionAuthority: row["instruction_authority"], payload, sourceRefs, status: row["status"], supersedes, trustLevel: row["trust_level"], visibility: row["visibility"] };
  if (source === undefined || json(sourceRefs) !== json([payload.sourceId]) || json(basedOn) !== "[]" || json(contradicts) !== "[]" || json(supersedes) !== "[]" || row["content_digest"] !== digest(candidateImmutable) || source.sourceKind !== payload.sourceKind || source.locator !== payload.locator || source.contentDigest !== payload.sourceDigest || source.observedAt !== payload.observedAt) throw new Error("candidate EvidenceRef provenance does not exactly match the sealed source manifest");
  const entryId = deriveAcceptedEvidenceEntryId({ candidateEntryId: candidateId, manifestDigest }); const immutable = acceptedImmutable(payload, payload.sourceId, candidateId); const contentDigest = digest(immutable);
  const existing = database.prepare("SELECT * FROM board_entries WHERE board_entry_id = ?").get(entryId) as Row | undefined;
  if (existing !== undefined) {
    const exactExisting = existing["case_id"] === row["case_id"] && existing["board_id"] === row["board_id"] && existing["entry_type"] === "EvidenceRef" && existing["status"] === "ACCEPTED" && existing["author_type"] === "SYSTEM" && existing["author_id"] === EVIDENCE_ACCEPTANCE_AUTHOR && existing["payload_json"] === json(payload) && existing["source_refs_json"] === json([payload.sourceId]) && existing["based_on_json"] === "[]" && existing["contradicts_json"] === "[]" && existing["supersedes_json"] === json([candidateId]) && existing["visibility"] === "CASE" && existing["trust_level"] === "VERIFIED" && existing["instruction_authority"] === "NONE" && existing["content_digest"] === contentDigest;
    if (!exactExisting) throw new Error("accepted EvidenceRef identity conflicts with immutable authority");
    return Object.freeze({ candidateEntryId: candidateId, entryId, contentDigest, boardRevision: Number(existing["created_revision"]) });
  }
  const superseder = database.prepare("SELECT board_entry_id FROM board_entries, json_each(board_entries.supersedes_json) WHERE json_each.value = ? LIMIT 1").get(candidateId);
  if (superseder !== undefined) throw new Error("candidate EvidenceRef already has a different successor");
  if (row["workflow_state"] !== "WRITER") throw new Error("EvidenceRef acceptance is allowed only immediately before Writer preparation");
  const boardRevision = Number(row["board_revision"]); if (!Number.isSafeInteger(boardRevision)) throw new Error("EvidenceRef Board revision is invalid"); const nextRevision = boardRevision + 1;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`INSERT INTO board_entries (board_entry_id, schema_version, board_id, case_id, entry_type, status, author_type, author_id, payload_json, source_refs_json, based_on_json, contradicts_json, supersedes_json, visibility, trust_level, instruction_authority, created_revision, content_digest, created_at)
      VALUES (?, 'accord.board-entry/v1', ?, ?, 'EvidenceRef', 'ACCEPTED', 'SYSTEM', ?, ?, ?, '[]', '[]', ?, 'CASE', 'VERIFIED', 'NONE', ?, ?, ?)`).run(entryId, String(row["board_id"]), String(row["case_id"]), EVIDENCE_ACCEPTANCE_AUTHOR, json(payload), json([payload.sourceId]), json([candidateId]), nextRevision, contentDigest, at);
    if (database.prepare("UPDATE boards SET revision = ? WHERE board_id = ? AND revision = ?").run(nextRevision, String(row["board_id"]), boardRevision).changes !== 1) throw new Error("EvidenceRef acceptance lost its Board freshness compare-and-set");
    database.prepare(`INSERT INTO audit_events (audit_event_id, schema_version, correlation_id, event_kind, case_id, board_id, workflow_run_id, receipt_id, details_json, recorded_at)
      VALUES (?, 'accord.audit-event/v1', ?, 'EVIDENCE_ACCEPTED', ?, ?, ?, NULL, ?, ?)`).run(deriveEvidenceAcceptanceAuditEventId(entryId), deriveRuntimeAuditCorrelationId(String(row["invocation_id"]) as PreparedProfileInvocation["invocationId"]), String(row["case_id"]), String(row["board_id"]), String(row["workflow_run_id"]), json({ candidateEntryId: candidateId, entryId, manifestDigest, sourceId: payload.sourceId }), at);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return Object.freeze({ candidateEntryId: candidateId, entryId, contentDigest, boardRevision: nextRevision });
}

function acceptedEvidence(database: DatabaseSync, context: PreparedProfileInvocation): ReadonlyMap<BoardEntryId, Readonly<{ content: string; contentDigest: string }>> {
  const sources = sealedSources(database); const selected = new Map(context.entries.map((entry) => [entry.id, entry.digest]));
  const rows = database.prepare(`SELECT entry.*, candidate.board_entry_id AS candidate_id, candidate.payload_json AS candidate_payload_json
    FROM board_entries entry
    JOIN json_each(entry.supersedes_json) superseded
    JOIN board_entries candidate ON candidate.board_entry_id = superseded.value
    WHERE entry.case_id = ? AND entry.board_id = ? AND entry.created_revision <= ? AND entry.entry_type = 'EvidenceRef'
      AND entry.status = 'ACCEPTED' AND entry.trust_level = 'VERIFIED' AND entry.author_type = 'SYSTEM' AND entry.author_id = ?
      AND candidate.status = 'CANDIDATE' AND candidate.trust_level = 'CANDIDATE' AND candidate.entry_type = 'EvidenceRef' AND candidate.author_type = 'AGENT' AND candidate.author_id = 'RESEARCHER'
      AND NOT EXISTS (SELECT 1 FROM board_entries newer, json_each(newer.supersedes_json) newer_link WHERE newer_link.value = entry.board_entry_id)
    ORDER BY entry.board_entry_id`).all(context.caseId, context.boardId, context.boardRevision, EVIDENCE_ACCEPTANCE_AUTHOR) as readonly Row[];
  const result = new Map<BoardEntryId, Readonly<{ content: string; contentDigest: string }>>();
  for (const row of rows) {
    const id = parseBoardEntryId(row["board_entry_id"]); const candidateId = parseBoardEntryId(row["candidate_id"]); const payload = parseEvidencePayload(JSON.parse(String(row["payload_json"]))); const source = sources.get(payload.sourceId); const entryDigest = hex(row["content_digest"], "accepted EvidenceRef digest"); const immutable = acceptedImmutable(payload, payload.sourceId, candidateId);
    if (selected.get(id) !== entryDigest || entryDigest !== digest(immutable) || row["schema_version"] !== "accord.board-entry/v1" || row["source_refs_json"] !== json([payload.sourceId]) || row["based_on_json"] !== "[]" || row["contradicts_json"] !== "[]" || row["supersedes_json"] !== json([candidateId]) || row["visibility"] !== "CASE" || row["instruction_authority"] !== "NONE" || row["candidate_payload_json"] !== json(payload) || source === undefined || source.sourceKind !== payload.sourceKind || source.locator !== payload.locator || source.contentDigest !== payload.sourceDigest || source.observedAt !== payload.observedAt) continue;
    result.set(id, Object.freeze({ content: source.content, contentDigest: entryDigest }));
  }
  return result;
}

/** Revalidates every durable accepted EvidenceRef independently of Writer completion. */
export function validatePersistedAcceptedEvidence(database: DatabaseSync): void {
  const acceptedRows = database.prepare(`SELECT * FROM board_entries WHERE author_id = ? OR (entry_type = 'EvidenceRef'
    AND (author_type = 'SYSTEM' OR status = 'ACCEPTED' OR trust_level = 'VERIFIED')) ORDER BY board_entry_id`).all(EVIDENCE_ACCEPTANCE_AUTHOR) as readonly Row[];
  const sources = sealedSources(database); const manifest = database.prepare("SELECT manifest_digest FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'").get() as Row; const manifestDigest = hex(manifest["manifest_digest"], "source manifest digest");
  const validatedAuditIds = new Set<string>();
  for (const accepted of acceptedRows) {
    if (accepted["entry_type"] !== "EvidenceRef") throw new Error("accepted EvidenceRef entry type is invalid");
    const supersedes = JSON.parse(String(accepted["supersedes_json"])) as unknown; if (!Array.isArray(supersedes) || supersedes.length !== 1) throw new Error("accepted EvidenceRef must supersede exactly one candidate"); const candidateId = parseBoardEntryId(supersedes[0]);
    const candidate = database.prepare(`SELECT entry.*, board.revision AS board_revision, workflow.workflow_run_id, result.result_id, invocation.invocation_id, invocation.status AS invocation_status
      FROM board_entries entry JOIN boards board ON board.board_id = entry.board_id AND board.case_id = entry.case_id
      JOIN workflow_runs workflow ON workflow.board_id = board.board_id AND workflow.case_id = entry.case_id
      JOIN runtime_result_entries link ON link.board_entry_id = entry.board_entry_id JOIN runtime_results result ON result.result_id = link.result_id
      JOIN runtime_result_arrivals arrival ON arrival.result_id = result.result_id AND arrival.outcome = 'WINNER'
      JOIN runtime_invocations invocation ON invocation.invocation_id = result.invocation_id AND invocation.workflow_run_id = workflow.workflow_run_id
      WHERE entry.board_entry_id = ? AND invocation.node_id = 'RESEARCHER'`).get(candidateId) as Row | undefined;
    if (candidate === undefined || candidate["schema_version"] !== "accord.board-entry/v1" || candidate["entry_type"] !== "EvidenceRef" || candidate["status"] !== "CANDIDATE" || candidate["trust_level"] !== "CANDIDATE" || candidate["author_type"] !== "AGENT" || candidate["author_id"] !== "RESEARCHER" || candidate["visibility"] !== "CASE" || candidate["instruction_authority"] !== "NONE" || candidate["invocation_status"] !== "RESULT_COMMITTED") throw new Error("accepted EvidenceRef candidate authority is invalid");
    const payload = parseEvidencePayload(JSON.parse(String(accepted["payload_json"]))); const candidatePayload = parseEvidencePayload(JSON.parse(String(candidate["payload_json"]))); const source = sources.get(payload.sourceId); const candidateImmutable = { authorId: candidate["author_id"], authorType: candidate["author_type"], basedOn: JSON.parse(String(candidate["based_on_json"])), contradicts: JSON.parse(String(candidate["contradicts_json"])), entryType: candidate["entry_type"], instructionAuthority: candidate["instruction_authority"], payload: candidatePayload, sourceRefs: JSON.parse(String(candidate["source_refs_json"])), status: candidate["status"], supersedes: JSON.parse(String(candidate["supersedes_json"])), trustLevel: candidate["trust_level"], visibility: candidate["visibility"] };
    const immutable = acceptedImmutable(payload, payload.sourceId, candidateId); const entryId = deriveAcceptedEvidenceEntryId({ candidateEntryId: candidateId, manifestDigest }); const contentDigest = digest(immutable); const createdRevision = Number(accepted["created_revision"]); const candidateRevision = Number(candidate["created_revision"]); const boardRevision = Number(candidate["board_revision"]);
    if (accepted["board_entry_id"] !== entryId || accepted["schema_version"] !== "accord.board-entry/v1" || accepted["case_id"] !== candidate["case_id"] || accepted["board_id"] !== candidate["board_id"] || accepted["status"] !== "ACCEPTED" || accepted["trust_level"] !== "VERIFIED" || accepted["author_type"] !== "SYSTEM" || accepted["author_id"] !== EVIDENCE_ACCEPTANCE_AUTHOR || accepted["visibility"] !== "CASE" || accepted["instruction_authority"] !== "NONE" || accepted["payload_json"] !== json(payload) || accepted["source_refs_json"] !== json([payload.sourceId]) || accepted["based_on_json"] !== "[]" || accepted["contradicts_json"] !== "[]" || accepted["supersedes_json"] !== json([candidateId]) || accepted["content_digest"] !== contentDigest || candidate["content_digest"] !== digest(candidateImmutable) || candidate["payload_json"] !== json(payload) || candidate["source_refs_json"] !== json([payload.sourceId]) || candidate["based_on_json"] !== "[]" || candidate["contradicts_json"] !== "[]" || candidate["supersedes_json"] !== "[]" || source === undefined || source.sourceKind !== payload.sourceKind || source.locator !== payload.locator || source.contentDigest !== payload.sourceDigest || source.observedAt !== payload.observedAt || !Number.isSafeInteger(createdRevision) || !Number.isSafeInteger(candidateRevision) || !Number.isSafeInteger(boardRevision) || createdRevision <= candidateRevision || createdRevision > boardRevision) throw new Error("accepted EvidenceRef authority drifted from its sealed candidate tuple");
    const successorCount = database.prepare("SELECT count(*) AS count FROM board_entries entry, json_each(entry.supersedes_json) link WHERE link.value = ?").get(candidateId) as Row; const later = database.prepare("SELECT 1 AS present FROM board_entries entry, json_each(entry.supersedes_json) link WHERE link.value = ? LIMIT 1").get(entryId);
    const audit = database.prepare("SELECT * FROM audit_events WHERE audit_event_id = ?").get(deriveEvidenceAcceptanceAuditEventId(entryId)) as Row | undefined; const expectedDetails = json({ candidateEntryId: candidateId, entryId, manifestDigest, sourceId: payload.sourceId });
    if (successorCount["count"] !== 1 || later !== undefined || audit === undefined || audit["schema_version"] !== "accord.audit-event/v1" || audit["correlation_id"] !== deriveRuntimeAuditCorrelationId(String(candidate["invocation_id"]) as PreparedProfileInvocation["invocationId"]) || audit["event_kind"] !== "EVIDENCE_ACCEPTED" || audit["case_id"] !== accepted["case_id"] || audit["board_id"] !== accepted["board_id"] || audit["workflow_run_id"] !== candidate["workflow_run_id"] || audit["receipt_id"] !== null || audit["details_json"] !== expectedDetails || audit["recorded_at"] !== accepted["created_at"]) throw new Error("accepted EvidenceRef audit or successor authority is invalid");
    validatedAuditIds.add(String(audit["audit_event_id"]));
  }
  const acceptanceAudits = database.prepare("SELECT audit_event_id FROM audit_events WHERE event_kind = 'EVIDENCE_ACCEPTED' ORDER BY audit_event_id").all() as readonly Row[];
  if (acceptanceAudits.length !== validatedAuditIds.size || acceptanceAudits.some((audit) => !validatedAuditIds.has(String(audit["audit_event_id"])))) throw new Error("accepted EvidenceRef audit is orphaned");
}

function assertWriterTargetAuthorization(database: DatabaseSync, context: PreparedProfileInvocation, h1: ReviewerDispositionHandoff): void {
  if (context.profileVersion !== "accord.writer/v1" && context.profileVersion !== "accord.writer/v2" || h1.profileVersion !== (context.profileVersion === "accord.writer/v2" ? "accord.reviewer/v2" : "accord.reviewer/v1")) throw new TypeError("Writer and Reviewer target policy versions differ");
  if (context.profileVersion === "accord.writer/v1") return;
  const target = selectAnalystWinnerTarget(database, context.caseId, context.workflowRunId, context.boardId);
  if (h1.target.entryId !== target.proposalId || h1.target.digest !== target.proposalDigest) throw new TypeError("Writer H1 target differs from Analyst winner");
  const view = projectPreparedProfileTarget(database, context, target);
  for (const ref of [h1.critique, h1.verificationResult]) if (!view.entries.some((entry) => entry.id === ref.entryId && entry.digest === ref.contentDigest)) throw new TypeError("Writer H1 is outside its authorized projection");
}

/** Builds the sole fixed Writer output contract from current accepted authority. */
export function createWriterArtifactContract(database: DatabaseSync, context: PreparedProfileInvocation, h1: ReviewerDispositionHandoff): InvocationBoundOutputContract {
  if (context.profile !== "WRITER" || context.caseId !== h1.caseId || context.workflowRunId !== h1.workflowRunId || context.boardId !== h1.boardId || context.boardRevision <= h1.boardRevision) throw new TypeError("Writer Context is not exact post-promotion authority");
  const current = database.prepare("SELECT c.status, b.revision AS board_revision, w.state, w.revision AS workflow_revision FROM cases c JOIN boards b ON b.case_id = c.case_id JOIN workflow_runs w ON w.case_id = c.case_id AND w.board_id = b.board_id WHERE c.case_id = ?").get(context.caseId) as Row | undefined;
  if (current === undefined || current["status"] !== "OPEN" || current["state"] !== "WRITER" || current["board_revision"] !== context.boardRevision || current["workflow_revision"] !== context.workflowRevision) throw new TypeError("Writer Context is stale");
  assertWriterTargetAuthorization(database, context, h1);
  const evidence = acceptedEvidence(database, context); if (evidence.size < 1) throw new TypeError("Writer Context has no accepted EvidenceRef");
  const verification = context.entries.find((entry) => entry.id === h1.verificationResult.entryId && entry.digest === h1.verificationResult.contentDigest && entry.type === "VerificationResult");
  const critique = context.entries.find((entry) => entry.id === h1.critique.entryId && entry.digest === h1.critique.contentDigest && entry.type === "Critique");
  const target = context.entries.find((entry) => entry.id === h1.target.entryId && entry.digest === h1.target.digest && entry.type === h1.target.type);
  if (verification === undefined || critique === undefined || target === undefined) throw new TypeError("Writer Context lacks the exact H1 graph");
  let verifiedBasis: Readonly<{ entryId: BoardEntryId; contentDigest: string; statement: string }> | undefined;
  if (h1.disposition === "SUPPORTED") {
    const verificationPayload = record(verification.payload, "H1 VerificationResult"); const critiquePayload = record(critique.payload, "H1 Critique");
    const targetStatement = target.payload["action"];
    if (verificationPayload["result"] === "PASS" && verificationPayload["disposition"] === "SUPPORTED" && critiquePayload["issue"] === "NONE" && critiquePayload["severity"] === "NONE" && targetStatement !== undefined) verifiedBasis = Object.freeze({ entryId: verification.id, contentDigest: verification.digest, statement: statement(targetStatement) });
  }
  return Object.freeze({ invocationId: context.invocationId, contextDigest: context.contextDigest, profile: "WRITER", profileVersion: context.profileVersion, outputSchema: context.outputSchema, materialize(currentContext: Readonly<PreparedProfileInvocation>, output: unknown) {
    if (currentContext.invocationId !== context.invocationId || currentContext.contextDigest !== context.contextDigest) throw new TypeError("Writer output crossed its immutable Context");
    const value = record(output, "Writer output"); exact(value, ["materialAssertions"], "Writer output"); const rawAssertions = value["materialAssertions"];
    if (!Array.isArray(rawAssertions) || rawAssertions.length < 1 || rawAssertions.length > 8) throw new TypeError("Writer output requires one to eight material assertions");
    const seen = new Set<string>(); const manifest = Object.freeze(rawAssertions.map((raw, index): MaterialAssertion => {
      const item = record(raw, `material assertion ${index}`); exact(item, ["basisEntryId", "statement"], `material assertion ${index}`); const text = statement(item["statement"]); const basisEntryId = parseBoardEntryId(item["basisEntryId"]); if (seen.has(text)) throw new TypeError("material assertions must be unique"); seen.add(text);
      const accepted = evidence.get(basisEntryId); let basis: AssertionBasis;
      if (accepted !== undefined) { if (text !== accepted.content) throw new TypeError("accepted Evidence assertion must exactly reproduce its sealed source content"); basis = Object.freeze({ kind: "ACCEPTED_EVIDENCE", entryId: basisEntryId, contentDigest: accepted.contentDigest }); }
      else if (verifiedBasis !== undefined && basisEntryId === verifiedBasis.entryId) { if (text !== verifiedBasis.statement) throw new TypeError("verified assertion must exactly reproduce its reviewed target"); basis = Object.freeze({ kind: "NON_ISSUE_REVIEWER_VERIFICATION", entryId: basisEntryId, contentDigest: verifiedBasis.contentDigest }); }
      else throw new TypeError("material assertion basis is missing, stale, candidate, failed, inconclusive, or issue-bearing");
      return Object.freeze({ ordinal: index + 1, statement: text, basis });
    }));
    const contentMarkdown = `${manifest.map((item) => `- ${item.statement}`).join("\n")}\n`; const contentDigest = digest(contentMarkdown); const manifestDigest = digest(manifest); const artifactDigest = digest({ contentDigest, manifestDigest }); const artifactId = deriveArtifactId({ caseId: context.caseId, workflowRunId: context.workflowRunId });
    const carrier: WriterArtifactCarrier = Object.freeze({ artifactId, artifactRevision: 1, contentMarkdown, contentDigest, materialAssertions: manifest, manifestDigest, artifactDigest, reviewerHandoffId: h1.handoffId, reviewerResultId: h1.resultId, reviewerHandoff: h1 });
    const bases = Object.freeze(manifest.map((item) => item.basis.entryId)); const evidenceBases = Object.freeze(manifest.filter((item) => item.basis.kind === "ACCEPTED_EVIDENCE").map((item) => item.basis.entryId));
    const payload = Object.freeze({ artifactId, artifactRevision: 1, artifactDigest, contentDigest, manifestDigest, materialAssertions: manifest, reviewerHandoffId: h1.handoffId });
    return Object.freeze({ writerArtifact: carrier as unknown as Readonly<Record<string, unknown>>, boardEntries: Object.freeze([{ entryType: "ArtifactRef" as const, payload, basedOn: bases, sourceRefs: evidenceBases }]), handoff: Object.freeze({ kind: WRITER_ARTIFACT_HANDOFF_KIND, version: WRITER_ARTIFACT_HANDOFF_VERSION, payload: Object.freeze({ artifactId, artifactRevision: 1, artifactDigest, contentDigest, manifestDigest, reviewerHandoffId: h1.handoffId }) }) });
  } });
}

function parseCarrier(value: unknown, context: PreparedProfileInvocation): WriterArtifactCarrier {
  const raw = record(value, "Writer Artifact materialization"); exact(raw, ["artifactDigest", "artifactId", "artifactRevision", "contentDigest", "contentMarkdown", "manifestDigest", "materialAssertions", "reviewerHandoff", "reviewerHandoffId", "reviewerResultId"], "Writer Artifact materialization");
  const artifactId = parseArtifactId(raw["artifactId"]); if (artifactId !== deriveArtifactId({ caseId: context.caseId, workflowRunId: context.workflowRunId }) || raw["artifactRevision"] !== 1) throw new TypeError("Writer Artifact identity or revision is invalid");
  const contentMarkdown = String(raw["contentMarkdown"]); const contentDigest = hex(raw["contentDigest"], "Artifact content digest"); const manifestDigest = hex(raw["manifestDigest"], "Artifact manifest digest"); const artifactDigest = hex(raw["artifactDigest"], "Artifact digest"); const reviewerHandoffId = String(raw["reviewerHandoffId"]); const reviewerResultId = raw["reviewerResultId"] as ResultId; const reviewerHandoff = record(raw["reviewerHandoff"], "Writer Artifact Reviewer H1") as unknown as ReviewerDispositionHandoff;
  if (!/^handoff_[0-9a-f]{64}$/u.test(reviewerHandoffId) || typeof reviewerResultId !== "string" || !/^result_[0-9a-f]{64}$/u.test(reviewerResultId) || !Array.isArray(raw["materialAssertions"]) || raw["materialAssertions"].length < 1 || raw["materialAssertions"].length > 8) throw new TypeError("Writer Artifact H1 or manifest is invalid");
  const seen = new Set<string>(); const materialAssertions = Object.freeze(raw["materialAssertions"].map((value, index): MaterialAssertion => { const item = record(value, `persisted material assertion ${index}`); exact(item, ["basis", "ordinal", "statement"], `persisted material assertion ${index}`); const basis = record(item["basis"], `persisted material assertion ${index} basis`); exact(basis, ["contentDigest", "entryId", "kind"], `persisted material assertion ${index} basis`); const text = statement(item["statement"]); const entryId = parseBoardEntryId(basis["entryId"]); const kind = basis["kind"]; if ((kind !== "ACCEPTED_EVIDENCE" && kind !== "NON_ISSUE_REVIEWER_VERIFICATION") || item["ordinal"] !== index + 1 || seen.has(text)) throw new TypeError("persisted material assertion is invalid"); seen.add(text); return Object.freeze({ ordinal: index + 1, statement: text, basis: Object.freeze({ kind, entryId, contentDigest: hex(basis["contentDigest"], "material assertion basis digest") }) }); }));
  if (contentMarkdown !== `${materialAssertions.map((item) => `- ${item.statement}`).join("\n")}\n` || contentDigest !== digest(contentMarkdown) || manifestDigest !== digest(materialAssertions) || artifactDigest !== digest({ contentDigest, manifestDigest })) throw new TypeError("Writer Artifact content or manifest digest is invalid");
  return Object.freeze({ artifactId, artifactRevision: 1, contentMarkdown, contentDigest, materialAssertions, manifestDigest, artifactDigest, reviewerHandoffId, reviewerResultId, reviewerHandoff });
}

function assertArtifactEligibility(database: DatabaseSync, context: PreparedProfileInvocation, artifact: WriterArtifactCarrier, authoritativeH1: ReviewerDispositionHandoff): void {
  if (artifact.reviewerResultId !== authoritativeH1.resultId || artifact.reviewerHandoffId !== authoritativeH1.handoffId || json(artifact.reviewerHandoff) !== json(authoritativeH1) || authoritativeH1.caseId !== context.caseId || authoritativeH1.workflowRunId !== context.workflowRunId || authoritativeH1.boardId !== context.boardId) throw new TypeError("Writer Artifact does not bind the exact durable H1");
  assertWriterTargetAuthorization(database, context, authoritativeH1);
  const evidence = acceptedEvidence(database, context);
  for (const assertion of artifact.materialAssertions) {
    if (assertion.basis.kind === "ACCEPTED_EVIDENCE") { const accepted = evidence.get(assertion.basis.entryId); if (accepted === undefined || accepted.contentDigest !== assertion.basis.contentDigest || accepted.content !== assertion.statement) throw new TypeError("Writer Artifact contains an ineligible Evidence assertion"); continue; }
    const verification = context.entries.find((entry) => entry.id === assertion.basis.entryId && entry.digest === assertion.basis.contentDigest && entry.type === "VerificationResult");
    if (verification === undefined) throw new TypeError("Writer Artifact contains a missing Reviewer verification"); const verificationPayload = record(verification.payload, "Writer Reviewer verification"); const target = record(verificationPayload["target"], "Writer Reviewer target");
    if (verificationPayload["result"] !== "PASS" || verificationPayload["disposition"] !== "SUPPORTED" || typeof target["entryId"] !== "string" || typeof target["digest"] !== "string") throw new TypeError("Writer Artifact contains a failed or inconclusive Reviewer verification");
    const targetEntry = context.entries.find((entry) => entry.id === target["entryId"] && entry.digest === target["digest"] && entry.type === "Proposal"); const targetStatement = targetEntry?.payload["action"];
    const pair = database.prepare(`SELECT critique.payload_json FROM runtime_result_entries verification_link JOIN runtime_result_entries critique_link ON critique_link.result_id = verification_link.result_id JOIN board_entries critique ON critique.board_entry_id = critique_link.board_entry_id AND critique.entry_type = 'Critique' WHERE verification_link.result_id = ? AND verification_link.board_entry_id = ?`).get(artifact.reviewerResultId, assertion.basis.entryId) as Row | undefined;
    const critique = pair === undefined ? undefined : record(JSON.parse(String(pair["payload_json"])), "Writer Reviewer Critique");
    if (targetEntry === undefined || targetStatement !== assertion.statement || critique?.["issue"] !== "NONE" || critique["severity"] !== "NONE" || critique["disposition"] !== "SUPPORTED" || json(critique["target"]) !== json(target)) throw new TypeError("Writer Artifact contains an unresolved material Critique");
  }
}

/** Validates the concrete Writer-only Artifact authority carried by one winner. */
export function parseWriterArtifactAuthority(database: DatabaseSync, context: PreparedProfileInvocation, materialization: DurableGenericMaterialization, authoritativeH1: ReviewerDispositionHandoff): WriterArtifactCarrier {
  if (materialization.schemaVersion !== "accord.runtime-generic-materialization/v2" || context.profile !== "WRITER" || materialization.profile !== "WRITER" || materialization.writerArtifact === undefined || materialization.boardEntries.length !== 1 || materialization.boardEntries[0]?.entryType !== "ArtifactRef" || materialization.handoff === undefined) throw new TypeError("Writer winner must contain exactly one versioned Artifact, ArtifactRef, and H2");
  const artifact = parseCarrier(materialization.writerArtifact, context); assertArtifactEligibility(database, context, artifact, authoritativeH1); const ref = materialization.boardEntries[0]; const expectedPayload = { artifactId: artifact.artifactId, artifactRevision: 1, artifactDigest: artifact.artifactDigest, contentDigest: artifact.contentDigest, manifestDigest: artifact.manifestDigest, materialAssertions: artifact.materialAssertions, reviewerHandoffId: artifact.reviewerHandoffId };
  const expectedHandoff = { artifactId: artifact.artifactId, artifactRevision: 1, artifactDigest: artifact.artifactDigest, contentDigest: artifact.contentDigest, manifestDigest: artifact.manifestDigest, reviewerHandoffId: artifact.reviewerHandoffId };
  if (json(ref.payload) !== json(expectedPayload) || materialization.handoff.kind !== WRITER_ARTIFACT_HANDOFF_KIND || materialization.handoff.version !== WRITER_ARTIFACT_HANDOFF_VERSION || json(materialization.handoff.payload) !== json(expectedHandoff) || materialization.handoff.boardEntries.length !== 1 || materialization.handoff.boardEntries[0]?.entryId !== ref.entryId || materialization.handoff.boardEntries[0]?.contentDigest !== ref.contentDigest) throw new TypeError("Writer ArtifactRef or H2 does not exactly correspond to its Artifact");
  return artifact;
}

/** Persists a validated Writer carrier inside the existing Runtime winner transaction. */
export function persistWriterArtifact(database: DatabaseSync, context: PreparedProfileInvocation, resultId: ResultId, materialization: DurableGenericMaterialization, authoritativeH1: ReviewerDispositionHandoff, createdAt: string): void {
  const artifact = parseWriterArtifactAuthority(database, context, materialization, authoritativeH1);
  database.prepare(`INSERT INTO artifacts (artifact_id, artifact_revision, schema_version, case_id, workflow_run_id, board_id, source_invocation_id, source_result_id, reviewer_result_id, reviewer_handoff_id, reviewer_handoff_json, content_markdown, content_digest, material_assertions_json, manifest_digest, artifact_digest, created_board_revision, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(artifact.artifactId, ARTIFACT_SCHEMA_VERSION, context.caseId, context.workflowRunId, context.boardId, context.invocationId, resultId, artifact.reviewerResultId, artifact.reviewerHandoffId, json(artifact.reviewerHandoff), artifact.contentMarkdown, artifact.contentDigest, json(artifact.materialAssertions), artifact.manifestDigest, artifact.artifactDigest, materialization.batchRevision, createdAt);
}
