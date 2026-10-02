# Modules

The roadmap. Modules are built in order; each sub-module is one PR. Only the next three modules are detailed. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    M1. Runs one agent session on one harness and emits contract events.
packages/service    M2. Long-running core: session registry, storage, HTTP and SSE API.
apps/desktop        M3. Electron shell and React UI.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API defined in `contract`.

## Vocabulary

- Harness: a vendor CLI (Claude Code, OpenCode, Codex, Antigravity).
- Session: one running conversation between the app and one harness process. One employee has one session.
- Event: one normalized fact a session reports (see M1.2). The UI, storage and orchestration consume only events.
- Environment: where a harness process is launched (native OS, WSL, later a sandbox).
- Adapter: the per-harness translator between the harness's own wire format and events.

---

## M1 Harness core

### What

A headless library that starts one agent on one harness, sends it a prompt, and reports everything it does as a single normalized event stream, including permission requests the caller must answer. No storage, no UI, no multi-agent logic.

### Design that keeps adapters small

All shared behaviour lives outside the adapters:

| Layer | Owns | Shared by |
|---|---|---|
| Environment | launching a command, path translation, killing the process tree | all harnesses |
| Process runner | spawn, stdout line framing, stderr capture, exit handling | all harnesses |
| JSON-RPC client | request/response/notification over stdio | ACP now, Codex later |
| Session | lifecycle state machine, event ids, sequence numbers, timestamps, errors, plan-step attribution | all harnesses |
| Adapter | 1. build the command from session options. 2. pure function: native message -> events. 3. encode outgoing prompt, permission answer, interrupt | one harness |

An adapter contains no process, lifecycle or bookkeeping code. Every adapter must pass the same shared conformance tests.

### Scope

