import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { MagicChatProtocolAdapter, type MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { magicChatMessageCreatedEnvelope } from "./fixture.js";
import { C3_NOW, c3Fixture, choiceEnvelope, confirmC3Approval, type C3Fixture } from "./helpers/c3-fixture.js";

const DECIDE = "2026-08-26T00:02:02.000Z";
const READ = "2026-08-26T00:02:03.000Z";
const SEND = "2026-08-26T00:02:04.000Z";

function approval(fixture: C3Fixture) {
  const value = fixture.authority.inspectApprovalPublication(fixture.caseId);
  assert.ok(value); return value;
}
function inspectSql(fixture: C3Fixture, sql: string) {
  const database = new DatabaseSync(fixture.temporary.path);
  try { return database.prepare(sql).all(); } finally { database.close(); }
}
function mutate(fixture: C3Fixture, table: string, sql: string): void {
  const database = new DatabaseSync(fixture.temporary.path);
  try {
    const triggers = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ?").all(table);
    for (const trigger of triggers) database.exec(`DROP TRIGGER \"${String(trigger["name"])}\"`);
    database.exec(sql);
    for (const trigger of triggers) database.exec(String(trigger["sql"]));
  } finally { database.close(); }
}
function exchange(fixture: C3Fixture, request: MagicChatRequestEnvelope, now: string) {
  const response = fixture.protocol.dispatch(request.id, now, (outbound) => fixture.simulator.respond(outbound, now));
  assert.ok(response, "the dispatch gate must call the synthetic transport");
  return fixture.protocol.receive(response, now);
}
function approve(fixture: C3Fixture) {
  const confirmed = confirmC3Approval(fixture);
  const event = choiceEnvelope(confirmed);
  const result = fixture.protocol.receive(event, DECIDE);
  assert.equal(result.nextRequest?.method, "conversation.messages.list");
  assert.ok(result.nextRequest);
  return { confirmed, event, request: result.nextRequest };
}
function readyPublication(fixture: C3Fixture) {
  const accepted = approve(fixture);
  const result = exchange(fixture, accepted.request, READ);
  assert.equal(result.nextRequest?.method, "message.send"); assert.ok(result.nextRequest);
  return { ...accepted, publication: result.nextRequest };
}
function assertNoPublication(fixture: C3Fixture, visibleBefore: number): void {
  assert.equal(fixture.simulator.visibleMessageCount, visibleBefore);
  assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
  assert.notEqual(approval(fixture).publication?.state, "CONFIRMED");
}

test("C3 approve binds H2/H3/claim and publishes the exact immutable Markdown once", async (t) => { const fixture = await c3Fixture("c3-approve", t);
try {
  const initial = approval(fixture);
  assert.equal(initial.artifactRevision, 1);
  assert.equal(initial.expectedActorId, "actor-1");
  assert.equal(initial.caseId, fixture.caseId); assert.equal(initial.workflowRunId, fixture.runId);
  assert.ok(fixture.winner.materialization?.handoff);
  assert.equal(fixture.protocol.pendingRequests().filter(({ request }) => request.method === "message.send").length, 1);
  const accepted = approve(fixture);
  const claimed = approval(fixture);
  assert.ok(claimed.decision); assert.ok(claimed.claim); assert.ok(claimed.freshness);
  assert.equal(claimed.claim.ownerId, "COORDINATOR");
  assert.equal(claimed.freshness.claimVersion, claimed.claim.version);
  assert.equal(claimed.choiceMessageId, accepted.confirmed.card.id);
  assert.equal(claimed.choiceMessageSequence, accepted.confirmed.card.seq);
  if (accepted.request.method !== "conversation.messages.list") assert.fail("freshness RPC missing");
  assert.equal(accepted.request.payload.before_or_equal_seq, Number.MAX_SAFE_INTEGER);
  assert.equal(accepted.request.payload.limit, 100);
  const result = exchange(fixture, accepted.request, READ);
  assert.ok(result.nextRequest); assert.equal(result.nextRequest.method, "message.send");
  if (result.nextRequest.method !== "message.send") assert.fail("publication RPC missing");
  const [artifact] = inspectSql(fixture, "SELECT artifact_id, content_markdown, artifact_digest FROM artifacts"); assert.ok(artifact);
  assert.equal(result.nextRequest.payload.message.content, artifact["content_markdown"]);
  assert.equal(result.nextRequest.payload.message.type, "markdown");
  assert.equal(claimed.artifactId, artifact["artifact_id"]); assert.equal(claimed.artifactDigest, artifact["artifact_digest"]);
  assert.equal(approval(fixture).publication?.state, "PENDING");
  const before = fixture.simulator.visibleMessageCount;
  const completed = exchange(fixture, result.nextRequest, SEND);
  assert.equal(completed.snapshot.workflowState, "COMPLETE");
  assert.equal(fixture.simulator.visibleMessageCount, before + 1);
  assert.equal(approval(fixture).publication?.state, "CONFIRMED");
  assert.equal(approval(fixture).publication?.requestEnvelopeId, result.nextRequest.id);
  assert.ok(approval(fixture).publication?.messageId);
  assert.ok(completed.nextRequest); exchange(fixture, completed.nextRequest, SEND);
  const replay = fixture.protocol.receive({ ...accepted.event, id: "replayed-delivery" }, SEND);
  assert.equal(replay.snapshot.workflowState, "COMPLETE");
  assert.equal(approval(fixture).decision?.approvalId, claimed.decision.approvalId);
  assert.equal(approval(fixture).claim?.claimId, claimed.claim.claimId);
  assert.equal(fixture.simulator.visibleMessageCount, before + 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM approvals").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM response_claims WHERE publication_slot = 'FINAL_RESPONSE'").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM artifacts").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM approval_challenges").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM pending_side_effects WHERE action_kind = 'APPROVAL_REQUEST'").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM pending_side_effects WHERE action_kind = 'PUBLICATION'").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM magicchat_messages WHERE purpose = 'PUBLICATION'").length, 1);
  const [correlation] = inspectSql(fixture, "SELECT a.source_result_id, h.artifact_id, h.artifact_digest, c.approval_id FROM artifacts a JOIN approvals h ON h.artifact_id = a.artifact_id JOIN response_claims c ON c.approval_id = h.approval_id");
  assert.ok(correlation);
  assert.equal(correlation["source_result_id"], fixture.winner.resultId);
  assert.equal(correlation["artifact_id"], initial.artifactId); assert.equal(correlation["artifact_digest"], initial.artifactDigest);
  assert.equal(correlation["approval_id"], claimed.decision.approvalId);
} finally { fixture.close(); } });

