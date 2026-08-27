import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

interface PermissionApi {
  readonly has: (scope: string, reference?: string) => boolean;
}

function isPermissionApi(value: unknown): value is PermissionApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "has" in value &&
    typeof Reflect.get(value, "has") === "function"
  );
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ERR_ACCESS_DENIED";
}

test("runtime capabilities block computed network imports, bracketed secret environment access, and denied-file reads", async () => {
  const environment = process["env"];
  const deniedFile = environment["ACCORD_VALIDATION_DENIED_FILE"];
  assert.equal(environment["ACCORD_VALIDATION_SECRET_CANARY"], undefined);
  if (typeof deniedFile !== "string") {
    throw new TypeError("ACCORD_VALIDATION_DENIED_FILE must identify the denied-read regression canary");
  }

  const permission = Reflect.get(process, "permission") as unknown;
  assert.ok(isPermissionApi(permission));
  assert.equal(permission.has("fs.read", deniedFile), false);
  assert.throws(() => readFileSync(deniedFile, "utf8"), isAccessDenied);

  const networkModule = ["node", "net"].join(":");
  await assert.rejects(import(networkModule), isAccessDenied);
  const require = createRequire(import.meta.url);
  assert.throws(() => require(networkModule), isAccessDenied);
  assert.throws(() => process.getBuiltinModule(networkModule.slice("node:".length)), isAccessDenied);
  assert.throws(() => globalThis.fetch("data:text/plain,capability-probe"), isAccessDenied);
});
