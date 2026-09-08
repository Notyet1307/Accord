import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { CaseTraceError, R003_CASE_TRACE_REDACTION_VERSION, R003_CASE_TRACE_VERSION } from "../src/case-trace.js";
import { c3Fixture, confirmC3Approval } from "./helpers/c3-fixture.js";

test("C4 Case Trace is complete, deterministic, allowlisted and read-only", async (t) => {
  const fixture = await c3Fixture("c4-trace", t);
  try {
    confirmC3Approval(fixture);
    const before = new DatabaseSync(fixture.temporary.path, { readOnly: true });
    let dataVersion: number;
    try { dataVersion = Number(before.prepare("PRAGMA data_version").get()?.["data_version"]); } finally { before.close(); }

    const first = fixture.authority.generateCaseTrace(fixture.caseId);
    const second = fixture.authority.generateCaseTrace(fixture.caseId);
    assert.equal(first.canonicalBytes, second.canonicalBytes);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.trace["schemaVersion"], R003_CASE_TRACE_VERSION);
    assert.equal(first.trace["redactionPolicyVersion"], R003_CASE_TRACE_REDACTION_VERSION);
    assert.ok(Buffer.byteLength(first.canonicalBytes, "utf8") < 1_048_576);

    const parsed = JSON.parse(first.canonicalBytes) as Record<string, unknown>;
    const entries = parsed["boardEntries"] as readonly Record<string, unknown>[];
    const runtime = parsed["runtime"] as readonly Record<string, unknown>[];
    assert.deepEqual([...new Set(entries.map((entry) => entry["entryType"]))].sort(), ["ArtifactRef", "Claim", "Critique", "EvidenceRef", "Intent", "Observation", "Proposal", "Question", "VerificationResult"]);
    assert.deepEqual(runtime.map((invocation) => invocation["nodeId"]), ["ANALYST", "RESEARCHER", "REVIEWER", "WRITER"]);
    assert.ok(!first.canonicalBytes.includes("content_markdown"));
    assert.ok(!first.canonicalBytes.includes("approved_sources_json"));
    assert.ok(!first.canonicalBytes.includes("replayable_response_json"));
    assert.ok(!first.canonicalBytes.includes("raw_response_json"));
    assert.ok(!first.canonicalBytes.includes("request_json"));
    assert.ok(!first.canonicalBytes.includes("confirmation_json"));

    const after = new DatabaseSync(fixture.temporary.path, { readOnly: true });
    try { assert.equal(Number(after.prepare("PRAGMA data_version").get()?.["data_version"]), dataVersion); } finally { after.close(); }
  } finally { fixture.close(); }
});

test("C4 Case Trace distinguishes unknown Case and output limit failures", async (t) => {
  const fixture = await c3Fixture("c4-trace-errors", t);
  try {
    assert.throws(() => fixture.authority.generateCaseTrace(`case_${"0".repeat(64)}`), (error) => error instanceof CaseTraceError && error.code === "UNKNOWN_CASE");
    assert.throws(() => fixture.authority.generateCaseTrace(fixture.caseId, 1), (error) => error instanceof CaseTraceError && error.code === "OUTPUT_LIMIT");
  } finally { fixture.close(); }
});
