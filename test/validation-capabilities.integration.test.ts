import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { connectMagicChatTransport } from "../src/transports/magicchat-websocket.js";

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

test("C5 dependency inventory denies direct, transitive, package and computed transport bypasses", async () => {
  const moduleUrl = new URL("../../scripts/check-no-external-seams.mjs", import.meta.url).href;
  const { inspectTransportDependencies } = await import(moduleUrl) as { inspectTransportDependencies: (sources: readonly { path: string; source: string }[]) => string[] };
  for (const sources of [
    [{ path: "src/core.ts", source: 'export * from "./transports/baizhi-responses.js";' }],
    [{ path: "src/core.ts", source: 'import "../test/bridge.js";' }, { path: "test/bridge.ts", source: 'import "../src/transports/magicchat-websocket.js";' }],
    [{ path: "src/core.ts", source: 'import("./transports/" + name);' }],
    [{ path: "src/core.ts", source: 'import "ws";' }],
    [{ path: "test/bypass.test.ts", source: 'import "ws";' }],
  ]) assert.ok(inspectTransportDependencies(sources).length > 0);
  assert.deepEqual(inspectTransportDependencies([{ path: "src/transports/magicchat-websocket.ts", source: 'import("ws");' }, { path: "src/core.ts", source: 'import "node:crypto";' }]), []);
});

test("C5 explicit live WebSocket construction is denied inside offline validation", async () => {
  await assert.rejects(connectMagicChatTransport({ url: "wss://synthetic.invalid/api/app/ws", appId: "00000000-0000-4000-8000-000000000001", credential: "synthetic-offline-secret" }, () => undefined), /MAGICCHAT_CONNECT_FAILED/);
});
