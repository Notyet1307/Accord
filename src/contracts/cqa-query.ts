import { createHash } from "node:crypto";

export interface CqaRequest {
  schemaVersion: "cqa.query/v1";
  requestId: string;
  question: string;
  topic: "mlps";
  asOfDate: string;
  jurisdiction: "CN";
  industry: string;
  caseId: string;
  invocationId: string;
  contextDigest: string;
}
export interface CqaSource {
  id: string;
  documentId: string;
  title: string;
  version: string;
  topic: string;
  jurisdiction: string;
  industry: string;
  publisher: string;
  sourceKind: "synthetic";
  uri: string;
  locator: string;
  publishedAt: string;
  effectiveFrom: string;
  effectiveTo?: string;
  validityCheckedAt: string;
  status: "in_force" | "repealed" | "draft" | "unknown";
  curatorReviewed: boolean;
  synthetic: true;
  keywords: string[];
  text: string;
  sha256: string;
}
export interface CqaCorpus {
  schemaVersion: "cqa.corpus/v1";
  datasetId: string;
  synthetic: true;
  sources: CqaSource[];
}
export interface CqaCitation {
  id: string;
  documentId: string;
  title: string;
  version: string;
  publisher: string;
  sourceKind: "synthetic";
  uri: string;
  locator: string;
  quote: string;
  sha256: string;
  publishedAt: string;
  effectiveFrom: string;
  effectiveTo?: string;
  validityCheckedAt: string;
  synthetic: true;
}
export interface CqaClaim { text: string; evidenceIds: string[] }
export interface CqaTokenUsage {
  status: "not_called" | "reported" | "partial" | "unknown";
  provider?: string;
  model?: string;
  inputTokens?: string;
  outputTokens?: string;
  totalTokens?: string;
  cachedInputTokens?: string;
  reasoningTokens?: string;
  diagnostic?: "CQA_USAGE_MISSING" | "CQA_USAGE_INVALID";
}
export interface CqaResult {
  schemaVersion: "cqa.result/v1";
  agentVersion: string;
  requestId: string;
  caseId: string;
  invocationId: string;
  contextDigest: string;
  inputDigest: string;
  configDigest: string;
  corpusDigest: string;
  status: "REFERENCE_ONLY" | "DRAFT_READY" | "INSUFFICIENT_EVIDENCE" | "NEEDS_REVIEW";
  dataMode: "synthetic_demo";
  generationMode: "extractive" | "llm";
  asOfDate: string;
  datasetId: string;
  claims: CqaClaim[];
  citations: CqaCitation[];
  reasonCodes: string[];
  warnings: string[];
  humanReviewRequired: true;
  entailmentVerified: false;
  generatedAt: string;
}
export interface CqaExpectation {
  request: CqaRequest;
  inputDigest: string;
  configDigest: string;
  corpus: CqaCorpus;
  corpusDigest: string;
  agentVersion: string;
  generationMode: "extractive" | "llm";
  provider?: string;
  model?: string;
}
// A candidate contains untrusted producer prose, not verification or human approval.
export interface CqaCandidate { result: CqaResult; usage: CqaTokenUsage; digest: string }

