import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { identityOf } from "../agents/names.ts";

// A merged entry is never edited; every index serves a named query the store test checks.
export type Migration = string | ((db: DatabaseSync) => void);

// Every M3 task had one agent, named by its first session's id; it keeps that name.
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
  `
  -- The worker's session is named by id, not referenced: the delegation outlives a session that is
  -- resumed, and goes with its task.
  CREATE TABLE delegations (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    task_ref       INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    worker_ref     INTEGER NOT NULL REFERENCES agents (ref),
    worker_session TEXT NOT NULL,
    brief          TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN
                     ('working', 'done', 'failed', 'stopped', 'interrupted')),
    result         TEXT,
    created_at     INTEGER NOT NULL,
    ended_at       INTEGER
  ) STRICT;

  CREATE INDEX delegations_by_task ON delegations (task_ref);
  CREATE INDEX delegations_by_worker ON delegations (worker_ref);
  CREATE INDEX delegations_working ON delegations (status, worker_session) WHERE status = 'working';
  `,
  `
  -- Autonomy replaces the permission mode (MODULES M4.6). An agent with no department works at the
  -- level its latest session's mode meant: ask is Supervised, acceptEdits Trusted, bypass Bypass.
  -- The harness itself now only asks, or bypasses.
  ALTER TABLE agents ADD COLUMN autonomy TEXT;
  UPDATE agents SET autonomy = (
    SELECT CASE json_extract(s.options, '$.permissionMode')
             WHEN 'acceptEdits' THEN 'trusted'
             WHEN 'bypass' THEN 'bypass'
             ELSE 'supervised'
           END
    FROM sessions s WHERE s.agent_ref = agents.ref ORDER BY s.ref DESC LIMIT 1)
  WHERE department_ref IS NULL;
  UPDATE sessions SET options = json_set(options, '$.permissionMode', 'ask')
  WHERE json_extract(options, '$.permissionMode') = 'acceptEdits';
  `,
  "ALTER TABLE agents ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;",
  `
  -- Tasks of earlier versions count as finished and reviewed, so old history does not fill the
  -- review queue.
  ALTER TABLE tasks ADD COLUMN state TEXT NOT NULL DEFAULT 'ended'
    CHECK (state IN ('working', 'waiting', 'idle', 'ended'));
  ALTER TABLE tasks ADD COLUMN reviewed_at INTEGER;
  UPDATE tasks SET reviewed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER);
  CREATE INDEX tasks_open_by_department ON tasks (department_ref) WHERE state <> 'ended';

  CREATE INDEX events_turns ON events (session_ref) WHERE type IN ('turn.started', 'turn.ended');

  -- Each task's tokens by harness, summed from its turns as they end.
  CREATE TABLE task_usage (
    task_ref            INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    harness             TEXT NOT NULL,
    input_tokens        INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL,
    PRIMARY KEY (task_ref, harness)
  ) STRICT, WITHOUT ROWID;

  INSERT INTO task_usage
  SELECT s.task_ref, s.options ->> '$.harness', sum(e.payload ->> '$.usage.inputTokens'),
         sum(e.payload ->> '$.usage.outputTokens'),
         sum(coalesce(e.payload ->> '$.usage.cachedInputTokens', 0))
  FROM events e
  JOIN sessions s ON s.ref = e.session_ref
  WHERE e.type = 'turn.ended' AND e.payload ->> '$.usage' IS NOT NULL
  GROUP BY s.task_ref, s.options ->> '$.harness';

  -- Each harness's latest plan limits, a JSON array, since a limit belongs to the account.
  CREATE TABLE harness_limits (
    harness     TEXT PRIMARY KEY,
    limits      TEXT NOT NULL,
    reported_at INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID;

  -- SQLite takes the other columns from the row with the highest position.
  INSERT INTO harness_limits
  SELECT harness, limits, timestamp FROM (
    SELECT s.options ->> '$.harness' AS harness, e.payload ->> '$.limits' AS limits, e.timestamp,
           max(e.position)
    FROM events e
    JOIN sessions s ON s.ref = e.session_ref
    WHERE e.type = 'limits.updated'
    GROUP BY s.options ->> '$.harness');
  `,
  `
  -- Rebuilt, as SQLite cannot change a CHECK: a chief's goal can be queued, and a piece of its
  -- plan runs as a department's task that points at the chief's.
  CREATE TABLE tasks_rebuilt (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    prompt         TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    lead_ref       INTEGER REFERENCES agents (ref),
    department_ref INTEGER REFERENCES departments (ref),
    setup          TEXT,
    state          TEXT NOT NULL
                     CHECK (state IN ('queued', 'working', 'waiting', 'idle', 'ended')),
    reviewed_at    INTEGER,
    parent_ref     INTEGER REFERENCES tasks (ref) ON DELETE SET NULL
  ) STRICT;
  INSERT INTO tasks_rebuilt
    (ref, id, prompt, created_at, lead_ref, department_ref, setup, state, reviewed_at)
  SELECT ref, id, prompt, created_at, lead_ref, department_ref, setup, state, reviewed_at
  FROM tasks;
  DROP TABLE tasks;
  ALTER TABLE tasks_rebuilt RENAME TO tasks;

  CREATE INDEX tasks_by_lead ON tasks (lead_ref) WHERE lead_ref IS NOT NULL;
  CREATE INDEX tasks_by_department ON tasks (department_ref) WHERE department_ref IS NOT NULL;
  CREATE INDEX tasks_open_by_department ON tasks (department_ref) WHERE state <> 'ended';
  CREATE INDEX tasks_open_by_lead ON tasks (lead_ref) WHERE state <> 'ended';
  CREATE INDEX tasks_queued ON tasks (state) WHERE state = 'queued';
  CREATE INDEX tasks_by_parent ON tasks (parent_ref) WHERE parent_ref IS NOT NULL;

  -- The pieces of a chief's plan. A piece names the pieces it waits on by id, as a JSON array; a
  -- new department it proposes is a JSON object until the department exists.
  CREATE TABLE plan_pieces (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    task_ref       INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    title          TEXT NOT NULL,
    department_ref INTEGER REFERENCES departments (ref),
    new_department TEXT,
    brief          TEXT NOT NULL,
    waits_on       TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN
                     ('waiting', 'queued', 'working', 'done', 'failed', 'stopped', 'dropped')),
    piece_task_ref INTEGER REFERENCES tasks (ref) ON DELETE SET NULL,
    result         TEXT,
    created_at     INTEGER NOT NULL,
    ended_at       INTEGER
  ) STRICT;

  CREATE INDEX plan_pieces_by_task ON plan_pieces (task_ref);
  CREATE INDEX plan_pieces_by_piece_task ON plan_pieces (piece_task_ref)
    WHERE piece_task_ref IS NOT NULL;
  CREATE INDEX plan_pieces_open ON plan_pieces (status)
    WHERE status IN ('waiting', 'queued', 'working');

  CREATE INDEX events_messages ON events (session_ref) WHERE type = 'message';
  `,
  `
  -- A department's rules, which every member reads before each task.
  ALTER TABLE departments ADD COLUMN rules TEXT;

  -- Agents stop following their template (D-55): each keeps the template as it is now.
  UPDATE agents
  SET settings = (SELECT p.settings FROM profiles p WHERE p.ref = agents.profile_ref)
  WHERE profile_ref IS NOT NULL;
  `,
];
