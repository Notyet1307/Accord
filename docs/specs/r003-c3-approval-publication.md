# R003 C3: Approval decision and deterministic publication

## Status and provenance

- Spec: `R003-C3/r1` — versioned prepared scope.
- Implementation: `NOT_STARTED`. This preparation does not implement C3, accept its behavior, or authorize its execution. A later explicit human execution request is required.
- Task entry: [Accord #62](https://github.com/Notyet1307/Accord/issues/62), retained as the single task pointer with `needs-triage`, not a ready label or Legacy Herdr admission.
- Source: the original #62 body captured before conversion to a pointer; SHA-256 of its exact UTF-8 body string (8,798 bytes, not the JSON wrapper or a normalized Markdown export): `7b9519928c0dacd9c4863d13b023a4172490f721126115277d718e82e7657c7d`.
- Historical implementation base: `64922d0ecc2f50d8f428e36756364edd8ef763aa`, merged C2 through [PR #60](https://github.com/Notyet1307/Accord/pull/60) and corrective [PR #61](https://github.com/Notyet1307/Accord/pull/61).
- Later execution base: the actual merged prerequisite commit recorded in #62 and its linked prerequisite PR evidence. Resolve that immutable commit before execution; the historical C2 SHA above is not the later execution base. No future hash or self-referential spec commit is invented here.
- Partial supersession: this file replaces #62's mutable C3 specification text and old candidate C3 plans only. Preserve the original issue body as a provenance comment before replacing it. Historical acceptance records, Release/ADR decisions, C1/C2 evidence, and predecessor history are not superseded.

The original issue recorded an earlier `继续` execution request. That is historical provenance, not renewed execution permission under the current prerequisite-only request. This document records no new human acceptance receipt and no completed or manually qualified C3 run. Former NOT_BOUND graphs/oracles and candidate issues #43/#31–34 remain non-authoritative; neither this spec nor #62 revives them.

## Objective

Starting from the exact C2 Writer H2/Artifact authority at `WAIT_FOR_APPROVAL`, durably request one initiating-human single-choice decision with only `approve` and `reject`, bound to `(Case, Run, Artifact ID, revision 1, digest)`.

- `APPROVED`: acquire the unique `FINAL_RESPONSE` claim, perform the maximal-bound visible-message freshness read, recheck local inbound and authority immediately before send, and produce/confirm one deterministic final Markdown `message.send`.
- `REJECTED`: terminal, with zero publication and no second Artifact.
- Stale or mismatched publication authority: `PUBLICATION_HOLD`, with no new send.

## Authoritative inputs

1. [Accepted Release R003/r1](../product/releases/r003-governed-case-blackboard-walking-skeleton.md).
2. [Accepted ADR-0002](../adr/0002-production-coordination-runtime-language.md): TypeScript/Node.js, runtime-validated versioned contracts, transactional authority and durable side effects.
3. [Accepted ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md): one process/replica, SQLite/WAL, ownership, approval, claim, freshness, publication, and the ultimate real-seam verification requirement.
4. [Repository policy](../../AGENTS.md), this versioned spec, and the merged prerequisite base resolved from #62. Code, migrations, types, and tests at that base own implementation facts.
5. Official MagicChat source pin `chaitin/MagicChat@29dfa1c85377e69c3810e28b76a3f5580c3e198d`, as established by ADR-0003; extend the existing protocol adapter/simulator against that contract, not chat examples or planner/controller state.

**Resolved ordering discrepancy:** the original #62 objective/handoff put claim acquisition after freshness/local recheck. ADR-0003 owns this decision: acquire the unique claim **before** the remote freshness read; the freshness token binds that claim version; recheck local authority immediately before send. This correction changes no owner, expiry, CAS, or unknown-outcome rule. No additional ADR conflict is identified. A changed owner, external/production scope, or physical-exactly-once promise requires the corresponding approved decision, not a ticket-level workaround.

## Owners, producer, consumer, and primary seam

| Concern | Owner / role |
| --- | --- |
| Request, challenge, receipt, decision, freshness, claim, action, Workflow facts and audit correlation | Accord SQLite, through the existing `AuthorityDatabase` transaction |
| Human validation | Approval Controller: initiating actor, Case/Run/Artifact revision/digest, options, response correlation and expiry |
| Final response | Coordinator/Publication Controller, sole Response Owner: freshness, single claim, deterministic action, confirmation and final audit |
| Actor, conversation, event, message and confirmed external outcome | MagicChat; Accord retains references/projections, never competing external authority |
| Producer | C2 Writer winner supplies durable H2 plus exact immutable Artifact revision 1 and ArtifactRef; the initiating human supplies the reliable choice response |
| Consumer | Approval Controller consumes H2; Publication Controller consumes exact H3 decision plus fresh claim-bound authority; later C4/C5 consume C3's persisted facts, without being implemented here |

Agent output cannot approve, reject, claim publication authority, or publish. The primary seam extends the existing `AuthorityDatabase` transaction and `MagicChatProtocolAdapter`/synthetic simulator protocol path. Do not introduce a second state owner, adapter abstraction, runtime arbitration layer, generic engine, or workflow platform.

## Scope

In scope:

- One complete schema-11 migration, including C3 authority and compatibility below; no schema 11+12 staging.
- Reuse/generalize `inbox_receipts`, `magicchat_inbox_states`, `approvals`, `response_claims`, `pending_side_effects`, `magicchat_rpc_actions`, and `magicchat_messages` where sound. Rebuild/generalize constrained existing tables rather than create parallel competing facts.
- Atomic approval-request intent at the new Writer Artifact winner transaction; transactional recovery of eligible pre-C3 H2 described below.
- Narrow runtime-validated official shapes for a single-choice approval `message.send`, reliable `choice.response_created`, and `conversation.messages.list`, with their correlated confirmations.
- Exact H3 decision binding; freshness token; one `FINAL_RESPONSE` claim; pending/confirmed deterministic publication action and final message record.
- Deterministic IDs/digests, same-process replay/idempotency, upgrade compatibility, and fail-closed startup validation.
- Truthful reliable choice receipts, serial cursor processing and cumulative ACK discipline.

Excluded:

- Real network, credentials, external resources or business calls, production enablement, real MagicChat qualification, or new model execution.
- C4 process-crash recovery proof, full Trace and golden runner; C5 external adapter conformance/T17 real seam. Those Release obligations remain later work, not waived by synthetic C3 results.
- UI, multiple Cases/Artifacts/publication claims, free-text approval, or a claim of physical exactly-once external execution.
- Planner, delivery Controller or Legacy Herdr execution; oracle/child-issue graph creation; candidate #43/#31–34 mutation; ready labels. The product Approval/Publication Controllers above are not delivery automation.
- Changes to C1 golden bytes, frozen fixtures/oracles/evidence/contracts, or C2 Artifact/historical handoff authority.

## State and handoff contract

### H2 and durable approval request

1. Admit only the exact persisted C2 Writer winner, its H2, ArtifactRef, Artifact revision 1, content/manifest/Artifact digests, Case/Run/Board and eligible material assertion graph. Reconstruct and validate existing authority; do not trust a caller-supplied projection. Unsupported assertions, failed verification or unresolved material critique cannot enter approval.
2. For new schema-11 Writer winners, commit Artifact, ArtifactRef, H2, existing winner/Board/Workflow CAS and audit, and the one approval-request intent in the **same** transaction. Failure rolls all of that transaction back. Do not change the existing Artifact or H2 format to encode downstream state.
3. Persist the deterministic approval action and durable challenge before any choice RPC. Bind the initiating actor, App/conversation, Case, Run, Artifact ID/revision/digest, exact option IDs `approve`/`reject`, and expiry. Persist confirmation of the resulting choice-message ID and sequence before accepting a decision; no fabricated message/confirmation is permitted.
4. This choice message is the publication freshness trigger: the expected newest visible message is the exact **confirmed approval choice message**, not a fabricated visible message for the choice-response event.

### H3 and receipt discipline

1. Persist `choice.response_created` as that actual event type, keyed by `(app_id, cursor)` with stable source response identity, payload digest, delivery envelope audit identity, processing state and ACK state. Never route it through a fabricated `message.created` payload.
2. Accept a decision only when the initiating actor, App/conversation, confirmed request/card, response ID, option, serial cursor and unexpired challenge match, and its exact Case/Run/Artifact authority is current. Runtime validation and the transaction/CAS must enforce the binding, not just static types.
3. Commit one immutable Approval or Rejection, unique for the challenge, with decision, exact Artifact binding, actor, response/receipt/challenge/request references and audit correlation: this is H3. Same canonical bytes replay the same decision; conflicting bytes reject. A response cannot be consumed for another challenge.
4. Wrong actor, conversation, card, option, response, cursor, expiry, altered binding or duplicate conflict is audited and cannot mutate a decision or advance publication. A valid `reject` ends the canonical Run as `REJECTED`, with no claim/send/final message and no new Artifact.
5. Process reliable cursors serially. A lower cursor must reach a durable stable wait, observable terminal failure, or completed transition with its required RPCs confirmed before ACK intent. Never cumulatively ACK a higher cursor while a lower one is incomplete. Replays resume existing business/RPC/ACK state. An unconfirmed send cannot be described as completed to permit ACK; unknown ACK confirmation remains truthful under existing discipline.

### Claim, freshness, and publication

1. On `APPROVED`, the sole Response Owner transactionally acquires/resolves the unique Case publication-slot `FINAL_RESPONSE` claim using current Workflow/Approval authority and CAS. Record owner, binding, version and expiry; claim conflict cannot create a second claim or send.
2. With that claim acquired, persist the deterministic freshness-read action and bind the token to conversation/source sequence, trigger choice-message ID, Board revision, Workflow revision, Artifact ID/revision/digest, Approval ID, claim ID/version and applicable expiry. Then invoke `conversation.messages.list` with the pinned protocol's **maximal upper sequence bound**, not the trigger sequence as an upper bound that could hide newer messages.
3. Confirm the response against the exact read request/conversation and bound claim. The newest visible ID/sequence must equal the confirmed choice message. Missing/mismatched expected message, newer visible message, invalid ordering/bounds, or an unconfirmed read cannot yield a valid token.
4. Persist the final publication intent before RPC. Immediately before dispatch, recheck the locally observed inbound sequence and all token-bound authority, including unchanged Board/Workflow revisions, exact Artifact/Approval, claim owner/version, and unexpired challenge/claim. Use transaction/CAS to prevent an intervening local transition from authorizing stale dispatch; place no asynchronous work between the final local check and send. Any mismatch enters `PUBLICATION_HOLD` and sends nothing new.
5. The final Markdown is exactly the approved Artifact's persisted content, not another model output or regenerated revision. Its `message.send` uses the deterministic publication request Envelope ID; confirmation must match that action, conversation, content and external identity. Commit the one final message reference, action confirmation, terminal completion and correlated audit consistently. Only confirmed outcome permits completion.
6. Freshness is guaranteed at this gate, not retroactively: input accepted by MagicChat after the final check is a later event and cannot unsend an already accepted response. This is not physical exactly-once execution.

## Schema-11 compatibility and recovery

Current compatibility facts are owned by `migrations/009_r003_reviewer_writer_contexts.sql`, `migrations/010_r003_writer_artifact.sql`, `persistWriterArtifact` in `src/writer-artifact.ts`, the winner transaction in `src/researcher-analyst.ts`, and `migrateAndValidate`/`validatePersistedWriterArtifacts` in `src/persistence/sqlite-authority.ts`.

- **Existing schema-10 C2 H2:** a valid committed Writer v2 winner already has immutable Artifact revision 1, ArtifactRef and H2 at `WAIT_FOR_APPROVAL`, but no C3 approval intent. During upgrade/recovery, validate that entire pre-C3 authority first, then transactionally create only the missing deterministic approval-request intent/challenge and a **new truthful recovery audit** referencing the existing winner/H2 and the actual recovery time. Keep a durable, validated migration provenance distinction so later deletion of a schema-11-required intent is rejected, not silently repaired as legacy compatibility.
- Do not rewrite/backdate historical H2, Artifact bytes, Runtime materialization, winner timestamps, existing audits, or decisions. The new audit says an intent was created on recovery, not that it existed at the old winner boundary. Do not invent an earlier card send, confirmation, human decision, claim or publication. An expired/mismatched current binding cannot be made fresh by rewriting history.
- Recovery is idempotent: same deterministic intent plus same canonical binding resolves the existing fact; a conflict fails closed. Reopening must not create another intent/challenge/audit or reset expiry. Creation and its provenance/audit are atomic; startup failure rolls back all changes, rather than leaving a partial schema or repaired graph visible. No RPC is performed during database startup.
- **Schema-9 legacy Writer v1:** preserve the existing ability to upgrade/reopen a valid historical generic v1 Writer winner without an Artifact. A historical ArtifactRef/H2-shaped payload is not a C2 Artifact carrier. Do not manufacture an Artifact, approval intent, Approval, claim or publication from it; it is historical compatibility data, not an eligible C3 producer. Reject the already-invalid case of a v1 winner claiming a C2 Artifact. Existing schema-9 compatibility must survive schema 9 → 10 → 11.
- **Schema-11 current authority:** validate every C3 request/challenge, receipt, decision, freshness record, claim, action, message and audit relation, canonical digest, identity, chronology and state at startup. Missing/orphaned/tampered/conflicting facts fail closed before processing. Preserve existing schema fingerprints, migration checksums, PRAGMAs, integrity checks and pre-recovery graph validation; do not edit migrations 1–10.

These bounded upgrade and startup requirements do not claim the broader C4 controlled process-crash recovery proof.

## Stable identities and idempotency

Use existing deterministic-ID and canonical-digest conventions. Bind business identities to the exact logical facts, never a transport replay envelope or a fresh random value:

| Fact | Required logical binding |
| --- | --- |
| Approval request/action/request envelope and challenge | Case, Run, exact Artifact ID/revision/digest, initiating actor/conversation, challenge version and approval action kind; canonical request fixes options and expiry |
| Approval / H3 | Exact challenge and immutable decision/actor/response/Artifact binding |
| Choice receipt | App and reliable cursor; stable response identity and canonical payload validated against the challenge |
| Freshness read/action/request envelope/token | Publication binding, acquired claim ID/version and exact authority snapshot/read contract |
| Response Claim | Case `FINAL_RESPONSE` publication slot, sole owner and exact Run/Artifact/Approval binding; version is validated authority, not permission for another claim |
| Publication action/request envelope | Case, Artifact revision/digest and publication action, with Run/Artifact/Approval/claim correlation in the canonical intent |
| Final message | Confirmed deterministic publication action and MagicChat message identity |
| Audit | Existing audit identity/correlation conventions plus exact logical transition and its Case/Run/source/action references |

Same ID plus same canonical bytes returns/replays the existing fact. Same ID plus different bytes is an identity conflict. Incoming delivery Event IDs are delivery/audit identities, not replay-stable business IDs; outbound `message.send` request Envelope IDs are deliberately stable because MagicChat uses them as durable client-message identities.

## Failures and recovery behavior

Fail closed on wrong actor/conversation/request/card/option/response/cursor, expired challenge or claim, stale/altered Artifact/Approval/Board/Workflow, invalid freshness order, duplicate conflict, orphaned action/audit, claim conflict, publication mismatch, failed CAS or SQLite integrity/transaction failure. Rejected input may be retained as an audited event, but cannot become acceptance authority. Do not turn a startup-corrupt graph into an ordinary publishable hold.

Persist pending intent before every RPC. Same-process replay resolves the original request/action/claim and never recreates business facts. A confirmed rejection never publishes. A confirmed publication resolves its recorded outcome, not a new send. An unknown send stays honestly pending/unknown, correlated to the original request ID; reconciliation/replay uses that ID and MagicChat's durable client-message uniqueness, never a new ID. Unknown is neither success nor proof that no external message exists. Do not bypass freshness/expiry to dispatch a new send; if the existing outcome cannot be safely reconciled, retain unknown/hold without claiming completion. No new general retry engine or C4 crash-boundary machinery is part of C3.

## Acceptance tests and evidence to return

On a later explicit C3 execution request, add focused synthetic simulator tests through the existing authority/protocol seam for:

1. One valid initiating-human `approve` reaches one confirmed final Markdown message with exact H2/H3/claim/action correlation; valid `reject` is terminal with zero publication.
2. Wrong actor, conversation, card, option, response, cursor, expiry, altered Artifact or stale state cannot decide/publish. Duplicate same-byte choices replay; conflicting choices cannot mutate the decision. Choice receipts retain their real event type and serial cumulative ACK behavior.
3. Freshness matrix: exact newest choice message succeeds; newer visible or local inbound message, missing/mismatched trigger, non-maximal upper bound, altered local authority or expired claim/challenge holds with no new send. Assert claim acquisition before remote read, token claim-version binding and final local CAS/recheck before dispatch.
4. Exactly one request/challenge, decision, Response Claim, publication action/request and final message; deterministic content/IDs; pending versus confirmed publication; unknown-send replay/reconciliation with the original request ID and no fabricated confirmation.
5. Startup rejection of tampered/orphaned requests, challenges, receipts, decisions, freshness records, claims, actions, messages and audits, including same-ID/different-bytes conflicts and impossible chronology.
6. New Writer winner transaction rolls back on approval-intent failure. Populated schema-10 H2 upgrade creates one truthful new intent/audit without changing historical bytes; repeated reopen is idempotent; failure rolls back; invalid legacy authority is not repaired. Schema-9 Writer v1 upgrades/reopens without manufacturing Artifact or approval authority. Schema-11 missing required intent is rejected rather than misclassified as pre-C3 recovery.
7. C1 golden/fixture/oracle/evidence/contract/handoff bytes and C2 historical Artifact/H2 authority remain unchanged; new C3 coverage must not rewrite frozen inputs to pass.

Use the repository-pinned Node toolchain, focused C3 tests and the full `TMPDIR=/private/tmp ./scripts/validate-ci.sh` after integration. CI is explicitly **non-qualification**: existing real/manual qualification remains fail closed. An unavailable manual conformance check must be reported unavailable, never represented as passed. Synthetic simulator evidence does not establish real MagicChat behavior, T17, C4/C5, R003 completion or production readiness.

Return one SHA-bound PR evidence record linked from #62: exact execution base and tested source SHA, this spec revision/path, changed and preserved behavior, migration/schema/interface changes, deterministic identity and failure/recovery results, exact commands/results, synthetic evidence artifacts, qualification limitations, remaining risks and ADR impact. Historical evidence remains where it already lives; do not create a parallel ledger, task graph or invented human acceptance record.
