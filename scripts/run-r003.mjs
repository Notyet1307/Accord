import { openSync, fstatSync, readSync, closeSync, lstatSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeFrozenRuntimeConfiguration, assertRuntimeConfigurationWindow } from "../dist/src/frozen-runtime-config.js";
import { parseAttemptId } from "../dist/src/core/ids.js";
import { openAuthorityDatabase } from "../dist/src/persistence/sqlite-authority.js";
import { runR003Driver } from "../dist/src/driver/r003-driver.js";
import { connectMagicChatTransport } from "../dist/src/transports/magicchat-websocket.js";
import { prepareBaizhiResponsesPort } from "../dist/src/transports/baizhi-responses.js";

function reject() { throw new Error("DRIVER_INPUT_REJECTED"); }
function readJson(path, maximum, privateFile) {
  if (!isAbsolute(path)) reject();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum || (privateFile && ((stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()))) reject();
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const length = readSync(fd, buffer, size, buffer.length - size, null);
      if (length === 0) break;
      size += length;
    }
    if (size > maximum) reject();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
  } finally { closeSync(fd); }
}
function noReflection(value, tokens) {
  const encoded = JSON.stringify(value);
  if (tokens.some((token) => encoded.includes(JSON.stringify(token).slice(1, -1)))) throw new Error("DRIVER_CREDENTIAL_REFLECTION");
}
async function execute({ database, configuration, credentials, retryUnknown }, report) {
  const authority = openAuthorityDatabase(database);
  const controller = new AbortController();
  const stop = () => controller.abort();
  const tokens = Object.values(credentials);
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    return await runR003Driver({ authority, configuration, signal: controller.signal, ...(retryUnknown === undefined ? {} : { retryUnknown }), report,
      ports: {
        connect: (receive, signal) => connectMagicChatTransport({ transportVersion: configuration.magicChat.transportVersion, url: configuration.magicChat.endpoint, appId: configuration.magicChat.appId, credential: credentials[configuration.magicChat.credentialRef] }, (envelope) => { noReflection(envelope, tokens); receive(envelope); }, undefined, signal).then((transport) => ({ ...transport, send: (request) => { noReflection(request, tokens); return transport.send(request); } })),
        provider: (invocation, contract, signal) => {
          noReflection(invocation, tokens);
          const port = prepareBaizhiResponsesPort({ transportVersion: configuration.provider.transportVersion, responsesUrl: configuration.provider.endpoint, deploymentId: configuration.provider.deploymentId, credential: credentials[configuration.provider.credentialRef], costLimitCny: null }, invocation, invocation.instructions, undefined, contract, signal);
          return { ...port, configuration: invocation.configuration, instructions: invocation.instructions, complete: async (request) => { const wire = await port.complete(request); noReflection(JSON.parse(wire), tokens); return wire; } };
        },
      },
    });
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); authority.close(); }
}

/** The executor injection is for offline validation; importing this file never starts I/O. */
export async function runCli(args, run = execute, write = console.log) {
  let loadedTokens = [];
  try {
    if (args[0] !== "--live") reject();
    const fields = Object.create(null);
    for (let index = 1; index < args.length; index += 2) {
      const key = args[index]; const value = args[index + 1];
      if (!["--database", "--config", "--credentials", "--retry-unknown"].includes(key) || fields[key] !== undefined || typeof value !== "string" || value.startsWith("--")) reject();
      fields[key] = value;
    }
    for (const key of ["--database", "--config", "--credentials"]) if (typeof fields[key] !== "string" || !isAbsolute(fields[key])) reject();
    const configuration = normalizeFrozenRuntimeConfiguration(readJson(fields["--config"], 131072, false));
    assertRuntimeConfigurationWindow(configuration, new Date().toISOString());
    if (configuration.magicChat.transportVersion !== "accord.magicchat-websocket-transport/v2" || configuration.provider.transportVersion !== "accord.baizhi-responses-transport/v2" || configuration.profiles.REVIEWER.profileVersion !== "accord.reviewer/v2" || configuration.profiles.WRITER.profileVersion !== "accord.writer/v2") reject();
    const credentials = readJson(fields["--credentials"], 16384, true);
    const refs = [configuration.magicChat.credentialRef, configuration.provider.credentialRef].sort();
    if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials) || refs[0] === refs[1] || JSON.stringify(Object.keys(credentials).sort()) !== JSON.stringify(refs)) reject();
    const tokens = Object.values(credentials);
    if (tokens.some((token) => typeof token !== "string" || token.length === 0 || token.length > 4096 || /[\p{White_Space}\p{Cc}]/u.test(token))) reject();
    loadedTokens = tokens;
    noReflection(configuration, tokens);
    if ([fields["--config"], fields["--credentials"]].includes(fields["--database"])) reject();
    try { const stat = lstatSync(fields["--database"]); if (!stat.isFile() || stat.isSymbolicLink()) reject(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const retryUnknown = fields["--retry-unknown"] === undefined ? undefined : parseAttemptId(fields["--retry-unknown"]);
    const safeWrite = (value) => { noReflection(value, tokens); write(value); };
    const result = await run({ database: fields["--database"], configuration, credentials, ...(retryUnknown === undefined ? {} : { retryUnknown }) }, safeWrite);
    safeWrite(JSON.stringify({ state: result.state, reason: result.reason, ...(result.trace === undefined ? {} : { traceSha256: result.trace.sha256, traceBytes: Buffer.byteLength(result.trace.canonicalBytes) }) }));
    return result.state === "COMPLETE" ? 0 : 1;
  } catch { const code = "DRIVER_EXECUTION_REJECTED"; if (!loadedTokens.some((token) => code.includes(token))) write(code); return 1; }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runCli(process.argv.slice(2));
