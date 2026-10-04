# Modules

The roadmap. Modules are built in order; each module is one branch and one PR, with one commit series per sub-module so it can be reviewed commit by commit. The next module is detailed; later ones stay an outline until their design session, and finished ones shrink to what later work builds on. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    M1. Runs one agent session on one harness and emits contract events.
packages/service    M2. Long-running core: session registry, storage, HTTP and SSE API. M4 adds teams, the tool server and autonomy here.
apps/desktop        M3. Electron shell and React UI.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API defined in `contract`.

## Vocabulary

- Harness: a vendor CLI (Claude Code, OpenCode, Codex, Antigravity).
- Session: one running conversation between the app and one harness process. Resuming starts a new session of the same agent.
- Event: one normalized fact a session reports. The UI, storage and orchestration consume only events.
- Environment: where a harness process is launched (native OS, WSL, later a sandbox).
- Adapter: the per-harness translator between the harness's own wire format and events.
- Agent (employee): a stored worker with a name, a role and settings. It works through sessions. From M4.
- Profile: a saved, harness-neutral description of an agent: role, instructions, harness, model, effort, autonomy. From M4.
- Department: a team with one lead and its workers, one workspace and one autonomy level. From M4.
- Delegation: a piece of work the lead hands a worker, and the result that comes back. From M4.
- Autonomy: how much a department's agents may do without asking the user. From M4.
- Tool server: the core's own MCP server that gives agents team tools, such as delegating or asking the user. From M4.
- Outsourced agent: a fresh agent outside the team that gets only a brief and the work to examine, for a clean-slate review (D-18). From M4.

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

---

## M4 Orchestration

### What

Describe a goal and a team does it. A lead agent proposes a department: its roles, and a harness, model and effort for each. The user edits and approves it. The lead then hands pieces of work to workers, which may run on other harnesses, gets their results back and puts them together. The department works in one workspace under an autonomy level the user sets; anything beyond that level waits in Needs you. An outsourced agent can be called in for a clean-slate review. In the office, each department is a room. Product choices are in D-40. Mockups: see MEMORY.md.

### How it works

- **Team tools through MCP.** Both harnesses can call tools on an MCP server, so the core serves one (the tool server) and attaches it to each team agent's session. The lead gets `propose_team`, `delegate`, `team_status` and `outsource`; every team agent gets `ask_user`. This needs nothing harness-specific beyond how an adapter attaches a server, and it is the same seam M7 connectors will use.
- **Tools return at once.** A tool never waits for a person or for another agent. The outcome (proposal approved, worker finished) reaches the lead later as a new message from the core. This avoids harness tool timeouts and lets several workers run at the same time.
- **One guardrail point.** Agents run in the harness's `ask` mode and the core's autonomy policy answers what the level allows; the rest goes to the user. The guardrail is the same for every harness. Bypass stays as an explicit, warned choice that turns the guardrail off.
- **Briefs are messages.** An agent's role, the goal and its piece of work reach it as its first message, shown in the trace as a collapsed brief. That works the same on every harness and survives a resume.

### Before M4.2

The owner accepts the M4 mockups (MEMORY.md).

### Scope

