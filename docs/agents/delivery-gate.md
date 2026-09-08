# Delivery Gate

## Current path: OMP

Use one goal, one versioned repository Spec, one GitHub task entry, and one PR evidence record per authorized change. The Accepted Release, applicable ADRs, and product/runtime/security invariants in `AGENTS.md` remain binding.

1. **Establish scope.** Use the user's explicit request to identify the authorized goal, changes, and external operations. Spec preparation, implementation, push/PR/merge, and production or business actions are distinct scopes; authorization covers only what the user actually requested. Record a reference to the actual request, not a manufactured acceptance receipt.
2. **Pin the contract.** Put behavior, boundaries, acceptance criteria, and evidence requirements in one repository Spec. Identify its path and Git revision. Resolve conflicts with the Accepted Release or ADR before implementation; approval of preparation alone does not authorize executing the Spec.
3. **Use one task entry.** The GitHub Issue links to the Spec and relevant PR, and owns current remote task status. Follow `issue-tracker.md` when preserving historical bodies. Do not create a parallel graph, child-ticket set, planning ledger, or local status mirror.
4. **Execute the authorized change in OMP.** Reuse current code and contracts, collect actual tool/command/review results, and stay inside the authorized boundary. Missing authority or changed scope requires a new explicit user decision.
5. **Bind evidence and deliver.** Use the PR record below. Merge only within explicit authorization, with required checks passing for the current head and acceptance criteria satisfied for the authorized change. Re-read GitHub for actual check and merge outcomes.

## One SHA-bound PR evidence record

The PR body is the current evidence index. Link actual logs, check runs, and review records rather than synthesizing execution-system results. Include:

- goal/Issue, actual scoped authorization reference, and what this PR does and deliberately leaves unimplemented;
- execution base SHA, current PR head SHA, Spec path, and exact Spec commit/blob or digest;
- acceptance-criterion results, exact commands and outcomes, environment/toolchain, and links to actual evidence and review findings/disposition;
- GitHub check names/run URLs and their tested SHA; distinguish a PR merge-test commit from its head;
- remaining limitations, unavailable checks, qualification status, and the observed GitHub merge result when delivered.

Code, Spec, policy, or relevant base drift invalidates affected checks/review. Refresh the evidence for the new head and Spec revision before claiming completion; retain earlier records as historical evidence. Do not promote a result from an older SHA, a fixture, or a successful tool invocation into current acceptance.

## CI and stronger qualification

Keep `.github/workflows/herdr-delivery-gate.yml`, workflow name `Herdr delivery gate`, and check name `herdr-delivery-gate` unchanged. GitHub Actions runs `./scripts/validate-ci.sh`; this is **non-qualification CI**, not proof of the trusted operator boundary, real MagicChat behavior, or the complete R003 Release.

`./scripts/validate-delivery.sh` retains the stronger fail-closed, local-only qualification path. Before interpreting repository shell, the operator-owned launcher must establish the no-network, secret-minimized filesystem boundary, private temporary directory, and read-only offline cache. Qualification requires an actual exact-commit operator execution record with verified launcher/profile hashes and `BOUNDARY` attestation. Setting a marker, ordinary CI, or an OMP narrative cannot create that evidence.

Preserve historical Controller qualification receipts as evidence of the executions they actually record; no new Controller result is required or may be fabricated for the OMP path. If the trusted launcher or manual/external conformance surface is unavailable, report qualification/conformance as unavailable or unproven. Synthetic simulator evidence remains labeled synthetic. A prerequisite merge does not waive any later qualification, Human Approval, or production gate.

## Historical routing is noncurrent

Planner/Controller and Legacy Herdr routing are not prerequisites for the current path. Their accepted bodies, receipts, graphs, admission records, and execution results remain immutable historical provenance, not present authority or a queue to activate. A separate explicit user selection is required to use either path and its own applicable gates; labels alone never select or authorize it.

Changing these documents does not establish that any existing Herdr process has stopped. Do not start, poll, stop, admit, or activate an old queue as an implied part of this cutover. Preserve old routing records without inferring their live state.

## Authority boundary

- GitHub alone owns remote Issue, label, relationship, PR, commit, check, and merge facts.
- The versioned Spec owns the task contract within the Accepted Release and ADR boundary; the Issue and README are pointers, not competing Specs.
- The actual user request owns development authorization. OMP records only work actually executed and evidence actually observed.
- External systems retain their product/domain facts. Simplifying repository delivery does not change Approval, Artifact, Runtime Operation, external-outcome, security, or R003 boundaries.

Tracker operations are defined in `issue-tracker.md`; label meanings are defined in `triage-labels.md`.
