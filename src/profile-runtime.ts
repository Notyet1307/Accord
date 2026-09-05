import { createHash } from "node:crypto";

import {
  deriveRuntimeBoardEntryId,
  parseBoardEntryId,
  type AttemptId,
  type BoardEntryId,
  type ResultId,
} from "./core/ids.js";
import type { PreparedProfileInvocation } from "./researcher-analyst.js";

export const GENERIC_MATERIALIZATION_SCHEMA_VERSION = "accord.runtime-generic-materialization/v1" as const;
export type GenericProfile = "REVIEWER" | "WRITER";
export type GenericEntryType = "EvidenceRef" | "Observation" | "Question" | "Intent" | "Claim" | "Proposal" | "Critique" | "VerificationResult" | "ArtifactRef";
export type HandoffId = string & { readonly __brand: "HandoffId" };

export type GenericBoardEntryCandidate = Readonly<{
  entryType: GenericEntryType;
  payload: Readonly<Record<string, unknown>>;
  basedOn: readonly BoardEntryId[];
  sourceRefs: readonly BoardEntryId[];
}>;
export type GenericHandoffCandidate = Readonly<{
  kind: string;
  version: string;
  payload: Readonly<Record<string, unknown>>;
}>;
export type GenericMaterializationCandidate = Readonly<{
  boardEntries: readonly GenericBoardEntryCandidate[];
  handoff?: GenericHandoffCandidate;
}>;
export interface InvocationBoundOutputContract {
  readonly invocationId: PreparedProfileInvocation["invocationId"];
  readonly contextDigest: string;
  readonly profile: GenericProfile;
  readonly profileVersion: string;
  readonly outputSchema: string;
  readonly materialize: (context: Readonly<PreparedProfileInvocation>, output: unknown) => GenericMaterializationCandidate;
}
export type DurableGenericBoardEntry = GenericBoardEntryCandidate & Readonly<{
  entryId: BoardEntryId;
  contentDigest: string;
}>;
export type DurableGenericHandoff = GenericHandoffCandidate & Readonly<{
  handoffId: HandoffId;
  payloadDigest: string;
  boardEntries: readonly Readonly<{ entryId: BoardEntryId; contentDigest: string }>[];
}>;
export type DurableGenericMaterialization = Readonly<{
  schemaVersion: typeof GENERIC_MATERIALIZATION_SCHEMA_VERSION;
  profile: GenericProfile;
  profileVersion: string;
  outputSchema: string;
  contextId: PreparedProfileInvocation["contextId"];
  contextDigest: string;
  invocationId: PreparedProfileInvocation["invocationId"];
  attemptId: AttemptId;
  resultId: ResultId;
  caseId: PreparedProfileInvocation["caseId"];
  workflowRunId: PreparedProfileInvocation["workflowRunId"];
  boardId: PreparedProfileInvocation["boardId"];
  batchRevision: number;
  boardEntries: readonly DurableGenericBoardEntry[];
  handoff?: DurableGenericHandoff;
}>;

