# Repository authority

- Task behavior comes from the accepted Release, Delivery Spec, or Ticket.
- Current implementation facts come from code, configuration, types, and tests at the task base.
- Load-bearing technical decisions come from accepted ADRs.
- Global non-discoverable invariants come from this file.
- Live tracker facts come from GitHub; execution facts come from the configured Harness.
- README, CONTEXT files, examples, fixtures, and Git history are supporting material, not substitutes for their owners.
- Read the smallest authoritative source set needed for the decision. If authorities for the same concern conflict, stop and return the conflict to its owner.

## Delivery routing

- Before creating or changing delivery issues, ready labels, dependencies, or Admission state, read `docs/agents/delivery-gate.md`, `docs/agents/issue-tracker.md`, and `docs/agents/triage-labels.md`.
- When terminology or ADR scope can change the task, read `docs/agents/domain.md` and only the relevant glossary, context map, or accepted ADR.

## vision愿景产品
- For product direction, new capabilities, or cross-boundary architecture work, read `docs/product/VISION.md`. It is directional context, not implementation authority; Accepted Releases, Delivery Specs, Tickets, ADRs, and current implementation facts retain their existing ownership.
