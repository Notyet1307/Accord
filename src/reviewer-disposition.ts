import {
  PROFILE_CONTEXT_DECISION_VERSION,
  PROFILE_CONTEXT_VIEW_VERSION,
  type ProfileContextDecision,
  type ProjectedProfileContextEntry,
  type ReviewerContextView,
} from "./contracts/profile-context.js";
import {
  REVIEWER_DISPOSITION_HANDOFF_KIND,
  REVIEWER_DISPOSITION_HANDOFF_VERSION,
  type ReviewerCritiqueIssue,
  type ReviewerCritiqueOutput,
  type ReviewerCritiqueSeverity,
  type ReviewerDisposition,
  type ReviewerDispositionHandoff,
  type ReviewerTargetRef,
  type ReviewerVerificationOutput,
  type ReviewerVerificationStatus,
} from "./contracts/reviewer-disposition.js";
import {
  parseAttemptId,
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseContextId,
  parseInvocationId,
  parseResultId,
  parseSourceId,
  parseWorkflowRunId,
  type BoardEntryId,
} from "./core/ids.js";
import { REVIEWER_OUTPUT_SCHEMA, REVIEWER_PROFILE_VERSION } from "./profile-context.js";
import {
  GENERIC_MATERIALIZATION_SCHEMA_VERSION,
  type DurableGenericMaterialization,
  type HandoffId,
  type InvocationBoundOutputContract,
} from "./profile-runtime.js";
import type { PreparedProfileInvocation } from "./researcher-analyst.js";

const DISPOSITIONS: Record<ReviewerDisposition, Readonly<{
  issue: ReviewerCritiqueIssue;
  severity: ReviewerCritiqueSeverity;
  result: ReviewerVerificationStatus;
}>> = {
  SUPPORTED: { issue: "NONE", severity: "NONE", result: "PASS" },
  ISSUE_UNSUPPORTED: { issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", result: "FAIL" },
  ISSUE_CONTRADICTORY: { issue: "CONTRADICTORY_MATERIAL", severity: "MATERIAL", result: "FAIL" },
  ISSUE_INCONCLUSIVE: { issue: "INCONCLUSIVE_VERIFICATION", severity: "MATERIAL", result: "INCONCLUSIVE" },
};
const HANDOFF_ID = /^handoff_[0-9a-f]{64}$/u;

type Row = Record<string, unknown>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))]));
  return value;
}
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function record(value: unknown, label: string): Row { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Row; }
function exact(value: Row, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an unsupported or missing field`); }
function scalar(value: unknown, label: string, max = 4_096): string { if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /[\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError(`${label} must be a bounded trimmed string`); return value; }
function digest(value: unknown, label: string): string { const result = scalar(value, label, 64); if (!/^[0-9a-f]{64}$/u.test(result)) throw new TypeError(`${label} must be a SHA-256 digest`); return result; }
function integer(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} must be a positive safe integer`); return value as number; }
function same(left: unknown, right: unknown, label: string): void { if (json(left) !== json(right)) throw new TypeError(`${label} does not match its authority`); }

