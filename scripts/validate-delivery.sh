#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

fail() {
  printf '%s\n' "validation failed: $1" >&2
  exit 1
}

for required in \
  AGENTS.md \
  README.md \
  docs/agents/delivery-gate.md \
  docs/agents/domain.md \
  docs/agents/issue-tracker.md \
  docs/agents/triage-labels.md \
  docs/product/releases/r003-governed-case-blackboard-walking-skeleton.md \
  docs/adr/0002-production-coordination-runtime-language.md \
  docs/adr/0003-r003-governed-case-blackboard-boundary.md
do
  [ -f "$required" ] && [ ! -L "$required" ] || fail "$required must be one tracked regular file"
done

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "a Git snapshot is required"

PROJECT_VALIDATOR=scripts/validate-project.sh
if [ -e "$PROJECT_VALIDATOR" ]; then
  [ -f "$PROJECT_VALIDATOR" ] && [ ! -L "$PROJECT_VALIDATOR" ] || fail "$PROJECT_VALIDATOR must be a regular file"
  [ -x "$PROJECT_VALIDATOR" ] || fail "$PROJECT_VALIDATOR must be executable"
  exec "./$PROJECT_VALIDATOR"
fi

UNOWNED=$(git ls-files | grep -Ev '^(\.gitignore|AGENTS\.md|README\.md|docs/.*|scripts/validate-delivery\.sh|\.github/workflows/herdr-delivery-gate\.yml)$' || true)

if [ -n "$UNOWNED" ]; then
  printf '%s\n' "validation failed: implementation files require an executable $PROJECT_VALIDATOR" >&2
  printf '%s\n' "$UNOWNED" >&2
  exit 1
fi

printf '%s\n' "PASS documentation-only delivery baseline"
