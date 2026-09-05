import {
  generateR003ResearcherAnalystHandoff,
  parseArrivalId,
  parseAttemptId,
  parseBoardId,
  parseBoardEntryId,
  parseCaseId,
  parseContextId,
  parseInvocationId,
  parseResponseId,
  parseResultId,
  parseSourceId,
  parseWorkflowRunId,
  type PreparedAttempt,
  type PreparedProfileInvocation,
  type ProfileInvocationRequest,
  type ProviderPort,
  type ProviderWire,
  type ResultArbitration,
} from "../src/index.js";
import { beginPreparedAttempt, commitProviderResult, executePreparedAttempt, prepareProfileInvocation, reconstructGenericWinnerMaterialization, reconstructWinnerBoardEntries, recordUnknownRuntimeArrival } from "../src/researcher-analyst.js";
import { deriveRuntimeAuditEventId } from "../src/core/ids.js";
import type { InvocationBoundOutputContract } from "../src/profile-runtime.js";
import type { DatabaseSync } from "node:sqlite";

const caseId = parseCaseId("case_0000000000000000000000000000000000000000000000000000000000000000");
const boardId = parseBoardId("board_0000000000000000000000000000000000000000000000000000000000000000");
const invocationId = parseInvocationId("invocation_0000000000000000000000000000000000000000000000000000000000000000");
const attemptId = parseAttemptId("attempt_0000000000000000000000000000000000000000000000000000000000000000");
const arrivalId = parseArrivalId("arrival_0000000000000000000000000000000000000000000000000000000000000000");
const entryId = parseBoardEntryId("entry_0000000000000000000000000000000000000000000000000000000000000000");
const contextId = parseContextId("context_0000000000000000000000000000000000000000000000000000000000000000");
const responseId = parseResponseId("response_0000000000000000000000000000000000000000000000000000000000000000");
const resultId = parseResultId("result_0000000000000000000000000000000000000000000000000000000000000000");
const runId = parseWorkflowRunId("run_0000000000000000000000000000000000000000000000000000000000000000");
const sourceId = parseSourceId("source_0000000000000000000000000000000000000000000000000000000000000000");