test("C3 reject is terminal with no claim, publication, or second Artifact", async (t) => { const fixture = await c3Fixture("c3-reject", t);
try {
  const confirmed = confirmC3Approval(fixture); const before = fixture.simulator.visibleMessageCount;
  const event = choiceEnvelope(confirmed, "reject");
  const rejected = fixture.protocol.receive(event, DECIDE);
  assert.equal(rejected.snapshot.workflowState, "REJECTED");
  assert.ok(rejected.nextRequest); assert.equal(rejected.nextRequest.method, "events.ack");
  exchange(fixture, rejected.nextRequest, READ);
  const decision = approval(fixture).decision; assert.ok(decision);
  assert.equal(approval(fixture).claim, undefined); assert.equal(approval(fixture).publication, undefined);
  assert.equal(fixture.protocol.receive({ ...event, id: "reject-replay" }, SEND).snapshot.workflowState, "REJECTED");
  assert.deepEqual(approval(fixture).decision, decision);
  assert.equal(fixture.simulator.visibleMessageCount, before);
  assert.equal(inspectSql(fixture, "SELECT * FROM artifacts").length, 1);
  assert.equal(inspectSql(fixture, "SELECT * FROM response_claims WHERE publication_slot = 'FINAL_RESPONSE'").length, 0);
} finally { fixture.close(); } });

