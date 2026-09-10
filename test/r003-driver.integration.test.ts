import { tmpdir } from "node:os";
import { join } from "node:path";
import { MagicChatProtocolAdapter } from "../src/magicchat/adapter.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, writeFileSync, symlinkSync, lstatSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { FROZEN_RUNTIME_POLICY, REVIEWER_TARGET_POLICY_VERSION, normalizeFrozenRuntimeConfiguration } from "../src/frozen-runtime-config.js";
import { openAuthorityDatabase } from "../src/persistence/sqlite-authority.js";
import { runR003Driver, type DriverPorts } from "../src/driver/r003-driver.js";
import { DeterministicMagicChatSimulator, type SimulatedMagicChatMessageResponse } from "../src/magicchat/simulator.js";
import type { MagicChatRequestEnvelope } from "../src/magicchat/adapter.js";
import { prepareBaizhiResponsesPort } from "../src/transports/baizhi-responses.js";
import type { PreparedProfileInvocation } from "../src/researcher-analyst.js";
import type { InvocationBoundOutputContract } from "../src/profile-runtime.js";
import { temporaryDatabase, magicChatMessageCreatedEnvelope } from "./fixture.js";
import { choiceEnvelope } from "./helpers/c3-fixture.js";

const appId = "00000000-0000-0000-0000-000000000001";
const instant = "2026-08-26T00:02:02.000Z";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) { for (let i = 0; i < 100; i++) { if (predicate()) return; await turn(); } assert.fail("driver did not reach expected state"); }
function fixture(t: TestContext, providerVersion: "accord.baizhi-responses-transport/v2" | "accord.baizhi-responses-transport/v3" = "accord.baizhi-responses-transport/v2") {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
  const temporary = temporaryDatabase("driver");
  let authority = openAuthorityDatabase(temporary.path);
  const raw = new DatabaseSync(temporary.path);
  t.after(() => { raw.close(); authority.close(); temporary.cleanup(); });
  authority.installTrustedSyntheticSourceManifest(instant);
  const config = normalizeFrozenRuntimeConfiguration({ schemaVersion: "accord.frozen-runtime-config/v1", configurationId: "driver-fixture", revision: 1,
    magicChat: { endpoint: "wss://chat.example.test/api/app/ws", appId, credentialRef: "credential-ref:chat", authenticationIdentityRevision: 1, transportVersion: "accord.magicchat-websocket-transport/v2" },
    provider: { endpoint: "https://ai-api-gateway.app.baizhi.cloud/v1/responses", deploymentId: "fixture", credentialRef: "credential-ref:provider", authenticationIdentityRevision: 1, transportVersion: providerVersion },
    profiles: Object.fromEntries(["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"].map((name) => { const instructions = `Run ${name}.`; return [name, { modelId: "fixture-model", profileVersion: `accord.${name.toLowerCase()}/${["REVIEWER", "WRITER"].includes(name) ? "v2" : "v1"}`, outputSchema: `accord.${name.toLowerCase()}-output/v1`, instructions, instructionsDigest: hash(instructions) }]; })),
    policy: { ...FROZEN_RUNTIME_POLICY, targetVersion: REVIEWER_TARGET_POLICY_VERSION }, sourceManifestDigest: raw.prepare("SELECT manifest_digest FROM approved_synthetic_source_manifests").get()?.["manifest_digest"], executionWindow: { notBefore: "2026-08-26T00:00:00.000Z", deadline: "2026-08-26T01:00:00.000Z" }, costLimitCny: null });
  const simulator = new DeterministicMagicChatSimulator({ appId, firstMessageSequence: 2 });
  let receive: (envelope: unknown) => void = () => assert.fail("not connected");
  const states: string[] = []; const calls: string[] = []; const requests: MagicChatRequestEnvelope[] = [];
  const messages: SimulatedMagicChatMessageResponse[] = [];
  let failProvider = false; let losePublication = false;
  const ports: DriverPorts = {
    connect: async (handler) => {
      assert.equal(raw.prepare("SELECT count(*) AS n FROM runtime_configurations").get()?.["n"], 1);
      receive = handler;
      return { closed: new Promise<string>(() => undefined), close() {}, send: async (request) => { requests.push(request); const response = simulator.respond(request, instant); if ("message" in response.payload) messages.push(response as SimulatedMagicChatMessageResponse); if (losePublication && request.method === "message.send" && request.payload.message.type === "markdown") { losePublication = false; throw new Error("unconfirmed external acceptance"); } receive(response); } };
    },
    provider: (invocation, contract, signal) => {
      const port = prepareBaizhiResponsesPort({ transportVersion: config.provider.transportVersion, responsesUrl: config.provider.endpoint, deploymentId: "fixture", credential: "provider-canary-driver", costLimitCny: null }, invocation, invocation.instructions!, async (_url, init) => {
        calls.push(invocation.profile);
        if (failProvider) throw new Error("provider-canary-driver");
        const input = JSON.parse(String(JSON.parse(String(init.body)).input));
        if (contract !== undefined) { assert.equal(input.entries, undefined); assert.deepEqual(input.context, contract.providerInput); }
        const output = profileOutput(invocation, contract);
        return new Response(JSON.stringify({ id: `response-${calls.length}`, model: "fixture-model", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { headers: { "x-request-id": providerVersion.endsWith("/v3") ? `gateway-${calls.length}, upstream-${calls.length}` : `request-${calls.length}` } });
      }, contract, signal);
      return { ...port, configuration: invocation.configuration!, instructions: invocation.instructions! };
    },
  };
  const start = (retryUnknown?: Parameters<typeof runR003Driver>[0]["retryUnknown"]) => { const controller = new AbortController(); t.after(() => controller.abort()); const done = runR003Driver({ authority, configuration: config, ports, signal: controller.signal, report: (state) => states.push(state), ...(retryUnknown === undefined ? {} : { retryUnknown }) }); return { controller, done }; };
  const input = (envelope: ReturnType<typeof magicChatMessageCreatedEnvelope>) => { simulator.observeUserMessage(envelope); receive(envelope); };
  const intake = async () => { await until(() => states.includes("WAIT_FOR_CASE")); input(magicChatMessageCreatedEnvelope()); await until(() => messages.length > 0 && states.includes("WAIT_FOR_INPUT")); input(magicChatMessageCreatedEnvelope({ body: "Two weeks", cursor: 2, envelopeEventId: "driver-answer", messageId: "driver-answer", messageSequence: 3, replyToMessageId: messages[0]!.payload.message.id, messageCreatedAt: "2026-08-26T00:01:00Z" })); };
  return { get authority() { return authority; }, temporary, raw, config, states, calls, requests, messages, start, intake, ports, receive: (value: unknown) => receive(value), fail: () => { failProvider = true; }, losePublication: () => { losePublication = true; }, reopen: () => { authority.close(); authority = openAuthorityDatabase(temporary.path); } };
}
function profileOutput(invocation: PreparedProfileInvocation, contract?: InvocationBoundOutputContract): unknown {
  if (invocation.profile === "RESEARCHER") {
    const observation = invocation.entries.find((entry) => entry.type === "Observation")!; const source = invocation.approvedSources[0]!;
    return { evidenceRefs: [{ sourceId: source.sourceId, sourceKind: source.sourceKind, locator: source.locator, sourceDigest: hash(JSON.stringify(source.content)), observedAt: source.observedAt }], intents: [{ basedOn: [observation.id], objective: "Research", scope: "synthetic policy" }], observations: [{ basedOn: [observation.id], sourceRefs: [source.sourceId], statement: "Two weeks requested." }] };
  }
  if (invocation.profile === "ANALYST") { const evidence = invocation.entries.find((entry) => entry.type === "EvidenceRef")!; return { claims: [{ statement: "Two weeks supported.", supportingEntryIds: [evidence.id], unsupported: false }, { statement: "Guaranteed adoption.", supportingEntryIds: [], unsupported: true }], proposals: [{ action: "Two weeks.", supportStatus: "SUPPORTED", supportingClaimIndexes: [0] }, { action: "Promise adoption.", supportStatus: "UNSUPPORTED", supportingClaimIndexes: [1] }] }; }
  if (invocation.profile === "REVIEWER") {
    const view = contract!.providerInput as { target: { proposalId: string; proposalDigest: string }; entries: { type: string }[] };
    assert.equal(view.entries.filter((entry) => entry.type === "Proposal").length, 1);
    const target = { entryId: view.target.proposalId, digest: view.target.proposalDigest, type: "Proposal" };
    return { critique: { target, issue: "UNSUPPORTED_MATERIAL", severity: "MATERIAL", disposition: "ISSUE_UNSUPPORTED", rationale: "Unsupported." }, verificationResult: { target, method: "CITED_GRAPH_SUPPORT", result: "FAIL", supportingEvidenceRefs: [], disposition: "ISSUE_UNSUPPORTED", rationale: "Unsupported." } };
  }
  const input = contract!.providerInput as { bases: { entryId: string; statement: string }[] }; const basis = input.bases[0]!;
  return { materialAssertions: [{ basisEntryId: basis.entryId, statement: basis.statement }] };
}

for (const version of ["accord.baizhi-responses-transport/v2", "accord.baizhi-responses-transport/v3"] as const) test(`Driver ${version} serial four profiles, stable human waits, restart and unique publication`, async (t) => {
  const f = fixture(t, version); const first = f.start(); await f.intake();
  await until(() => f.messages.some((message) => message.payload.message.body.type === "choice"));
  await turn(); assert.deepEqual(f.calls, ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"]);
  const count = f.requests.length; await turn(); await turn(); assert.equal(f.requests.length, count);
  first.controller.abort(); assert.equal((await first.done).state, "STOPPED"); f.reopen();
  const resumed = f.start(); await turn();
  const card = f.messages.find((message) => message.payload.message.body.type === "choice")!;
  const request = f.requests.find((request) => request.method === "message.send" && request.payload.message.type === "choice")!;
  if (request.method !== "message.send" || card.payload.message.body.type !== "choice") throw new Error("choice missing");
  const confirmation = { request, card: { ...card.payload.message, body: card.payload.message.body } };
  const wrong = choiceEnvelope(confirmation); wrong.payload.response.created_at = instant; wrong.payload.sender.id = "different-actor"; f.receive(wrong);
  await until(() => f.requests.some((request) => request.method === "events.ack" && request.payload.cursor === 3));
  assert.equal(f.messages.filter((message) => message.payload.message.body.type === "markdown").length, 0);
  const choice = choiceEnvelope(confirmation, "approve", 4); choice.payload.response.created_at = instant; f.receive(choice); f.receive(choice);
  const result = await resumed.done; assert.equal(result.state, "COMPLETE", JSON.stringify(result)); assert.ok(result.trace);
  assert.equal(f.calls.length, 4); assert.ok(!result.trace.canonicalBytes.includes("provider-canary-driver"));
  if (version.endsWith("/v3")) assert.ok(result.trace.canonicalBytes.includes("gateway-1, upstream-1"));
  f.reopen(); const again = await f.start().done; assert.equal(again.state, "COMPLETE"); assert.equal(f.calls.length, 4);
});

for (const version of ["accord.baizhi-responses-transport/v2", "accord.baizhi-responses-transport/v3"] as const) test(`Driver ${version} UNKNOWN default stops; explicit retry acceptance is atomic, replayable and bounded`, async (t) => {
  const f = fixture(t, version); f.fail(); const first = f.start(); await f.intake(); assert.equal((await first.done).state, "UNKNOWN");
  assert.ok(f.states.includes("PROVIDER_TRANSPORT_ERROR"));
  assert.ok(!JSON.stringify(f.states).includes("provider-canary-driver"));
  f.reopen(); assert.equal((await f.start().done).state, "UNKNOWN"); assert.equal(f.calls.length, 1);
  const work = f.authority.inspectDriverWork(appId)!; const attempt = work.attempts[0]!.attemptId;
  await assert.rejects(f.authority.executePreparedAttempt(work.prepared!, f.ports.provider(work.prepared!, undefined, new AbortController().signal), instant), /UNKNOWN_RETRY_AUTHORIZATION_REQUIRED/u);
  assert.equal(f.calls.length, 1);
  f.raw.exec("CREATE TRIGGER reject_retry BEFORE INSERT ON audit_events WHEN NEW.event_kind LIKE 'UNKNOWN_RETRY_AUTHORIZED:%' BEGIN SELECT RAISE(ABORT, 'rollback'); END");
  assert.throws(() => f.authority.authorizeUnknownRetry(attempt, work.configuration!.digest, instant), /rollback/u);
  assert.equal(f.authority.inspectDriverWork(appId)!.attempts.length, 1); f.raw.exec("DROP TRIGGER reject_retry");
  const accepted = f.authority.authorizeUnknownRetry(attempt, work.configuration!.digest, instant); assert.equal(accepted.state, "READY");
  assert.equal(f.authority.authorizeUnknownRetry(attempt, work.configuration!.digest, instant).replayed, true);
  f.reopen(); assert.equal((await f.start(attempt).done).state, "FAILED"); assert.equal(f.calls.length, 2);
  f.reopen(); assert.equal((await f.start(attempt).done).state, "FAILED"); assert.equal(f.calls.length, 2);
  assert.throws(() => f.authority.authorizeUnknownRetry(attempt, "0".repeat(64), instant), /CONFIG_MISMATCH/u);
  f.raw.prepare("UPDATE audit_events SET details_json = ? WHERE event_kind LIKE 'UNKNOWN_RETRY_AUTHORIZED:%'").run("{}");
  assert.throws(() => f.reopen(), /UNKNOWN_RETRY_AUTHORIZATION_INVALID/u);
});

test("CLI rejects unsafe files and missing live before any executor; valid explicit inputs remain offline", async (t) => {
  const f = fixture(t);
  // @ts-expect-error The explicitly invoked JavaScript CLI is tested through its injected executor.
  const { runCli } = await import("../../scripts/run-r003.mjs");
  const configPath = `${f.temporary.path}.json`; const tokenPath = `${f.temporary.path}.tokens`;
  writeFileSync(configPath, JSON.stringify(f.config)); writeFileSync(tokenPath, JSON.stringify({ "credential-ref:chat": "chat-canary-driver", "credential-ref:provider": "provider-canary-driver" }), { mode: 0o600 });
  const args = ["--live", "--database", f.temporary.path, "--config", configPath, "--credentials", tokenPath];
  let calls = 0; const logs: string[] = []; const execute = async () => { calls++; return { state: "COMPLETE", reason: "COMPLETE" }; }; const write = (line: string) => logs.push(line);
  assert.equal(await runCli([], execute, write), 1); assert.equal(await runCli(args.slice(1), execute, write), 1);
  chmodSync(tokenPath, 0o644); assert.equal(await runCli(args, execute, write), 1); chmodSync(tokenPath, 0o600);
  const restricted = Reflect.get(process, "permission") !== undefined;
  const link = restricted ? join(tmpdir(), "driver-token-link") : `${tokenPath}.link`;
  if (restricted) writeFileSync(join(tmpdir(), "driver-token-target"), JSON.stringify({ "credential-ref:chat": "chat-canary-driver", "credential-ref:provider": "provider-canary-driver" }), { mode: 0o600 }); else symlinkSync(tokenPath, link);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(await runCli([...args.slice(0, -1), link], execute, write), 1); assert.equal(calls, 0);
  assert.equal(await runCli(args, execute, write), 0); assert.equal(calls, 1);
  const instructions = "Do not reveal provider-canary-driver";
  writeFileSync(configPath, JSON.stringify({ ...f.config, profiles: { ...f.config.profiles, RESEARCHER: { ...f.config.profiles.RESEARCHER, instructions, instructionsDigest: hash(instructions) } } }));
  assert.equal(await runCli(args, execute, write), 1); assert.equal(calls, 1);
  writeFileSync(configPath, JSON.stringify(f.config));
  writeFileSync(tokenPath, " ".repeat(16385)); assert.equal(await runCli(args, execute, write), 1); assert.equal(calls, 1);
  writeFileSync(tokenPath, JSON.stringify({ "credential-ref:chat": "chat-canary-driver", "credential-ref:provider": "provider-canary-driver", extra: "secret" }));
  assert.equal(await runCli(args, execute, write), 1); assert.equal(calls, 1); assert.ok(!logs.join().includes("canary"));
});

test("Driver durable receipt recovery advances without replaying the completed provider call", async (t) => {
  const f = fixture(t);
  f.raw.exec("CREATE TRIGGER stop_after_receipt BEFORE INSERT ON runtime_results BEGIN SELECT RAISE(ABORT, 'simulated crash after receipt'); END");
  const first = f.start(); await f.intake(); assert.equal((await first.done).state, "FAILED"); assert.deepEqual(f.calls, ["RESEARCHER"]);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM runtime_provider_deliveries").get()?.["n"], 1);
  f.raw.exec("DROP TRIGGER stop_after_receipt"); f.reopen();
  const next = f.start(); await until(() => f.messages.some((message) => message.payload.message.body.type === "choice"));
  assert.deepEqual(f.calls, ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"]);
  next.controller.abort(); await next.done;
});

test("Driver reconnect recovers an externally accepted publication using the same request identity", async (t) => {
  const f = fixture(t); f.losePublication(); const first = f.start(); await f.intake();
  await until(() => f.messages.some((message) => message.payload.message.body.type === "choice"));
  const card = f.messages.find((message) => message.payload.message.body.type === "choice")!;
  const request = f.requests.find((request) => request.method === "message.send" && request.payload.message.type === "choice")!;
  if (request.method !== "message.send" || card.payload.message.body.type !== "choice") throw new Error("choice missing");
  const choice = choiceEnvelope({ request, card: { ...card.payload.message, body: card.payload.message.body } }); choice.payload.response.created_at = instant;
  f.receive(choice); assert.equal((await first.done).state, "FAILED");
  const before = f.requests.at(-1)!; assert.equal(before.method, "message.send"); f.reopen();
  assert.equal((await f.start().done).state, "COMPLETE"); assert.equal(f.calls.length, 4);
  assert.equal(f.requests.filter((request) => request.id === before.id).length, 2);
  const published = f.messages.filter((message) => message.payload.message.body.type === "markdown");
  assert.equal(new Set(published.map((message) => message.payload.message.id)).size, 1);
});

test("Driver rejects legacy unbound execution before connecting or binding its Run", async (t) => {
  const f = fixture(t); const protocol = new MagicChatProtocolAdapter(f.authority, appId);
  const simulator = new DeterministicMagicChatSimulator({ appId, firstMessageSequence: 2 });
  const created = protocol.receive(magicChatMessageCreatedEnvelope(), instant); assert.ok(created.nextRequest);
  const sent = simulator.respond(created.nextRequest, instant); assert.ok("message" in sent.payload);
  const waiting = protocol.receive(sent, instant); assert.ok(waiting.nextRequest); protocol.receive(simulator.respond(waiting.nextRequest, instant), instant);
  const answer = protocol.receive(magicChatMessageCreatedEnvelope({ body: "Two weeks", cursor: 2, envelopeEventId: "legacy-answer", messageId: "legacy-answer", messageSequence: 3, replyToMessageId: sent.payload.message.id, messageCreatedAt: "2026-08-26T00:01:00Z" }), instant);
  f.authority.prepareProfileInvocation({ caseId: answer.snapshot.caseId, profile: "RESEARCHER", modelId: "fixture-model", now: instant });
  let connections = 0;
  const result = await runR003Driver({ authority: f.authority, configuration: f.config, signal: new AbortController().signal, ports: { ...f.ports, connect: async () => { connections++; throw new Error("must not connect"); } } });
  assert.equal(result.reason, "CONFIG_UNBOUND"); assert.equal(connections, 0); assert.equal(f.calls.length, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.raw.prepare("SELECT count(*) AS n FROM run_runtime_configurations").get()?.["n"], 0);
});

test("Driver deadline wakes a stable wait and stops without external work", async (t) => {
  const f = fixture(t); let waiting = false; let closed = false;
  const configuration = normalizeFrozenRuntimeConfiguration({ ...f.config, executionWindow: { ...f.config.executionWindow, deadline: new Date(Date.parse(instant) + 10).toISOString() } });
  const done = runR003Driver({ authority: f.authority, configuration, signal: new AbortController().signal, report: (state) => { waiting = state === "WAIT_FOR_CASE"; }, ports: { ...f.ports, connect: async () => ({ closed: new Promise<string>(() => undefined), close: () => { closed = true; }, send: async () => assert.fail("no outbound action") }) } });
  await until(() => waiting); t.mock.timers.setTime(Date.parse(instant) + 11);
  const result = await done; assert.equal(result.state, "STOPPED"); assert.equal(result.reason, "CONFIG_WINDOW_EXPIRED"); assert.equal(closed, true); assert.equal(f.calls.length, 0);
});
