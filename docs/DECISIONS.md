# Decisions

Only decisions that still guide upcoming work keep their why. Everything settled and built is one line under Done. Numbers are never reused.

## Guiding upcoming work

### D-15 Local SQLite event log behind a store interface — accepted (2026-10-03)

Every event is appended to one local SQLite file; current state and replay are both read from it. The core process keeps sessions running; no queue, broker or database server. The rest of the core reaches storage only through a small store interface.
Why: the app is single-user and local, so the data lives on the user's own machine and "scale" means one person's history, which SQLite handles far past what this app will write. A server database would have to be installed and run on every user's machine. The interface is the extension point: a hosted or team version can add a Postgres store without touching the callers. It is not built until that version exists.

### D-17 UI talks to the core over HTTP plus server-sent events — accepted (2026-10-03)

Commands and queries are HTTP requests; events flow over one SSE stream that resumes from `Last-Event-ID`, the event sequence number.
Why: the stream is one-way and commands are request/response; reconnect and catch-up are built in, and it is testable with curl.

### D-9 Command-center interface — direction accepted, design pending

A top-down view of departments, their agents and dependencies, with chat, task and status panels. Not a walk-up-to-an-avatar world. Needs a design session before M5.

### D-11 Task agnostic, connectors as plugins — direction accepted, design pending

Capabilities come from MCP connectors packaged as plugins; an agent lacking a tool should be able to request one. Needs a deep dive before M6.

### D-18 Outsourced agents — direction accepted

A fresh, isolated agent or department that gets only a brief and the artifact to examine, for a clean-slate review. Isolation must also cover what the harness loads by itself (project instruction files, harness memory). M4.

### D-23 macOS is a target, parked — accepted

No Mac-specific code until someone can test on a Mac. Work when picked up: `macos-latest` in CI; find binaries through the login shell (apps launched from Finder do not inherit PATH); signing and notarisation; a manual run of both adapters.

### D-28 Resume by the harness's session id; live text is extra, never the record — proposed (2026-10-03)

A session resumes an earlier one when given the id `session.started` reported. Our own session gets a new id; linking the two is the store's job (M2.2). A harness that cannot resume fails the start rather than silently beginning fresh. Text fragments (`message.delta`, `reasoning.delta`) take sequence numbers but are not stored, so a stored log has gaps in its sequence. A session resumes only in the environment and folder it was created in.

### D-29 Usage limits are the single source of truth — accepted (2026-10-03)

An agent or department is limited by its provider's own usage limit, which the app shows. No budgets set inside the app and no dollar tracking.
Why: the owner does not want to micromanage spending, and dollar figures on a subscription are estimates, not money charged. Money tracking is parked until API-key use is supported.
Open: only Claude Code reports a plan limit today. Where a harness reports none, the app shows tokens, with cached input shown apart from new input so the figure is not inflated.

## Done

Accepted and built unless marked proposed. Proposed ones are in the merged code and wait only for the owner's yes.

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
- D-19 (proposed) No build step in development: Node runs the TypeScript sources directly.
- D-20 (proposed) Translators do no I/O and are tested by replaying recordings of the real CLIs.
- D-21 (proposed) Paths are reported as host paths in `locations`; the agent's own text is never rewritten.
- D-22 (proposed) A WSL process tree is killed by a marker set at launch.
- D-24 (proposed) "Allow always" only changes the current session.
- D-25 (proposed) An agent's question to the user is its own event, not a permission.
- D-26 (proposed) A harness lists its models and effort values through a catalog query on its adapter. Effort values are the harness's own words.
- D-27 Withdrawn: a per-agent budget inside the app. Replaced by D-29.
