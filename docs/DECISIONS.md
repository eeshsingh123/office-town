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

### D-23 macOS is a target, parked — accepted

No Mac-specific code until someone can test on a Mac. When picked up: `macos-latest` in CI, binaries through the login shell, signing and notarisation, a manual run of both adapters.

### D-28 Resume by the harness's session id; live text is never the record — accepted (2026-10-03)

A session resumes from the id `session.started` reported, only in its original environment and folder; a harness that cannot resume fails the start. Text fragments take sequence numbers but are not stored.

### D-29 Usage limits are the single source of truth — accepted (2026-10-03)

The app shows each provider's own usage limit; no budgets or dollar tracking in the app (owner: no micromanaging, and subscription dollars are estimates). Where a harness reports no limit, show tokens with cached input apart.

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
- A shutdown is recorded like a crash (interrupted), so "stopped" means the user stopped it, unless the end names a lead (D-71).
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
- Look (owner): the "Dusk" palette (D-53); amber only for what needs the user; status as small icons, never large fills; interface 14 px; light and dark follow the OS unless picked in Your profile; reduced motion respected.
- Stream events are applied once per animation frame, or after 100 ms when hidden.

### D-38 The model list is ordered by what a model costs the user — accepted (2026-10-04)

A catalog model may carry `access`: `free`, `plan` or `paid`, set by the adapter. Models that cannot call tools are left out. The list shows Recent, Free, In your plan, then providers used before. Logging in from the app is deferred (owner).

### D-39 Team tools come from the core's own MCP server — accepted (2026-10-05)

The core serves MCP over HTTP on its own port and attaches it to each session with one token per session. Tools return at once; outcomes reach the agent later as a message from the core.
Why: both CLIs call MCP tools, so delegation works the same on every harness and M7 connectors attach through the same seam; tools that wait on people would hit harness timeouts.

### D-40 Departments, proposals and autonomy — accepted (2026-10-05)

- Departments are saved standing teams with their own room. The lead proposes the team first; the user edits and approves it and can change it any time (owner).
- Autonomy: Supervised ("Ask me first") and Full ("Don't ask", everything goes ahead and is recorded); Trusted was removed in D-57. Bypass stays, with a warning (owner).
- Outward actions (push, PR, publish) go ahead only under Full (owner).
- A checker works in a sandbox, never on the original (owner, D-73).

### D-41 Harness facts from the M4.1 spike — accepted (2026-10-05)

- Attaching: Claude `--mcp-config` plus `--allowedTools mcp__office-town`; OpenCode ACP `mcpServers` in `session/new` and `session/resume`, with an allow rule for `office-town_*`.
- WSL2 (NAT mode) cannot reach Windows' `127.0.0.1`, so a WSL harness runs a stdio bridge that is a Windows process forwarding to the HTTP server. The token travels in an environment variable named in `WSLENV`, never on a command line.
- Isolation: Claude `--setting-sources "" --strict-mcp-config --disable-slash-commands` is full (`--bare` and `CLAUDE_CODE_SIMPLE` break the subscription login). OpenCode's flags leave its global config and instructions loading: partial.
- Worktrees are made and removed by the git of the worker's environment (Windows git writes absolute paths WSL git cannot read).
- Owner: a department works on one goal at a time; a new goal starts each agent in a fresh conversation; "one branch per worker" is a department switch, on by default.

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

### D-47 Guests work outside the team, on a sandbox — accepted (2026-10-05), now only the checker (D-73)

A guest works in the same task, not on the team, at its owner's level, at most Full, and leaves once it has answered. Only the user calls one in, as the checker; its sandbox is set in D-73.

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

- The chief is an agent record (id in settings) working in `<data folder>/chief` at Full (Trusted until D-57), reading every department's workspace. It gets no team tools.
- A piece runs as its department's own task (`parentTaskId`). One scheduler starts a piece once its inputs are done and its department is free. A finished piece's result is its lead's last message, sent to the chief. An approved re-plan drops pieces not yet started.
- Upstream folders are `readOnlyPaths`: the policy compares real paths and allows only reads inside them, at any level; anything else goes to the user (owner). Such sessions are never offered "allow always", and the core refuses an answer that was not offered. Under Full a command, and under Bypass anything, could still change them; the plan card warns (owner).
- The user picks a new department's workspace and autonomy on the plan card (owner).
- A user's message to a worker is noted to its lead only while the lead is at work, so no turn is spent on a note.

### D-53 Creation flows for people who are not technical — accepted (2026-10-10)

