# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues. Use the `gh` CLI for operations and infer the repository from `origin`.

## Conventions

- Create an issue with `gh issue create`; use a heredoc for multi-line bodies.
- Read an issue with `gh issue view <number> --comments`, including labels.
- Comment with `gh issue comment`; mutate labels with `gh issue edit`.
- Close with `gh issue close <number> --comment "..."`.

## Pull requests as a triage surface

PRs as a request surface: **no**. Pull requests are delivery artifacts, not feature-request intake.

## Wayfinding operations

A Wayfinder map is one issue labelled `wayfinder:map`; its children use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`. Prefer native GitHub sub-issues and dependencies. If either capability is unavailable, use a parent task list and a `Blocked by: #...` line, and record that fallback in the map.

Wayfinder maps and children never receive `ready-for-agent`.

## Delivery planning operations

Used by `/to-spec`, `/to-tickets`, and `/prepare-codex-release`. `/admit-ticket` applies only when the operator explicitly selects the Legacy Herdr path.

- **Draft parent**: create one Delivery Spec Parent with `needs-triage` and no ready label. Current Spec publication appends exactly one `<!-- pi-ticket-planning:parent-kind:executable-delivery-spec -->` marker and binds a `pi-ticket-planning:spec-acceptance:v1` receipt. After acceptance, keep the Parent title and body immutable.
- **Candidate child**: create each current-Release implementation candidate with stable Scenario IDs, coverage role, execution lane `AGENT`, and `needs-triage`, then attach it as a native GitHub sub-issue of the accepted Parent.
- **Coverage artifact**: bind exactly one `pi-ticket-planning:delivery-release-graph:v3` JSON artifact in the same Planning Case. Keep it separate from the immutable Parent body. It represents one current all-AGENT executable Release and binds the accepted Spec, fresh execution base, decision manifest, predecessor facts, Scenario handoffs, child bodies, risks, scope, and applicable Oracle bindings. Future Releases and HUMAN work belong in a separate non-executable Roadmap.
- **Graph check**: run `node "$PI_TICKET_PLANNING_ROOT/scripts/check-delivery-graph.mjs" --input <bound-delivery-release-graph.json>`. Contract, Scenario coverage, walking skeleton, and strict-frontier order must all pass.
- **Blocking**: use native issue dependencies. Add edges only after every candidate has an Issue ID, and include only current-Release child blockers in the executable graph.
- **Order**: keep native children in stable topological order so every blocker precedes its dependent. Reorder with `gh api --method PATCH repos/<owner>/<repo>/issues/<parent>/sub_issues/priority -F sub_issue_id=<child-db-id> -F after_id=<previous-child-db-id>`, then re-fetch instead of trusting local intent.
- **Context and review**: run the exact Ticket Context check for every child and one fresh, binding-bound whole-Release `ticket-readiness-reviewer` review. Any failed candidate, graph, coverage, handoff, risk/scope, Oracle, or order check leaves every Issue in `needs-triage`.
- **Recommended Controller handoff**: compile only the reviewed current Release through `/prepare-codex-release`. The operator approves the exact semantic `release-plan.json` fingerprint. Planner materializes the private handoff but does not add ready labels or start the Controller.
- **Drift**: any accepted Parent, source, base, child body, graph, decision, Oracle, order, or dependency drift invalidates the review and requires a rebuilt graph and fresh approval.

### Explicit Legacy Herdr exception

Only an explicit operator choice may route the same accepted artifacts through `/admit-ticket`. That path has its own capability, readiness, exact mutation Plan, and human-confirmation requirements. Only that Legacy path may remove triage labels, add `ready-for-agent` or `ready-for-human`, and activate the Parent last.
