import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NORMALIZED_INTAKE_CONTRACT } from "../src/contracts/versions.js";

export const SYNTHETIC_INTAKE = {
  schemaVersion: NORMALIZED_INTAKE_CONTRACT,
  synthetic: true,
  eventType: "message.created",
  appId: "synthetic-app",
  cursor: 1,
  envelopeEventId: "event-1",
  conversationId: "conversation-1",
  messageId: "message-1",
  messageSequence: 1,
  actorId: "actor-1",
  objective: "Synthetic objective",
  receivedAt: "2026-08-26T00:00:00.000Z",
} as const;

export const EXPECTED_INTAKE_AUTHORITY = {
  auditCorrelationId: "corr_5bdf4d0b9c7cf43d8b652a42614e1dbda90870192106a002d5a4ec4663ae89b6",
  auditEventId: "audit_a89f8af426f877ba61c31b2446c38d85619ad4bae804fafb43d8e0c12bb77bed",
  boardId: "board_dcd6a646142077c99ec0d7e9ebd037a96b28dc91ee96a459f19d0fe446ee56ca",
  caseId: "case_ed9412d89c54f8e029c2fd99f4d726a48003db6d63c0d334c7a8dbb012517bc5",
  payloadDigest: "65e13d98a5fb87fe94c77c09cb160b87e9ced2bcb821fedaa7ed87afeeded6b4",
  receiptId: "receipt_1d463319242dbeab9df2cb0f8487ad75704e609b178b19b76e34b5d7b98b7b68",
  workflowRunId: "run_d3da30a0f60b3aff55b9aa13a0b3dafcd5d09109c7fa0d368ec5cb10ae74bcf7",
} as const;

export interface TemporaryDatabase {
  readonly directory: string;
  readonly path: string;
  readonly cleanup: () => void;
}

export function temporaryDatabase(label: string): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), `accord-${label}-`));
  return {
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
    directory,
    path: join(directory, "authority.sqlite"),
  };
}
