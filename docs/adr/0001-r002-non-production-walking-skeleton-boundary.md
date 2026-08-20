# ADR-0001: R002 non-production walking skeleton boundary

- Status: ACCEPTED
- Date: 2026-08-20
- Decision owner: 产品负责人
- Source Release: R002/r2
- Source Release blob: `9fee98e1f1f7ee99a984823e2f5d38ed52e64450`
- Accepted base: `de7db66713c968fd9066f4bd987e8184d936ff1a`

## Decision question

How should Accord preserve and formally deliver the verified R002 walking skeleton without turning a non-production feasibility result into a premature production stack decision?

## Product behavior preserved

Preserve the exact R002/r2 behavior: a synthetic MagicChat message crosses the real App WebSocket boundary, creates and resumes one persistent Workflow Run, commits one logical Stub Runtime result, requires approval from the initiating user, publishes once, acknowledges the event, and recovers without duplicate publication after a crash following successful `message.send`.

## Facts and constraints

- Official MagicChat is fixed at `chaitin/MagicChat@0cc474e560020491eb5f9ff3abe557559eba22a7` and is licensed under AGPL-3.0.
- The accepted evidence used a Go 1.25 reference App with `github.com/gorilla/websocket@v1.5.3`.
- MagicChat replay can change the envelope Event ID while preserving the source message ID and outbox cursor.
- MagicChat durably deduplicates App messages by conversation, App sender, and deterministic client-message ID.
- R002 excludes a production stack, real LLM, official Assistant, MCP, S3, ASR, production data, multi-replica operation, performance work, and production deployment.
- The first delivery must remain local, reversible, synthetic, and independently verifiable.

## Options considered

### A. Preserve a Go reference Harness

Retain the proven runtime and failure semantics with the fewest new dependencies. Treat Go as the language of this non-production conformance Harness only, not as the production Agent Hub language.

### B. Rewrite the Harness as TypeScript/Node.js

This aligns with a possible future Agent Hub and Pi/Harness integration direction, but expands R002, discards direct implementation evidence, and requires complete revalidation.

### C. Import or fork MagicChat into Accord now

This would allow immediate core modification, but introduces AGPL derivative-work and long-term upstream-maintenance decisions that R002 neither needs nor authorizes.

## Decision

Choose option A.

Accord will formally deliver one repository-contained Go reference Harness that preserves the verified R002 behavior and tests. It is a non-production conformance surface, not the production Agent Hub runtime.

For R002, MagicChat remains an unmodified external service. A source manifest or setup boundary must pin the official repository and commit. Local setup may obtain and build that exact source in an ignored workspace, but Accord will not vendor, fork, or modify MagicChat source in this Release.

The Harness communicates only through the official App WebSocket protocol. Application behavior must not read or write the MagicChat database directly. Test-only verification may inspect local synthetic database state to prove outbox and message uniqueness.

## System boundary and responsibilities

- **MagicChat** owns enterprise identity, users, Apps, conversations, messages, App event outbox, event cursors, cumulative ACK state, and durable message idempotency.
- **R002 Harness** owns Wake filtering, fixed Work routing, Workflow Run transitions, the pure Stub Runtime port, Human Approval checks, Response Claim, deterministic RPC IDs, correlation audit, and readiness.
- **Run Store** owns one-process durable workflow state through atomic JSON update, file `fsync`, rename, and parent-directory `fsync`.
- **Verification scripts** own synthetic resource provisioning, happy-path execution, crash injection, replay assertions, cleanup guards, and redacted evidence output.

Each responsibility has one owner; the Harness does not become a second authority for MagicChat identities/messages or Harness delivery tickets.

## State, data and handoffs

- Input: authenticated `message.created` envelopes from MagicChat.
- Stable workflow identity: source message ID plus conversation and cursor; envelope Event ID remains a delivery/audit identity.
- Run state: one atomic local JSON snapshot owned by the Harness.
- Runtime handoff: deterministic `RuntimeInvocationID`, target input, and pure draft result.
- Approval handoff: initiating user, matching Run ID, approval message ID, and decision.
- Publication handoff: deterministic RPC/client-message ID and original conversation target.
- Terminal output: one MagicChat message, `PUBLISHED` Run state, cumulative ACK, and complete audit correlation.

No database, queue, shared cache, or multi-process coordination is introduced.

## Verification, failure and recovery

The primary verification seam is the real MagicChat App WebSocket boundary, not a Mock, build, lint, or isolated unit test.

Acceptance must include:

1. the complete synthetic request, clarification, approval, and publication path;
2. one Run and one committed logical Stub Runtime result;
3. initiator-only approval and one final message;
4. a real crash after MagicChat accepts final `message.send` but before local pending-action completion and ACK;
5. replay with a different envelope Event ID and the same stable message/cursor;
6. recovery through the same deterministic RPC/client-message ID, one durable final message row, and empty App outbox.

A crash before a pure Runtime result commit may recompute the pure function. An external Runtime is not allowed until it accepts `RuntimeInvocationID` as an idempotency key and can recover a previously created result. ACK success followed by a crash before local confirmation may leave the audit at `ACK_INTENT`; this is an honest terminal trace, not proof that the server failed to ACK.

## Security and operations

- Use synthetic local identities and messages only.
- Keep core, admin, database, App, and synthetic-user credentials outside Git and Docker build contexts.
- Expose the App secret through a dedicated read-only secret file, not an environment value.
- Run the Harness as a dedicated non-root user, mount only its state directory writable, and publish no host port.
- Keep MagicChat, LLM, MCP, S3, ASR, and production network access outside the Harness trust boundary.
- Provision or delete synthetic resources only after exact ownership-marker verification.
- Require explicit guarded confirmation for destructive state, credential, image, or source cleanup.

## Deferred decisions

- **Production Agent Hub language and runtime:** reopen when a Release requires a real LLM, a second Runtime, or production operation.
- **MagicChat fork or core modification:** reopen when committed behavior cannot be delivered through the App protocol; require explicit AGPL and upstream-maintenance review.
- **Multi-process persistence:** reopen when more than one Harness process or replica is required.
- **External Runtime physical effects:** reopen only with an accepted idempotency and result-recovery contract.
- **LLM, MCP, S3, ASR, memory, skills, and proactive behavior:** require later Releases with their own evidence and controls.

Each deferral leaves R002 behavior, ownership, interfaces, and verification unchanged.

## Consequences

- R002 can enter Delivery Spec compilation without choosing a production platform.
- The first implementation remains close to the independently verified evidence and is cheap to discard or retain as a conformance Harness.
- Future TypeScript/Node.js Agent Hub work may coexist with or replace this Harness and must rerun the same external behavior tests.
- Accord avoids importing AGPL-covered MagicChat source in this Release, while preserving MagicChat as the real system boundary.

## Repository contract impact

No root policy change is required. This decision is Release-specific and belongs in this ADR. The existing `AGENTS.md` already makes accepted ADRs authoritative for load-bearing technical decisions and routes delivery work through the repository gate.
