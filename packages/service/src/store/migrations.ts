import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { identityOf } from "../agents/names.ts";

// Each entry moves the schema up one version: SQL, or a step that also moves data. A merged entry
// is never edited; a change is a new one. Every index here serves a named query; the store test
// checks that each of those queries uses it.
export type Migration = string | ((db: DatabaseSync) => void);

// Every M3 task had one agent, named by its first session's id; it is stored with the same name,
// and with its harness settings as its own.
function giveEachTaskItsAgent(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE profiles (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL,
    colour     TEXT NOT NULL,
    settings   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE agents (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL UNIQUE,
    colour      TEXT NOT NULL,
    role        TEXT,
    profile_ref INTEGER REFERENCES profiles (ref) ON DELETE SET NULL,
    settings    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX agents_by_profile ON agents (profile_ref) WHERE profile_ref IS NOT NULL;

  ALTER TABLE sessions ADD COLUMN agent_ref INTEGER REFERENCES agents (ref);
  CREATE INDEX sessions_by_agent ON sessions (agent_ref);
  `);
  const firstSessions = db
    .prepare(`
      SELECT t.ref AS taskRef, s.id AS sessionId, s.options, s.created_at AS createdAt
      FROM tasks t
      JOIN sessions s ON s.ref = (SELECT min(ref) FROM sessions WHERE task_ref = t.ref)`)
    .all() as { taskRef: number; sessionId: string; options: string; createdAt: number }[];
  const insert = db.prepare(`
    INSERT INTO agents (id, name, colour, settings, created_at) VALUES (?, ?, ?, ?, ?)`);
  const assign = db.prepare("UPDATE sessions SET agent_ref = ? WHERE task_ref = ?");
  const taken = new Set<string>();
  for (const { taskRef, sessionId, options, createdAt } of firstSessions) {
    const { harness, environment, model, effort } = JSON.parse(options);
    // Two tasks could hash to the same handle; the later one is renamed rather than refused.
    let identity = identityOf(sessionId);
    for (let attempt = 1; taken.has(identity.name); attempt += 1) {
      identity = identityOf(`${sessionId}/${attempt}`);
    }
    taken.add(identity.name);
    const settings = JSON.stringify({ harness, environment, model, effort });
    const { lastInsertRowid } = insert.run(
      randomUUID(),
      identity.name,
      identity.colour,
      settings,
      createdAt,
    );
    assign.run(lastInsertRowid, taskRef);
  }
}

export const migrations: readonly Migration[] = [
  `
  CREATE TABLE tasks (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    prompt     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    ref                INTEGER PRIMARY KEY,
    id                 TEXT NOT NULL UNIQUE,
    task_ref           INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    resumed_from_ref   INTEGER REFERENCES sessions (ref) ON DELETE SET NULL,
    options            TEXT NOT NULL,
    harness_session_id TEXT,
    status             TEXT NOT NULL CHECK (status IN
                         ('starting', 'running', 'stopped', 'exited', 'failed', 'interrupted')),
    created_at         INTEGER NOT NULL,
    ended_at           INTEGER
  ) STRICT;

  CREATE INDEX sessions_by_task ON sessions (task_ref);
  CREATE INDEX sessions_unfinished ON sessions (status) WHERE status IN ('starting', 'running');
  CREATE INDEX sessions_by_resumed_from ON sessions (resumed_from_ref)
    WHERE resumed_from_ref IS NOT NULL;

  -- AUTOINCREMENT so a deleted position is never reused: readers resume from the last one they saw.
  CREATE TABLE events (
    position    INTEGER PRIMARY KEY AUTOINCREMENT,
    session_ref INTEGER NOT NULL REFERENCES sessions (ref) ON DELETE CASCADE,
    sequence    INTEGER NOT NULL,
    id          TEXT NOT NULL,
    type        TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    payload     TEXT NOT NULL
  ) STRICT;

  -- Every index ends in the row's position, so this one also reads a session's events in order.
  CREATE INDEX events_by_session ON events (session_ref);

  CREATE TABLE harness_lines (
    position    INTEGER PRIMARY KEY,
    session_ref INTEGER NOT NULL REFERENCES sessions (ref) ON DELETE CASCADE,
    direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    line        TEXT NOT NULL,
    -- Set when the line was cut: its full size in bytes.
    full_bytes  INTEGER,
    timestamp   INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX harness_lines_by_session ON harness_lines (session_ref);
  `,
  `
  CREATE TABLE workspaces (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    -- A JSON array; the first folder is where the agent works.
    folders    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_at    INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  -- The requests still waiting for the user, each pointing at the event that asked.
  CREATE TABLE pending_requests (
    event_position INTEGER PRIMARY KEY REFERENCES events (position) ON DELETE CASCADE,
    session_ref    INTEGER NOT NULL REFERENCES sessions (ref) ON DELETE CASCADE,
    request_id     TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX pending_requests_by_session ON pending_requests (session_ref, request_id);
  `,
  giveEachTaskItsAgent,
  `
  CREATE TABLE departments (
    ref               INTEGER PRIMARY KEY,
    id                TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    workspace_ref     INTEGER NOT NULL REFERENCES workspaces (ref),
    autonomy          TEXT NOT NULL,
    lead_ref          INTEGER NOT NULL REFERENCES agents (ref),
    branch_per_worker INTEGER NOT NULL,
    code_flow         INTEGER NOT NULL,
    created_at        INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX departments_by_workspace ON departments (workspace_ref);
  CREATE INDEX departments_by_lead ON departments (lead_ref);

  ALTER TABLE agents ADD COLUMN purpose TEXT;
  ALTER TABLE agents ADD COLUMN department_ref INTEGER REFERENCES departments (ref);
  CREATE INDEX agents_by_department ON agents (department_ref) WHERE department_ref IS NOT NULL;

  -- A team's task: its lead, its department once approved, and until then where the proposed
  -- team would work (a JSON object with the workspace and the autonomy level).
  ALTER TABLE tasks ADD COLUMN lead_ref INTEGER REFERENCES agents (ref);
  ALTER TABLE tasks ADD COLUMN department_ref INTEGER REFERENCES departments (ref);
  ALTER TABLE tasks ADD COLUMN setup TEXT;
  CREATE INDEX tasks_by_lead ON tasks (lead_ref) WHERE lead_ref IS NOT NULL;
  CREATE INDEX tasks_by_department ON tasks (department_ref) WHERE department_ref IS NOT NULL;
  `,
];