- Words the user reads: "How much can it do without asking you?" (Ask me first, Don't ask; the harness bypass sits behind More options), Workspace (D-56), AI app for a harness, Templates for profiles (D-55). Code and API keep their names.
- The chief has its own page (`chief` view): a four-step setup the first time (meet and name it, its AI, house rules, its departments), then its goal box, current goal, queue, departments and rules. It replaces the settings dialog.
- New department shows a live card of the team as it is built; role chips are only starting points for a role's name and purpose.
- Look "Dusk": warm greys in both themes, a muted slate blue for actions, soft amber only for what needs the user, Plus Jakarta Sans. Agent colours stay as stored and are drawn softened into the surface.
Why: the owner found the old form vague, full of jargon and generic-looking; the same calls are used, so no contract changed.

### D-54 A review is the next step in the chat — accepted (2026-10-10)

- Once a team task, or a solo task with a plan of three or more steps, has finished, a card at the end of the chat asks "Done. Get this work checked?" with Send for review, See the files and No thanks (remembered per task in the browser). What follows is the check loop (D-73).
- "Send for review" also sits under the message box at any time. The dialog comes with a ready brief, so one click sends it. Reviewers are listed as Reviewers in the team view.
- Open folder moved into the header's facts as the folder's name; in the app a click opens it.
- The offer comes from the app, not the agent: it shows the same way on every harness, costs no tokens, and only appears when the lead really finished (not interrupted, stopped or failed).
Why: the header buttons were out of place and unclear (owner feedback); a review should feel like part of the work.

### D-55 Your profile, agent profiles and templates — accepted (2026-10-10)

- Each kind of setting lives on the page of the thing it changes. Your profile (sidebar, bottom) holds your name, colour, theme, About you, how you like answers, and the two pop-up switches (an agent needs you: on; a task is finished: off), stored as `settings.you`. An agent's settings are its Profile tab in the office (`PUT /agents/:id`). A department adds Team rules (`departments.rules`). The chief keeps its House rules, which only the chief reads.
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
- Removing a workspace only takes it off the list, never touches files, and is refused while a department uses it (owner) or when it is the last Scratch, so an assistant never needs a folder chosen; a migration restores Scratch where it was removed.
- Contract: `kind`, per-folder `access`, `startTask` takes only `workspaceId`, a task names its workspace, `GET /workspaces/usage` (departments, task count, recent tasks, missing folders, git branch, worktrees). D-33's resume rule holds.
- Workers work where their lead does (its first session's folders), so a Scratch team shares one task folder. "Working now" is read from the app's live agent states, not the usage read, so an agent that finished its turn does not count.
- The default Scratch folder is `~/OfficeTown/Scratch`, made when a task first needs it. A task's own folder inside it is named as D-79 says.
Why: two answers to one question, one saved and one not, three words for one idea, and no place to see, edit or share workspaces (owner feedback).

### D-57 Two everyday levels and a Needs you built for volume — accepted (2026-10-11)

- Trusted goes away (owner): it asked before every web search and command, broke the flow and read like Full. Levels: Ask me first, Don't ask (Full), and Bypass behind More options. Stored Trusted becomes Full; New task, the chief and reviewers default to Full. A read-only folder still asks at every level.
- Needs you is grouped by task by default (an ask matters through the work it blocks), switchable to department, workspace, agent or type. Each ask is one compact row that opens its detail. Plans and team proposals first, then questions, then approvals; oldest first inside each. Search, filter chips with counts (type, workspace, department, AI app, waiting over 1h), 25 per group with Show more.
- Approve all and Reject all, per group and per filtered view, with a confirm; approvals only, since questions and plans need real answers. One batch call answers them.
- Out: undo (an action already run cannot be taken back) and "always allow this" rules (parked, owner wants them later).
Why: the owner hit repeated web-search asks under Trusted and needs a queue that stays readable at 500 asks (research: squad.so My Tickets).

### D-58 One composer starts every task — accepted (2026-10-11)

- New task and Home share one box (`new-task/Composer.tsx`). Its chips, each filled with the last choice: Goes to (an assistant, a department, a new department, the chief), Workspace, Model (AI app, model, Thinking and Runs on in one menu) and Asks first / Goes ahead (Bypass last, behind its warning). A department's workspace and level show as fixed chips. Enter starts, Shift+Enter adds a line.
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

### D-61 Accounts and a Usage page — accepted (2026-10-11)

- An account is one login on one harness where it runs. The CLI's own login is the Default account (id: the harness, or `harness@distro` in WSL), so nothing changes until a second one is added. An added account is a folder of its own in `<data folder>/accounts/<id>`, handed to the unmodified CLI as `CLAUDE_CONFIG_DIR` (Claude) or `XDG_DATA_HOME` (OpenCode). D-6 holds: the CLI signs in and saves its own credentials (`claude auth login`; `opencode auth login --provider` reading the key from stdin). The core only checks that the sign-in file exists.
- Limits are kept per account (`account_limits`; old rows became the Default account's). Agents pick an account or Automatic: at session start, the signed-in account on that harness with the most room, Default first on a tie. A resume stays on its account; if that account is used up and Automatic or the agent's pick now points elsewhere, the core starts a new conversation there with a handover note (last reply, check the work folder).
- A Claude turn refused by its plan (`rate_limit_event` status "rejected") marks that window full. Limits are saved from runs and, since PR #47, also read on demand (`POST /limits/refresh`: Claude's `/api/oauth/usage`, the endpoint the CLI's own `/usage` calls, with the CLI's token, never refreshed by us); the Usage page and Plan usage card refresh on open, every 5 minutes, on focus and by a button, and say "Updated N min ago". An expired token keeps the last reading. OpenCode reports no limits: its cards show tokens counted by the app and link to opencode.ai.
- UI: Usage in the main nav (red dot when an account is over 90%), Home's Plan usage card, an Account chip in agent settings, and agents stopped at a limit in Needs you and on Home with "Continue on <account>" and "Resume at <reset>" (an in-memory timer; closing the app drops it). Amber from 70%, red from 90% (owner). The Office bar keeps Floor/Board, "N working", the waiting chip and a used-up account; counts live on Home.
Why: the owner runs several Claude and other subscriptions and could not see or steer their usage; the top bar's figures went unnoticed.

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

- Team in the main nav is one vertical tree: you, the chief (or a "No chief" slot), then each department, folding, with its lead and members. An empty Team page offers describe-or-build, handing text to New department. The sidebar's "Your team" (a + menu and a "Build your team" card; the chief row once it exists), Home, the office floor (dashed rooms) and its top bar all lead there. Remove chief sits in the chief's header.
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

### D-67 Connectors: the core is the hub for key apps and programs — accepted (2026-10-18), sign-in apps moved to D-68

- The core keeps one live link per key app and program and re-serves its tools on the tool server (D-39, D-43), so every harness reaches them; each agent gets only the connectors it may use. Why: a Claude lead's OpenCode worker must reach the same app, our isolation flags (D-41) switch the CLIs' own MCP config off, and ten agents on one app share one link.
- Kinds: key apps (remote, a pasted key), programs on this computer (stdio, started once by the core, exact command confirmed before the first run; needed for apps like Blender), and Add your own. Keys live in the OS credential store, never in SQLite, prompts, command lines or the CLI. Without a store, Linux uses a file only the user can read; Windows refuses to save keys (owner: no `secrets.json` on Windows).
- Who can use it: the Library's audience (Everyone, departments, agents), app-wide. Guests get none.
- Permissions per connector, in the app's own words (owner): Read only, Ask me first (default), Don't ask. Reads never ask; a change asks only under Ask me first. The connector's setting decides its own calls whatever the department's level, so Gmail can ask before sending in a Don't ask team and Blender can run end to end in an Ask me first team (owner). The department level still governs files and commands. Read or change comes from the tool's MCP annotations (`readOnlyHint`); unmarked counts as a change. Asking for every small step is bad UX (owner), so reads are never asked about.
- The tool list never changes inside a conversation, because any change to it wipes the whole prompt cache (owner: adding an app mid-task must not break the cache). Native connector tools are fixed at a conversation's first session and kept on resume; apps granted later are reached through two fixed hub tools every agent has from its first turn (`list_app_tools`, `use_app_tool`). Removing access or turning a connector off refuses calls at once. No restart, no warning needed.
- An agent lacking an app asks with `request_app`; the user connects it or gives access from Needs you, and the agent carries on through the hub tools.
- Describe it (owner): a draft run like D-65, allowed only web search and fetch, finds an existing server (the maker's docs first, then the official MCP Registry) and fills in its setup; the core tests the connection before the user saves it, showing the source and Official or Community. It never writes new server code (a later module if ever wanted).
- Catalog: about 25 official remote servers, each verified live; real logos in brand colours (owner); Add your own first. The full public registry, per-tool switches and two accounts per app are left out.
- Look (owner feedback on the v1 mockup): real logos, one button per card, no tool lists, only say more when something is wrong.
- The core decides every connector call, not the CLI (changed in the build, 2026-10-18). The step 0 spike showed OpenCode asks permission for an MCP tool before it knows the input, so neither the app behind `use_app_tool` nor what a change would do was known when the CLI asked. The CLIs now auto-allow our servers, as they do the team server; the gateway checks access and the permission on each call, and an Ask me first change becomes a core ask in Needs you (as `change_library` does): the call returns at once, and the core makes it on Approve and tells the agent the result (D-39). This holds under No safety checks too, since the connector's setting decides its own calls. The activity log says what was asked.
- Windows keeps at most 1280 characters per credential, so keys are split across entries.

### D-68 Sign-in apps are Claude apps — accepted (2026-10-18)

- Office Town runs no app sign-in and holds no app token (owner). Apps that sign in through the browser (Gmail, Drive, Notion, Linear and so on) are the user's claude.ai connectors, which Claude Code loads for a subscription login. Claude agents are the go-to for app work. Why: Claude already runs and keeps those sign-ins, our own OAuth needed dynamic client registration that many apps refuse (Slack, Figma, Google), and one fewer copy of a token is safer.
- The core reads each Claude account's apps with the CLI's `mcp_status` request (no turn, no tokens) on start, on the Connectors page and on Refresh, into one record per app and account (kind `claude`). A new app gets Everyone and Ask me first; one gone from claude.ai goes with its settings. Its Sign in runs `claude mcp login --no-browser "<app>"` and opens the page it prints; the CLI keeps the token.
- A conversation's Claude apps are fixed at its first session (`vendorApps`), like native connectors, to keep the prompt cache. Only a denylist works (`allowedMcpServers` set through `--settings` blocks our own servers too), so before each Claude launch the harness lists the login's apps (1 to 2 s) and blocks the rest (`deniedMcpServers`); an app connected since stays blocked on resume. If the list cannot be read, every app is off for that run. A session with no Claude apps runs with `ENABLE_CLAUDEAI_MCP_SERVERS=false`, with no wait. `--strict-mcp-config` is dropped: it drops Claude apps too, and empty setting sources already keep the user's own servers out.
- Each call to an allowed app asks (`permissions.ask`), even where the user's own Claude settings allow it, and the core answers by the app's permission as in D-67: reads go ahead, a change under Ask me first goes to Needs you, Read only refuses; every call is logged. The read hint comes from `mcp_status`'s `readOnly` marker. Under No safety checks the CLI does not ask, so Claude app calls run unguarded (owner accepted).
- Only Claude agents reach Claude apps, never through the hub. A lead's roster lists each worker's apps. `request_app` from another harness names the teammates who can use the app, or tells the user no one on the team can. The catalog keeps sign-in apps as tiles that open claude.ai's connectors page, with the server address for a custom connector; describe-it does the same for a sign-in server it finds.
- Codex can connect apps through its plugins (Gmail, Drive, Slack); when the Codex harness lands, it is a second source of vendor apps through the same `vendorApps` contract, if it works headless.

### D-69 A department works in several workspaces — accepted (2026-10-19)

- A department keeps a list of workspaces, the first its default (owner). Each goal runs in one of them: New task offers them when there are two or more, the chief may name one per piece and the user can change it on the plan card; without a choice, the default. Why: one place per goal keeps clear what changed where; all of them at once would repeat what a workspace's extra folders already do.
- The list can be changed any time, in settings and in the Office panel. A running goal stays where it started; the change applies from the next goal (owner). The last workspace cannot be removed.
- New department has a Workspaces step of its own and no silent default once there is more than one workspace; Review blocks Create until each department has one.
- Contract: `workspaceIds` on the department record, its settings and the create request; `workspaceId` stays as the default. `startTeamTask` and plan pieces take an optional `workspaceId`. Store: `department_workspaces` for the others, `plan_pieces.workspace_ref`.

### D-70 Usage is recounted after a session ends — accepted (2026-10-21)

- OpenCode's ACP turn result reports only the turn's last model step, so tokens were undercounted 2 to 7 times. Once a session ends (idle stop included), the core reads the conversation back with the adapter's `recount` (`opencode export`, sub-agents' sessions followed) and adds what the turns missed as a `usage.recounted` event. Why after the session (owner): nothing runs while the agent works, so the user is never held up; the figure is low only until the session ends.
- The event carries the missing part, not a total, so every sum (task, agent, account) just adds it like a turn. The missing part is the conversation's real total minus everything its sessions recorded, so recounting again adds nothing and a resumed conversation is not counted twice. At start, sessions of the last 7 days not yet recounted are caught up.
- A department's sign shows its goal's total and per AI app, and each member's tokens float above its head (owner's pick, A+C; a strip under the desks got cramped in a big room). Never an account's plan %, which belongs to the whole account. Department rooms are taller for it (`DEPARTMENT_DESK_TOP`, `DEPARTMENT_PITCH_Y`).

### D-71 A lead can stop and resume its workers — accepted (2026-10-22)

- `stop_work` (workers by name, a required reason) and `resume_work` (one worker) are lead-only team tools. Owner: a lead told to stop over-testing workers had no way to. A stop waits for the user's approval in Needs you, like a Library change; the lead hears the answer as a message. Owner: a lead alone must never cut off a worker deep in hard work, so the brief also tells it to stop only for a clear reason. Resuming needs no approval.
- Once approved, a stop ends the delegation first, so no "stopped" result wakes the lead a second time; then interrupts an open turn (5 s at most), so the harness closes it in its own records; then closes the CLI as a user stop does. The process must end, not just the turn: Claude's sub-agents run in the background and would go on using tokens.
- The worker's `session.ended` carries `stoppedBy` (lead, reason); without it "stopped" still means the user (D-31). The trace shows "Stopped by <lead>: <reason>".
- `resume_work` hands the stopped piece's brief back in the same conversation, as a new delegation. New or changed work goes through `delegate`. No token budget per piece (owner: goals can be open-ended).

### D-72 Lean team runs — accepted (2026-10-22)

- Measured on a real goal (Opus lead, 5 workers): the lead was ~60% of the Claude spend, from ~190 model calls at ~130k context each; 98.8% of input was cache reads, so the cost is volume, not cache misses. Every step re-reads the whole conversation, so cost ≈ context size × steps. `out/burn.mjs` (local) measures a run from a copy of the store.
- The lead manages: it plans, writes shared contracts, merges, fixes small things and decides; workers explore, build and check. Workers report in under 200 words with details in a file; every agent keeps command output quiet. Owner: quality must not drop, so the lead still checks results and opens files where something looks wrong.
- Not done, by the owner: results are not batched (a worker may need another's result through the lead without waiting), models and efforts stay the lead's and the user's choice, no budgets.
- A fresh lead session (`team/handover.ts`), never automatic (owner: a summary must not cost quality unasked). `hand_over` works only when the last word from a person was the user's, or the user accepted the suggestion that comes once per conversation past 400k tokens with work still out. The lead writes decisions with why, facts, next step and files; the fresh session also gets its lead brief, the user's messages and answers, and every piece with its brief and result from the records, plus the earlier conversation as a file to search. Our own rather than Claude's `/compact`: it works on every harness and the facts come from records. A turn's usage carries `contextTokens` (Claude: the main conversation's last call; OpenCode: its last step).
- Past 95% of an account's window (owner: pause and ask), every task with an open session on that account pauses whole (`team/usage-pause.ts`), closed as a shutdown closes it, so no lead reacts to a worker's stop. The task records `paused`; Needs you and Home offer Resume at the reset (survives a restart) or Resume now. A team carries on through `continueTeam`, told what was cut off; a lone agent where it stopped. Once per window and reset: after Resume now, the user decides.

### D-73 A checklist is checked outside the team — accepted (2026-10-22)

- Owner saw a tester and a developer go back and forth without end. A tester's job is to find issues, so it always finds one, and every round reads the whole conversation again. Studies show most of the gain comes in the first 2 to 3 rounds; after that quality flattens or drops.
- The team builds and checks its own pieces. Each worker checks only its piece: it builds, and its own tests pass. The lead checks that the merged result builds. A tester on the team checks a piece once, and the lead decides what gets fixed. There are no end-to-end rounds inside the team.
- When the work is done, the lead, or the solo agent, writes the core checklist with `write_checklist`: items to check, each with the result it expects, plus how to set up and run the project, and what changed. Owner: the lead knows the work best. The checklist is stored on the task.
- Checking stays an offer and is never automatic (owner). Send for review starts a checker: a fresh guest with the goal, the user's messages, every piece's brief and result, the lead's final account and its conversation as a file to search. Owner: it must have every piece of context it needs. In round 1 it adds edge cases, boundary cases and expected scenarios (`propose_checks`), at most 10 focused items in all (owner: a list the user can read through; they add more in the card). You edit and approve the combined list in Needs you, and after that the list cannot change. The checker then runs every item and reports pass, fail or not run, each with evidence (`report_check`). A fail needs steps, what was expected, and what happened. Anything outside the list goes to notes and is never fixed in the loop.
- You are the round limit. The card shows "n of m pass" with each failure. **Send fixes to the team** sends only the failing items to the lead, with "smallest change; never edit a test to make it pass". **Check again** starts a fresh checker that runs the whole frozen list, so a fix that breaks a passing item shows as a regression. **Accept as is** marks the task reviewed.
- Sandbox: in a git workspace, a detached worktree of the lead's folder, uncommitted and untracked work included. It leaves no branch behind, and the checker may install and run things in it. Elsewhere, a copy without `.git` and `node_modules`. Owner: no leftovers. Each sandbox lives under `checks/` in the data folder and is removed when the checker's session ends for any reason, when its list is declined, and when the task is deleted. At startup, any sandbox left over is removed and git's worktree records are pruned.
- The lead's `outsource` tool is removed: a mid-work second opinion overlaps with workers, costs tokens on every lead step, and is one more place to loop. D-47's guest stays, as the checker.

### D-74 Outputs and preview — accepted (2026-10-22)

- No harness reports "artifacts": Claude Code, OpenCode and Codex write files. So an output is a file or a local site, and the viewer works the same on every harness. Agents mark results with `show_result`, named in every brief because Claude defers the tool. A task's changed files come from its stored edit actions, and spotted sites from local addresses in its output, read per task on request (`outputs/task-files.ts`).
- An agent's page is untrusted code and must never reach the app's token. Pages and PDFs load from the core's preview server, a separate loopback port that serves only folders it was granted, never hidden files or anything outside the task's folders. The app's own origin refuses `/api` calls from any other origin, and pages get no device permissions. Pages may load from the internet (owner).
- Showing a result again adds a version. Files up to 10 MB keep a copy in `outputs/<id>/`; the latest version is the live file, and its copy once the file is gone. The viewer follows each new version unless an older one was picked.
- A worker's worktree is removed once merged, so its results and changed files are read from the same place in the lead's folder (`team/worktrees.ts` `mergedPath`); its stopped site starts in a fresh conversation there.
- Light on the app (owner): nothing loads until opened, one preview runs at a time, and the list re-reads every 15 s only while the task's agents work. The desktop app takes a page's or site's picture once per version, the first time it shows at desktop size; images are their own picture, other kinds show an icon.
- Mark a spot works in the desktop app only (owner). Its picture is taken when the spot is marked and goes with the message as an attachment.
- A stopped site: "Ask to start it" continues the agent's conversation. Past 100k context tokens the user may pick a fresh conversation instead, briefed from the records, including the command that printed the address. It is cheaper than D-72's handover, because starting a server needs no history (owner asked for the option).
- Where it shows: an Outputs tab on the task page (switching tabs replaces the view, so Back leaves the task), result cards in the trace and chat, Latest result on an agent's panel, Outputs on a department's panel, and results on the To review and done cards. No app-wide Outputs page (owner).
- "Open with default app" opens only documents, pictures, media, models and archives (`OPENS_SAFELY`); anything else is shown in its folder.

### D-75 Packaging: an internal beta first, the release on the owner's word — accepted (2026-10-23)

- Packaging comes before any new feature module; agent memory is deferred (owner): the harnesses keep their own memory.
- electron-builder: a per-user one-click installer (no admin, no questions) on Windows and an AppImage on Linux, with electron-updater for updates. Forge's Squirrel installer cannot update an AppImage, so one tool covers both platforms. macOS stays parked (D-23).
- Only the installer has a build step; development keeps running the sources (D-19).
- Two channels. Every merge to `main` publishes a beta, and only the owner's app follows betas, so a breaking change reaches the owner first. A stable release goes to users only when the owner has tested a beta and asks; the agent never runs the stable workflow on its own. Until then nothing is on the stable channel.
- An update installs on quit or on "Restart to update", never while an agent runs. Users' stores now outlive versions: a migration never loses data, and the core copies `store.db` before it runs one.
- The dev app is "Office Town Dev" with its own data folder, so it runs next to the installed app.
- Setup offers to install Claude Code and OpenCode by running the vendor's official installer. D-6 holds: we still run the unmodified binary, and it signs in by itself.
- Betas are prereleases on the public repo (owner): no token or second repo, and the code is public already. Anyone could find one, but nothing points to it until the release.
- Signing: SignPath Foundation, free for open source (owner). Betas stay unsigned. The agent reminds the owner to apply once P4 is done, since approval takes time and must land before the release.
- Open, before the release: the intro video (discuss first), the final name. The app id `town.office.desktop` never changes, so a rename keeps updates and data.
- Built (2026-10-23). `pnpm package` bundles the shell, the core (`main.mjs`) and the WSL tool bridge with Vite; the core and the keyring sit in `resources/core`, outside the archive (electron-builder drops `node_modules` from extra resources, so the keyring is `core/keyring`). `apps/desktop/package.json` holds the next release's version; a beta is `<version>-beta.<CI run>`, a local build `-beta.0`. Bump the version after each release, or betas sort below it.
- Anything run from the sources is development and uses the `OfficeTown Dev` data folder (owner: every dev command). `pnpm dev:app` restarts the app over an IPC channel, since Electron's main process on Windows sees stdin closed from the start.
- The channel is built into the app (`beta.yml` or `latest.yml`). Restart to update asks like Quit when agents are open (owner) and stops the core before installing. A beta is published only after CI passes on `main`.
- Setup's Install: OpenCode on Windows through npm or Scoop when one is there, else the command (owner). Claude Code on Windows keeps the copy command: Defender flagged its one-line installer run hidden from the app as `Trojan:Win32/Commando.A!ml` (owner, 2026-10-23); look again once the app is signed. Setup checks again when the window regains focus, never on a timer (owner). WSL installs are not built: setup checks the native install only.
- The core adds the vendors' install folders (`~/.local/bin`, `~/.opencode/bin`) to its PATH, which an app started from a menu does not inherit.

### D-76 More AI apps — accepted (2026-10-25)

- Owner: add Codex, Muse Code (Meta) and other popular harnesses; never Google's CLIs (Gemini CLI, Antigravity), whose terms risk the user's account. Stay harness agnostic. Users will not have most CLIs installed, so getting one must be easy. Adding them must not break the existing flow, and each must work end to end.
- In (owner, 2026-10-25): Codex, Muse Code, GitHub Copilot CLI, Cursor CLI. Out: Pi (no approvals, so outside the autonomy policy), Hermes (Python install, overlaps deferred agent memory), OpenClaw (an orchestrator over harnesses, not a worker), an unverified ACP-registry tier (not now).
- Each is driven through the vendor's official headless mode only (D-6): Codex `app-server`, Muse `serve`, Copilot `--acp`, Cursor `agent acp`. Copilot and Cursor are launch profiles on the shared ACP translator; Codex and Muse get one translator each.
- One module, one PR, a commit series per piece (owner). Claude Code and OpenCode move onto the new contract first, with no behaviour change.
- Live runs wait for the owner (owner): no accounts are set up yet, so verification is recordings and conformance tests until the owner says go.
- Mockup approved (https://claude.ai/artifact/81frQ9ZF6BDdKpoA545bQv) with changes not redrawn: no "What it can do" section on an app's page (owner: only necessary details); Muse Code is not beta (its page names no beta since about 1 Sep 2026), so no Beta tag.
- Build session (owner, 2026-10-25): may install Codex, Copilot, Cursor and Muse on the owner's machine, without signing in, to read their protocol schemas and check install and version. If an install or check is blocked, stop and tell the owner; never retry in a loop. The build ends with a short sign-in guide for each app, since the CLIs stay installed.
- The new page is called Providers, in the main nav and its title (owner). Only its label: "AI app" stays everywhere else in the app.
- Owner answers (2026-10-25): Add account moves to each AI app's page, Usage keeps meters and Manage accounts; show the installed version, an update notice later; sign-in is browser only for Copilot, Cursor and Muse; the app never installs a CLI unasked, the user picks what to install.
- Several accounts wherever the CLI's login folder can move: Codex `CODEX_HOME`, Copilot `COPILOT_HOME` (both in vendor docs); Cursor `CURSOR_CONFIG_DIR` and Muse (`~/.config/muse`, likely `XDG_CONFIG_HOME`) only in third-party sources, so the spike confirms them before Add account shows.
- Plan usage: Codex reports its windows (`account/rateLimits/read`), so it gets meters. Muse has 5-hour and weekly windows, but no official feed was found; the spike checks `muse serve`. Copilot (monthly premium requests) and Cursor publish none to the CLI. Without a feed, tokens plus an estimate of their API price.
- The estimate (owner, amends D-29 for these cards only): tokens × the model's price from models.dev (the open price list OpenCode uses; US dollars per million tokens, cached input apart), read when the app opens and cached. An info bubble says it is computed at API prices, not what the plan charged. Never a budget.
- Built (2026-10-25). Adapters declare sign-in, version, install and account folder, so the UI no longer names harnesses. Codex (`codex app-server`) and Muse (`muse serve`) have their own translators and plan meters; Copilot (`copilot --acp`) and Cursor (`cursor-agent acp`) are ACP launch profiles with the estimate. Accounts move with `CODEX_HOME`, `COPILOT_HOME`, `CURSOR_CONFIG_DIR`, and `XDG_CONFIG_HOME` plus `XDG_DATA_HOME` for Muse (checked on 1.4.13). A CLI that keeps its sign-in in the system's credential store counts as signed in once the app saw it sign in. Prices from models.dev are kept in the data folder; a row with any unpriced model shows no estimate.
- Install on Windows: Codex and Copilot through npm when it is there; Cursor and Muse keep the copy command, since their one-line PowerShell installers run from the app look like a trojan to Defender (D-75).
- An app's page shows no model list (owner, 2026-10-25): only its status, accounts and where it runs. Models are picked where an agent is set up.

### D-77 A team recovers from failures — accepted (2026-10-31)

- Measured on a real goal (OpenCode lead, two workers on a model that refused every request): the lead could not hear anything during its turn, since ACP prompts waited for the turn's end. It slept and polled for 7 minutes, then worked alone for 78 minutes in one turn; the owner's message never reached it. team_status called the failed workers finished, and the lead never saw the error.
- A message reaches an agent during its turn on every harness. Codex and Muse: `turn/steer`; a refused steer waits for the turn's end. ACP: once a tool ends with none at work, a waiting message cancels the turn and goes out at once, as one turn that goes on. Never mid-tool, so no work is cut. Why not a second `session/prompt`: OpenCode 1.19.5 takes it but never answers either prompt, so the turn would never end (probed).
- A mid-turn message emits a new `turn.started` after it, or the "owes a turn" rule (D-50) would hold the task at working.
- A failed turn or a failed process gets one automatic retry from the core, for a worker before the lead hears and for a lead, which has no one above it. It costs the lead nothing if the failure was passing. Then the lead gets the real error. A lead that failed is resumed by the next message to it; a stopped one is still left alone.
- The lead brief forbids waiting by sleep or polling, and gives the order: look at the reason, `resume_work` (now also for a failed piece), `change_worker`, another worker, the piece itself only as a last resort and saying why.
- `change_worker` moves a worker to another model of its AI app. It follows the department's level: Ask me first goes to Needs you, Don't ask goes ahead and is recorded (agent's call, 2026-10-31; a failed worker has no work to cut off, so D-71's approval does not bind it, and the user can change it back). Another AI app stays with `propose_team`.
- An agent closed for being idle after a failed turn ends as failed, not exited, so it never reads done.
- The run card shows and changes model and effort, on the agent, so it holds in the department (the AI app too since D-79; the machine never). A resume takes the agent's current model and effort. An agent between turns closes so its next message resumes on them; one at work is never cut off and shows "From its next start". The lead hears.

### D-78 A lead asks before changing direction — accepted (2026-10-31)

- Owner: on a real goal the lead dropped the actual game for a remake after 44 minutes of failed tries, and never called `ask_user`. The brief only said to ask when it "cannot go on", and it could.
- `propose_change` is a lead-only team tool. It names what was asked, what was found, the change and what happens on a no. The brief lists when to call it (dropping something the goal names, a different thing from what was asked, less than the goal) and when not to (anything that still delivers the goal), so the rule does not slow normal work. Trigger test: would the user say that is not what they asked for?
- It is a question, not an approval: "Approve all" skips questions, and the user can answer in their own words. It goes to the user at every level, unlike `change_worker`, since a change of goal is the user's at any level.
- The core cannot detect a change of direction, so this rests on the lead calling the tool. A named tool in its list, the brief and a live run with a free model (it asked and obeyed a no) are the evidence. If leads skip it in practice, the next step is a cheap watcher on the lead's messages, kept out for now for its cost (D-72).

### D-79 One folder per Scratch task, thinking up front, the AI app on the run card — accepted (2026-11-01)

- Seen on a real task: an OpenCode agent took its folder's cut-off name ("...visual learning") for a mistake and wrote to a full-name folder beside it. `show_result` refused a file outside its workspace, so nothing showed, and the agent still said it had shown it.
- A Scratch task's folder is `YYYY-MM-DD HH-MM <8 hex>`, never the prompt's words (owner: an id plus a readable alias). The id is the task's, not the assistant's: an assistant runs many tasks and a team shares one folder. The session already records its folder. The app shows an alias, "<department or agent>'s scratch · 1 Nov, 00:13". Older folders keep their names.
- Scratch agents are told to keep every file in that folder, and a refused `show_result` says how to fix it. Neither is enforced: under Don't ask a user may send work elsewhere on purpose. If agents still stray, the next step is an ask for writes outside the folder.
- With nothing shown, Outputs unfolds Changed files and opens the latest document, since an agent may never call `show_result`. A file outside the task's folders stays out (D-74).
- Thinking shows before a model is picked. Where the AI app lists no default, it offers the values at least half its models share; a value the default lacks is ignored with a note, as before. The menu stays open after a model that has levels.
- The run card changes the AI app, model and thinking (amends D-77). Owner: it applies to the whole department, so that is the default; "Just <name>" keeps mixed teams possible. The picks wait for Apply: each change closes agents between turns, and an AI app without a model is a half-made choice. The lead hears once. Runs on stays out, as worktrees belong to their machine (D-41).
- A conversation belongs to its CLI, so an agent on another AI app starts a new one, told its first brief, its last message and what the user said. An agent at work takes the move at its next start.

### D-80 One model picker, in two panes — accepted (2026-11-01)

- Owner picked A of https://claude.ai/artifact/8iEXtivHGG72ZRFF24xZLV: AI apps on the left; search, models and Thinking on the right.
- `ModelChip` is the only way to pick an AI app, model, thinking and where it runs. `SettingsChips` is that chip plus the account chip, so a form and the composer share one set of rules (an AI app change drops the model, a machine change drops the account). Chief setup lost its own AI app list, since the menu would show it twice.
- Runs on stays in the menu's footer, unchanged in meaning: hidden on a running agent. The left pane's note only says what the catalog knows, and only OpenCode reports `access`, so Claude and the others show none for now. Adding it for them means adapters reporting it, not a label in the UI.
- Its popover is modal: a dialog's scroll lock otherwise cancels the wheel over a menu portalled out of it. Menus sit above dialogs (z-index 22).

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
- D-11 Task agnostic, connectors as plugins: built as D-67 and D-68.
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
- D-52 Home is the first screen: one-line composer, what needs you, status counts, the team, recent tasks or Get started.
- D-60 Tasks groups by team, with tabs, search and filters; "Stuck 1 h" after 60 minutes with nothing new (owner); no bulk delete (owner). Logic in `features/tasks/task-list.ts`.
- D-62 One side panel shape for an agent, a department and the chief (Now, Activity, Chat); the sidebars resize and collapse. Activity logic in `trace/activity.ts`.
- D-63 Back and Forward keep the office selection; double-click opens Chat; a group task picks a lead among free selected agents (`task_workers`), the chief and reviewers stay out; pinned agents stay in a strip.
