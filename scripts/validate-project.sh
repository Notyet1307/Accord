#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

fail() {
  printf '%s\n' "validation failed: $1" >&2
  exit 1
}

PINNED_NODE=24.19.0
PINNED_NPM=11.17.0
PINNED_TYPESCRIPT=6.0.3
PINNED_TYPES_NODE=24.13.3
PINNED_DARWIN_ARM64_NODE_PACKAGE=24.19.0
EXPECTED_VALIDATION_BOUNDARY=operator-seatbelt-v1

[ "${ACCORD_VALIDATION_BOUNDARY:-}" = "$EXPECTED_VALIDATION_BOUNDARY" ] \
  || fail "the operator-owned pre-shell validation boundary is required"
[ -n "${TMPDIR:-}" ] || fail "the trusted launcher must supply a private TMPDIR"
[ -n "${npm_config_cache:-}" ] || fail "the trusted launcher must supply the offline npm cache"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "a Git snapshot is required"
TRACKED_ENTRIES=$(git ls-files -s) || fail "git ls-files -s must succeed"
if printf '%s\n' "$TRACKED_ENTRIES" | grep -Eq '^(120000|160000) '; then
  fail "tracked symlinks and gitlinks are not allowed in the validation snapshot"
fi

for required in \
  .github/workflows/herdr-delivery-gate.yml \
  .node-version \
  .npmrc \
  .nvmrc \
  package.json \
  package-lock.json \
  tsconfig.json \
  tsconfig.build.json \
  contracts/r003-core-handoff.json \
  contracts/r003-magicchat-handoff.json \
  contracts/r003-researcher-analyst-handoff.json \
  migrations/001_r003_authority_core.sql \
  migrations/002_r003_magicchat_ingress.sql \
  migrations/003_r003_researcher_analyst.sql \
  migrations/004_r003_researcher_analyst_authority_repair.sql \
  migrations/005_r003_researcher_analyst_durable_recovery.sql \
  migrations/006_r003_researcher_analyst_legacy_arrival_reconciliation.sql \
  migrations/007_r003_terminal_delivery_recovery.sql \
  migrations/008_r003_opaque_completion_receipts.sql
do
  [ -f "$required" ] && [ ! -L "$required" ] || fail "$required must be one regular, non-symlink file"
done

[ "$(cat .node-version)" = "$PINNED_NODE" ] || fail ".node-version must pin Node.js $PINNED_NODE exactly"
[ "$(cat .nvmrc)" = "$PINNED_NODE" ] || fail ".nvmrc must pin Node.js $PINNED_NODE exactly"
[ ! -e pnpm-lock.yaml ] && [ ! -e yarn.lock ] && [ ! -e bun.lock ] && [ ! -e bun.lockb ] \
  || fail "package-lock.json must be the only package-manager lockfile"

BOOTSTRAP_NODE=$(command -v node) || fail "a Node.js executable is required to bootstrap the locked toolchain"
NPM_BIN=$(command -v npm) || fail "the pinned npm executable is required"
NPM_VERSION=$("$NPM_BIN" --version) || fail "npm --version must succeed"
[ "$NPM_VERSION" = "$PINNED_NPM" ] || fail "npm $PINNED_NPM exactly is required (found $NPM_VERSION)"

"$BOOTSTRAP_NODE" \
  --permission \
  --allow-fs-read="$ROOT/package.json" \
  --allow-fs-read="$ROOT/package-lock.json" \
  -e '
const fs = require("node:fs");
const [nodeVersion, npmVersion, typescriptVersion, typesNodeVersion, darwinArm64NodeVersion] = process.argv.slice(1);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lockfile = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const root = lockfile.packages?.[""];
const darwinArm64Node = lockfile.packages?.["node_modules/node-bin-darwin-arm64"];
if (
  packageJson.type !== "module" ||
  lockfile.lockfileVersion !== 3 ||
  lockfile.requires !== true ||
  packageJson.engines?.node !== nodeVersion ||
  packageJson.engines?.npm !== npmVersion ||
  packageJson.packageManager !== `npm@${npmVersion}` ||
  packageJson.devDependencies?.typescript !== typescriptVersion ||
  packageJson.devDependencies?.["@types/node"] !== typesNodeVersion ||
  packageJson.optionalDependencies?.["node-bin-darwin-arm64"] !== darwinArm64NodeVersion ||
  root?.engines?.node !== nodeVersion ||
  root?.engines?.npm !== npmVersion ||
  root?.optionalDependencies?.["node-bin-darwin-arm64"] !== darwinArm64NodeVersion ||
  lockfile.packages?.["node_modules/typescript"]?.version !== typescriptVersion ||
  lockfile.packages?.["node_modules/@types/node"]?.version !== typesNodeVersion ||
  darwinArm64Node?.version !== darwinArm64NodeVersion ||
  darwinArm64Node?.optional !== true ||
  !Array.isArray(darwinArm64Node?.os) ||
  darwinArm64Node.os.length !== 1 ||
  darwinArm64Node.os[0] !== "darwin" ||
  !Array.isArray(darwinArm64Node?.cpu) ||
  darwinArm64Node.cpu.length !== 1 ||
  darwinArm64Node.cpu[0] !== "arm64"
) {
  process.exit(1);
}
' \
  "$PINNED_NODE" \
  "$PINNED_NPM" \
  "$PINNED_TYPESCRIPT" \
  "$PINNED_TYPES_NODE" \
  "$PINNED_DARWIN_ARM64_NODE_PACKAGE" \
  || fail "package and lockfile toolchain pins are inconsistent"

