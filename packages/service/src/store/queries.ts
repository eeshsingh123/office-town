const TASK_SELECT = `
  SELECT t.ref, t.id, t.prompt, t.created_at AS createdAt, l.id AS leadAgentId,
         d.id AS departmentId, t.setup
  FROM tasks t
  LEFT JOIN agents l ON l.ref = t.lead_ref
  LEFT JOIN departments d ON d.ref = t.department_ref`;

const SESSION_SELECT = `
  SELECT s.ref, s.id, t.id AS taskId, a.id AS agentId, s.options, s.status,
         s.created_at AS createdAt, s.harness_session_id AS harnessSessionId,
         r.id AS resumedFrom, s.ended_at AS endedAt
  FROM sessions s
  JOIN tasks t ON t.ref = s.task_ref
  JOIN agents a ON a.ref = s.agent_ref
  LEFT JOIN sessions r ON r.ref = s.resumed_from_ref`;

const EVENT_SELECT = `
  SELECT e.position, s.id AS sessionId, e.sequence, e.id, e.type, e.timestamp, e.payload
  FROM events e
  JOIN sessions s ON s.ref = e.session_ref`;

const UNFINISHED = "status IN ('starting', 'running')";

const AGENT_SELECT = `
  SELECT a.ref, a.id, a.name, a.colour, a.role, a.purpose, d.id AS departmentId, a.autonomy,
         a.guest, p.id AS profileId, a.settings, a.created_at AS createdAt
  FROM agents a
  LEFT JOIN profiles p ON p.ref = a.profile_ref
  LEFT JOIN departments d ON d.ref = a.department_ref`;

const DEPARTMENT_SELECT = `
  SELECT d.ref, d.id, d.name, w.id AS workspaceId, d.autonomy, l.id AS leadAgentId,
         d.branch_per_worker AS branchPerWorker, d.code_flow AS codeFlow,
         d.created_at AS createdAt
  FROM departments d
  JOIN workspaces w ON w.ref = d.workspace_ref
  JOIN agents l ON l.ref = d.lead_ref`;

const DELEGATION_SELECT = `
  SELECT g.ref, g.id, t.id AS taskId, a.id AS workerAgentId, g.worker_session AS workerSessionId,
         g.brief, g.status, g.result, g.created_at AS createdAt, g.ended_at AS endedAt
  FROM delegations g
  JOIN tasks t ON t.ref = g.task_ref
  JOIN agents a ON a.ref = g.worker_ref`;

const PROFILE_COLUMNS = "ref, id, name, role, colour, settings, created_at AS createdAt";

const WORKSPACE_COLUMNS = "ref, id, name, folders, created_at AS createdAt, used_at AS usedAt";

// Every statement the store runs. The store test checks that none of them reads a whole table,
// except those marked as reading a small table whole.
export const queries = {
  insertTask: `
    INSERT INTO tasks (id, prompt, created_at, lead_ref, department_ref, setup)
    VALUES (?, ?, ?, ?, ?, ?)`,
  taskById: `${TASK_SELECT} WHERE t.id = ?`,
  tasksBefore: `${TASK_SELECT} WHERE t.ref < ? ORDER BY t.ref DESC LIMIT ?`,
  taskJoinsDepartment: "UPDATE tasks SET department_ref = ?, setup = NULL WHERE ref = ?",
  // A department works on one goal at a time: the one with an agent at work.
  activeTaskOfDepartment: `
    SELECT t.id FROM tasks t
    WHERE t.department_ref = ?
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.task_ref = t.ref AND s.${UNFINISHED})
    LIMIT 1`,
  deleteTask: "DELETE FROM tasks WHERE ref = ?",

  insertSession: `
    INSERT INTO sessions (id, task_ref, agent_ref, resumed_from_ref, options, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'starting', ?)`,
  sessionRef: "SELECT ref FROM sessions WHERE id = ?",
  sessionById: `${SESSION_SELECT} WHERE s.id = ?`,
  sessionsOfTask: `${SESSION_SELECT} WHERE s.task_ref = ? ORDER BY s.ref`,
  unfinishedInTask: `SELECT 1 FROM sessions WHERE task_ref = ? AND ${UNFINISHED} LIMIT 1`,
  unfinishedSessions: `${SESSION_SELECT} WHERE s.${UNFINISHED}`,
  interruptUnfinished: `UPDATE sessions SET status = 'interrupted' WHERE ${UNFINISHED}`,
  sessionStarted: "UPDATE sessions SET status = 'running', harness_session_id = ? WHERE ref = ?",
  sessionEnded: "UPDATE sessions SET status = ?, ended_at = ? WHERE ref = ?",

  agentsOfTask: "SELECT agent_ref AS ref FROM sessions WHERE task_ref = ?",

  insertAgent: `
    INSERT INTO agents
      (id, name, colour, role, purpose, department_ref, autonomy, guest, profile_ref, settings,
       created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  updateAgent: `
    UPDATE agents
    SET role = ?, purpose = ?, department_ref = ?, autonomy = ?, profile_ref = ?, settings = ?
    WHERE ref = ?`,
  membersOf: `${AGENT_SELECT} WHERE a.department_ref = ? ORDER BY a.ref`,
  agentById: `${AGENT_SELECT} WHERE a.id = ?`,
  agentNamed: "SELECT 1 FROM agents WHERE name = ?",
  // Reads the whole table on purpose: one row per agent, which the app shows together.
  allAgents: `${AGENT_SELECT} ORDER BY a.ref`,
  renameAgent: "UPDATE agents SET name = ? WHERE ref = ?",
  // An agent that worked on no other task, and is in no department, goes with its last task.
  deleteAgentIfUnused: `
    DELETE FROM agents
    WHERE ref = ? AND department_ref IS NULL
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE agent_ref = ?)`,

  insertDelegation: `
    INSERT INTO delegations
      (id, task_ref, worker_ref, worker_session, brief, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'working', ?)`,
  delegationsOfTask: `${DELEGATION_SELECT} WHERE g.task_ref = ? ORDER BY g.ref`,
  workingDelegationOf: `${DELEGATION_SELECT} WHERE g.worker_session = ? AND g.status = 'working'`,
  delegationRef: "SELECT ref FROM delegations WHERE id = ?",
  endDelegation: "UPDATE delegations SET status = ?, result = ?, ended_at = ? WHERE ref = ?",
  interruptDelegations: "UPDATE delegations SET status = 'interrupted' WHERE status = 'working'",

  insertDepartment: `
    INSERT INTO departments
      (id, name, workspace_ref, autonomy, lead_ref, branch_per_worker, code_flow, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  departmentById: `${DEPARTMENT_SELECT} WHERE d.id = ?`,
  // Reads the whole table on purpose: one row per department the user keeps.
  allDepartments: `${DEPARTMENT_SELECT} ORDER BY d.name`,
  updateDepartment: `
    UPDATE departments SET name = ?, autonomy = ?, branch_per_worker = ?, code_flow = ?
    WHERE ref = ?`,

  insertProfile: `
    INSERT INTO profiles (id, name, role, colour, settings, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  profileById: `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = ?`,
  // Reads the whole table on purpose: one row per profile the user saved.
  allProfiles: `SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY name`,
  updateProfile: "UPDATE profiles SET name = ?, role = ?, colour = ?, settings = ? WHERE ref = ?",
  deleteProfile: "DELETE FROM profiles WHERE ref = ?",

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
