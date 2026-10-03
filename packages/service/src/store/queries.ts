const TASK_COLUMNS = "ref, id, prompt, created_at AS createdAt";

const SESSION_SELECT = `
  SELECT s.ref, s.id, t.id AS taskId, s.options, s.status, s.created_at AS createdAt,
         s.harness_session_id AS harnessSessionId, r.id AS resumedFrom, s.ended_at AS endedAt
  FROM sessions s
  JOIN tasks t ON t.ref = s.task_ref
  LEFT JOIN sessions r ON r.ref = s.resumed_from_ref`;

const EVENT_SELECT = `
  SELECT e.position, s.id AS sessionId, e.sequence, e.id, e.type, e.timestamp, e.payload
  FROM events e
  JOIN sessions s ON s.ref = e.session_ref`;

const UNFINISHED = "status IN ('starting', 'running')";

const WORKSPACE_COLUMNS = "ref, id, name, folders, created_at AS createdAt, used_at AS usedAt";

// Every statement the store runs. The store test checks that none of them reads a whole table,
// except the two marked as reading a small table whole.
export const queries = {
  insertTask: "INSERT INTO tasks (id, prompt, created_at) VALUES (?, ?, ?)",
  taskById: `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`,
  tasksBefore: `SELECT ${TASK_COLUMNS} FROM tasks WHERE ref < ? ORDER BY ref DESC LIMIT ?`,
  deleteTask: "DELETE FROM tasks WHERE ref = ?",

  insertSession: `
    INSERT INTO sessions (id, task_ref, resumed_from_ref, options, status, created_at)
    VALUES (?, ?, ?, ?, 'starting', ?)`,
  sessionRef: "SELECT ref FROM sessions WHERE id = ?",
  sessionById: `${SESSION_SELECT} WHERE s.id = ?`,
  sessionsOfTask: `${SESSION_SELECT} WHERE s.task_ref = ? ORDER BY s.ref`,
  unfinishedInTask: `SELECT 1 FROM sessions WHERE task_ref = ? AND ${UNFINISHED} LIMIT 1`,
  unfinishedSessions: `${SESSION_SELECT} WHERE s.${UNFINISHED}`,
  interruptUnfinished: `UPDATE sessions SET status = 'interrupted' WHERE ${UNFINISHED}`,
  sessionStarted: "UPDATE sessions SET status = 'running', harness_session_id = ? WHERE ref = ?",
  sessionEnded: "UPDATE sessions SET status = ?, ended_at = ? WHERE ref = ?",

  insertEvent: `
    INSERT INTO events (session_ref, sequence, id, type, timestamp, payload)
    VALUES (?, ?, ?, ?, ?, ?)`,
  eventsAfter: `${EVENT_SELECT} WHERE e.position > ? ORDER BY e.position LIMIT ?`,
  sessionEventsAfter: `${EVENT_SELECT}
    WHERE e.session_ref = ? AND e.position > ? ORDER BY e.position LIMIT ?`,
  deleteSessionEvents: `
    DELETE FROM events WHERE position IN
      (SELECT position FROM events WHERE session_ref = ? LIMIT ?)`,

  // A request id seen again replaces its row: a failed write would stop the agent.
  insertPendingRequest: `
    INSERT OR REPLACE INTO pending_requests (event_position, session_ref, request_id)
    VALUES (?, ?, ?)`,
  deletePendingRequest: "DELETE FROM pending_requests WHERE session_ref = ? AND request_id = ?",
  deleteSessionPendingRequests: "DELETE FROM pending_requests WHERE session_ref = ?",
  deleteUnfinishedPendingRequests: `
    DELETE FROM pending_requests WHERE session_ref IN
      (SELECT ref FROM sessions WHERE ${UNFINISHED})`,
  // Reads the whole table on purpose: it holds only what is waiting now.
  pendingRequests: `
    SELECT e.position, s.id AS sessionId, t.id AS taskId, e.sequence, e.id, e.type, e.timestamp,
           e.payload
    FROM pending_requests p
    JOIN events e ON e.position = p.event_position
    JOIN sessions s ON s.ref = e.session_ref
    JOIN tasks t ON t.ref = s.task_ref
    ORDER BY p.event_position`,
  lastPosition: "SELECT max(position) AS position FROM events",

  insertWorkspace: `
    INSERT INTO workspaces (id, name, folders, created_at, used_at) VALUES (?, ?, ?, ?, ?)`,
  workspaceById: `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`,
  // Reads the whole table on purpose: one row per workspace the user saved.
  workspacesByUse: `SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY used_at DESC`,
  updateWorkspace: "UPDATE workspaces SET name = ?, folders = ? WHERE ref = ?",
  workspaceUsed: "UPDATE workspaces SET used_at = ? WHERE ref = ?",
  deleteWorkspace: "DELETE FROM workspaces WHERE ref = ?",

  settingByKey: "SELECT value FROM settings WHERE key = ?",
  saveSetting: `
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`,

  insertHarnessLine: `
    INSERT INTO harness_lines (session_ref, direction, line, full_bytes, timestamp)
    VALUES (?, ?, ?, ?, ?)`,
  deleteSessionHarnessLines: `
    DELETE FROM harness_lines WHERE position IN
      (SELECT position FROM harness_lines WHERE session_ref = ? LIMIT ?)`,
} as const;
