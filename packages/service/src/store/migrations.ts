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

// D-56: an assistant can always start without choosing a folder; older apps let Scratch be removed.
function restoreScratch(db: DatabaseSync): void {
  if (db.prepare("SELECT 1 FROM workspaces WHERE kind = 'scratch'").get() !== undefined) return;
  const folder = join(homedir(), "OfficeTown", "Scratch");
  const now = Date.now();
  db.prepare(`
    INSERT INTO workspaces (id, name, kind, folders, created_at, used_at)
    VALUES (?, 'Scratch', 'scratch', ?, ?, ?)`).run(
    randomUUID(),
    JSON.stringify([{ path: folder, access: "edit" }]),
    now,
    now,
  );
}

// Scratch stands in for a department with no folders (D-82), so it goes where one has any. The
// first folder becomes the default if Scratch was. A goal keeps the workspace it started in.
function dropScratchBesideFolders(db: DatabaseSync): void {
  db.exec(`
  UPDATE departments SET workspace_ref = (
    SELECT extra.workspace_ref
    FROM department_workspaces extra JOIN workspaces folder ON folder.ref = extra.workspace_ref
    WHERE extra.department_ref = departments.ref AND folder.kind = 'folders'
    ORDER BY extra.position LIMIT 1
  )
  WHERE workspace_ref IN (SELECT ref FROM workspaces WHERE kind = 'scratch')
    AND ref IN (
      SELECT extra.department_ref
      FROM department_workspaces extra JOIN workspaces folder ON folder.ref = extra.workspace_ref
      WHERE folder.kind = 'folders'
    );

  DELETE FROM department_workspaces
  WHERE workspace_ref = (SELECT workspace_ref FROM departments WHERE ref = department_ref)
    OR (
      workspace_ref IN (SELECT ref FROM workspaces WHERE kind = 'scratch')
      AND department_ref IN (
        SELECT department.ref
        FROM departments department JOIN workspaces main ON main.ref = department.workspace_ref
        WHERE main.kind = 'folders'
      )
    );
  `);
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

// A task paused at 95% of an account's usage window (team/usage-pause.ts).
function addTaskPause(db: DatabaseSync): void {
  const has = db.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'paused'");
  if (has.get() === undefined) db.exec("ALTER TABLE tasks ADD COLUMN paused TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS tasks_paused ON tasks (ref) WHERE paused IS NOT NULL");
}

// A short name for a task, written after it starts.
function addTaskTitle(db: DatabaseSync): void {
  const has = db.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'title'");
  if (has.get() === undefined) db.exec("ALTER TABLE tasks ADD COLUMN title TEXT");
}

// Efficient mode on a task: 1 on, 0 off, null for a task from before it (D-94).
function addTaskEfficient(db: DatabaseSync): void {
  const has = db.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'efficient'");
  if (has.get() === undefined) db.exec("ALTER TABLE tasks ADD COLUMN efficient INTEGER");
}

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column) !==
  undefined;

// Milestones for a goal and its parts, and how each part went back and forth (D-95).
const NEVER_EDIT =
  "Never edit the project's files. For each problem, give the exact steps to see it.";

// The starters have no model: the user picks one when first sending work to each.
const STARTER_REVIEWERS: [string, string, string][] = [
  [
    "Code reviewer",
    "Finds bugs, edge cases and unclear code in the changes.",
    `Read the changes and run the checklist. Look for bugs, unclear names, missing error handling and edge cases the checklist does not cover. ${NEVER_EDIT}`,
  ],
  [
    "Tester",
    "Runs the build and tests, and reports each failure.",
    `Find how the project builds and tests, run both, and report each failure with its output. Then run the checklist. ${NEVER_EDIT}`,
  ],
  [
    "UI tester",
    "Uses the app in a browser at desktop and phone sizes.",
    `Start the app, open it in a browser and walk through every screen the work touched, at desktop and phone widths. Report broken layouts, console errors and steps that do not work. ${NEVER_EDIT}`,
  ],
  [
    "Security reviewer",
    "Looks for leaked secrets, unsafe input and risky packages.",
    `Look for exposed secrets, unchecked input, injection, unsafe file or shell use, and new packages with known problems. Rate each finding high, medium or low. ${NEVER_EDIT}`,
  ],
  [
    "Proofreader",
    "Checks spelling, grammar and tone.",
    `Read every text, document and interface label the work changed. Report spelling, grammar, unclear wording and tone that does not fit. ${NEVER_EDIT}`,
  ],
];

