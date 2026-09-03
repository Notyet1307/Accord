# Boundary inside Accord

`reference/security-agent-suite` is a self-contained, non-production reference implementation requested by the repository owner. It is deliberately outside Accord R003 product scope.

It does not:

- change Accord Case, Blackboard, Workflow, Approval, Artifact, or Runtime authority;
- become an Accord production runtime;
- modify R003 schemas or implementation;
- claim that an Agent result is a fact, approval, or business outcome;
- import agent-compose implementation packages.

The directory is intended to be moved unchanged into a future standalone public repository named `Notyet1307/security-agent-suite`. Its Go module path already uses that future location.
