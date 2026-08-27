#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

fail() {
  printf '%s\n' "CI validation failed: $1" >&2
  exit 1
}

CI_VALIDATION_KIND=non-qualification

[ -z "${ACCORD_VALIDATION_BOUNDARY:-}" ] \
  || fail "non-qualification CI refuses the operator-owned validation boundary"

NODE_BIN=$(command -v node) || fail "the pinned Node.js executable is required"
NPM_BIN=$(command -v npm) || fail "the pinned npm executable is required"
PINNED_NODE=$(cat .node-version)
NODE_VERSION=$("$NODE_BIN" --version) || fail "node --version must succeed"
[ "$NODE_VERSION" = "v$PINNED_NODE" ] \
  || fail "Node.js v$PINNED_NODE exactly is required (found $NODE_VERSION)"

printf '%s\n' "NOTICE $CI_VALIDATION_KIND CI validation; this is not staged-rollout evidence"

"$NPM_BIN" run check:no-external-seams
"$NPM_BIN" run typecheck
"$NPM_BIN" run build
"$NPM_BIN" run test:contract
"$NPM_BIN" run test:integration

CI_TEMP_PARENT=${RUNNER_TEMP:-${TMPDIR:-}}
[ -n "$CI_TEMP_PARENT" ] || fail "RUNNER_TEMP or TMPDIR must identify a temporary parent"
[ -d "$CI_TEMP_PARENT" ] && [ ! -L "$CI_TEMP_PARENT" ] \
  || fail "the temporary parent must be one non-symlink directory"
CI_TEMP_PARENT=$(CDPATH= cd -- "$CI_TEMP_PARENT" && pwd -P) \
  || fail "the temporary parent cannot be resolved"
umask 077
CI_TEST_TMPDIR=$(mktemp -d "$CI_TEMP_PARENT/accord-r003-ci.XXXXXX") \
  || fail "a private CI test directory is required"
CI_DENIED_DIR=

cleanup_ci_state() {
  for directory in "$CI_TEST_TMPDIR" "$CI_DENIED_DIR"; do
    case "$directory" in
      "$CI_TEMP_PARENT"/accord-r003-ci.*|"$CI_TEMP_PARENT"/accord-r003-ci-denied.*)
        [ ! -e "$directory" ] || rm -rf -- "$directory"
        ;;
    esac
  done
}
trap 'status=$?; cleanup_ci_state; exit "$status"' 0
trap 'exit 1' 1 2 15

CI_DENIED_DIR=$(mktemp -d "$CI_TEMP_PARENT/accord-r003-ci-denied.XXXXXX") \
  || fail "a denied-read CI regression directory is required"
CI_DENIED_FILE=$CI_DENIED_DIR/denied-read-canary
printf '%s\n' "synthetic CI capability canary" >"$CI_DENIED_FILE"

env -i \
  PATH="${PATH:-}" \
  TMPDIR="$CI_TEST_TMPDIR" \
  LANG=C.UTF-8 \
  ACCORD_VALIDATION_DENIED_FILE="$CI_DENIED_FILE" \
  "$NODE_BIN" \
  --permission \
  --allow-fs-read="$ROOT" \
  --allow-fs-read="$CI_TEST_TMPDIR" \
  --allow-fs-write="$CI_TEST_TMPDIR" \
  --import="$ROOT/scripts/runtime-capability-guard.mjs" \
  --test-isolation=none \
  --test dist/test/validation-capabilities.integration.test.js

"$NPM_BIN" run test:conformance

printf '%s\n' "PASS $CI_VALIDATION_KIND CI typecheck, contract, integration, capability, and conformance suites"
