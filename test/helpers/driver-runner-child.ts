import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { mock } from "node:test";
import { FROZEN_RUNTIME_POLICY, REVIEWER_TARGET_POLICY_VERSION, normalizeFrozenRuntimeConfiguration } from "../../src/frozen-runtime-config.js";
import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { runR003Driver } from "../../src/driver/r003-driver.js";
import { connectMagicChatTransport } from "../../src/transports/magicchat-websocket.js";
import { prepareBaizhiResponsesPort } from "../../src/transports/baizhi-responses.js";
import { DeterministicMagicChatSimulator } from "../../src/magicchat/simulator.js";
import type { MagicChatRequestEnvelope } from "../../src/magicchat/adapter.js";
import { magicChatMessageCreatedEnvelope } from "../fixture.js";

const path = process.argv[2]; const mode = process.argv[3];
if (path === undefined || !["hold", "recover"].includes(mode ?? "")) throw new Error("DRIVER_CHILD_ARGUMENTS");
const now = "2026-08-26T00:02:02.000Z";
mock.timers.enable({ apis: ["Date"], now: Date.parse(now) });
const appId = "00000000-0000-0000-0000-000000000001";
const authority = openAuthorityDatabase(path);
authority.installTrustedSyntheticSourceManifest(now);
const raw = new DatabaseSync(path);
const manifest = raw.prepare("SELECT manifest_digest FROM approved_synthetic_source_manifests").get()?.["manifest_digest"]; raw.close();
const configuration = normalizeFrozenRuntimeConfiguration({ schemaVersion: "accord.frozen-runtime-config/v1", configurationId: "driver-child", revision: 1,
  magicChat: { endpoint: "wss://chat.example.test/api/app/ws", appId, credentialRef: "credential-ref:chat", authenticationIdentityRevision: 1, transportVersion: "accord.magicchat-websocket-transport/v2" },
  provider: { endpoint: "https://ai-api-gateway.app.baizhi.cloud/v1/responses", deploymentId: "fixture", credentialRef: "credential-ref:provider", authenticationIdentityRevision: 1, transportVersion: "accord.baizhi-responses-transport/v2" },
  profiles: Object.fromEntries(["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"].map((name) => { const instructions = `Run ${name}.`; return [name, { modelId: "fixture-model", profileVersion: `accord.${name.toLowerCase()}/${["REVIEWER", "WRITER"].includes(name) ? "v2" : "v1"}`, outputSchema: `accord.${name.toLowerCase()}-output/v1`, instructions, instructionsDigest: createHash("sha256").update(instructions).digest("hex") }]; })),
  policy: { ...FROZEN_RUNTIME_POLICY, targetVersion: REVIEWER_TARGET_POLICY_VERSION }, sourceManifestDigest: manifest, executionWindow: { notBefore: "2026-08-26T00:00:00.000Z", deadline: "2026-08-26T01:00:00.000Z" }, costLimitCny: null });
const simulator = new DeterministicMagicChatSimulator({ appId, firstMessageSequence: 2 });
let clarification: string | undefined; let calls = 0; let supplied = false;
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send(bytes: string, callback: (error?: Error) => void) {
    const request = JSON.parse(bytes) as MagicChatRequestEnvelope;
    const response = simulator.respond(request, now);
    if ("message" in response.payload) clarification = response.payload.message.id;
    callback(); queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify(response)), false));
  }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
const socket = new Socket(); const stop = new AbortController();
process.on("SIGTERM", () => stop.abort()); process.on("SIGINT", () => stop.abort());
try {
  const result = await runR003Driver({ authority, configuration, signal: stop.signal,
    report: (state) => {
      if (mode !== "hold") return;
      if (state === "WAIT_FOR_CASE") queueMicrotask(() => socket.emit("message", Buffer.from(JSON.stringify(magicChatMessageCreatedEnvelope())), false));
      if (state === "WAIT_FOR_INPUT" && !supplied) { supplied = true; const answer = magicChatMessageCreatedEnvelope({ body: "Two weeks", cursor: 2, envelopeEventId: "driver-child-answer", messageId: "driver-child-answer", messageSequence: 3, replyToMessageId: clarification!, messageCreatedAt: "2026-08-26T00:01:00Z" }); simulator.observeUserMessage(answer); queueMicrotask(() => socket.emit("message", Buffer.from(JSON.stringify(answer)), false)); }
    },
    ports: {
      connect: (receive, signal) => connectMagicChatTransport({ transportVersion: configuration.magicChat.transportVersion, url: configuration.magicChat.endpoint, appId, credential: "child-chat-canary" }, receive, () => { queueMicrotask(() => socket.emit("open")); return socket; }, signal),
      provider: (invocation, contract, signal) => {
        const port = prepareBaizhiResponsesPort({ transportVersion: configuration.provider.transportVersion, responsesUrl: configuration.provider.endpoint, deploymentId: "fixture", credential: "child-provider-canary", costLimitCny: null }, invocation, invocation.instructions!, () => { calls++; process.stdout.write("PROVIDER_STARTED\n"); return new Promise<Response>(() => undefined); }, contract, signal);
        return { ...port, configuration: invocation.configuration!, instructions: invocation.instructions! };
      },
    },
  });
  process.stdout.write(`${JSON.stringify({ state: result.state, reason: result.reason, calls })}\n`);
} finally { authority.close(); }