function targetRef(value: unknown, label: string): ReviewerTargetRef {
  const item = record(value, label); exact(item, ["entryId", "type", "digest"], label);
  if (item["type"] !== "Proposal") throw new TypeError(`${label}.type must be Proposal`);
  return freeze({ entryId: parseBoardEntryId(item["entryId"]), type: "Proposal", digest: digest(item["digest"], `${label}.digest`) });
}
function critique(value: unknown): ReviewerCritiqueOutput {
  const item = record(value, "Critique"); exact(item, ["target", "issue", "severity", "disposition", "rationale"], "Critique");
  const disposition = item["disposition"] as ReviewerDisposition;
  if (!Object.hasOwn(DISPOSITIONS, disposition)) throw new TypeError("Critique disposition is unsupported");
  const issue = item["issue"] as ReviewerCritiqueIssue; const severity = item["severity"] as ReviewerCritiqueSeverity;
  if (!["NONE", "UNSUPPORTED_MATERIAL", "CONTRADICTORY_MATERIAL", "INCONCLUSIVE_VERIFICATION"].includes(issue) || severity !== "NONE" && severity !== "MATERIAL") throw new TypeError("Critique issue or severity is unsupported");
  return freeze({ target: targetRef(item["target"], "Critique.target"), issue, severity, disposition, rationale: scalar(item["rationale"], "Critique.rationale") });
}
function verification(value: unknown): ReviewerVerificationOutput {
  const item = record(value, "VerificationResult"); exact(item, ["target", "method", "result", "supportingEvidenceRefs", "disposition", "rationale"], "VerificationResult");
  const disposition = item["disposition"] as ReviewerDisposition; const result = item["result"] as ReviewerVerificationStatus;
  if (!Object.hasOwn(DISPOSITIONS, disposition) || item["method"] !== "CITED_GRAPH_SUPPORT" || result !== "PASS" && result !== "FAIL" && result !== "INCONCLUSIVE") throw new TypeError("VerificationResult contract is unsupported");
  if (!Array.isArray(item["supportingEvidenceRefs"]) || item["supportingEvidenceRefs"].length > 16) throw new TypeError("supportingEvidenceRefs must be bounded");
  const refs = item["supportingEvidenceRefs"].map(parseBoardEntryId);
  if (new Set(refs).size !== refs.length) throw new TypeError("supportingEvidenceRefs must be unique");
  return freeze({ target: targetRef(item["target"], "VerificationResult.target"), method: "CITED_GRAPH_SUPPORT", result, supportingEvidenceRefs: freeze(refs), disposition, rationale: scalar(item["rationale"], "VerificationResult.rationale") });
}
function validatePair(left: ReviewerCritiqueOutput, right: ReviewerVerificationOutput, expectedTarget?: ReviewerTargetRef, evidence?: ReadonlySet<BoardEntryId>): void {
  const mapping = DISPOSITIONS[left.disposition];
  if (right.disposition !== left.disposition || left.issue !== mapping.issue || left.severity !== mapping.severity || right.result !== mapping.result) throw new TypeError("Reviewer disposition mapping is inconsistent");
  same(left.target, right.target, "Reviewer output target");
  if (expectedTarget !== undefined) same(left.target, expectedTarget, "Reviewer output target");
  if (evidence !== undefined && right.supportingEvidenceRefs.some((id) => !evidence.has(id))) throw new TypeError("VerificationResult cites EvidenceRef outside the complete Reviewer graph");
}