test("C3 invalid human choices cannot decide or publish", async (t) => {
  for (const mode of ["actor", "conversation", "card", "card-sequence", "card-options", "option", "multiple-options", "response", "cursor", "expiry", "event-kind"] as const) await t.test(mode, async (t) => { const fixture = await c3Fixture(`c3-invalid-${mode}`, t);
  try {
    const confirmed = confirmC3Approval(fixture); const event = choiceEnvelope(confirmed); const before = fixture.simulator.visibleMessageCount;
    if (mode === "actor") event.payload.sender.id = "other-actor";
    else if (mode === "conversation") event.payload.conversation.id = "other-conversation";
    else if (mode === "card") event.payload.choice_message.id = "other-card";
    else if (mode === "card-sequence") event.payload.choice_message.seq += 1;
    else if (mode === "card-options") {
      const body = event.payload.choice_message.body; assert.equal(body.type, "choice");
      if (body.type !== "choice") assert.fail("approval card must be single-choice");
      event.payload.choice_message.body = { ...body, options: [{ id: "approve", label: "Approve" }, { id: "other", label: "Other" }] };
    }
    else if (mode === "option") event.payload.response.option_ids = ["accept"];
    else if (mode === "multiple-options") event.payload.response.option_ids = ["approve", "reject"];
    else if (mode === "response") event.payload.response.id = "";
    else if (mode === "cursor") event.cursor = 2;
    else if (mode === "event-kind") event.event = "message.created";
    const now = mode === "expiry" ? new Date(Date.parse(approval(fixture).expiresAt) + 1).toISOString() : DECIDE;
    try { fixture.protocol.receive(event, now); } catch (error) { assert.ok(error instanceof Error); }
    assert.equal(approval(fixture).decision, undefined); assert.equal(approval(fixture).claim, undefined);
    assertNoPublication(fixture, before);
  } finally { fixture.close(); } });
});

test("C3 identical choice replay retains H3 while conflicting bytes and reused responses cannot decide twice", async (t) => { const fixture = await c3Fixture("c3-choice-conflict", t);
try {
  const accepted = approve(fixture); const original = approval(fixture); const before = fixture.simulator.visibleMessageCount;
  const replayed = fixture.protocol.receive({ ...accepted.event, id: "another-delivery-envelope" }, READ);
  assert.equal(replayed.nextRequest?.id, accepted.request.id);
  assert.deepEqual(approval(fixture).decision, original.decision);
  const conflict = choiceEnvelope(accepted.confirmed, "reject");
  assert.throws(() => fixture.protocol.receive(conflict, READ));
  const reused = { ...accepted.event, cursor: 4, id: "same-response-new-cursor" };
  try { fixture.protocol.receive(reused, READ); } catch (error) { assert.ok(error instanceof Error); }
  assert.deepEqual(approval(fixture).decision, original.decision);
  assert.equal(inspectSql(fixture, "SELECT * FROM approvals").length, 1);
  assertNoPublication(fixture, before);
} finally { fixture.close(); } });

test("C3 choice receipts keep their actual event kind and never ACK past an incomplete lower cursor", async (t) => { const fixture = await c3Fixture("c3-serial-choice", t);
try {
  const accepted = approve(fixture);
  assert.equal(fixture.protocol.inspect(3)?.ackState, "NONE");
  const newer = magicChatMessageCreatedEnvelope({ cursor: 4, envelopeEventId: "higher-cursor", messageId: "later-local", messageSequence: accepted.confirmed.card.seq + 1, messageCreatedAt: READ, body: "A new constraint" });
  const observed = fixture.protocol.receive(newer, READ);
  assert.equal(observed.snapshot.phase, "OBSERVED_INPUT");
  assert.equal(observed.snapshot.ackState, "NONE");
  assert.ok(fixture.protocol.pendingRequests().every(({ request }) => request.method !== "events.ack" || request.payload.cursor < 3));
  assert.deepEqual(fixture.simulator.acknowledgedCursors, [1, 2]);
  const receipts = inspectSql(fixture, "SELECT event_type FROM inbox_receipts WHERE cursor = 3");
  assert.equal(receipts[0]?.["event_type"], "choice.response_created");
  const held = exchange(fixture, accepted.request, READ);
  assert.equal(held.snapshot.workflowState, "PUBLICATION_HOLD");
  assert.ok(held.nextRequest); assert.equal(held.nextRequest.method, "events.ack");
  exchange(fixture, held.nextRequest, SEND);
  assert.equal(fixture.protocol.inspect(3)?.ackState, "ACK_CONFIRMED");
  const resumedHigher = fixture.protocol.receive({ ...newer, id: "higher-cursor-redelivery" }, SEND);
  assert.ok(resumedHigher.nextRequest); assert.equal(resumedHigher.nextRequest.method, "events.ack");
  exchange(fixture, resumedHigher.nextRequest, SEND);
  assert.equal(fixture.protocol.inspect(4)?.ackState, "ACK_CONFIRMED");
  assert.deepEqual(fixture.simulator.acknowledgedCursors, [1, 2, 3, 4]);
} finally { fixture.close(); } });

