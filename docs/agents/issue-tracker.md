# Issue tracker: GitHub

GitHub is the sole remote owner of Issue, label, relationship, PR, commit, check, and merge facts. Use the `gh` CLI and infer the repository from `origin`. Repository Specs own behavior; Issues link to them.

## Current task entry

Follow `delivery-gate.md`: one authorized goal, one versioned repository Spec, one Issue, and one SHA-bound PR evidence record. Read the Issue including comments and labels before changing it; re-fetch after remote mutations rather than trusting local intent.

- For current work, start at [docs/work/current.md](../work/current.md) and re-fetch its GitHub pointers. This file is navigation, not a local task-state authority.
- Historical C4 used #44 / PR #66 and `docs/specs/r003-c4-recovery-trace-verification.md`; read the current state and closing comments even when the old body still says preparation. Do not reuse that task or revive its old graph for a later Release. Preserve C3 #62 / PR #64 and the existing versioned Specs as historical evidence.
- A prerequisite PR must not close the feature Issue or imply implementation authorization.
- Keep task status on GitHub. A label, old admission statement, accepted Spec, or existing queue entry does not authorize execution.
- PRs deliver authorized changes and own the current evidence index; they are not feature-request intake. Preserve earlier evidence when refreshing the record for a new SHA/Spec revision.

## Preserve provenance before replacing a body

Before converting a historical task body into a Spec pointer, preserve the exact original title/body in a durable GitHub comment or immutable linked Git revision, including the source Issue and capture revision/time. Verify the preserved copy before replacing the body. Clearly mark it historical and noncurrent; it is not a fresh execution request.

Accepted historical Spec Parents and their bound acceptance receipts remain immutable; leave those title/body records intact and use a comment to point to the current Spec. Keep historical comments, receipts, graph/oracle bindings, and results intact rather than editing them into evidence for the new path.

## Operations

- Read with `gh issue view <number> --comments`, including labels.
- Create only when the authorized goal has no task entry: `gh issue create`.
- Update a pointer or label with `gh issue edit`; record evidence or preserved provenance with `gh issue comment`.
- Close with `gh issue close <number> --comment "..."` only when the goal's acceptance criteria and authorized delivery are complete, not when prerequisite preparation finishes.
- Read PR checks and merge state from GitHub; local success is not a remote check or merge fact.

## Noncurrent planning routes

Wayfinder maps, Delivery Spec Parents/children, executable Release graphs, Ticket Context/readiness reviews, `/prepare-codex-release`, and `/admit-ticket` belong to separately selected historical planning/execution routes. None is required for the current OMP path. Do not create or activate them, change native dependency order, or apply ready labels without a separate explicit user selection and authorization for those operations. Existing records remain provenance; their presence does not select the route.