const safeId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const topics = ["mlps", "ciip", "security_policy", "industry", "commercial_crypto"];
const requestKeys = ["schemaVersion", "requestId", "question", "topic", "asOfDate", "jurisdiction", "industry", "caseId", "invocationId", "contextDigest"];
const sourceKeys = ["id", "documentId", "title", "version", "topic", "jurisdiction", "industry", "publisher", "sourceKind", "uri", "locator", "publishedAt", "effectiveFrom", "validityCheckedAt", "status", "curatorReviewed", "synthetic", "keywords", "text", "sha256"];
const citationKeys = ["id", "documentId", "title", "version", "publisher", "sourceKind", "uri", "locator", "quote", "sha256", "publishedAt", "effectiveFrom", "validityCheckedAt", "synthetic"];
const counters = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"] as const;

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function record(value: unknown, code = "CQA_SHAPE_INVALID"): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof JsonNumber), code);
  return value as Record<string, unknown>;
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = record(value);
  check(required.every(key => Object.hasOwn(obj, key)) && Object.keys(obj).every(key => required.includes(key) || optional.includes(key)), "CQA_FIELDS_INVALID");
  return obj;
}
function text(value: unknown, min = 1, max = 512 * 1024): asserts value is string {
  check(typeof value === "string" && value.isWellFormed() && Buffer.byteLength(value) >= min && Buffer.byteLength(value) <= max, "CQA_TEXT_INVALID");
}
// Go strings.TrimSpace uses Unicode White_Space, not ECMAScript's BOM-inclusive trim.
function trimmed(value: string): string { return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ""); }
function date(value: unknown): asserts value is string {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value), "CQA_DATE_INVALID");
  const parsed = new Date(`${value}T00:00:00Z`);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, "CQA_DATE_INVALID");
}
function strings(value: unknown, max: number): asserts value is string[] {
  check(Array.isArray(value) && value.length <= max, "CQA_ARRAY_INVALID");
  for (const item of value) text(item);
}

// Only numbers need a lossless representation. JSON.parse handles string escapes;
// this bounded traversal owns duplicate detection and never converts numeric tokens.
class JsonNumber { constructor(readonly raw: string) {} }
function strictJson(wire: string | Uint8Array, maxBytes: number): unknown {
  check(typeof wire === "string" || wire instanceof Uint8Array, "CQA_WIRE_INVALID");
  check((typeof wire === "string" ? Buffer.byteLength(wire) : wire.byteLength) <= maxBytes, "CQA_WIRE_TOO_LARGE");
  let input: string;
  if (typeof wire === "string") {
    check(wire.isWellFormed(), "CQA_UNICODE_INVALID");
    input = wire;
  } else {
    try { input = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(wire); }
    catch { throw new Error("CQA_UTF8_INVALID"); }
  }
  let at = 0;
  let nodes = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/u.test(input[at] ?? "x")) at++; };
  const string = (): string => {
    check(input[at] === '"', "CQA_JSON_INVALID");
    const start = at++;
    while (at < input.length) {
      const char = input[at++];
      if (char === "\\") { at++; continue; }
      if (char === '"') {
        let value: unknown;
        try { value = JSON.parse(input.slice(start, at)); }
        catch { throw new Error("CQA_JSON_INVALID"); }
        check(typeof value === "string" && value.isWellFormed(), "CQA_UNICODE_INVALID");
        return value;
      }
    }
    throw new Error("CQA_JSON_INVALID");
  };
  const visit = (depth: number): unknown => {
    check(depth <= 20 && ++nodes <= 100000, "CQA_JSON_BOUNDS");
    whitespace();
    const char = input[at];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      at++;
      const object: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const array: unknown[] = [];
      const close = char === "{" ? "}" : "]";
      whitespace();
      if (input[at] === close) { at++; return char === "{" ? object : array; }
      while (true) {
        if (char === "{") {
          whitespace();
          const key = string();
          check(!Object.hasOwn(object, key), "CQA_DUPLICATE_KEY");
          whitespace();
          check(input[at++] === ":", "CQA_JSON_INVALID");
          object[key] = visit(depth + 1);
        } else array.push(visit(depth + 1));
        whitespace();
        if (input[at] === close) { at++; return char === "{" ? object : array; }
        check(input[at++] === ",", "CQA_JSON_INVALID");
      }
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (input.startsWith(token, at)) { at += token.length; return value; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(input.slice(at));
    check(number, "CQA_JSON_INVALID");
    at += number[0].length;
    return new JsonNumber(number[0]);
  };
  const result = visit(0);
  whitespace();
  check(at === input.length, "CQA_JSON_TRAILING");
  return result;
}