const request: ProfileInvocationRequest = { caseId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" };
const attempt: PreparedAttempt = { attemptId, attemptNumber: 1, invocationId, noSdkRetry: true };
declare const prepared: PreparedProfileInvocation;
declare const port: ProviderPort;
declare const result: ProviderWire;
declare const reviewer: PreparedProfileInvocation & Readonly<{ profile: "REVIEWER" }>;
const genericContract: InvocationBoundOutputContract = {
  invocationId,
  contextDigest: "0".repeat(64),
  profile: "REVIEWER",
  profileVersion: "accord.reviewer/v1",
  outputSchema: "accord.reviewer-output/v1",
  materialize() { return { boardEntries: [{ basedOn: [entryId], entryType: "Critique", payload: { text: "reviewed" }, sourceRefs: [] }] }; },
};
// @ts-expect-error an Analyst cannot supply a Reviewer-or-Writer materialization contract.
const nonGenericProfileContract: InvocationBoundOutputContract = { ...genericContract, profile: "ANALYST" };
// @ts-expect-error an Attempt cannot bind a generic output contract to an Invocation.
const wrongGenericContract: InvocationBoundOutputContract = { ...genericContract, invocationId: attemptId };

// @ts-expect-error Case and Board identities are intentionally incompatible.
const wrongCase: ProfileInvocationRequest = { caseId: boardId, modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" };
// @ts-expect-error an Attempt cannot be substituted for its Invocation.
const wrongAttempt: PreparedAttempt = { attemptId, attemptNumber: 1, invocationId: attemptId, noSdkRetry: true };
// @ts-expect-error arbitrary strings cannot cross the branded public request seam.
const rawCase: ProfileInvocationRequest = { caseId: "case_not_branded", modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" };

function assertExportedSeamsAreBranded(database: DatabaseSync): void {
  const arbitration: ResultArbitration = { arrivalId, attemptId, boardRevision: 1, invocationId, outcome: "WINNER", proposalBoardRevision: 1, responseId, resultId };
  void arbitration;
  void contextId;
  void entryId;
  void resultId;
  void runId;
  void sourceId;
  // @ts-expect-error a Board ID cannot claim an Invocation.
  beginPreparedAttempt(database, boardId, "2026-08-26T00:01:02.000Z");
  // @ts-expect-error a raw string cannot enter the semantic Attempt claim seam.
  beginPreparedAttempt(database, "invocation_not_branded", "2026-08-26T00:01:02.000Z");
  // @ts-expect-error prepareProfileInvocation rejects a raw Case identity at the public seam.
  prepareProfileInvocation(database, { caseId: "case_not_branded", modelId: "fixture-model", now: "2026-08-26T00:01:02.000Z", profile: "RESEARCHER" });
  // @ts-expect-error a Result cannot be used where an Attempt is required for result arbitration.
  commitProviderResult(database, prepared, { ...attempt, attemptId: resultId }, result);
  // @ts-expect-error caller-owned provider objects cannot cross the serialized wire seam.
  commitProviderResult(database, prepared, attempt, { output: {} });
  // @ts-expect-error a ProviderPort cannot return an object-valued result.
  const objectResultPort: ProviderPort = { complete() { return { output: {} }; } };
  void objectResultPort;
  // @ts-expect-error a Result cannot be used where an Invocation is required to reconstruct a winner graph.
  reconstructWinnerBoardEntries(database, resultId, {});
  // @ts-expect-error executePreparedAttempt keeps the Invocation identity distinct from a Result identity.
  executePreparedAttempt(database, { ...prepared, invocationId: resultId }, port, "2026-08-26T00:01:02.000Z");
  const genericPort: ProviderPort = { outputContract: genericContract, complete() { return result; } };
  commitProviderResult(database, reviewer, attempt, result, undefined, genericContract);
  executePreparedAttempt(database, reviewer, genericPort, "2026-08-26T00:01:02.000Z");
  reconstructGenericWinnerMaterialization(database, invocationId);
  // @ts-expect-error a Result cannot select a generic winner materialization by Invocation identity.
  reconstructGenericWinnerMaterialization(database, resultId);
  // @ts-expect-error unknown arrivals bind only their exact Case/Board/Run/Invocation/Attempt family tuple.
  recordUnknownRuntimeArrival(database, { attemptId, boardId: caseId, caseId, details: {}, eventKind: "test", invocationId, recordedAt: "2026-08-26T00:01:02.000Z", workflowRunId: runId });
  // @ts-expect-error a Board ID cannot select the Case handoff graph.
  generateR003ResearcherAnalystHandoff(database, boardId);
  // @ts-expect-error a raw string cannot select the Case handoff graph.
  generateR003ResearcherAnalystHandoff(database, "case_not_branded");
  // @ts-expect-error a Response cannot be substituted for the persisted Invocation claim.
  beginPreparedAttempt(database, responseId, "2026-08-26T00:01:02.000Z");
  // @ts-expect-error a Source cannot cross the Case-owned handoff seam.
  generateR003ResearcherAnalystHandoff(database, sourceId);
  deriveRuntimeAuditEventId("runtime-exhausted", [invocationId]);
  deriveRuntimeAuditEventId("runtime-stale", [invocationId]);
  deriveRuntimeAuditEventId("runtime-contract-rejected", [attemptId]);
  deriveRuntimeAuditEventId("runtime-result-arrival", [arrivalId]);
  deriveRuntimeAuditEventId("runtime-unknown-arrival", [arrivalId]);
  // @ts-expect-error the result-arrival audit namespace accepts only an Arrival ID.
  deriveRuntimeAuditEventId("runtime-result-arrival", [resultId]);
  // @ts-expect-error the exhausted audit namespace accepts only an Invocation ID.
  deriveRuntimeAuditEventId("runtime-exhausted", [arrivalId]);
  // @ts-expect-error raw strings cannot enter runtime audit identity tuples.
  deriveRuntimeAuditEventId("runtime-stale", ["invocation_not_branded"]);
}

void request;
void attempt;
void wrongCase;
void wrongAttempt;
void rawCase;
void genericContract;
void nonGenericProfileContract;
void wrongGenericContract;
void assertExportedSeamsAreBranded;
