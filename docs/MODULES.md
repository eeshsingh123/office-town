# Modules

The roadmap. Modules are built in order; each module is one branch and one PR, with one commit series per sub-module so it can be reviewed commit by commit. The next module is detailed; later ones stay an outline until their design session, and finished ones shrink to what later work builds on. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    M1. Runs one agent session on one harness and emits contract events.
packages/service    M2. Long-running core: session registry, storage, HTTP and SSE API. M4 added teams, the tool server and autonomy.
apps/desktop        M3. Electron shell and React UI.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API defined in `contract`.

## Vocabulary

- Harness: a vendor CLI (Claude Code, OpenCode, Codex, Antigravity).
- Session: one running conversation between the app and one harness process. Resuming starts a new session of the same agent.
- Event: one normalized fact a session reports. The UI, storage and orchestration consume only events.
- Environment: where a harness process is launched (native OS, WSL, later a sandbox).
- Adapter: the per-harness translator between the harness's own wire format and events.
- Agent (employee): a stored worker with a name, a role and settings. It works through sessions.
- Template (profile in code): a saved, harness-neutral description of an agent: role, instructions, harness, model, effort, autonomy. An agent made from one keeps a copy (D-55).
- Department: a team with one lead and its workers, one workspace and one autonomy level.
- Delegation: a piece of work the lead hands a worker, and the result that comes back.
- Autonomy: how much a department's agents may do without asking the user.
- Tool server: the core's own MCP server that gives agents team tools, such as delegating or asking the user.
- Outsourced agent: a fresh agent outside the team that gets only a brief and the work to examine, for a clean-slate review (D-47).

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

`packages/service` is the long-running core. It runs many sessions at once, stores every event in SQLite before publishing it (D-15, D-30, D-31), and serves one localhost API with a per-launch token (D-17, D-32): tasks, sessions, commands, resume, results, workspaces, settings, harness catalog, store size, the blocked queue, and one event stream that does live updates, catch-up and replay alike. A session runs in a saved workspace or in its own folder inside an output folder (D-33). After a crash or restart, unfinished sessions are marked interrupted and can be resumed. `SessionRegistry` is the only thing that starts sessions; M4's team code drives it rather than starting harnesses itself.

### M3 Desktop shell, office and agent panels (done)

`apps/desktop` is the app. The Electron shell starts the core, keeps agents running in the tray (D-34) and forwards `/api` with the token (D-36). The UI has one API client, one Zustand store fed by a single live stream, and pure functions that turn events into a trace (D-37). The office is the home screen (D-35): one open floor, an agent per task, walk-up, click and drag-select, and a side panel. Around it: New task, the trace view, the request card used in the trace and in Needs you, Tasks (history, replay, delete), light and dark themes. M4 builds on all of it: agent identity in `src/store/agents.ts`, the floor plan in `features/office/floor-plan.ts`, the request card in `features/requests`.

### M4 Orchestration (done)

Describe a goal and a team does it. A lead agent proposes a department (roles, and a harness, model and effort for each); the user edits and approves it in Needs you, and can change the team at any time from the department's settings. The lead hands work to workers on any harness through the core's own MCP tool server (D-39, D-43) and gets their results back as messages (D-44). Agents and profiles are stored records (D-42). One autonomy policy in the core guards every agent (D-45). In a git workspace each worker gets its own worktree and branch, which the lead merges (D-46). A guest agent can be called in, by the lead or the user, for a second opinion on a copy of the work, isolated as far as its harness allows (D-47). In the office each department is a room with its own panel (D-48). Team code lives in `packages/service/src/team`, `src/tools` and `src/autonomy` and starts agents only through `SessionRegistry`; the UI adds `features/departments`, `features/profiles` and the team task view. M5 grows the rooms into the command center; M6 attaches connectors through the tool server.

### M5 Command center (built; live run pending)

The office runs several goals across departments at once. A standing chief (`packages/service/src/chief`) splits a goal into a plan of pieces per department; the user edits and approves it, and any re-plan, in Needs you. A scheduler starts a piece once what it waits on is done and its department is free, passes upstream results into the brief, and gives read-only access to upstream folders (D-51). Records reach the UI as `change` frames on the one stream, and the core keeps each task's state, usage and plan limits (D-50). The UI adds the top bar with next-waiting (N), the Overview/Chat/Work panel, the board with To review, the plan card, the chief in New task, the chief's office, plan links, door states and draggable rooms (`features/office`, `chat`, `work`, `board`, `plan`, `chief`). M6 connectors attach through the tool server as before.

Known limits: under Full a shell command, and under Bypass anything, could still change an upstream folder; the plan card warns. One chief, one chief goal at a time.

---

## Next module

M6 Connectors, after its design session (D-11). The M5 live run comes first (see docs/MEMORY.md).

---

## Later modules (outline only)

- **M6 Connectors.** MCP-based plugins injected per session through the tool server seam (D-43); an agent can request a connector it lacks. Needs the connector deep dive first.
- **Agent memory.** What an agent remembers across tasks. Its own module, after a deep dive with the owner on storage, recency and how relevant an old memory still is; its place in the order is set then, before packaging. M4 profiles leave room for it.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
- **Last: Packaging and release.** Built once every other module is done (owner, 2026-10-07). An installer people download and run, with no repository, Node or pnpm: Windows first, Linux packages next, macOS stays parked (D-23). The core and the built UI ship inside the app; the data folder does not move. Node will not strip TypeScript inside `node_modules`, so the core gets a build step for packaging only (D-19 still holds in development), and only `apps/desktop/electron/main.ts` changes where it finds the core and the UI. The WSL tool bridge (`packages/harness/src/environment/tool-bridge.ts`, run by the core's own Node through WSL interop) ships the same way. Code signing (unsigned installers get a SmartScreen warning; a certificate costs money, owner to decide), auto-update from GitHub Releases, and a release workflow in CI.
