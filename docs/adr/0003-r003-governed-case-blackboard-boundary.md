# ADR-0003: R003 governed Case Blackboard minimum solution boundary

- Status: ACCEPTED
- Date: 2026-08-22
- Decision owner: 产品负责人
- Source Release: R003/r1
- Decision base: `ebd63badccde37c944f01c0ce92169350778dfbc`
- Related: ADR-0002, `docs/product/VISION.md`

## Decision question

What is the smallest technical boundary that can implement R003/r1 without inheriting the R002 implementation structure or forcing Delivery Tickets to choose competing owners, schemas, persistence, Runtime, approval, recovery, or verification semantics?

## Product behavior preserved

This ADR preserves R003/r1 unchanged: one synthetic MagicChat request creates one Case and one fixed Workflow Run; missing information waits and resumes the same Case/Run; four fixed Profiles produce non-prebaked outputs through a Typed Blackboard; one exact Artifact revision receives one Human Approval; one Response Owner publishes once; the complete Case, Board, Workflow, Agent, Approval, Artifact, side-effect, recovery, and audit trace remains inspectable.

This decision establishes only the implementation and verification boundary for that synthetic, isolated, non-production Release. It does not establish customer value, production fitness, general model quality, or a comparative advantage over sequential summaries.

## Facts and constraints

- The accepted repository base contains no executable Accord application, schema, or runtime.
- R003/r1 limits the first Release to one Case, one fixed Workflow, one Typed Blackboard, four fixed Profiles, one Approval, one Response Owner, one Artifact, one Trace, and synthetic non-production data.
- R003/r1 requires stable identity, wait/resume, Human Approval, deterministic side-effect identity, Freshness, Dedup, crash-safe recovery, complete audit correlation, and non-prebaked model outputs.
- ADR-0001 remains R002-only. R003 inherits R002 external behavior constraints, not its Go Harness, Atomic JSON Store, module layout, local deployment, or fixed dependency versions.
- ADR-0002 selects TypeScript and Node.js Active LTS for the Accord Coordination Plane.
- The product owner selected one process/replica and an Accord-owned SQLite database in WAL mode for R003. Multi-process and multi-replica operation are out of scope.
- The product owner selected a Native LLM Turn Adapter rather than Pi, Codex, a tool runtime, or a local model service.
- A product-owner-authorized local compatibility probe in this PI session on 2026-08-22 verified the configured Baizhi `openai-responses` endpoint with model alias `deepseek-v4-pro`: HTTP 200, completed response, schema-valid JSON, provider request and response identifiers, `store=false`, no tools, one request, no retry, and usage 118 input / 74 output / 192 total tokens. The redacted return is retained in the session transcript rather than a separate repository artifact. This attests only that bounded request; it does not independently prove provider idempotency, result retrieval, model-version stability, or four-turn quality.
- R003 uses official MagicChat commit `chaitin/MagicChat@29dfa1c85377e69c3810e28b76a3f5580c3e198d` as its external conformance source. At that commit:
  - App WebSocket authentication uses App ID and Bearer connection secret, then rechecks authorization before replay (`server/internal/httpserver/app_websocket_handlers.go:32-88`).
  - reliable events replay from the persisted last acknowledged cursor in ascending outbox order (`server/internal/httpserver/app_message_events.go:49-78`);
  - each replay envelope receives a new Event ID while preserving its cursor and stored payload (`server/internal/realtime/protocol.go:52-65`);
  - `message.created` payloads contain stable conversation ID, message ID, message sequence, sender, and body, while the outbox row owns the cursor (`server/internal/application/message/outbox.go:17-20,43-49,92-118`);
  - ACK is cumulative and deletes outbox rows through the acknowledged cursor (`server/internal/httpserver/app_request_handlers.go:579-634`);
  - `message.send` uses the request Envelope ID as the durable client-message identity (`server/internal/httpserver/app_request_handlers.go:637-714`), and app-message creation returns the existing message for that identity (`server/internal/application/message/app_create.go:30-60,73-111`);
  - the database uniquely constrains `(conversation_id, sender_type, sender_id, client_message_id)` (`server/migrations/00015_partition_messages_by_year_and_conversation.sql:2-27`);
  - choice responses are delivered reliably to the sending App with choice message, response, option, and sender identities (`server/internal/application/message/choice_response.go:404-453`).

