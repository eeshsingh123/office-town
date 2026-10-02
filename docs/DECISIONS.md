# Decisions

Status is `proposed` until the owner agrees, then `accepted`. Superseded entries stay, marked `superseded by D-n`.

## D-1 Desktop app, not web — accepted (2026-10-02)

The app drives CLIs installed and logged in on the user's machine. A browser cannot spawn local processes or reach local credentials, so a desktop shell is required.

## D-2 Core is a standalone local process, the shell is a thin wrapper — accepted (2026-10-02)

The core (harness supervision, orchestration, persistence) runs as its own process and talks to the UI over a local socket. The desktop shell only opens a window and starts or stops the core.
Why: the core can be built and tested headless, the UI can run in a plain browser during development, and the shell choice (D-4) becomes reversible.

## D-3 TypeScript end to end — accepted (2026-10-02)

Why: the UI must be TypeScript anyway, so one language gives one shared event contract with no cross-language drift. Every harness ships a first-class TypeScript SDK; Python coverage is partial. Packaging a Python runtime into a desktop app adds size, slow startup and antivirus false positives.
Cost: the owner is a Python developer and must review TypeScript.

## D-4 Electron shell — accepted (2026-10-02)

Why: the core is Node, which Electron already ships, so no sidecar binary. One Chromium on every OS keeps the canvas consistent. Tauri's size advantage mostly disappears once a compiled Node/Bun sidecar is bundled, and it adds a Rust toolchain nobody on the project knows.
Cost: larger installer and higher idle memory than Tauri. Reversible because of D-2.

## D-5 One harness contract, one adapter per wire format — accepted (2026-10-02)

Every harness is the vendor's own native binary. Each binary reports its activity in a different machine-readable format. An adapter is our translator from one such format into the core's single event model.
- Claude Code: its `stream-json` format.
- OpenCode and any other binary that natively speaks the Agent Client Protocol (ACP): one shared ACP adapter.
- Codex, Antigravity: their own native formats, each its own adapter, added when needed.
Why: open/closed. Adding a harness adds an adapter and never edits the core. ACP is used only where the vendor binary speaks it itself; third-party ACP wrappers around Claude or Codex lose sub-agent detail and sit in a policy grey area (D-6).

## D-6 Never touch harness credentials — accepted (2026-10-02)

Spawn only the unmodified vendor binary; the user logs in through the vendor's own flow. No token extraction, storage or proxying.
Why: Anthropic and Google have both suspended subscription access for third-party tools that handled OAuth tokens (2026). Vendor billing rules for third-party usage are still moving, so an API-key path must stay possible.

## D-7 Open source, distributed, low-cost path is first class — accepted (2026-10-02)

Public repo, built for distribution. OpenCode with its free and Go models must work as well as premium subscriptions, so users without expensive plans can try the product.
Consequence: the event contract is validated against Claude Code and OpenCode early, so it does not end up Claude-shaped.

## D-8 The app orchestrates across harnesses — accepted (2026-10-02)

The app spawns separate sessions and routes delegation between them, so a lead on one harness can delegate to a worker on another. A harness's own built-in sub-agents are also surfaced, as nested activity under that agent.

## D-9 Command-center interface — accepted in direction, design pending (2026-10-02)

A holistic top-down view of departments, their agents and inter-department dependencies, with chat, task and status panels. Not a walk-up-to-an-avatar world. Details need a dedicated design session before the UI modules.

## D-10 Human in the loop: per-team autonomy plus a blocked queue — accepted (2026-10-02)

Each team has an autonomy setting. Anything needing the user lands in one queue showing department, task, agent and what it is blocked on.
Consequence: permission requests and blocked states are part of the event contract from module 1.

## D-11 Task agnostic, connectors as plugins — accepted in direction, design pending (2026-10-02)

Not coding only. Capabilities come from connectors, packaged as plugins; an agent lacking a tool should be able to provision one. Needs its own deep dive before the connectors module.

## D-12 Final stack, no Python in the product — accepted (2026-10-03)

TypeScript on Node 24 everywhere. pnpm workspace. Core: Node process, Zod schemas, local HTTP API with server-sent events, SQLite. Shell: Electron. UI: React, Vite, Zustand; canvas engine chosen in the interface session. Tooling: Biome, Vitest, GitHub Actions. Connectors: MCP.
Python appears only as third-party connector servers the app may launch; none of our code is Python.

