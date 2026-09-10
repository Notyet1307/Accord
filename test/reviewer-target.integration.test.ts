import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { FROZEN_RUNTIME_POLICY, REVIEWER_TARGET_POLICY_VERSION, normalizeFrozenRuntimeConfiguration } from "../src/frozen-runtime-config.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import { PROFILE_CONTEXT_REQUEST_VERSION, type ProfileContextDecisionRequest } from "../src/contracts/profile-context.js";
import { generateR003ResearcherAnalystHandoff, type ReviewerHandoffTarget } from "../src/contracts/researcher-analyst-handoff.js";
import { decideProfileContextAccess, projectPreparedProfileTarget } from "../src/reviewer-context.js";
import { createReviewerDispositionContract, parseReviewerDispositionHandoff } from "../src/reviewer-disposition.js";
import { createWriterArtifactContract } from "../src/writer-artifact.js";
import { commitProviderResult, reconstructGenericWinnerMaterialization, reconstructPreparedProfileInvocation, TRUSTED_SYNTHETIC_SOURCE_INPUT, type PreparedProfileInvocation, type AnalystOutput } from "../src/researcher-analyst.js";
import { generateR003CaseTrace } from "../src/case-trace.js";
import { magicChatMessageCreatedEnvelope, magicChatMessageSendSuccessResponse, magicChatAckSuccessResponse, temporaryDatabase } from "./fixture.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 7, 26, 0, 1, seconds)).toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function configuration(manifest: string, v2 = true) {
  const profiles = Object.fromEntries(["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"].map((name) => {
    const instructions = `Run ${name}.`;
    return [name, { modelId: "fixture-model", profileVersion: `accord.${name.toLowerCase()}/${v2 && (name === "REVIEWER" || name === "WRITER") ? "v2" : "v1"}`, outputSchema: `accord.${name.toLowerCase()}-output/v1`, instructions, instructionsDigest: hash(instructions) }];
  }));
  return { schemaVersion: "accord.frozen-runtime-config/v1", configurationId: "f2-fixture", revision: 1,
    magicChat: { endpoint: "wss://chat.example.test/api/app/ws", appId: "00000000-0000-0000-0000-000000000001", credentialRef: "credential-ref:chat", authenticationIdentityRevision: 1, transportVersion: "accord.magicchat-websocket-transport/v1" },
    provider: { endpoint: "https://ai-api-gateway.app.baizhi.cloud/v1/responses", deploymentId: "fixture", credentialRef: "credential-ref:provider", authenticationIdentityRevision: 1, transportVersion: "accord.baizhi-responses-transport/v1" },
    profiles, policy: { ...FROZEN_RUNTIME_POLICY, targetVersion: v2 ? REVIEWER_TARGET_POLICY_VERSION : FROZEN_RUNTIME_POLICY.targetVersion }, sourceManifestDigest: manifest,
    executionWindow: { notBefore: at(0), deadline: at(3600) }, costLimitCny: null };
}
async function fixture(t: TestContext, v2 = true) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(at(0)) });
  const temporary = temporaryDatabase("f2-target");
  let authority = openAuthorityDatabase(temporary.path);
  const raw = new DatabaseSync(temporary.path);
  t.after(() => { raw.close(); authority.close(); temporary.cleanup(); });
  authority.installTrustedSyntheticSourceManifest(at(0));
  const manifest = String(raw.prepare("SELECT manifest_digest FROM approved_synthetic_source_manifests").get()?.["manifest_digest"]);
  const config = configuration(manifest, v2);
  const accepted = authority.acceptRuntimeConfiguration(config, at(0));
  const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
  const created = protocol.receive(magicChatMessageCreatedEnvelope(), at(0)); assert.ok(created.nextRequest);
  const waiting = protocol.receive(magicChatMessageSendSuccessResponse(created.nextRequest.id), at(0)); assert.ok(waiting.nextRequest);
  protocol.receive(magicChatAckSuccessResponse(waiting.nextRequest.id, 1), at(0));
  const resumed = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Two weeks", cursor: 2, envelopeEventId: "event-f2-reply", messageCreatedAt: "2026-08-26T00:01:00Z", messageId: "message-f2-reply", messageSequence: 3, replyToMessageId: "clarification-message-1" }), at(1));
  if (resumed.nextRequest) protocol.receive(magicChatAckSuccessResponse(resumed.nextRequest.id, 2), at(1));
  const caseId = resumed.snapshot.caseId;
  const prepare = (profile: PreparedProfileInvocation["profile"], seconds: number) => authority.prepareConfiguredProfileInvocation({ caseId, profile, now: at(seconds), configuration: accepted.reference });
  const wire = (output: unknown, seconds: number, label: string) => {
    t.mock.timers.setTime(Date.parse(at(seconds)));
    return JSON.stringify({ output, providerMetadata: { deploymentId: "fixture", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1", requestId: label, responseId: `${label}-response` }, receivedAt: at(seconds), usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  };
  const researcher = prepare("RESEARCHER", 2);
  const observation = researcher.entries.find((entry) => entry.type === "Observation"); assert.ok(observation);
  const source = researcher.approvedSources[0]; assert.ok(source);
  const research = { evidenceRefs: [{ sourceId: source.sourceId, sourceKind: source.sourceKind, locator: source.locator, sourceDigest: hash(JSON.stringify(source.content)), observedAt: source.observedAt }], intents: [{ basedOn: [observation.id], objective: "Research", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [source.sourceId], statement: "Two weeks requested." }] };
  assert.equal((await authority.executePreparedAttempt(researcher, { configuration: accepted.reference, instructions: researcher.instructions!, complete: () => wire(research, 3, "research") }, at(2))).outcome, "WINNER");
  const analyst = prepare("ANALYST", 4);
  const evidence = analyst.entries.find((entry) => entry.type === "EvidenceRef"); assert.ok(evidence);
  const analysis = (claim = "客户采用率必然达到百分之百。", proposal = "承诺客户全部采用。", includeSupported = false): AnalystOutput => ({
    claims: [{ statement: "Two weeks supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: claim, supportingEntryIds: [], unsupported: true }],
    proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: proposal, supportStatus: "UNSUPPORTED", supportingClaimIndexes: includeSupported ? [0, 1] : [1] }],
  });
  const commitAnalysis = (output: AnalystOutput) => authority.executePreparedAttempt(analyst, { configuration: accepted.reference, instructions: analyst.instructions!, complete: () => wire(output, 5, "analysis") }, at(4));
  const target = () => generateR003ResearcherAnalystHandoff(raw, caseId).reviewerTarget;
  const reopen = () => { authority.close(); authority = openAuthorityDatabase(temporary.path); };
  return { get authority() { return authority; }, raw, caseId, prepare, wire, analyst, analysis, commitAnalysis, target, reopen, config, evidence, accepted, protocol };
}
function request(prepared: PreparedProfileInvocation, target: ReviewerHandoffTarget, requestId = "f2-context"): ProfileContextDecisionRequest {
  assert.ok(prepared.profile === "REVIEWER" || prepared.profile === "WRITER");
  return { schemaVersion: PROFILE_CONTEXT_REQUEST_VERSION, requestId, requestTime: at(6), operation: "READ_CONTEXT", caseId: prepared.caseId, workflowRunId: prepared.workflowRunId, boardId: prepared.boardId, boardRevision: prepared.boardRevision, workflowRevision: prepared.workflowRevision, profile: prepared.profile, context: { invocationId: prepared.invocationId, contextId: prepared.contextId, contextDigest: prepared.contextDigest }, target, requestedEntry: null };
}
function review(target: ReviewerHandoffTarget) {
  const ref = { entryId: target.proposalId, digest: target.proposalDigest, type: "Proposal" };
  return { critique: { target: ref, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale: "No support for the proposal." }, verificationResult: { target: ref, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale: "Reject the unsupported assertion." } };
}
const countReviewer = (db: DatabaseSync) => db.prepare("SELECT (SELECT count(*) FROM runtime_invocations WHERE node_id = 'REVIEWER') AS invocations, (SELECT count(*) FROM runtime_attempts a JOIN runtime_invocations i ON i.invocation_id = a.invocation_id WHERE i.node_id = 'REVIEWER') AS attempts").get();

for (const [language, claim, proposal] of [["zh", "客户采用率必然达到百分之百。", "承诺客户全部采用。"], ["en", "All customers will adopt the plan.", "Guarantee universal adoption."]]) {
  test(`F2 ${language}: actual winner → least privilege review → Writer → reopen/Trace`, async (t) => {
    const f = await fixture(t);
    assert.equal((await f.commitAnalysis(f.analysis(claim, proposal, true))).outcome, "WINNER");
    const target = f.target();
    const reviewer = f.prepare("REVIEWER", 6);
    assert.equal(reviewer.profileVersion, "accord.reviewer/v2");
    assert.deepEqual(f.prepare("REVIEWER", 6), reviewer);
    const input = request(reviewer, target);
    const decision = decideProfileContextAccess(f.raw, input);
    assert.equal(decision.outcome, "ALLOW"); assert.equal(decision.value?.kind, "REVIEWER_CONTEXT");
    if (decision.value?.kind !== "REVIEWER_CONTEXT") throw new Error("missing view");
    assert.equal(decision.value.entries[0]?.payload["action"], proposal);
    assert.ok(decision.value.entries.some((entry) => entry.type === "EvidenceRef"));
    assert.ok(!decision.value.entries.some((entry) => entry.type === "Proposal" && entry.id !== target.proposalId));
    f.reopen();
    assert.deepEqual(f.target(), target);
    assert.deepEqual(reconstructPreparedProfileInvocation(f.raw, reviewer.invocationId), reviewer);
    assert.deepEqual(decideProfileContextAccess(f.raw, input), decision);
    const outputContract = createReviewerDispositionContract(reviewer, decision);
    const reviewWire = f.wire(review(target), 7, "review");
    const winner = await f.authority.executePreparedAttempt(reviewer, { configuration: f.accepted.reference, instructions: reviewer.instructions!, outputContract, complete: () => reviewWire }, at(6));
    assert.equal(winner.outcome, "WINNER"); assert.ok(winner.materialization);
    const h1 = parseReviewerDispositionHandoff(winner.materialization);
    assert.equal(h1.profileVersion, "accord.reviewer/v2");
    f.reopen();
    const materialization = reconstructGenericWinnerMaterialization(f.raw, reviewer.invocationId); assert.ok(materialization);
    assert.deepEqual(parseReviewerDispositionHandoff(materialization), h1);
    const attempt = f.raw.prepare("SELECT attempt_id FROM runtime_attempts WHERE invocation_id = ?").get(reviewer.invocationId);
    assert.ok(attempt);
    const before = f.raw.prepare("SELECT count(*) AS n FROM board_entries").get();
    let duplicateCalls = 0;
    // A completed Invocation cannot create another physical execution on restart.
    await assert.rejects(() => f.authority.executePreparedAttempt(reviewer, { configuration: f.accepted.reference, instructions: reviewer.instructions!, outputContract, complete: () => { duplicateCalls++; return reviewWire; } }, at(8)));
    assert.equal(duplicateCalls, 0);
    const duplicate = commitProviderResult(f.raw, reviewer, { attemptId: winner.attemptId, attemptNumber: 1, invocationId: reviewer.invocationId, noSdkRetry: true }, reviewWire, undefined, outputContract);
    assert.equal(duplicate.outcome, "DUPLICATE");
    assert.deepEqual(parseReviewerDispositionHandoff(reconstructGenericWinnerMaterialization(f.raw, reviewer.invocationId)!), h1);
    assert.deepEqual(f.raw.prepare("SELECT count(*) AS n FROM board_entries").get(), before);
    const accepted = f.authority.acceptSyntheticEvidence(f.evidence.id, at(9));
    const writer = f.prepare("WRITER", 11);
    assert.equal(writer.profileVersion, "accord.writer/v2");
    const writerContract = createWriterArtifactContract(f.raw, writer, h1);
    assert.throws(() => createWriterArtifactContract(f.raw, writer, { ...h1, profileVersion: "accord.reviewer/v1" }), /policy versions/u);
    assert.throws(() => writerContract.materialize(writer, { materialAssertions: [{ statement: proposal, basisEntryId: target.proposalId }] }));
    const written = await f.authority.executePreparedAttempt(writer, { configuration: f.accepted.reference, instructions: writer.instructions!, outputContract: writerContract, complete: () => f.wire({ materialAssertions: [{ statement: TRUSTED_SYNTHETIC_SOURCE_INPUT.content, basisEntryId: accepted.entryId }] }, 12, "writer") }, at(11));
    assert.equal(written.outcome, "WINNER");
    f.reopen();
    assert.equal(f.raw.prepare("SELECT count(*) AS n FROM artifacts").get()?.["n"], 1);
    const trace = generateR003CaseTrace(f.raw, f.caseId);
    assert.ok(JSON.stringify(trace).includes("accord.reviewer/v2"));
    assert.ok(JSON.stringify(trace).includes("accord.writer/v2"));
  });
}

test("F2 missing/ambiguous targets reject before Reviewer Invocation/Attempt", async (t) => {
  for (const kind of ["missing", "ambiguous"] as const) await t.test(kind, async (t) => {
    const f = await fixture(t); const output = f.analysis();
    const proposals = kind === "missing" ? output.proposals.slice(0, 1) : [...output.proposals, { ...output.proposals[1]!, action: "Another unsupported proposal." }];
    assert.equal((await f.commitAnalysis({ ...output, proposals })).outcome, "WINNER");
    const before = countReviewer(f.raw);
    const error = kind === "missing" ? /REVIEW_TARGET_MISSING/u : /REVIEW_TARGET_AMBIGUOUS/u;
    assert.throws(() => f.prepare("REVIEWER", 6), error);
    assert.deepEqual(countReviewer(f.raw), before);
    f.reopen(); assert.throws(() => f.prepare("REVIEWER", 6), error);
    assert.deepEqual(countReviewer(f.raw), before);
  });
});

test("F2 retains v1 fixed output semantics and refuses unsupported version/policy combinations", async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.commitAnalysis(f.analysis())).outcome, "INVALID");
  f.reopen();
  for (const name of ["REVIEWER", "WRITER"]) {
    const mixed = structuredClone(configuration("0".repeat(64)));
    mixed.profiles[name]!.profileVersion = `accord.${name.toLowerCase()}/v1`;
    assert.throws(() => normalizeFrozenRuntimeConfiguration(mixed), /CONFIG_VERSION_MIXED/u);
    mixed.profiles[name]!.profileVersion = `accord.${name.toLowerCase()}/v99`;
    assert.throws(() => normalizeFrozenRuntimeConfiguration(mixed), /CONFIG_VERSION_UNSUPPORTED/u);
  }
  const wrongPolicy = configuration("0".repeat(64)); wrongPolicy.policy.targetVersion = FROZEN_RUNTIME_POLICY.targetVersion;
  assert.throws(() => normalizeFrozenRuntimeConfiguration(wrongPolicy), /CONFIG_VERSION_MIXED/u);
});

