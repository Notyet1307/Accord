import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeSyntheticIntake } from "../src/contracts/intake.js";
import {
  MAGICCHAT_APP_WEBSOCKET_CONTRACT,
  MAGICCHAT_SOURCE_COMMIT,
  normalizeMagicChatEnvelope,
} from "../src/contracts/magicchat.js";
import { MIGRATION_SHA256, R003_CORE_HANDOFF, serializeR003CoreHandoff } from "../src/contracts/handoff.js";
import {
  R003_MAGICCHAT_HANDOFF,
  serializeR003MagicChatHandoff,
} from "../src/contracts/magicchat-handoff.js";
import {
  CORE_DATABASE_SCHEMA_VERSION,
  CORE_TRANSACTION_AUTHORITY_TABLES,
  DATABASE_SCHEMA_VERSION,
  FIXED_WORKFLOW_DEFINITION,
  NORMALIZED_INTAKE_CONTRACT,
  SQLITE_PRAGMAS,
  TRANSACTION_AUTHORITY_TABLES,
} from "../src/contracts/versions.js";
import {
  LEGACY_MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
  PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
  SYNTHETIC_INTAKE,
} from "./fixture.js";

const repositoryRoot = new URL("../../", import.meta.url);

test("normalization accepts only the versioned synthetic intake contract", () => {
  const normalized = normalizeSyntheticIntake({
    ...SYNTHETIC_INTAKE,
    objective: "  Synthetic objective\r\nwith context  ",
  });
  assert.equal(normalized.schemaVersion, NORMALIZED_INTAKE_CONTRACT);
  assert.equal(normalized.synthetic, true);
  assert.equal(normalized.objective, "Synthetic objective\nwith context");
  assert.equal(normalized.receivedAt, "2026-08-26T00:00:00.000Z");
  assert.match(normalized.payloadDigest, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(normalized), true);
  assert.deepEqual(normalizeSyntheticIntake(normalized), normalized);

  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, synthetic: false }), /synthetic must be true/);
  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, schemaVersion: "v2" }), /schemaVersion/);
  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, extra: "not allowed" }), /keys must be exactly/);
  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, messageId: " message-1" }), /stable identifier/);
  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, cursor: 0 }), /positive safe integer/);
  assert.throws(
    () => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, receivedAt: "2026-08-26T08:00:00+08:00" }),
    /canonical UTC ISO-8601/,
  );
  assert.throws(() => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, receivedAt: "0" }), /canonical UTC ISO-8601/);
  assert.throws(
    () => normalizeSyntheticIntake({ ...SYNTHETIC_INTAKE, payloadDigest: "0".repeat(64) }),
    /payloadDigest does not match/,
  );
});

test("delivery identity ignores replay-variable envelope and receipt time", () => {
  const first = normalizeSyntheticIntake(SYNTHETIC_INTAKE);
  const replay = normalizeSyntheticIntake({
    ...SYNTHETIC_INTAKE,
    envelopeEventId: "event-2",
    receivedAt: "2026-08-26T00:05:00.000Z",
  });
  assert.equal(first.payloadDigest, replay.payloadDigest);
});

test("official-shaped reliable message events normalize only replay-stable business fields", () => {
  const normalized = normalizeMagicChatEnvelope(PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE);
  assert.deepEqual(normalized, {
    contractVersion: MAGICCHAT_APP_WEBSOCKET_CONTRACT,
    sourceCommit: MAGICCHAT_SOURCE_COMMIT,
    kind: "MESSAGE_CREATED",
    envelopeEventId: "event-delivery-1",
    cursor: 1,
    conversationId: "conversation-1",
    messageId: "message-1",
    messageSequence: 1,
    actorId: "actor-1",
    body: "Synthetic objective",
    messageCreatedAt: "2026-08-26T00:00:00.000Z",
  });
  assert.equal(Object.isFrozen(normalized), true);

  assert.throws(
    () => normalizeMagicChatEnvelope({ ...PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE, kind: "request" }),
    /event or response envelope/u,
  );
  assert.throws(() => normalizeMagicChatEnvelope(LEGACY_MAGICCHAT_MESSAGE_CREATED_ENVELOPE), /protocol version/u);
  assert.throws(
    () =>
      normalizeMagicChatEnvelope({
        ...PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
        cursor: 0,
      }),
    /cursor must be a positive safe integer/u,
  );
  assert.throws(
    () =>
      normalizeMagicChatEnvelope({
        ...PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE,
        payload: {
          ...PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE.payload,
          message: {
            ...PINNED_MAGICCHAT_MESSAGE_CREATED_ENVELOPE.payload.message,
            body: { type: "choice", content: "not a choice-free reply" },
          },
        },
      }),
    /choice-free text/u,
  );
});