export function cqaSha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function goJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export function parseCqaRequest(wire: string | Uint8Array): CqaRequest {
  const obj = fields(strictJson(wire, 64 * 1024), requestKeys);
  for (const key of requestKeys) text(obj[key]);
  check(obj["schemaVersion"] === "cqa.query/v1" && obj["topic"] === "mlps" && obj["jurisdiction"] === "CN", "CQA_REQUEST_SCOPE_INVALID");
  for (const key of ["requestId", "caseId", "invocationId"]) check(safeId.test(obj[key] as string), "CQA_ID_INVALID");
  check(digestPattern.test(obj["contextDigest"] as string), "CQA_CORRELATION_INVALID");
  text(obj["question"], 2, 8000);
  check(Buffer.byteLength(trimmed(obj["question"])) >= 2, "CQA_QUESTION_INVALID");
  text(obj["industry"], 1, 80);
  date(obj["asOfDate"]);
  return obj as unknown as CqaRequest;
}
export function cqaRequestBytes(request: CqaRequest): string {
  const r = parseCqaRequest(JSON.stringify(request));
  // Explicit order is the producer struct order, not alphabetical JSON canonicalization.
  return goJson({ schemaVersion: r.schemaVersion, requestId: r.requestId, question: r.question,
    topic: r.topic, asOfDate: r.asOfDate, jurisdiction: r.jurisdiction, industry: r.industry,
    ...(r.caseId ? { caseId: r.caseId } : {}), ...(r.invocationId ? { invocationId: r.invocationId } : {}),
    ...(r.contextDigest ? { contextDigest: r.contextDigest } : {}) });
}

export function parseCqaCorpus(wire: string | Uint8Array): CqaCorpus {
  const c = fields(strictJson(wire, 4 * 1024 * 1024), ["schemaVersion", "datasetId", "synthetic", "sources"]);
  text(c["datasetId"]);
  check(c["schemaVersion"] === "cqa.corpus/v1" && safeId.test(c["datasetId"]) && c["synthetic"] === true, "CQA_CORPUS_INVALID");
  check(Array.isArray(c["sources"]) && c["sources"].length <= 2000, "CQA_CORPUS_INVALID");
  const ids = new Set<string>();
  for (const value of c["sources"]) {
    const s = fields(value, sourceKeys, ["effectiveTo"]);
    for (const key of sourceKeys.filter(key => !["curatorReviewed", "synthetic", "keywords", "validityCheckedAt"].includes(key))) text(s[key]);
    const source = s as unknown as CqaSource;
    check(safeId.test(source.id) && safeId.test(source.documentId) && !ids.has(source.id), "CQA_SOURCE_ID_INVALID");
    ids.add(source.id);
    text(source.title, 1, 500);
    text(source.text, 1, 12000);
    check(topics.includes(source.topic) && source.jurisdiction === "CN" && typeof source.curatorReviewed === "boolean", "CQA_SOURCE_INVALID");
    check(source.synthetic === true && source.sourceKind === "synthetic" && source.uri.startsWith("fixture://"), "CQA_SYNTHETIC_REQUIRED");
    check(source.sha256 === cqaSha256(source.text), "CQA_SOURCE_DIGEST_MISMATCH");
    date(source.publishedAt); date(source.effectiveFrom);
    text(source.validityCheckedAt, 0);
    if (source.validityCheckedAt) {
      date(source.validityCheckedAt);
      check(source.validityCheckedAt >= source.publishedAt, "CQA_SOURCE_DATE_INVALID");
    }
    if (source.effectiveTo !== undefined) {
      text(source.effectiveTo, 0);
      if (source.effectiveTo) { date(source.effectiveTo); check(source.effectiveTo > source.effectiveFrom, "CQA_SOURCE_DATE_INVALID"); }
    }
    check(["in_force", "repealed", "draft", "unknown"].includes(source.status), "CQA_SOURCE_STATUS_INVALID");
    check(source.status !== "repealed" || source.effectiveTo, "CQA_SOURCE_INTERVAL_REQUIRED");
    strings(source.keywords, 32);
    check(source.keywords.length > 0, "CQA_SOURCE_KEYWORDS_INVALID");
    for (const keyword of source.keywords) {
      text(keyword, 2, 120);
      check(Buffer.byteLength(trimmed(keyword)) >= 2, "CQA_SOURCE_KEYWORDS_INVALID");
    }
  }
  return c as unknown as CqaCorpus;
}
export function cqaCorpusDigest(corpus: CqaCorpus): string {
  const c = parseCqaCorpus(JSON.stringify(corpus));
  return cqaSha256(goJson({ schemaVersion: c.schemaVersion, datasetId: c.datasetId, synthetic: c.synthetic,
    sources: c.sources.map(s => ({ id: s.id, documentId: s.documentId, title: s.title, version: s.version,
      topic: s.topic, jurisdiction: s.jurisdiction, industry: s.industry, publisher: s.publisher,
      sourceKind: s.sourceKind, uri: s.uri, locator: s.locator, publishedAt: s.publishedAt,
      effectiveFrom: s.effectiveFrom, ...(s.effectiveTo ? { effectiveTo: s.effectiveTo } : {}),
      validityCheckedAt: s.validityCheckedAt, status: s.status, curatorReviewed: s.curatorReviewed,
      synthetic: s.synthetic, keywords: s.keywords, text: s.text, sha256: s.sha256 })) }));
}

