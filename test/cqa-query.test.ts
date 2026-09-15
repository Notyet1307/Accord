import assert from "node:assert/strict";
import test from "node:test";
import {
  cqaCorpusDigest, cqaRequestBytes, cqaSha256, parseCqaCorpus, parseCqaRequest, parseCqaResult,
  type CqaCitation, type CqaCorpus, type CqaExpectation, type CqaRequest, type CqaResult, type CqaSource,
} from "../src/contracts/cqa-query.js";

const request: CqaRequest = {
  schemaVersion: "cqa.query/v1", requestId: "query-1", question: "  等保 <&>\u2028\u2029\n",
  topic: "mlps", asOfDate: "2026-09-01", jurisdiction: "CN", industry: "education",
  caseId: "case-1", invocationId: "invocation-1", contextDigest: "a".repeat(64),
};
const source: CqaSource = {
  id: "source-1", documentId: "document-1", title: "合成资料", version: "v1", topic: "mlps",
  jurisdiction: "CN", industry: "all", publisher: "Synthetic publisher", sourceKind: "synthetic",
  uri: "fixture://document-1", locator: "section-1", publishedAt: "2026-01-01",
  effectiveFrom: "2026-02-01", validityCheckedAt: "2026-09-10", status: "in_force",
  curatorReviewed: true, synthetic: true, keywords: ["等保"], text: "这是合成等保资料。",
  sha256: cqaSha256("这是合成等保资料。"),
};
const corpus: CqaCorpus = { schemaVersion: "cqa.corpus/v1", datasetId: "synthetic-1", synthetic: true, sources: [source] };
const citation: CqaCitation = {
  id: source.id, documentId: source.documentId, title: source.title, version: source.version,
  publisher: source.publisher, sourceKind: source.sourceKind, uri: source.uri, locator: source.locator,
  quote: source.text, sha256: source.sha256, publishedAt: source.publishedAt,
  effectiveFrom: source.effectiveFrom, validityCheckedAt: source.validityCheckedAt, synthetic: true,
};
const expected: CqaExpectation = {
  request, inputDigest: cqaSha256(cqaRequestBytes(request)), configDigest: "b".repeat(64),
  corpus, corpusDigest: cqaCorpusDigest(corpus), agentVersion: "0.1.0-starter", generationMode: "extractive",
};
const result: CqaResult = {
  schemaVersion: "cqa.result/v1", agentVersion: expected.agentVersion, requestId: request.requestId,
  caseId: request.caseId, invocationId: request.invocationId, contextDigest: request.contextDigest,
  inputDigest: expected.inputDigest, configDigest: expected.configDigest, corpusDigest: expected.corpusDigest,
  status: "REFERENCE_ONLY", dataMode: "synthetic_demo", generationMode: "extractive", asOfDate: request.asOfDate,
  datasetId: corpus.datasetId, claims: [{ text: source.text, evidenceIds: [source.id] }], citations: [citation],
  reasonCodes: [], warnings: ["Synthetic reference only; not a legal conclusion."],
  humanReviewRequired: true, entailmentVerified: false, generatedAt: "2026-09-01T01:02:03Z",
};
const modelExpected: CqaExpectation = { ...expected, generationMode: "llm", provider: "baizhi-chat", model: "grok-4.6" };
const modelResult: CqaResult = { ...result, generationMode: "llm", status: "DRAFT_READY" };

function modelWire(usage: string): string {
  return JSON.stringify(modelResult).replace(/\}$/u, `,"tokenUsage":${usage}}`);
}

test("Go Request marshal vector preserves question bytes, struct order and HTML escapes", () => {
  const goBytes = '{"schemaVersion":"cqa.query/v1","requestId":"query-1","question":"  等保 \\u003c\\u0026\\u003e\\u2028\\u2029\\n","topic":"mlps","asOfDate":"2026-09-01","jurisdiction":"CN","industry":"education","caseId":"case-1","invocationId":"invocation-1","contextDigest":"' + "a".repeat(64) + '"}';
  assert.equal(cqaRequestBytes(request), goBytes);
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(request).reverse()), null, 2) + "\n";
  assert.equal(cqaRequestBytes(parseCqaRequest(reordered)), goBytes);
  assert.notEqual(cqaSha256(reordered), cqaSha256(goBytes));
  assert.notEqual(cqaSha256(cqaRequestBytes({ ...request, question: request.question.trim() })), cqaSha256(goBytes));
  assert.throws(() => parseCqaRequest(JSON.stringify({ ...request, caseId: "" })), /CQA_/u);
  assert.throws(() => parseCqaRequest(JSON.stringify({ ...request, question: "\u0085 \u0085" })), /CQA_QUESTION_INVALID/u);
  assert.throws(() => parseCqaRequest(JSON.stringify({ ...request, asOfDate: "2026-02-29" })), /CQA_DATE_INVALID/u);
});

