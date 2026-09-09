import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { openAuthorityDatabase, normalizeFrozenRuntimeConfiguration } from "../src/index.js";

const digest = "0".repeat(64);
function config() {
  const profile = (name: string) => ({ modelId: `${name}-model`, profileVersion: `accord.${name.toLowerCase()}/v1`, outputSchema: `accord.${name.toLowerCase()}-output/v1`, instructions: `Run ${name}.`, instructionsDigest: digest });
  const profiles = Object.fromEntries(["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"].map((name) => { const item = profile(name); item.instructionsDigest = createHash("sha256").update(item.instructions).digest("hex"); return [name, item]; }));
  return { schemaVersion: "accord.frozen-runtime-config/v1", configurationId: "fixture", revision: 1, magicChat: { endpoint: "wss://chat.example.test/api/app/ws", appId: "00000000-0000-0000-0000-000000000001", credentialRef: "credential-ref:chat", authenticationIdentityRevision: 1, transportVersion: "accord.magicchat-websocket-transport/v1" }, provider: { endpoint: "https://ai-api-gateway.app.baizhi.cloud/v1/responses", deploymentId: "fixture", credentialRef: "credential-ref:provider", authenticationIdentityRevision: 1, transportVersion: "accord.baizhi-responses-transport/v1" }, profiles, policy: { workflowVersion: "r003-fixed/v1", runtimeVersion: "accord.native-turn-runtime/v1", providerPortVersion: "accord.native-baizhi-provider-port/v1", toolPolicy: "accord.read-only-context-tools/v1", permissionPolicy: "accord.profile-permissions/deny-all/v1", contextVersion: "accord.profile-context/config-bound-v2", targetVersion: "accord.reviewer-handoff-target/v1", magicChatFrameMaxBytes: 1048576, magicChatQueueMaxBytes: 4194304, magicChatQueueMaxEnvelopes: 64, magicChatHandshakeTimeoutMs: 10000, magicChatCloseTimeoutMs: 5000, magicChatRpcTimeoutMs: 30000, providerRequestMaxBytes: 131072, providerResponseMaxBytes: 1048576, providerWireMaxCharacters: 65536, providerWireMaxBytes: 65536, providerMaxOutputTokens: 8192, providerTimeoutMs: 120000, sdkRetries: 0, httpRetries: 0, automaticReconnects: 0, invocationAttemptBudget: 2 }, sourceManifestDigest: digest, executionWindow: { notBefore: "2026-01-01T00:00:00.000Z", deadline: "2027-01-01T00:00:00.000Z" }, costLimitCny: null };
}
test("normalizes and rejects config drift", () => {
  const value = config();
  const normalized = normalizeFrozenRuntimeConfiguration(value);
  assert.equal(normalized.configurationId, "fixture");
  assert.throws(() => normalizeFrozenRuntimeConfiguration({ ...value, unknown: true }));
  assert.throws(() => normalizeFrozenRuntimeConfiguration({ ...value, costLimitCny: 1 }));
});
test("accepts idempotently and preserves restart integrity", () => {
  const path = `${mkdtempSync(`${tmpdir()}/f1-`)}/authority.db`;
  const first = openAuthorityDatabase(path);
  const accepted = first.acceptRuntimeConfiguration(config(), "2026-01-02T00:00:00.000Z");
  const conflicting = { ...config(), provider: { ...config().provider, deploymentId: "other" } };
  assert.throws(() => first.acceptRuntimeConfiguration(conflicting, "2026-01-02T00:00:00.000Z"), /CONFIG_IDENTITY_CONFLICT/u);
  first.close();
  const reopened = openAuthorityDatabase(path);
  assert.deepEqual(reopened.inspectRuntimeConfiguration("fixture", 1), accepted);
  reopened.close();
});