function addReviewers(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS reviewers (
    ref          INTEGER PRIMARY KEY,
    id           TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL,
    instructions TEXT NOT NULL,
    -- JSON: the agent settings, absent until a model is picked.
    settings     TEXT,
    created_at   INTEGER NOT NULL
  ) STRICT;
  `);
  const insert = db.prepare(
    "INSERT INTO reviewers (id, name, description, instructions, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  STARTER_REVIEWERS.forEach(([name, description, instructions], index) => {
    insert.run(randomUUID(), name, description, instructions, now + index);
  });
}

// Starters made by a pre-release build of D-101 take their released names, unless edited.
const STARTER_RENAMES: [string, string, string, string][] = [
  [
    "Code review",
    "Reads the changes for bugs, unclear code and missing edge cases.",
    "Code reviewer",
    "Finds bugs, edge cases and unclear code in the changes.",
  ],
  [
    "Run the tests",
    "Runs the project's build and tests, then reports each failure.",
    "Tester",
    "Runs the build and tests, and reports each failure.",
  ],
  [
    "UI check in the browser",
    "Opens the app in a browser and walks through each screen.",
    "UI tester",
    "Uses the app in a browser at desktop and phone sizes.",
  ],
  [
    "Security pass",
    "Looks for exposed secrets, unsafe input handling and risky packages.",
    "Security reviewer",
    "Looks for leaked secrets, unsafe input and risky packages.",
  ],
  [
    "Proofread",
    "Checks wording, spelling and tone in text and documents.",
    "Proofreader",
    "Checks spelling, grammar and tone.",
  ],
];

function renameStarterReviewers(db: DatabaseSync): void {
  const rename = db.prepare(
    "UPDATE reviewers SET name = ?, description = ? WHERE name = ? AND description = ?",
  );
  for (const [oldName, oldDescription, name, description] of STARTER_RENAMES) {
    rename.run(name, description, oldName, oldDescription);
  }
}

function addMilestones(db: DatabaseSync): void {
  if (!hasColumn(db, "tasks", "milestones")) {
    db.exec("ALTER TABLE tasks ADD COLUMN milestones INTEGER");
  }
  const parts: [string, string][] = [
    ["title", "TEXT"],
    // JSON: the send-backs as the contract has them.
    ["send_backs", "TEXT"],
    ["send_back_limit", "INTEGER"],
    ["accepted", "TEXT CHECK (accepted IN ('new', 'seen'))"],
  ];
  for (const [column, type] of parts) {
    if (!hasColumn(db, "delegations", column)) {
      db.exec(`ALTER TABLE delegations ADD COLUMN ${column} ${type}`);
    }
  }
  db.exec(`
  CREATE TABLE IF NOT EXISTS milestones (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    task_ref       INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    -- Agents name it as "M" and this number, unique in its task.
    number         INTEGER NOT NULL,
    delegation_ref INTEGER REFERENCES delegations (ref) ON DELETE CASCADE,
    -- Kept when its chief's goal is deleted: by then they are the department task's own.
    piece_ref      INTEGER REFERENCES plan_pieces (ref) ON DELETE SET NULL,
    outcome        TEXT NOT NULL,
    see            TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('not_started', 'met', 'not_met')),
    proof          TEXT,
    -- Agent ids, or "user": agents can be deleted with another task.
    reported_by    TEXT,
    origin         TEXT NOT NULL CHECK (origin IN ('agent', 'user')),
    changed_by     TEXT,
    told_agent     TEXT,
    delivery       TEXT CHECK (delivery IN ('telling', 'taken')),
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS milestones_by_task ON milestones (task_ref, number);
  CREATE INDEX IF NOT EXISTS milestones_by_delegation ON milestones (delegation_ref);
  CREATE INDEX IF NOT EXISTS milestones_by_piece ON milestones (piece_ref);
  `);
}

// A lead's checklist on its task, and the rounds of checking it (D-73).
function addChecks(db: DatabaseSync): void {
  const has = db.prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'checklist'");
  if (has.get() === undefined) db.exec("ALTER TABLE tasks ADD COLUMN checklist TEXT");
  db.exec(`
  CREATE TABLE IF NOT EXISTS checks (
    ref             INTEGER PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,
    task_ref        INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    round           INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK (status IN
                      ('drafting', 'approving', 'running', 'done', 'stopped', 'failed')),
    checker_ref     INTEGER NOT NULL REFERENCES agents (ref),
    checker_session TEXT NOT NULL,
    owner_ref       INTEGER NOT NULL REFERENCES agents (ref),
    -- JSON: items, results and notes as the contract has them.
    items           TEXT NOT NULL,
    sandbox_kind    TEXT NOT NULL CHECK (sandbox_kind IN ('worktree', 'copy')),
    results         TEXT,
    notes           TEXT,
    -- JSON: where the sandbox is and how to remove it. Cleared once it is gone.
    sandbox         TEXT,
    created_at      INTEGER NOT NULL,
    ended_at        INTEGER
  ) STRICT;

  CREATE INDEX IF NOT EXISTS checks_by_task ON checks (task_ref);
  CREATE INDEX IF NOT EXISTS checks_by_session ON checks (checker_session);
  CREATE INDEX IF NOT EXISTS checks_by_checker ON checks (checker_ref);
  CREATE INDEX IF NOT EXISTS checks_by_owner ON checks (owner_ref);
  CREATE INDEX IF NOT EXISTS checks_with_sandbox ON checks (ref) WHERE sandbox IS NOT NULL;
  CREATE INDEX IF NOT EXISTS checks_open ON checks (status)
    WHERE status IN ('drafting', 'approving', 'running');
  `);
}

function addOutputs(db: DatabaseSync): void {
  db.exec(`
  -- Results agents showed the user (M8). Versions are JSON as the contract has them; their copies
  -- live in outputs/<id>/ beside the database.
  CREATE TABLE IF NOT EXISTS outputs (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    task_ref    INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    agent_ref   INTEGER NOT NULL REFERENCES agents (ref),
    session_id  TEXT NOT NULL,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('file', 'site')),
    target      TEXT NOT NULL,
    versions    TEXT NOT NULL,
    pictured_at INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE (task_ref, kind, target)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS outputs_by_task ON outputs (task_ref, updated_at);
  CREATE INDEX IF NOT EXISTS outputs_by_agent ON outputs (agent_ref);
  CREATE INDEX IF NOT EXISTS outputs_by_time ON outputs (updated_at);
  `);
}

function addDepartmentWorkspaces(db: DatabaseSync): void {
  db.exec(`
  -- A department's workspaces besides its default, which stays departments.workspace_ref.
  CREATE TABLE IF NOT EXISTS department_workspaces (
    department_ref INTEGER NOT NULL REFERENCES departments (ref) ON DELETE CASCADE,
    position       INTEGER NOT NULL,
    workspace_ref  INTEGER NOT NULL REFERENCES workspaces (ref),
    PRIMARY KEY (department_ref, position),
    UNIQUE (department_ref, workspace_ref)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS department_workspaces_by_workspace
    ON department_workspaces (workspace_ref);
  `);
  const has = db.prepare(
    "SELECT 1 FROM pragma_table_info('plan_pieces') WHERE name = 'workspace_ref'",
  );
  if (has.get() !== undefined) return;
  // The workspace a piece for an existing department runs in; none means its default.
  db.exec(`
  ALTER TABLE plan_pieces ADD COLUMN workspace_ref INTEGER REFERENCES workspaces (ref)
    ON DELETE SET NULL;

  CREATE INDEX plan_pieces_by_workspace ON plan_pieces (workspace_ref)
    WHERE workspace_ref IS NOT NULL;
  `);
}

// The one retry and the results a lead is owed, kept across a restart (D-120).
function addRecoveryMarks(db: DatabaseSync): void {
  if (!hasColumn(db, "delegations", "retried")) {
    db.exec("ALTER TABLE delegations ADD COLUMN retried INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "delegations", "owed")) {
    db.exec("ALTER TABLE delegations ADD COLUMN owed INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "tasks", "lead_retried_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN lead_retried_at INTEGER");
  }
  db.exec("CREATE INDEX IF NOT EXISTS delegations_owed ON delegations (task_ref) WHERE owed = 1");
}

// When a close, crash or pause cut a session off, so Home's card can tell new stops from old ones
// (D-122). Sessions cut off before this have none and stay off the card.
function addCutOffTimes(db: DatabaseSync): void {
  if (!hasColumn(db, "sessions", "interrupted_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN interrupted_at INTEGER");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS sessions_cut_off ON sessions (interrupted_at) WHERE status = 'interrupted'",
  );
}

// Automations and their runs (D-125). The queue's entries are rebuilt, as a run waits before its
// task exists; an earlier launch's entries are dropped at start anyway.
function addAutomations(db: DatabaseSync): void {
  if (!hasColumn(db, "tasks", "origin")) db.exec("ALTER TABLE tasks ADD COLUMN origin TEXT");
  db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    fields      TEXT NOT NULL,
    paused      TEXT,
    next_run_at INTEGER,
    failures    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS automations_due ON automations (next_run_at)
    WHERE next_run_at IS NOT NULL;

  -- (automation, scheduled_for) is a run's key: written before it starts, never fired twice.
  CREATE TABLE IF NOT EXISTS automation_runs (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    automation_ref INTEGER NOT NULL REFERENCES automations (ref) ON DELETE CASCADE,
    number         INTEGER NOT NULL,
    scheduled_for  INTEGER NOT NULL,
    by             TEXT NOT NULL,
    status         TEXT NOT NULL,
    reason         TEXT,
    missed         INTEGER,
    depth          INTEGER NOT NULL,
    wait_until     INTEGER,
    task_ref       INTEGER REFERENCES tasks (ref) ON DELETE SET NULL,
    created_at     INTEGER NOT NULL,
    ended_at       INTEGER
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS runs_key ON automation_runs (automation_ref, scheduled_for);
  CREATE UNIQUE INDEX IF NOT EXISTS runs_by_number ON automation_runs (automation_ref, number);
  CREATE INDEX IF NOT EXISTS runs_waiting ON automation_runs (status) WHERE status = 'waiting';
  CREATE INDEX IF NOT EXISTS runs_by_task ON automation_runs (task_ref) WHERE task_ref IS NOT NULL;
  CREATE INDEX IF NOT EXISTS runs_open ON automation_runs (created_at) WHERE ended_at IS NULL;

  -- Files an automation sends with every run, kept while it exists.
  CREATE TABLE IF NOT EXISTS automation_files (
    automation_ref INTEGER NOT NULL REFERENCES automations (ref) ON DELETE CASCADE,
    attachment_ref INTEGER NOT NULL REFERENCES attachments (ref) ON DELETE CASCADE,
    PRIMARY KEY (automation_ref, attachment_ref)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS automation_files_by_file ON automation_files (attachment_ref);

  DROP TABLE IF EXISTS queue_entries;
  CREATE TABLE queue_entries (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,
    task_ref    INTEGER REFERENCES tasks (ref) ON DELETE CASCADE,
    run_ref     INTEGER REFERENCES automation_runs (ref) ON DELETE CASCADE,
    launch      TEXT NOT NULL,
    state       TEXT NOT NULL CHECK (state IN ('waiting', 'started', 'skipped', 'cancelled')),
    reason      TEXT,
    enqueued_at INTEGER NOT NULL,
    wait_until  INTEGER NOT NULL,
    CHECK (task_ref IS NOT NULL OR run_ref IS NOT NULL)
  ) STRICT;

  CREATE UNIQUE INDEX queue_once_a_launch ON queue_entries (kind, task_ref, launch)
    WHERE task_ref IS NOT NULL AND run_ref IS NULL;
  CREATE UNIQUE INDEX queue_run_once_a_launch ON queue_entries (run_ref, launch)
    WHERE run_ref IS NOT NULL;
  CREATE INDEX queue_waiting ON queue_entries (enqueued_at) WHERE state = 'waiting';
  CREATE INDEX queue_by_task ON queue_entries (task_ref);
  `);
}

