# Delivery Gate

Planning artifacts and execution authority remain separate.

## Candidate state

- A Delivery Spec Parent and every implementation child are created with `needs-triage`.
- Candidate creation, review, and Controller handoff do not add a ready label or start execution.
- The accepted Parent title and body remain immutable after current Spec publication binds its exact `pi-ticket-planning:spec-acceptance:v1` receipt.
- `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` use the mappings in `docs/agents/triage-labels.md`.

## Current executable Release

- Bind one separate `pi-ticket-planning:delivery-release-graph:v3` artifact in the authoritative Planning Case; never append it to the immutable Parent body.
- The graph represents exactly one bounded all-AGENT Release. Future Releases and HUMAN work remain in a separate non-executable Roadmap.
- Every Parent Scenario has DIRECT coverage; every ENABLER names a current consumer and objective exit condition; every consumed state or artifact has an earlier producer or declared external input.
- The walking skeleton closes the smallest trigger-to-result loop, and native child order places every blocker before its dependent.
- Ordinal 2 and later bind the accepted predecessor `release-result:v1`, exact prior Plan digest, and fresh execution-base ancestry.

## Readiness review

Before Controller handoff, require the current `ticket-readiness` contract:

- one primary outcome and one primary behavioral verification seam per child;
- three to eight single-assertion acceptance criteria and no more than three independent delivery surfaces;
- canonical risk classes, bounded scope/write families, protected paths, REPLAN triggers, and integration-only declaration;
- for high-risk work only, an exact independently owned Oracle binding and closed trusted verifier manifest; normal/low work omits the Oracle section;
- one passing exact-base Ticket Context check per child;
- passing graph contract, Scenario coverage, walking-skeleton, strict-frontier, closure, and freshness checks;
- one fresh, binding-bound independent whole-Release review;
- explicit human acceptance of the exact reviewed graph and exact handoff fingerprint at their owning gates.

Any source, accepted Parent, child body, graph, decision, Oracle, order, blocker, policy, or base drift requires fresh deterministic checks and review. Missing or conflicting authority fails closed.

## Recommended Controller handoff

A reviewed bounded all-AGENT `delivery-release-graph:v3` proceeds through `/prepare-codex-release`:

1. Planner freshly re-reads the accepted Parent, receipt, graph, decisions, children, native edges, policy, and execution base.
2. Planner compiles one semantic `release-plan.json` for the current Release and displays its exact fingerprint.
3. The operator approves that exact fingerprint once.
4. Planner materializes the private Controller input and transitions the Planning Case to `HANDOFF_READY` after exact readback.
5. Planner reports the Controller start command; the operator starts it separately.

All Issues remain `needs-triage`. Planner does not start or poll the Controller, create implementation commits or PRs, merge, or infer execution success. A verified public `release-result:v1` is the only predecessor evidence accepted for a later Release.

## Explicit Legacy Herdr exception

Only an operator's explicit Legacy Herdr selection may invoke `/admit-ticket` and apply `ready-for-agent` or `ready-for-human`. That path requires its own capability qualification, readiness evidence, exact mutation Plan, and human confirmation. Parent-last label activation applies only to that Legacy path and is not a prerequisite for planning publication or the recommended Controller handoff.

## Authority boundary

- GitHub owns Issue, label, relationship, PR, commit, check, and merge facts.
- The Planning Case owns Spec acceptance, graph, decision, review, approval, and handoff records.
- The configured Controller or explicitly selected Harness owns execution facts.
- The Accepted Release, applicable ADRs, effective root policy, current code/tests, tracker, and execution system retain their concern-specific authority; no fact is inferred from chat, examples, fixtures, or another system's projection.

Tracker relationship operations are defined in `docs/agents/issue-tracker.md`. Label strings are defined in `docs/agents/triage-labels.md`.
