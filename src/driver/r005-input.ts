import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface CqaInputPlan {
  root: string;
  operationId: string;
  directory: string;
  file: string;
  requestFileSha256: string;
  guestPath: string;
  volume: { source: string; target: string; readOnly: true };
}

const guestDirectory = "/opt/accord-cqa-input";
const pendingName = ".request.pending";

/** Pure: callers must persist this plan and the accepted bytes before preparation. */
export function planCqaInput(root: string, operationId: string, requestBytes: string): CqaInputPlan {
  if (typeof root !== "string" || !isAbsolute(root) || root === dirname(root) || resolve(root) !== root || root.includes("\0")) {
    throw new Error("CQA_INPUT_ROOT_INVALID");
  }
  if (typeof operationId !== "string" || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.exec(operationId)?.[0] !== operationId) {
    throw new Error("CQA_INPUT_OPERATION_INVALID");
  }
  if (typeof requestBytes !== "string" || !requestBytes.isWellFormed() || requestBytes.length === 0 || Buffer.byteLength(requestBytes) > 64 * 1024) {
    throw new Error("CQA_INPUT_BYTES_INVALID");
  }
  const directory = join(root, operationId);
  return {
    root, operationId, directory, file: join(directory, "request.json"),
    requestFileSha256: createHash("sha256").update(requestBytes).digest("hex"),
    guestPath: `${guestDirectory}/request.json`,
    // Offline contract: Accord, daemon and Engine use this SAME host path.
    // This describes a requested mount, not verified runtime/guest isolation.
    volume: { source: directory, target: guestDirectory, readOnly: true },
  };
}

function validatePlan(plan: CqaInputPlan, requestBytes: string): void {
  const expected = planCqaInput(plan.root, plan.operationId, requestBytes);
  for (const key of ["root", "operationId", "directory", "file", "requestFileSha256", "guestPath"] as const) {
    if (plan[key] !== expected[key]) throw new Error("CQA_INPUT_PLAN_MISMATCH");
  }
  if (Object.keys(plan).length !== 7 || !plan.volume || Object.keys(plan.volume).length !== 3
    || plan.volume.source !== expected.volume.source || plan.volume.target !== expected.volume.target || plan.volume.readOnly !== true) {
    throw new Error("CQA_INPUT_PLAN_MISMATCH");
  }
}