test("C3 newer remotely visible or locally received messages hold publication", async (t) => {
  for (const mode of ["remote", "local"] as const) await t.test(mode, async (t) => { const fixture = await c3Fixture(`c3-newer-${mode}`, t);
  try {
    const accepted = approve(fixture); const before = fixture.simulator.visibleMessageCount;
    const newer = magicChatMessageCreatedEnvelope({ cursor: 4, envelopeEventId: `new-${mode}`, messageId: `new-${mode}`, messageSequence: accepted.confirmed.card.seq + 1, messageCreatedAt: READ, body: "A later instruction" });
    if (mode === "remote") fixture.simulator.observeUserMessage(newer);
    const result = exchange(fixture, accepted.request, READ);
    if (mode === "local") {
      assert.ok(result.nextRequest); fixture.protocol.receive(newer, READ);
      let sends = 0; fixture.protocol.dispatch(result.nextRequest.id, SEND, () => { sends += 1; });
      assert.equal(sends, 0);
    }
    assert.equal(fixture.protocol.inspect(3)?.workflowState, "PUBLICATION_HOLD");
    assertNoPublication(fixture, before + (mode === "remote" ? 1 : 0));
    assert.equal(inspectSql(fixture, "SELECT * FROM magicchat_messages WHERE purpose = 'PUBLICATION'").length, 0);
  } finally { fixture.close(); } });
});

test("C3 missing or mismatched newest choice and invalid read ordering cannot create a valid token", async (t) => {
  for (const mode of ["missing", "id", "sequence", "conversation", "order"] as const) await t.test(mode, async (t) => { const fixture = await c3Fixture(`c3-read-${mode}`, t);
  try {
    const accepted = approve(fixture); const before = fixture.simulator.visibleMessageCount;
    const response = fixture.simulator.respond(accepted.request, READ);
    assert.ok("messages" in response.payload);
    const messages = response.payload.messages;
    const first = messages.at(-1); assert.ok(first);
    const changed = mode === "missing" ? [] : mode === "id" ? [{ ...first, id: "wrong-newest" }] : mode === "sequence" ? [{ ...first, seq: first.seq + 1 }] : mode === "order" ? [first, { ...first, seq: first.seq - 1 }] : messages;
    const invalid = { ...response, payload: { ...response.payload, messages: changed, ...(mode === "conversation" ? { conversation: { id: "wrong-conversation" } } : {}) } };
    try { fixture.protocol.receive(invalid, READ); } catch (error) { assert.ok(error instanceof Error); }
    assert.notEqual(approval(fixture).freshness?.state, "VALID");
    assertNoPublication(fixture, before);
  } finally { fixture.close(); } });
});

test("C3 claim precedes the read and dispatch rejects an expired real clock despite a stale valid caller timestamp", async (t) => { const fixture = await c3Fixture("c3-final-gate", t);
try {
  const accepted = approve(fixture); const before = fixture.simulator.visibleMessageCount;
  let readCalls = 0;
  const response = fixture.protocol.dispatch(accepted.request.id, READ, (request) => {
    readCalls += 1;
    const current = approval(fixture); assert.ok(current.claim);
    assert.equal(current.freshness?.claimVersion, current.claim.version);
    return fixture.simulator.respond(request, READ);
  });
  assert.equal(readCalls, 1);
  const result = fixture.protocol.receive(response, READ); assert.ok(result.nextRequest);
  const current = approval(fixture); assert.ok(current.claim);
  const expires = current.claim.expiresAt < current.expiresAt ? current.claim.expiresAt : current.expiresAt;
  t.mock.timers.setTime(Date.parse(expires) + 1);
  let sends = 0; fixture.protocol.dispatch(result.nextRequest.id, SEND, () => { sends += 1; });
  assert.equal(sends, 0); assert.equal(fixture.protocol.inspect(3)?.workflowState, "PUBLICATION_HOLD");
  assertNoPublication(fixture, before);
} finally { fixture.close(); } });

