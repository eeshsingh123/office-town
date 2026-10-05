import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.ts";
import { StoreFileError } from "./store.ts";

// Written into the file's header, so a different SQLite file is never migrated by mistake.
const APPLICATION_ID = 0x4f54_4f57;

// SQLite's own code for a file another connection holds.
const SQLITE_BUSY = 5;

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    // One core per data folder: a second one would mark the first one's running agents
    // interrupted. The lock is held until the connection closes, and the OS drops it if the
    // process dies. auto_vacuum only takes effect on a new file, before its first table is
    // created. Without a size limit the WAL file stays as large as its biggest burst of writes
    // until the app closes.
    db.exec(`
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA journal_mode = WAL;
      PRAGMA journal_size_limit = 8388608;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
    migrate(db, file);
    db.exec("PRAGMA optimize = 0x10002");
  } catch (error) {
    db.close();
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) {
      throw new StoreFileError(`Office Town is already running and using ${file}.`);
    }
    throw error;
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // Some errors, such as a full disk, already rolled the transaction back.
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function readNumber(db: DatabaseSync, sql: string): number {
  return Number(Object.values(db.prepare(sql).get() ?? {})[0]);
}

function migrate(db: DatabaseSync, file: string): void {
  const version = readNumber(db, "PRAGMA user_version");
  const fresh = version === 0 && readNumber(db, "SELECT count(*) FROM sqlite_schema") === 0;
  if (!fresh && readNumber(db, "PRAGMA application_id") !== APPLICATION_ID) {
    throw new StoreFileError(`${file} is not a store of this app.`);
  }
  if (version > migrations.length) {
    throw new StoreFileError(
      `${file} was written by a newer version of the app (schema ${version}, this version knows ${migrations.length}).`,
    );
  }
  if (version === migrations.length) return;
  // The user's history cannot be recreated, so a copy is kept before its schema changes.
  const backup = `${file}.bak-v${version}`;
  if (!fresh && !existsSync(backup)) db.prepare("VACUUM INTO ?").run(backup);
  for (const [offset, migration] of migrations.slice(version).entries()) {
    transaction(db, () => {
      if (typeof migration === "string") db.exec(migration);
      else migration(db);
      if (fresh) db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      db.exec(`PRAGMA user_version = ${version + offset + 1}`);
    });
  }
}
