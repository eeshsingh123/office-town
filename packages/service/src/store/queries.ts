const TASK_SELECT = `
  SELECT t.ref, t.id, t.prompt, t.created_at AS createdAt, l.id AS leadAgentId,
         d.id AS departmentId, p.id AS parentTaskId,
         (SELECT id FROM workspaces WHERE ref = t.workspace_ref) AS workspaceId, t.setup, t.state,
         t.reviewed_at AS reviewedAt,
         (SELECT json_group_array(a.id) FROM task_workers w JOIN agents a ON a.ref = w.agent_ref
          WHERE w.task_ref = t.ref) AS workerAgentIds
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
  SELECT d.ref, d.id, d.name, (SELECT id FROM workspaces WHERE ref = d.workspace_ref) AS workspaceId,
         -- [position, id] pairs, put in order by the store.
         (SELECT json_group_array(
            json_array(dw.position, (SELECT id FROM workspaces WHERE ref = dw.workspace_ref)))
          FROM department_workspaces dw WHERE dw.department_ref = d.ref) AS moreWorkspaceIds,
         d.autonomy, l.id AS leadAgentId,
         d.branch_per_worker AS branchPerWorker, d.code_flow AS codeFlow, d.rules,
         d.purpose, d.removed_at AS removedAt, d.created_at AS createdAt
  FROM departments d
  JOIN agents l ON l.ref = d.lead_ref`;

const DELEGATION_SELECT = `
  SELECT g.ref, g.id, t.id AS taskId, a.id AS workerAgentId, g.worker_session AS workerSessionId,
         g.brief, g.status, g.result, g.created_at AS createdAt, g.ended_at AS endedAt
  FROM delegations g
  JOIN tasks t ON t.ref = g.task_ref
  JOIN agents a ON a.ref = g.worker_ref`;

const PIECE_SELECT = `
  SELECT pp.ref, pp.id, t.id AS taskId, pp.key, pp.title, d.id AS departmentId,
         (SELECT id FROM workspaces WHERE ref = pp.workspace_ref) AS workspaceId,
         pp.new_department AS newDepartment, pp.brief, pp.waits_on AS waitsOn, pp.status,
         pt.id AS pieceTaskId, pp.result, pp.created_at AS createdAt, pp.ended_at AS endedAt
  FROM plan_pieces pp
  JOIN tasks t ON t.ref = pp.task_ref
  LEFT JOIN departments d ON d.ref = pp.department_ref
  LEFT JOIN tasks pt ON pt.ref = pp.piece_task_ref`;

// A session's account; one from before accounts ran on its harness's default login (D-61).
const SESSION_ACCOUNT = `coalesce(
  s.options ->> '$.accountId',
  CASE WHEN s.options ->> '$.environment.kind' = 'wsl'
    THEN (s.options ->> '$.harness') || '@' || (s.options ->> '$.environment.distro')
    ELSE s.options ->> '$.harness' END)`;

const ACCOUNT_COLUMNS = "id, harness, environment, name, folder, created_at AS createdAt";

const PROFILE_COLUMNS = "ref, id, name, role, colour, settings, created_at AS createdAt";

const WORKSPACE_COLUMNS =
  "ref, id, name, kind, folders, created_at AS createdAt, used_at AS usedAt";

const ATTACHMENT_COLUMNS = `
  ref, id, kind, name, path, bytes, mime_type AS mimeType, sha256, created_at AS createdAt`;

const LIBRARY_SELECT = `
  SELECT li.ref, li.id,
    (SELECT id FROM workspaces WHERE ref = li.workspace_ref) AS workspaceId, li.given_to AS givenTo, ag.id AS addedByAgentId,
    li.created_at AS createdAt, a.ref AS fileRef, a.id AS fileId, a.kind, a.name, a.path, a.bytes,
    a.mime_type AS mimeType, a.sha256, a.created_at AS fileCreatedAt,
    (SELECT count(*) FROM library_uses u WHERE u.item_ref = li.ref) AS givenIn,
    (SELECT count(u.opened_at) FROM library_uses u WHERE u.item_ref = li.ref) AS openedIn
  FROM library_items li
  JOIN attachments a ON a.ref = li.attachment_ref
  LEFT JOIN agents ag ON ag.ref = li.added_by_ref`;

