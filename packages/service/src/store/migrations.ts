import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

// D-56: folders carry access, the output folder becomes a Scratch workspace, a task names its
// workspace. A solo task is matched by the folder its first session worked in.
function giveWorkspacesKinds(db: DatabaseSync): void {
  db.exec(`
  ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'folders'
    CHECK (kind IN ('folders', 'scratch'));
  ALTER TABLE tasks ADD COLUMN workspace_ref INTEGER REFERENCES workspaces (ref) ON DELETE SET NULL;
  CREATE INDEX tasks_by_workspace ON tasks (workspace_ref) WHERE workspace_ref IS NOT NULL;
  `);
  const workspaces = db.prepare("SELECT ref, folders FROM workspaces").all() as {
    ref: number;
    folders: string;
  }[];
  const setFolders = db.prepare("UPDATE workspaces SET folders = ? WHERE ref = ?");
  const byMainFolder = new Map<string, number>();
  for (const { ref, folders } of workspaces) {
    const paths = JSON.parse(folders) as string[];
    if (paths[0] !== undefined && !byMainFolder.has(paths[0])) byMainFolder.set(paths[0], ref);
    setFolders.run(JSON.stringify(paths.map((path) => ({ path, access: "edit" }))), ref);
  }
  const saved = db.prepare("SELECT value FROM settings WHERE key = 'outputFolder'").get() as
    | { value: string }
    | undefined;
  const scratchFolder =
    saved === undefined
      ? join(homedir(), "OfficeTown", "Scratch")
      : (JSON.parse(saved.value) as string);
  const now = Date.now();
  const scratch = db
    .prepare(`
      INSERT INTO workspaces (id, name, kind, folders, created_at, used_at)
      VALUES (?, 'Scratch', 'scratch', ?, ?, ?)`)
    .run(randomUUID(), JSON.stringify([{ path: scratchFolder, access: "edit" }]), now, now);
  db.exec("DELETE FROM settings WHERE key = 'outputFolder'");
  db.exec(`
  UPDATE tasks SET workspace_ref =
    (SELECT workspace_ref FROM departments WHERE departments.ref = tasks.department_ref)
  WHERE department_ref IS NOT NULL;
  UPDATE tasks SET workspace_ref =
    (SELECT ref FROM workspaces WHERE workspaces.id = tasks.setup ->> '$.workspaceId')
  WHERE workspace_ref IS NULL AND setup IS NOT NULL;
  `);
  const solo = db
    .prepare(`
      SELECT t.ref, s.options ->> '$.workspacePath' AS folder
      FROM tasks t
      JOIN sessions s ON s.ref = (SELECT min(ref) FROM sessions WHERE task_ref = t.ref)
      WHERE t.lead_ref IS NULL AND t.workspace_ref IS NULL`)
    .all() as { ref: number; folder: string | null }[];
  const setWorkspace = db.prepare("UPDATE tasks SET workspace_ref = ? WHERE ref = ?");
  for (const { ref, folder } of solo) {
    if (folder === null) continue;
    const workspace =
      byMainFolder.get(folder) ??
      (dirname(folder) === scratchFolder ? Number(scratch.lastInsertRowid) : undefined);
    if (workspace !== undefined) setWorkspace.run(workspace, ref);
  }
}

