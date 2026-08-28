import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { generateR003ResearcherAnalystHandoff, type GeneratedR003ResearcherAnalystHandoff } from "./contracts/researcher-analyst-handoff.js";
import { deriveSourceId } from "./core/ids.js";
import { MagicChatProtocolAdapter } from "./magicchat/adapter.js";
import { openAuthorityDatabase } from "./persistence/sqlite-authority.js";

const source = Object.freeze({ content: "Synthetic policy permits a two-week decision window.", locator: "fixture://policy/two-week", observedAt: "2026-08-26T00:01:02.000Z", sourceKind: "SYNTHETIC_FIXTURE" });
const digest = (value: string): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const sourceId = deriveSourceId({ contentDigest: digest(source.content), locator: source.locator, observedAt: source.observedAt, sourceKind: source.sourceKind });
function message(body: string, cursor: number, eventId: string, messageId: string, sequence: number, replyTo?: string): object { return { v: 1, id: eventId, kind: "event", cursor, event: "message.created", payload: { conversation: { id: "conversation-1", name: "Synthetic App Conversation", type: "app" }, sender: { type: "user", id: "actor-1", name: "Synthetic User", nickname: "Synthetic User", email: "synthetic@example.invalid" }, message: { id: messageId, seq: sequence, body: { type: "text", content: body }, summary: body, created_at: cursor === 1 ? "2026-08-26T00:00:00Z" : "2026-08-26T00:01:00Z", ...(replyTo === undefined ? {} : { reply_to_message_id: replyTo }) } } }; }
function sent(requestEnvelopeId: string): object { const prompt = "What decision constraint must the Researcher preserve?"; return { v: 1, id: "response-clarification-1", kind: "response", reply_to: requestEnvelopeId, ok: true, payload: { conversation: { id: "conversation-1", name: "Synthetic App Conversation", type: "app" }, created: true, message: { id: "clarification-message-1", seq: 2, body: { type: "text", content: prompt }, summary: prompt, sender: { id: "synthetic-app", type: "app" }, created_at: "2026-08-26T00:00:02Z" } } }; }
function acknowledged(requestEnvelopeId: string, cursor: number): object { return { v: 1, id: `response-ack-${cursor}`, kind: "response", reply_to: requestEnvelopeId, ok: true, payload: { cursor } }; }
const metadata = (requestId: string, responseId: string) => ({ deploymentId: "fixture-deployment", modelId: "fixture-model", providerPortVersion: "accord.native-baizhi-provider-port/v1" as const, requestId, responseId });
const providerWire = (value: unknown): string => JSON.stringify(value);

async function deterministicProjection(): Promise<GeneratedR003ResearcherAnalystHandoff> {
  const directory = mkdtempSync(join(tmpdir(), "accord-r003-handoff-")); const path = join(directory, "authority.sqlite");
  try {
    const authority = openAuthorityDatabase(path); authority.installTrustedSyntheticSourceManifest("2026-08-26T00:01:00.000Z"); const protocol = new MagicChatProtocolAdapter(authority, "synthetic-app");
    const created = protocol.receive(message("Synthetic objective", 1, "event-delivery-1", "message-1", 1), "2026-08-26T00:00:01.000Z"); if (created.nextRequest === undefined) throw new Error("deterministic handoff did not create clarification request");
    const waiting = protocol.receive(sent(created.nextRequest.id), "2026-08-26T00:00:03.000Z"); if (waiting.nextRequest === undefined) throw new Error("deterministic handoff did not create acknowledgement request"); protocol.receive(acknowledged(waiting.nextRequest.id, 1), "2026-08-26T00:00:04.000Z");
    const resumed = protocol.receive(message("Preserve a two-week decision window.", 2, "event-ra-reply-2", "message-ra-reply-2", 3, "clarification-message-1"), "2026-08-26T00:01:01.000Z");
    const researcher = authority.prepareProfileInvocation({ caseId: resumed.snapshot.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" }); const observation = researcher.entries.find((entry) => entry.type === "Observation"); if (observation === undefined) throw new Error("deterministic handoff lacks Researcher Observation");
    authority.commitProviderResult(researcher, authority.beginPreparedAttempt(researcher.invocationId, "2026-08-26T00:01:02.000Z"), providerWire({ providerMetadata: metadata("r1", "r1-response"), output: { evidenceRefs: [{ locator: source.locator, observedAt: source.observedAt, sourceDigest: digest(source.content), sourceId, sourceKind: source.sourceKind }], intents: [{ basedOn: [observation.id], objective: "Research the constraint", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [sourceId], statement: "The user requests two weeks." }] }, receivedAt: "2026-08-26T00:01:03.000Z", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }), "2026-08-26T00:01:02.000Z");
    const analyst = authority.prepareProfileInvocation({ caseId: resumed.snapshot.caseId, modelId: "fixture-model", now: "2026-08-26T00:01:04.000Z", profile: "ANALYST" }); const evidence = analyst.entries.find((entry) => entry.type === "EvidenceRef"); if (evidence === undefined) throw new Error("deterministic handoff lacks EvidenceRef");
    authority.commitProviderResult(analyst, authority.beginPreparedAttempt(analyst.invocationId, "2026-08-26T00:01:04.000Z"), providerWire({ providerMetadata: metadata("a1", "a2"), output: { claims: [{ statement: "Two weeks is supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Customer adoption is guaranteed.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Use two weeks.", supportStatus: "SUPPORTED" as const, supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED" as const, supportingClaimIndexes: [1] }] }, receivedAt: "2026-08-26T00:01:05.000Z", usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }), "2026-08-26T00:01:04.000Z");
    authority.close(); const database = new DatabaseSync(path); try { return generateR003ResearcherAnalystHandoff(database, resumed.snapshot.caseId); } finally { database.close(); }
  } finally { rmSync(directory, { force: true, recursive: true }); }
}

const projection = await deterministicProjection();
const golden = JSON.parse(readFileSync(new URL("../../contracts/r003-researcher-analyst-handoff.json", import.meta.url), "utf8")) as unknown;
if (JSON.stringify(projection) !== JSON.stringify(golden)) throw new Error("checked-in Researcher/Analyst handoff is not the deterministic persisted-pipeline projection");
console.log(`HANDOFF ${JSON.stringify(projection)}`);