const CONNECTOR_SELECT = `
  SELECT ref, id, setup, audience, permission, enabled, status, created_at AS createdAt
  FROM connectors`;

const CONNECTOR_CALL_SELECT = `
  SELECT c.ref AS position, c.id, (SELECT id FROM connectors WHERE ref = c.connector_ref) AS connectorId,
    ag.id AS agentId, t.id AS taskId, d.id AS departmentId, c.tool, c.input, c.change, c.outcome,
    c.at
  FROM connector_calls c
  JOIN sessions s ON s.ref = c.session_ref
  JOIN agents ag ON ag.ref = s.agent_ref
  JOIN tasks t ON t.ref = s.task_ref
  LEFT JOIN departments d ON d.ref = c.department_ref`;

// The store test checks that none reads a whole table, except those marked as reading a small one.
export const queries = {
  insertTask: `
    INSERT INTO tasks
      (id, prompt, created_at, lead_ref, department_ref, setup, state, parent_ref, workspace_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  insertTaskWorker: "INSERT INTO task_workers (task_ref, agent_ref) VALUES (?, ?)",
  taskById: `${TASK_SELECT} WHERE t.id = ?`,
  taskByRef: `${TASK_SELECT} WHERE t.ref = ?`,
  tasksBefore: `${TASK_SELECT} WHERE t.ref < ? ORDER BY t.ref DESC LIMIT ?`,
  taskJoinsDepartment: "UPDATE tasks SET department_ref = ?, setup = NULL WHERE ref = ?",
  activeTaskOfDepartment:
    "SELECT id FROM tasks WHERE department_ref = ? AND state <> 'ended' LIMIT 1",
  openTaskOfLead: `
    SELECT id FROM tasks WHERE lead_ref = ? AND state <> 'ended' AND state <> 'queued' LIMIT 1`,
  unendedTaskOfLead: "SELECT id FROM tasks WHERE lead_ref = ? AND state <> 'ended' LIMIT 1",
  oldestQueuedTask: "SELECT id FROM tasks WHERE state = 'queued' ORDER BY ref LIMIT 1",
  // Leaving "ended" clears the review.
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
  childTasks: "SELECT id FROM tasks WHERE parent_ref = ?",

  insertSession: `
    INSERT INTO sessions (id, task_ref, agent_ref, resumed_from_ref, options, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'starting', ?)`,
  sessionRef: "SELECT ref FROM sessions WHERE id = ?",
  sessionTaskAndHarness: `
    SELECT s.task_ref AS taskRef, s.options ->> '$.harness' AS harness,
           ${SESSION_ACCOUNT} AS accountId
    FROM sessions s WHERE s.ref = ?`,
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
    SET role = ?, purpose = ?, department_ref = ?, autonomy = ?, profile_ref = ?, settings = ?,
        colour = coalesce(?, colour)
    WHERE ref = ?`,
  membersOf: `${AGENT_SELECT} WHERE a.department_ref = ? ORDER BY a.ref`,
  agentById: `${AGENT_SELECT} WHERE a.id = ?`,
  agentNamed: "SELECT 1 FROM agents WHERE name = ?",
  // Reads the whole table on purpose: one row per agent, which the app shows together.
  allAgents: `${AGENT_SELECT} ORDER BY a.ref`,
  renameAgent: "UPDATE agents SET name = ? WHERE ref = ?",
  // The chief stands without a task.
  deleteAgentIfUnused: `
    DELETE FROM agents
    WHERE ref = ?1 AND department_ref IS NULL
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE agent_ref = ?1)
      AND NOT EXISTS (SELECT 1 FROM task_workers WHERE agent_ref = ?1)
      AND NOT EXISTS (SELECT 1 FROM departments WHERE lead_ref = ?1)
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
      (id, task_ref, key, title, department_ref, workspace_ref, new_department, brief, waits_on,
       status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
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
      (id, name, workspace_ref, autonomy, lead_ref, branch_per_worker, code_flow, rules, purpose,
       created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  departmentById: `${DEPARTMENT_SELECT} WHERE d.id = ?`,
  // Reads the whole table on purpose: one row per department the user keeps.
  allDepartments: `${DEPARTMENT_SELECT} WHERE d.removed_at IS NULL ORDER BY d.name`,
  updateDepartment: `
    UPDATE departments
    SET name = ?, autonomy = ?, branch_per_worker = ?, code_flow = ?, rules = ?, purpose = ?
    WHERE ref = ?`,
  setDepartmentWorkspace: "UPDATE departments SET workspace_ref = ? WHERE ref = ?",
  clearDepartmentWorkspaces: "DELETE FROM department_workspaces WHERE department_ref = ?",
  addDepartmentWorkspace: `
    INSERT INTO department_workspaces (department_ref, workspace_ref, position) VALUES (?, ?, ?)`,
  removeDepartment: "UPDATE departments SET removed_at = ? WHERE ref = ?",
  tasksOfDepartment: "SELECT id FROM tasks WHERE department_ref = ?",
  deleteDepartmentIfUnused: `
    DELETE FROM departments
    WHERE ref = ?1 AND removed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tasks WHERE department_ref = ?1)
      AND NOT EXISTS (SELECT 1 FROM plan_pieces WHERE department_ref = ?1)`,

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
  // The repeated type terms let the subqueries use the partial index on turns. An answer given
  // mid-turn, such as to Claude's own question, goes back into that turn, so only one after it counts.
  promptAfterTurn: `
    SELECT 1 FROM events
    WHERE session_ref = ?1
      AND ((type = 'message' AND payload ->> '$.role' = 'user'
            AND position > coalesce(
              (SELECT max(position) FROM events
               WHERE session_ref = ?1 AND type IN ('turn.started', 'turn.ended')
                 AND type = 'turn.started'),
              0))
        OR (type IN ('question.resolved', 'proposal.resolved', 'plan.resolved')
            AND position > coalesce(
              (SELECT max(position) FROM events
               WHERE session_ref = ?1 AND type IN ('turn.started', 'turn.ended')
                 AND type = 'turn.ended'),
              0)))
    LIMIT 1`,
  lastAgentMessage: `
    SELECT payload ->> '$.text' AS text FROM events
    WHERE session_ref = ? AND type = 'message' AND payload ->> '$.role' = 'assistant'
      AND payload ->> '$.parentActionId' IS NULL
    ORDER BY position DESC LIMIT 1`,
  saveLimits: `
    INSERT INTO account_limits (account_id, harness, limits, reported_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (account_id) DO UPDATE
    SET limits = excluded.limits, reported_at = excluded.reported_at`,
  // Reads the whole table on purpose: one row per account.
  allLimits: `
    SELECT account_id AS accountId, harness, limits, reported_at AS reportedAt
    FROM account_limits ORDER BY account_id`,
  accountUsageSince: `
    SELECT ${SESSION_ACCOUNT} AS accountId, a.id AS agentId, count(DISTINCT s.task_ref) AS tasks,
           sum(e.payload ->> '$.usage.inputTokens') AS inputTokens,
           sum(e.payload ->> '$.usage.outputTokens') AS outputTokens,
           coalesce(sum(e.payload ->> '$.usage.cachedInputTokens'), 0) AS cachedInputTokens
    FROM events e
    JOIN sessions s ON s.ref = e.session_ref
    JOIN agents a ON a.ref = s.agent_ref
    WHERE e.type IN ('turn.ended', 'usage.recounted') AND e.timestamp >= ?
      AND e.payload ->> '$.usage' IS NOT NULL
    GROUP BY 1, a.id
    ORDER BY outputTokens DESC`,
  conversationUsage: `
    SELECT coalesce(sum(e.payload ->> '$.usage.inputTokens'), 0) AS inputTokens,
           coalesce(sum(e.payload ->> '$.usage.outputTokens'), 0) AS outputTokens,
           coalesce(sum(e.payload ->> '$.usage.cachedInputTokens'), 0) AS cachedInputTokens
    FROM events e JOIN sessions s ON s.ref = e.session_ref
    WHERE s.harness_session_id = ? AND s.options ->> '$.harness' = ?
      AND e.type IN ('turn.ended', 'usage.recounted') AND e.payload ->> '$.usage' IS NOT NULL`,
  // Ended since then, with a turn after its last recount (or none yet).
  sessionsToRecount: `
    ${SESSION_SELECT}
    WHERE s.options ->> '$.harness' = ? AND s.harness_session_id IS NOT NULL
      AND s.status NOT IN ('starting', 'running') AND s.ended_at >= ?
      AND coalesce((SELECT max(position) FROM events WHERE session_ref = s.ref
                    AND type = 'turn.ended'), 0)
        > coalesce((SELECT max(position) FROM events WHERE session_ref = s.ref
                    AND type = 'usage.recounted'), 0)
    ORDER BY s.ended_at`,
  lastSequence: "SELECT coalesce(max(sequence), 0) AS sequence FROM events WHERE session_ref = ?",
  insertAccount: `
    INSERT INTO accounts (id, harness, environment, name, folder, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  // Reads the whole table on purpose: one row per login the user added.
  allAccounts: `SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY harness, created_at`,
  accountById: `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`,
  renameAccount: "UPDATE accounts SET name = ? WHERE id = ?",
  deleteAccount: "DELETE FROM accounts WHERE id = ?",
  lastPosition: "SELECT max(position) AS position FROM events",

  insertWorkspace: `
    INSERT INTO workspaces (id, name, kind, folders, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?)`,
  workspaceById: `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`,
  // Reads the whole table on purpose: one row per workspace the user saved.
  workspacesByUse: `SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY used_at DESC`,
  updateWorkspace: "UPDATE workspaces SET name = ?, kind = ?, folders = ? WHERE ref = ?",
  recentTasksOfWorkspace: `${TASK_SELECT} WHERE t.workspace_ref = ? ORDER BY t.ref DESC LIMIT 5`,
  taskCountOfWorkspace: "SELECT count(*) AS count FROM tasks WHERE workspace_ref = ?",
  openTasksOfWorkspace: "SELECT id FROM tasks WHERE workspace_ref = ? AND state <> 'ended'",
  workspaceUsed: "UPDATE workspaces SET used_at = ? WHERE ref = ?",
  deleteWorkspace: "DELETE FROM workspaces WHERE ref = ?",

  insertAttachment: `
    INSERT INTO attachments (id, kind, name, path, bytes, mime_type, sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  attachmentById: `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE id = ?`,
  latestAttachmentAt: `
    SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE path = ? ORDER BY ref DESC LIMIT 1`,
  linkAttachment: `
    INSERT OR IGNORE INTO task_attachments (task_ref, attachment_ref)
    SELECT ?, ref FROM attachments WHERE id = ?`,
  // Those no other task was sent too and the Library does not hold.
  attachmentsOnlyOfTask: `
    SELECT a.ref, a.id, a.kind FROM task_attachments ta
    JOIN attachments a ON a.ref = ta.attachment_ref
    WHERE ta.task_ref = ? AND NOT EXISTS (
      SELECT 1 FROM task_attachments o
      WHERE o.attachment_ref = ta.attachment_ref AND o.task_ref <> ta.task_ref)
      AND NOT EXISTS (SELECT 1 FROM library_items li WHERE li.attachment_ref = a.ref)`,
  unsentAttachments: `
    SELECT a.ref, a.id, a.kind FROM attachments a
    WHERE a.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.attachment_ref = a.ref)
      AND NOT EXISTS (SELECT 1 FROM library_items li WHERE li.attachment_ref = a.ref)`,
  attachmentSent: "SELECT 1 AS sent FROM task_attachments WHERE attachment_ref = ? LIMIT 1",
  attachmentsOfTask: `
    SELECT ${ATTACHMENT_COLUMNS} FROM attachments
    WHERE ref IN (SELECT attachment_ref FROM task_attachments WHERE task_ref = ?)
    ORDER BY ref`,
  deleteAttachment: "DELETE FROM attachments WHERE ref = ?",
  updateSessionOptions: "UPDATE sessions SET options = ? WHERE id = ?",

  insertLibraryItem: `
    INSERT INTO library_items (id, workspace_ref, attachment_ref, given_to, added_by_ref, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  allLibraryItems: `${LIBRARY_SELECT} ORDER BY li.ref`,
  libraryItemById: `${LIBRARY_SELECT} WHERE li.id = ?`,
  libraryItemOfFile: `${LIBRARY_SELECT} WHERE li.attachment_ref = ?`,
  libraryOfWorkspace: `${LIBRARY_SELECT} WHERE li.workspace_ref = ? ORDER BY li.ref`,
  libraryGivenTo: "UPDATE library_items SET given_to = ? WHERE ref = ?",
  libraryFile: "UPDATE library_items SET attachment_ref = ? WHERE ref = ?",
  deleteLibraryItem: "DELETE FROM library_items WHERE ref = ?",
  noteLibraryGiven: "INSERT OR IGNORE INTO library_uses (item_ref, task_ref) VALUES (?, ?)",
  libraryUnopenedIn: `
    SELECT li.id, a.kind, a.path FROM library_uses u
    JOIN library_items li ON li.ref = u.item_ref
    JOIN attachments a ON a.ref = li.attachment_ref
    WHERE u.task_ref = ? AND u.opened_at IS NULL`,
  noteLibraryOpened: `
    UPDATE library_uses SET opened_at = ?
    WHERE item_ref = ? AND task_ref = ? AND opened_at IS NULL`,

  insertConnector: `
    INSERT INTO connectors
      (id, slug, setup, audience, permission, enabled, status, tools, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  allConnectors: `${CONNECTOR_SELECT} ORDER BY ref`,
  connectorById: `${CONNECTOR_SELECT} WHERE id = ?`,
  connectorTools: "SELECT tools FROM connectors WHERE id = ?",
  updateConnector: `
    UPDATE connectors SET audience = ?, permission = ?, enabled = ?, status = ? WHERE ref = ?`,
  saveConnectorTools: "UPDATE connectors SET tools = ? WHERE ref = ?",
  deleteConnector: "DELETE FROM connectors WHERE ref = ?",
  insertConnectorCall: `
    INSERT INTO connector_calls
      (id, connector_ref, session_ref, department_ref, tool, input, change, outcome, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  connectorCallById: `${CONNECTOR_CALL_SELECT} WHERE c.id = ?`,
  endConnectorCall: "UPDATE connector_calls SET outcome = ? WHERE id = ?",
  // ?2 is the start of the week, ?3 the page's upper bound; NULL ?4 and ?5 mean no filter.
  connectorCallsBefore: `${CONNECTOR_CALL_SELECT}
    WHERE c.connector_ref = ?1 AND c.at >= ?2 AND c.ref < ?3
      AND (?4 IS NULL OR coalesce(d.id, 'none') = ?4) AND (?5 IS NULL OR c.change = 1)
    ORDER BY c.ref DESC LIMIT ?6`,
  connectorCallCounts: `
    SELECT d.id AS departmentId, count(*) AS count, sum(c.change) AS changes
    FROM connector_calls c LEFT JOIN departments d ON d.ref = c.department_ref
    WHERE c.connector_ref = ? AND c.at >= ?
    GROUP BY c.department_ref`,

  settingByKey: "SELECT value FROM settings WHERE key = ?",
  deleteSetting: "DELETE FROM settings WHERE key = ?",
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