function normalizeView(decisionValue: ProfileContextDecision): ReviewerContextView {
  const decision = record(decisionValue, "C03 decision");
  exact(decision, ["schemaVersion", "auditEventId", "correlationId", "requestId", "requestFingerprint", "requestTime", "operation", "outcome", "reason", "value"], "C03 decision");
  if (decision["schemaVersion"] !== PROFILE_CONTEXT_DECISION_VERSION || decision["operation"] !== "READ_CONTEXT" || decision["outcome"] !== "ALLOW" || decision["reason"] !== "CURRENT_CONTEXT") throw new TypeError("C04 requires one C03 ALLOW/CURRENT_CONTEXT decision");
  scalar(decision["auditEventId"], "C03 auditEventId", 80); scalar(decision["correlationId"], "C03 correlationId", 80); digest(decision["requestFingerprint"], "C03 requestFingerprint");
  const view = record(decision["value"], "Reviewer Context view");
  exact(view, ["schemaVersion", "kind", "caseId", "workflowRunId", "boardId", "boardRevision", "workflowRevision", "profile", "profileVersion", "outputSchema", "context", "target", "entries"], "Reviewer Context view");
  if (view["schemaVersion"] !== PROFILE_CONTEXT_VIEW_VERSION || view["kind"] !== "REVIEWER_CONTEXT" || view["profile"] !== "REVIEWER" || view["profileVersion"] !== REVIEWER_PROFILE_VERSION || view["outputSchema"] !== REVIEWER_OUTPUT_SCHEMA || !Array.isArray(view["entries"])) throw new TypeError("C03 decision is not the fixed Reviewer Context");
  const context = record(view["context"], "Reviewer Context identity"); exact(context, ["invocationId", "contextId", "contextDigest"], "Reviewer Context identity");
  const target = record(view["target"], "Reviewer target"); exact(target, ["boardId", "caseId", "invocationId", "proposalBoardRevision", "proposalDigest", "proposalId", "resultId", "runId", "supportStatus", "workflowNode"], "Reviewer target");
  if (target["supportStatus"] !== "UNSUPPORTED" || target["workflowNode"] !== "REVIEWER") throw new TypeError("Reviewer target contract is invalid");
  const entries = view["entries"].map((value, index) => {
    const entry = record(value, `Reviewer Context entry ${index}`); exact(entry, ["kind", "id", "type", "digest", "payload", "basedOn", "sourceRefs"], `Reviewer Context entry ${index}`);
    if (entry["kind"] !== "BOARD_ENTRY" || !["Proposal", "Claim", "Observation", "EvidenceRef", "Critique", "VerificationResult"].includes(String(entry["type"])) || !Array.isArray(entry["basedOn"]) || !Array.isArray(entry["sourceRefs"]) || entry["basedOn"].length > 16 || entry["sourceRefs"].length > 16) throw new TypeError(`Reviewer Context entry ${index} is invalid`);
    const type = entry["type"] as ProjectedProfileContextEntry["type"];
    const basedOn = entry["basedOn"].map(parseBoardEntryId);
    const sourceRefs = entry["sourceRefs"].map((ref) => type === "EvidenceRef" ? parseSourceId(ref) : parseBoardEntryId(ref));
    if (new Set([...basedOn, ...sourceRefs]).size !== basedOn.length + sourceRefs.length || type === "EvidenceRef" && (basedOn.length !== 0 || sourceRefs.length === 0)) throw new TypeError(`Reviewer Context entry ${index} relations are invalid`);
    return freeze({ kind: "BOARD_ENTRY" as const, id: parseBoardEntryId(entry["id"]), type, digest: digest(entry["digest"], `Reviewer Context entry ${index}.digest`), payload: freeze(canonical(record(entry["payload"], `Reviewer Context entry ${index}.payload`)) as Row), basedOn: freeze(basedOn), sourceRefs: freeze(sourceRefs) });
  });
  return freeze({ schemaVersion: PROFILE_CONTEXT_VIEW_VERSION, kind: "REVIEWER_CONTEXT", profile: "REVIEWER", profileVersion: REVIEWER_PROFILE_VERSION, outputSchema: REVIEWER_OUTPUT_SCHEMA, caseId: parseCaseId(view["caseId"]), workflowRunId: parseWorkflowRunId(view["workflowRunId"]), boardId: parseBoardId(view["boardId"]), boardRevision: integer(view["boardRevision"], "Reviewer boardRevision"), workflowRevision: integer(view["workflowRevision"], "Reviewer workflowRevision"), context: freeze({ invocationId: parseInvocationId(context["invocationId"]), contextId: parseContextId(context["contextId"]), contextDigest: digest(context["contextDigest"], "Reviewer contextDigest") }), target: freeze({ boardId: parseBoardId(target["boardId"]), caseId: parseCaseId(target["caseId"]), invocationId: parseInvocationId(target["invocationId"]), proposalBoardRevision: integer(target["proposalBoardRevision"], "target proposalBoardRevision"), proposalDigest: digest(target["proposalDigest"], "target proposalDigest"), proposalId: parseBoardEntryId(target["proposalId"]), resultId: parseResultId(target["resultId"]), runId: parseWorkflowRunId(target["runId"]), supportStatus: "UNSUPPORTED", workflowNode: "REVIEWER" }), entries: freeze(entries) });
}

function bindView(prepared: PreparedProfileInvocation, view: ReviewerContextView): ReadonlySet<BoardEntryId> {
  if (prepared.profile !== "REVIEWER" || prepared.profileVersion !== REVIEWER_PROFILE_VERSION || prepared.outputSchema !== REVIEWER_OUTPUT_SCHEMA || view.caseId !== prepared.caseId || view.workflowRunId !== prepared.workflowRunId || view.boardId !== prepared.boardId || view.boardRevision !== prepared.boardRevision || view.workflowRevision !== prepared.workflowRevision || view.context.invocationId !== prepared.invocationId || view.context.contextId !== prepared.contextId || view.context.contextDigest !== prepared.contextDigest) throw new TypeError("Reviewer Context is not bound to the canonical Prepared Invocation");
  if (view.target.caseId !== prepared.caseId || view.target.runId !== prepared.workflowRunId || view.target.boardId !== prepared.boardId || view.target.proposalBoardRevision > prepared.boardRevision) throw new TypeError("Reviewer target is outside the Prepared Invocation");
  const preparedById = new Map(prepared.entries.map((entry) => [entry.id, entry])); const byId = new Map<BoardEntryId, ProjectedProfileContextEntry>();
  for (const entry of view.entries) { const persisted = preparedById.get(entry.id); if (byId.has(entry.id) || persisted === undefined || persisted.type !== entry.type || persisted.digest !== entry.digest || json(persisted.payload) !== json(entry.payload)) throw new TypeError("Reviewer Context entry is not in the canonical Prepared Invocation"); byId.set(entry.id, entry); }
  const root = byId.get(view.target.proposalId); const expectedTarget = { entryId: view.target.proposalId, type: "Proposal", digest: view.target.proposalDigest } as const;
  if (root === undefined || root.type !== "Proposal" || root.digest !== view.target.proposalDigest || view.entries[0]?.id !== root.id) throw new TypeError("Reviewer Context lacks its exact target root");
  const closure = new Set<BoardEntryId>(); const visiting = new Set<BoardEntryId>();
  const visit = (entry: ProjectedProfileContextEntry): void => { if (visiting.has(entry.id)) throw new TypeError("Reviewer cited graph is cyclic"); if (closure.has(entry.id)) return; visiting.add(entry.id); for (const [relation, refs] of [["basedOn", entry.basedOn], ["sourceRefs", entry.type === "EvidenceRef" ? [] : entry.sourceRefs]] as const) for (const ref of refs as readonly BoardEntryId[]) { const child = byId.get(ref); const legal = child !== undefined && (relation === "sourceRefs" ? child.type === "EvidenceRef" : entry.type === "Proposal" ? child.type === "Claim" || child.type === "EvidenceRef" : entry.type === "Claim" ? child.type === "EvidenceRef" || child.type === "Observation" : entry.type === "Observation" && child.type === "Observation"); if (!legal || child === undefined) throw new TypeError("Reviewer cited graph is incomplete"); visit(child); } visiting.delete(entry.id); closure.add(entry.id); };
  visit(root);
  for (const entry of view.entries) if (!closure.has(entry.id)) { const payloadTarget = Reflect.get(entry.payload, "target"); if (entry.type !== "Critique" && entry.type !== "VerificationResult" || !entry.basedOn.includes(root.id) || json(payloadTarget) !== json(expectedTarget)) throw new TypeError("Reviewer Context contains an unrelated entry"); }
  return freeze(new Set([...closure].filter((id) => byId.get(id)?.type === "EvidenceRef")));
}

