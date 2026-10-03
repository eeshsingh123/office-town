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
- Integer keys inside, UUIDs only at the edge: every event row and index entry carries its session as 1 to 3 bytes, not 36.
- Every index serves a named query, and the store test fails if any query reads a whole table or loses the index it relies on. Pages are read by key (`WHERE position > ?`), never by `OFFSET`.
- Text over 16 KiB in `action.ended.result` or `action.updated.output` goes to `results/<session>/<sequence>.txt`, capped at 16 MiB; the event keeps a 4 KiB preview and `overflow`.
- Migrations are never edited once merged; the file is copied before it is migrated, and a file from a newer app version is refused.
- No speculative storage: each table is added by the sub-module that uses it, and raw harness lines that only carried a text fragment are not stored (owner: optimise for latency and size).

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