// Resumes started since the task's top agent last finished a turn, to stop a crash loop (D-122).
function addResumeAttempts(db: DatabaseSync): void {
  if (!hasColumn(db, "tasks", "resume_attempts")) {
    db.exec("ALTER TABLE tasks ADD COLUMN resume_attempts INTEGER NOT NULL DEFAULT 0");
  }
}

// What starts a run from outside (D-128). One row per thing seen, kept 30 days so it never starts
// a second run; its text only until its run starts.
function addAutomationEvents(db: DatabaseSync): void {
  if (!hasColumn(db, "automations", "source_state")) {
    db.exec("ALTER TABLE automations ADD COLUMN source_state TEXT");
    db.exec("ALTER TABLE automations ADD COLUMN last_look TEXT");
  }
  if (!hasColumn(db, "automation_runs", "events")) {
    db.exec("ALTER TABLE automation_runs ADD COLUMN events INTEGER");
  }
  db.exec(`
  CREATE TABLE IF NOT EXISTS automation_events (
    ref            INTEGER PRIMARY KEY,
    automation_ref INTEGER NOT NULL REFERENCES automations (ref) ON DELETE CASCADE,
    key            TEXT NOT NULL,
    at             INTEGER NOT NULL,
    seen_at        INTEGER NOT NULL,
    text           TEXT,
    depth          INTEGER NOT NULL,
    pending        INTEGER NOT NULL,
    run_ref        INTEGER REFERENCES automation_runs (ref) ON DELETE SET NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS automation_events_key ON automation_events (automation_ref, key);
  CREATE INDEX IF NOT EXISTS automation_events_pending ON automation_events (automation_ref, ref)
    WHERE pending = 1;
  CREATE INDEX IF NOT EXISTS automation_events_by_run ON automation_events (run_ref)
    WHERE run_ref IS NOT NULL;
  CREATE INDEX IF NOT EXISTS automation_events_seen ON automation_events (seen_at);
  `);
}

