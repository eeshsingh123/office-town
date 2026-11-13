# Modules

The roadmap. Modules are built in order; each is one branch and one PR, with one commit series per sub-module. The next module is detailed once chosen; later ones stay an outline; built ones shrink to what later work builds on. A sub-module handed to another agent gets a self-contained story brief (AGENTS.md) in `docs/briefs/`, deleted once built.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    runs one agent session on one harness and emits contract events.
packages/service    the long-running core: registry, store, HTTP and SSE API, teams, tool server, autonomy, chief, connectors.
apps/desktop        Electron shell and React UI; pages live under src/features.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API in `contract`.

## Vocabulary

- Harness: a vendor CLI (Claude Code, OpenCode, Codex and others). "Provider" in what the user reads.
- Session: one running conversation with one harness process. Resuming starts a new session of the same agent.
- Event: one normalized fact a session reports. The UI, storage and orchestration consume only events.
- Environment: where a harness process runs (native, WSL, later a sandbox).
- Adapter: the per-harness translator between its wire format and events.
- Agent (employee): a stored worker with a name, a role and settings, working through sessions.
- Template (profile in code): a saved, harness-neutral agent description; an agent made from one keeps a copy.
- Department: a standing team with one lead, its workers, its workspaces and one permission level.
- Delegation: a piece of work a lead hands a worker, and the result that comes back.
- Tool server: the core's own MCP server giving agents team tools.
- Checker: a fresh agent outside the team that checks finished work against a checklist the user approves.

## Built

What later work builds on; the why is in DECISIONS.md.

- **M1 Harness core.** One agent on one harness, natively or in WSL, as one event stream; models and efforts; resume by the harness's id. Every adapter passes the same conformance tests against recordings. `pnpm dev:run`, `pnpm dev:catalog`.
- **M2 Core service.** Many sessions, every event stored before it is published, one localhost API with a per-launch token and one event stream for live, catch-up and replay. `SessionRegistry` alone starts sessions.
- **M3 Desktop shell.** Electron starts the core, keeps agents in the tray, forwards `/api`. One API client, one Zustand store fed by one stream, pure event-to-trace functions.
- **M4 Orchestration.** A lead proposes a department, the user approves it, and the lead delegates to workers on any harness through the tool server; stored agents and templates, one autonomy policy, a worktree per worker. `service/src/team`, `tools`, `autonomy`.
- **M5 Command center.** A standing chief splits a goal into department pieces run in order, passing results and read-only folders; task state, usage and limits live in the core. `service/src/chief`.
- **Feedback after M5.** Home, creation flows, the Dusk look, review in the chat, templates, workspaces, Needs you, one composer, plain naming, accounts and Usage, team building.
- **M6 Files and Library, M6.5 Onboarding.** Attachments and a workspace Library; setup, tutorials, Help.
- **M7 Connectors, revamped (D-96).** Shared apps through the core's hub for every provider; provider apps (claude.ai, Codex's ChatGPT apps, OpenCode's servers) read from each provider, one card per app with provider tags, every call decided by the core; Add over a vetted list; asks that name the provider. `service/src/connectors`, `features/connectors`.
- **After M7.** Several workspaces per department, usage recount, a lead stopping workers, lean runs with a usage pause, the check loop outside the team.
- **M8 Outputs and preview.** `show_result`, changed files and local sites in a sandboxed viewer. `service/src/outputs`.
- **M9 Packaging.** Self-updating installer (Windows) and AppImage (Linux), the Dev app beside it, betas on every green merge, setup installing harnesses.
- **M10 More providers.** Codex, Muse Code, Copilot and Cursor; the Providers page; an estimate at API prices where a provider shares no usage.
- **After M10.** OpenCode 1 and 2 under one provider (`harness/src/versions.ts`), team recovery and mid-turn messages, `propose_change`, one Scratch folder per task, the two-pane model picker, drafts and kept state, honest progress, right-click menus, plain copy, long histories, launch speed and the performance phase.
- **Phase 2.** Efficient mode: carrying on in a new session with a handover (`team/handover.ts`). Milestones with one Progress view and a Settings page (`service/src/goal`).

## Next

### Before the public release (owner's go-ahead)

- The owner has tested a beta and says release.
- Every vetted connector checked again (D-96): any with an advisory removed, the rest re-dated.
- Intro video, discussed with the owner first.
- Code signing through SignPath Foundation, wired in once approved.
- The final name (the app id stays, so a rename breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later (outline only)

- Swarms: discuss first a Decisions list (from send-back notes, `propose_change` answers and handovers) and a read-only goal file, and free workers picking up parts whose inputs are done.
- Deferred: agent memory across tasks (the harnesses keep their own), macOS (until it can be tested), a sandbox environment for computer use.
