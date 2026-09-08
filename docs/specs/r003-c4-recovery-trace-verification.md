# R003 C4: Process recovery, complete Trace and integration verification

## Status, authority and authorization

- Spec revision: `R003-C4/r1`; prepared for review, not an accepted implementation or execution receipt.
- Sole task entry: [#44](https://github.com/Notyet1307/Accord/issues/44). GitHub owns current task state; this file owns the proposed C4 behavior contract.
- Actual request: 用户「按照你的建议继续」，并明确选择「仅准备 Spec 和入口」。This authorizes this specification and navigation updates only. Implementation, commit/push/PR/merge, credentials, external execution and qualification require separate scoped authorization.
- Technical preparation base: `e5865c2e5f20e64deef831238837e36efa880841`, the actual C3 [PR #64](https://github.com/Notyet1307/Accord/pull/64) merge. This is not an invented commit containing this new Spec. Before implementation, bind the reviewed Spec to its actual delivered Git revision and recheck code/base drift.
- Historical #44 body: exact UTF-8 SHA-256 `ba4077b2072ff419fa9d884dc043c3756f1f04c18792cdc0dee80cc36f985eff`, preserved in [the provenance comment](https://github.com/Notyet1307/Accord/issues/44#issuecomment-5579028380). Its unbound graph, child/oracle routing and acceptance state remain historical, not current dependencies or authority.

Authoritative inputs:

1. [Accepted R003 Release](../product/releases/r003-governed-case-blackboard-walking-skeleton.md): one synthetic Case, fixed Workflow, four Profiles, governed Artifact, Approval, unique publication, complete Trace and controlled recovery.
2. [ADR-0002](../adr/0002-production-coordination-runtime-language.md) and [ADR-0003](../adr/0003-r003-governed-case-blackboard-boundary.md): TypeScript/Node, one Accord SQLite/WAL writer, bounded Attempts, source ownership, claim-before-freshness, UNKNOWN, ACK and read-only audit projection.
3. [C3 Spec](r003-c3-approval-publication.md) and current code/tests at the preparation base: schema11 authority, exact H2/H3, freshness/dispatch and replay contracts. C3 explicitly leaves process-crash proof, full Trace and the golden runner to C4.
4. [Delivery gate](../agents/delivery-gate.md), [tracker rules](../agents/issue-tracker.md) and repository invariants: one Spec, one task pointer, one eventual SHA-bound PR evidence record. Preparation does not activate historical Planner/Controller/Legacy Herdr paths.

The Vision supplies direction, not permission to expand R003. No ownership or ADR change is proposed. A conflict with an Accepted Release/ADR must return to its owner before implementation.

## Objective, owners and primary seam

Prove that the existing C1–C3 synthetic path survives two precise process-death windows with correct logical identities, truthful unknown outcomes and one complete redacted Trace. Provide one integration-only runner that reproduces that proof without duplicating product decisions.

| Concern | Owner / producer / consumer |
|---|---|
| Case, Run, Board, Invocation/Attempt, receipts, H2/H3, claim, RPC and recovery facts | Existing Accord SQLite authority; no second store or writer |
| Read-only Trace | Accord audit projection over those persisted facts; consumes C1–C3 records, serves C4 assertions and later separately authorized C5 evidence consumers |
| Failure coordination and evidence | Bounded C4 test runner; controls worker lifetime and synthetic ports, not business state |
| Simulated external observations | Test parent owns fixture observations across worker death; clearly synthetic, never asserted as real MagicChat/Baizhi authority |
| Real external outcomes | MagicChat/Baizhi retain ownership; not exercised by C4 |

Primary seam: existing authority startup/recovery and public protocol/runtime operations -> read-only Case Trace -> deterministic integration assertions. The runner supplies inputs and port responses through real implementation APIs; it does not set Workflow state, insert winners/Approvals or repair database rows.

Concrete reuse at the base:

- `openAuthorityDatabase`, `beginPreparedAttempt`, `executePreparedAttempt`, existing provider-receipt recovery and interrupted-Attempt reconciliation.
- `MagicChatProtocolAdapter.receive/dispatch/pendingRequests`, C3 approval/publication inspection and deterministic simulator behavior.
- Existing intake SIGKILL harness and capability inheritance, not a new generic fault framework.
- Existing C1 frozen fixtures/oracles/handoffs and C2/C3 integration fixtures. Keep the frozen inputs unchanged.

## Scope and exclusions

In scope:

- Two independently executed worker-process SIGKILL/restart scenarios: unknown model Attempt and accepted-but-unconfirmed publication.
- Bounded parent/worker coordination so simulated external facts survive worker death; repeat recovery and source-event replay through existing APIs.
- One complete, bounded, redacted, read-only Case Trace projection and a deterministic runner for the fixed integration path.
- Targeted checks of retry exhaustion, existing durable-result recovery, expiry/freshness, ACK uncertainty and queued-event ordering. These do not add independent kill-window campaigns.
- The smallest explicit test-entrypoint/capability inventory changes required to run the worker under existing restrictions.

Out of scope:

- Real MagicChat/Baizhi calls, credentials, network services, T17, primary-seam qualification, operator qualification, Pilot or R003 completion claims.
- A third mandatory kill window, exhaustive crash-point enumeration, host loss, backup/restore, multiple Accord writers/replicas or disaster recovery.
- New Workflow behavior, retry policy, acceptance authority, automatic product queue draining, replacement transport adapters or a general recovery/fault/observability platform.
- UI, Lody/ACP, dynamic Profiles, task graphs, new ready labels or old Controller execution.
- Rewriting C1 golden bytes, frozen fixtures/oracles/contracts/handoffs or C2/C3 historical Artifact/Approval authority.

Schema11 is the default boundary. The Trace and runner add no database authority or migration. If a required fact is genuinely absent, return `REPLAN_REQUIRED` with the missing producer/consumer fact and proposed bounded source change; do not synthesize it or silently introduce schema12. The same rule applies if an existing product behavior is missing: report it before expanding this Spec.

## Fixed scenario and process boundary

Use the existing synthetic request, clarification, source manifest, Researcher/Analyst/Reviewer/Writer output contracts, accepted evidence and exact Artifact approval/publication path. The runner executes three primary scenarios in independent owned temporary directories: `happy`, `model-unknown`, `publication-unconfirmed`. Each starts the same frozen logical Case; separate test databases are not multi-Case product support.

The path is explicit: reliable intake -> stable clarification and ACK -> source reply/replay -> four fixed Profile contributions and governed Board -> exact Writer Artifact/H2 -> bound synthetic choice/H3 -> claim and freshness -> publication confirmation -> final ACK. The historical shorthand S1–S9 refers to this integration path plus the two recovery variants, not to a revived unbound oracle graph.

- One child worker at a time owns Accord's SQLite connection. Wait for verified child termination before starting its replacement; the test parent does not write Accord business tables.
- The parent holds the deterministic external simulator/request observations outside the killed worker, using bounded local IPC. No network listener, new database or real service is needed. Parent failure and external simulator durability across parent death are not claimed.
- The parent may know an external call occurred without giving Accord a result-retrieval capability its real adapter does not possess. Provider observations are evidence, not a recovery backdoor.
- Use an explicit boundary acknowledgement after the required durable/external step and withhold the relevant response/continuation until the kill. A sleep or an assumed timing race is not proof of reaching the window.
- Capture the actual SIGKILL exit signal and launch a new PID against the same database. Close/reopen and caught exceptions are supporting regressions, not replacements for these process-death checks.
- Use the existing synthetic clock support consistently across parent/worker restarts, identify it as `SYNTHETIC_CONTROLLED` in evidence and freeze scenario instants. It must not weaken C3's actual-clock floor or add a caller-controlled production expiry bypass. Harness deadlines use a host monotonic clock, not the frozen scenario clock.
- Bound each worker wait to 10 seconds and each primary scenario to 60 seconds; on timeout fail, stop only owned children and retain diagnostic evidence. POSIX SIGKILL is required for these acceptance runs; an unsupported platform reports unavailable, never a passing crash proof.

## Recovery contracts

### W1 — unknown model Attempt

Use the RESEARCHER Invocation of the fixed path to exercise the shared four-Profile runtime seam.

| Boundary | Required fact / behavior |
|---|---|
| Entry | Invocation and frozen Context exist; first Attempt is durably RUNNING; the synthetic provider has observed the call; no recoverable provider receipt/result has reached Accord |
| Cut | Parent withholds provider completion; kill the worker after the port-call boundary acknowledgement |
| Restart | Normal startup validates authority before recovery, reconciles the interrupted Attempt to UNKNOWN and retains the canonical arrival/audit correlation |
| Permitted continuation | Under the existing policy, at most one replacement Attempt under the same Invocation and frozen binding; valid replacement output may win once |
| Forbidden inference | UNKNOWN is neither success nor proof that the first call never executed; no provider result may be injected from the parent's private observations |
| Positive outcome | Fixed path completes with one committed result per logical Invocation and the original Case/Run identity; interrupted and replacement Attempts remain distinguishable |

Assert the persisted two-total-Attempt ceiling. A failed/unknown replacement reaches the existing observable terminal failure without a third call. A separately exercised already-persisted recoverable wire/Delivery is consumed through existing recovery without an unnecessary replacement call. These are runtime regression obligations, not extra mandatory SIGKILL windows.

Report actual observed provider calls and known usage separately from logical winners. Unknown usage/cost remains unknown; no physical-exactly-once or real model-quality claim.

### W2 — publication accepted, local confirmation missing

| Boundary | Required fact / behavior |
|---|---|
| Entry | Exact Artifact/H2/H3, unique FINAL_RESPONSE claim, fresh binding and deterministic publication action/request exist |
| Cut | Normal dispatch has durably recorded UNKNOWN and first dispatched_at; parent simulator has accepted that request and created one visible message; withhold its confirmation and kill the worker |
| Restart | Normal startup validates the graph; recover the same request ID, canonical request bytes, claim and first-dispatch identity without creating business facts again |
| Permitted continuation | While current gates permit it, replay the original request through the surviving simulator; durable client-message uniqueness resolves the original external message |
| Positive outcome | Exactly one visible final message, one local confirmed publication and final ACK; same Artifact revision/digest, H3, claim and request identity |
| Unsafe reconciliation | If current expiry/freshness or correlation no longer permits safe reconciliation, retain truthful UNKNOWN/HOLD; do not mint a request ID, renew authority or fabricate COMPLETE |

Keep external message identity/sequence and local confirmation separate. Confirmation must satisfy C3's first-authorized-dispatch chronology and pinned body-normalization rules. The sent Markdown is the exact Artifact; the external stored body may differ only by the pinned normalization already implemented in C3. The synthetic summary is not a real rendering oracle.

### ACK and queued-event recovery

The runner explicitly drives existing source replay; the adapter does not acquire an automatic queue-draining feature.

- Simulate remote ACK acceptance with its local confirmation withheld. The honest durable state remains ACK_INTENT; reconstruct/reconcile it through the existing pending request and synthetic reconnect/replay behavior before processing a higher cursor.
- Retain a three-cursor regression containing a queued real `choice.response_created` between other inputs. Lower ACK confirmation must precede processing/ACK of that choice; replaying a later source event cannot erase the choice through cumulative ACK.
- Source response identity and reliable cursor remain distinct from delivery envelope IDs and conversation message sequences. Preserve the actual event type.
- Replay after completed work resumes existing RPC/ACK state without creating another Case, Run, Board contribution, Artifact, Approval or publication.

A standalone ACK SIGKILL scenario is not a third C4 acceptance window. Adding one requires an explicit scope revision rather than relabelling it as already agreed.

## Read-only complete Trace contract

Expose one Case-scoped projection through the existing authority boundary. Use version `accord.r003-case-trace/v1`; successful output contains:

| Section | Required content from persisted facts |
|---|---|
| Identity/state | Case, Board and Run IDs; definition/revision references; actual node/Workflow/Case states |
| Ingress and input | App/conversation/source message or response IDs; reliable cursors; delivery references/digests; actual event kinds and receipt/ACK states |
| Runtime | Four fixed Profile references, logical Invocation IDs, frozen Context revisions/digests and selected entry references; Attempt states, outcome/result/arrival references and known provider metadata/usage |
| Governed Board | All nine Entry types in the successful fixed path; stable IDs, status, provenance/visibility/trust references, content digests and typed relation endpoints |
| Artifact and decision | Exact Artifact revision/digest and material-assertion basis links; H1/H2/H3 correlation; challenge/card/actor/response bindings and actual decision |
| Publication | Claim identity/version/owner, freshness bindings and observed-input cutoff, pending/action/request identity and state, first dispatch, external message confirmation and ACK correlation |
| Audit | Relevant immutable event identities, typed transitions and source links, including interrupted/unknown/non-winning attempts and rejected/stale inputs |

Contract rules:

1. Every projected record retains its source identity; relations resolve to actual records or explicitly typed external references. Never infer an absent edge from matching prose, list position or a test's expected path.
2. Completeness is phase-aware: a legitimate waiting/rejected/failed Run can have a complete Trace without a final message or an Approval that never occurred. A successful fixed path must contain the full declared chain. Missing facts required by the actual persisted phase fail the projection.
3. Startup-invalid authority is rejected before recovery/export. Unknown Case, invalid/incomplete authority and output-limit errors are distinguishable failures; none produces a success-shaped partial Trace or repairs state.
4. Use existing canonical serialization and stable identity conventions. Sort collections by explicit stable keys and preserve causal links, source timestamps, receipt timestamps, first-dispatch and confirmation timestamps as distinct facts. Do not assert a global order from clocks alone.
5. Limit successful canonical UTF-8 output to 1 MiB. Over-limit output fails with an explicit limit error; do not silently truncate a required record or relation. The fixed scenario must fit this bound.
6. Export an allowlisted projection: IDs, typed outcome/status, selected typed Board/Artifact evidence, references/digests and required known metadata. Omit provider wire capsules, full private prompts/context/history, credentials, environment dumps and hidden reasoning. Record redaction policy version `accord.r003-case-trace-redaction/v1`.
7. Projection reads one consistent validated authority snapshot and does not promote candidates, consume pending work, append an audit event or advance revisions. Startup recovery precedes this operation and is measured separately; projection itself is read-only. Two projections of unchanged authority yield identical canonical bytes/digest. Successful Trace reconstruction means evidence completeness, not business success or external qualification.

Do not add a Trace database, event bus or parallel authoritative log. A narrowly scoped projection over current facts is the deliverable.

## Runner, evidence and capability contract

Provide one executable repository command for all three primary scenarios using the pinned toolchain and built code; document the actual command in the delivery PR. It must be runnable without real credentials or network. No implementation command is invented by this preparation document.

The runner orchestrates existing APIs and verifies outcomes. It neither duplicates production acceptance/freshness/recovery logic nor writes business rows to reach the desired state. A missing production capability returns `REPLAN_REQUIRED` and stops the affected scenario instead of implementing a fallback in the runner.

For each scenario, create an owned output directory containing:

- `manifest.json`: code commit, Spec revision/digest, toolchain, fixture/manifest and protocol pins, clock mode and bounds, scenario and actual child termination/restart evidence. Operational PID/time/path metadata is separate from deterministic business data.
- `trace.json`: successful read-only projection of the actual resulting authority; no success-shaped file on projection failure.
- `external-observations.json`: clearly synthetic parent-side request IDs/digests, observed call counts, visible-message identities/counts and ACK observations, without private provider payloads or secrets.
- `result.json`, version `accord.r003-c4-run/v1`: scenario ID, `PASS | FAIL | REPLAN_REQUIRED | UNAVAILABLE`, named assertion outcomes, observed terminal/hold/unknown state, file digests and diagnostics. Only all required passing scenarios/assertions yields overall exit0; every other status exits nonzero.

The same redaction boundary applies to every artifact, stdout/stderr and failure diagnostic, not only `trace.json`. Use bounded error codes, source IDs and redacted descriptions; do not dump private wire/context or the process environment on failure. Synthetic canaries placed in excluded material must be absent from all emitted evidence.

An unknown/hold negative regression can pass its assertion because that is the required outcome; the positive W1/W2 scenarios use controlled fresh successful continuations and must complete the fixed path. Trace completeness and scenario verdict remain separate fields/concepts.

Run each primary scenario twice in fresh directories. For the same frozen inputs and controlled scenario instants, compare stable business identities, canonical Trace bytes/digest and outcome assertions. PID, wall duration and temporary paths are recorded but excluded from deterministic comparison. Never freeze an arbitrary raw provider response or change existing C1 golden data to obtain equality.

Capability rules:

- Reuse inherited Node filesystem/preload restrictions and a secret-minimized child environment. Children may access only their declared code/fixtures and owned temporary paths.
- Existing runtime/static guards permit `child_process` only at a named intake harness. Any C4 extension must name its exact test/runner entrypoint and be accompanied by a regression proving unrelated modules remain denied. Do not globally enable child-process imports, network, environment-secret reads or arbitrary filesystem access.
- Keep all children bounded; stop only owned processes. Retain failure evidence. Cleanup only owned temporary resources; no host-wide process termination or repository-wide cleanup.
- Keep the existing non-qualification CI and stronger trusted-launcher path distinct. No marker, simulated event or CI success becomes an operator attestation.

## Acceptance and evidence to return

| ID | Acceptance criterion |
|---|---|
| C4-A1 | Current baseline/Spec are exactly bound; runner uses real C1–C3 APIs, unchanged frozen inputs and no direct business-state construction |
| C4-A2 | W1 produces an observed SIGKILL and new worker PID, preserves the logical Invocation, records UNKNOWN and selects at most one winner under the two-Attempt ceiling; persisted-result and exhausted-budget regressions pass |
| C4-A3 | W2 records external acceptance before observed SIGKILL, retains parent simulator facts, reopens authority and confirms the original publication with one visible final message; unsafe reconciliation does not bypass gates |
| C4-A4 | ACK uncertainty and three-cursor queued-choice replay preserve event kinds, decisions and cumulative ordering, including repeat recovery, without introducing automatic product draining |
| C4-A5 | Full fixed-path Trace resolves required provenance/correlation, stays read-only and deterministic, and rejects incomplete/corrupt/over-bound output while excluding secrets/private wire/context material |
| C4-A6 | Three primary scenarios and repeat runs produce the declared evidence files and truthful exit statuses; failed, unavailable or replanning cases cannot be reported as overall success |
| C4-A7 | Narrow child-process capability changes preserve unrelated denials; no network/credential access, unowned cleanup or concurrent Accord writers |
| C4-A8 | Existing C1–C3 contracts, historical migrations/Artifact/H2/H3 facts and regressions remain valid; focused C4 checks, standalone runner and full `TMPDIR=/private/tmp ./scripts/validate-ci.sh` pass on the actual delivery head |

The eventual single PR evidence record linked from #44 must include the actual authorization, execution base/head and Spec revision/digest, every C4-A result, exact commands/toolchain/exit codes, actual PID/signal/barrier observations, redacted Trace and simulator/result artifacts with digests, repeat-run comparison, independent review findings/disposition, GitHub checked SHAs and merge outcome when authorized. Preserve historical evidence where it already lives.

Stop and return a bounded decision if completion requires a new schema/authority, new retry or queue-drain policy, external credentials/services, absent source facts, a broader fault framework or weakening capability gates. Ordinary implementation defects within the agreed seam may be fixed with a regression; they do not authorize changing the agreed behavior contract.

C4 establishes synthetic process-death recovery and inspectable integration evidence on one host. Real official adapter conformance/T17 and non-prebaked real model execution remain separately authorized later work. C4 does not prove real Human Approval, trusted operator qualification, external physical exactly-once execution, host durability, production readiness or the full R003 Release.