test("C3 unknown publication replays the original request ID and confirms only one visible final", async (t) => { const fixture = await c3Fixture("c3-unknown", t);
try {
  const ready = readyPublication(fixture); const before = fixture.simulator.visibleMessageCount;
  let originalResponse: unknown;
  fixture.protocol.dispatch(ready.publication.id, SEND, (request) => { originalResponse = fixture.simulator.respond(request, SEND); });
  assert.equal(fixture.simulator.visibleMessageCount, before + 1);
  assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
  assert.equal(approval(fixture).publication?.state, "UNKNOWN");
  assert.equal(approval(fixture).publication?.messageId, undefined);
  const retry = fixture.protocol.pendingRequests().find(({ request }) => request.id === ready.publication.id); assert.ok(retry);
  assert.deepEqual(retry.request, ready.publication);
  const confirmed = exchange(fixture, retry.request, "2026-08-26T00:02:05.000Z");
  assert.equal(confirmed.snapshot.workflowState, "COMPLETE");
  assert.equal(fixture.simulator.visibleMessageCount, before + 1);
  assert.ok(originalResponse);
  fixture.protocol.receive(originalResponse, "2026-08-26T00:02:06.000Z");
  assert.equal(approval(fixture).publication?.requestEnvelopeId, ready.publication.id);
  assert.equal(fixture.simulator.visibleMessageCount, before + 1);
} finally { fixture.close(); } });

test("C3 mismatched publication confirmations never fabricate successful completion", async (t) => {
  for (const mode of ["request", "conversation", "body", "sender", "identity", "sequence", "failure"] as const) await t.test(mode, async (t) => { const fixture = await c3Fixture(`c3-confirm-${mode}`, t);
  try {
    const ready = readyPublication(fixture);
    fixture.protocol.dispatch(ready.publication.id, SEND, (request) => fixture.simulator.respond(request, SEND));
    const response = fixture.simulator.respond(ready.publication, SEND); assert.ok("message" in response.payload);
    const message = response.payload.message;
    const invalid = { ...response, ...(mode === "request" ? { reply_to: "wrong-request" } : {}), ...(mode === "failure" ? { ok: false } : {}), payload: { ...response.payload, ...(mode === "conversation" ? { conversation: { ...response.payload.conversation, id: "wrong-conversation" } } : {}), message: { ...message, ...(mode === "body" ? { body: { type: "markdown", content: "Unapproved replacement" } } : {}), ...(mode === "sender" ? { sender: { type: "app", id: "wrong-app" } } : {}), ...(mode === "identity" ? { id: "" } : {}), ...(mode === "sequence" ? { seq: 0 } : {}) } } };
    try { fixture.protocol.receive(invalid, SEND); } catch (error) { assert.ok(error instanceof Error); }
    assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
    assert.notEqual(approval(fixture).publication?.state, "CONFIRMED");
    assert.equal(approval(fixture).publication?.messageId, undefined);
  } finally { fixture.close(); } });
});

test("C3 stale Board, Run, or Artifact cannot turn a choice into H3", async (t) => {
  for (const [mode, table, sql] of [
    ["board", "boards", "UPDATE boards SET revision = revision + 1"],
    ["run", "workflow_runs", "UPDATE workflow_runs SET revision = revision + 1"],
    ["artifact", "artifacts", "UPDATE artifacts SET artifact_digest = '" + "f".repeat(64) + "'"],
  ]) await t.test(String(mode), async (t) => { const fixture = await c3Fixture(`c3-stale-choice-${mode}`, t);
  try {
    const confirmed = confirmC3Approval(fixture); const before = fixture.simulator.visibleMessageCount;
    assert.ok(table); assert.ok(sql); mutate(fixture, table, sql);
    try { fixture.protocol.receive(choiceEnvelope(confirmed), DECIDE); } catch (error) { assert.ok(error instanceof Error); }
    assert.equal(approval(fixture).decision, undefined); assert.equal(approval(fixture).claim, undefined);
    assertNoPublication(fixture, before);
  } finally { fixture.close(); } });
});