function inScopeInterval(source: CqaSource, request: CqaRequest): boolean {
  return source.topic === request.topic && source.jurisdiction === request.jurisdiction &&
    (source.industry === "all" || source.industry === request.industry) &&
    source.publishedAt <= request.asOfDate && source.effectiveFrom <= request.asOfDate &&
    (!source.effectiveTo || request.asOfDate < source.effectiveTo);
}
function tokenUsage(raw: unknown, expected: CqaExpectation, status: CqaResult["status"]): CqaTokenUsage {
  const unknown = (diagnostic: CqaTokenUsage["diagnostic"]): CqaTokenUsage => ({ status: "unknown", ...(diagnostic ? { diagnostic } : {}) });
  if (raw === undefined) return unknown("CQA_USAGE_MISSING");
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || raw instanceof JsonNumber) return unknown("CQA_USAGE_INVALID");
  const obj = raw as Record<string, unknown>;
  // Check known identities before any optional-usage fallback, even with bad counters/status.
  for (const key of ["provider", "model"] as const) {
    if (typeof obj[key] === "string" && obj[key] !== "") {
      check(expected.generationMode === "llm" && expected[key] !== undefined && obj[key] === expected[key], "CQA_MODEL_BINDING_MISMATCH");
    }
  }
  if (!Object.keys(obj).every(key => ["status", "provider", "model", ...counters].includes(key))) return unknown("CQA_USAGE_INVALID");
  const usage: CqaTokenUsage = { status: "unknown" };
  for (const key of ["provider", "model"] as const) {
    if (obj[key] !== undefined) {
      if (typeof obj[key] !== "string" || Buffer.byteLength(obj[key]) > 256) return unknown("CQA_USAGE_INVALID");
      if (obj[key]) usage[key] = obj[key];
    }
  }
  for (const key of counters) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    if (!(value instanceof JsonNumber) || !/^(?:0|[1-9]\d*)$/u.test(value.raw) || value.raw.length > 19 || BigInt(value.raw) > 9223372036854775807n) return unknown("CQA_USAGE_INVALID");
    usage[key] = value.raw;
  }
  const any = counters.some(key => usage[key] !== undefined);
  const complete = [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(value => value !== undefined);
  const inferred = complete ? "reported" : any ? "partial" : "unknown";
  if (obj["status"] === "not_called") {
    if (any || usage.provider || usage.model || (expected.generationMode === "llm" && status === "DRAFT_READY")) return unknown("CQA_USAGE_INVALID");
    usage.status = "not_called";
  } else {
    if (obj["status"] !== inferred || (expected.generationMode === "extractive" && any)) return unknown("CQA_USAGE_INVALID");
    usage.status = inferred;
  }
  return usage;
}