- **M4.1 Spike: team tools on real harnesses.** A throwaway script, no product code. It proves, with Claude haiku and a free OpenCode model, natively and in WSL: (a) Claude through `--mcp-config` with our tools pre-allowed, and OpenCode through ACP's `mcpServers` with an allow rule, both call a tool on a server the core hosts; (b) a WSL harness can reach it: WSL2 cannot reach Windows' `127.0.0.1` by default, so try a small stdio bridge run through WSL's Windows interop, and see whether mirrored networking is needed; (c) what isolation each harness offers for outsourced agents (Claude `--bare`, `--strict-mcp-config`, `--setting-sources`; OpenCode `--pure`) and what still loads (instruction files, harness memory, the user's MCP servers); (d) whether a git worktree made by Windows git works from WSL git (relative worktree paths). Output: recordings for the conformance tests and the decision written into DECISIONS.md. If WSL agents cannot reach the tool server without the user changing WSL settings, WSL agents can be workers but not leads, until fixed.
- **M4.2 Agents and profiles.** An agent becomes a stored record: a unique handle, a colour, a role and an optional department; every session belongs to one agent. The migration gives each M3 task one agent and keeps its current handle, so no name changes. Agents can be renamed. Profiles are saved descriptions of an agent, like a character creator: name, role, instructions, harness, environment, model, effort, autonomy. Defaults flow department, then role, then agent. No per-provider logic outside an adapter. New task starts from a profile or from the last choices, as in M3. The UI's agent identity moves from task to agent, so the office, the panels and Needs you key on agents. API: profiles CRUD, rename an agent.
- **M4.3 Tool server.** The core serves MCP over HTTP under its own port, with one token per agent session, so every call is known to come from one agent and can only act as that agent. The UI's token cannot reach it, nor an agent's token the API. Adapters get one new launch option, the tool servers to attach; it is never stored, as tokens last one launch. Claude attaches them with `--mcp-config` and pre-allows our tools; OpenCode through ACP `mcpServers` and a permission rule. A tool can put a request in Needs you: stored, shown and answered like a harness's own, with the answer sent back to the agent as a message. This sub-module ships `ask_user`, which also gives OpenCode agents a way to ask the user (ACP has none). Calls to our tools show in the trace with plain titles; a delegation shows as a `delegate` action through one shared rule, not per adapter. Recordings for both harnesses.
- **M4.4 Departments and the team proposal.** A department has a name, one workspace (required, shared by the whole team), an autonomy level, a lead and its roles; each role is one agent, with a purpose and a profile or its own harness, model and effort; two agents in the same role are two rows. New task gets a choice of one agent or a team; for a team: the goal, an existing department or "let the lead propose a team", the lead's profile, the workspace and the autonomy level. The lead starts with `propose_team`, which only accepts harnesses and models installed on this machine (from the catalog). The proposal shows as a card in Needs you and in the lead's trace: change a role, its harness, model or effort; add or remove roles; approve, or send it back with a note. Approving saves the department and creates its agents. The lead may propose again later to change the team; every change is approved the same way. The user can also make a department by hand, and add, remove or change members at any time from the department panel; the lead is told of each change by a message from the core. A task belongs to one department, or to none (a solo agent, as in M3).
- **M4.5 Delegation.** `delegate(agent, brief)` starts the worker on its piece: a new session if it has none, a message if it is open, a resume if it ended. Its first message is its brief: role, goal, the lead's instructions. When the worker's turn ends, its last message is the result and goes to the lead as a message from the core; a failed, stopped or interrupted worker is reported the same way. Workers run at the same time. `team_status` lists each member's state and open delegations. A delegation is stored (lead, worker, brief, status, result), and the trace links the lead's delegate action to the worker's trace and back. Only the lead delegates; workers cannot hire. Agents left idle for 10 minutes are stopped, solo agents included, and resumed when next needed (fixes M3's agents that keep a process open after "Done"). Stop the team stops every member. After a restart, a team task shows interrupted, and Continue resumes the lead with a list of the delegations that were cut off. The task view shows the task's agents as a tree by delegation, each opening its own trace; Tasks shows team tasks with their members.
- **M4.6 Autonomy and guardrails.** A level per department, which a profile or agent may lower: Supervised (every request goes to the user), Trusted (the core allows reading and editing inside the workspace; commands, web access, outward actions and anything outside the workspace ask) and Full (everything allowed, folders outside the workspace and outward actions included, each one recorded). Bypass remains a fourth choice: the harness's own bypass mode, where it asks nothing and the core sees no requests; choosing it shows a clear warning that nothing is guarded or asked. Autonomy replaces the permission mode everywhere, solo agents included; M3's `ask`, `acceptEdits` and `bypass` map to Supervised, Trusted and Bypass. Agents run in the harness's `ask` mode; the policy reads the action behind each request (its kind, the folders it touches, the command) and asks the user whenever it cannot tell. Who answered, the user or autonomy, is stored and shown in the trace. Outward actions are `git push`, opening a PR, and publishing anything. Needs you shows each request's department and groups by it. No "Approve all": the autonomy level is how the user lets many things through. A level changed while agents run applies to the next request.
- **M4.7 Git worktrees and the code flow.** When the workspace's first folder is a git repository, each worker works in its own worktree and branch, made from the lead's branch and kept inside the data folder, so the user's folder gains nothing but branches. The lead works in the main folder and merges the workers' branches. Worktrees are removed when their work is merged or the task is deleted. A workspace that is not a repository is shared by the whole team. An optional code flow per department (commit, pull, push, open a PR through the user's own `git` and `gh` logins) is described in the lead's brief, and its outward steps go through autonomy.
- **M4.8 Outsourced agents.** A fresh agent with no shared history: it gets a brief and the work to examine, copied into a new folder, so it cannot change the original. Adapters get a launch option `isolated` that skips the user's and the project's instruction files, memory, MCP servers and plugins, as far as the harness allows; a capability says how far, and the UI says so when isolation is partial. The lead calls one with `outsource(brief, paths, profile)`, and the user from an agent's panel ("Get a second opinion"). Its result goes back to whoever asked. It is not a department member and leaves when done.
- **M4.9 Departments in the office.** Each department is a room on the same floor plan, with its lead and workers at desks. Solo agents stay on the open floor; outsourced agents sit at a guest desk. A room shows its name, the goal in progress, its autonomy level, a count of requests waiting, and its usage: each harness's own limit, or tokens where none is reported (D-29); an agent's panel shows its own. Walking into a room or clicking its sign opens the department panel: members and their state, open delegations, usage, autonomy, Stop team and Message lead. Drag-select groups by department.

Core and contract additions M4 needs: agent, profile, department and delegation records; a session's `agentId`; a task's `departmentId`; requests made by the tool server; who answered a request; adapter launch options for tool servers and isolation, and an isolation capability. All additive except sessions belonging to agents, which M4.2 migrates.

Out of scope: dependencies between departments, several departments on one task, chat between agents beyond delegation, workers delegating or messaging each other, agent memory (its own module), connectors (M7; the tool server is the seam they will use), logging in to providers from the app, installer (M5).

### Integration

Team code lives in `packages/service` beside the registry (`src/team`, `src/tools`, `src/autonomy`) and starts agents only through `SessionRegistry`. Adapters change only to attach tool servers and to isolate; translators stay pure (D-20). The UI adds `features/departments`, `features/profiles` and a team task view, reusing the M3 store, trace functions, request card and floor plan. M6 grows the M4 rooms into the command center; M7 attaches connectors through the M4.3 seam.

---

## Later modules (outline only)

- **M5 Packaging and release.** An installer people download and run, with no repository, Node or pnpm: Windows first, Linux packages next, macOS stays parked (D-23). The core and the built UI ship inside the app; the data folder does not move. Node will not strip TypeScript inside `node_modules`, so the core gets a build step for packaging only (D-19 still holds in development), and only `apps/desktop/electron/main.ts` changes where it finds the core and the UI. If M4's WSL tool bridge runs a script, it ships the same way. Code signing (unsigned installers get a SmartScreen warning; a certificate costs money, owner to decide), auto-update from GitHub Releases, and a release workflow in CI. After M4, so the first release has cross-harness teams, the product's differentiator.
- **M6 Command center.** The M4 rooms grow into the command center: dependencies between departments, chat, task and status panels.
- **Agent memory.** What an agent remembers across tasks. Its own module, after a deep dive with the owner on storage, recency and how relevant an old memory still is; its place in the order is set then. M4 profiles leave room for it.
- **M7 Connectors.** MCP-based plugins injected per session through the M4.3 seam; an agent can request a connector it lacks. Needs the connector deep dive first.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
