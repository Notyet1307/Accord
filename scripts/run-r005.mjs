import { openSync, fstatSync, readSync, closeSync, lstatSync, realpathSync, constants } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { R005CqaConsumer, cqaBindingDigest, validateCqaBinding, validateCqaChatConfiguration } from "../dist/src/driver/r005-cqa.js";
import { CqaRunServiceAdapter } from "../dist/src/transports/cqa-run-service.js";
import { connectMagicChatTransport } from "../dist/src/transports/magicchat-websocket.js";

function reject() { throw new Error("R005_DRIVER_INPUT_REJECTED"); }
function exact(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) reject();
}
function present(path) {
  try { return lstatSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; return undefined; }
}
function canonicalPath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) reject();
}
function directory(path, privateDirectory = true) {
  canonicalPath(path);
  if (realpathSync(path) !== path) reject();
  for (let current = path; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
    if (current === path && privateDirectory) {
      if (stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) reject();
    } else {
      const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if (![0, process.getuid()].includes(stat.uid) || (stat.mode & 0o6000) !== 0 || ((stat.mode & 0o022) !== 0 && !stickyRoot)) reject();
    }
    if (current === dirname(current)) break;
  }
}
function privateFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600) reject();
}
function readJson(path, maximum) {
  canonicalPath(path); directory(dirname(path));
  const before = lstatSync(path); privateFile(before);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd); privateFile(stat);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size > maximum) reject();
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const length = readSync(fd, buffer, size, buffer.length - size, null);
      if (length === 0) break;
      size += length;
    }
    const after = fstatSync(fd);
    if (size > maximum || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) reject();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
  } finally { closeSync(fd); }
}
function noReflection(value, tokens) {
  const encoded = JSON.stringify(value);
  if (tokens.some(token => encoded.includes(JSON.stringify(token).slice(1, -1)))) throw new Error("R005_DRIVER_CREDENTIAL_REFLECTION");
}
function validateConfiguration(configuration) {
  exact(configuration, ["schemaVersion", "binding", "chat"]);
  if (configuration.schemaVersion !== "accord.r005-live/v1") reject();
  const { binding, chat } = configuration;
  validateCqaBinding(binding); validateCqaChatConfiguration(binding, chat);
  if (binding.mode !== "managed" || chat.expiresAt <= Date.now()) reject();
  const endpoint = new URL(chat.magicChat.endpoint);
  if (endpoint.href !== chat.magicChat.endpoint || endpoint.protocol !== "wss:" || endpoint.pathname !== "/api/app/ws" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) reject();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(binding.appId)) reject();
}
function validateLayout(database, config, credentials, binding) {
  const files = [config, credentials, database, `${database}-wal`, `${database}-shm`, `${database}-journal`];
  if (new Set(files).size !== files.length) reject();
  const roots = [binding.inputRoot, binding.managed.evidenceRoot];
  const inside = (path, root) => path === root || path.startsWith(root + sep);
  if (inside(roots[0], roots[1]) || inside(roots[1], roots[0])) reject();
  for (const path of files) {
    canonicalPath(path); directory(dirname(path));
    if (roots.some(root => inside(path, root))) reject();
    const stat = present(path); if (stat) privateFile(stat);
  }
  for (const root of roots) {
    canonicalPath(root);
    if (files.some(path => inside(root, path))) reject();
    if (present(root)) directory(root); else directory(dirname(root));
  }
  // Evidence is an operator input, never a directory created by this launcher.
  directory(binding.managed.evidenceRoot);
  if (!present(database) && files.slice(3).some(path => present(path))) reject();
}

/** The production scheduler; controlled ports also exercise the exact same loop offline. Owns transport, not the consumer. */
export async function runR005LiveDriver({ consumer, port, configuration, connect, signal, report = () => undefined }) {
  validateConfiguration(configuration);
  if (port.mode !== "managed" || port.bindingDigest !== cqaBindingDigest(configuration.binding)) reject();
  const controller = new AbortController();
  let stopped;
  let transport;
  let timer;
  let deadlineTimer;
  let dirty = true;
  let resume;
  const wake = () => { dirty = true; resume?.(); };
  const stop = reason => {
    if (stopped !== undefined) return;
    stopped = reason; controller.abort(); wake();
  };
  const externalStop = () => stop("R005_STOPPED");
  const deadline = () => {
    const remaining = configuration.chat.expiresAt - Date.now();
    if (remaining <= 0) stop("R005_AUTHORIZATION_EXPIRED");
    else deadlineTimer = setTimeout(deadline, Math.min(remaining, 2_147_483_647));
  };
  const active = () => {
    if (Date.now() >= configuration.chat.expiresAt) stop("R005_AUTHORIZATION_EXPIRED");
    return stopped === undefined;
  };
  signal?.addEventListener("abort", externalStop, { once: true });
  try {
    if (signal?.aborted) externalStop();
    if (!active()) return { state: "STOPPED", reason: stopped };
    consumer.configureChat(configuration.chat);
    deadline();
    transport = await connect(wire => {
      if (!active()) return;
      // Never await flush here: transport.send resolves only after this receiver returns.
      consumer.receive(wire); wake();
    }, controller.signal);
    void transport.closed.then(() => stop("R005_SOCKET_CLOSED"), () => stop("R005_SOCKET_FAILED"));
    report("R005_CONNECTED");
    const send = request => {
      if (!active()) throw new Error("R005_DRIVER_STOPPED");
      return transport.send(request);
    };
    while (active()) {
      dirty = false;
      await consumer.flush(send);
      if (!active()) break;
      const progress = await consumer.advance(port);
      if (!active()) break;
      await consumer.flush(send);
      if (!active()) break;
      if (!dirty) {
        const waiting = Promise.withResolvers();
        resume = waiting.resolve;
        if (progress === "accepted" || progress === "unknown") timer = setTimeout(waiting.resolve, Math.min(5000, configuration.chat.expiresAt - Date.now()));
        await waiting.promise;
      }
      clearTimeout(timer); resume = undefined;
    }
    return { state: "STOPPED", reason: stopped };
  } catch {
    if (stopped === undefined) stop("R005_EXECUTION_FAILED");
    return { state: "STOPPED", reason: stopped };
  } finally {
    clearTimeout(timer); clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", externalStop);
    controller.abort(); transport?.close();
    // Awaited core calls have already settled under their bounded RPC/send deadlines.
    // Shutdown does not call requestCancel, revoke, retry Start, or rewrite UNKNOWN.
  }
}

