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
- Profile: a saved, harness-neutral description of an agent: role, instructions, harness, model, effort, autonomy.
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

---

## Next module

### M5 Command center

The office becomes the place to run several goals across departments at once. A chief agent splits a big goal across departments and sets their order; the floor shows who waits on whom; the user can chat with any lead or agent, read hand-offs as conversations, and never misses a waiting request or a finished result. The owner's choices are D-49.

What the user gets:
- New task: give a goal to a solo agent, to one department (as today), or to the chief.
- The chief: one standing agent, set up once (harness, model, effort), in its own office at the top of the floor. It runs one big goal at a time; later ones wait in a queue. It proposes a plan of pieces, each for a department (or a new department it proposes through the M4 team proposal), with a brief and the pieces it waits on. The user edits and approves the plan in Needs you. Pieces with nothing to wait on run in parallel; a piece whose department is busy is queued. A finished piece's result goes into the next department's brief, and that department may read, not change, the upstream workspace. The chief gets every result, can message leads while they work, and proposes a changed plan when a piece fails; the user approves the change.
- Floor: links from the chief's office and between rooms show the plan, each waiting, active, done or failed; a hand-off moves along its link (shown without motion under reduced motion). A room's door shows its state: working, needs you, queued, to review. Rooms are placed automatically and can be dragged; their position is kept.
- Top bar: how many agents are working, need you, are queued or wait for review, and each harness's plan window. "N need you" is a button: each click, or a hotkey, pans to the next waiting agent and opens its request there.
- Right panel: tabs for whatever is selected (chief, room or agent): Overview (today's panels), Chat and Work.
  - Chat: one conversation per agent across its goals; a department's chat is its lead's; delegations and hand-offs read as threads (brief, questions, result). A message to a worker also sends its lead a short note.
  - Work: the chief's plan with each piece's state; a department's goal, delegations and queue; an agent's steps.
- Board: a toggle beside the floor shows the same goals and pieces in columns: Needs you, Working, Waiting (on another team, or queued), To review, Done.
- Review: a finished goal waits in To review, with an unread dot, until the user marks it reviewed or sends a follow-up. A chief's pieces report to the chief, so only the chief's goal goes to review.

Out of scope: a strip of agent portraits, a minimap with zoomed-out room cards, harness badges on characters (left out by the owner, possible later); pausing near a usage limit (D-29 holds); several chiefs, or a chief running two goals at once; connectors; agent memory.

Sub-modules, one commit series each, in this order:
- **M5.0 Mockups.** The screens above as an artifact the owner accepts before any UI work: top bar, floor with the chief's office and links, the tabbed panel with Chat and Work, the board, the plan card, New task's chief choice.
- **M5.1 Live team state in the core.** Departments, agents, delegations and plans reach the UI as they change, through the one event stream, not polling. The core sums usage per department and keeps each harness's latest plan window, so the UI stops replaying every trace for them. A task carries its state (working, waiting, idle, ended) and when it was reviewed. New routes: an agent's sessions across goals (its chat history), usage, mark reviewed.
- **M5.2 Chief and plans in the core.** The chief record and its settings; `propose_plan` (also used to re-plan) and stored plan pieces with their dependencies; a scheduler that starts a piece when its upstream pieces are done and its department is free; the hand-off (results in the brief, read-only upstream folders enforced by the autonomy policy); results back to the chief as with leads (D-44); `message_lead`. Starts with a spike: read-only access to an extra folder on Claude Code and OpenCode, natively and in WSL.
- **M5.3 Command panels.** Top bar and the next-waiting button, the tabbed panel with Chat and Work, direct messages with the note to the lead, the plan card in Needs you, the board and the review flow, the chief choice in New task, chief settings.
- **M5.4 Floor.** The chief's office, links and hand-off motion, room door states, draggable rooms.

Done when one live run (cheap models, two harnesses) shows: a chief goal across two departments is proposed, edited and approved; a downstream piece waits, then starts with the upstream result; a busy department queues its piece; a failed piece leads to an approved re-plan; the goal lands in To review.

Known limits: the event stream is per session, so team-level changes need a notice outside sessions (settled in M5.1). A department in Bypass has no guard (D-45), so it could write to an upstream folder; the plan card says so.

---

## Later modules (outline only)

- **M6 Connectors.** MCP-based plugins injected per session through the tool server seam (D-43); an agent can request a connector it lacks. Needs the connector deep dive first.
- **Agent memory.** What an agent remembers across tasks. Its own module, after a deep dive with the owner on storage, recency and how relevant an old memory still is; its place in the order is set then, before packaging. M4 profiles leave room for it.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
- **Last: Packaging and release.** Built once every other module is done (owner, 2026-10-07). An installer people download and run, with no repository, Node or pnpm: Windows first, Linux packages next, macOS stays parked (D-23). The core and the built UI ship inside the app; the data folder does not move. Node will not strip TypeScript inside `node_modules`, so the core gets a build step for packaging only (D-19 still holds in development), and only `apps/desktop/electron/main.ts` changes where it finds the core and the UI. The WSL tool bridge (`packages/harness/src/environment/tool-bridge.ts`, run by the core's own Node through WSL interop) ships the same way. Code signing (unsigned installers get a SmartScreen warning; a certificate costs money, owner to decide), auto-update from GitHub Releases, and a release workflow in CI.