// A progress update belongs to its card and a picture to its update, so a card's history never
// mixes with another card of the same task and goes only with its own card (D-141).
function createProgressTables(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS progress_updates (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    post_ref   INTEGER NOT NULL REFERENCES feed_posts (ref) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    search     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS progress_by_post ON progress_updates (post_ref, ref);

  -- Copied from the work folder, so it outlives the file.
  CREATE TABLE IF NOT EXISTS progress_images (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    update_ref INTEGER NOT NULL UNIQUE REFERENCES progress_updates (ref) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    bytes      BLOB NOT NULL
  ) STRICT;

  -- What happened in a task that earns its next update, once per thing, so a restart or a repeated
  -- change never makes something old count as new.
  CREATE TABLE IF NOT EXISTS progress_marks (
    ref      INTEGER PRIMARY KEY,
    task_ref INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    key      TEXT NOT NULL,
    after    TEXT NOT NULL,
    at       INTEGER NOT NULL,
    UNIQUE (task_ref, key)
  ) STRICT;
  `);
}

function addProgressUpdates(db: DatabaseSync): void {
  if (!hasColumn(db, "tasks", "updates")) db.exec("ALTER TABLE tasks ADD COLUMN updates INTEGER");
  createProgressTables(db);
}

// A store from a test build kept updates by task: each moves to the card that showed it.
function tieUpdatesToCards(db: DatabaseSync): void {
  if (hasColumn(db, "progress_updates", "post_ref")) return;
  db.exec(`
  ALTER TABLE progress_updates RENAME TO old_updates;
  ALTER TABLE progress_images RENAME TO old_images;
  ALTER TABLE progress_marks RENAME TO old_marks;
  `);
  createProgressTables(db);
  db.exec(`
  INSERT INTO progress_updates (id, post_ref, data, search, created_at)
    SELECT o.id, p.ref, o.data, o.search, o.created_at FROM old_updates o
    JOIN feed_posts p ON p.ref = (
      SELECT ref FROM feed_posts WHERE task_ref = o.task_ref AND json_extract(data, '$.update') IS NOT NULL
      ORDER BY created_at DESC, ref DESC LIMIT 1)
    ORDER BY o.created_at, o.ref;
  INSERT INTO progress_images (id, update_ref, type, bytes)
    SELECT i.id, u.ref, i.type, i.bytes FROM old_images i
    JOIN progress_updates u ON json_extract(u.data, '$.image.id') = i.id;
  INSERT INTO progress_marks (task_ref, key, after, at)
    SELECT task_ref, 'earlier', after, at FROM old_marks;
  UPDATE feed_posts SET data = json_set(data, '$.updates',
      (SELECT count(*) FROM progress_updates u WHERE u.post_ref = feed_posts.ref))
    WHERE ref IN (SELECT post_ref FROM progress_updates);
  DROP TABLE old_images;
  DROP TABLE old_updates;
  DROP TABLE old_marks;
  `);
}

// The mark each update used, so a mark recorded after it is new whatever the clock says; and a
// finished card with updates kept 30 days from its last change, as test builds kept it otherwise.
function addUpdateMarks(db: DatabaseSync): void {
  if (!hasColumn(db, "progress_updates", "mark_ref")) {
    db.exec("ALTER TABLE progress_updates ADD COLUMN mark_ref INTEGER");
  }
  db.exec(`
  UPDATE feed_posts SET expires_at = updated_at + 30 * 86400000
    WHERE state <> 'open' AND ref IN (SELECT post_ref FROM progress_updates)`);
}

// Results sent out, quiet runs and notes kept across runs (D-130, D-131, D-133). Destinations hold no
// key: keys stay in the credential store. The outbox is written before a send, under a key, so a
// message goes out once, and a restart sends what waited.
function addAutomationDelivery(db: DatabaseSync): void {
  if (!hasColumn(db, "automations", "notes")) {
    db.exec("ALTER TABLE automations ADD COLUMN notes TEXT");
    db.exec("ALTER TABLE automations ADD COLUMN send_failures TEXT");
  }
  if (!hasColumn(db, "automation_runs", "quiet")) {
    db.exec("ALTER TABLE automation_runs ADD COLUMN quiet INTEGER");
  }
  if (!hasColumn(db, "automation_runs", "delivery")) {
    db.exec("ALTER TABLE automation_runs ADD COLUMN delivery TEXT");
  }
  if (!hasColumn(db, "tasks", "send_result")) {
    db.exec("ALTER TABLE tasks ADD COLUMN send_result INTEGER");
    db.exec("ALTER TABLE tasks ADD COLUMN delivery TEXT");
  }
  db.exec(`
  CREATE TABLE IF NOT EXISTS destinations (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    settings    TEXT NOT NULL,
    problem     TEXT,
    link        TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS outbox (
    ref             INTEGER PRIMARY KEY,
    destination_ref INTEGER NOT NULL REFERENCES destinations (ref) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    automation_id   TEXT,
    run_id          TEXT,
    task_id         TEXT,
    message         TEXT NOT NULL,
    state           TEXT NOT NULL CHECK (state IN ('waiting', 'sent', 'failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_at         INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS outbox_key ON outbox (destination_ref, key);
  CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_at) WHERE state = 'waiting';
  CREATE INDEX IF NOT EXISTS outbox_by_time ON outbox (created_at);
  `);
}

// A call outlives its task and session (kept 90 days), so it names them by id too.
function keepConnectorCalls(db: DatabaseSync): void {
  if (hasColumn(db, "connector_calls", "task_id")) return;
  db.exec(`
  CREATE TABLE connector_calls_kept (
    ref            INTEGER PRIMARY KEY,
    id             TEXT NOT NULL UNIQUE,
    connector_ref  INTEGER NOT NULL REFERENCES connectors (ref) ON DELETE CASCADE,
    session_ref    INTEGER REFERENCES sessions (ref) ON DELETE SET NULL,
    task_id        TEXT NOT NULL,
    agent_id       TEXT NOT NULL,
    department_ref INTEGER REFERENCES departments (ref) ON DELETE SET NULL,
    tool           TEXT NOT NULL,
    input          TEXT NOT NULL,
    change         INTEGER NOT NULL,
    outcome        TEXT NOT NULL CHECK (outcome IN ('done', 'refused', 'failed', 'asked')),
    at             INTEGER NOT NULL
  ) STRICT;

  INSERT INTO connector_calls_kept
  SELECT c.ref, c.id, c.connector_ref, c.session_ref, t.id, ag.id, c.department_ref, c.tool, c.input, c.change,
    c.outcome, c.at
  FROM connector_calls c
  JOIN sessions s ON s.ref = c.session_ref
  JOIN tasks t ON t.ref = s.task_ref
  JOIN agents ag ON ag.ref = s.agent_ref;

  DROP TABLE connector_calls;
  ALTER TABLE connector_calls_kept RENAME TO connector_calls;

  CREATE INDEX connector_calls_by_connector ON connector_calls (connector_ref, at);
  CREATE INDEX connector_calls_by_session ON connector_calls (session_ref);
  CREATE INDEX connector_calls_by_department ON connector_calls (department_ref);
  CREATE INDEX connector_calls_by_time ON connector_calls (at);
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
  addDepartmentWorkspaces,
  `
  -- Usage recounted after a session ends sums with its turns (registry/recount.ts).
  DROP INDEX IF EXISTS events_turns_by_time;
  CREATE INDEX IF NOT EXISTS events_usage_by_time ON events (timestamp)
    WHERE type IN ('turn.ended', 'usage.recounted');
  CREATE INDEX IF NOT EXISTS events_usage ON events (session_ref)
    WHERE type IN ('turn.ended', 'usage.recounted');
  CREATE INDEX IF NOT EXISTS sessions_by_conversation ON sessions (harness_session_id)
    WHERE harness_session_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS sessions_by_end ON sessions (ended_at);
  `,
  addTaskPause,
  addChecks,
  addOutputs,
  restoreScratch,
  "CREATE INDEX IF NOT EXISTS sessions_interrupted ON sessions (status) WHERE status = 'interrupted';",
  dropScratchBesideFolders,
  addTaskTitle,
  addTaskEfficient,
  addMilestones,
  addReviewers,
  renameStarterReviewers,
  addRecoveryMarks,
  `
  -- What the core decided deserves an alert (D-124); kept 30 days, at most 500.
  CREATE TABLE IF NOT EXISTS notices (
    ref        INTEGER PRIMARY KEY,
    id         TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL,
    task_ref   INTEGER REFERENCES tasks (ref) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS notices_by_time ON notices (created_at);
  CREATE INDEX IF NOT EXISTS notices_by_kind ON notices (kind, created_at);
  CREATE INDEX IF NOT EXISTS notices_by_task ON notices (task_ref);
  `,
  `
  -- Starts no person typed, written before anything runs (D-121). One entry per start and launch.
  CREATE TABLE IF NOT EXISTS queue_entries (
    ref         INTEGER PRIMARY KEY,
    id          TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,
    task_ref    INTEGER NOT NULL REFERENCES tasks (ref) ON DELETE CASCADE,
    launch      TEXT NOT NULL,
    state       TEXT NOT NULL CHECK (state IN ('waiting', 'started', 'skipped', 'cancelled')),
    reason      TEXT,
    enqueued_at INTEGER NOT NULL,
    wait_until  INTEGER NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS queue_once_a_launch ON queue_entries (kind, task_ref, launch);
  CREATE INDEX IF NOT EXISTS queue_waiting ON queue_entries (enqueued_at) WHERE state = 'waiting';
  CREATE INDEX IF NOT EXISTS queue_by_task ON queue_entries (task_ref);
  `,
  addResumeAttempts,
  addCutOffTimes,
  addAutomations,
  addAutomationEvents,
  `
  -- The usage of a task removed by the core, such as an automation's check (D-128), so Usage
  -- still counts it. Kept a month: Usage reads a week at most.
  CREATE TABLE IF NOT EXISTS kept_usage (
    ref                 INTEGER PRIMARY KEY,
    account_id          TEXT NOT NULL,
    agent_id            TEXT NOT NULL,
    model               TEXT,
    at                  INTEGER NOT NULL,
    input_tokens        INTEGER NOT NULL,
    output_tokens       INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS kept_usage_at ON kept_usage (at);
  `,
  addAutomationDelivery,
  `
  -- Feed (D-137): the post as JSON, with the columns its page filters on. A key marks a post that
  -- still stands for one thing, such as a task at work or an ask.
  CREATE TABLE IF NOT EXISTS feed_posts (
    ref           INTEGER PRIMARY KEY,
    id            TEXT NOT NULL UNIQUE,
    key           TEXT UNIQUE,
    kind          TEXT NOT NULL,
    task_ref      INTEGER REFERENCES tasks (ref) ON DELETE CASCADE,
    department_id TEXT,
    fold_key      TEXT,
    state         TEXT NOT NULL,
    data          TEXT NOT NULL,
    search        TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    expires_at    INTEGER
  ) STRICT;

  CREATE INDEX IF NOT EXISTS feed_by_time ON feed_posts (created_at, ref);
  CREATE INDEX IF NOT EXISTS feed_by_kind ON feed_posts (kind, created_at);
  CREATE INDEX IF NOT EXISTS feed_by_task ON feed_posts (task_ref, kind, created_at);
  CREATE INDEX IF NOT EXISTS feed_by_fold ON feed_posts (fold_key, created_at)
    WHERE fold_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS feed_by_expiry ON feed_posts (expires_at) WHERE expires_at IS NOT NULL;
  `,
  addProgressUpdates,
  tieUpdatesToCards,
  addUpdateMarks,
  `
  -- What Feed has told once ever, such as a milestone met, so a restart never posts it twice.
  CREATE TABLE IF NOT EXISTS feed_told (
    key TEXT PRIMARY KEY,
    at  INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS feed_told_by_age ON feed_told (at);
  -- A task's newest mark, read at each update, without a sort.
  CREATE INDEX IF NOT EXISTS progress_marks_by_task ON progress_marks (task_ref, ref);
  `,
  `
  -- Raw CLI lines are no longer kept: nothing read them, and the CLIs keep their own records.
  DROP TABLE IF EXISTS harness_lines;
  -- A task's sessions by agent, for its lead's latest status in the task search.
  CREATE INDEX IF NOT EXISTS sessions_by_task_agent ON sessions (task_ref, agent_ref);
  -- The last 30 days of tasks, for the same request asked on different days (D-139).
  CREATE INDEX IF NOT EXISTS tasks_by_created ON tasks (created_at);
  `,
  keepConnectorCalls,
];