test("F2 refuses missing unsupported Claim and illegal output relations", async (t) => {
  for (const indexes of [[0], [99], [1, 1]]) await t.test(JSON.stringify(indexes), async (t) => {
    const f = await fixture(t); const output = f.analysis();
    assert.equal((await f.commitAnalysis({ ...output, proposals: [{ ...output.proposals[1]!, supportingClaimIndexes: indexes }] })).outcome, "INVALID");
    assert.deepEqual({ ...countReviewer(f.raw) }, { invocations: 0, attempts: 0 });
    f.reopen();
  });
});

// Fault injection only: retain and restore the immutable-row trigger for each corrupt database sample.
function corruptEntry(db: DatabaseSync, id: string, column: string, value: string, check: () => void) {
  assert.ok(["payload_json", "based_on_json", "source_refs_json", "content_digest", "visibility", "instruction_authority"].includes(column));
  const trigger = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'board_entries_immutable_update'").get()?.["sql"]);
  const original = db.prepare(`SELECT ${column} AS value FROM board_entries WHERE board_entry_id = ?`).get(id)?.["value"];
  const update = (next: unknown) => { assert.equal(typeof next, "string"); db.exec("DROP TRIGGER board_entries_immutable_update"); try { db.prepare(`UPDATE board_entries SET ${column} = ? WHERE board_entry_id = ?`).run(next as string, id); } finally { db.exec(trigger); } };
  update(value); try { check(); } finally { update(original); }
}

