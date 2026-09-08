# Triage Labels

Labels describe GitHub task state; they never authorize execution, select a Harness, or activate a queue on the current OMP path. Explicit scoped user authorization follows `delivery-gate.md`.

| Role | Repository label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation pending; compatible with explicitly authorized OMP work |
| `needs-info` | `needs-info` | Required information is missing |
| `ready-for-agent` | `ready-for-agent` | Historical AGENT-lane admission marker; noncurrent for OMP |
| `ready-for-human` | `ready-for-human` | Historical HUMAN-lane admission marker; noncurrent for OMP |
| `wontfix` | `wontfix` | Maintainer chose not to action the issue |

Use these exact strings when an authorized operation requires a label change. Preserve existing labels unless the user authorizes changing them. Ready labels require a separately selected Legacy Herdr route and its own gates; never add them as an OMP completion step. Existing labels do not prove that an old process is stopped or authorize starting, polling, or activating it.
