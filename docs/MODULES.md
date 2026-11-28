# Modules

The roadmap. Modules are built in order; each is one branch and one PR. The next module is detailed once chosen; later ones stay an outline; built ones shrink to what later work builds on. A sub-module handed to another agent gets a self-contained story brief (AGENTS.md) in `docs/briefs/`, deleted once built.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    runs one agent session on one harness and emits contract events.
packages/service    the long-running core: registry, store, HTTP and SSE API, teams, tool server, autonomy, chief, connectors.
apps/desktop        Electron shell and React UI; pages live under src/features.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API in `contract`.

## Vocabulary

- Harness: a vendor CLI. "Provider" in what the user reads.
- Session: one running conversation with one harness process. Resuming starts a new session of the same agent.
- Event: one normalized fact a session reports. The UI, storage and orchestration consume only events.
- Environment: where a harness process runs (native, WSL, later a sandbox).
- Adapter: the per-harness translator between its wire format and events.
- Agent (employee): a stored worker with a name, a role and settings. A template (profile in code) is a saved agent description an agent copies.
- Department: a standing team with one lead, workers, workspaces and one permission level. A delegation is a piece of work a lead hands a worker.
- Tool server: the core's own MCP server giving agents team tools.

## Built

Merged: M1 to M12, M15, M16. Where each lives:

- Harness, core, shell: `packages/harness` (`pnpm dev:run`, `pnpm dev:catalog`), `packages/service`, `apps/desktop/electron`.
- Teams, chief, milestones, handovers: `service/src/team`, `tools`, `autonomy`, `chief`, `goal`, `team/handover.ts`.
- Files, connectors, outputs: `attachments`, `library`, `connectors`, `outputs`.
- Packaging: `apps/desktop/packaging`, betas on every merge (D-75, D-116, D-135).
- M11 Unattended runs: `service/src/queue`, `notify`; Home's stopped-tasks card.
- M12 Automations: `service/src/automations` (sources in `automations/sources/`), Updates in `notify/` and `features/updates/`. Parked: OpenCode 2.4's own automations, MCP events as a source.
- M15 Ready-made teams and recipes: `features/ready-made/`, as data.
- M16 Feed and progress updates: `service/src/feed`, `store/feed-store.ts`, `features/feed/`.

## Next

### M13 and M14 (outline only, wait until real users ask)

- **M13 Remote control.** A paired phone over Tailscale (D-119); its plan is in the local `docs/briefs/autonomy/README.md`.
- **M14 Always-on host.** The same core on a machine the user owns (D-115, D-119).

### Before the public release (owner's go-ahead)

- The owner has tested a beta and says release.
- Every vetted connector checked again (D-96): any with an advisory removed, the rest re-dated.
- Intro video, discussed with the owner first.
- Code signing through SignPath Foundation; an Apple Developer ID for Mac signing and notarization (D-116).
- The final name (the app id stays, so a rename breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later (outline only)

- Agent memory across tasks, next after Feed (owner, 2026-11-27); it becomes one more source of Feed suggestions (D-139).
- Swarms: discuss first a Decisions list (from send-back notes, `propose_change` answers and handovers) and a read-only goal file, and free workers picking up parts whose inputs are done.
- Deferred: a sandbox environment for computer use.
