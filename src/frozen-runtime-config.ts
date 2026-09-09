import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseCaseId, parseInvocationId, parseWorkflowRunId, type CaseId, type InvocationId, type WorkflowRunId } from "./core/ids.js";

export const FROZEN_RUNTIME_CONFIG_VERSION = "accord.frozen-runtime-config/v1" as const;
export const CONFIG_BOUND_PROFILE_CONTEXT_VERSION = "accord.profile-context/config-bound-v2" as const;
export const FROZEN_RUNTIME_CONFIG_MAX_BYTES = 131_072;
export const FROZEN_RUNTIME_POLICY = Object.freeze({
  workflowVersion: "r003-fixed/v1", runtimeVersion: "accord.native-turn-runtime/v1", providerPortVersion: "accord.native-baizhi-provider-port/v1",
  toolPolicy: "accord.read-only-context-tools/v1", permissionPolicy: "accord.profile-permissions/deny-all/v1",
  contextVersion: CONFIG_BOUND_PROFILE_CONTEXT_VERSION, targetVersion: "accord.reviewer-handoff-target/v1",
  magicChatFrameMaxBytes: 1_048_576, magicChatQueueMaxBytes: 4_194_304, magicChatQueueMaxEnvelopes: 64,
  magicChatHandshakeTimeoutMs: 10_000, magicChatCloseTimeoutMs: 5_000, magicChatRpcTimeoutMs: 30_000,
  providerRequestMaxBytes: 131_072, providerResponseMaxBytes: 1_048_576, providerWireMaxCharacters: 65_536, providerWireMaxBytes: 65_536,
  providerMaxOutputTokens: 8192, providerTimeoutMs: 120_000, sdkRetries: 0, httpRetries: 0, automaticReconnects: 0, invocationAttemptBudget: 2,
} as const);
export type FrozenProfile = "RESEARCHER" | "ANALYST" | "REVIEWER" | "WRITER";
export interface FrozenProfileConfiguration {
  readonly modelId: string; readonly profileVersion: string; readonly outputSchema: string;
  readonly instructions: string; readonly instructionsDigest: string;
}
export interface FrozenRuntimeConfiguration {
  readonly schemaVersion: typeof FROZEN_RUNTIME_CONFIG_VERSION;
  readonly configurationId: string; readonly revision: number;
  readonly magicChat: Readonly<{ endpoint: string; appId: string; credentialRef: string; authenticationIdentityRevision: number; transportVersion: "accord.magicchat-websocket-transport/v1" }>;
  readonly provider: Readonly<{ endpoint: string; deploymentId: string; credentialRef: string; authenticationIdentityRevision: number; transportVersion: "accord.baizhi-responses-transport/v1" }>;
  readonly profiles: Readonly<Record<FrozenProfile, FrozenProfileConfiguration>>;
  readonly policy: typeof FROZEN_RUNTIME_POLICY;
  readonly sourceManifestDigest: string;
  readonly executionWindow: Readonly<{ notBefore: string; deadline: string }>;
  readonly costLimitCny: null;
}
export interface FrozenRuntimeConfigurationReference { readonly configurationId: string; readonly revision: number; readonly digest: string; }
export interface AcceptedFrozenRuntimeConfiguration {
  readonly configuration: FrozenRuntimeConfiguration; readonly reference: FrozenRuntimeConfigurationReference;
  readonly canonicalJson: string; readonly acceptedAt: string;
}
function fail(code = "CONFIG_INVALID"): never { throw new Error(code); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.get === undefined)) fail();
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /[\p{Cc}\p{Cs}]/u.test(value)) fail();
  return value;
}
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(); return value; }
function hex(value: unknown): string { const result = text(value, 64); if (!/^[0-9a-f]{64}$/u.test(result)) fail(); return result; }
function instant(value: unknown): string {
  const result = text(value, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail();
  return result;
}
function identifier(value: unknown): string { const result = text(value, 160); if (!/^[A-Za-z][A-Za-z0-9._-]*$/u.test(result)) fail(); return result; }
function credentialReference(value: unknown): string {
  const result = text(value, 160);
  // An explicit logical namespace excludes URLs, expansions, bearer values and content digests.
  if (!/^credential-ref:[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(result) || /[0-9a-f]{64}/iu.test(result)) fail("CONFIG_CREDENTIAL_REFERENCE_INVALID");
  return result;
}
function endpoint(value: unknown, kind: "magicChat" | "provider"): string {
  const result = text(value, 2048); let url: URL;
  try { url = new URL(result); } catch { return fail(); }
  if (url.href !== result || url.username || url.password || url.search || url.hash || (kind === "magicChat" ? url.protocol !== "wss:" || url.pathname !== "/api/app/ws" : url.protocol !== "https:" || url.hostname !== "ai-api-gateway.app.baizhi.cloud" || url.port !== "" || url.pathname === "/")) fail();
  return result;
}
export function canonicalRuntimeJson(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item !== null && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(Reflect.get(item, key))])) : item;
  return JSON.stringify(canonical(value));
}
export function runtimeConfigurationDigest(value: unknown): string { return createHash("sha256").update(canonicalRuntimeJson(normalizeFrozenRuntimeConfiguration(value)), "utf8").digest("hex"); }
export function normalizeFrozenRuntimeConfiguration(value: unknown): FrozenRuntimeConfiguration {
  const config = object(value);
  exact(config, ["schemaVersion", "configurationId", "revision", "magicChat", "provider", "profiles", "policy", "sourceManifestDigest", "executionWindow", "costLimitCny"]);
  if (config["schemaVersion"] !== FROZEN_RUNTIME_CONFIG_VERSION) fail("CONFIG_VERSION_UNSUPPORTED");
  if (config["costLimitCny"] !== null) fail("COST_LIMIT_NOT_IMPLEMENTED");
  const magic = object(config["magicChat"]); exact(magic, ["endpoint", "appId", "credentialRef", "authenticationIdentityRevision", "transportVersion"]);
  const provider = object(config["provider"]); exact(provider, ["endpoint", "deploymentId", "credentialRef", "authenticationIdentityRevision", "transportVersion"]);
  if (magic["transportVersion"] !== "accord.magicchat-websocket-transport/v1" || provider["transportVersion"] !== "accord.baizhi-responses-transport/v1") fail("CONFIG_VERSION_UNSUPPORTED");
  const appId = text(magic["appId"]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(appId)) fail();
  const rawProfiles = object(config["profiles"]); const names = ["RESEARCHER", "ANALYST", "REVIEWER", "WRITER"] as const; exact(rawProfiles, names);
  const profiles = Object.fromEntries(names.map((name) => {
    const profile = object(rawProfiles[name]); exact(profile, ["modelId", "profileVersion", "outputSchema", "instructions", "instructionsDigest"]);
    const profileVersion = `accord.${name.toLowerCase()}/v1`; const outputSchema = `accord.${name.toLowerCase()}-output/v1`;
    if (profile["profileVersion"] !== profileVersion || profile["outputSchema"] !== outputSchema) fail("CONFIG_VERSION_UNSUPPORTED");
    const instructions = profile["instructions"];
    if (typeof instructions !== "string" || instructions.trim().length === 0 || instructions.length > FROZEN_RUNTIME_CONFIG_MAX_BYTES || Buffer.from(instructions, "utf8").toString("utf8") !== instructions) fail();
    const instructionsDigest = hex(profile["instructionsDigest"]);
    if (createHash("sha256").update(instructions, "utf8").digest("hex") !== instructionsDigest) fail("CONFIG_INSTRUCTIONS_DIGEST_MISMATCH");
    return [name, Object.freeze({ modelId: text(profile["modelId"], 160), profileVersion, outputSchema, instructions, instructionsDigest })];
  })) as Record<FrozenProfile, FrozenProfileConfiguration>;
  const policy = object(config["policy"]); exact(policy, Object.keys(FROZEN_RUNTIME_POLICY));
  if (Object.entries(FROZEN_RUNTIME_POLICY).some(([key, expected]) => policy[key] !== expected)) fail("CONFIG_POLICY_UNSUPPORTED");
  const window = object(config["executionWindow"]); exact(window, ["notBefore", "deadline"]);
  const notBefore = instant(window["notBefore"]); const deadline = instant(window["deadline"]); if (notBefore >= deadline) fail();
  const normalized: FrozenRuntimeConfiguration = Object.freeze({
    schemaVersion: FROZEN_RUNTIME_CONFIG_VERSION, configurationId: identifier(config["configurationId"]), revision: positive(config["revision"]),
    magicChat: Object.freeze({ endpoint: endpoint(magic["endpoint"], "magicChat"), appId, credentialRef: credentialReference(magic["credentialRef"]), authenticationIdentityRevision: positive(magic["authenticationIdentityRevision"]), transportVersion: "accord.magicchat-websocket-transport/v1" as const }),
    provider: Object.freeze({ endpoint: endpoint(provider["endpoint"], "provider"), deploymentId: text(provider["deploymentId"]), credentialRef: credentialReference(provider["credentialRef"]), authenticationIdentityRevision: positive(provider["authenticationIdentityRevision"]), transportVersion: "accord.baizhi-responses-transport/v1" as const }),
    profiles: Object.freeze(profiles), policy: FROZEN_RUNTIME_POLICY, sourceManifestDigest: hex(config["sourceManifestDigest"]), executionWindow: Object.freeze({ notBefore, deadline }), costLimitCny: null,
  });
  if (Buffer.byteLength(canonicalRuntimeJson(normalized), "utf8") > FROZEN_RUNTIME_CONFIG_MAX_BYTES) fail("CONFIG_TOO_LARGE");
  return normalized;
}
export function parseFrozenRuntimeConfiguration(wire: unknown): FrozenRuntimeConfiguration {
  if (typeof wire !== "string" || wire.length > FROZEN_RUNTIME_CONFIG_MAX_BYTES || Buffer.byteLength(wire, "utf8") > FROZEN_RUNTIME_CONFIG_MAX_BYTES) fail("CONFIG_TOO_LARGE");
  try { return normalizeFrozenRuntimeConfiguration(JSON.parse(wire) as unknown); } catch { return fail("CONFIG_INVALID"); }
}
export function normalizeRuntimeConfigurationReference(value: unknown): FrozenRuntimeConfigurationReference {
  const ref = object(value); exact(ref, ["configurationId", "revision", "digest"]);
  return Object.freeze({ configurationId: identifier(ref["configurationId"]), revision: positive(ref["revision"]), digest: hex(ref["digest"]) });
}
function row(database: DatabaseSync, sql: string, ...parameters: (string | number)[]): Record<string, unknown> | undefined { return database.prepare(sql).get(...parameters) as Record<string, unknown> | undefined; }
function supported(database: DatabaseSync): boolean { return row(database, "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'runtime_configurations'") !== undefined; }
function accepted(rowValue: Record<string, unknown>): AcceptedFrozenRuntimeConfiguration {
  const configuration = parseFrozenRuntimeConfiguration(rowValue["canonical_json"]);
  const digest = runtimeConfigurationDigest(configuration);
  if (rowValue["configuration_id"] !== configuration.configurationId || rowValue["revision"] !== configuration.revision || rowValue["schema_version"] !== configuration.schemaVersion || rowValue["config_digest"] !== digest || rowValue["canonical_json"] !== canonicalRuntimeJson(configuration)) fail("CONFIG_INTEGRITY_INVALID");
  return Object.freeze({ configuration, reference: Object.freeze({ configurationId: configuration.configurationId, revision: configuration.revision, digest }), canonicalJson: String(rowValue["canonical_json"]), acceptedAt: instant(rowValue["accepted_at"]) });
}
export function inspectRuntimeConfiguration(database: DatabaseSync, configurationId: unknown, revision: unknown): AcceptedFrozenRuntimeConfiguration | undefined {
  const id = identifier(configurationId); const rev = positive(revision);
  const found = row(database, "SELECT * FROM runtime_configurations WHERE configuration_id = ? AND revision = ?", id, rev);
  return found === undefined ? undefined : accepted(found);
}
export function acceptRuntimeConfiguration(database: DatabaseSync, value: unknown, now: unknown): AcceptedFrozenRuntimeConfiguration {
  const configuration = normalizeFrozenRuntimeConfiguration(value); const at = instant(now); const canonicalJson = canonicalRuntimeJson(configuration); const digest = runtimeConfigurationDigest(configuration);
  const old = inspectRuntimeConfiguration(database, configuration.configurationId, configuration.revision);
  if (old !== undefined) { if (old.reference.digest !== digest) fail("CONFIG_IDENTITY_CONFLICT"); return old; }
  database.prepare("INSERT INTO runtime_configurations (configuration_id, revision, schema_version, canonical_json, config_digest, accepted_at) VALUES (?, ?, ?, ?, ?, ?)").run(configuration.configurationId, configuration.revision, configuration.schemaVersion, canonicalJson, digest, at);
  return Object.freeze({ configuration, reference: Object.freeze({ configurationId: configuration.configurationId, revision: configuration.revision, digest }), canonicalJson, acceptedAt: at });
}
export function requireRuntimeConfiguration(database: DatabaseSync, value: unknown): AcceptedFrozenRuntimeConfiguration {
  const reference = normalizeRuntimeConfigurationReference(value);
  const found = inspectRuntimeConfiguration(database, reference.configurationId, reference.revision);
  if (found === undefined) fail("CONFIG_MISSING"); if (found.reference.digest !== reference.digest) fail("CONFIG_MISMATCH"); return found;
}
function bindingConfiguration(database: DatabaseSync, binding: Record<string, unknown>): AcceptedFrozenRuntimeConfiguration {
  instant(binding["bound_at"]);
  const result = requireRuntimeConfiguration(database, { configurationId: binding["configuration_id"], revision: binding["configuration_revision"], digest: binding["config_digest"] });
  if (String(binding["bound_at"]) < result.acceptedAt) fail("CONFIG_BINDING_INVALID");
  return result;
}
export function inspectRunRuntimeConfiguration(database: DatabaseSync, workflowRunId: WorkflowRunId): AcceptedFrozenRuntimeConfiguration | undefined {
  const id = parseWorkflowRunId(workflowRunId); if (!supported(database)) return undefined;
  const binding = row(database, "SELECT * FROM run_runtime_configurations WHERE workflow_run_id = ?", id); if (binding === undefined) return undefined;
  if (row(database, "SELECT 1 FROM workflow_runs WHERE workflow_run_id = ? AND case_id = ?", id, parseCaseId(binding["case_id"])) === undefined) fail("RUN_CONFIG_INVALID");
  return bindingConfiguration(database, binding);
}
export function bindRunRuntimeConfiguration(database: DatabaseSync, workflowRunId: WorkflowRunId, caseId: CaseId, reference: FrozenRuntimeConfigurationReference, now: string): AcceptedFrozenRuntimeConfiguration {
  const run = parseWorkflowRunId(workflowRunId); const caseKey = parseCaseId(caseId); const configuration = requireRuntimeConfiguration(database, reference); const at = instant(now);
  if (at < configuration.acceptedAt || row(database, "SELECT 1 FROM workflow_runs WHERE workflow_run_id = ? AND case_id = ?", run, caseKey) === undefined) fail("RUN_CONFIG_INVALID");
  const old = inspectRunRuntimeConfiguration(database, run);
  if (old !== undefined) { if (at < old.configuration.executionWindow.notBefore || at < old.acceptedAt || canonicalRuntimeJson(old.reference) !== canonicalRuntimeJson(configuration.reference)) fail("RUN_CONFIG_CONFLICT"); return old; }
  database.prepare("INSERT INTO run_runtime_configurations (workflow_run_id, case_id, configuration_id, configuration_revision, config_digest, bound_at) VALUES (?, ?, ?, ?, ?, ?)").run(run, caseKey, configuration.reference.configurationId, configuration.reference.revision, configuration.reference.digest, at);
  return configuration;
}
export function inspectInvocationRuntimeConfiguration(database: DatabaseSync, invocationId: InvocationId): AcceptedFrozenRuntimeConfiguration | undefined {
  const id = parseInvocationId(invocationId); if (!supported(database)) return undefined;
  const binding = row(database, "SELECT * FROM invocation_runtime_configurations WHERE invocation_id = ?", id); if (binding === undefined) return undefined;
  const invocation = row(database, "SELECT i.workflow_run_id, i.case_id, i.created_at, c.schema_version FROM runtime_invocations i JOIN profile_contexts c ON c.invocation_id = i.invocation_id WHERE i.invocation_id = ?", id);
  if (invocation === undefined || invocation["workflow_run_id"] !== binding["workflow_run_id"] || invocation["case_id"] !== binding["case_id"] || invocation["created_at"] !== binding["bound_at"] || invocation["schema_version"] !== CONFIG_BOUND_PROFILE_CONTEXT_VERSION) fail("INVOCATION_CONFIG_INVALID");
  const configuration = bindingConfiguration(database, binding); const run = inspectRunRuntimeConfiguration(database, parseWorkflowRunId(binding["workflow_run_id"]));
  if (run === undefined || canonicalRuntimeJson(run.reference) !== canonicalRuntimeJson(configuration.reference)) fail("INVOCATION_CONFIG_MISMATCH");
  const runBinding = row(database, "SELECT bound_at FROM run_runtime_configurations WHERE workflow_run_id = ?", parseWorkflowRunId(binding["workflow_run_id"]));
  if (runBinding === undefined || String(binding["bound_at"]) < String(runBinding["bound_at"])) fail("INVOCATION_CONFIG_INVALID");
  return configuration;
}
export function assertRuntimeConfigurationWindow(configuration: FrozenRuntimeConfiguration, now: unknown): void {
  const at = instant(now); if (at < configuration.executionWindow.notBefore) fail("CONFIG_WINDOW_NOT_STARTED"); if (at >= configuration.executionWindow.deadline) fail("CONFIG_WINDOW_EXPIRED");
}
export function preflightRuntimeConfiguration(database: DatabaseSync, reference: FrozenRuntimeConfigurationReference, supplied: unknown, now: string): AcceptedFrozenRuntimeConfiguration {
  const configuration = requireRuntimeConfiguration(database, reference);
  if (runtimeConfigurationDigest(supplied) !== configuration.reference.digest) fail("CONFIG_MISMATCH");
  assertRuntimeConfigurationWindow(configuration.configuration, now); return configuration;
}
export function assertRuntimeConfigurationSource(database: DatabaseSync, configuration: FrozenRuntimeConfiguration): void {
  const manifest = row(database, "SELECT manifest_digest, state FROM approved_synthetic_source_manifests WHERE manifest_id = 'source_manifest_r003_v1'");
  if (manifest?.["state"] !== "SEALED" || manifest["manifest_digest"] !== configuration.sourceManifestDigest) fail("CONFIG_SOURCE_MISMATCH");
}
export function validatePersistedRuntimeConfigurations(database: DatabaseSync): void {
  if (database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='runtime_configurations'").get() === undefined) return;
  const hasSourceManifest = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='approved_synthetic_source_manifests'").get() !== undefined;
  if (hasSourceManifest) for (const value of database.prepare("SELECT * FROM runtime_configurations").all()) {
    const configuration = accepted(value as Record<string, unknown>);
    const bound = database.prepare("SELECT 1 FROM run_runtime_configurations WHERE configuration_id = ? AND configuration_revision = ? AND config_digest = ? UNION SELECT 1 FROM invocation_runtime_configurations WHERE configuration_id = ? AND configuration_revision = ? AND config_digest = ?").get(configuration.reference.configurationId, configuration.reference.revision, configuration.reference.digest, configuration.reference.configurationId, configuration.reference.revision, configuration.reference.digest);
    if (bound !== undefined) assertRuntimeConfigurationSource(database, configuration.configuration);
  }
  for (const value of database.prepare("SELECT invocation_id FROM invocation_runtime_configurations").all()) {
    const configuration = inspectInvocationRuntimeConfiguration(database, parseInvocationId(value["invocation_id"]));
    if (configuration !== undefined) assertRuntimeConfigurationSource(database, configuration.configuration);
  }
  const mismatch = row(database, `SELECT 1 FROM profile_contexts c LEFT JOIN invocation_runtime_configurations b ON b.invocation_id = c.invocation_id WHERE (c.schema_version = ? AND (b.invocation_id IS NULL OR c.configuration_id <> b.configuration_id OR c.configuration_revision <> b.configuration_revision OR c.config_digest <> b.config_digest)) OR (c.schema_version = 'accord.profile-context/v1' AND (c.configuration_id IS NOT NULL OR c.configuration_revision IS NOT NULL OR c.config_digest IS NOT NULL))`, CONFIG_BOUND_PROFILE_CONTEXT_VERSION);
  if (mismatch !== undefined) fail("INVOCATION_CONFIG_MISMATCH");
}
