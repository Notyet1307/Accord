import {
  RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_SHA256,
  RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_SCHEMA_FINGERPRINT,
} from "./handoff.js";
import {
  ANALYST_OUTPUT_SCHEMA,
  ANALYST_PROFILE_VERSION,
  NATIVE_BAIZHI_PROVIDER_PORT_VERSION,
  RESEARCHER_OUTPUT_SCHEMA,
  RESEARCHER_PROFILE_VERSION,
  RUNTIME_VERSION,
} from "../researcher-analyst.js";
import {
  CONTRACT_VERSIONS,
  DATABASE_SCHEMA_VERSION,
  RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_FILE,
  RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_ID,
} from "./versions.js";
import type { DatabaseSync } from "node:sqlite";
import {
  deriveRuntimeAuditCorrelationId,
  deriveRuntimeAuditEventId,
  parseArrivalId,
  parseAuditCorrelationId,
  parseAuditEventId,
  parseAttemptId,
  parseBoardEntryId,
  parseBoardId,
  parseCaseId,
  parseContextId,
  parseInvocationId,
  parseResponseId,
  parseResultId,
  parseWorkflowRunId,
  type ArrivalId,
  type AttemptId,
  type AuditCorrelationId,
  type AuditEventId,
  type BoardEntryId,
  type BoardId,
  type CaseId,
  type ContextId,
  type InvocationId,
  type ResponseId,
  type ResultId,
  type WorkflowRunId,
} from "../core/ids.js";
import { reconstructWinnerBoardEntries } from "../researcher-analyst.js";

export const RESEARCHER_ANALYST_HANDOFF_VERSION = "accord.r003-researcher-analyst-handoff/v1" as const;

/** No-network contract passed to Issue #13; it does not attest a live Pilot. */
export const R003_RESEARCHER_ANALYST_HANDOFF = Object.freeze({
  handoffVersion: RESEARCHER_ANALYST_HANDOFF_VERSION,
  prerequisite: Object.freeze({ handoffVersion: "accord.r003-magicchat-handoff/v1", sha256: "edb6849094a9bbfc7973fe3e4fee0375ef31c42cf048c08f4781acebee528e40" }),
  databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
  contractVersions: CONTRACT_VERSIONS,
  migration: Object.freeze({
    file: RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_FILE,
    id: RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_ID,
    sha256: RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_SHA256,
    schemaFingerprint: RESEARCHER_ANALYST_OPAQUE_COMPLETION_RECEIPT_MIGRATION_SCHEMA_FINGERPRINT,
    version: DATABASE_SCHEMA_VERSION,
  }),
  providerPort: Object.freeze({
    networkEnabled: false,
    noSdkRetry: true,
    version: NATIVE_BAIZHI_PROVIDER_PORT_VERSION,
  }),
  profiles: Object.freeze({
    analyst: Object.freeze({ outputSchema: ANALYST_OUTPUT_SCHEMA, version: ANALYST_PROFILE_VERSION }),
    researcher: Object.freeze({ outputSchema: RESEARCHER_OUTPUT_SCHEMA, version: RESEARCHER_PROFILE_VERSION }),
    runtimeVersion: RUNTIME_VERSION,
  }),
  primarySeamClaims: Object.freeze({
    realModelCallConsumed: false,
    scenarioS3Passed: false,
    scenarioS4Passed: false,
  }),
} as const);

export interface ReviewerHandoffTarget {
  readonly boardId: BoardId;
  readonly caseId: CaseId;
  readonly invocationId: InvocationId;
  readonly proposalBoardRevision: number;
  readonly proposalDigest: string;
  readonly proposalId: BoardEntryId;
  readonly resultId: ResultId;
  readonly runId: WorkflowRunId;
  readonly supportStatus: "UNSUPPORTED";
  readonly workflowNode: "REVIEWER";
}