## Options considered

### A. TypeScript modular monolith, SQLite/WAL, Native Baizhi turn adapter

One process owns one transactional SQLite database and integrates only through the official MagicChat App WebSocket and one Baizhi Responses adapter. This is the smallest boundary that can satisfy the committed crash, trace, approval, and non-prebaked-output behavior without adding a service, queue, tool runtime, or production database.

### B. TypeScript modular monolith with dedicated PostgreSQL

This keeps the same logical owners but adds a database service, credentials, provisioning, and cleanup burden for multi-process properties excluded from R003. Reopen when a committed Release requires another process/replica, production SLOs, or a measured SQLite limitation.

### C. Pi Runtime or a local model service

Pi adds Session, Workspace, Skill, tool-permission, and process-recovery semantics that R003 does not consume. A local model service removes external model egress but adds model hosting and quality constraints without an available target environment. Both remain replaceable future Runtime adapters.

### D. Extend the R002 Go Harness or Atomic JSON Store

Rejected. R003 explicitly does not inherit those implementation structures, and they do not provide the selected production-language direction or the required transactional typed graph and Runtime arbitration boundary.

## Decision

Choose option A.

R003 is implemented as one TypeScript/Node.js modular monolith with one process and one active replica. Logical modules remain separate owners inside that deployment unit; they do not become services, public packages, or a general Workflow platform.

Accord owns one local SQLite database configured with WAL, foreign-key enforcement, full synchronous durability, and a bounded busy timeout. One database transaction is the atomic boundary for Case, Board, Workflow, Inbox receipt, Runtime result selection, Approval, Response Claim, pending side effects, and Audit changes. The database is never shared with or replaced by the MagicChat database.

The only external behavioral seam is the official MagicChat App WebSocket at the pinned current source commit. Accord does not read or write the MagicChat database. It treats envelope Event ID as delivery audit identity, not replay-stable identity.

Four fixed Profiles use one Native LLM Turn Adapter at `https://ai-api-gateway.app.baizhi.cloud/api/openai` through the OpenAI Responses contract and logical model alias `deepseek-v4-pro`. The underlying provider deployment is externally owned and may change behind the alias; every Attempt therefore records configured model ID, returned model/deployment identity when supplied, request/response IDs, timestamp, usage, input/context digest, and output digest. No Profile receives tools, a persistent provider Session, a Workspace, long-term Memory, or hidden cross-Profile history.

The Coordinator, not Writer or another cognitive Agent, is the sole Response Owner. Agent output remains candidate content until deterministic schema, relation, freshness, review, and approval gates pass.

## System boundary and responsibilities

- **MagicChat** owns App identity and connection authorization, conversations, users, visible messages, choice responses, reliable event outbox/cursor/ACK state, and durable message deduplication.
- **Ingress and Case Coordinator** owns serial event intake, durable receipt, Case resolution, stable Case/Run correlation, and routing into the one Workflow.
- **Case Store** owns Case identity, objective, conversation references, coarse status, and the current Board/Workflow references. It does not copy MagicChat identity or message authority.
- **Board Store** owns immutable typed entries, provenance, relations, content digests, and monotonically increasing Case-scoped Board revision.
- **Workflow Store** owns the fixed definition version, Run, node state, wait challenge, resume correlation, retry budget, and completion predicate. It references Board entries rather than copying them.
- **Context Assembler** owns the minimal per-Profile view and the exact input entry IDs, revisions, digests, permission summary, and output contract used for each Invocation.
- **Runtime Controller** owns logical Invocation identity, bounded Attempts, provider calls, schema validation, one-winner result arbitration, usage, and discarded/late result audit.
- **Approval Controller** owns the approval challenge, expected actor, exact Case/Run/Artifact revision and digest, choice-message correlation, decision, and expiry.
- **Publication Controller** owns the single Response Claim, Freshness gate, deterministic MagicChat request ID, local publication action, confirmation, and final response audit.
- **Audit projection** owns a read-only reconstruction of the complete trace from the same transactional records. It is not a second state authority.
- **Baizhi** owns model execution and provider response metadata. Its output cannot create Evidence authority, Approval, Decision, or External Outcome.

