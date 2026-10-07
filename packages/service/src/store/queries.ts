const TASK_SELECT = `
  SELECT t.ref, t.id, t.prompt, t.created_at AS createdAt, l.id AS leadAgentId,
         d.id AS departmentId, p.id AS parentTaskId, t.setup, t.state, t.reviewed_at AS reviewedAt
  FROM tasks t
  LEFT JOIN agents l ON l.ref = t.lead_ref
  LEFT JOIN departments d ON d.ref = t.department_ref
  LEFT JOIN tasks p ON p.ref = t.parent_ref`;

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

const PIECE_SELECT = `
  SELECT pp.ref, pp.id, t.id AS taskId, pp.key, pp.title, d.id AS departmentId,
         pp.new_department AS newDepartment, pp.brief, pp.waits_on AS waitsOn, pp.status,
         pt.id AS pieceTaskId, pp.result, pp.created_at AS createdAt, pp.ended_at AS endedAt
  FROM plan_pieces pp
  JOIN tasks t ON t.ref = pp.task_ref
  LEFT JOIN departments d ON d.ref = pp.department_ref
  LEFT JOIN tasks pt ON pt.ref = pp.piece_task_ref`;

const PROFILE_COLUMNS = "ref, id, name, role, colour, settings, created_at AS createdAt";

const WORKSPACE_COLUMNS = "ref, id, name, folders, created_at AS createdAt, used_at AS usedAt";

// Every statement the store runs. The store test checks that none of them reads a whole table,
// except those marked as reading a small table whole.
export const queries = {
  insertTask: `
    INSERT INTO tasks (id, prompt, created_at, lead_ref, department_ref, setup, state, parent_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  taskById: `${TASK_SELECT} WHERE t.id = ?`,
  taskByRef: `${TASK_SELECT} WHERE t.ref = ?`,
  tasksBefore: `${TASK_SELECT} WHERE t.ref < ? ORDER BY t.ref DESC LIMIT ?`,
  taskJoinsDepartment: "UPDATE tasks SET department_ref = ?, setup = NULL WHERE ref = ?",
  // A department works on one goal at a time: the one that has not ended.
  activeTaskOfDepartment:
    "SELECT id FROM tasks WHERE department_ref = ? AND state <> 'ended' LIMIT 1",
  // The lead's goal that has started and not ended, such as the chief's one at a time.
  openTaskOfLead: `
    SELECT id FROM tasks WHERE lead_ref = ? AND state <> 'ended' AND state <> 'queued' LIMIT 1`,
  oldestQueuedTask: "SELECT id FROM tasks WHERE state = 'queued' ORDER BY ref LIMIT 1",
  // Leaving "ended" takes the goal up again, so its review is cleared.
  setTaskState: `
    UPDATE tasks SET state = ?1, reviewed_at = iif(?1 = 'ended', reviewed_at, NULL)
    WHERE ref = ?2 AND state <> ?1`,
  taskReviewed: "UPDATE tasks SET reviewed_at = ? WHERE ref = ?",
  usageOfTask: `
    SELECT harness, input_tokens AS inputTokens, output_tokens AS outputTokens,
           cached_input_tokens AS cachedInputTokens
    FROM task_usage WHERE task_ref = ? ORDER BY harness`,
  addTaskUsage: `
    INSERT INTO task_usage (task_ref, harness, input_tokens, output_tokens, cached_input_tokens)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (task_ref, harness) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens`,
  deleteTask: "DELETE FROM tasks WHERE ref = ?",

  insertSession: `
    INSERT INTO sessions (id, task_ref, agent_ref, resumed_from_ref, options, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'starting', ?)`,
  sessionRef: "SELECT ref FROM sessions WHERE id = ?",
  sessionTaskAndHarness: `
    SELECT task_ref AS taskRef, options ->> '$.harness' AS harness FROM sessions WHERE ref = ?`,
  sessionById: `${SESSION_SELECT} WHERE s.id = ?`,
  sessionsOfTask: `${SESSION_SELECT} WHERE s.task_ref = ? ORDER BY s.ref`,
  agentSessionsBefore: `
    ${SESSION_SELECT} WHERE s.agent_ref = ? AND s.ref < ? ORDER BY s.ref DESC LIMIT ?`,
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
  // An agent that worked on no other task, and is in no department, goes with its last task; the
  // chief stands without one.
  deleteAgentIfUnused: `
    DELETE FROM agents
    WHERE ref = ?1 AND department_ref IS NULL
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE agent_ref = ?1)
      AND NOT EXISTS
        (SELECT 1 FROM settings WHERE key = 'chiefAgentId' AND value = json_quote(agents.id))`,

  insertDelegation: `
    INSERT INTO delegations
      (id, task_ref, worker_ref, worker_session, brief, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'working', ?)`,
  delegationsOfTask: `${DELEGATION_SELECT} WHERE g.task_ref = ? ORDER BY g.ref`,
  workingDelegations: `${DELEGATION_SELECT} WHERE g.status = 'working'`,
  workingDelegationOf: `${DELEGATION_SELECT} WHERE g.worker_session = ? AND g.status = 'working'`,
  delegationById: `${DELEGATION_SELECT} WHERE g.id = ?`,
  endDelegation: "UPDATE delegations SET status = ?, result = ?, ended_at = ? WHERE ref = ?",
  interruptDelegations: "UPDATE delegations SET status = 'interrupted' WHERE status = 'working'",

  insertPiece: `
    INSERT INTO plan_pieces
      (id, task_ref, key, title, department_ref, new_department, brief, waits_on, status,
       created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
  pieceById: `${PIECE_SELECT} WHERE pp.id = ?`,
  piecesOfTask: `${PIECE_SELECT} WHERE pp.task_ref = ? ORDER BY pp.ref`,
  pieceOfPieceTask: `${PIECE_SELECT} WHERE pp.piece_task_ref = ?`,
  // In no order: the index serves the status, and the store orders the few rows itself.
  openPieces: `${PIECE_SELECT} WHERE pp.status IN ('waiting', 'queued', 'working')`,
  updatePiece: `
    UPDATE plan_pieces
    SET status = ?, department_ref = ?, piece_task_ref = ?, result = ?, ended_at = ?
    WHERE ref = ?`,

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
  latestTurnOfSession: `
    SELECT type, timestamp, payload ->> '$.outcome' AS outcome FROM events
    WHERE session_ref = ? AND type IN ('turn.started', 'turn.ended')
    ORDER BY position DESC LIMIT 1`,
  // The agent's own last words, leaving out those of a subagent it ran.
  lastAgentMessage: `
    SELECT payload ->> '$.text' AS text FROM events
    WHERE session_ref = ? AND type = 'message' AND payload ->> '$.role' = 'assistant'
      AND payload ->> '$.parentActionId' IS NULL
    ORDER BY position DESC LIMIT 1`,
  saveLimits: `
    INSERT INTO harness_limits (harness, limits, reported_at) VALUES (?, ?, ?)
    ON CONFLICT (harness) DO UPDATE SET limits = excluded.limits, reported_at = excluded.reported_at`,
  // Reads the whole table on purpose: one row per harness.
  allLimits:
    "SELECT harness, limits, reported_at AS reportedAt FROM harness_limits ORDER BY harness",
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
