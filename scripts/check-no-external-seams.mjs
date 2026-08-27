import { readdirSync, readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const scanRoots = ["scripts", "src", "test"];
const sourceExtensions = new Set([".mjs", ".sh", ".ts"]);
const policySource = "scripts/check-no-external-seams.mjs";
const capabilityRegression = "test/validation-capabilities.integration.test.ts";
const localCrashHarness = "test/synthetic-intake.conformance.test.ts";
const deliveryWorkflow = ".github/workflows/herdr-delivery-gate.yml";
const requiredValidationEntrypoints = [
  "scripts/check-no-external-seams.mjs",
  "scripts/clean.mjs",
  "scripts/runtime-capability-guard.mjs",
  "scripts/validate-ci.sh",
  "scripts/validate-delivery.sh",
  "scripts/validate-project.sh",
  "src/handoff.ts",
  "test/contracts.test.ts",
  "test/helpers/intake-crash-child.ts",
  "test/sqlite-startup.integration.test.ts",
  "test/synthetic-intake.conformance.test.ts",
  "test/validation-capabilities.integration.test.ts",
];
const requiredEntrypointSet = new Set(requiredValidationEntrypoints);
const requiredInvocationMarkers = new Map([
  [
    "scripts/validate-ci.sh",
    [
      "CI_VALIDATION_KIND=non-qualification",
      '[ -z "${ACCORD_VALIDATION_BOUNDARY:-}" ]',
      '"$NPM_BIN" run check:no-external-seams',
      '"$NPM_BIN" run typecheck',
      '"$NPM_BIN" run build',
      '"$NPM_BIN" run test:contract',
      '"$NPM_BIN" run test:integration',
      "dist/test/validation-capabilities.integration.test.js",
      '"$NPM_BIN" run test:conformance',
    ],
  ],
  [
    "scripts/validate-delivery.sh",
    ["PROJECT_VALIDATOR=scripts/validate-project.sh", 'exec "./$PROJECT_VALIDATOR"'],
  ],
  [
    "scripts/validate-project.sh",
    [
      "EXPECTED_VALIDATION_BOUNDARY=operator-seatbelt-v1",
      '[ "${ACCORD_VALIDATION_BOUNDARY:-}" = "$EXPECTED_VALIDATION_BOUNDARY" ]',
      '[ -n "${TMPDIR:-}" ]',
      '[ -n "${npm_config_cache:-}" ]',
      "VALIDATION_TEMP_PARENT=$TMPDIR",
      'npm_config_logs_dir="$VALIDATION_NPM_LOGS"',
      "npm_config_update_notifier=false",
      '--import="$VALIDATION_SNAPSHOT/scripts/runtime-capability-guard.mjs"',
      "run_node_restricted scripts/check-no-external-seams.mjs",
      "run_node_restricted node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit",
      "run_node_restricted scripts/clean.mjs",
      "run_node_restricted node_modules/typescript/lib/tsc.js -p tsconfig.build.json",
      "run_node_restricted --test-isolation=none --test dist/test/contracts.test.js",
      "run_node_restricted --test-isolation=none --test dist/test/sqlite-startup.integration.test.js",
      "run_node_restricted --test-isolation=none --test dist/test/validation-capabilities.integration.test.js",
      "run_node_restricted --allow-child-process --test-isolation=none --test dist/test/synthetic-intake.conformance.test.js",
      "ACTUAL_HANDOFF=$(run_node_restricted dist/src/handoff.js)",
    ],
  ],
  ["test/synthetic-intake.conformance.test.ts", ['new URL("helpers/intake-crash-child.js", import.meta.url)']],
]);
const forbiddenCiInvocationMarkers = new Map([
  ["scripts/validate-ci.sh", ["operator-seatbelt-v1", "scripts/validate-delivery.sh", "scripts/validate-project.sh"]],
  [
    deliveryWorkflow,
    ["ACCORD_VALIDATION_BOUNDARY", "operator-seatbelt-v1", "scripts/validate-delivery.sh", "scripts/validate-project.sh"],
  ],
]);
const requiredWorkflowMarkers = [
  "validation-script=scripts/validate-ci.sh",
  "# This workflow is non-qualification CI and cannot produce staged-rollout evidence.",
  "run: ./scripts/validate-ci.sh",
];

const javascriptForbidden = [
  [
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'](?:node:)?(?:cluster|dgram|dns|http|http2|https|inspector|net|quic|tls)(?:\/[^"']*)?["']/u,
    "direct network module import",
  ],
  [/\b(?:fetch|WebSocket|EventSource)\s*\(/u, "direct network API call"],
  [/\bprocess\s*(?:\.\s*env|\[\s*["']env["']\s*\])/u, "ambient environment access"],
  [
    /\b(?:open|openSync|readFile|readFileSync)\s*\([^)]*(?:\.env|\.ssh|credentials|secret)/iu,
    "secret-like file read",
  ],
];
const childProcessImport =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'](?:node:)?child_process["']/u;
const shellNetworkCommand = /(?:^|\n)\s*(?:exec\s+)?(?:curl|nc|ncat|scp|sftp|ssh|telnet|wget)\b/mu;
const shellSecretRead =
  /(?:^|\n)\s*(?:cat|grep|head|sed|tail)\s+[^\n]*(?:\.env|\.ssh|credentials|secret)/imu;
const shellHeredoc = /<<-?\s*["']?[A-Za-z_][A-Za-z0-9_]*["']?/u;
const shellSharedTempFallback = /\$\{TMPDIR:-\/(?:private\/)?tmp\}/u;
const shellHomeCacheFallback = /(?:\$HOME|\$\{HOME\})\/\.npm/u;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name, directory);
    if (entry.isSymbolicLink()) {
      throw new Error(`validation source must not be a symlink: ${fileURLToPath(child)}`);
    }
    if (entry.isDirectory()) {
      return sourceFiles(new URL(`${entry.name}/`, directory));
    }
    return entry.isFile() && sourceExtensions.has(extname(entry.name)) ? [child] : [];
  });
}

const files = scanRoots
  .flatMap((root) => sourceFiles(new URL(`../${root}/`, import.meta.url)))
  .map((url) => ({ path: relative(repositoryRoot, fileURLToPath(url)), url }))
  .sort((left, right) => left.path.localeCompare(right.path));
const filePaths = new Set(files.map(({ path }) => path));
const failures = [];

for (const required of requiredValidationEntrypoints) {
  if (!filePaths.has(required)) {
    failures.push(`${required}: required validation entrypoint is not covered by the source inventory`);
  }
}
for (const { path } of files) {
  if (path.endsWith(".test.ts") && !requiredEntrypointSet.has(path)) {
    failures.push(`${path}: test entrypoint is not wired into the canonical validator inventory`);
  }
}
for (const extension of sourceExtensions) {
  if (!files.some(({ path }) => extname(path) === extension)) {
    failures.push(`source inventory has no ${extension} entrypoint`);
  }
}

for (const [path, markers] of requiredInvocationMarkers) {
  const entrypoint = files.find((file) => file.path === path);
  if (entrypoint === undefined) {
    continue;
  }
  const source = readFileSync(entrypoint.url, "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) {
      failures.push(`${path}: canonical invocation is missing ${JSON.stringify(marker)}`);
    }
  }
}