export function createReviewerDispositionContract(preparedInvocation: PreparedProfileInvocation, c03Decision: ProfileContextDecision): InvocationBoundOutputContract {
  const view = normalizeView(c03Decision); const evidence = bindView(preparedInvocation, view); const preparedSnapshot = json(preparedInvocation);
  const expectedTarget = freeze({ entryId: view.target.proposalId, type: "Proposal", digest: view.target.proposalDigest } as const);
  return freeze({ invocationId: preparedInvocation.invocationId, contextDigest: preparedInvocation.contextDigest, profile: "REVIEWER", profileVersion: REVIEWER_PROFILE_VERSION, outputSchema: REVIEWER_OUTPUT_SCHEMA, materialize(context, output) {
    if (json(context) !== preparedSnapshot) throw new TypeError("materialization Prepared Invocation identity or entries changed");
    const value = record(output, "Reviewer output"); exact(value, ["critique", "verificationResult"], "Reviewer output");
    const parsedCritique = critique(value["critique"]); const parsedVerification = verification(value["verificationResult"]); validatePair(parsedCritique, parsedVerification, expectedTarget, evidence);
    return freeze({ boardEntries: freeze([
      freeze({ entryType: "Critique" as const, payload: parsedCritique as unknown as Readonly<Record<string, unknown>>, basedOn: freeze([expectedTarget.entryId]), sourceRefs: freeze([] as BoardEntryId[]) }),
      freeze({ entryType: "VerificationResult" as const, payload: parsedVerification as unknown as Readonly<Record<string, unknown>>, basedOn: freeze([expectedTarget.entryId]), sourceRefs: parsedVerification.supportingEvidenceRefs }),
    ]), handoff: freeze({ kind: REVIEWER_DISPOSITION_HANDOFF_KIND, version: REVIEWER_DISPOSITION_HANDOFF_VERSION, payload: freeze({ target: expectedTarget, disposition: parsedCritique.disposition }) }) });
  } });
}

