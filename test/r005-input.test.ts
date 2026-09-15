import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planCqaInput, prepareCqaInput, verifyCqaInput } from "../src/driver/r005-input.js";

const bytes = '{"question":"合成问题 <&>"}\n';

function temporaryInput() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "accord-r005-input-")));
  const root = join(directory, "inputs");
  return { directory, root, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("planning is pure; exact immutable input survives replay and adjacent operations remain isolated", () => {
  const temporary = temporaryInput();
  try {
    const first = planCqaInput(temporary.root, "op-1", bytes);
    assert.equal(existsSync(temporary.root), false);
    assert.equal(first.requestFileSha256, createHash("sha256").update(bytes).digest("hex"));
    prepareCqaInput(first, bytes);
    const identity = lstatSync(first.file);
    prepareCqaInput(first, bytes);
    verifyCqaInput(first, bytes);
    assert.equal(lstatSync(first.file).ino, identity.ino, "replay must not replace the file");
    assert.equal(readFileSync(first.file, "utf8"), bytes);
    assert.equal(lstatSync(first.file).mode & 0o7777, 0o400);
    assert.equal(lstatSync(first.directory).mode & 0o7777, 0o700);
    assert.equal(lstatSync(first.root).mode & 0o7777, 0o700);
    const secondBytes = '{"question":"第二个问题"}';
    const second = planCqaInput(temporary.root, "op-2", secondBytes);
    prepareCqaInput(second, secondBytes);
    assert.equal(first.volume.source, first.directory);
    assert.equal(second.volume.source, second.directory);
    assert.notEqual(first.volume.source, second.volume.source);
    assert.equal(first.volume.readOnly, true);
    assert.equal(first.volume.target, "/opt/accord-cqa-input");
    assert.equal(first.guestPath, "/opt/accord-cqa-input/request.json");
    assert.equal(readFileSync(first.file, "utf8"), bytes);
    assert.equal(readFileSync(second.file, "utf8"), secondBytes);
    assert.throws(() => verifyCqaInput({ ...second, file: first.file }, secondBytes), /PLAN_MISMATCH/);
  } finally { temporary.cleanup(); }
});

test("recovery resumes an empty directory, durable staging, and link-before-unlink crash states", () => {
  const temporary = temporaryInput();
  try {
    mkdirSync(temporary.root, { mode: 0o700 });
    for (const phase of ["directory", "staged", "linked"]) {
      const plan = planCqaInput(temporary.root, phase, bytes);
      mkdirSync(plan.directory, { mode: 0o700 });
      const pending = join(plan.directory, ".request.pending");
      if (phase !== "directory") writeFileSync(pending, bytes, { mode: 0o400 });
      if (phase === "linked") linkSync(pending, plan.file);
      assert.throws(() => verifyCqaInput(plan, bytes));
      prepareCqaInput(plan, bytes);
      verifyCqaInput(plan, bytes);
      assert.equal(readFileSync(plan.file, "utf8"), bytes);
      assert.equal(lstatSync(plan.file).nlink, 1);
      assert.equal(existsSync(pending), false);
    }
  } finally { temporary.cleanup(); }
});

test("conflicting or interrupted bytes are preserved rather than overwritten", () => {
  const temporary = temporaryInput();
  try {
    const plan = planCqaInput(temporary.root, "op", bytes);
    prepareCqaInput(plan, bytes);
    const corrupted = bytes.replace("问题", "冲突");
    chmodSync(plan.file, 0o600);
    writeFileSync(plan.file, corrupted);
    chmodSync(plan.file, 0o400);
    const identity = lstatSync(plan.file);
    assert.throws(() => prepareCqaInput(plan, bytes), /BYTES_MISMATCH/);
    assert.throws(() => verifyCqaInput(plan, bytes), /BYTES_MISMATCH/);
    assert.equal(readFileSync(plan.file, "utf8"), corrupted);
    assert.equal(lstatSync(plan.file).ino, identity.ino);
    const partial = planCqaInput(temporary.root, "interrupted", bytes);
    mkdirSync(partial.directory, { mode: 0o700 });
    const pending = join(partial.directory, ".request.pending");
    writeFileSync(pending, bytes.slice(0, 5), { mode: 0o400 });
    assert.throws(() => prepareCqaInput(partial, bytes), /BYTES_MISMATCH/);
    assert.equal(readFileSync(pending, "utf8"), bytes.slice(0, 5));
    assert.equal(existsSync(partial.file), false);
    assert.throws(() => prepareCqaInput(planCqaInput(temporary.root, "op", "{}"), "{}"), /BYTES_MISMATCH/);
    assert.equal(readFileSync(plan.file, "utf8"), corrupted);
  } finally { temporary.cleanup(); }
});

test("symlinks at ancestors, the private root, operation directory and final file are refused", () => {
  const temporary = temporaryInput();
  try {
    const target = join(temporary.directory, "target");
    mkdirSync(target, { mode: 0o700 });
    const alias = join(temporary.directory, "alias");
    symlinkSync(target, alias);
    for (const root of [alias, join(alias, "nested")]) {
      assert.throws(() => prepareCqaInput(planCqaInput(root, "op", bytes), bytes), /SYMLINK/);
    }
    mkdirSync(temporary.root, { mode: 0o700 });
    const operation = planCqaInput(temporary.root, "linked-op", bytes);
    symlinkSync(target, operation.directory);
    assert.throws(() => prepareCqaInput(operation, bytes), /SYMLINK/);
    const file = planCqaInput(temporary.root, "linked-file", bytes);
    mkdirSync(file.directory, { mode: 0o700 });
    const targetFile = join(target, "original.json");
    writeFileSync(targetFile, bytes, { mode: 0o400 });
    symlinkSync(targetFile, file.file);
    assert.throws(() => prepareCqaInput(file, bytes), /SYMLINK/);
    assert.equal(readFileSync(targetFile, "utf8"), bytes);
    assert.equal(existsSync(join(target, "request.json")), false);
  } finally { temporary.cleanup(); }
});

test("broad directories, writable files, unrelated hardlinks and special files fail closed", () => {
  const temporary = temporaryInput();
  try {
    const plan = planCqaInput(temporary.root, "op", bytes);
    prepareCqaInput(plan, bytes);
    for (const path of [plan.root, plan.directory]) {
      chmodSync(path, 0o750);
      assert.throws(() => prepareCqaInput(plan, bytes), /DIRECTORY_UNTRUSTED/);
      chmodSync(path, 0o700);
    }
    chmodSync(temporary.directory, 0o777);
    assert.throws(() => prepareCqaInput(plan, bytes), /ANCESTOR_UNTRUSTED/);
    chmodSync(temporary.directory, 0o700);
    for (const mode of [0o600, 0o444, 0o440, 0o500]) {
      chmodSync(plan.file, mode);
      assert.throws(() => prepareCqaInput(plan, bytes), /FILE_UNTRUSTED/);
      assert.throws(() => verifyCqaInput(plan, bytes), /FILE_UNTRUSTED/);
    }
    chmodSync(plan.file, 0o400);
    linkSync(plan.file, join(temporary.directory, "unexplained-link"));
    assert.throws(() => prepareCqaInput(plan, bytes), /FILE_UNTRUSTED/);
    assert.equal(readFileSync(plan.file, "utf8"), bytes);
    const special = planCqaInput(temporary.root, "special", bytes);
    mkdirSync(special.directory, { mode: 0o700 });
    mkdirSync(special.file, { mode: 0o700 });
    assert.throws(() => prepareCqaInput(special, bytes), /FILE_INVALID/);
    const extra = planCqaInput(temporary.root, "extra", bytes);
    mkdirSync(extra.directory, { mode: 0o700 });
    writeFileSync(join(extra.directory, "unrelated-secret"), "must not be mounted", { mode: 0o400 });
    assert.throws(() => prepareCqaInput(extra, bytes), /DIRECTORY_NOT_EXCLUSIVE/);
  } finally { temporary.cleanup(); }
});

test("an input prepared under another uid is not accepted", () => {
  const temporary = temporaryInput();
  try {
    const plan = planCqaInput(temporary.root, "op", bytes);
    prepareCqaInput(plan, bytes);
    const original = process.getuid!;
    const originalUid = original();
    process.getuid = () => originalUid + 1;
    try {
      assert.throws(() => prepareCqaInput(plan, bytes), /UNTRUSTED/);
      assert.throws(() => verifyCqaInput(plan, bytes), /UNTRUSTED/);
      assert.equal(readFileSync(plan.file, "utf8"), bytes);
    } finally { process.getuid = original; }
  } finally { temporary.cleanup(); }
});

test("forged persisted paths, hashes and volume mappings cannot materialize inputs", () => {
  const temporary = temporaryInput();
  try {
    const original = planCqaInput(temporary.root, "op", bytes);
    const mutations = [
      { file: join(temporary.directory, "escaped.json") },
      { directory: temporary.root },
      { guestPath: "/etc/passwd" },
      { requestFileSha256: "0".repeat(64) },
      { volume: { source: temporary.root, target: "/opt/accord-cqa-input", readOnly: true } },
      { volume: { source: original.directory, target: "/", readOnly: true } },
      { volume: { ...original.volume, readOnly: false } },
    ];
    for (const mutation of mutations) {
      const forged = structuredClone(original);
      Object.assign(forged, mutation);
      assert.throws(() => prepareCqaInput(forged, bytes), /PLAN_MISMATCH/);
      assert.throws(() => verifyCqaInput(forged, bytes), /PLAN_MISMATCH/);
    }
    assert.throws(() => prepareCqaInput(original, `${bytes} `), /PLAN_MISMATCH/);
    assert.equal(existsSync(temporary.root), false);
  } finally { temporary.cleanup(); }
});

test("pure planning rejects noncanonical roots, traversal identities, oversized and malformed Unicode bytes", () => {
  const temporary = temporaryInput();
  try {
    for (const root of ["relative", "/", `${temporary.root}/`, `${temporary.root}/../other`, `${temporary.root}\0bad`]) {
      assert.throws(() => planCqaInput(root, "op", bytes), /ROOT_INVALID/);
    }
    for (const operationId of ["", ".", "..", "../escape", "a/b", "bad:id", "a".repeat(97), "bad\n"]) {
      assert.throws(() => planCqaInput(temporary.root, operationId, bytes), /OPERATION_INVALID/);
    }
    for (const invalid of ["", "\ud800", "\udc00", "汉".repeat(22_000)]) {
      assert.throws(() => planCqaInput(temporary.root, "op", invalid), /BYTES_INVALID/);
    }
    assert.equal(existsSync(temporary.root), false);
  } finally { temporary.cleanup(); }
});
