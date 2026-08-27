import { DatabaseSync } from "node:sqlite";

import { openAuthorityDatabase } from "../../src/persistence/sqlite-authority.js";
import { SYNTHETIC_INTAKE } from "../fixture.js";

type CrashBarrier = "after-intake-commit" | "before-intake-commit";

const [databasePath, barrierValue] = process.argv.slice(2);
if (databasePath === undefined || (barrierValue !== "before-intake-commit" && barrierValue !== "after-intake-commit")) {
  throw new TypeError("usage: intake-crash-child <database-path> <before-intake-commit|after-intake-commit>");
}
const barrier: CrashBarrier = barrierValue;

interface MutableDatabasePrototype {
  exec(this: DatabaseSync, sql: string): void;
}

const databasePrototype = DatabaseSync.prototype as MutableDatabasePrototype;
const originalExec = databasePrototype.exec;
let crashBarrierArmed = false;

databasePrototype.exec = function execWithCrashBarrier(this: DatabaseSync, sql: string): void {
  const statement = sql.trim().replace(/;$/u, "");
  if (!crashBarrierArmed || statement !== "COMMIT") {
    originalExec.call(this, sql);
    return;
  }

  if (barrier === "before-intake-commit") {
    process.kill(process.pid, "SIGKILL");
    throw new Error("SIGKILL did not terminate the process before intake commit");
  }

  originalExec.call(this, sql);
  process.kill(process.pid, "SIGKILL");
  throw new Error("SIGKILL did not terminate the process after intake commit");
};

const authority = openAuthorityDatabase(databasePath);
crashBarrierArmed = true;
authority.processSyntheticIntake(SYNTHETIC_INTAKE);
throw new Error("intake unexpectedly returned without reaching the crash barrier");
