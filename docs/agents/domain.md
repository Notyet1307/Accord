# Domain Navigation

Read only the glossary or context index that can change the current terminology or boundary decision.

- `CONTEXT.md` is a glossary and navigation aid. Read it only when its vocabulary can change the current work.
- `CONTEXT-MAP.md` selects the relevant bounded context. When one context is in scope, follow only that context; do not load every mapped context.
- Accepted ADRs own load-bearing technical decisions. Read only ADRs the accepted task source or current behavior depends on.

CONTEXT files do not own product behavior, architecture, data ownership, repository policy, or current implementation facts. They cannot override an accepted Release, Spec, Ticket, ADR, effective root policy, or code and tests at the reviewed base. They must not copy Release behavior, Ticket acceptance criteria, complete architecture decisions, or directory tours.

If these files do not exist, proceed silently. Create `CONTEXT.md` only after real terminology ambiguity exists and `CONTEXT-MAP.md` only after at least two real bounded contexts exist.

## ADR conflicts

When selected terminology or current work conflicts with an applicable accepted ADR, stop, name both sources and their concern, and return the decision to its owner.
