# Modules

The roadmap. Modules are built in order; each sub-module is one PR. Only the next three modules are detailed; finished ones shrink to what later work builds on. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

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
- Event: one normalized fact a session reports. The UI, storage and orchestration consume only events.
- Environment: where a harness process is launched (native OS, WSL, later a sandbox).
- Adapter: the per-harness translator between the harness's own wire format and events.

---

## Built

### M1 Harness core (done)

`packages/harness` starts one agent on one harness (Claude Code, OpenCode over ACP), natively or in WSL, and reports everything it does as one event stream: plan, nested actions, permission requests and questions, usage limits, live text. It lists each harness's models and effort values and can resume a harness session by its id. `pnpm dev:run` and `pnpm dev:catalog` use it directly.

A new adapter must stay small. Shared behaviour lives outside it:

| Layer | Owns |
|---|---|
| Environment | launching a command, path translation, killing the process tree |
| Process runner | spawn, stdout line framing, stderr capture, exit handling |
| JSON-RPC client | request/response/notification over stdio (ACP now, Codex later) |
| Session | lifecycle, event ids, sequence numbers, timestamps, errors, plan-step attribution |
| Adapter | build the command; pure function native message -> events; encode outgoing commands |

Every adapter passes the same conformance tests, run against recordings of the real CLI.

### M2 Core service (done)

`packages/service` is the long-running core. It runs many sessions at once, stores every event in SQLite before publishing it (D-15, D-30, D-31), and serves one localhost API with a per-launch token (D-17, D-32): tasks, sessions, commands, resume, results, workspaces, settings, harness catalog, store size, the blocked queue, and one event stream that does live updates, catch-up and replay alike. A session runs in a saved workspace or in its own folder inside an output folder (D-33). After a crash or restart, unfinished sessions are marked interrupted and can be resumed. M3 starts it as a child process; M4 adds orchestration inside it, using the same store and API.

---

## M3 Desktop shell and plain UI

### What

The first usable app: open a window, describe a task for a single agent, watch a clean trace of what it does, approve or deny what it asks, and reopen past runs. Deliberately plain. The command-center design is M5.

### Before M3.1

Decide with the owner how agents keep running with the window closed: tray, detached core, or OS service.

### Scope

- **M3.1 Shell.** Electron main process only: single instance, start the core and pass its token to the window, kill the core's process tree on quit. No business logic.
- **M3.2 UI foundation.** React and Vite. One API client and one event store (Zustand) fed by the M2 subscription. Runs in a normal browser against a running core for development.
- **M3.3 New task.** Prompt, harness, environment (native or WSL), model, effort, workspace or output folder. Options shown come from adapter capabilities, not hardcoded per harness.
- **M3.4 Trace view.** Plan steps with their actions nested beneath, sub-agent actions nested again; status per step; results inline; reasoning collapsed by default and expandable.
- **M3.5 Approvals.** A queue of pending permission requests and questions showing agent, task and what is being asked, with approve and deny. Built as its own panel so M4 can add department and autonomy without rewriting it.
- **M3.6 History.** List past sessions and replay one through the same trace view.

Out of scope: departments, multiple agents on one task, the 2D command center, connectors, installer signing and auto-update.

### Integration

`apps/desktop` depends only on `packages/contract`. Every later UI module (M4 panels, M5 command center) reuses the M3.2 client and event store.

---

## Later modules (outline only)

- **M4 Orchestration.** Describe a goal, get a proposed department (roles, harness and model per role) to approve; the app spawns the team; a lead delegates to workers on other harnesses; per-team autonomy; outsourced agents (fresh, isolated, clean-slate reviewers). Guardrails for folders outside a workspace, reached by asking the user or under full autonomy. A department shares one workspace folder chosen by the user; direction to confirm at M4 design: one git worktree and branch per agent, integrated by the lead. An SDLC flow (branch, commit, pull, push, PR through the user's own `git` and `gh` logins) is optional and applies only when the department works on a code repository.
- **M5 Command center.** Departments, dependencies between them, chat, task and status panels. Needs the interface design session first.
- **M6 Connectors.** MCP-based plugins injected per session; an agent can request a connector it lacks. Needs the connector deep dive first.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
