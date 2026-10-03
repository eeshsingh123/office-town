// Each entry moves the schema up one version. A merged entry is never edited; a change is a new one.
// Every index here serves a named query; the store test checks that each of those queries uses it.
export const migrations: readonly string[] = [
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
];