## State, data and handoffs

### Durable ingress and cumulative ACK

Each reliable MagicChat event creates or resolves one Inbox receipt keyed by `(app_id, cursor)`. The receipt stores event type, envelope Event ID for audit, payload digest, source message or choice-response identity, processing status, and ACK intent/confirmation. The unique key prevents replay from repeating local state transitions.

Events for the single App are processed in cursor order. Processing a new event atomically writes its receipt and all immediate Case/Run/Board transitions plus any required pending RPC action. Event processing ends only at a durable stable wait state, observable terminal failure, or completed transition; all RPCs needed to reach that point must be confirmed. Accord then ACKs that cursor and never ACKs a higher cursor while a lower cursor is incomplete.

If an event replays after local business completion, Accord resumes its pending RPC or ACK state without recreating the Case, Run, Board entries, Artifact, or publication. If a crash occurs after MagicChat accepts an ACK but before local ACK confirmation, the local `ACK_INTENT` remains an honest unknown-confirmation audit state; all business work and side effects were already confirmed, so no duplicate business action is required. Accord reconnects before processing a higher cursor.

### Case, Workflow and Board

The fixed Workflow is:

```text
INTAKE
→ WAIT_FOR_INPUT when required
→ RESEARCHER
→ ANALYST
→ REVIEWER
→ WRITER
→ WAIT_FOR_APPROVAL
→ FRESHNESS_CHECK
→ PUBLISH
→ COMPLETE
```

Before entering `WAIT_FOR_INPUT`, Accord persists a clarification `message.send` pending action with a deterministic request Envelope ID derived from Case, Run, challenge version, and action kind. It reuses that ID after a crash and records the confirmed clarification message ID before the Run reaches its durable stable wait state. A user reply then resumes the exact waiting Run through the persisted challenge containing Case ID, Run ID, expected conversation/actor, expected input contract, source message/cursor, clarification message ID, and expiry. A reply that does not match the active challenge is a new audited event and cannot implicitly advance the Run.

Board entries are immutable and Case-scoped. Every append transaction advances one monotonically increasing Board revision. Every entry contains at least:

```text
id, case_id, type, status, author_type, author_id,
payload, source_refs, based_on, contradicts, supersedes,
visibility, trust_level, instruction_authority,
created_revision, content_digest, created_at
```

The nine R003 payload contracts are:

| Type | Minimum payload and relation rule |
| --- | --- |
| `EvidenceRef` | source kind, stable source ID/locator, source digest, observed time; external facts remain references |
| `Observation` | bounded observed statement; references conversation input or one or more EvidenceRefs |
| `Question` | missing information and expected answer contract |
| `Intent` | bounded research objective and scope |
| `Claim` | candidate statement; cites supporting entries or is explicitly marked unsupported |
| `Proposal` | candidate action/decision and cited Claims/Evidence |
| `Critique` | target Claim/Proposal/Artifact assertion, issue and severity |
| `VerificationResult` | target entry, method, `PASS | FAIL | INCONCLUSIVE`, and supporting EvidenceRefs |
| `ArtifactRef` | Artifact ID, immutable revision, digest, and material assertion-to-entry links |

Only the system validates and appends entries. Agents return typed candidates; they cannot set `VERIFIED`, create Approval, or mutate an existing entry. Supersession and contradiction are new relations or entries, never silent overwrite.

Context views are fixed by Profile:

- Researcher receives the objective, relevant user inputs, active Questions/Intents, and approved synthetic sources.
- Analyst receives active EvidenceRefs and Observations plus unresolved Questions; it writes only Claims and Proposals.
- Reviewer receives each target Proposal/Claim, its complete cited graph, and existing Critiques/VerificationResults; it writes Critique or VerificationResult and cannot approve.
- Writer receives accepted source graph, non-rejected Claims/Proposals, and all unresolved material Critiques; it does not receive unrelated conversation history, private Runtime material, or hidden reasoning.