/** Projects C04 semantics from a materialization already validated by C02. */
export function parseReviewerDispositionHandoff(value: DurableGenericMaterialization): ReviewerDispositionHandoff {
  const materialization = record(value, "Reviewer materialization"); exact(materialization, ["schemaVersion", "profile", "profileVersion", "outputSchema", "contextId", "contextDigest", "invocationId", "attemptId", "resultId", "caseId", "workflowRunId", "boardId", "batchRevision", "boardEntries", "handoff"], "Reviewer materialization");
  if (materialization["schemaVersion"] !== GENERIC_MATERIALIZATION_SCHEMA_VERSION || materialization["profile"] !== "REVIEWER" || materialization["profileVersion"] !== REVIEWER_PROFILE_VERSION || materialization["outputSchema"] !== REVIEWER_OUTPUT_SCHEMA || !Array.isArray(materialization["boardEntries"]) || materialization["boardEntries"].length !== 2) throw new TypeError("Reviewer materialization envelope is invalid");
  const parsedEntries = materialization["boardEntries"].map((raw, index) => { const entry = record(raw, `Reviewer materialization entry ${index}`); exact(entry, ["entryType", "payload", "basedOn", "sourceRefs", "entryId", "contentDigest"], `Reviewer materialization entry ${index}`); if (!Array.isArray(entry["basedOn"]) || !Array.isArray(entry["sourceRefs"])) throw new TypeError("Reviewer materialization relations are invalid"); return { entryType: entry["entryType"], payload: entry["payload"], basedOn: entry["basedOn"].map(parseBoardEntryId), sourceRefs: entry["sourceRefs"].map(parseBoardEntryId), entryId: parseBoardEntryId(entry["entryId"]), contentDigest: digest(entry["contentDigest"], "Reviewer entry contentDigest") }; });
  if (parsedEntries[0]!.entryType !== "Critique" || parsedEntries[1]!.entryType !== "VerificationResult") throw new TypeError("Reviewer materialization must contain Critique then VerificationResult");
  const parsedCritique = critique(parsedEntries[0]!.payload); const parsedVerification = verification(parsedEntries[1]!.payload); validatePair(parsedCritique, parsedVerification);
  if (json(parsedEntries[0]!.basedOn) !== json([parsedCritique.target.entryId]) || parsedEntries[0]!.sourceRefs.length !== 0 || json(parsedEntries[1]!.basedOn) !== json([parsedCritique.target.entryId]) || json(parsedEntries[1]!.sourceRefs) !== json(parsedVerification.supportingEvidenceRefs)) throw new TypeError("Reviewer materialization relations do not match its outputs");
  const handoff = record(materialization["handoff"], "Reviewer H1 handoff"); exact(handoff, ["kind", "version", "payload", "handoffId", "payloadDigest", "boardEntries"], "Reviewer H1 handoff");
  const payload = record(handoff["payload"], "Reviewer H1 payload"); exact(payload, ["target", "disposition"], "Reviewer H1 payload"); const handoffTarget = targetRef(payload["target"], "Reviewer H1 target");
  if (handoff["kind"] !== REVIEWER_DISPOSITION_HANDOFF_KIND || handoff["version"] !== REVIEWER_DISPOSITION_HANDOFF_VERSION || payload["disposition"] !== parsedCritique.disposition) throw new TypeError("Reviewer H1 contract is invalid"); same(handoffTarget, parsedCritique.target, "Reviewer H1 target");
  const links = parsedEntries.map(({ entryId, contentDigest }) => ({ entryId, contentDigest })); if (!Array.isArray(handoff["boardEntries"]) || json(handoff["boardEntries"]) !== json(links)) throw new TypeError("Reviewer H1 links are invalid");
  const caseId = parseCaseId(materialization["caseId"]); const workflowRunId = parseWorkflowRunId(materialization["workflowRunId"]); const boardId = parseBoardId(materialization["boardId"]); const contextId = parseContextId(materialization["contextId"]); const contextDigest = digest(materialization["contextDigest"], "Reviewer materialization contextDigest"); const invocationId = parseInvocationId(materialization["invocationId"]); const attemptId = parseAttemptId(materialization["attemptId"]); const resultId = parseResultId(materialization["resultId"]); const boardRevision = integer(materialization["batchRevision"], "Reviewer materialization batchRevision");
  const handoffId = scalar(handoff["handoffId"], "Reviewer handoffId", 72) as HandoffId; const payloadDigest = digest(handoff["payloadDigest"], "Reviewer H1 payloadDigest");
  if (!HANDOFF_ID.test(handoffId)) throw new TypeError("Reviewer H1 identity is invalid");
  return freeze({ schemaVersion: REVIEWER_DISPOSITION_HANDOFF_VERSION, handoffId, payloadDigest, caseId, workflowRunId, boardId, boardRevision, profile: "REVIEWER", profileVersion: REVIEWER_PROFILE_VERSION, outputSchema: REVIEWER_OUTPUT_SCHEMA, contextId, contextDigest, invocationId, attemptId, resultId, target: handoffTarget, disposition: parsedCritique.disposition, critique: freeze({ entryId: parsedEntries[0]!.entryId, contentDigest: parsedEntries[0]!.contentDigest }), verificationResult: freeze({ entryId: parsedEntries[1]!.entryId, contentDigest: parsedEntries[1]!.contentDigest }) });
}
