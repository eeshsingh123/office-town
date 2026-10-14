# Decisions

Only decisions that still guide upcoming work keep their why. Everything settled and built is one line under Done. Numbers are never reused.

## Guiding upcoming work

### D-15 Local SQLite event log behind a store interface — accepted (2026-10-03)

Every event is appended to one local SQLite file; current state and replay are both read from it. No queue, broker or database server; the rest of the core reaches storage only through a small store interface.
Why: single-user and local, so "scale" is one person's history; a server database would have to be installed on every user's machine.
The interface is synchronous (owner): a write takes about 80 µs in-process, so async would only add a queue to keep "stored before published" in order. Only deleting is async, in chunks. A hosted store, if it ever comes, changes `packages/service` only.

### D-17 UI talks to the core over HTTP plus server-sent events — accepted (2026-10-03)

Commands and queries are HTTP; events flow over one SSE stream that resumes from `Last-Event-ID`, the store's event `position` (the contract's `sequence` counts within one session only).
Why: the stream is one-way, reconnect and catch-up are built in, and it is testable with curl.

### D-30 Store layout and indexing — accepted (2026-10-03)

- Node's built-in `node:sqlite`, so no native module per Electron version. WAL with `synchronous=NORMAL`: a power cut can lose the last second (owner accepted).
- One core per data folder: a second core is refused.
- Every index serves a named query; the store test fails if a query reads a whole table. Pages are read by key, never by `OFFSET`.
- Large results go to files beside the database; the event keeps a 4 KiB preview and `overflow`. A growing action output keeps only its tail.
- Migrations are never edited once merged; the file is copied before migrating, and a file from a newer app version is refused.
- No speculative storage: a table comes with the sub-module that uses it (owner: optimise for latency and size).

### D-31 Session registry rules — accepted (2026-10-03)

- Store, then publish; listeners get the stored event. Text fragments are published without a `position` and never stored.
- The registry changes sessions; reads go straight to the store.
- Resuming needs a prompt. Any ended session with a harness session id can be resumed; the new session joins its task.
- A shutdown is recorded like a crash (interrupted), so "stopped" always means the user stopped it.
- If the store fails, the agent is stopped with a fatal `error` (owner: work that cannot be recorded cannot be traced), and its end is saved once more as `failed`.
- Partial raw lines are flagged by the adapter and not stored.

### D-32 API rules — accepted (2026-10-03)

- `node:http` with a route table in `packages/service/src/api`, no framework. Revisit if routes need shared middleware.
- `127.0.0.1` only, with a random token per launch on every request, the stream included; the UI reads the stream with `fetch`. The core prints one stdout line, `{url, token}`; logs go to stderr.
- `GET /events` starts after `Last-Event-ID`, else `after`, else with new events only. A client more than 4 MiB or 10,000 events behind is cut off and catches up from the store. `follow=false` makes a replay that ends once caught up: Chromium allows 6 connections per host, so the UI keeps one live stream.
- Errors are `{error, message}`: 400, 401, 404, 409 wrong state, 413 over 1 MiB, 502 harness cannot run.

### D-33 Workspaces and the blocked queue — accepted (2026-10-03)