test("the checked-in handoff exactly matches executable contract and migration facts", () => {
  const handoffFile = JSON.parse(
    readFileSync(new URL("contracts/r003-core-handoff.json", repositoryRoot), "utf8"),
  ) as unknown;
  assert.deepEqual(handoffFile, R003_CORE_HANDOFF);
  assert.equal(serializeR003CoreHandoff(), `HANDOFF ${JSON.stringify(handoffFile)}`);
  assert.equal(R003_CORE_HANDOFF.databaseSchemaVersion, CORE_DATABASE_SCHEMA_VERSION);
  assert.equal(DATABASE_SCHEMA_VERSION, 2);
  assert.equal(R003_CORE_HANDOFF.fixedWorkflowDefinition, FIXED_WORKFLOW_DEFINITION);
  assert.deepEqual(R003_CORE_HANDOFF.transactionAuthority, CORE_TRANSACTION_AUTHORITY_TABLES);
  assert.equal(TRANSACTION_AUTHORITY_TABLES.includes("magicchat_inbox_states"), true);
  assert.deepEqual(R003_CORE_HANDOFF.sqlitePragmas, SQLITE_PRAGMAS);
  assert.equal(Object.isFrozen(R003_CORE_HANDOFF), true);
  assert.equal(Object.isFrozen(R003_CORE_HANDOFF.migration), true);
  assert.equal(Object.isFrozen(SQLITE_PRAGMAS), true);

  const migration = readFileSync(new URL(R003_CORE_HANDOFF.migration.file, repositoryRoot), "utf8");
  assert.equal(createHash("sha256").update(migration, "utf8").digest("hex"), MIGRATION_SHA256);
});

test("the ingress handoff fixes the no-network protocol and same-Run RESEARCHER seam consumed by Issue 12", () => {
  const handoffFile = JSON.parse(
    readFileSync(new URL("contracts/r003-magicchat-handoff.json", repositoryRoot), "utf8"),
  ) as unknown;
  assert.deepEqual(handoffFile, R003_MAGICCHAT_HANDOFF);
  assert.equal(serializeR003MagicChatHandoff(), `HANDOFF ${JSON.stringify(handoffFile)}`);
  assert.equal(R003_MAGICCHAT_HANDOFF.databaseSchemaVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(R003_MAGICCHAT_HANDOFF.magicChat.sourceCommit, MAGICCHAT_SOURCE_COMMIT);
  assert.equal(R003_MAGICCHAT_HANDOFF.magicChat.appWebSocketContract, MAGICCHAT_APP_WEBSOCKET_CONTRACT);
  assert.equal(R003_MAGICCHAT_HANDOFF.magicChat.networkEnabled, false);
  assert.deepEqual(R003_MAGICCHAT_HANDOFF.receiptIdentity, ["app_id", "cursor"]);
  assert.deepEqual(R003_MAGICCHAT_HANDOFF.downstreamHandoff, {
    consumerIssue: 12,
    sameCase: true,
    sameRun: true,
    workflowNode: "RESEARCHER",
  });
  assert.deepEqual(R003_MAGICCHAT_HANDOFF.primarySeamClaims, {
    realMagicChatResourceCreated: false,
    scenarioS1Passed: false,
    scenarioS2Passed: false,
  });
  for (const migration of R003_MAGICCHAT_HANDOFF.migrations) {
    const source = readFileSync(new URL(migration.file, repositoryRoot), "utf8");
    assert.equal(createHash("sha256").update(source, "utf8").digest("hex"), migration.sha256);
  }
});

test("toolchain and strict compiler facts are exact in the clean snapshot", () => {
  const packageJson = JSON.parse(readFileSync(new URL("package.json", repositoryRoot), "utf8")) as {
    engines?: Record<string, unknown>;
    packageManager?: unknown;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
    type?: unknown;
  };
  const lockfile = JSON.parse(readFileSync(new URL("package-lock.json", repositoryRoot), "utf8")) as {
    lockfileVersion?: unknown;
    packages?: Record<string, Record<string, unknown>>;
  };
  const tsconfig = JSON.parse(readFileSync(new URL("tsconfig.json", repositoryRoot), "utf8")) as {
    compilerOptions?: Record<string, unknown>;
  };

  assert.equal(readFileSync(new URL(".node-version", repositoryRoot), "utf8"), "24.19.0\n");
  assert.equal(readFileSync(new URL(".nvmrc", repositoryRoot), "utf8"), "24.19.0\n");
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.engines, { node: "24.19.0", npm: "11.17.0" });
  assert.equal(packageJson.packageManager, "npm@11.17.0");
  assert.deepEqual(packageJson.devDependencies, { "@types/node": "24.13.3", typescript: "6.0.3" });
  assert.deepEqual(packageJson.optionalDependencies, { "node-bin-darwin-arm64": "24.19.0" });
  assert.equal(lockfile.lockfileVersion, 3);
  assert.equal(lockfile.packages?.["node_modules/typescript"]?.["version"], "6.0.3");
  assert.equal(lockfile.packages?.["node_modules/@types/node"]?.["version"], "24.13.3");
  assert.deepEqual(lockfile.packages?.["node_modules/node-bin-darwin-arm64"]?.["os"], ["darwin"]);
  assert.deepEqual(lockfile.packages?.["node_modules/node-bin-darwin-arm64"]?.["cpu"], ["arm64"]);
  assert.equal(lockfile.packages?.["node_modules/node-bin-darwin-arm64"]?.["optional"], true);
  assert.equal(lockfile.packages?.["node_modules/node-bin-darwin-arm64"]?.["version"], "24.19.0");
  assert.equal(tsconfig.compilerOptions?.["strict"], true);
  assert.equal(tsconfig.compilerOptions?.["noUncheckedIndexedAccess"], true);
  assert.equal(tsconfig.compilerOptions?.["module"], "NodeNext");
});