test("F2 rejects corrupt winner graph before preparing any Reviewer Attempt", async (t) => {
  const f = await fixture(t); assert.equal((await f.commitAnalysis(f.analysis())).outcome, "WINNER");
  const target = f.target();
  const claim = f.raw.prepare("SELECT board_entry_id FROM board_entries WHERE entry_type = 'Claim' AND json_extract(payload_json, '$.unsupported') = 1").get()?.["board_entry_id"]; assert.equal(typeof claim, "string");
  const mutations = [
    [target.proposalId, "payload_json", JSON.stringify({ action: "tampered", supportStatus: "UNSUPPORTED" })],
    [String(claim), "content_digest", "f".repeat(64)],
    [target.proposalId, "based_on_json", JSON.stringify([target.proposalId])],
    [target.proposalId, "based_on_json", JSON.stringify([`entry_${"0".repeat(64)}`])],
    [target.proposalId, "source_refs_json", JSON.stringify(Array(17).fill(String(claim)))],
    [String(claim), "payload_json", JSON.stringify({ statement: "x".repeat(17000), unsupported: true })],
  ];
  for (const [id, column, value] of mutations) corruptEntry(f.raw, id!, column!, value!, () => {
    assert.throws(() => f.prepare("REVIEWER", 6));
    assert.deepEqual({ ...countReviewer(f.raw) }, { invocations: 0, attempts: 0 });
  });
  assert.equal(f.prepare("REVIEWER", 6).profileVersion, "accord.reviewer/v2");
});