VALIDATION_PATH=${PATH:-}
[ -n "$VALIDATION_PATH" ] || fail "PATH is required"
[ -d "$npm_config_cache" ] && [ ! -L "$npm_config_cache" ] \
  || fail "the supplied offline npm cache must be one non-symlink directory"
VALIDATION_NPM_CACHE=$(CDPATH= cd -- "$npm_config_cache" && pwd -P) \
  || fail "the supplied offline npm cache cannot be resolved"

[ -d "$TMPDIR" ] && [ ! -L "$TMPDIR" ] \
  || fail "the supplied validation TMPDIR must be one non-symlink directory"
VALIDATION_TEMP_PARENT=$TMPDIR
VALIDATION_TEMP_PARENT=$(CDPATH= cd -- "$VALIDATION_TEMP_PARENT" && pwd -P) \
  || fail "the validation temporary parent must be an existing directory"
case "$VALIDATION_TEMP_PARENT" in
  /tmp|/private/tmp|/var/tmp)
    fail "the validation TMPDIR must be private, not a shared temporary root"
    ;;
esac
umask 077
VALIDATION_TMPDIR=$(mktemp -d "$VALIDATION_TEMP_PARENT/accord-r003-validation.XXXXXX") \
  || fail "a private validation temporary directory is required"
VALIDATION_DENIED_DIR=
VALIDATION_NPM_LOGS=$VALIDATION_TMPDIR/npm-logs
mkdir -p "$VALIDATION_NPM_LOGS"

cleanup_validation_state() {
  for directory in "$VALIDATION_TMPDIR" "$VALIDATION_DENIED_DIR"; do
    [ -n "$directory" ] || continue
    case "$directory" in
      "$VALIDATION_TEMP_PARENT"/accord-r003-validation.*|"$VALIDATION_TEMP_PARENT"/accord-r003-denied.*)
        [ ! -e "$directory" ] || rm -rf -- "$directory"
        ;;
    esac
  done
}
trap 'status=$?; cleanup_validation_state; exit "$status"' 0
trap 'exit 1' 1 2 15

VALIDATION_DENIED_DIR=$(mktemp -d "$VALIDATION_TEMP_PARENT/accord-r003-denied.XXXXXX") \
  || fail "a denied-read regression directory is required"
CAPABILITY_DENIED_FILE=$VALIDATION_DENIED_DIR/denied-read-canary
printf '%s\n' "synthetic validation canary" >"$CAPABILITY_DENIED_FILE"
VALIDATION_SYMLINK_TARGET=$VALIDATION_TMPDIR/synthetic-symlink-target
VALIDATION_SYMLINK_PATH=$VALIDATION_TMPDIR/synthetic-authority-symlink
VALIDATION_DANGLING_SYMLINK_TARGET=$VALIDATION_TMPDIR/synthetic-missing-symlink-target
VALIDATION_DANGLING_SYMLINK_PATH=$VALIDATION_TMPDIR/synthetic-authority-dangling-symlink
printf '%s\n' "synthetic symlink target" >"$VALIDATION_SYMLINK_TARGET"
ln -s "$VALIDATION_SYMLINK_TARGET" "$VALIDATION_SYMLINK_PATH"
ln -s "$VALIDATION_DANGLING_SYMLINK_TARGET" "$VALIDATION_DANGLING_SYMLINK_PATH"

# The ambient Node process may only validate package metadata and bootstrap
# npm's cache-only materialization. Lifecycle scripts are disabled, and all
# repository Node entrypoints below use the selected pinned runtime.
env -i \
  PATH="$VALIDATION_PATH" \
  TMPDIR="$VALIDATION_TMPDIR" \
  npm_config_cache="$VALIDATION_NPM_CACHE" \
  npm_config_engine_strict=false \
  npm_config_loglevel=error \
  npm_config_logs_dir="$VALIDATION_NPM_LOGS" \
  npm_config_update_notifier=false \
  npm_config_userconfig=/dev/null \
  npm_config_offline=true \
  "$NPM_BIN" ci --offline --ignore-scripts --include=optional --no-audit --no-fund \
  || fail "the exact lockfile must install from the configured no-network cache"

NODE_BIN=$BOOTSTRAP_NODE
case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    NODE_BIN=$ROOT/node_modules/node-bin-darwin-arm64/bin/node
    [ -f "$NODE_BIN" ] && [ ! -L "$NODE_BIN" ] && [ -x "$NODE_BIN" ] \
      || fail "the locked Darwin arm64 Node.js executable is missing or unsafe"
    ;;
