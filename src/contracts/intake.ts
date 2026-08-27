import { createHash } from "node:crypto";

import { NORMALIZED_INTAKE_CONTRACT } from "./versions.js";

export interface NormalizedSyntheticIntake {
  readonly schemaVersion: typeof NORMALIZED_INTAKE_CONTRACT;
  readonly synthetic: true;
  readonly eventType: "message.created";
  readonly appId: string;
  readonly cursor: number;
  readonly envelopeEventId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly messageSequence: number;
  readonly actorId: string;
  readonly objective: string;
  readonly receivedAt: string;
  readonly payloadDigest: string;
}

const SOURCE_KEYS = [
  "schemaVersion",
  "synthetic",
  "eventType",
  "appId",
  "cursor",
  "envelopeEventId",
  "conversationId",
  "messageId",
  "messageSequence",
  "actorId",
  "objective",
  "receivedAt",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("synthetic intake must be an object");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>): void {
  const actual = Object.keys(record).sort();
  const source = [...SOURCE_KEYS].sort();
  const normalized = [...SOURCE_KEYS, "payloadDigest"].sort();
  const matches = (expected: readonly string[]): boolean =>
    actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  if (!matches(source) && !matches(normalized)) {
    throw new TypeError(
      `synthetic intake keys must be exactly: ${SOURCE_KEYS.join(", ")} (plus derived payloadDigest when normalized)`,
    );
  }
}

function parseIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.trim() !== value ||
    /[\p{White_Space}\p{Cc}]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a non-whitespace stable identifier of at most 160 characters`);
  }
  return value;
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseReceivedAt(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new TypeError("receivedAt must be a canonical UTC ISO-8601 instant");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError("receivedAt must be a valid canonical UTC ISO-8601 instant");
  }
  return value;
}

function normalizeObjective(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("objective must be a string");
  }
  const normalized = value.normalize("NFC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized.length < 1 || normalized.length > 4_096) {
    throw new TypeError("objective must contain between 1 and 4096 normalized characters");
  }
  return normalized;
}

function digestPayload(input: Omit<NormalizedSyntheticIntake, "envelopeEventId" | "payloadDigest" | "receivedAt">): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

export function normalizeSyntheticIntake(value: unknown): NormalizedSyntheticIntake {
  const record = asRecord(value);
  assertExactKeys(record);

  if (record["schemaVersion"] !== NORMALIZED_INTAKE_CONTRACT) {
    throw new TypeError(`schemaVersion must be ${NORMALIZED_INTAKE_CONTRACT}`);
  }
  if (record["synthetic"] !== true) {
    throw new TypeError("synthetic must be true; real intake is outside this release");
  }
  if (record["eventType"] !== "message.created") {
    throw new TypeError("eventType must be message.created");
  }

  const stablePayload = {
    schemaVersion: NORMALIZED_INTAKE_CONTRACT,
    synthetic: true,
    eventType: "message.created",
    appId: parseIdentifier(record["appId"], "appId"),
    cursor: parsePositiveInteger(record["cursor"], "cursor"),
    conversationId: parseIdentifier(record["conversationId"], "conversationId"),
    messageId: parseIdentifier(record["messageId"], "messageId"),
    messageSequence: parsePositiveInteger(record["messageSequence"], "messageSequence"),
    actorId: parseIdentifier(record["actorId"], "actorId"),
    objective: normalizeObjective(record["objective"]),
  } as const;

  const payloadDigest = digestPayload(stablePayload);
  if ("payloadDigest" in record && record["payloadDigest"] !== payloadDigest) {
    throw new TypeError("payloadDigest does not match the normalized synthetic intake");
  }

  return Object.freeze({
    ...stablePayload,
    envelopeEventId: parseIdentifier(record["envelopeEventId"], "envelopeEventId"),
    receivedAt: parseReceivedAt(record["receivedAt"]),
    payloadDigest,
  });
}