test("C3 final dispatch rechecks every token-bound local authority and never invokes send for stale state", async (t) => {
  for (const [mode, table, sql] of [
    ["board", "boards", "UPDATE boards SET revision = revision + 1"],
    ["run", "workflow_runs", "UPDATE workflow_runs SET revision = revision + 1"],
    ["approval", "approvals", "UPDATE approvals SET artifact_digest = '" + "f".repeat(64) + "'"],
    ["artifact", "artifacts", "UPDATE artifacts SET artifact_digest = '" + "f".repeat(64) + "'"],
    ["claim-version", "response_claims", "UPDATE response_claims SET claim_version = claim_version + 1"],
    ["claim-owner", "response_claims", "UPDATE response_claims SET owner_id = 'OTHER_OWNER'"],
    ["claim-expiry", "response_claims", "UPDATE response_claims SET expires_at = '2026-08-26T00:02:03.999Z'"],
    ["challenge-expiry", "approval_challenges", "UPDATE approval_challenges SET expires_at = '2026-08-26T00:02:03.999Z'"],
  ]) await t.test(String(mode), async (t) => { const fixture = await c3Fixture(`c3-stale-dispatch-${mode}`, t);
  try {
    const ready = readyPublication(fixture); const before = fixture.simulator.visibleMessageCount;
    assert.ok(table); assert.ok(sql); mutate(fixture, table, sql);
    let sends = 0;
    fixture.protocol.dispatch(ready.publication.id, SEND, () => { sends += 1; });
    assert.equal(sends, 0); assert.equal(fixture.protocol.inspect(3)?.workflowState, "PUBLICATION_HOLD");
    assertNoPublication(fixture, before);
  } finally { fixture.close(); } });
});

test("C3 rejects a digest-consistent non-maximal freshness bound before the remote callback", async (t) => { const fixture = await c3Fixture("c3-nonmaximal-bound", t);
try {
  const accepted = approve(fixture); const before = fixture.simulator.visibleMessageCount;
  const raw = new DatabaseSync(fixture.temporary.path);
  try {
    raw.prepare("UPDATE magicchat_rpc_actions SET request_json = json_set(request_json, '$.payload.before_or_equal_seq', ?) WHERE request_envelope_id = ?").run(accepted.confirmed.card.seq, accepted.request.id);
    const row = raw.prepare("SELECT action_id, request_json FROM magicchat_rpc_actions WHERE request_envelope_id = ?").get(accepted.request.id); assert.ok(row);
    const digest = createHash("sha256").update(String(row["request_json"]), "utf8").digest("hex");
    raw.prepare("UPDATE magicchat_rpc_actions SET request_digest = ? WHERE action_id = ?").run(digest, String(row["action_id"]));
    raw.prepare("UPDATE pending_side_effects SET payload_digest = ? WHERE action_id = ?").run(digest, String(row["action_id"]));
  } finally { raw.close(); }
  let reads = 0;
  assert.throws(() => fixture.protocol.dispatch(accepted.request.id, READ, () => { reads += 1; }), /request|identity|bound|conflict/u);
  assert.equal(reads, 0); assert.notEqual(approval(fixture).freshness?.state, "VALID");
  assertNoPublication(fixture, before);
} finally { fixture.close(); } });

test("C3 a publication confirmation created before dispatch cannot complete before or after authorization", async (t) => { const fixture = await c3Fixture("c3-undispatched-confirmation", t);
try {
  const ready = readyPublication(fixture);
  const response = fixture.simulator.respond(ready.publication, SEND);
  assert.throws(() => fixture.protocol.receive(response, SEND), /dispatch|authoriz/u);
  assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
  assert.equal(approval(fixture).publication?.state, "PENDING");
  assert.equal(approval(fixture).publication?.messageId, undefined);
  let sends = 0;
  fixture.protocol.dispatch(ready.publication.id, "2026-08-26T00:02:05.000Z", () => { sends += 1; });
  assert.equal(sends, 1);
  assert.throws(() => fixture.protocol.receive(response, "2026-08-26T00:02:06.000Z"), /dispatch|chronology|binding/u);
  assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
  assert.equal(approval(fixture).publication?.state, "UNKNOWN");
  assert.equal(approval(fixture).publication?.messageId, undefined);
} finally { fixture.close(); } });

test("C3 an unknown send cannot bypass a newer local message on same-ID redispatch", async (t) => { const fixture = await c3Fixture("c3-unknown-stale", t);
try {
  const ready = readyPublication(fixture);
  fixture.protocol.dispatch(ready.publication.id, SEND, (request) => { fixture.simulator.respond(request, SEND); });
  const visible = fixture.simulator.visibleMessageCount;
  fixture.protocol.receive(magicChatMessageCreatedEnvelope({ cursor: 4, envelopeEventId: "unknown-later", messageId: "unknown-later", messageSequence: ready.confirmed.card.seq + 2, messageCreatedAt: SEND, body: "Change this before any new send." }), SEND);
  let sends = 0;
  fixture.protocol.dispatch(ready.publication.id, "2026-08-26T00:02:05.000Z", () => { sends += 1; });
  assert.equal(sends, 0); assert.equal(fixture.simulator.visibleMessageCount, visible);
  assert.equal(fixture.protocol.inspect(3)?.workflowState, "PUBLICATION_HOLD");
  assert.equal(approval(fixture).publication?.state, "UNKNOWN");
  assert.equal(approval(fixture).publication?.requestEnvelopeId, ready.publication.id);
  assert.equal(approval(fixture).publication?.messageId, undefined);
} finally { fixture.close(); } });