- **M1.1 Tooling.** pnpm workspace, strict TypeScript, Biome (lint and format), Vitest, GitHub Actions running lint, typecheck and tests on every PR. Empty `contract` and `harness` packages that build.
- **M1.2 Event contract.** In `packages/contract`: schemas and inferred types for
  - session options: harness, environment, workspace path (optional), model, effort, permission mode;
  - commands: start, prompt, answer permission, answer question, interrupt, stop;
  - the event envelope: id, session id, sequence, timestamp, type, payload;
  - event types: session started / ended, turn started / ended (with token usage when reported), message, reasoning, plan updated (ordered steps with status), action started / updated / ended (kind, title, input, result, parent action id), permission requested / resolved, question requested / resolved, error;
  - adapter capabilities: which of reasoning, plan, effort, model list, resume a harness supports.
  Nesting rule: an action with a parent action id is a sub-step (this is how a harness's own sub-agents appear). An action with no parent is attributed to the plan step that was in progress when it started.
- **M1.3 Process runner and native environment.** `Environment` interface with a native implementation; binary lookup on PATH; line-framed stdout; clean kill of the whole process tree on Windows; no console window flash.
- **M1.4 Claude Code adapter.** Drives `claude` in stream-json mode. Starts with a short spike confirming the permission round trip over stdio; if it is not viable on the stock CLI, stop and raise it before continuing. Tests run against recorded output, so CI needs no subscription.
- **M1.5 Dev command.** `pnpm dev:run "<prompt>" --harness claude` prints events as readable lines and asks on the console when a permission is requested. This is the module's demo and manual test.
- **M1.6 OpenCode adapter.** Shared JSON-RPC client plus an ACP adapter driving `opencode acp`. Any contract change this forces is made here, before anything is stored.
- **M1.7 WSL environment.** Second `Environment`: launch through `wsl.exe` in a chosen distro, find the binary through the distro's login shell, translate paths both ways (command arguments and paths inside events), kill across the boundary.
- **M1.8 Catalog and effort.** Each adapter says how to ask its CLI for the models it offers and the effort values each model accepts; one shared function runs that query in any environment. Effort is applied on ACP harnesses through the protocol's own session setting. `pnpm dev:catalog` prints the list.

Out of scope: storage, more than one session, orchestration, any UI, Codex and Antigravity adapters, connectors.

### Integration

`packages/harness` exports one entry point: create a session from options, send commands, subscribe to events, and describe what a harness offers. M2 is its only consumer in the product. The dev command is a second consumer that proves the API is usable without M2.

---

## M2 Core service

### What

The long-running local process behind the app. It runs many sessions at once, stores every event, and exposes one API the UI connects to. After M2, work continues with the window closed and any past session can be replayed.

### Scope

- **M2.1 Store.** SQLite file in the OS app-data folder. Append-only event log plus tables for sessions, tasks, workspaces and settings; versioned migrations. Streaming text deltas are not stored, only completed messages. Large action results go to files beside the database, referenced from the event, with a size cap.
- **M2.2 Session registry.** Start, stop, list and look up sessions; every event is written to the store before it is published. After a core restart, an unfinished session is marked interrupted and can be resumed through the harness's own session id.
- **M2.3 API.** HTTP on localhost with a per-launch token. Requests for commands and queries; one server-sent event stream that resumes from a sequence number, so live updates, reconnect catch-up and replay are the same mechanism. API message schemas live in `packages/contract`.
- **M2.4 Workspaces and pending approvals.** A session may have a workspace folder or none. With none, the caller must supply an output folder; the last choice is remembered as the default. A query returns all unanswered permission requests across sessions: the data behind the blocked queue.

Out of scope: UI, departments and delegation, connectors, cloud sync, any external queue or database server.

### Integration

`packages/service` consumes `packages/harness` and is the only thing the UI talks to. M3 starts it as a child process. M4 adds orchestration inside it, using the same store and API.

### Decided with the owner (2026-10-03), to be designed in the sub-module named

- Retention (M2.1): nothing is deleted automatically. The user deletes; the app warns when the store grows large.
- Audit copy (M2.1): the harness's raw native messages are stored as well as the events. The session does not expose them yet.
- Workspaces (M2.4): a workspace can be several folders. A folder outside it is reached by asking the user or under full autonomy, always behind guardrails.

### Open for discussion

- How agents keep running with the window closed (tray, detached core, or OS service). Required; the owner wants a discussion before M3.1 is built.

---

## M3 Desktop shell and plain UI

### What

The first usable app: open a window, describe a task for a single agent, watch a clean trace of what it does, approve or deny what it asks, and reopen past runs. Deliberately plain. The command-center design is M5.

### Scope

- **M3.1 Shell.** Electron main process only: single instance, start the core and pass its token to the window, kill the core's process tree on quit. No business logic.
- **M3.2 UI foundation.** React and Vite. One API client and one event store (Zustand) fed by the M2 subscription. Runs in a normal browser against a running core for development.
- **M3.3 New task.** Prompt, harness, environment (native or WSL), model, effort, workspace or output folder. Options shown come from adapter capabilities, not hardcoded per harness.
- **M3.4 Trace view.** Plan steps with their actions nested beneath, sub-agent actions nested again; status per step; results inline; reasoning collapsed by default and expandable.
- **M3.5 Approvals.** A queue of pending permission requests showing agent, task and what is being asked, with approve and deny. Built as its own panel so M4 can add department and autonomy without rewriting it.
- **M3.6 History.** List past sessions and replay one through the same trace view.

Out of scope: departments, multiple agents on one task, the 2D command center, connectors, installer signing and auto-update.

### Integration

`apps/desktop` depends only on `packages/contract`. Every later UI module (M4 panels, M5 command center) reuses the M3.2 client and event store.

---

## Later modules (outline only)

- **M4 Orchestration.** Describe a goal, get a proposed department (roles, harness and model per role) to approve; the app spawns the team; a lead delegates to workers on other harnesses; per-team autonomy; outsourced agents (fresh, isolated, clean-slate reviewers). A department shares one workspace folder chosen by the user; direction to confirm at M4 design: one git worktree and branch per agent, integrated by the lead. An SDLC flow (branch, commit, pull, push, PR through the user's own `git` and `gh` logins) is optional and applies only when the department works on a code repository.
- **M5 Command center.** Departments, dependencies between them, chat, task and status panels. Needs the interface design session first.
- **M6 Connectors.** MCP-based plugins injected per session; an agent can request a connector it lacks. Needs the connector deep dive first.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