const workflowSource = readFileSync(new URL(`../${deliveryWorkflow}`, import.meta.url), "utf8");
for (const marker of requiredWorkflowMarkers) {
  if (!workflowSource.includes(marker)) {
    failures.push(`${deliveryWorkflow}: CI workflow is missing ${JSON.stringify(marker)}`);
  }
}

for (const [path, markers] of forbiddenCiInvocationMarkers) {
  const entrypoint = files.find((file) => file.path === path);
  if (path !== deliveryWorkflow && entrypoint === undefined) {
    continue;
  }
  const source = path === deliveryWorkflow ? workflowSource : readFileSync(entrypoint.url, "utf8");
  for (const marker of markers) {
    if (source.includes(marker)) {
      failures.push(`${path}: non-qualification CI must not contain ${JSON.stringify(marker)}`);
    }
  }
}

for (const file of files) {
  const source = readFileSync(file.url, "utf8");
  if (file.path.endsWith(".sh")) {
    if (shellNetworkCommand.test(source)) {
      failures.push(`${file.path}: external network command`);
    }
    if (shellSecretRead.test(source)) {
      failures.push(`${file.path}: secret-like file read`);
    }
    if (shellHeredoc.test(source)) {
      failures.push(`${file.path}: shell heredoc is not allowed in repository validation`);
    }
    if (shellSharedTempFallback.test(source)) {
      failures.push(`${file.path}: shared temporary fallback is not allowed`);
    }
    if (shellHomeCacheFallback.test(source)) {
      failures.push(`${file.path}: ambient home npm cache fallback is not allowed`);
    }
    continue;
  }

  if (file.path !== policySource) {
    for (const [pattern, description] of javascriptForbidden) {
      if (pattern.test(source) && file.path !== capabilityRegression) {
        failures.push(`${file.path}: ${description}`);
      }
    }
  }
  if (childProcessImport.test(source) && file.path !== localCrashHarness && file.path !== policySource) {
    failures.push(`${file.path}: child process execution is restricted to the killed-process crash harness`);
  }
}

if (failures.length > 0) {
  throw new Error(`external seam inventory failed:\n${failures.join("\n")}`);
}

console.log(
  `PASS static external-seam inventory covers ${files.length} TypeScript, MJS, and shell sources; runtime capability regressions remain mandatory`,
);