## D-13 Adapters are translators only — accepted (2026-10-03)

Process handling, lifecycle, ids, sequencing and error handling live in shared layers. An adapter builds a command, translates native messages to events, and encodes outgoing messages. All adapters pass one shared conformance test suite.
Why: five harnesses must not mean five copies of the same plumbing.

## D-14 Execution environment is a seam — accepted (2026-10-03)

Where a harness runs (native OS, WSL) is an `Environment`, separate from which harness it is. WSL ships in module 1.
Why: Windows users often have the best CLI setup inside WSL. The same seam later takes a sandbox or VM without touching adapters.

## D-15 Local SQLite event log, in-process background work — proposed (2026-10-03)

Every event is appended to a local SQLite file; current state and replay are both read from it. The core process itself keeps sessions running; no queue, broker or database server.
Why: single-user local app, replay and audit are requirements, and an append-only log gives both with one mechanism. Redis was considered and rejected: it would have to be installed and run on every user's machine (no official Windows build) to solve a multi-process, multi-machine problem this app does not have. The event bus and store stay behind interfaces in case a hosted version ever needs it. Retention and size limits are open (see MODULES.md, M2).

## D-16 Sandbox and computer use deferred — proposed (2026-10-03)

Not built until the core product works. Each harness already enforces its own permissions, and a VM layer is a large, platform-specific piece of work. D-14 keeps the door open.

## D-17 UI talks to the core over HTTP plus server-sent events — proposed (2026-10-03)

Commands and queries are HTTP requests; events flow over one SSE stream that resumes from `Last-Event-ID`, which is the event sequence number.
Why: the event stream is one-way and commands are request/response, so this fits better than a WebSocket: built-in reconnect and catch-up, testable with curl, and familiar to the owner. OpenCode's own server uses the same shape.

## D-18 Outsourced agents — accepted in direction (2026-10-03)

What was called "incognito": a fresh, isolated agent or department that receives only an explicit brief and the artifact to examine, with no department context or memory, to give a clean-slate review. Its run is still recorded like any other.
Consequence for M4: isolation must also cover what the harness loads by itself (project instruction files, harness memory), not only what the app injects.

## D-19 Run TypeScript sources directly, no build step — proposed (2026-10-02)

Packages export their `.ts` sources; Node 24 runs them natively by stripping types, and `tsc` only typechecks. No `dist`, no watch process, no build order between packages.
Why: nothing consumes compiled output until the desktop app is packaged (M3), and a bundler will produce that. Until then a build step is only a way for stale output to cause confusing bugs.
Cost: only erasable TypeScript syntax (no `enum`, no parameter properties), enforced by `erasableSyntaxOnly`; relative imports carry the `.ts` extension.

## D-20 Translators do no I/O and are tested by replaying real recordings — proposed (2026-10-02)

A translator is a state machine: native lines in, events and lines out. The session owns the process. The JSON-RPC peer follows the same rule.
Why: every adapter is tested by feeding it output recorded from the real CLI, with no subscription and no process, and all adapters run one conformance suite (D-13). Recordings live in `packages/harness/test/fixtures/<harness>`; a CLI upgrade that changes the format is caught by re-recording.

## D-21 Paths are translated at the session, as explicit locations — proposed (2026-10-02)

The session gives the adapter the workspace as the environment sees it, and reports the files an action touches in `action.started.locations` as the host sees them. The harness's raw `input` and text are never rewritten.
Why: rewriting paths inside free text would also rewrite commands the agent really ran with Linux paths, which makes the trace lie. A separate field lets the UI open files while the record stays faithful.

## D-22 A WSL process tree is killed by launch marker — proposed (2026-10-02)

Each WSL launch carries a unique environment variable; stopping kills every process in the distro that has it, then the `wsl.exe` relay.
Why: measured on the owner's machine, killing the relay alone leaves detached children (`setsid`, `nohup`) running. Children inherit the variable, so the marker reaches them without tracking pids across the boundary.

## D-23 macOS is a supported target, parked as tech debt — accepted (2026-10-02)