test("C3 accepts and reopens a human click made before the card confirmation reached Accord", async (t) => {
  const fixture = await c3Fixture("c3-delayed-card-confirmation", t);
  try {
    const pending = fixture.protocol.pendingRequests().find(({ request }) => request.method === "message.send");
    assert.ok(pending);
    const delivered = fixture.protocol.dispatch(pending.request.id, C3_NOW, (request) => fixture.simulator.respond(request, C3_NOW));
    const response = fixture.simulator.respond(pending.request, C3_NOW); assert.ok("message" in response.payload);
    const event = choiceEnvelope({ request: pending.request, card: response.payload.message });
    assert.ok(response.payload.message.created_at < event.payload.response.created_at);
    assert.ok(event.payload.response.created_at < READ);
    fixture.protocol.receive(delivered, READ);
    const accepted = fixture.protocol.receive(event, SEND);
    assert.equal(accepted.nextRequest?.method, "conversation.messages.list");
    const decided = approval(fixture);
    assert.equal(decided.decision?.decision, "APPROVED");
    assert.equal(decided.decision?.responseId, event.payload.response.id);
    assert.equal(decided.freshness?.state, "PENDING");
    assert.equal(decided.publication, undefined);
    fixture.authority.close();
    t.mock.timers.setTime(Date.parse(SEND));
    const reopened = openAuthorityDatabase(fixture.temporary.path);
    try {
      assert.deepEqual(reopened.inspectApprovalPublication(fixture.caseId)?.decision, decided.decision);
      assert.equal(reopened.inspectApprovalPublication(fixture.caseId)?.freshness?.state, "PENDING");
      assert.equal(reopened.inspectApprovalPublication(fixture.caseId)?.publication, undefined);
    } finally { reopened.close(); }
  } finally { fixture.close(); }
});