test("Go corpus digest uses source struct order and omits empty effectiveTo without sorting arrays", () => {
  const sourceBytes = '{"id":"source-1","documentId":"document-1","title":"合成资料","version":"v1","topic":"mlps","jurisdiction":"CN","industry":"all","publisher":"Synthetic publisher","sourceKind":"synthetic","uri":"fixture://document-1","locator":"section-1","publishedAt":"2026-01-01","effectiveFrom":"2026-02-01","validityCheckedAt":"2026-09-10","status":"in_force","curatorReviewed":true,"synthetic":true,"keywords":["等保"],"text":"这是合成等保资料。","sha256":"' + source.sha256 + '"}';
  const goBytes = '{"schemaVersion":"cqa.corpus/v1","datasetId":"synthetic-1","synthetic":true,"sources":[' + sourceBytes + ']}';
  assert.equal(cqaCorpusDigest(corpus), cqaSha256(goBytes));
  const reordered = { ...corpus, sources: [{ ...Object.fromEntries(Object.entries(source).reverse()), effectiveTo: "" }] };
  assert.equal(cqaCorpusDigest(parseCqaCorpus(JSON.stringify(reordered))), cqaSha256(goBytes));
  const second: CqaSource = { ...source, id: "source-2", documentId: "document-2" };
  assert.notEqual(cqaCorpusDigest({ ...corpus, sources: [source, second] }), cqaCorpusDigest({ ...corpus, sources: [second, source] }));
  assert.throws(() => parseCqaCorpus(JSON.stringify({ ...corpus, sources: [{ ...source, text: "forged text" }] })), /CQA_SOURCE_DIGEST_MISMATCH/u);
});

test("strict wire rejects escaped duplicate keys, malformed Unicode, invalid UTF8 and mixed output", () => {
  const wire = JSON.stringify(request);
  assert.throws(() => parseCqaRequest(wire.replace('"requestId":', '"requestId":"other","request\\u0049d":')), /CQA_DUPLICATE_KEY/u);
  assert.throws(() => parseCqaRequest(wire.replace('"question":', '"extra":true,"question":')), /CQA_FIELDS_INVALID/u);
  assert.throws(() => parseCqaRequest(wire.replace('"question":', '"question":"\\ud800","unused":')), /CQA_UNICODE_INVALID/u);
  assert.throws(() => parseCqaRequest(wire + "\ud800"), /CQA_UNICODE_INVALID/u);
  assert.throws(() => parseCqaRequest(Buffer.concat([Buffer.from(wire), Buffer.from([0xc0, 0xaf])])), /CQA_UTF8_INVALID/u);
  assert.throws(() => parseCqaRequest(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(wire)])), /CQA_JSON_INVALID/u);
  assert.throws(() => parseCqaRequest(wire + " {}"), /CQA_JSON_TRAILING/u);
  assert.throws(() => parseCqaResult("log line\n" + JSON.stringify(result), expected), /CQA_JSON_INVALID/u);
  assert.throws(() => parseCqaRequest(" ".repeat(64 * 1024 + 1)), /CQA_WIRE_TOO_LARGE/u);
  assert.throws(() => parseCqaResult(" ".repeat(512 * 1024 + 1), expected), /CQA_WIRE_TOO_LARGE/u);
  assert.throws(() => parseCqaResult(modelWire("[".repeat(21) + "0" + "]".repeat(21)), modelExpected), /CQA_JSON_BOUNDS/u);
  assert.throws(() => parseCqaResult(modelWire("[" + "0,".repeat(100000) + "0]"), modelExpected), /CQA_JSON_BOUNDS/u);
  const valid = { ...request, question: "等保 😀" };
  assert.equal(parseCqaRequest(Buffer.from(JSON.stringify(valid))).question, valid.question);
});

test("usage preserves int64 precision, explicit zero, missing counts and independent total", () => {
  const candidate = parseCqaResult(modelWire('{"status":"reported","provider":"baizhi-chat","model":"grok-4.6","inputTokens":9007199254740993,"outputTokens":0,"totalTokens":9223372036854775807,"cachedInputTokens":2}'), modelExpected);
  assert.deepEqual(candidate.usage, { status: "reported", provider: "baizhi-chat", model: "grok-4.6", inputTokens: "9007199254740993", outputTokens: "0", totalTokens: "9223372036854775807", cachedInputTokens: "2" });
  assert.equal(Object.hasOwn(candidate.result, "tokenUsage"), false);
  const partial = parseCqaResult(modelWire('{"status":"partial","reasoningTokens":0}'), modelExpected);
  assert.deepEqual(partial.usage, { status: "partial", reasoningTokens: "0" });
  assert.deepEqual(parseCqaResult(modelWire('{"status":"unknown"}'), modelExpected).usage, { status: "unknown" });
  assert.deepEqual(parseCqaResult(JSON.stringify({ ...result, tokenUsage: { status: "not_called" } }), expected).usage, { status: "not_called" });
});

