# Decisions

Only decisions that still guide upcoming work keep their why. Everything settled and built is one line under Done. Numbers are never reused.

## Guiding upcoming work

### D-15 Local SQLite event log behind a store interface — accepted (2026-10-03)

Every event is appended to one local SQLite file; current state and replay are both read from it. The core process keeps sessions running; no queue, broker or database server. The rest of the core reaches storage only through a small store interface.
Why: the app is single-user and local, so the data lives on the user's own machine and "scale" means one person's history, which SQLite handles far past what this app will write. A server database would have to be installed and run on every user's machine.
The interface is synchronous (owner, 2026-10-03): SQLite runs in-process and a write takes about 80 µs, so async would only add a queue to keep "stored before published" in order. Deleting is the one long operation, so it alone is async and runs in chunks. A hosted Postgres store, if it ever comes, changes the interface inside `packages/service` only.

### D-17 UI talks to the core over HTTP plus server-sent events — accepted (2026-10-03)

Commands and queries are HTTP requests; events flow over one SSE stream that resumes from `Last-Event-ID`, the store's event `position`. The contract's `sequence` counts within one session, so it cannot be the cursor of a stream that covers all sessions.
Why: the stream is one-way and commands are request/response; reconnect and catch-up are built in, and it is testable with curl.

### D-30 Store layout and indexing — accepted (2026-10-03)

- Node's built-in `node:sqlite`: no native module to rebuild for each Electron version. The Node that runs the core under Electron must include it.
- WAL, `synchronous=NORMAL`: an app crash loses nothing; a power cut can lose the last second of events (owner accepted).
- One core per data folder: the store holds its file exclusively, so a second core is refused instead of marking the first one's running agents interrupted.
- Every index serves a named query, and the store test fails if a query reads a whole table. Pages are read by key, never by `OFFSET`.
- Large results go to files beside the database; the event keeps a 4 KiB preview and `overflow`. A growing action output keeps only its tail, because the harness resends the whole output with each update.
- Migrations are never edited once merged; the file is copied before it is migrated, and a file from a newer app version is refused.
- No speculative storage: each table is added by the sub-module that uses it, with its own migration (owner: optimise for latency and size).

### D-31 Session registry rules — accepted (2026-10-03)

- Store, then publish. Listeners get the stored event, so a large result arrives as preview plus `overflow` live and in replay alike. Text fragments are published without a `position` and never stored.
- The registry changes sessions; reads (tasks, sessions, events) go straight to the store.
- Resuming needs a prompt, because a resumed harness waits for one. Any ended session with a harness session id can be resumed; the new session joins its task.
- A shutdown is recorded like a crash: running sessions are stopped and marked interrupted, so "stopped" always means the user stopped it.
- If the store fails, the agent is stopped and a fatal `error` (never stored) says its work could not be saved (owner: work that cannot be recorded cannot be traced). Its end is then saved once more, as `failed`, so a brief failure does not leave it "running" with stop and delete refused; if that fails too, the next start marks it interrupted.
- Partial raw lines are flagged by the adapter, which knows its wire format, and are not stored. For OpenCode the `message` event is the only full copy of its text.

### D-32 API rules — accepted (2026-10-03)

- Node's own `node:http` with a route table in `packages/service/src/api`, no framework: the contract already types the API and the table is short. Revisit if routes need shared middleware; only `src/api` would change.
- `127.0.0.1` only, with a random token per launch, sent as `Authorization: Bearer` on every request, the stream included. The browser's `EventSource` cannot send headers, so the UI reads the stream with `fetch` (M3.2). No CORS: the UI reaches the core through its own origin (D-36).
- The core prints one line on stdout, `{url, token}` (`coreReadySchema`); logs go to stderr.
- `GET /events`: `data` is the event, `id` its store position. Text fragments and unstored errors carry no id, so a reconnect skips them. It starts after `Last-Event-ID`, else `after`, else with new events only; `session=` limits it to one session. Live events are held while the store is read and repeats are dropped by position. A client more than 4 MiB or 10,000 held events behind is cut off and catches up from the store.
- `follow=false` makes a replay that ends once caught up. Chromium opens at most 6 connections to one host, so the UI keeps one live stream and replays sessions with `follow=false`; a stream per open view would block its own commands.
- Errors are `{error, message}` with a fixed code: 400 invalid, 401, 404, 409 for a session or task in the wrong state, 413 over 1 MiB, 502 when a harness cannot run.