const ENTRY_TYPES: Record<GenericEntryType, true> = {
  EvidenceRef: true,
  Observation: true,
  Question: true,
  Intent: true,
  Claim: true,
  Proposal: true,
  Critique: true,
  VerificationResult: true,
  ArtifactRef: true,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))]));
  return value;
}
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return createHash("sha256").update(json(value), "utf8").digest("hex"); }
function record(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has an unsupported or missing field`); }
function scalar(value: unknown, label: string, max = 160): string { if (typeof value !== "string" || value.length < 1 || value.length > max || value.trim() !== value || /[\p{Cc}\p{Cs}]/u.test(value)) throw new TypeError(`${label} must be a bounded, trimmed string`); return value; }
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }

function boundedJson(value: unknown, label: string): Readonly<Record<string, unknown>> {
  let nodes = 0;
  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 256 || depth > 8) throw new TypeError(`${label} exceeds its JSON shape bound`);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { if (item.length > 4_096 || /[\p{Cs}]/u.test(item)) throw new TypeError(`${label} contains an invalid string`); return item; }
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) { if (item.length > 16) throw new TypeError(`${label} array is too large`); return Object.freeze(item.map((child) => visit(child, depth + 1))); }
    const object = record(item, label); const keys = Object.keys(object).sort();
    if (keys.length > 32 || keys.some((key) => key.length < 1 || key.length > 160 || /[\p{Cc}\p{Cs}]/u.test(key))) throw new TypeError(`${label} object is too large`);
    return Object.freeze(Object.fromEntries(keys.map((key) => [key, visit(object[key], depth + 1)])));
  };
  const normalized = visit(value, 0);
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized) || Buffer.byteLength(json(normalized), "utf8") > 16_384) throw new TypeError(`${label} must be a bounded JSON object`);
  return normalized as Readonly<Record<string, unknown>>;
}

function normalizeRelations(value: unknown, allowed: ReadonlySet<BoardEntryId>, label: string): readonly BoardEntryId[] {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError(`${label} must be a bounded array`);
  const ids = value.map(parseBoardEntryId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.has(id))) throw new TypeError(`${label} must uniquely reference this immutable Context`);
  return Object.freeze(ids);
}

/** Validates one explicit fixed-Profile descriptor before provider I/O. */
export function assertInvocationBoundOutputContract(context: Readonly<PreparedProfileInvocation>, contract: InvocationBoundOutputContract | undefined): asserts contract is InvocationBoundOutputContract {
  if ((context.profile !== "REVIEWER" && context.profile !== "WRITER") || contract === undefined || contract.invocationId !== context.invocationId || contract.contextDigest !== context.contextDigest || contract.profile !== context.profile || contract.profileVersion !== context.profileVersion || contract.outputSchema !== context.outputSchema || typeof contract.materialize !== "function") throw new TypeError("output contract does not match the persisted Invocation Profile, version, schema, and Context");
}

/** Calls the pure adapter with only the immutable prepared Context projection. */
export function materializeInvocationOutput(context: Readonly<PreparedProfileInvocation>, output: unknown, contract: InvocationBoundOutputContract | undefined): GenericMaterializationCandidate {
  assertInvocationBoundOutputContract(context, contract);
  const raw = record(contract.materialize(freeze(context), freeze(output)), "output contract materialization");
  exact(raw, Object.hasOwn(raw, "handoff") ? ["boardEntries", "handoff"] : ["boardEntries"], "output contract materialization");
  if (!Array.isArray(raw["boardEntries"]) || raw["boardEntries"].length < 1 || raw["boardEntries"].length > 16) throw new TypeError("output contract must return one to sixteen Board candidates");
  const allowed = new Set(context.entries.map((entry) => entry.id));
  const boardEntries = Object.freeze(raw["boardEntries"].map((value, index) => {
    const item = record(value, `Board candidate ${index}`); exact(item, ["basedOn", "entryType", "payload", "sourceRefs"], `Board candidate ${index}`);
    const entryType = scalar(item["entryType"], `Board candidate ${index} type`, 32) as GenericEntryType;
    if (!Object.hasOwn(ENTRY_TYPES, entryType)) throw new TypeError(`Board candidate ${index} type is unsupported`);
    return Object.freeze({ entryType, payload: boundedJson(item["payload"], `Board candidate ${index} payload`), basedOn: normalizeRelations(item["basedOn"], allowed, `Board candidate ${index} basedOn`), sourceRefs: normalizeRelations(item["sourceRefs"], allowed, `Board candidate ${index} sourceRefs`) });
  }));
  if (raw["handoff"] === undefined) return Object.freeze({ boardEntries });
  const handoff = record(raw["handoff"], "Handoff candidate"); exact(handoff, ["kind", "payload", "version"], "Handoff candidate");
  return Object.freeze({ boardEntries, handoff: Object.freeze({ kind: scalar(handoff["kind"], "Handoff kind"), version: scalar(handoff["version"], "Handoff version"), payload: boundedJson(handoff["payload"], "Handoff payload") }) });
}

/** Adds only Runtime-derived identities and exact winner provenance. */
export function deriveDurableGenericMaterialization(context: Readonly<PreparedProfileInvocation>, attemptId: AttemptId, resultId: ResultId, candidate: GenericMaterializationCandidate): DurableGenericMaterialization {
  if (context.profile !== "REVIEWER" && context.profile !== "WRITER") throw new TypeError("generic materialization requires Reviewer or Writer Context");
  const boardEntries = Object.freeze(candidate.boardEntries.map((entry, index) => {
    const entryId = deriveRuntimeBoardEntryId({ invocationId: context.invocationId, entryType: entry.entryType, index });
    const immutable = { authorId: context.profile, authorType: "AGENT", basedOn: entry.basedOn, contradicts: [], entryType: entry.entryType, instructionAuthority: "NONE", payload: entry.payload, sourceRefs: entry.sourceRefs, status: "CANDIDATE", supersedes: [], trustLevel: "CANDIDATE", visibility: "CASE" };
    return Object.freeze({ ...entry, entryId, contentDigest: digest(immutable) });
  }));
  const core = { schemaVersion: GENERIC_MATERIALIZATION_SCHEMA_VERSION, profile: context.profile, profileVersion: context.profileVersion, outputSchema: context.outputSchema, contextId: context.contextId, contextDigest: context.contextDigest, invocationId: context.invocationId, attemptId, resultId, caseId: context.caseId, workflowRunId: context.workflowRunId, boardId: context.boardId, batchRevision: context.boardRevision + 1, boardEntries } as const;
  if (candidate.handoff === undefined) return Object.freeze(core);
  const links = Object.freeze(boardEntries.map(({ entryId, contentDigest }) => Object.freeze({ entryId, contentDigest })));
  const payloadDigest = digest(candidate.handoff.payload);
  const handoffId = `handoff_${digest({ attemptId, batchRevision: core.batchRevision, boardEntries: links, boardId: context.boardId, caseId: context.caseId, contextDigest: context.contextDigest, contextId: context.contextId, invocationId: context.invocationId, kind: candidate.handoff.kind, outputSchema: context.outputSchema, payloadDigest, profile: context.profile, profileVersion: context.profileVersion, resultId, schemaVersion: GENERIC_MATERIALIZATION_SCHEMA_VERSION, version: candidate.handoff.version, workflowRunId: context.workflowRunId })}` as HandoffId;
  return Object.freeze({ ...core, handoff: Object.freeze({ ...candidate.handoff, handoffId, payloadDigest, boardEntries: links }) });
}

/** Re-derives the exact generic winner projection stored in its arrival audit. */
export function parseDurableGenericMaterialization(context: Readonly<PreparedProfileInvocation>, attemptId: AttemptId, resultId: ResultId, value: unknown): DurableGenericMaterialization {
  const raw = record(value, "persisted generic materialization");
  const keys = ["attemptId", "batchRevision", "boardEntries", "boardId", "caseId", "contextDigest", "contextId", "invocationId", "outputSchema", "profile", "profileVersion", "resultId", "schemaVersion", "workflowRunId", ...(Object.hasOwn(raw, "handoff") ? ["handoff"] : [])];
  exact(raw, keys, "persisted generic materialization");
  if (!Array.isArray(raw["boardEntries"])) throw new TypeError("persisted generic Board entries must be an array");
  const candidateEntries = raw["boardEntries"].map((value, index) => { const entry = record(value, `persisted generic Board entry ${index}`); exact(entry, ["basedOn", "contentDigest", "entryId", "entryType", "payload", "sourceRefs"], `persisted generic Board entry ${index}`); return { basedOn: entry["basedOn"], entryType: entry["entryType"], payload: entry["payload"], sourceRefs: entry["sourceRefs"] }; });
  let handoff: GenericHandoffCandidate | undefined;
  if (raw["handoff"] !== undefined) { const persisted = record(raw["handoff"], "persisted generic Handoff"); exact(persisted, ["boardEntries", "handoffId", "kind", "payload", "payloadDigest", "version"], "persisted generic Handoff"); handoff = { kind: persisted["kind"] as string, version: persisted["version"] as string, payload: persisted["payload"] as Readonly<Record<string, unknown>> }; }
  const replayContract: InvocationBoundOutputContract = { invocationId: context.invocationId, contextDigest: context.contextDigest, profile: context.profile as GenericProfile, profileVersion: context.profileVersion, outputSchema: context.outputSchema, materialize: () => ({ boardEntries: candidateEntries as readonly GenericBoardEntryCandidate[], ...(handoff === undefined ? {} : { handoff }) }) };
  const derived = deriveDurableGenericMaterialization(context, attemptId, resultId, materializeInvocationOutput(context, undefined, replayContract));
  if (json(derived) !== json(raw)) throw new Error("persisted generic materialization identities, digest, links, or provenance drifted");
  return derived;
}
