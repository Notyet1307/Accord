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

## Delivery-map operations

- Create the delivery parent with `needs-triage` and no ready label.
- Create implementation candidates with stable Scenario IDs and `needs-triage`, then attach them as native sub-issues.
- Store exactly one `## Ticket coverage` section with one `<!-- pi-ticket-planning:delivery-graph:v2 -->` marker and its JSON fence.
- Prefer native dependency edges and topologically order children so every blocker precedes its dependent.
- Before Admission, run the delivery-graph and strict-frontier checks configured by the planning package.
- Admission activates READY children by lane, removes triage labels, and adds `ready-for-agent` to the parent last.
- Any source, body, matrix, order, or dependency drift removes or withholds ready labels and requires Admission again.