test("F2 access keeps identity, freshness, context and authority gates", async (t) => {
  const f = await fixture(t); assert.equal((await f.commitAnalysis(f.analysis())).outcome, "WINNER");
  const target = f.target(); const reviewer = f.prepare("REVIEWER", 6); const input = request(reviewer, target);
  const patches = [
    { target: { ...target, caseId: `case_${"f".repeat(64)}` } },
    { target: { ...target, runId: `run_${"f".repeat(64)}` } },
    { target: { ...target, boardId: `board_${"f".repeat(64)}` } },
    { target: { ...target, resultId: `result_${"f".repeat(64)}` } },
    { target: { ...target, invocationId: reviewer.invocationId } },
    { target: { ...target, proposalDigest: "f".repeat(64) } },
    { context: { ...input.context, contextDigest: "f".repeat(64) } },
    { boardRevision: input.boardRevision + 1 },
    { workflowRevision: input.workflowRevision + 1 },
    { operation: "READ_CREDENTIALS" }, { operation: "CREATE_APPROVAL" }, { operation: "SET_ARTIFACT_ELIGIBILITY" },
  ];
  for (const [i, patch] of patches.entries()) {
    const decision = decideProfileContextAccess(f.raw, { ...input, ...patch, requestId: `f2-deny-${i}` } as ProfileContextDecisionRequest);
    assert.equal(decision.outcome, "DENY"); assert.equal(decision.value, null);
  }
  assert.throws(() => projectPreparedProfileTarget(f.raw, { ...reviewer, entries: reviewer.entries.filter((entry) => entry.id !== target.proposalId) }, target));
  const valid = decideProfileContextAccess(f.raw, input); const contract = createReviewerDispositionContract(reviewer, valid);
  const output = review(target);
  assert.throws(() => contract.materialize(reviewer, { ...output, verificationResult: { ...output.verificationResult, target: { ...output.verificationResult.target, digest: "f".repeat(64) } } }));
  assert.throws(() => contract.materialize(reviewer, { ...output, verificationResult: { ...output.verificationResult, disposition: "SUPPORTED" } }));
  assert.throws(() => createReviewerDispositionContract({ ...reviewer, profileVersion: "accord.reviewer/v99" }, valid));
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM board_entries WHERE entry_type IN ('Critique','VerificationResult')").get()?.["n"], 0);
  // Fault injection mirrors the existing C03 oracle: a changed authoritative revision invalidates this Context.
  f.raw.prepare("UPDATE boards SET revision = revision + 1 WHERE board_id = ?").run(reviewer.boardId);
  assert.equal(decideProfileContextAccess(f.raw, { ...input, requestId: "f2-after-board-drift" }).reason, "STALE_CONTEXT");
  f.raw.prepare("UPDATE boards SET revision = revision - 1 WHERE board_id = ?").run(reviewer.boardId);
  f.raw.prepare("UPDATE workflow_runs SET revision = revision + 1 WHERE workflow_run_id = ?").run(reviewer.workflowRunId);
  assert.equal(decideProfileContextAccess(f.raw, { ...input, requestId: "f2-after-workflow-drift" }).reason, "STALE_CONTEXT");
});