Every Invocation stores a context snapshot of Case ID, Run/node revision, Board revision, selected entry IDs/digests, Workflow/Profile/model versions, output schema, and context digest.

### Runtime result arbitration

A logical Runtime Invocation has a deterministic ID derived from Case, Run, node, Profile version, and input/context digest. Before network I/O, Accord persists the Invocation and a unique Attempt in `READY`, then atomically claims that Attempt as `RUNNING`.

A completed provider response is stored with provider response metadata, raw candidate output or approved redacted form, usage, and digest. In one transaction, compare-and-set selects the first schema-valid Attempt whose Invocation, Workflow node, Claim, Board revision, and context digest are still fresh. That winner appends its typed Board entries and commits `RESULT_COMMITTED`. Late, divergent, duplicate, or stale responses remain audit records and cannot update the Board.

Baizhi has not proven idempotent invocation or result retrieval. If a crash or timeout leaves an Attempt outcome unknown, Accord marks it `UNKNOWN` after recovery and may create at most one replacement Attempt under the same logical Invocation. Provider SDK automatic retries are disabled. Physical duplicate model execution and cost are possible and recorded; only one result can win. After two total Attempts, the node stops in an observable failure state and requires an operator decision rather than unbounded retry.

### Artifact, Approval and publication

Writer produces one immutable Markdown Artifact revision stored in SQLite with content digest and material assertion links to Board entries. `ArtifactRef` points to that exact revision. An Artifact with an unsupported material assertion, failed VerificationResult, or unresolved material Critique cannot enter approval.

The Approval Controller publishes one MagicChat single-choice message with deterministic request ID and `approve` / `reject` option IDs. The durable challenge binds the resulting MagicChat choice-message ID to the initiating user, Case ID, Run ID, Artifact revision, Artifact digest, and expiry.

A `choice.response_created` event is accepted only when its sender is the expected initiating user, its choice-message ID matches the active challenge, its response ID has not been consumed, its option is valid, and the bound Artifact revision/digest is still current. The resulting Approval or Rejection is immutable and unique for the challenge. Replayed responses resolve the existing decision. Rejection blocks publication and ends the canonical R003 run without creating a second Artifact.

Before publication, the Publication Controller acquires the unique Response Claim for the Case publication slot and validates a Freshness token containing conversation/source sequence, trigger message ID, Board and Workflow revisions, Artifact revision/digest, Approval ID, and claim version. It reads the latest visible messages through `conversation.messages.list` with a maximal upper sequence bound, compares the newest sequence, and rechecks the locally observed inbound sequence immediately before send. New input, changed Board/Run state, expired claim, or changed Approval places publication on hold. Freshness is guaranteed at this gate; input accepted by MagicChat after the final check is a later event and cannot retroactively unsend an already accepted response.

The final MagicChat `message.send` request ID is deterministic from Case ID, Artifact revision/digest, and publication action. The pending action is persisted before send; its confirmed MagicChat message ID is persisted afterward. Crash replay reuses the same request ID, relying on MagicChat's durable client-message uniqueness. The response is published only by the Publication Controller and only once.

## Verification, failure and recovery

The primary verification seam is the real official MagicChat App WebSocket against `chaitin/MagicChat@29dfa1c85377e69c3810e28b76a3f5580c3e198d`, not a Mock, build, lint, isolated model call, SQLite query, or UI-only demo.

One frozen synthetic Case must prove:

1. one reliable request event creates one Case and one Run;
2. missing information persists a challenge, and the matching reply resumes the same Run;
3. all four Profiles make non-prebaked Baizhi calls with isolated context snapshots and typed outputs;
4. all nine Board types and their provenance/relations are present;
5. the planted unsupported or conflicting item produces Critique or VerificationResult and cannot silently enter the Artifact;
6. the Artifact's material assertions resolve to the accepted Board graph;
7. only the initiating user can approve the exact Artifact revision through the bound choice response;
8. stale context or newer conversation input holds publication;
9. controlled crashes cover an unknown model Attempt and a post-`message.send` pre-confirmation window;
10. recovery leaves one Case, Run, committed result per logical Invocation, Approval, Artifact, Response Claim, final MagicChat message, and correlated Trace;
11. cumulative ACK occurs only after all business state and related RPCs for the cursor are confirmed.