async function execute({ database, configuration, credentials }, report) {
  const tokens = Object.values(credentials);
  const { binding, chat } = configuration;
  const adapter = new CqaRunServiceAdapter(binding, { reference: binding.runtime.controlCredentialRef, revision: binding.runtime.controlCredentialRevision, value: credentials[binding.runtime.controlCredentialRef] });
  const port = {
    mode: adapter.mode, bindingDigest: adapter.bindingDigest,
    preflight: (operation, fingerprint) => { noReflection(operation, tokens); adapter.preflight(operation, fingerprint); },
    start: async (operation, fingerprint, signal) => { noReflection(operation, tokens); const result = await adapter.start(operation, fingerprint, signal); noReflection(result, tokens); return result; },
    lookup: async (query, signal) => { noReflection(query, tokens); const result = await adapter.lookup(query, signal); noReflection(result, tokens); return result; },
    cancel: (runId, signal) => { noReflection(runId, tokens); return adapter.cancel(runId, signal); },
  };
  const consumer = new R005CqaConsumer(database, binding);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    return await runR005LiveDriver({ consumer, port, configuration, signal: controller.signal, report,
      connect: (receive, signal) => connectMagicChatTransport({ transportVersion: chat.magicChat.transportVersion, textContract: "r005", url: chat.magicChat.endpoint, appId: binding.appId, credential: credentials[chat.magicChat.credentialRef] }, wire => { noReflection(wire, tokens); receive(wire); }, undefined, signal).then(transport => ({ ...transport, send: request => { noReflection(request, tokens); return transport.send(request); } })),
    });
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); consumer.close(); }
}

/** Import-safe; executor injection never changes the production adapter/transport selection. */
export async function runCli(args, run = execute, write = console.log) {
  let loadedTokens = [];
  try {
    if (args[0] !== "--live") reject();
    const fields = Object.create(null);
    for (let index = 1; index < args.length; index += 2) {
      const key = args[index], value = args[index + 1];
      if (!["--database", "--config", "--credentials"].includes(key) || fields[key] !== undefined || typeof value !== "string" || value.startsWith("--")) reject();
      canonicalPath(value); fields[key] = value;
    }
    for (const key of ["--database", "--config", "--credentials"]) canonicalPath(fields[key]);
    const configuration = readJson(fields["--config"], 131072);
    validateConfiguration(configuration);
    const credentials = readJson(fields["--credentials"], 16384);
    if (credentials !== null && typeof credentials === "object") loadedTokens = Object.values(credentials).filter(value => typeof value === "string" && value.length > 0);
    const refs = [configuration.binding.runtime.controlCredentialRef, configuration.chat.magicChat.credentialRef];
    if (refs[0] === refs[1]) reject();
    exact(credentials, refs);
    const tokens = Object.values(credentials);
    if (tokens.some(token => typeof token !== "string" || !/^[\x21-\x7e]{16,4096}$/u.test(token)) || tokens[0] === tokens[1]) reject();
    noReflection(configuration, tokens); noReflection(fields, tokens);
    // Constructor validation is pure: reject control endpoint/credential mismatches before the executor or database.
    new CqaRunServiceAdapter(configuration.binding, { reference: refs[0], revision: configuration.binding.runtime.controlCredentialRevision, value: credentials[refs[0]] });
    validateLayout(fields["--database"], fields["--config"], fields["--credentials"], configuration.binding);
    if (configuration.chat.expiresAt <= Date.now()) reject();
    const safeWrite = value => { noReflection(value, tokens); write(value); };
    const result = await run({ database: fields["--database"], configuration, credentials }, safeWrite);
    safeWrite(JSON.stringify({ state: result.state, reason: result.reason }));
    return result.reason === "R005_STOPPED" || result.reason === "R005_AUTHORIZATION_EXPIRED" ? 0 : 1;
  } catch {
    const code = "R005_DRIVER_EXECUTION_REJECTED";
    if (!loadedTokens.some(token => code.includes(token))) write(code);
    return 1;
  }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCli(process.argv.slice(2));