// Logins of their own, each in a folder (D-61). The CLI's default login has no row.
function addAccounts(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    harness     TEXT NOT NULL,
    environment TEXT NOT NULL,
    name        TEXT NOT NULL,
    folder      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS account_limits (
    account_id  TEXT PRIMARY KEY,
    harness     TEXT NOT NULL,
    limits      TEXT NOT NULL,
    reported_at INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID;

  -- "Where it went" sums the turns of a recent period.
  CREATE INDEX IF NOT EXISTS events_turns_by_time ON events (timestamp) WHERE type = 'turn.ended';
  `);
  const old = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'harness_limits'")
    .get();
  if (old === undefined) return;
  // A limit belongs to an account. Each old row was its harness's default login, whose id is
  // the harness.
  db.exec(`
  INSERT INTO account_limits SELECT harness, harness, limits, reported_at FROM harness_limits;
  DROP TABLE harness_limits;
  `);
}

// What a department is for, read by the chief. A removed department keeps its row, so the tasks it
// ran still show under its name. Checked first, as later migrations must run twice safely.
function addDepartmentPurpose(db: DatabaseSync): void {
  db.exec(`
  CREATE INDEX IF NOT EXISTS plan_pieces_by_department ON plan_pieces (department_ref)
    WHERE department_ref IS NOT NULL;
  `);
  const has = db.prepare("SELECT 1 FROM pragma_table_info('departments') WHERE name = 'purpose'");
  if (has.get() !== undefined) return;
  db.exec(`
  ALTER TABLE departments ADD COLUMN purpose TEXT;
  ALTER TABLE departments ADD COLUMN removed_at INTEGER;
  `);
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
  giveWorkspacesKinds,
  `
  -- Trusted is gone (D-57): every saved Trusted level, pending setup and past answer becomes Full.
  UPDATE agents SET autonomy = 'full' WHERE autonomy = 'trusted';
  UPDATE departments SET autonomy = 'full' WHERE autonomy = 'trusted';
  UPDATE agents SET settings = json_set(settings, '$.autonomy', 'full')
  WHERE settings ->> '$.autonomy' = 'trusted';
  UPDATE profiles SET settings = json_set(settings, '$.autonomy', 'full')
  WHERE settings ->> '$.autonomy' = 'trusted';
  UPDATE tasks SET setup = json_set(setup, '$.autonomy', 'full')
  WHERE setup ->> '$.autonomy' = 'trusted';
  UPDATE plan_pieces SET new_department = json_set(new_department, '$.autonomy', 'full')
  WHERE new_department ->> '$.autonomy' = 'trusted';
  UPDATE events SET payload = replace(payload, '"autonomy":"trusted"', '"autonomy":"full"')
  WHERE instr(payload, '"autonomy":"trusted"') > 0;
  `,
  addAccounts,
  `
  -- The agents picked together for one task, who work under its lead.
  CREATE TABLE IF NOT EXISTS task_workers (
    task_ref  INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    agent_ref INTEGER NOT NULL REFERENCES agents (ref),
    PRIMARY KEY (task_ref, agent_ref)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS task_workers_by_agent ON task_workers (agent_ref);
  `,
  `
  -- Files and images the user gave agents, copied into the data folder, and folders they linked
  -- (D-64). A task lists the ones sent in it, so they go when it does.
  CREATE TABLE IF NOT EXISTS attachments (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL CHECK (kind IN ('file', 'image', 'folder')),
    name       TEXT NOT NULL,
    path       TEXT NOT NULL,
    bytes      INTEGER,
    mime_type  TEXT,
    sha256     TEXT,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS attachments_by_path ON attachments (path);
  CREATE INDEX IF NOT EXISTS attachments_by_created ON attachments (created_at);

  CREATE TABLE IF NOT EXISTS task_attachments (
    task_ref       INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    attachment_ref INTEGER NOT NULL REFERENCES attachments (ref) ON DELETE CASCADE,
    PRIMARY KEY (task_ref, attachment_ref)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS task_attachments_by_attachment ON task_attachments (attachment_ref);
  `,
  `
  -- A workspace's reference files and folders (D-64). An item points at the attachment holding
  -- its file, so Replace moves it to a new one; who it is given to is JSON of public ids.
  CREATE TABLE IF NOT EXISTS library_items (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    workspace_ref  INTEGER NOT NULL REFERENCES workspaces (ref) ON DELETE CASCADE,
    attachment_ref INTEGER NOT NULL UNIQUE REFERENCES attachments (ref),
    given_to       TEXT NOT NULL,
    added_by_ref   INTEGER REFERENCES agents (ref) ON DELETE SET NULL,
    created_at     INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS library_items_by_workspace ON library_items (workspace_ref);
  CREATE INDEX IF NOT EXISTS library_items_by_adder ON library_items (added_by_ref);

  -- The tasks an item was given in, and when an agent there first opened it.
  CREATE TABLE IF NOT EXISTS library_uses (
    item_ref  INTEGER NOT NULL REFERENCES library_items (ref) ON DELETE CASCADE,
    task_ref  INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    opened_at INTEGER,
    PRIMARY KEY (item_ref, task_ref)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS library_uses_by_task ON library_uses (task_ref);
  `,
  addDepartmentPurpose,
  `
  -- Apps the user connected (D-67). Keys and sign-ins live in the OS credential store, never
  -- here. The tools column is the app's list as last read, so a conversation never waits on it.
  CREATE TABLE IF NOT EXISTS connectors (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    slug       TEXT NOT NULL UNIQUE,
    setup      TEXT NOT NULL,
    audience   TEXT NOT NULL,
    permission TEXT NOT NULL CHECK (permission IN ('read_only', 'ask', 'dont_ask')),
    enabled    INTEGER NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('connected', 'signed_out', 'off', 'failing')),
    tools      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  -- Every call an agent made to a connector, with the team it was in at the time.
  CREATE TABLE IF NOT EXISTS connector_calls (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    connector_ref  INTEGER NOT NULL REFERENCES connectors (ref) ON DELETE CASCADE,
    session_ref    INTEGER NOT NULL REFERENCES sessions (ref) ON DELETE CASCADE,
    department_ref INTEGER REFERENCES departments (ref) ON DELETE SET NULL,
    tool           TEXT NOT NULL,
    input          TEXT NOT NULL,
    change         INTEGER NOT NULL,
    outcome        TEXT NOT NULL CHECK (outcome IN ('done', 'refused', 'failed', 'asked')),
    at             INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS connector_calls_by_connector ON connector_calls (connector_ref);
  CREATE INDEX IF NOT EXISTS connector_calls_by_session ON connector_calls (session_ref);
  CREATE INDEX IF NOT EXISTS connector_calls_by_department ON connector_calls (department_ref);
  `,
];