### D-33 Workspaces and the blocked queue — accepted (2026-10-03)

- A workspace is saved and named (owner): an ordered list of folders reused across tasks; M4 departments point at one. The first folder is where the agent works; it may use the others as freely: Claude through `--add-dir`, OpenCode through an `external_directory` allow rule in its inline config, because OpenCode 1.18 does not offer ACP's `additionalDirectories`.
- With no workspace, each task gets a new folder named by the day and the prompt's first words inside the output folder, so tasks never overwrite each other (owner). An output folder given becomes the default; with none given and none kept, the start is refused so the UI asks. A session never runs in the core's own folder.
- A session's options keep the folders it ran in, so a resume runs where it started even after its workspace changes (D-28). A resume whose folder is gone is refused with the folder named, not left to fail inside the launch.
- A folder outside the workspace is guarded only by the harness's own permission request in `ask` mode; `bypass` has no guard. Core-level guardrails come with per-team autonomy in M4 (owner).
- The blocked queue holds permission requests and questions (owner). `pending_requests` points at the asking event; its row goes with the answer, the session's end, or the next start's interrupt. The list carries the store position it was read at, so the UI opens its stream from there.
- `POST /tasks` takes no folders and no `resumeSessionId`: a resume goes through `/sessions/:id/resume`, which refuses a conversation that is already running.

### D-34 Agents keep running in the tray — accepted (2026-10-04)

Closing the window hides it; the app and the core keep running in the tray, whose menu has Open and Quit. Quitting while agents run asks first; those agents are recorded as interrupted and can be continued. The shell runs the core on Electron's own Node (`ELECTRON_RUN_AS_NODE`; Electron 44 ships Node 24.21 with `node:sqlite` and type stripping, checked), so users install no Node. It stops the core by closing the core's stdin (the core watches it only when started with `--stop-when-stdin-closes`, so a core run from a script with no stdin does not stop at once); the core then shuts down as it does on SIGTERM. Only if it does not exit in 15 seconds is its process tree killed. The quit prompt counts open agents with `GET /tasks?active=true`.
Why the tray: the simplest way to keep agents running without the window. A detached core or an OS service adds a second lifecycle, and stays possible later because of D-2.
Why stdin: Windows cannot send SIGTERM to a child process, and a process-tree kill does not reach WSL agents (D-22); only the core knows how to stop those. A closed pipe also stops the core if the shell crashes, so no core is left running unseen.

### D-35 The office is the home screen — accepted (2026-10-04)

A top-down 2D office in which agents are characters at desks. You walk your own character up to an agent with the keyboard, or click the agent; both open the same side panel: purpose, task, step, current action, and any request. Dragging a box selects several agents; the panel lists them grouped. Single-user: no space shared with other people. The first version is the M3 office (one open floor); M4 and M5 add departments as rooms on the same frame, so the layout is never rebuilt. The floor shows open and waiting agents and those finished today; older ones are under Tasks. Arrow keys or WASD walk, E talks to the agent beside you, and "Open full trace" switches to the task view with a way back. A selection offers Stop all and Message all, never Approve all: each request is read before it is answered (owner).
Why now: the owner wants the office as the main screen; building M3's panels outside it would mean rebuilding the layout in the command center. Replaces D-9's "not a walk-up world" (owner, 2026-10-04).

### D-36 The UI reaches the core through its own origin — accepted (2026-10-04)

