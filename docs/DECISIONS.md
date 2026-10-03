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

- Node's built-in `node:sqlite`: no native module to rebuild for each Electron version. Its API is a release candidate; it is used in one file.
- WAL, `synchronous=NORMAL`: an app crash loses nothing; a power cut can lose the last second of events (owner accepted).
- One core per data folder: the store holds its file exclusively, so a second core is refused instead of marking the first one's running agents interrupted. The OS drops the lock when a process dies. Tools that read the file directly must wait until the store is closed.
- Integer keys inside, UUIDs only at the edge: every event row and index entry carries its session as 1 to 3 bytes, not 36.
- Every index serves a named query, and the store test fails if any query reads a whole table or loses the index it relies on. Pages are read by key (`WHERE position > ?`), never by `OFFSET`.
- Text over 16 KiB in `action.ended.result` goes to `results/<session>/<sequence>.txt`, capped at 16 MiB; the event keeps a 4 KiB preview and `overflow`. `action.updated.output` over 16 KiB keeps only its last 4 KiB: the harness resends the whole output with each update, so a file per update grew with the square of the output (a 2 MB log left 101 MB).
- Raw harness lines are cut at 64 KiB, with the full size kept: the events already hold the text, the audit copy needs the line's shape.
- Deleting a task removes rows in chunks of 1,000 and hands freed pages back in steps, so the process is never blocked for long (under 80 ms on a 100 MB task).
- Migrations are never edited once merged; the file is copied before it is migrated, and a file from a newer app version is refused.
- No speculative storage: each table is added by the sub-module that uses it, and raw harness lines that only carried a text fragment are not stored (owner: optimise for latency and size).

### D-31 Session registry rules — accepted (2026-10-03)

- Store, then publish. Listeners get the stored event, so a large result arrives as preview plus `overflow` live and in replay alike. Text fragments are published without a `position` and never stored.
- The registry changes sessions; reads (tasks, sessions, events) go straight to the store.
- Resuming needs a prompt, because a resumed harness waits for one. Any ended session with a harness session id can be resumed; the new session joins its task.
- A shutdown is recorded like a crash: running sessions are stopped and marked interrupted, so "stopped" always means the user stopped it.
- If the store fails, the agent is stopped and a fatal `error` (never stored) says its work could not be saved (owner: work that cannot be recorded cannot be traced). Its end is then saved once more, as `failed`, so a brief failure does not leave it "running" with stop and delete refused; if that fails too, the next start marks it interrupted.
- Partial raw lines are flagged by the adapter, which knows its wire format: every Claude `stream_event` line (tool input fragments included), and ACP chunks that complete no message. ACP never sends a whole message, so for OpenCode the `message` event is the only full copy of its text.

### D-32 API rules — accepted (2026-10-03)

- Node's own `node:http` with a route table in `packages/service/src/api`, no framework. Hono would add a router, middleware, a typed client and web-standard handlers; the contract already types the API, the core only runs on Node, and the table is short. Revisit if routes need shared middleware; only `src/api` would change.
- `127.0.0.1` only, with a random token per launch, sent as `Authorization: Bearer` on every request, the stream included. The browser's `EventSource` cannot send headers, so the UI reads the stream with `fetch` (M3.2). CORS is decided in M3.2, once the UI's origin is known.
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

### D-9 Command-center interface — direction accepted, design pending

A top-down view of departments, their agents and dependencies, with chat, task and status panels. Not a walk-up-to-an-avatar world. Needs a design session before M5.

### D-11 Task agnostic, connectors as plugins — direction accepted, design pending

Capabilities come from MCP connectors packaged as plugins; an agent lacking a tool should be able to request one. Needs a deep dive before M6.

### D-18 Outsourced agents — direction accepted

A fresh, isolated agent or department that gets only a brief and the artifact to examine, for a clean-slate review. Isolation must also cover what the harness loads by itself (project instruction files, harness memory). M4.

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
- D-10 Human in the loop: per-team autonomy plus one blocked queue.
- D-14 Where a harness runs (native, WSL) is an `Environment`, separate from which harness it is.
- D-16 Sandbox and computer use are deferred; D-14 keeps the door open.
- D-19 No build step in development: Node runs the TypeScript sources directly.
- D-20 Translators do no I/O and are tested by replaying recordings of the real CLIs.
- D-21 Paths are reported as host paths in `locations`; the agent's own text is never rewritten.
- D-22 A WSL process tree is killed by a marker set at launch.
- D-24 "Allow always" only changes the current session.
- D-25 An agent's question to the user is its own event, not a permission.
- D-26 A harness lists its models and effort values through a catalog query on its adapter. Effort values are the harness's own words.
- D-27 Withdrawn: a per-agent budget inside the app. Replaced by D-29.