Observable terminal failures include invalid model schema after the Attempt budget, unresolved Critique, wrong approver, stale Artifact, missing relation/provenance, SQLite transaction failure, unknown MagicChat RPC result that cannot be reconciled, credential/egress violation, and incomplete audit correlation. These failures stop the Run or hold publication; they never bypass a gate.

SQLite recovery covers process crash on one local host. Host loss, shared-filesystem access, backup/restore, multi-process writers, and disaster recovery are not proven. Startup runs integrity checks, reapplies required PRAGMAs, resumes durable Inbox/Invocation/Outbox states, and refuses processing when schema or integrity validation fails.

## Security and operations

- Use only the frozen synthetic dossier and synthetic MagicChat identities/resources.
- Accord receives a dedicated non-production MagicChat App identity and connection secret with only official App permissions.
- Accord receives Baizhi base URL, logical model ID, and API credential through explicit operator configuration or a read-only secret file. It never reads `~/.pi`, embeds a key, passes a key on a command line, or commits credentials.
- Network egress is limited to the pinned MagicChat environment and `ai-api-gateway.app.baizhi.cloud`.
- Baizhi requests set `store=false`, contain no tools, production data, credentials, or hidden cross-Profile history, and use bounded token/Attempt budgets.
- Source content is data with `instruction_authority=NONE`; it cannot alter Workflow, Profile, tool, approval, or policy instructions.
- Persist only candidate outputs, concise reasons, Evidence/Board relations, provider metadata, usage and audit facts needed by R003. Do not persist hidden Chain-of-Thought.
- The single SQLite file and secret material are readable only by the Accord runtime identity. Cleanup removes only resources with exact R003 ownership markers and retains the approved redacted evidence summary.
- Stop immediately on real data, production connection, unapproved egress, credential exposure, wrong-actor approval, duplicate side effect, corrupted SQLite integrity, or missing audit linkage.

## Deferred decisions

- Replace SQLite with PostgreSQL or another shared store only when a committed Release requires another process/replica, production SLOs, host-loss recovery, or a measured SQLite limit.
- Add Pi, Codex, tools, Skills, persistent model Sessions, or another provider only when a committed Release has a concrete consumer and separate permission/recovery contract.
- Add dynamic activation, volunteer/bidding, multiple Workflows, Planner/Harness/GitHub integration, long-term Memory, Agenda, marketplace, production data, or production enablement only through later Releases.
- Revisit the MagicChat source pin when a later committed Release targets another upstream version; rerun the external conformance seam before changing it.
- Revisit provider model pinning when Baizhi exposes an authoritative immutable model version. Until then, one R003 evidence run records both requested alias and returned provider identity and makes no cross-version quality claim.

## Consequences

- R003 can be decomposed without Tickets choosing different owners for Case, Board, Workflow, Runtime, Approval, publication, or audit state.
- One SQLite transaction boundary makes the first crash and replay semantics inspectable with no database service or queue.
- Native model turns keep the first Agent boundary small and controlled, at the cost of possible duplicate provider execution after unknown outcomes.
- The official MagicChat seam directly verifies stable message identity, cursor/ACK behavior, approval responses, and deterministic publication without importing MagicChat source or state.
- The solution is deliberately single-process and non-production. Passing R003 does not justify multi-replica deployment or customer-value claims.

## Repository contract impact

No root policy change is required. These decisions are Release-specific, are discoverable from this ADR, and do not create a stable cross-repository invariant beyond the authority and routing rules already in `AGENTS.md`.

Delivery Specs and Tickets for R003 must cite this ADR and ADR-0002 rather than restating or reconsidering their decisions. No Worker may substitute the R002 Go/JSON structure, a shared MagicChat database, PostgreSQL, Pi Runtime, unbounded model retries, free-text Approval, or an Agent-owned publication path without a replacement ADR or explicit approved exception.