The UI calls relative `/api/...` paths. In the app, the shell serves the UI on an `app://` scheme and forwards `/api` to the core, adding the token. In browser development, Vite's proxy does the same.
Why: one code path in both places; the core needs no CORS (closes D-32's open point); the token never reaches the page, which shows text written by agents. Checked: an event stream passes through Electron's protocol handler without buffering. The main process is TypeScript run directly (D-19 holds). A preload, where needed, is a small plain-JS file, because sandboxed preloads do not strip types.

### D-37 UI building blocks and look — accepted (2026-10-04)

- React 19, Vite, Zustand. Radix primitives for menus, dialogs and tooltips, for correct keyboard and screen-reader behaviour; `cmdk` for the searchable model list; `react-markdown` for agent text, never raw HTML; lucide icons; Geist and Geist Mono shipped with the app, so it works offline.
- Styling: CSS Modules plus one tokens file of CSS variables. No Tailwind: styles read as plain CSS and every colour lives in one place.
- Look (owner accepted the mockups): warm greys; one blue accent for actions and running work; amber only for "needs you"; status as small icons and dots, never large fills; agent text 14 px, interface 13 px; light and dark follow the OS; reduced motion respected.
- Stream events are applied in batches, once per animation frame, or after 100 ms when the window gets no frames (hidden, covered or in the tray). Every task keeps its records (task, sessions, status); a full trace is loaded for each open agent, since the office shows its step and current action, and for each session the user opens. Replays run one at a time.
- An agent's name and colour come from its task's first session id, so a resumed agent keeps its name. A name is a handle like `@kai-0427`: one of 64 names and a four-digit number, so two agents rarely match; stored, unique names come with profiles in M4 (owner).

### D-38 The model list is ordered by what a model costs the user — accepted (2026-10-04)

A catalog model may carry `access`: `free`, `plan` (nothing beyond a subscription the user has) or `paid`. The adapter decides, since only it knows its harness's providers: OpenCode marks zero-cost models free and OpenCode Go models plan, and leaves out models that cannot call tools (image, video, speech), which no agent can use. The New task list shows Recent, Free, In your plan, then providers used before; other providers sit behind one row. OpenCode lists only the providers the user is connected to, so the app does not check logins; logging in from the app is deferred (owner).
Why: a zero-cost flag alone put image and speech models first and hid the subscription models the user already pays for.

### D-39 Team tools come from the core's own MCP server — accepted (2026-10-05), confirmed by the M4.1 spike

The core serves MCP and attaches it to each agent's session, with one token per session. Tools return at once; outcomes (a proposal answered, a worker finished) reach the agent later as a message from the core. The server is a small one of our own over HTTP on its own port: POST carries one JSON-RPC message and is answered with JSON, a notification gets 202, and GET gets 405 since the server never pushes. Both CLIs accept that; the official SDK is not needed.
Why: Claude Code and OpenCode both call MCP tools, so delegation works the same on every harness, and M6 connectors attach through the same seam. Tools that wait on a person or another agent would run into harness tool timeouts and block parallel work.

### D-41 What the M4.1 spike settled — accepted (2026-10-05)

Checked live with Claude Code 2.1.287 (haiku) and OpenCode 1.18.34 (a free model), natively and in WSL Ubuntu.
- Attaching: Claude takes `--mcp-config <json>` plus `--allowedTools mcp__office-town`, and asks nothing for those tools; it first loads them through its own ToolSearch step. OpenCode takes ACP's `mcpServers` (HTTP, headers as name/value pairs) in `session/new` and `session/resume`, and asks nothing for MCP tools; an allow rule for `office-town_*` keeps it so under a user's stricter config.
- WSL: WSL2 is in NAT mode on the owner's machine and cannot reach Windows' `127.0.0.1`. A WSL harness instead runs a stdio MCP server that is a Windows process (the core's own Node, through WSL interop) forwarding each line to the HTTP server. The token travels as an environment variable named in `WSLENV`, never on a command line. Claude's `--mcp-config` names it as `${OFFICE_TOWN_TOOL_TOKEN_n}`, which Claude fills from its own environment (checked live); harness lines are stored with the token masked. No WSL setting changes, so WSL agents can be leads (replaces D-40's fallback). Needs WSL interop, which is on by default.
- Isolation for outsourced agents: Claude's `--bare` accepts only an API key, never the subscription login, so it is out; `CLAUDE_CODE_SIMPLE` breaks the login the same way. `--setting-sources "" --strict-mcp-config --disable-slash-commands` keeps out the project's and the user's instruction files and settings, the user's MCP servers and skills; auto-memory is per folder, so a fresh copy has none: full isolation. OpenCode: `OPENCODE_PURE`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_EXTERNAL_SKILLS` leave its global config and global instructions loading: partial. For every harness, the copy itself leaves out instruction files (`AGENTS.md`, `CLAUDE.md`, `.claude`, `.opencode`).
- Worktrees: Windows git 2.34 writes an absolute `C:/` path into a worktree's `.git`, which WSL git cannot read. Relative worktree paths need git 2.48 on both sides and set a repository extension older git refuses. So a worktree is made and removed by the git of the environment its worker runs in; branches are shared, so the lead merges with its own git. Windows git lists a worktree made in WSL as "prunable"; it still works.
- Owner (2026-10-05): a department works on one goal at a time; a new goal starts each agent in a fresh conversation; "one branch per worker" is a department switch, on by default.

### D-40 Departments, proposals and autonomy — accepted (2026-10-05)

- Departments are saved and reused across goals, each a standing team with its own room (owner).
- The lead proposes the team as its first step; the user edits and approves it, and can add, remove or change members at any time after (owner).
- Autonomy has three levels: Supervised (every request asks), Trusted (reading and editing inside the workspace go ahead) and Full (everything goes ahead and is recorded). It replaces the permission mode for every agent, solo ones included. Bypass stays available with a clear warning, since it turns off every guard (owner).
- Outward actions (push, opening a PR, publishing) are allowed under Full and asked under the other levels (owner).
- In a git repository each worker gets its own worktree and branch, which the lead merges; otherwise the team shares the folder (owner).
- Outsourced agents work on a copy, never the original (owner).
- Agent memory is out of M4 and gets its own module after a deep dive (owner).
Why the lead proposes: it already has the goal and the workspace, and its reasoning stays in its own trace.

### D-42 Agents are stored records; profiles are followed — accepted (2026-10-05)

Every session belongs to an agent: a unique handle, a colour, a role and an optional department. An agent made from a profile follows the profile's later changes at its next session and keeps its own settings in case the profile is deleted. Settings flow department, then role, then agent; a profile or agent may lower its department's autonomy, never raise it.
Why: names and roles must survive resumes and new goals, and agent memory (its own module) will hang off this record.

### D-43 Tool server rules — accepted (2026-10-05)

- Its own port and one token per agent session, held for that launch only and never stored. The UI's token cannot reach it, nor an agent's token the API.
- Team tools are offered to a lead from its first session: a harness reads its tool list once, at launch.
- A request a tool makes (`ask_user`, `propose_team`) is stored and answered like a harness's own; the answer reaches the agent as a message.
- Calls to our tools get their trace title and kind from one shared rule (`trace/team-tools.ts`), never per adapter.
Why: M6 connectors attach through the same seam, so it must stay harness-neutral and tied to one agent per call.

### D-44 Delegation and results — accepted (2026-10-05)

A worker's result is its last message when a turn ends with nothing waiting on the user; it reaches the lead as a message from the core, and a lead left idle is resumed for it. A failed or stopped worker is reported the same way. Agents idle for 10 minutes are stopped and resumed when next needed. Stop team closes open delegations first, so no "stopped" result wakes the lead. After a restart, Continue resumes the lead with the delegations that were cut off.
Why: tools return at once (D-39), so the outcome has to arrive later, and only a turn's end says the work is finished.

### D-45 Autonomy is one policy in the core — accepted (2026-10-05)

Agents run in the harness's `ask` mode. The session attaches the action behind each request (its kind, the paths it touches, the command), whichever harness asked, and the core's policy answers what the level allows; anything it cannot read goes to the user. Under Trusted, changing git's or a harness's own settings (`.git`, `.claude`, `.opencode`, `opencode.json`, `.mcp.json`) always asks, since it could run a command later. A resume takes its harness mode from the agent's level now; a session already running in Bypass stays unguarded until it ends. Who answered is stored and shown. M3's permission modes map to Supervised, Trusted and Bypass.
Why: one guardrail for every harness (D-40). A new harness or connector only has to report its actions' kinds and paths.

### D-46 Worktrees are made by the worker's own git — accepted (2026-10-05)

With "one branch per worker" on and a git workspace, a worker starts in a worktree made from the lead's branch by the git of the worker's environment (D-41), kept in the data folder. It is removed once its branch is merged, nothing is left uncommitted and the worker has ended, or with its task; the branch stays. The code flow's push and pull request go through autonomy like any command.

### D-47 Outsourced agents are guests on a copy — accepted (2026-10-05)

A guest is an agent outside any department, working in the same task so it shows beside the team. It works on a copy of the chosen paths in the data folder, without instruction files, harness settings, `.git` or `node_modules`, under at most Trusted. `isolated` is kept with the session, so a resume stays isolated. Asked by the lead, its answer returns like a worker's result; asked by the user, its own trace is the answer. It leaves once it has answered. The user's second opinion examines the agent it is asked from, in that agent's own folder, so a worker's unmerged worktree can be reviewed; the copy goes with its task.
Why: a clean-slate review must not inherit the team's context or change its work (D-18, D-40).

### D-48 Departments are rooms on one floor — accepted (2026-10-05)

Every saved department has a room, with a desk per member in a fixed order (lead first), so an agent keeps its desk while the team stays the same; a member who leaves closes the gap. Rooms keep the order departments were made in. Agents working alone share the open floor; guests sit at the guest desk. Clicking a room's sign or walking in opens the department panel. A room's usage is labelled by goal: its members' new tokens in the current or last goal, with cached ones apart (D-29), and each harness's plan limit, the newest any session reported, since a limit belongs to the account. Since D-50 the core sums it per goal. Since D-49 a room can be dragged and keeps its place.
Why: the layout M5 grows into the command center (D-35, D-49), without rebuilding it.

### D-49 Command center: a chief over departments — accepted (2026-10-07)

All owner choices, made after a look at other agent command centers.
- The office stays the home screen; a top status bar and a right panel with Overview, Chat and Work tabs sit around it. A board view shows the same goals in columns.
- One standing chief, set up once, with its own office on the floor. A goal goes to it only when the user chooses; it runs one goal at a time and queues the rest.
- The chief's plan is a graph of pieces, one per department. The user always approves it and any change to it. The chief may propose a new department, re-plan after a failure and message leads, never workers.
- A piece for a busy department waits in a queue. A downstream department gets the upstream result in its brief and read-only access to the upstream workspace.
- The user can chat with any lead or agent; hand-offs read as threads. A direct message to a worker is noted to its lead.
- A finished goal waits in To review until the user marks it reviewed.
- Rooms are placed automatically and can be dragged; positions are kept (amends D-48).
- Usage limits stay show-only (D-29 holds). A next-waiting button jumps to each waiting agent in turn.
Why a chief: a goal can need several teams in order, and someone has to own the order and pass results on. A lead of leads leaves each department working as in M4. Gas Town's Mayor and Paperclip's CEO agent do the same.
Why links on the floor: no product we found draws team dependencies on the map; it keeps "who waits on whom" on the one screen instead of in a separate graph editor.

### D-50 Live team state: changes on the stream, task state in the core — accepted (2026-10-07)

- The store publishes every change to a task, agent, department, delegation, plan piece or plan limit as a whole record, after its write. The API streams them as `event: change` frames with no id, only on a following, unfiltered stream. They are not stored: a reconnecting app reads everything again, as it already did.
- A task's state (queued, working, waiting, idle, ended) is kept by one module, `team/task-state.ts`. Ended means the goal is finished: its top agent's latest turn or session ended, with nothing waiting on the user and no work out (a delegation at work, cut off, or whose result came after the lead last finished; for a chief goal, a piece not finished and not blocked). Leaving ended clears `reviewedAt`.
- A department is busy while it has a goal that has not ended, so it frees up as soon as its goal finishes, not when its idle lead is stopped; a new goal stops agents an ended goal left open. The chief, likewise, takes up one goal at a time.
- Token usage is summed per task and harness, and each harness's latest plan limits are kept, in the same write as the event. The UI no longer replays traces for usage.
Why: the command center shows every goal's state at once; deriving it in the UI needed every trace, and the chief needs the same "finished" rule to pass results on.

### D-51 Chief plans, hand-offs and read-only folders — accepted (2026-10-07)

- The chief is an agent record whose id is kept in settings; it works in `<data folder>/chief` at Trusted and may read every department's workspace. Team tools are never offered to it.
- A plan is stored as pieces of the chief's task; a piece runs as its department's own task (`parentTaskId`), so a department works as in M4. One scheduler starts a piece once everything it waits on is done and its department is free, one step at a time. A finished piece's result is the piece lead's last message, read from the store, and goes to the chief as a message. An approved re-plan drops pieces not yet started and keeps the rest.
- A piece's agents get the upstream departments' folders as read-only (`readOnlyPaths`, also in `additionalPaths`). The policy never lets a change inside one through, at any level, so it goes to the user (owner). Sessions with read-only folders are never offered "allow always", which on Claude opens every folder for edits. The spike (both harnesses, native and WSL) showed reads there ask nothing and every file change carries its real path; a command carries none, so under Full a command could still change an upstream folder, and under Bypass nothing is guarded. The plan card warns for both (owner).
- A new department in a plan is named by the chief; the user picks its workspace and autonomy on the plan card (owner).
- A message from the user to a worker is noted to its lead only if the lead is at work: resuming it would spend a turn on a note.

### D-11 Task agnostic, connectors as plugins — direction accepted, design pending

Capabilities come from MCP connectors packaged as plugins; an agent lacking a tool should be able to request one. Needs a deep dive before M6.

### D-23 macOS is a target, parked — accepted

No Mac-specific code until someone can test on a Mac. Work when picked up: `macos-latest` in CI; find binaries through the login shell (apps launched from Finder do not inherit PATH); signing and notarisation; a manual run of both adapters.

### D-28 Resume by the harness's session id; live text is extra, never the record — accepted (2026-10-03)

A session resumes an earlier one when given the id `session.started` reported. Our own session gets a new id; linking the two is the store's job (M2.2). A harness that cannot resume fails the start rather than silently beginning fresh. Text fragments (`message.delta`, `reasoning.delta`) take sequence numbers but are not stored, so a stored log has gaps in its sequence. A session resumes only in the environment and folder it was created in.

### D-29 Usage limits are the single source of truth — accepted (2026-10-03)

An agent or department is limited by its provider's own usage limit, which the app shows. No budgets set inside the app and no dollar tracking.
Why: the owner does not want to micromanage spending, and dollar figures on a subscription are estimates, not money charged. Money tracking is parked until API-key use is supported.
Open: only Claude Code reports a plan limit today. Where a harness reports none, the app shows tokens, with cached input shown apart from new input so the figure is not inflated.

## Done

All accepted and built.

- D-1 Desktop app, not web: it drives CLIs installed on the user's machine.
- D-2 The core is its own local process; the shell is a thin wrapper.
- D-3, D-12 TypeScript on Node 24 everywhere: pnpm, Zod, SQLite, Electron, React, Vite, Zustand, Biome, Vitest. No Python in the product.
- D-4 Electron shell. Reversible because of D-2.
- D-5, D-13 One contract, one adapter per wire format. Adapters only translate; process, lifecycle and ids live in shared layers.
- D-6 Never touch harness credentials: spawn the unmodified vendor binary only.
- D-7 Open source; free and low-cost models are first class.
- D-8 The app orchestrates across harnesses; a harness's own sub-agents show as nested activity.
- D-9 Command-center direction: expanded into D-49.
- D-10 Human in the loop: per-team autonomy plus one blocked queue.
- D-14 Where a harness runs (native, WSL) is an `Environment`, separate from which harness it is.
- D-16 Sandbox and computer use are deferred; D-14 keeps the door open.
- D-18 Outsourced agents get only a brief and a copy, isolated from what the harness loads by itself; built as D-47.
- D-19 No build step in development: Node runs the TypeScript sources directly.
- D-20 Translators do no I/O and are tested by replaying recordings of the real CLIs.
- D-21 Paths are reported as host paths in `locations`; the agent's own text is never rewritten.
- D-22 A WSL process tree is killed by a marker set at launch.
- D-24 "Allow always" only changes the current session.
- D-25 An agent's question to the user is its own event, not a permission.
- D-26 A harness lists its models and effort values through a catalog query on its adapter. Effort values are the harness's own words.
- D-27 Withdrawn: a per-agent budget inside the app. Replaced by D-29.
