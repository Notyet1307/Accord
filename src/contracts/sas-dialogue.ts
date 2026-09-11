import { createHash } from "node:crypto";

export const SAS_DIALOGUE_VERSION = "sas.dialogue/v1";
export interface DialogueContext {
  readonly message_id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}
export interface DialogueRequest {
  readonly version: typeof SAS_DIALOGUE_VERSION;
  readonly operation_id: string;
  readonly input_fingerprint: string;
  readonly case_id: string;
  readonly workflow_run_id: string;
  readonly activity_id: string;
  readonly agent_id: "event-triage";
  readonly agent_revision: string;
  readonly binding_revision: string;
  readonly current_message: { readonly id: string; readonly content: string };
  readonly context: readonly DialogueContext[];
  readonly context_revision: number;
  readonly context_truncated: boolean;
  readonly deadline: string;
  readonly max_output_bytes: 4096;
  readonly tools: "none";
}
export interface DialogueResult {
  readonly version: typeof SAS_DIALOGUE_VERSION;
  readonly operation_id: string;
  readonly input_fingerprint: string;
  readonly case_id: string;
  readonly workflow_run_id: string;
  readonly activity_id: string;
  readonly run_id: string;
  readonly agent_id: "event-triage";
  readonly agent_revision: string;
  readonly binding_revision: string;
  readonly context_revision: number;
  readonly kind: "answer" | "needs_input" | "triage_proposal";
  readonly text: string;
}

// Canonical JSON objects have sorted keys; arrays retain their semantic order.
export function dialogueCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(dialogueCanonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${dialogueCanonical(item)}`).join(",")}}`;
  }
  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) throw new Error("DIALOGUE_INVALID_JSON");
  return JSON.stringify(value);
}
export function dialogueDigest(value: unknown): string {
  return createHash("sha256").update(dialogueCanonical(value)).digest("hex");
}
export function dialogueId(kind: string, ...parts: string[]): string {
  return `${kind}_${dialogueDigest(["accord.r004/v1", kind, ...parts])}`;
}
export function boundedDialogueText(value: unknown, maxBytes: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed() || Buffer.byteLength(value) > maxBytes) {
    throw new Error("DIALOGUE_TEXT_INVALID");
  }
}
export function dialogueIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:/-]{1,128}$/u.test(value)) throw new Error("DIALOGUE_ID_INVALID");
}
export function parseDialogueResult(value: unknown, request: DialogueRequest): DialogueResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("DIALOGUE_RESULT_INVALID");
  const record = value as Record<string, unknown>;
  const matched = ["version", "operation_id", "input_fingerprint", "case_id", "workflow_run_id", "activity_id",
    "agent_id", "agent_revision", "binding_revision", "context_revision"] as const;
  if (Object.keys(record).sort().join() !== [...matched, "run_id", "kind", "text"].sort().join()) throw new Error("DIALOGUE_RESULT_INVALID");
  for (const key of matched) if (record[key] !== request[key]) throw new Error("DIALOGUE_RESULT_MISMATCH");
  if (!["answer", "needs_input", "triage_proposal"].includes(String(record["kind"]))) throw new Error("DIALOGUE_RESULT_INVALID");
  dialogueIdentifier(record["run_id"]);
  boundedDialogueText(record["text"], 4096);
  return structuredClone(record) as unknown as DialogueResult;
}