test("C3 retains a blocked human rejection between observed cursors and cannot cumulatively ACK past it", async (t) => {
  const fixture = await c3Fixture("c3-interleaved-reject", t);
  try {
    const confirmed = confirmC3Approval(fixture);
    const visibleBefore = fixture.simulator.visibleMessageCount;
    const first = magicChatMessageCreatedEnvelope({ cursor: 3, envelopeEventId: "observed-before-reject", messageId: "observed-before-reject", messageSequence: confirmed.card.seq + 1, messageCreatedAt: DECIDE, body: "An observed message before rejection." });
    const firstResult = fixture.protocol.receive(first, DECIDE);
    assert.ok(firstResult.nextRequest); assert.equal(firstResult.nextRequest.method, "events.ack");
    assert.equal(fixture.protocol.inspect(3)?.ackState, "ACK_INTENT");
    const reject = choiceEnvelope(confirmed, "reject", 4);
    fixture.protocol.receive(reject, READ);
    assert.equal(approval(fixture).decision, undefined);
    assert.equal(fixture.protocol.inspect(4)?.ackState, "NONE");
    const later = magicChatMessageCreatedEnvelope({ cursor: 5, envelopeEventId: "observed-after-reject", messageId: "observed-after-reject", messageSequence: confirmed.card.seq + 2, messageCreatedAt: READ, body: "An observed message after rejection." });
    fixture.protocol.receive(later, READ);
    const retained = inspectSql(fixture, "SELECT cursor, event_type, processing_status FROM inbox_receipts WHERE cursor IN (4, 5) ORDER BY cursor");
    assert.deepEqual(retained.map((row) => [row["cursor"], row["event_type"], row["processing_status"]]), [[4, "choice.response_created", "RECEIVED"], [5, "message.created", "RECEIVED"]]);
    assert.equal(fixture.protocol.inspect(5)?.ackState, "NONE");
    assert.deepEqual(fixture.simulator.acknowledgedCursors, [1, 2]);
    const queuedChoice = fixture.protocol.inspect(4);
    const queuedLater = fixture.protocol.inspect(5);
    fixture.authority.close();
    t.mock.timers.setTime(Date.parse(READ));
    fixture.authority = openAuthorityDatabase(fixture.temporary.path);
    fixture.protocol = new MagicChatProtocolAdapter(fixture.authority, "synthetic-app");
    assert.deepEqual(fixture.protocol.inspect(4), queuedChoice);
    assert.deepEqual(fixture.protocol.inspect(5), queuedLater);
    assert.deepEqual(inspectSql(fixture, "SELECT cursor, event_type, processing_status FROM inbox_receipts WHERE cursor IN (4, 5) ORDER BY cursor"), retained);
    assert.equal(approval(fixture).decision, undefined);
    exchange(fixture, firstResult.nextRequest, SEND);
    fixture.protocol.receive({ ...later, id: "higher-replay-before-reject" }, "2026-08-26T00:02:05.000Z");
    assert.equal(fixture.protocol.inspect(5)?.ackState, "NONE");
    assert.ok(fixture.protocol.pendingRequests().every(({ request }) => request.method !== "events.ack" || request.payload.cursor < 4));
    const rejected = fixture.protocol.receive({ ...reject, id: "retained-reject-redelivery" }, "2026-08-26T00:02:06.000Z");
    assert.equal(rejected.snapshot.workflowState, "REJECTED");
    assert.equal(approval(fixture).decision?.decision, "REJECTED");
    assert.equal(approval(fixture).decision?.responseId, reject.payload.response.id);
    assert.ok(rejected.nextRequest); assert.equal(rejected.nextRequest.method, "events.ack");
    exchange(fixture, rejected.nextRequest, "2026-08-26T00:02:07.000Z");
    const higher = fixture.protocol.receive({ ...later, id: "higher-replay-after-reject" }, "2026-08-26T00:02:08.000Z");
    assert.ok(higher.nextRequest); assert.equal(higher.nextRequest.method, "events.ack");
    exchange(fixture, higher.nextRequest, "2026-08-26T00:02:09.000Z");
    assert.deepEqual(fixture.simulator.acknowledgedCursors, [1, 2, 3, 4, 5]);
    assert.equal(fixture.simulator.visibleMessageCount, visibleBefore);
    assert.equal(approval(fixture).claim, undefined); assert.equal(approval(fixture).publication, undefined);
    assert.equal(inspectSql(fixture, "SELECT * FROM approvals").length, 1);
    const decision = approval(fixture).decision;
    fixture.authority.close();
    t.mock.timers.setTime(Date.parse("2026-08-26T00:02:09.000Z"));
    fixture.authority = openAuthorityDatabase(fixture.temporary.path);
    fixture.protocol = new MagicChatProtocolAdapter(fixture.authority, "synthetic-app");
    assert.deepEqual(approval(fixture).decision, decision);
    assert.equal(fixture.protocol.inspect(4)?.workflowState, "REJECTED");
    assert.equal(fixture.protocol.inspect(4)?.ackState, "ACK_CONFIRMED");
    assert.equal(fixture.protocol.inspect(5)?.ackState, "ACK_CONFIRMED");
    assert.equal(approval(fixture).publication, undefined);
  } finally { try { fixture.authority.close(); } catch {} fixture.close(); }
});

test("C3 cannot accept a stale caller timestamp as unexpired approval authority", async (t) => {
  for (const option of ["approve", "reject"]) await t.test(option, async (t) => {
    const fixture = await c3Fixture(`c3-stale-choice-clock-${option}`, t);
    try {
      const confirmed = confirmC3Approval(fixture);
      const event = choiceEnvelope(confirmed, option);
      const current = approval(fixture);
      assert.ok(event.payload.response.created_at < current.expiresAt);
      const visibleBefore = fixture.simulator.visibleMessageCount;
      t.mock.timers.setTime(Date.parse(current.expiresAt) + 1);
      fixture.protocol.receive(event, DECIDE);
      assert.equal(approval(fixture).decision, undefined);
      assert.equal(approval(fixture).claim, undefined);
      assert.equal(approval(fixture).publication, undefined);
      assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "REJECTED");
      assert.notEqual(fixture.protocol.inspect(3)?.workflowState, "COMPLETE");
      assert.equal(fixture.simulator.visibleMessageCount, visibleBefore);
      assert.equal(inspectSql(fixture, "SELECT * FROM approvals").length, 0);
    } finally { fixture.close(); }
  });
});