test("malformed optional usage keeps valid content but clear model mismatch always rejects", () => {
  for (const usage of ["null", "[]", '{"status":"partial","inputTokens":9223372036854775808}', '{"status":"partial","inputTokens":"3"}', '{"status":"partial","inputTokens":1e3}', '{"status":"partial","inputTokens":-1}', '{"status":"reported","inputTokens":1}', '{"status":"partial","inputTokens":1,"future":true}']) {
    const candidate = parseCqaResult(modelWire(usage), modelExpected);
    assert.equal(candidate.result.claims[0]?.text, source.text);
    assert.deepEqual(candidate.usage, { status: "unknown", diagnostic: "CQA_USAGE_INVALID" });
  }
  assert.deepEqual(parseCqaResult(JSON.stringify(result), expected).usage, { status: "unknown", diagnostic: "CQA_USAGE_MISSING" });
  assert.throws(() => parseCqaResult(modelWire('{"status":"invalid","inputTokens":-1,"provider":"other"}'), modelExpected), /CQA_MODEL_BINDING_MISMATCH/u);
  assert.throws(() => parseCqaResult(modelWire('{"status":[],"model":"other"}'), modelExpected), /CQA_MODEL_BINDING_MISMATCH/u);
  assert.throws(() => parseCqaResult(modelWire('{"status":"unknown","model":"grok-4.6","m\\u006fdel":"other"}'), modelExpected), /CQA_DUPLICATE_KEY/u);
});

test("candidate binding, flags, source metadata and claim references cannot be forged", () => {
  for (const changed of [
    { ...result, configDigest: "c".repeat(64) }, { ...result, contextDigest: "c".repeat(64) },
    { ...result, humanReviewRequired: false }, { ...result, entailmentVerified: true },
    { ...result, status: "DRAFT_READY" }, { ...result, truncated: true },
    { ...result, citations: [{ ...citation, quote: "forged text" }] },
    { ...result, citations: [{ ...citation, uri: "https://untrusted.example/" }] },
    { ...result, citations: [{ ...citation, sha256: "0".repeat(64) }] },
    { ...result, claims: [{ text: source.text, evidenceIds: ["missing"] }] },
    { ...result, claims: [{ text: "forged extractive answer", evidenceIds: [source.id] }] },
  ]) assert.throws(() => parseCqaResult(JSON.stringify(changed), expected), /^Error: CQA_[A-Z_]+$/u);
  const wire = JSON.stringify(result) + "\n";
  assert.equal(parseCqaResult(wire, expected).digest, cqaSha256(wire));
});

test("frozen metadata and uncited versions prevent expired, unreviewed and conflicting citations", () => {
  for (const replacement of [
    { ...source, effectiveTo: "2026-09-01", status: "repealed" as const },
    { ...source, validityCheckedAt: "2026-08-31" }, { ...source, curatorReviewed: false },
    { ...source, industry: "finance" }, { ...source, topic: "ciip" },
  ]) {
    const snapshot: CqaCorpus = { ...corpus, sources: [replacement] };
    const binding: CqaExpectation = { ...expected, corpus: snapshot, corpusDigest: cqaCorpusDigest(snapshot) };
    assert.throws(() => parseCqaResult(JSON.stringify({ ...result, corpusDigest: binding.corpusDigest }), binding), /CQA_CITATION_NOT_ELIGIBLE/u);
  }
  const conflicting: CqaCorpus = { ...corpus, sources: [source, { ...source, id: "uncited", version: "v2", keywords: ["another keyword"] }] };
  const binding: CqaExpectation = { ...expected, corpus: conflicting, corpusDigest: cqaCorpusDigest(conflicting) };
  assert.throws(() => parseCqaResult(JSON.stringify({ ...result, corpusDigest: binding.corpusDigest }), binding), /CQA_SOURCE_CONFLICT/u);
  const review = parseCqaResult(JSON.stringify({ ...result, corpusDigest: binding.corpusDigest, status: "NEEDS_REVIEW", claims: [], citations: [], reasonCodes: ["OVERLAPPING_SOURCE_VERSIONS"] }), binding);
  assert.equal(review.result.status, "NEEDS_REVIEW");
  assert.equal(review.result.humanReviewRequired, true);
});

test("insufficient and review remain non-conclusions and cannot hide successful content", () => {
  const insufficient = { ...result, status: "INSUFFICIENT_EVIDENCE", claims: [], citations: [], reasonCodes: ["NO_ELIGIBLE_EVIDENCE"] };
  assert.equal(parseCqaResult(JSON.stringify(insufficient), expected).result.status, "INSUFFICIENT_EVIDENCE");
  assert.throws(() => parseCqaResult(JSON.stringify({ ...insufficient, claims: result.claims }), expected), /CQA_RESULT_CONTENT_INVALID/u);
  assert.throws(() => parseCqaResult(JSON.stringify({ ...result, reasonCodes: ["OVERLAPPING_SOURCE_VERSIONS"] }), expected), /CQA_RESULT_REASONS_INVALID/u);
  assert.throws(() => parseCqaResult(JSON.stringify({ ...insufficient, status: "NEEDS_REVIEW" }), expected), /CQA_RESULT_REASONS_INVALID/u);
  assert.equal(parseCqaResult(JSON.stringify(modelResult), modelExpected).result.status, "DRAFT_READY");
});