The product must run on macOS as well as Windows, but no Mac-specific work is done until someone can test on a Mac. Until then: no macOS-only code paths, no macOS CI job, and nothing that would block macOS is introduced (the stack in D-12 is cross-platform; platform differences stay behind `Environment`).
Why: the owner has no Mac, and untested platform code is worse than none.
Known work when it is picked up: add `macos-latest` to CI; resolve harness binaries through the user's login shell, because an app launched from Finder or the Dock does not inherit the shell PATH; code signing and notarisation; a manual run of both adapters on a real Mac.

## D-24 "Allow always" only changes the current session — proposed (2026-10-02)

When a harness offers to stop asking, the adapter offers that choice only for changes that end with the session, and the option's label says exactly what will change. A change the harness would save to a settings file is not offered.
Why: Claude Code's suggestion for one file write is "accept all edits", which is far wider than the question asked, and a saved rule would silently outlive the session. Lasting permissions per agent are a UI decision for later (M3.3, M4).

## D-25 An agent's question to the user is its own event — proposed (2026-10-02)

`question.requested` carries one or more questions with their options; the caller replies with the `answerQuestion` command (per question: the chosen labels, or the user's own words), and `question.resolved` records the answers or a cancellation. It is not a permission request.
Why: a permission can only be allowed or denied, so a question sent through it would be "allowed" with no answer and the agent would carry on blind. Claude Code's `AskUserQuestion` works this way on the wire (confirmed on the live CLI). The blocked queue (D-10) needs to tell "approve this" apart from "answer this".

## D-26 A harness describes itself through a catalog query on its adapter — proposed (2026-10-03)

An adapter may carry a catalog query: the command to run, the lines to send it, and a pure function that reads the models and each model's effort values from what it printed. One shared function runs the query in any environment. Effort values are the harness's own words and are never mapped to a common scale.
Why: the form that creates an agent needs these lists before any session exists, and it must be built from data so that a new harness needs no UI change. Keeping the reading pure follows D-20, so it is tested against recorded output. A common effort scale would hide options and could map wrongly: the same model offers different values on different harnesses.
Measured: Claude Code answers in about 2 seconds, OpenCode in about 3. M2 should cache the answer rather than ask on every form open.

## D-27 The budget lives in the session and pauses by asking — proposed (2026-10-03)

A session counts its own spending from the usage every harness reports at the end of a turn, and compares it with an optional budget in tokens, dollars or both. Over budget, it emits an ordinary `permission.requested` (continue with the same budget again, or stop) and refuses new prompts until it is answered. The harness never sees the request. Tokens count what the model newly read and wrote; input served from the cache is left out. Adapters report cost as the harness gives it, a running total, and the session derives each turn's cost.
Why: Claude Code has a dollar limit and OpenCode has none, so a budget built on the CLIs' own limits would behave differently per harness. One counter in the shared layer behaves the same for every current and future harness. Reusing the permission request puts the pause in the blocked queue (D-10) with no new event or command. Cached input is left out because a long session re-reads its whole context every turn, which would exhaust any budget while costing almost nothing.
Limit: the check happens when a turn ends, so one long turn can overshoot. Stopping mid-turn needs usage during the turn, which only Claude Code reports for tokens; revisit if overshoot is a problem in practice. A department budget is M4 and sums its agents with the same counter.

## D-28 Resume is by the harness's own session id; live text is extra, never the record — proposed (2026-10-03)

A session resumes an earlier one when given the id that `session.started` reported: `--resume` on Claude Code, `session/resume` on ACP. Our own session gets a new id; linking the two is the store's job (M2.2). A harness that cannot resume fails the start instead of silently beginning a fresh conversation.
Text fragments are separate events (`message.delta`, `reasoning.delta`), and the whole `message` or `reasoning` event always follows. Fragments take sequence numbers like any event but are not stored (M2.1), so a stored log has gaps in its sequence.
Why: the conversation history lives with the harness, so its id is the only handle that restores it; a silent fresh start would look like a resume while the agent had forgotten everything. Keeping the whole message as the record means storage, replay and any consumer that ignores fragments work unchanged. On ACP, `session/load` was rejected because it replays the whole history as new updates.
Limit: a session resumes only in the environment and workspace folder it was created in. Claude Code keeps sessions per folder.
