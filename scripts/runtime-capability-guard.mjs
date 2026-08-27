import { registerHooks } from "node:module";

const NETWORK_BUILTIN_ROOTS = new Set([
  "cluster",
  "dgram",
  "dns",
  "http",
  "http2",
  "https",
  "inspector",
  "net",
  "quic",
  "tls",
]);
const CRASH_TEST_URL = new URL("../dist/test/synthetic-intake.conformance.test.js", import.meta.url).href;

function builtinRoot(specifier) {
  const bareSpecifier = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return bareSpecifier.split("/", 1)[0];
}

function accessDenied(permission, resource) {
  const error = new Error(`validation capability denied: ${permission} (${resource})`);
  Object.defineProperties(error, {
    code: { enumerable: true, value: "ERR_ACCESS_DENIED" },
    permission: { enumerable: true, value: permission },
    resource: { enumerable: true, value: resource },
  });
  return error;
}

function assertBuiltinAllowed(specifier, parentURL) {
  const root = builtinRoot(specifier);
  if (NETWORK_BUILTIN_ROOTS.has(root)) {
    throw accessDenied("NetworkModule", specifier);
  }
  if (root === "child_process" && parentURL !== CRASH_TEST_URL) {
    throw accessDenied("ChildProcessModule", specifier);
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    assertBuiltinAllowed(specifier, context.parentURL);
    return nextResolve(specifier, context);
  },
});

const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
Object.defineProperty(process, "getBuiltinModule", {
  configurable: false,
  enumerable: true,
  value(specifier) {
    assertBuiltinAllowed(specifier, undefined);
    return originalGetBuiltinModule(specifier);
  },
  writable: false,
});

function denyNetworkGlobal() {
  throw accessDenied("NetworkGlobal", "global network API");
}

for (const name of ["EventSource", "WebSocket", "fetch"]) {
  if (name in globalThis) {
    Object.defineProperty(globalThis, name, {
      configurable: false,
      enumerable: false,
      value: denyNetworkGlobal,
      writable: false,
    });
  }
}