type PersistedScalar = string | number | null;
export interface PersistedAuthorityRow { readonly [column: string]: PersistedScalar; }
export interface PersistedBoard extends PersistedAuthorityRow { readonly board_id: BoardId; readonly case_id: CaseId; }
export interface PersistedWorkflow extends PersistedAuthorityRow { readonly workflow_run_id: WorkflowRunId; readonly board_id: BoardId; readonly case_id: CaseId; }
export interface PersistedBoardEntry extends PersistedAuthorityRow { readonly board_entry_id: BoardEntryId; readonly board_id: BoardId; readonly case_id: CaseId; }
export interface PersistedInvocation extends PersistedAuthorityRow { readonly invocation_id: InvocationId; readonly board_id: BoardId; readonly case_id: CaseId; readonly workflow_run_id: WorkflowRunId; }
export interface PersistedContext extends PersistedAuthorityRow { readonly context_id: ContextId; readonly invocation_id: InvocationId; readonly board_id: BoardId; readonly case_id: CaseId; readonly workflow_run_id: WorkflowRunId; }
export interface PersistedAttempt extends PersistedAuthorityRow { readonly attempt_id: AttemptId; readonly invocation_id: InvocationId; }
export interface PersistedResult extends PersistedAuthorityRow { readonly result_id: ResultId; readonly attempt_id: AttemptId; readonly invocation_id: InvocationId; }
export interface PersistedArrival extends PersistedAuthorityRow { readonly arrival_id: ArrivalId; readonly attempt_id: AttemptId; readonly invocation_id: InvocationId; readonly result_id: ResultId | null; readonly response_id: ResponseId | null; }
export interface PersistedResponse extends PersistedAuthorityRow { readonly response_id: ResponseId; readonly attempt_id: AttemptId; readonly invocation_id: InvocationId; }
export interface PersistedResultEntry extends PersistedAuthorityRow { readonly result_id: ResultId; readonly board_entry_id: BoardEntryId; }
export interface PersistedRuntimeAuditEvent extends PersistedAuthorityRow { readonly audit_event_id: AuditEventId; readonly correlation_id: AuditCorrelationId; }
export interface PersistedPipeline {
  readonly arrivals: readonly PersistedArrival[];
  readonly attempts: readonly PersistedAttempt[];
  readonly context: PersistedContext;
  readonly invocation: PersistedInvocation;
  readonly resultEntries: readonly PersistedResultEntry[];
  readonly results: readonly PersistedResult[];
  readonly responses: readonly PersistedResponse[];
  readonly winner: PersistedArrival;
  readonly winnerAudit: PersistedRuntimeAuditEvent;
}

/** Generated read-only projection with every persisted identity kept branded. */
export interface GeneratedR003ResearcherAnalystHandoff {
  readonly boardGraph: Readonly<{ board: PersistedBoard; entries: readonly PersistedBoardEntry[]; workflow: PersistedWorkflow; }>;
  readonly contractVersions: typeof CONTRACT_VERSIONS;
  readonly pipelines: Readonly<{ analyst: PersistedPipeline; researcher: PersistedPipeline; }>;
  readonly providerPort: Readonly<{ networkEnabled: false; noSdkRetry: true; version: string; }>;
  readonly profiles: Readonly<{ analyst: Readonly<{ outputSchema: string; version: string; }>; researcher: Readonly<{ outputSchema: string; version: string; }>; runtimeVersion: string; }>;
  readonly reviewerTarget: ReviewerHandoffTarget;
}

export function serializeR003ResearcherAnalystHandoff(): string {
  throw new Error("Issue 13 handoff must be generated from one persisted winning Case");
}

/**
 * Derives the Reviewer handoff from the committed deterministic pipeline.
 * This is deliberately a read-only projection: it cannot attest a live Pilot.
 */