function uid(): number {
  if (!process.getuid) throw new Error("CQA_INPUT_POSIX_REQUIRED");
  return process.getuid();
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function statIfPresent(path: string): Stats | undefined {
  try { return lstatSync(path); }
  catch (error) { if (!hasCode(error, "ENOENT")) throw error; return undefined; }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function checkDirectory(path: string, privateDirectory: boolean): Stats {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error("CQA_INPUT_SYMLINK");
  if (!metadata.isDirectory()) throw new Error("CQA_INPUT_DIRECTORY_INVALID");
  if (privateDirectory) {
    if (metadata.uid !== uid() || (metadata.mode & 0o7777) !== 0o700) throw new Error("CQA_INPUT_DIRECTORY_UNTRUSTED");
  } else {
    // Root-owned sticky temporary ancestors protect a current-uid child's name.
    const stickyRoot = metadata.uid === 0 && (metadata.mode & 0o1000) !== 0;
    if ((metadata.uid !== 0 && metadata.uid !== uid()) || (metadata.mode & 0o6000) !== 0
      || ((metadata.mode & 0o022) !== 0 && !stickyRoot)) throw new Error("CQA_INPUT_ANCESTOR_UNTRUSTED");
  }
  return metadata;
}

function checkAncestors(path: string): void {
  const ancestors: string[] = [];
  for (let current = path; ; current = dirname(current)) {
    ancestors.push(current);
    if (current === dirname(current)) break;
  }
  for (const ancestor of ancestors.reverse()) checkDirectory(ancestor, false);
}

function syncDirectory(path: string): void {
  const before = lstatSync(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!sameFile(before, fstatSync(descriptor))) throw new Error("CQA_INPUT_PATH_CHANGED");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}

function ensurePrivateDirectory(path: string): void {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  checkDirectory(path, true);
  syncDirectory(dirname(path));
}

function checkLayout(plan: CqaInputPlan): void {
  checkAncestors(dirname(plan.root));
  checkDirectory(plan.root, true);
  checkDirectory(plan.directory, true);
  if (readdirSync(plan.directory).some(name => name !== "request.json" && name !== pendingName)) {
    throw new Error("CQA_INPUT_DIRECTORY_NOT_EXCLUSIVE");
  }
}

function checkFile(path: string, bytes: string, digest: string, links: number, durable = false): Stats {
  const before = lstatSync(path);
  if (before.isSymbolicLink()) throw new Error("CQA_INPUT_SYMLINK");
  if (!before.isFile()) throw new Error("CQA_INPUT_FILE_INVALID");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = fstatSync(descriptor);
    if (!sameFile(before, metadata) || !metadata.isFile()) throw new Error("CQA_INPUT_PATH_CHANGED");
    if (metadata.uid !== uid() || (metadata.mode & 0o7777) !== 0o400 || metadata.nlink !== links) {
      throw new Error("CQA_INPUT_FILE_UNTRUSTED");
    }
    if (metadata.size !== Buffer.byteLength(bytes)) throw new Error("CQA_INPUT_BYTES_MISMATCH");
    const actual = readFileSync(descriptor);
    if (!actual.equals(Buffer.from(bytes)) || createHash("sha256").update(actual).digest("hex") !== digest) {
      throw new Error("CQA_INPUT_BYTES_MISMATCH");
    }
    if (!sameFile(metadata, lstatSync(path))) throw new Error("CQA_INPUT_PATH_CHANGED");
    if (durable) fsyncSync(descriptor);
    return metadata;
  } finally { closeSync(descriptor); }
}

/**
 * Single trusted preparer, POSIX local filesystem with fsync and hard links.
 * Node has no openat: current-uid writers and root are trusted, not adversarial.
 * Never changes an existing final input; conflicting/partial staging fails closed.
 */
export function prepareCqaInput(plan: CqaInputPlan, requestBytes: string): void {
  validatePlan(plan, requestBytes);
  checkAncestors(dirname(plan.root));
  ensurePrivateDirectory(plan.root);
  ensurePrivateDirectory(plan.directory);
  checkLayout(plan);
  const pending = join(plan.directory, pendingName);
  const finalMetadata = statIfPresent(plan.file);
  const pendingMetadata = statIfPresent(pending);
  if (finalMetadata !== undefined) {
    if (pendingMetadata !== undefined && sameFile(finalMetadata, pendingMetadata)) {
      // Crash after link but before unlink: only this exact known link is recoverable.
      checkFile(plan.file, requestBytes, plan.requestFileSha256, 2, true);
      checkFile(pending, requestBytes, plan.requestFileSha256, 2);
      syncDirectory(plan.directory);
      unlinkSync(pending);
      syncDirectory(plan.directory);
    } else {
      checkFile(plan.file, requestBytes, plan.requestFileSha256, 1, true);
      if (pendingMetadata !== undefined) throw new Error("CQA_INPUT_STAGING_CONFLICT");
    }
  } else {
    if (pendingMetadata === undefined) {
      const descriptor = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
      try { writeFileSync(descriptor, requestBytes, "utf8"); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
    }
    checkFile(pending, requestBytes, plan.requestFileSha256, 1, true);
    syncDirectory(plan.directory);
    // link is atomic and never replaces an existing final name, unlike rename.
    linkSync(pending, plan.file);
    syncDirectory(plan.directory);
    unlinkSync(pending);
    syncDirectory(plan.directory);
  }
  verifyCqaInput(plan, requestBytes);
  syncDirectory(plan.directory);
  syncDirectory(plan.root);
}

/** Read-only local verification; does not qualify a real daemon/Engine mount. */
export function verifyCqaInput(plan: CqaInputPlan, requestBytes: string): void {
  validatePlan(plan, requestBytes);
  checkLayout(plan);
  if (statIfPresent(join(plan.directory, pendingName)) !== undefined) throw new Error("CQA_INPUT_PREPARATION_INCOMPLETE");
  checkFile(plan.file, requestBytes, plan.requestFileSha256, 1);
}
