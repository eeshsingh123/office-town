# Modules

The roadmap. Modules are built in order; each module is one branch and one PR, with one commit series per sub-module so it can be reviewed commit by commit. Only the next three modules are detailed; finished ones shrink to what later work builds on. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

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

## M3 Desktop shell, office and agent panels

### What

The first usable app. The home screen is the office (D-35): every running agent is a character at a desk. Walk up to one or click it to see what it is doing; drag across several to see them grouped. From an agent, open a clean trace of its work, approve or deny what it asks, and reopen past runs. One agent per task; departments as rooms come in M4 and M6. Mockups: see MEMORY.md.

### Scope

- **M3.1 Shell.** Electron main process only: single instance; start the core and stop it cleanly on quit (D-34); closing the window keeps everything running in the tray; serve the UI and forward `/api` to the core with the token (D-36). No business logic.
- **M3.2 UI foundation.** React and Vite. One API client and one event store (Zustand) fed by the single live stream; the trace is built by pure, tested functions. The app frame: sidebar, office as home, side panel for agents, light and dark themes, the design tokens (D-37). Runs in a normal browser against a running core for development.
- **M3.3 New task.** Prompt, harness, environment (native or a WSL distro from `GET /environments`), model, effort, permission mode, workspace or output folder. Options come from adapter capabilities and the catalog, not hardcoded per harness. The model list shows recent, free and plan models first, with a filter. Last choices are remembered per harness; saved agent profiles are M4.
- **M3.4 Trace view.** Plan steps with their actions nested beneath, sub-agent actions nested again; status per step; results inline; reasoning collapsed by default and expandable. An interrupted session shows its open actions as interrupted. A message box sends a follow-up prompt, or resumes an ended session.
- **M3.5 Approvals.** A request shows in the trace where it happened and in the "Needs you" queue, as the same card: agent, task, what is asked, and the options the harness offers. Its own component, so M4 adds department and autonomy without rewriting it. A system notification when the window is not focused.
- **M3.6 History.** List past tasks and replay one through the same trace view; delete a task; warn when the store grows large.
- **M3.7 Office.** One open floor. Each running or recently finished agent is a character at a desk showing its status. Walk with the keyboard and press a key next to an agent, or click it: the side panel shows its task, step, current action and any request. Drag a box to select several: the panel lists them grouped (by status in M3, by department from M4), with stop and message for all. Drawn with DOM or SVG inside React, so selection, keyboard focus and screen readers work; a canvas engine only if it gets slow.

Core additions M3 needs, all additive: the core stops cleanly when its stdin closes (`--stop-when-stdin-closes`); `GET /environments`; `GET /tasks` includes each task's sessions, and `GET /tasks?active=true` lists every task with an open agent, which the office and the quit prompt need wherever that task sits in the list; harness descriptions carry a `name`; catalog models may carry `provider` and `access` (free, plan or paid).

Out of scope: departments and rooms, several agents on one task, dependencies between departments, chat between agents, connectors, saved agent profiles, installer, signing and auto-update (M5).

### Integration

`apps/desktop` depends only on `packages/contract`; the shell starts the core as a separate process and never imports it. Every later UI module (M4 panels, M6 command center) reuses the M3.2 client, event store and frame, and grows the M3.7 office.

---

## Later modules (outline only)

- **M4 Orchestration.** Describe a goal, get a proposed department (roles, harness and model per role) to approve; the app spawns the team; a lead delegates to workers on other harnesses; per-team autonomy; outsourced agents (fresh, isolated, clean-slate reviewers). Guardrails for folders outside a workspace, reached by asking the user or under full autonomy. A department shares one workspace folder chosen by the user; direction to confirm at M4 design: one git worktree and branch per agent, integrated by the lead. An SDLC flow (branch, commit, pull, push, PR through the user's own `git` and `gh` logins) is optional and applies only when the department works on a code repository.
- **M5 Packaging and release.** An installer people download and run, with no repository, Node or pnpm: Windows first, Linux packages next, macOS stays parked (D-23). The core and the built UI ship inside the app; the data folder does not move. Node will not strip TypeScript inside `node_modules`, so the core gets a build step for packaging only (D-19 still holds in development), and only `apps/desktop/electron/main.ts` changes where it finds the core and the UI. Code signing (unsigned installers get a SmartScreen warning; a certificate costs money, owner to decide), auto-update from GitHub Releases, and a release workflow in CI. After M4, so the first release has cross-harness teams, the product's differentiator.
- **M6 Command center.** The M3 office grows into departments as rooms, dependencies between them, chat, task and status panels.
- **M7 Connectors.** MCP-based plugins injected per session; an agent can request a connector it lacks. Needs the connector deep dive first.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