export function parseCqaResult(wire: string | Uint8Array, expected: CqaExpectation): CqaCandidate {
  const obj = fields(strictJson(wire, 512 * 1024), ["schemaVersion", "agentVersion", "requestId", "caseId", "invocationId", "contextDigest", "inputDigest", "configDigest", "corpusDigest", "status", "dataMode", "generationMode", "asOfDate", "datasetId", "claims", "citations", "reasonCodes", "warnings", "humanReviewRequired", "entailmentVerified", "generatedAt"], ["tokenUsage"]);
  const request = parseCqaRequest(JSON.stringify(expected.request));
  check(expected.inputDigest === cqaSha256(cqaRequestBytes(request)) && digestPattern.test(expected.configDigest) && expected.corpusDigest === cqaCorpusDigest(expected.corpus), "CQA_EXPECTATION_INVALID");
  text(expected.agentVersion, 1, 256);
  check(expected.generationMode === "extractive" || expected.generationMode === "llm", "CQA_EXPECTATION_INVALID");
  if (expected.generationMode === "llm") { text(expected.provider, 1, 256); text(expected.model, 1, 256); }
  const identities = { schemaVersion: "cqa.result/v1", agentVersion: expected.agentVersion, requestId: request.requestId,
    caseId: request.caseId, invocationId: request.invocationId, contextDigest: request.contextDigest,
    inputDigest: expected.inputDigest, configDigest: expected.configDigest, corpusDigest: expected.corpusDigest,
    dataMode: "synthetic_demo", generationMode: expected.generationMode, asOfDate: request.asOfDate, datasetId: expected.corpus.datasetId };
  for (const [key, value] of Object.entries(identities)) check(obj[key] === value, "CQA_RESULT_BINDING_MISMATCH");
  check(obj["humanReviewRequired"] === true && obj["entailmentVerified"] === false, "CQA_RESULT_FLAGS_INVALID");
  check(["REFERENCE_ONLY", "DRAFT_READY", "INSUFFICIENT_EVIDENCE", "NEEDS_REVIEW"].includes(String(obj["status"])), "CQA_RESULT_STATUS_INVALID");
  text(obj["generatedAt"], 20, 35);
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(obj["generatedAt"]), "CQA_RESULT_TIME_INVALID");
  date(obj["generatedAt"].slice(0, 10));
  check(Number.isFinite(Date.parse(obj["generatedAt"])) && new Date(obj["generatedAt"]).toISOString().replace(".000Z", "Z") === obj["generatedAt"], "CQA_RESULT_TIME_INVALID");
  strings(obj["reasonCodes"], 16); strings(obj["warnings"], 32);
  check(Array.isArray(obj["claims"]) && obj["claims"].length <= 5 && Array.isArray(obj["citations"]) && obj["citations"].length <= 5, "CQA_RESULT_CONTENT_INVALID");
  const result = obj as unknown as CqaResult;
  const success = result.status === "REFERENCE_ONLY" || result.status === "DRAFT_READY";
  if (success) check(result.status === (expected.generationMode === "extractive" ? "REFERENCE_ONLY" : "DRAFT_READY") && result.claims.length > 0 && result.citations.length > 0, "CQA_RESULT_MODE_INVALID");
  else check(result.claims.length === 0 && result.citations.length === 0, "CQA_RESULT_CONTENT_INVALID");
  const blockers = ["CURRENCY_UNVERIFIED", "SOURCE_NOT_REVIEWED_OR_NOT_EFFECTIVE", "OVERLAPPING_SOURCE_VERSIONS"];
  const missing = ["NO_ELIGIBLE_EVIDENCE", "MODEL_REPORTED_INSUFFICIENT_EVIDENCE"];
  check(new Set(result.reasonCodes).size === result.reasonCodes.length &&
    result.reasonCodes.every(reason => [...blockers, ...missing, "OUTSIDE_EFFECTIVE_INTERVAL"].includes(reason)), "CQA_RESULT_REASONS_INVALID");
  check(!success || !result.reasonCodes.some(reason => reason !== "OUTSIDE_EFFECTIVE_INTERVAL"), "CQA_RESULT_REASONS_INVALID");
  if (result.status === "NEEDS_REVIEW") check(result.reasonCodes.some(reason => blockers.includes(reason)) &&
    !result.reasonCodes.some(reason => missing.includes(reason)), "CQA_RESULT_REASONS_INVALID");
  if (result.status === "INSUFFICIENT_EVIDENCE") check(result.reasonCodes.some(reason => missing.includes(reason)) &&
    !result.reasonCodes.some(reason => blockers.includes(reason)) &&
    (expected.generationMode === "llm" || !result.reasonCodes.includes("MODEL_REPORTED_INSUFFICIENT_EVIDENCE")), "CQA_RESULT_REASONS_INVALID");
  const citations = new Map<string, CqaSource>();
  for (const value of result.citations) {
    const citation = fields(value, citationKeys, ["effectiveTo"]);
    const source = expected.corpus.sources.find(item => item.id === citation["id"]);
    check(source && !citations.has(source.id) && inScopeInterval(source, request) &&
      source.curatorReviewed && source.status !== "draft" && source.status !== "unknown" &&
      source.validityCheckedAt >= request.asOfDate, "CQA_CITATION_NOT_ELIGIBLE");
    // Inspect the frozen versions, not merely the citations chosen by the producer.
    check(!expected.corpus.sources.some(other => other.documentId === source.documentId &&
      other.locator === source.locator && inScopeInterval(other, request) &&
      (other.version !== source.version || other.sha256 !== source.sha256)), "CQA_SOURCE_CONFLICT");
    for (const key of citationKeys) {
      const sourceValue = key === "quote" ? source.text : (source as unknown as Record<string, unknown>)[key];
      check(citation[key] === sourceValue, "CQA_CITATION_METADATA_MISMATCH");
    }
    if (Object.hasOwn(citation, "effectiveTo")) text(citation["effectiveTo"], 0);
    check((citation["effectiveTo"] ?? "") === (source.effectiveTo ?? ""), "CQA_CITATION_METADATA_MISMATCH");
    citations.set(source.id, source);
  }
  const used = new Set<string>();
  for (const value of result.claims) {
    const claim = fields(value, ["text", "evidenceIds"]);
    text(claim["text"], 1, 12000);
    check(trimmed(claim["text"]) !== "", "CQA_CLAIM_INVALID");
    strings(claim["evidenceIds"], 5);
    check(claim["evidenceIds"].length > 0 && new Set(claim["evidenceIds"]).size === claim["evidenceIds"].length, "CQA_CLAIM_INVALID");
    for (const id of claim["evidenceIds"]) { check(citations.has(id), "CQA_CLAIM_EVIDENCE_MISSING"); used.add(id); }
  }
  check(citations.size === used.size, "CQA_CITATION_UNUSED");
  if (success && expected.generationMode === "extractive") {
    check(result.claims.length === citations.size && result.claims.every(claim =>
      claim.evidenceIds.length === 1 && claim.text === citations.get(claim.evidenceIds[0] ?? "")?.text) &&
      new Set(result.claims.map(claim => claim.evidenceIds[0])).size === citations.size, "CQA_EXTRACTIVE_CONTENT_MISMATCH");
  }
  const usage = tokenUsage(obj["tokenUsage"], expected, result.status);
  delete obj["tokenUsage"];
  return { result, usage, digest: cqaSha256(wire) };
}