esac
NODE_VERSION=$("$NODE_BIN" --version) || fail "the selected Node.js executable must start"
[ "$NODE_VERSION" = "v$PINNED_NODE" ] \
  || fail "Node.js v$PINNED_NODE exactly is required (selected $NODE_VERSION)"

[ "$("$NODE_BIN" -p "require('./node_modules/typescript/package.json').version")" = "$PINNED_TYPESCRIPT" ] \
  || fail "installed TypeScript version is not pinned"
[ "$("$NODE_BIN" -p "require('./node_modules/@types/node/package.json').version")" = "$PINNED_TYPES_NODE" ] \
  || fail "installed Node type version is not pinned"

for source_directory in contracts migrations scripts src test; do
  [ -d "$source_directory" ] && [ ! -L "$source_directory" ] \
    || fail "$source_directory must be one regular, non-symlink directory"
done
for dependency_directory in node_modules/typescript node_modules/@types/node node_modules/undici-types; do
  [ -d "$dependency_directory" ] && [ ! -L "$dependency_directory" ] \
    || fail "$dependency_directory must be one installed, non-symlink directory"
done
for validation_entrypoint in \
  scripts/check-no-external-seams.mjs \
  scripts/clean.mjs \
  scripts/runtime-capability-guard.mjs \
  scripts/validate-ci.sh \
  scripts/validate-delivery.sh \
  scripts/validate-project.sh
do
  [ -f "$validation_entrypoint" ] && [ ! -L "$validation_entrypoint" ] \
    || fail "$validation_entrypoint must be one regular, non-symlink file"
done

VALIDATION_SNAPSHOT=$VALIDATION_TMPDIR/snapshot
mkdir -p "$VALIDATION_SNAPSHOT/.github/workflows" "$VALIDATION_SNAPSHOT/node_modules/@types"
cp .node-version .npmrc .nvmrc package-lock.json package.json tsconfig.build.json tsconfig.json "$VALIDATION_SNAPSHOT/"
cp .github/workflows/herdr-delivery-gate.yml "$VALIDATION_SNAPSHOT/.github/workflows/"
cp -R contracts migrations scripts src test "$VALIDATION_SNAPSHOT/"
cp -R node_modules/typescript node_modules/undici-types "$VALIDATION_SNAPSHOT/node_modules/"
cp -R node_modules/@types/node "$VALIDATION_SNAPSHOT/node_modules/@types/"
cd "$VALIDATION_SNAPSHOT"

run_node_restricted() {
  env -i \
    PATH="$VALIDATION_PATH" \
    TMPDIR="$VALIDATION_TMPDIR" \
    LANG=C.UTF-8 \
    ACCORD_VALIDATION_DENIED_FILE="$CAPABILITY_DENIED_FILE" \
    "$NODE_BIN" \
    --permission \
    --allow-fs-read="$VALIDATION_TMPDIR" \
    --allow-fs-write="$VALIDATION_TMPDIR" \
    --import="$VALIDATION_SNAPSHOT/scripts/runtime-capability-guard.mjs" \
    "$@"
}

ACCORD_VALIDATION_SECRET_CANARY=must-not-cross-the-validation-boundary
export ACCORD_VALIDATION_SECRET_CANARY

run_node_restricted scripts/check-no-external-seams.mjs
run_node_restricted node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit
run_node_restricted scripts/clean.mjs
run_node_restricted node_modules/typescript/lib/tsc.js -p tsconfig.build.json
run_node_restricted --test-isolation=none --test dist/test/contracts.test.js
run_node_restricted --test-isolation=none --test dist/test/sqlite-startup.integration.test.js
run_node_restricted --test-isolation=none --test dist/test/researcher-analyst.integration.test.js
run_node_restricted --test-isolation=none --test dist/test/validation-capabilities.integration.test.js
run_node_restricted --allow-child-process --test-isolation=none --test dist/test/synthetic-intake.conformance.test.js
run_node_restricted --test-isolation=none --test dist/test/magicchat-protocol.conformance.test.js

EXPECTED_HANDOFF=$(run_node_restricted -e \
  'const fs=require("node:fs");process.stdout.write(`HANDOFF ${JSON.stringify(JSON.parse(fs.readFileSync("contracts/r003-researcher-analyst-handoff.json","utf8")))}`)')
ACTUAL_HANDOFF=$(run_node_restricted dist/src/handoff.js)
[ "$ACTUAL_HANDOFF" = "$EXPECTED_HANDOFF" ] || fail "executable R003 Researcher/Analyst contract/migration handoff changed"

unset ACCORD_VALIDATION_SECRET_CANARY
printf '%s\n' "$ACTUAL_HANDOFF"
printf '%s\n' "PASS pinned no-network TypeScript, migration, transaction, deterministic SQLite, and runtime capability suite"