export function generateR003ResearcherAnalystHandoff(database: DatabaseSync, persistedCaseId: CaseId): GeneratedR003ResearcherAnalystHandoff {
  const scalarRow = (value: unknown, label: string): PersistedAuthorityRow => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`persisted ${label} is not a row`);
    const row: Record<string, PersistedScalar> = {};
    for (const [column, field] of Object.entries(value)) {
      if (field !== null && typeof field !== "string" && typeof field !== "number") throw new Error(`persisted ${label}.${column} is not a scalar`);
      row[column] = field;
    }
    return Object.freeze(row);
  };
  const all = (sql: string, ...parameters: readonly (string | number)[]): readonly PersistedAuthorityRow[] => database.prepare(sql).all(...parameters).map((value, index) => scalarRow(value, `query row ${index}`));
  const singleton = (label: string, values: readonly PersistedAuthorityRow[]): PersistedAuthorityRow => {
    if (values.length !== 1) throw new Error(`persisted Case lacks exactly one ${label}`);
    return values[0]!;
  };
  const stringField = (row: PersistedAuthorityRow, column: string): string => {
    const value = row[column];
    if (typeof value !== "string") throw new Error(`persisted row ${column} is not a string`);
    return value;
  };
  const numberField = (row: PersistedAuthorityRow, column: string): number => {
    const value = row[column];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`persisted row ${column} is not an integer`);
    return value;
  };
  const invocationRow = (row: PersistedAuthorityRow): PersistedInvocation => Object.freeze({ ...row, board_id: parseBoardId(row["board_id"]), case_id: parseCaseId(row["case_id"]), invocation_id: parseInvocationId(row["invocation_id"]), workflow_run_id: parseWorkflowRunId(row["workflow_run_id"]) });
  const contextRow = (row: PersistedAuthorityRow): PersistedContext => Object.freeze({ ...row, board_id: parseBoardId(row["board_id"]), case_id: parseCaseId(row["case_id"]), context_id: parseContextId(row["context_id"]), invocation_id: parseInvocationId(row["invocation_id"]), workflow_run_id: parseWorkflowRunId(row["workflow_run_id"]) });
  const attemptRow = (row: PersistedAuthorityRow): PersistedAttempt => Object.freeze({ ...row, attempt_id: parseAttemptId(row["attempt_id"]), invocation_id: parseInvocationId(row["invocation_id"]) });
  const resultRow = (row: PersistedAuthorityRow): PersistedResult => Object.freeze({ ...row, attempt_id: parseAttemptId(row["attempt_id"]), invocation_id: parseInvocationId(row["invocation_id"]), result_id: parseResultId(row["result_id"]) });
  const arrivalRow = (row: PersistedAuthorityRow): PersistedArrival => Object.freeze({ ...row, arrival_id: parseArrivalId(row["arrival_id"]), attempt_id: parseAttemptId(row["attempt_id"]), invocation_id: parseInvocationId(row["invocation_id"]), result_id: row["result_id"] === null ? null : parseResultId(row["result_id"]), response_id: row["response_id"] === null ? null : parseResponseId(row["response_id"]) });
  const responseRow = (row: PersistedAuthorityRow): PersistedResponse => Object.freeze({ ...row, attempt_id: parseAttemptId(row["attempt_id"]), invocation_id: parseInvocationId(row["invocation_id"]), response_id: parseResponseId(row["response_id"]) });
  const resultEntryRow = (row: PersistedAuthorityRow): PersistedResultEntry => Object.freeze({ ...row, board_entry_id: parseBoardEntryId(row["board_entry_id"]), result_id: parseResultId(row["result_id"]) });
  const runtimeAuditRow = (row: PersistedAuthorityRow): PersistedRuntimeAuditEvent => Object.freeze({ ...row, audit_event_id: parseAuditEventId(row["audit_event_id"]), correlation_id: parseAuditCorrelationId(row["correlation_id"]) });
  const pipeline = (node: "RESEARCHER" | "ANALYST"): PersistedPipeline => {
    const invocation = invocationRow(singleton(`${node} committed Invocation`, all(`SELECT * FROM runtime_invocations WHERE case_id = ? AND node_id = ? AND status = 'RESULT_COMMITTED'`, persistedCaseId, node)));
    const invocationId = invocation.invocation_id;
    const context = contextRow(singleton(`${node} Context`, all("SELECT * FROM profile_contexts WHERE invocation_id = ? AND case_id = ?", invocationId, persistedCaseId)));
    const attempts = all("SELECT * FROM runtime_attempts WHERE invocation_id = ? ORDER BY attempt_number", invocationId).map(attemptRow);
    if (attempts.length < 1 || attempts.length > 2 || attempts.filter((attempt) => attempt["state"] === "WINNER").length !== 1) throw new Error(`persisted ${node} Attempt graph is incomplete`);
    const results = all("SELECT * FROM runtime_results WHERE invocation_id = ? ORDER BY result_id", invocationId).map(resultRow);
    const arrivals = all("SELECT * FROM runtime_result_arrivals WHERE invocation_id = ? ORDER BY attempt_id, arrival_number", invocationId).map(arrivalRow);
    const responses = all("SELECT * FROM runtime_physical_responses WHERE invocation_id = ? ORDER BY response_id", invocationId).map(responseRow);
    const winner = arrivalRow(singleton(`${node} winning Arrival`, arrivals.filter((arrival) => arrival["outcome"] === "WINNER")));
    if (typeof winner["result_id"] !== "string" || typeof winner["response_id"] !== "string" || !results.some((result) => result["result_id"] === winner["result_id"]) || !responses.some((response) => response["response_id"] === winner["response_id"])) throw new Error(`persisted ${node} winning graph is incomplete`);
    const resultEntries = all(`SELECT link.result_id, link.board_entry_id FROM runtime_result_entries link
      JOIN runtime_results result ON result.result_id = link.result_id WHERE result.invocation_id = ? ORDER BY link.result_id, link.board_entry_id`, invocationId).map(resultEntryRow);
    if (!resultEntries.some((link) => link["result_id"] === winner["result_id"])) throw new Error(`persisted ${node} winner has no Board entries`);
    const expectedAuditEventId = deriveRuntimeAuditEventId("runtime-result-arrival", [winner.arrival_id]);
    const winnerAudit = runtimeAuditRow(singleton(`${node} winning audit`, all("SELECT * FROM audit_events WHERE audit_event_id = ?", expectedAuditEventId)));
    if (winnerAudit.correlation_id !== deriveRuntimeAuditCorrelationId(invocationId) || winnerAudit["event_kind"] !== `RUNTIME_RESULT:WINNER:${winner["attempt_id"]}:${winner["arrival_number"]}` || winnerAudit["case_id"] !== persistedCaseId || winnerAudit["board_id"] !== invocation.board_id || winnerAudit["workflow_run_id"] !== invocation.workflow_run_id) throw new Error(`persisted ${node} winner audit does not retain its exact branded identity tuple`);
    return Object.freeze({ arrivals: Object.freeze(arrivals), attempts: Object.freeze(attempts), context: Object.freeze(context), invocation: Object.freeze(invocation), resultEntries: Object.freeze(resultEntries), results: Object.freeze(results), responses: Object.freeze(responses), winner: Object.freeze(winner), winnerAudit: Object.freeze(winnerAudit) });
  };
  const researcher = pipeline("RESEARCHER");
  const analyst = pipeline("ANALYST");
  const researcherInvocation = researcher.invocation;
  const analystInvocation = analyst.invocation;
  if (researcherInvocation.workflow_run_id !== analystInvocation.workflow_run_id || researcherInvocation.board_id !== analystInvocation.board_id) throw new Error("persisted profiles do not share one Case graph");
  const board: PersistedBoard = Object.freeze({ ...singleton("Case Board", all("SELECT * FROM boards WHERE board_id = ? AND case_id = ?", analystInvocation.board_id, persistedCaseId)), board_id: parseBoardId(analystInvocation.board_id), case_id: parseCaseId(persistedCaseId) });
  const workflow: PersistedWorkflow = Object.freeze({ ...singleton("Case Workflow", all("SELECT * FROM workflow_runs WHERE workflow_run_id = ? AND case_id = ?", analystInvocation.workflow_run_id, persistedCaseId)), board_id: parseBoardId(analystInvocation.board_id), case_id: parseCaseId(persistedCaseId), workflow_run_id: parseWorkflowRunId(analystInvocation.workflow_run_id) });
  if (workflow["state"] !== "REVIEWER") throw new Error("persisted Case has no exact Reviewer handoff target");
  const entries: readonly PersistedBoardEntry[] = all("SELECT * FROM board_entries WHERE case_id = ? AND board_id = ? ORDER BY created_revision, board_entry_id", persistedCaseId, board.board_id).map((row) => Object.freeze({ ...row, board_entry_id: parseBoardEntryId(row["board_entry_id"]), board_id: parseBoardId(row["board_id"]), case_id: parseCaseId(row["case_id"]) }));
  const analystWinnerResultId = parseResultId(analyst.winner.result_id);
  const analystWinner = singleton("ANALYST winning Result", analyst.results.filter((result) => result.result_id === analystWinnerResultId));
  let winnerOutput: unknown;
  try { winnerOutput = JSON.parse(stringField(analystWinner, "output_json")); } catch { throw new Error("persisted Analyst winning Result has invalid output JSON"); }
  const expectedWinnerEntries = reconstructWinnerBoardEntries(database, analystInvocation.invocation_id, winnerOutput);
  const linkedWinnerEntryIds = new Set(analyst.resultEntries.filter((link) => link.result_id === analystWinnerResultId).map((link) => link.board_entry_id));
  if (linkedWinnerEntryIds.size !== expectedWinnerEntries.length || expectedWinnerEntries.some((entry) => !linkedWinnerEntryIds.has(entry.entryId))) throw new Error("persisted Analyst winner links do not exactly cover its derived Board graph");
  const entriesById = new Map<BoardEntryId, PersistedBoardEntry>(entries.map((entry) => [entry.board_entry_id, entry]));
  for (const expected of expectedWinnerEntries) {
    const actual = entriesById.get(expected.entryId);
    if (actual === undefined || actual["entry_type"] !== expected.type || actual["content_digest"] !== expected.contentDigest || numberField(actual, "created_revision") !== numberField(analystInvocation, "board_revision") + 1) throw new Error("persisted Analyst winner Board graph does not match its derived identities and digests");
  }
  const plantedClaims = expectedWinnerEntries.filter((entry) => entry.type === "Claim" && entry.payload["statement"] === "Customer adoption is guaranteed." && entry.payload["unsupported"] === true && entry.basedOn.length === 0);
  if (plantedClaims.length !== 1) throw new Error("persisted Analyst winner lacks exactly one frozen unsupported Claim");
  const plantedClaim = plantedClaims[0]!;
  const plantedProposals = expectedWinnerEntries.filter((entry) => entry.type === "Proposal" && entry.payload["action"] === "Promise adoption." && entry.payload["supportStatus"] === "UNSUPPORTED" && entry.basedOn.length === 1 && entry.basedOn[0] === plantedClaim.entryId);
  if (plantedProposals.length !== 1) throw new Error("persisted Analyst winner lacks exactly one frozen unsupported Proposal");
  const plantedProposal = plantedProposals[0]!;
  if (!linkedWinnerEntryIds.has(plantedClaim.entryId) || !linkedWinnerEntryIds.has(plantedProposal.entryId)) throw new Error("persisted candidate Proposal graph is not linked to the exact Analyst winner");
  const proposal = entriesById.get(plantedProposal.entryId);
  if (proposal === undefined || proposal["content_digest"] !== plantedProposal.contentDigest || proposal["entry_type"] !== "Proposal" || numberField(proposal, "created_revision") !== numberField(analystInvocation, "board_revision") + 1 || numberField(board, "revision") < numberField(proposal, "created_revision")) throw new Error("persisted candidate Proposal is not at the exact Analyst winner Board revision");
  const proposalId = plantedProposal.entryId;
  const analystContext = analyst.context; const researcherContext = researcher.context;
  if (analystContext["provider_port_version"] !== researcherContext["provider_port_version"] || analystContext["runtime_version"] !== researcherContext["runtime_version"]) throw new Error("persisted Case has inconsistent Profile versions");
  const reviewerTarget: ReviewerHandoffTarget = Object.freeze({
    boardId: analystInvocation.board_id, caseId: persistedCaseId, invocationId: analystInvocation.invocation_id, proposalBoardRevision: numberField(proposal, "created_revision"), proposalDigest: stringField(proposal, "content_digest"), proposalId: parseBoardEntryId(proposalId), resultId: analystWinnerResultId, runId: analystInvocation.workflow_run_id, supportStatus: "UNSUPPORTED", workflowNode: "REVIEWER",
  });
  return Object.freeze({
    ...R003_RESEARCHER_ANALYST_HANDOFF,
    boardGraph: Object.freeze({ board, entries, workflow }),
    pipelines: Object.freeze({ analyst, researcher }),
    providerPort: Object.freeze({ ...R003_RESEARCHER_ANALYST_HANDOFF.providerPort, version: stringField(analystContext, "provider_port_version") }),
    profiles: Object.freeze({ analyst: Object.freeze({ outputSchema: stringField(analystContext, "output_schema"), version: stringField(analystContext, "profile_version") }), researcher: Object.freeze({ outputSchema: stringField(researcherContext, "output_schema"), version: stringField(researcherContext, "profile_version") }), runtimeVersion: stringField(analystContext, "runtime_version") }),
    reviewerTarget,
  });
}