- A workspace is a saved, named, ordered list of folders (owner); the first is where the agent works. Extra folders: Claude `--add-dir`, OpenCode an `external_directory` rule (1.18 lacks ACP's `additionalDirectories`).
- With no workspace, each task gets a new dated folder inside the output folder (owner). A session never runs in the core's own folder.
- A session keeps the folders it ran in, so a resume runs where it started; a resume whose folder is gone is refused.
- The blocked queue holds permission requests and questions (owner); a row goes with the answer, the session's end, or the next start's interrupt.

### D-34 Agents keep running in the tray — accepted (2026-10-04)

Closing the window hides it; Quit with agents running asks first and records them as interrupted. The shell runs the core on Electron's own Node (`ELECTRON_RUN_AS_NODE`), so users install no Node, and stops it by closing its stdin (`--stop-when-stdin-closes`), killing the tree only after 15 seconds.
Why stdin: Windows cannot send SIGTERM to a child, and a tree kill does not reach WSL agents (D-22); a closed pipe also stops the core if the shell crashes.

### D-35 The office floor — accepted (2026-10-04), no longer the home screen (D-52)

A top-down 2D office with agents at desks. Walk up (arrows/WASD, E) or click to open the side panel; drag-select several. Single-user. Rooms are added on the same frame, never a rebuilt layout. A selection offers Stop all and Message all, never Approve all: each request is read before it is answered (owner).

### D-36 The UI reaches the core through its own origin — accepted (2026-10-04)

The UI calls relative `/api/...`. The shell serves the UI on `app://` and forwards `/api` with the token; Vite's proxy does the same in the browser.
Why: one code path, no CORS, and the token never reaches a page that shows agent text. A preload, where needed, is plain JS (sandboxed preloads do not strip types).

### D-37 UI building blocks and look — accepted (2026-10-04)

- React 19, Vite, Zustand, Radix primitives, `cmdk`, `react-markdown` (never raw HTML), lucide, Plus Jakarta Sans and Geist Mono shipped with the app.
- CSS Modules plus one tokens file; no Tailwind.
- Look (owner): warm greys; one blue accent for actions and running work; amber only for "needs you"; status as small icons, never large fills; interface 14 px (D-53); light and dark follow the OS; reduced motion respected.
- Stream events are applied once per animation frame, or after 100 ms when hidden.

### D-38 The model list is ordered by what a model costs the user — accepted (2026-10-04)

A catalog model may carry `access`: `free`, `plan` or `paid`, set by the adapter. Models that cannot call tools are left out. The list shows Recent, Free, In your plan, then providers used before. Logging in from the app is deferred (owner).

### D-39 Team tools come from the core's own MCP server — accepted (2026-10-05)

The core serves MCP over HTTP on its own port and attaches it to each session with one token per session. Tools return at once; outcomes reach the agent later as a message from the core.
Why: both CLIs call MCP tools, so delegation works the same on every harness and M7 connectors attach through the same seam; tools that wait on people would hit harness timeouts.

### D-41 Harness facts from the M4.1 spike — accepted (2026-10-05)

- Attaching: Claude `--mcp-config` plus `--allowedTools mcp__office-town`; OpenCode ACP `mcpServers` in `session/new` and `session/resume`, with an allow rule for `office-town_*`.
- WSL2 (NAT mode) cannot reach Windows' `127.0.0.1`, so a WSL harness runs a stdio bridge that is a Windows process forwarding to the HTTP server. The token travels in an environment variable named in `WSLENV`, never on a command line.
- Isolation: Claude `--setting-sources "" --strict-mcp-config --disable-slash-commands` is full (`--bare` and `CLAUDE_CODE_SIMPLE` break the subscription login). OpenCode's flags leave its global config and instructions loading: partial.
- Worktrees are made and removed by the git of the worker's environment (Windows git writes absolute paths WSL git cannot read).
- Owner: a department works on one goal at a time; a new goal starts each agent in a fresh conversation; "one branch per worker" is a department switch, on by default.

### D-40 Departments, proposals and autonomy — accepted (2026-10-05)

- Departments are saved standing teams with their own room. The lead proposes the team first; the user edits and approves it and can change it any time (owner).
- Autonomy: Supervised (every request asks) and Full (everything goes ahead and is recorded); Trusted was removed in D-57. Bypass stays, with a warning (owner).
- Outward actions (push, PR, publish) go ahead only under Full (owner).
- Outsourced agents work on a copy, never the original (owner).

### D-42 Agents are stored records — accepted (2026-10-05), template part replaced by D-55

Every session belongs to an agent: unique handle, colour, role, optional department. Settings flow department, role, agent; a profile or agent may lower its department's autonomy, never raise it.
Why: names and roles survive resumes and goals, and agent memory will hang off this record.

### D-43 Tool server rules — accepted (2026-10-05)

- One token per agent session, never stored; the UI's token cannot reach it, nor an agent's token the API.
- Team tools are offered to a lead from its first session, since a harness reads its tool list once.
- A request a tool makes is stored and answered like a harness's own.
- Trace title and kind for our tools come from one rule (`trace/team-tools.ts`), never per adapter.
Why: M7 connectors attach through the same seam, so it stays harness-neutral.

### D-44 Delegation and results — accepted (2026-10-05)

A worker's result is its last message when a turn ends with nothing waiting on the user; it reaches the lead as a message, resuming an idle lead. Failed or stopped workers are reported the same way. Agents idle 10 minutes are stopped and resumed when needed. Stop team closes delegations first.
Why: tools return at once (D-39), and only a turn's end says the work is finished.

### D-45 Autonomy is one policy in the core — accepted (2026-10-05)

Agents run in the harness's `ask` mode; the session attaches each request's action (kind, paths, command) and the core's policy answers what the level allows; anything unreadable goes to the user. A read-only folder asks for anything but a read at every level (D-57). A session already in Bypass stays unguarded until it ends.
Why: one guardrail for every harness; a new harness or connector only reports its actions' kinds and paths.

### D-47 Outsourced agents are guests on a copy — accepted (2026-10-05)

A guest works in the same task on a copy of the chosen paths, without instruction files, harness settings, `.git` or `node_modules`, under at most Trusted. It leaves once it has answered. The user's second opinion examines the agent it is asked from, in that agent's own folder.

### D-49 Command center: a chief over departments — accepted (2026-10-07)

Owner choices:
- The office stays home; a top bar and an Overview/Chat/Work panel sit around it; a board shows the same goals in columns.
- One standing chief with its own office. A goal goes to it only when the user chooses; one goal at a time, the rest queue.
- The plan is a graph of pieces, one per department; the user approves it and every change. The chief may propose a department, re-plan after a failure and message leads, never workers.
- A busy department's piece waits in a queue. Downstream gets the upstream result in its brief and read-only access to the upstream workspace.
- The user can chat with any agent; a direct message to a worker is noted to its lead.
- A finished goal waits in To review until marked reviewed. Rooms can be dragged and keep their place.
Why a chief: a goal can need several teams in order, and someone has to own the order and pass results on, while each department works as in M4.

### D-50 Live team state: changes on the stream, task state in the core — accepted (2026-10-07)

- Every change to a task, agent, department, delegation, plan piece or plan limit is published as a whole record after its write, as an unstored `event: change` frame on a following, unfiltered stream.
- Task state (queued, working, waiting, idle, ended) is kept by `team/task-state.ts` only. Ended: the top agent's latest turn or session ended, it owes no turn, nothing waits on the user, and no work is out. A result is told before its record ends. Leaving ended clears `reviewedAt`.
- A department is busy while it has a goal not yet ended. Claiming a department or the chief is checked and taken in one step.
- Token usage per task and harness, and the latest plan limits, are written with the event.
Why: the command center shows every goal's state at once, and the chief needs the same "finished" rule.

### D-51 Chief plans, hand-offs and read-only folders — accepted (2026-10-07)

- The chief is an agent record (id in settings) working in `<data folder>/chief` at Trusted, reading every department's workspace. It gets no team tools.
- A piece runs as its department's own task (`parentTaskId`). One scheduler starts a piece once its inputs are done and its department is free. A finished piece's result is its lead's last message, sent to the chief. An approved re-plan drops pieces not yet started.
- Upstream folders are `readOnlyPaths`: the policy compares real paths and allows only reads inside them, at any level; anything else goes to the user (owner). Such sessions are never offered "allow always", and the core refuses an answer that was not offered. Under Full a command, and under Bypass anything, could still change them; the plan card warns (owner).
- The user picks a new department's workspace and autonomy on the plan card (owner).
- A user's message to a worker is noted to its lead only while the lead is at work, so no turn is spent on a note.

### D-52 Home is the screen the app opens on — accepted (2026-10-10)

Home shows the office at a glance: a one-line composer (to the chief, a department, or a solo agent on New task's last choices; otherwise it hands the text to New task), what needs you, the status counts, the team with one line each, and recent tasks or a Get started list before the first task. Departments can be built by hand on New department through the existing `POST /departments`.
Why: the floor alone opened on a near-empty screen and gave a new user no next step (owner feedback, squad.so as reference). The floor and board stay one click away.

### D-53 Creation flows for people who are not technical — accepted (2026-10-10)

- New task: replaced by D-58.
- Words the user reads: "How much can it do without asking you?" (Ask me first, Don't ask; the harness bypass sits behind More options), Workspace (D-56), AI app for a harness, Templates for profiles (D-55). Code and API keep their names.
- The chief has its own page (`chief` view): a four-step setup the first time (meet and name it, its AI, house rules, its departments), then its goal box, current goal, queue, departments and rules. It replaces the settings dialog.
- New department shows a live card of the team as it is built; role chips are only starting points for a role's name and purpose.
- Look "Dusk": warm greys in both themes, a muted slate blue for actions, soft amber only for what needs the user, Plus Jakarta Sans. Agent colours stay as stored and are drawn softened into the surface.
Why: the owner found the old form vague, full of jargon and generic-looking; the same calls are used, so no contract changed.

### D-54 A review is the next step in the chat — accepted (2026-10-10)

- "Second opinion" is now "Send for review" (D-18 unchanged underneath). Once a team task, or a solo task with a plan of three or more steps, has finished, a card at the end of the chat asks "Do you want this work reviewed?" with Send for review, See the files and No thanks (remembered per task in the browser). While a review runs the card says so; after it, Read the review and Review again.
- "Send for review" also sits under the message box at any time. The dialog comes with a ready brief, so one click sends it. Reviewers are listed as Reviewers in the team view.
- Open folder moved into the header's facts as the folder's name; in the app a click opens it.
- The offer comes from the app, not the agent: it shows the same way on every harness, costs no tokens, and only appears when the lead really finished (not interrupted, stopped or failed).
Why: the header buttons were out of place and unclear (owner feedback); a review should feel like part of the work.

### D-55 Your profile, agent profiles and templates — accepted (2026-10-10)

- Each kind of setting lives on the page of the thing it changes. Your profile (sidebar, bottom) holds your name, colour, About you, how you like answers, and the two pop-up switches (an agent needs you: on; a task is finished: off), stored as `settings.you`. An agent's settings are its Profile tab in the office (`PUT /agents/:id`). A department adds Team rules (`departments.rules`). The chief keeps its House rules, which only the chief reads.
- Every agent, guests included, reads in this order: About you and how you like answers, its team's rules, its own notes, then the task (`agents/briefs.ts` `instructionsFor`). Each profile page shows that list.
- Profiles are called Templates and sit in the main menu: search, filter by AI app or free models, sort, cards or list. A card shows its name, job and one line "model · app · effort", with Use and a ⋯ menu. Save as template is on every agent's profile and team row; picking a template fills in the form.
- An agent made from a template gets a copy. `profileId` only records which template, to count "Used for N agents". The migration copied each followed template into its agents.
- An agent can be more careful than its team, not less; the screen says to change the team's setting instead.
- Words: plain and human, no internal terms (session, level, handle, harness) in what the user reads; models by their full names.
Why: the Saved assistants page had no clear purpose, mixed one agent's settings into a top-level page, used jargon, and the person using the app had no profile (owner feedback). Copies are easier to understand than settings that change under a running team.

### D-56 Workspaces, end to end — accepted (2026-10-10)

- One idea, "Workspace" in every word the user reads, with a hover tip saying what it is (owner). "A fresh folder" and the output folder go away.
- Two kinds: Your folders (existing folders, git noticed) and Scratch (a new folder per task inside a parent folder, owner). A default Scratch workspace exists from the start; a migration moves `settings.outputFolder` into it.
- Extra folders carry access: Can edit or Read only (reuses D-51's read-only check).
- Workspaces page in the main nav: search, filters, cards with who uses it; a detail page with folders, departments, live agents, recent tasks and worktrees. Creating one is a side sheet with two choice cards, reachable from one shared picker in New task, New department and the plan card.
- Two departments may edit the same workspace at once, with a clear warning (owner).
- Removing a workspace only takes it off the list, never touches files, and is refused while a department uses it (owner).
- Contract: `kind`, per-folder `access`, `startTask` takes only `workspaceId`, a task names its workspace, `GET /workspaces/usage` (departments, task count, recent tasks, missing folders, git branch, worktrees). D-33's resume rule holds.
- Workers work where their lead does (its first session's folders), so a Scratch team shares one task folder. "Working now" is read from the app's live agent states, not the usage read, so an agent that finished its turn does not count.
- The default Scratch folder is `~/OfficeTown/Scratch`, made when a task first needs it.
Why: two answers to one question, one saved and one not, three words for one idea, and no place to see, edit or share workspaces (owner feedback).

### D-11 Task agnostic, connectors as plugins — direction accepted, design pending

Capabilities come from MCP connectors packaged as plugins; an agent lacking a tool can request one. Needs a deep dive before M7.

### D-23 macOS is a target, parked — accepted

No Mac-specific code until someone can test on a Mac. When picked up: `macos-latest` in CI, binaries through the login shell, signing and notarisation, a manual run of both adapters.

### D-28 Resume by the harness's session id; live text is never the record — accepted (2026-10-03)

A session resumes from the id `session.started` reported, only in its original environment and folder; a harness that cannot resume fails the start. Text fragments take sequence numbers but are not stored.

### D-29 Usage limits are the single source of truth — accepted (2026-10-03)

The app shows each provider's own usage limit; no budgets or dollar tracking in the app (owner: no micromanaging, and subscription dollars are estimates). Where a harness reports no limit, show tokens with cached input apart.

## Done

All accepted and built.

- D-1 Desktop app, not web: it drives CLIs installed on the user's machine.
- D-2 The core is its own local process; the shell is a thin wrapper.
- D-3, D-12 TypeScript on Node 24 everywhere: pnpm, Zod, SQLite, Electron, React, Vite, Zustand, Biome, Vitest.
- D-4 Electron shell. Reversible because of D-2.
- D-5, D-13 One contract, one adapter per wire format. Adapters only translate.
- D-6 Never touch harness credentials: spawn the unmodified vendor binary only.
- D-7 Open source; free and low-cost models are first class.
- D-8 The app orchestrates across harnesses; a harness's own sub-agents show as nested activity.
- D-9 Command-center direction: expanded into D-49.
- D-10 Human in the loop: per-team autonomy plus one blocked queue.
- D-14 Where a harness runs (native, WSL) is an `Environment`, separate from which harness it is.
- D-16 Sandbox and computer use are deferred; D-14 keeps the door open.
- D-18 Outsourced agents get only a brief and a copy; built as D-47.
- D-19 No build step in development: Node runs the TypeScript sources directly.
- D-20 Translators do no I/O and are tested by replaying recordings of the real CLIs.
- D-21 Paths are reported as host paths in `locations`; the agent's own text is never rewritten.
- D-22 A WSL process tree is killed by a marker set at launch.
- D-24 "Allow always" only changes the current session.
- D-25 An agent's question to the user is its own event, not a permission.
- D-26 A harness lists its models and effort values through a catalog query on its adapter.
- D-27 Withdrawn: a per-agent budget inside the app. Replaced by D-29.
- D-46 A worker's worktree is made from the lead's branch by the worker's own git, kept in the data folder, removed once merged and ended; the branch stays.
- D-48 Every department is a room with a desk per member, lead first; solo agents share the open floor, guests the guest desk. Room usage is per goal (D-50); rooms are draggable (D-49).

### D-57 Two everyday levels and a Needs you built for volume — accepted (2026-10-11)

- Trusted goes away (owner): it asked before every web search and command, broke the flow and read like Full. Levels: Ask me first, Don't ask (Full), and Bypass behind More options. Stored Trusted becomes Full; New task, the chief and reviewers default to Full. A read-only folder still asks at every level.
- Needs you is grouped by task by default (an ask matters through the work it blocks), switchable to department, workspace, agent or type. Each ask is one compact row that opens its detail. Plans and team proposals first, then questions, then approvals; oldest first inside each. Search, filter chips with counts (type, workspace, department, AI app, waiting over 1h), 25 per group with Show more.
- Approve all and Reject all, per group and per filtered view, with a confirm; approvals only, since questions and plans need real answers. One batch call answers them.
- Out: undo (an action already run cannot be taken back) and "always allow this" rules (parked, owner wants them later).
Why: the owner hit repeated web-search asks under Trusted and needs a queue that stays readable at 500 asks (research: squad.so My Tickets).

### D-58 One composer starts every task — accepted (2026-10-11)

- New task and Home share one box (`new-task/Composer.tsx`). Its chips, each filled with the last choice: Goes to (an assistant, a department, a new team, the chief), Workspace, Model (AI app, model, Thinking and Runs on in one menu) and Asks first / Goes ahead (Bypass last, behind its warning). A department's workspace and level show as fixed chips. Enter starts, Shift+Enter adds a line.
- In the text, "@" picks who takes it and "/" (at the start) a template, shown as a removable tag. Under the box one plain sentence says what starting will do; New task adds Suggested tasks before the first task, then Use again.
- A model is always shown by name: Claude Code's `default` is named after the model it stands for, and older models fold behind "N more". Gone: the three cards, the autonomy cards, the template row and the "What happens next" panel.
- Out for now: telling the user a CLI is out of date (needs the CLI's version in the catalog and a latest-version check, a contract change).
Why: the owner found the form vague, slow and generic-looking; Devin, Jules, Codex and Cursor all start from one input with remembered choices beside it. Same API calls, no contract change. Mockup https://claude.ai/artifact/71RVoeMQkxza3Pq72eyxn9.

### D-59 One name per thing, no explainer text — accepted (2026-10-11)

- A model goes by its AI app's display name everywhere ("Haiku 5.5"), for the picked alias and for the full id a running session reports: the catalog carries `resolvedId` (Claude Code's `resolvedModel`) and `features/profiles/model-name.ts` is the only place that names a model. Effort reads "Medium effort"; an unset effort is not shown.
- A task row names who works on it: the department, the chief, or "Assistant · Haiku 5.5"; agent handles stay inside the office and the task page. Titles come from the prompt's first sentence without the polite opening, cut at 60 characters. No model call.
- UI copy is labels and short hints only (owner): no how-it-works panels, no hints that restate the label, no narrated or clever phrasing. The levels sit under "Permissions" (Ask me first / Don't ask / No safety checks). The line under the composer shows only for an approval (chief, new team) or a busy chief.
- Ctrl+K opens a search over pages, departments and recent tasks, with "Start a task" for the typed text last.
Why: the owner found raw model ids, handles and AI-sounding explanations throughout the app.

### D-60 Tasks grouped by team, with tabs, search and filters — accepted (2026-10-11)

- Tasks groups by team by default (the chief, each department by name, then Assistants); Group by also offers Status and Day, remembered in the browser. Tabs with counts: All, Needs you, Working, To review, Done, Failed or stopped. Search covers title, prompt, live line, team, agents and workspace; filters for Team, Workspace and Started.
- A row: status icon, title, one live line (the ask, the step "Step 2 of 6 · …", or what it waits on), who, a step or part bar, last activity, one button (Answer or Review) and a ⋯ menu (Show in office, Delete). Handles stay out (D-59): a team's row reads "Lead + 2".
- A chief's parts sit under their goal, planned ones included; a part stands alone under its department, with "Part of: …", only when its goal is filtered out. A goal that waits on a part needs you, and Answer opens that part.
- Working with nothing new in its trace for 60 minutes shows "Stuck 1 h" (owner). No trace loaded means unknown, never stuck.
- Done tasks fold into "Show N done" in a group that still has open work. The history size is a small muted figure beside the tabs, amber past 1 GB. No bulk delete (owner).
- The logic is `features/tasks/task-list.ts`; the Office Board stays as the live column view.

### D-61 Accounts and a Usage page — accepted (2026-10-11)

- An account is one login on one harness where it runs. The CLI's own login is the Default account (id: the harness, or `harness@distro` in WSL), so nothing changes until a second one is added. An added account is a folder of its own in `<data folder>/accounts/<id>`, handed to the unmodified CLI as `CLAUDE_CONFIG_DIR` (Claude) or `XDG_DATA_HOME` (OpenCode). D-6 holds: the CLI signs in and saves its own credentials (`claude auth login`; `opencode auth login --provider` reading the key from stdin). The core only checks that the sign-in file exists.
- Limits are kept per account (`account_limits`; old rows became the Default account's). Agents pick an account or Automatic: at session start, the signed-in account on that harness with the most room, Default first on a tie. A resume stays on its account; if that account is used up and Automatic or the agent's pick now points elsewhere, the core starts a new conversation there with a handover note (last reply, check the work folder).
- A Claude turn refused by its plan (`rate_limit_event` status "rejected") marks that window full. Limits update only from runs (owner chose this over Anthropic's undocumented usage endpoint); cards say "Updated N min ago". OpenCode reports no limits: its cards show tokens counted by the app and link to opencode.ai.
- UI: Usage in the main nav (red dot when an account is over 90%), Home's Plan usage card, an Account chip in agent settings, and agents stopped at a limit in Needs you and on Home with "Continue on <account>" and "Resume at <reset>" (an in-memory timer; closing the app drops it). Amber from 70%, red from 90% (owner). The Office bar keeps Floor/Board, "N working", the waiting chip and a used-up account; counts live on Home.
Why: the owner runs several Claude and other subscriptions and could not see or steer their usage; the top bar's figures went unnoticed.

### D-62 Side panel and resizable sidebars — accepted (2026-10-11)

- The Office side panel is a quick look at one agent, department or the chief, with the same shape for all three: a header (picture, name, role, status chip, close), tabs Now / Activity / Chat (and Profile for an agent), and a footer of buttons under Now and Activity. Now shows, in order: the waiting ask, what it works on with a live line and its step, the last 3 finished actions, and one row of run facts.
- Activity shows the agent's own steps with each step's actions summarised under it (actions carry `planStepId`). An agent that made no step list gets its actions grouped by the message that started them ("You asked: …"), so the tab is never empty while the agent works. The logic is `trace/activity.ts`.
- Chat folds each run of tool calls between messages into one line ("Searched once, fetched 3 pages").
- The task page drops its Details column and the facts under the title. One run bar above the message box shows who, AI app and model, effort, permissions, folder, and time and tokens; the last opens the full run details. The plan is a Steps column that hides and resizes, shown only when a step list exists. Plan usage stays in the top bar.
- The left sidebar, the side panel and the Steps column resize by dragging their edge (arrow keys on the focused handle, double-click resets); widths are kept in the browser. The left sidebar collapses to an icon rail (button or Ctrl+B); the side panel slides out whole (close, or the top-bar button) and comes back when something is picked. Both move in 180 ms, none with reduced motion.
Why: the owner found the panel cramped (hidden tabs still took space), the Work tab empty for most agents, the Details column a repeat of the header, and both sidebars fixed.

### D-63 Back and Forward, double-click to chat, group selection — accepted (2026-10-11)

- The app keeps a browser-like history in memory: every screen change is a step, and each step keeps the office selection it had, so Back from a task page lands on the office with the same agent open. Picking agents in the office is not a step of its own (clicking five agents should not take five Backs). Back and Forward sit at the top of the sidebar (also in the icon rail, with "Back to …" on hover); Alt+←/→ and the mouse's side buttons work too. Task, department and workspace pages show a breadcrumb. Esc stays "close and clear", not Back.
- Double-click (or Enter on the selected one) on an agent, the chief or a department sign opens the side panel on Chat with the message box focused.
- A multi-agent selection shows a count by state, one card per agent (who needs you first, each with its main button: Answer or Review), Message all (finished agents are resumed in their last task, as in the single chat), Stop N at work, Give them a task, and Pin.
- Group task (owner): the user picks a lead among free selected agents; the others are its workers for that task only (`task.workerAgentIds`, table `task_workers`). Each agent keeps its own settings, permissions and its department's rules; work happens in one workspace, by default the lead's; no branch per worker; the lead cannot propose a different team. Busy agents (an open session on a working or waiting task) cannot be picked, and a lead cannot hand work to a worker that became busy elsewhere. The chief and reviewers stay out. Tasks lists a group task under its lead's department, as "N agents".
- Pinned agents show in a strip at the bottom of every screen, kept in the browser across restarts, until unpinned.
Why: the owner had no way back from any screen, double-click did nothing, and a drag selection only offered messages that could not reach finished agents.

### D-64 Files and Library — accepted (2026-10-11)

- Attachments go with a message or task; a workspace Library holds reference items given to Everyone, a department or one agent (owner chose this over attachments only, and over an indexed knowledge base: search hands agents fragments, which is where made-up answers start; it can come later on top).
- Files and images are copied read-only into the data folder with size and checksum, so what the user picked is what the agent gets; a Library file changes only through Replace. Folders are linked read-only and live, like workspace extra folders (D-56) (owner).
- Every item reaches the session the same way: read-only access to its path (`--add-dir`, OpenCode `external_directory`), and a list in the prompt with name, type, size and exact path, telling the agent to open a file before relying on it and to say so if it cannot. Images also go inline (Claude stream-json `image` block; ACP `image`) when the model can see them. Claude Code 2.1.296 on Windows was probed and works; OpenCode reports image and PDF input per model (`opencode models --verbose`, `capabilities.input`).
- An image for a model that cannot see images: warn on the chip and send the path only; never block (owner).
- The app marks each item Opened or Not opened from the agent's read and list tool calls on its path. Not opened is amber only for items attached to that message; Library items are available, not required.
- Agents can write to the Library through a team tool (owner): adding a new item needs no approval and shows "Added by <agent>"; replacing, editing, removing or changing who an item is given to goes to Needs you first. To be reworked with agent memory if needed.
- Limits: 20 MB per file, 5 MB per inline image (larger images go as a path only), none on linked folders (owner).
- Built in two PRs, attachments then Library, each end to end. It comes before connectors (now M7) (owner).
- Built (attachments): `POST /attachments?name=` takes the raw bytes, `POST /attachments/folder` links a folder; every send request takes `attachments` (ids). Copies live in `<data>/files/<id>/<name>`, go with the last task they were sent in, and unsent ones after a day.
- Harness-neutral (owner): an adapter only declares `capabilities.images`, fills catalog `inputs` per model and takes `prompt(text, images)`; the session writes the file list with the agent's own paths and the stream keeps host paths, like action locations. A new harness needs nothing else.
- A file's folder joins the session's read-only folders, also mid-task (the stored options grow, so the policy and a resume see it); a read inside a read-only folder now goes through at every level, Supervised too.
- A lead passes files with `delegate`'s `files` (from its own list, by path or name); every piece of a chief's goal gets the goal's files. Folders are dropped or picked in the app only; browser mode takes files and images.
- Built (Library): an item points at its attachment, so Replace moves it to a new copy and a copy a task was sent stays with that task. "Given to" is Everyone, or any departments and agents (the mockup's "Design, Engineering"); an item always has someone. A new conversation lists its agent's items as reference (task or agent department, or the agent), never a resumed one. Opens are counted per task from read and search calls.
- `#` attaches a Library file in both composers, and the paperclip has "From the Library"; `@` stays for who does the task (owner, 2026-10-11).
- An agent's change asks through a core permission request with Approve and Decline; the autonomy level never answers it.
Why: the app had no way to give an agent a file, and a file the agent never opened must not be described as if it had.

### D-65 Building teams from words or step by step — accepted (2026-10-14)

- Team in the main nav is the org chart: you, the chief, then each department with its members, and search. Sidebar ("+ Set up a chief", "+ New department"), Home ("Build your team" until one exists), the office floor (dashed rooms) and its top bar all lead there.
- New department runs in four steps (Describe, Team, Rules and permissions, Review); nothing is saved before Create. Every person, the lead included, has a role, a one-line "what they do", instructions and a model in one editor (`MemberEditor`), also used by department settings.
- Contract: a team role takes `instructions` (given replaces the member's notes, "" clears them, absent keeps them); a team takes `lead` (role, purpose, instructions, and settings for a department that exists); a department keeps a one-line `purpose`, which the chief reads.
- Drafts (`POST /drafts/departments`, `/drafts/chief`): one short run on a model the user picks (Opus by default, kept in the browser), outside any task and the registry: nothing stored, no tools, isolated, in `<data>/drafts`. The reply is JSON; questions only when they would change the draft, up to 3 suggestions for what was missed (owner), several departments at once. Models, harnesses and kept members are checked against what exists; an unusable reply gets one retry. Each call sends what the user said so far and the current draft, so it holds no state.
- Department settings can be changed in words: the draft fills the form and the user saves.
- Removing: the chief (`DELETE /chief`) and a department (`DELETE /departments/:id`) are refused while they work or a plan counts on them. A removed department keeps its row so its tasks still show its name; the user chooses to keep its agents and tasks (they become assistants) or delete them (`?history=delete`) (owner).
- The chief and department pages explain how they work in a hideable band (`ui/Guide`, shared with Templates).
- The lead's team proposal in Needs you uses the same editor; the lead, already at work, is shown but not edited.
Why: the owner could not find where to build departments or the chief, the department form had no room for instructions, and there was no way to describe a team in words or remove a chief (references: CrewAI Studio and Copilot Studio draft from a description, then show everything for review).

### D-66 Setup, tutorials and Help — accepted (2026-10-14)

- First run opens a four-step setup instead of Home: Welcome (the three ways to work, and what the user will use it for), AI app, Your work (where work goes, permissions, name and about), Ready (pick a tutorial). Someone with tasks or agents from before skips it. Help has "Run setup again".
- AI app: `GET /harnesses/status` says per harness whether its CLI answers `--version` and, for Claude Code, whether `claude auth status` is signed in. OpenCode counts as ready once installed, since its free models need no sign-in (checked 2026-10-14). Not installed shows the vendor's own install command (adapter `install`) with Copy and Check again; the app does not run installers. Signing in uses the Add account dialog, now also for the default login (`POST /accounts/:id/sign-in` takes a default account; the CLI then saves to its own folder).
- Tutorials do real work, outline the part of the screen they are about, move focus there, and step on by themselves from the app's own records (a new task, a finished task, a new department, a Library item); a step that cannot be observed has Next. They run on OpenCode's free model, else Haiku on low effort, and say so in one line. Finished tutorials are saved in settings and never shown as badges (owner). Home's Getting started list ticks itself off and starts each tutorial.
- Help (F1, sidebar): tutorials, Display (text size 100/115/130%, higher contrast, less motion, read out new requests), What's new as a dated list, Run setup again. What's new also opens once after an update with what came out since. Setup progress and Display live in the core's settings (`onboarding`, `display`), not the browser.
- No waiting on a CLI where it can be avoided (owner): every AI app's model list is read in the background when the app opens (it runs the CLI, seconds the first time), so tutorials and model pickers find it ready; setup's version and sign-in checks run side by side.
- Copy: onboarding may explain, in one short human sentence; no reassurance, no defending the app, no glossary (owner). D-59 still holds everywhere else.
Why: the owner, who built the app, still had to work out what departments and the chief are for and where to make them; the users include non-technical managers, so accessibility comes first.
