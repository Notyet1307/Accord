import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mock } from "node:test";

import { PROFILE_CONTEXT_REQUEST_VERSION, type ProfileContextDecision } from "../../src/contracts/profile-context.js";
import type { ReviewerDispositionOutput, ReviewerTargetRef } from "../../src/contracts/reviewer-disposition.js";
import type { ReviewerHandoffTarget } from "../../src/contracts/researcher-analyst-handoff.js";
import { generateR003ResearcherAnalystHandoff } from "../../src/contracts/researcher-analyst-handoff.js";
import { deriveSourceId, parseBoardEntryId, parseInvocationId, type CaseId } from "../../src/core/ids.js";
import { MagicChatProtocolAdapter, type MagicChatRequestEnvelope } from "../../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { createReviewerDispositionContract, parseReviewerDispositionHandoff } from "../../src/reviewer-disposition.js";
import { decideProfileContextAccess } from "../../src/reviewer-context.js";
import { reconstructGenericWinnerMaterialization, reconstructPreparedProfileInvocation } from "../../src/researcher-analyst.js";
import { createWriterArtifactContract } from "../../src/writer-artifact.js";

const NOW = "2026-08-26T00:02:04.000Z";
const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
const metadata = (requestId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId: `${requestId}-response` });
const wire = (output: unknown, requestId: string, receivedAt: string): string => JSON.stringify({ providerMetadata: metadata(requestId), output, receivedAt, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
const sleep = (milliseconds: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); };
const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const setWorkerTime = (instant: string): void => { mock.timers.setTime(Date.parse(instant)); };
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}
function waitFor(path: string, timeout = 10_000): Record<string, unknown> {
  const deadline = performance.now() + timeout;
  while (!existsSync(path)) {
    if (performance.now() >= deadline) throw new Error(`C4 IPC timeout: ${path}`);
    sleep(10);
  }
  return readJson(path);
}
function requestId(value: unknown): string {
  if (value === null || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") throw new TypeError("C4 request id missing");
  return value.id;
}
function researcherWire(invocation: { entries: readonly { id: string; type: string }[] }): string {
  const observation = invocation.entries.find((entry) => entry.type === "Observation");
  if (observation === undefined) throw new Error("C4 Observation missing");
  return JSON.stringify({ providerMetadata: metadata("c4-researcher"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
}
function analystWire(invocation: { entries: readonly { id: string; type: string }[] }): string {
  const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef");
  if (evidence === undefined) throw new Error("C4 EvidenceRef missing");
  return JSON.stringify({ providerMetadata: metadata("c4-analyst"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } });
}
function reviewerOutput(target: ReviewerHandoffTarget): ReviewerDispositionOutput {
  const reference: ReviewerTargetRef = { entryId: target.proposalId, type: "Proposal", digest: target.proposalDigest };
  return { critique: { target: reference, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal must not become evidence." }, verificationResult: { target: reference, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale: "The unsupported proposal has no evidence." } };
}
function writerOutput(entryId: string): Readonly<{ materialAssertions: readonly [{ statement: string; basisEntryId: string }] }> {
  return { materialAssertions: [{ statement: source.content, basisEntryId: entryId }] };
}
function holdW1(path: string, caseId: CaseId, barrierPath: string): never {
  const authority = openAuthorityDatabase(path);
  const researcher = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  const attempt = authority.beginPreparedAttempt(researcher.invocationId, "2026-08-26T00:01:02.000Z");
  writeJson(barrierPath, { pid: process.pid, invocationId: researcher.invocationId, attemptId: attempt.attemptId, state: "PROVIDER_CALL_ACCEPTED_WITHOUT_COMPLETION" });
  while (true) sleep(1_000);
}
async function completeProfiles(path: string, caseId: CaseId, invocationId: string): Promise<void> {
  const authority = openAuthorityDatabase(path);
  try {
    const database = new DatabaseSync(path);
    const researcher = reconstructPreparedProfileInvocation(database, parseInvocationId(invocationId));
    database.close();
    setWorkerTime("2026-08-26T00:01:03.000Z");
    await authority.executePreparedAttempt(researcher, { complete: () => researcherWire(researcher) }, "2026-08-26T00:01:03.000Z");
    setWorkerTime("2026-08-26T00:01:04.000Z");
    const analyst = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" });
    setWorkerTime("2026-08-26T00:01:05.000Z");
    await authority.executePreparedAttempt(analyst, { complete: () => analystWire(analyst) }, "2026-08-26T00:01:04.000Z");
    setWorkerTime("2026-08-26T00:01:06.000Z");
    const reviewer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:06.000Z", profile: "REVIEWER" });
    const targetDatabase = new DatabaseSync(path);
    let target: ReviewerHandoffTarget;
    try { target = generateR003ResearcherAnalystHandoff(targetDatabase, caseId).reviewerTarget; } finally { targetDatabase.close(); }
    const decisionDatabase = new DatabaseSync(path);
    let decision: ProfileContextDecision;
    try {
      decision = decideProfileContextAccess(decisionDatabase, { schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId: "c4-context", requestTime: NOW, operation: "READ_CONTEXT", caseId, workflowRunId: reviewer.workflowRunId, boardId: reviewer.boardId, boardRevision: reviewer.boardRevision, workflowRevision: reviewer.workflowRevision, profile: "REVIEWER", context: { invocationId: reviewer.invocationId, contextId: reviewer.contextId, contextDigest: reviewer.contextDigest }, target, requestedEntry: null });
    } finally { decisionDatabase.close(); }
    if (decision.outcome !== "ALLOW" || decision.reason !== "CURRENT_CONTEXT" || decision.value === null || decision.value.kind !== "REVIEWER_CONTEXT") throw new Error("C4 Reviewer Context denied");
    setWorkerTime("2026-08-26T00:01:07.000Z");
    await authority.executePreparedAttempt(reviewer, { outputContract: createReviewerDispositionContract(reviewer, decision), complete: () => wire(reviewerOutput(target), "c4-reviewer", "2026-08-26T00:01:07.000Z") }, "2026-08-26T00:01:06.000Z");
    const candidateDatabase = new DatabaseSync(path);
    const candidate = candidateDatabase.prepare("SELECT board_entry_id FROM board_entries WHERE case_id = ? AND entry_type = 'EvidenceRef' AND status = 'CANDIDATE'").get(caseId) as Record<string, unknown> | undefined;
    candidateDatabase.close();
    if (candidate === undefined) throw new Error("C4 EvidenceRef candidate missing");
    const accepted = authority.acceptSyntheticEvidence(parseBoardEntryId(candidate["board_entry_id"]), "2026-08-26T00:01:09.000Z");
    setWorkerTime("2026-08-26T00:01:11.000Z");
    const writer = authority.prepareProfileInvocation({ caseId, modelId: "fixture-model", now: "2026-08-26T00:01:11.000Z", profile: "WRITER" });
    const writerDatabase = new DatabaseSync(path);
    try {
      const reviewerMaterialization = reconstructGenericWinnerMaterialization(writerDatabase, reviewer.invocationId);
      if (reviewerMaterialization === undefined) throw new Error("C4 Reviewer materialization missing");
      const writerContract = createWriterArtifactContract(writerDatabase, writer, parseReviewerDispositionHandoff(reviewerMaterialization));
      setWorkerTime("2026-08-26T00:01:12.000Z");
      await authority.executePreparedAttempt(writer, { outputContract: writerContract, complete: () => wire(writerOutput(accepted.entryId), "c4-writer", "2026-08-26T00:01:12.000Z") }, "2026-08-26T00:01:11.000Z");
    } finally { writerDatabase.close(); }
  } finally { authority.close(); }
}
function dispatchAndHold(path: string, appId: string, requestPath: string, barrierPath: string): never {
  const authority = openAuthorityDatabase(path);
  const protocol = new MagicChatProtocolAdapter(authority, appId);
  const pending = protocol.pendingRequests().find((item) => item.request.method === "message.send");
  if (pending === undefined) throw new Error("C4 publication request missing");
  protocol.dispatch(pending.request.id, NOW, (request: MagicChatRequestEnvelope) => {
    writeJson(requestPath, { request, requestDigest: digest(request) });
    waitFor(`${requestPath}.accepted`);
    writeJson(barrierPath, { requestId: request.id, pid: process.pid, state: "EXTERNAL_ACCEPTED_BEFORE_CONFIRMATION" });
    while (true) sleep(1_000);
  });
  throw new Error("C4 hold unexpectedly returned");
}
async function resumeW2(path: string, appId: string, caseId: CaseId, requestPath: string, resultPath: string): Promise<void> {
  const authority = openAuthorityDatabase(path);
  try {
    const protocol = new MagicChatProtocolAdapter(authority, appId);
    const pending = protocol.pendingRequests().find((item) => item.request.method === "message.send");
    if (pending === undefined) throw new Error("C4 recovery publication request missing");
    const response = protocol.dispatch(pending.request.id, NOW, (request: MagicChatRequestEnvelope) => {
      writeJson(requestPath, { request, requestDigest: digest(request), pid: process.pid });
      return waitFor(`${requestPath}.response`);
    });
    const received = protocol.receive(response, NOW);
    writeJson(resultPath, { caseId, requestId: requestId(response), responseDigest: digest(response), workflowState: received.snapshot.workflowState, visibleConfirmation: true });
  } finally { authority.close(); }
}
async function resumeW1(path: string, caseId: CaseId, invocationId: string, resultPath: string): Promise<void> {
  await completeProfiles(path, caseId, invocationId);
  writeJson(resultPath, { caseId, invocationId, pid: process.pid, state: "PROFILES_COMPLETE" });
}
async function main(): Promise<void> {
  const mode = process.argv[2];
  const clock = mode === "hold-w1" ? "2026-08-26T00:01:02.000Z" : mode === "resume-w1" ? "2026-08-26T00:01:03.000Z" : NOW;
  mock.timers.enable({ apis: ["Date"], now: Date.parse(clock) });
  if (mode === "hold-w1") { holdW1(process.argv[3]!, process.argv[4] as CaseId, process.argv[5]!); return; }
  if (mode === "resume-w1") { await resumeW1(process.argv[3]!, process.argv[4] as CaseId, process.argv[5]!, process.argv[6]!); return; }
  if (mode === "hold-publication") { dispatchAndHold(process.argv[3]!, process.argv[4]!, process.argv[5]!, process.argv[6]!); return; }
  if (mode === "resume-publication") { await resumeW2(process.argv[3]!, process.argv[4]!, process.argv[5] as CaseId, process.argv[6]!, process.argv[7]!); return; }
  throw new Error(`Unknown C4 worker mode: ${mode ?? "missing"}`);
}
main().catch((error: unknown) => { try { writeJson(process.argv.at(-1) ?? "/tmp/accord-c4-worker-error.json", { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "worker failed" }); } catch {} process.exitCode = 1; });
