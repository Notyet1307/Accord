import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFINITIONS = Object.freeze({
  O01: Object.freeze({
    artifact: "fixtures/oracles/r003-c1/o01-schema9.json",
    testFile: "dist/test/oracles/r003-c1-o01-schema9.test.js",
  }),
  O02: Object.freeze({
    artifact: "fixtures/oracles/r003-c1/o02-four-profile-arbitration.json",
    testFile: "dist/test/oracles/r003-c1-o02-four-profile-arbitration.test.js",
  }),
  O03: Object.freeze({
    artifact: "fixtures/oracles/r003-c1/o03-profile-context-authority.json",
    testFile: "dist/test/oracles/r003-c1-o03-profile-context-authority.test.js",
  }),
  O04: Object.freeze({
    artifact: "fixtures/oracles/r003-c1/o04-reviewer-disposition.json",
    testFile: "dist/test/oracles/r003-c1-o04-reviewer-disposition.test.js",
  }),
});

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\n") === [...expected].sort().join("\n");
}

const oracleId = process.argv[2];
const definition = DEFINITIONS[oracleId];
if (!definition || process.argv.length !== 3) fail("Usage: node scripts/verify-r003-c1-oracle.mjs O01|O02|O03|O04");

const artifactPath = path.join(ROOT, definition.artifact);
let oracle;
try {
  oracle = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
} catch {
  fail(`Unable to read frozen Oracle ${oracleId}.`);
}

if (!exactKeys(oracle, ["schema", "oracleId", "owner", "source", "purpose", "testFile", "cases", "workerRule"])
  || oracle.schema !== "accord:r003-c1-oracle:v1"
  || oracle.oracleId !== oracleId
  || oracle.owner !== "accord-r003-independent-verification"
  || oracle.testFile !== definition.testFile
  || !exactKeys(oracle.source, ["specParent", "scenarioIds", "specBodyHash"])
  || oracle.source.specParent !== 48
  || JSON.stringify(oracle.source.scenarioIds) !== JSON.stringify(["S5"])
  || oracle.source.specBodyHash !== "sha256:739cefcc4fc567f1515d29ad1e2ab21026daa2ff118dba84c6c109a544b58cf3"
  || typeof oracle.purpose !== "string" || oracle.purpose.length === 0
  || !Array.isArray(oracle.cases) || oracle.cases.length < 4 || oracle.cases.length > 8
  || oracle.cases.some((item) => !exactKeys(item, ["id", "input", "expect"])
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
    || typeof item.input !== "string" || item.input.length === 0
    || typeof item.expect !== "string" || item.expect.length === 0)
  || new Set(oracle.cases.map(({ id }) => id)).size !== oracle.cases.length
  || oracle.workerRule !== "The implementation Worker may read this Oracle but must not modify it. Any mismatch is REPLAN_REQUIRED.") {
  fail(`Frozen Oracle ${oracleId} has invalid contract bytes.`);
}

const testPath = path.join(ROOT, definition.testFile);
let testMetadata;
try {
  testMetadata = fs.lstatSync(testPath);
} catch {
  fail(`Oracle verifier target is not implemented: ${definition.testFile}`);
}
if (!testMetadata.isFile() || testMetadata.isSymbolicLink()) {
  fail(`Oracle verifier target is not one regular file: ${definition.testFile}`);
}

process.stdout.write(`PASS frozen Oracle ${oracleId} contract; behavioral target ${definition.testFile} is present.\n`);
