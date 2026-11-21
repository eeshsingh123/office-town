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

- **M1 to M3: harness, core, shell.** One agent on one harness (native or WSL) as one event stream, adapters tested against recordings (`pnpm dev:run`, `pnpm dev:catalog`); one core with a stored, replayable event stream behind a localhost API; an Electron shell with the tray, one API client and one store.
- **M4, M5: teams and the chief.** Departments, a lead delegating across harnesses through the tool server, one autonomy policy, a worktree per worker (`service/src/team`, `tools`, `autonomy`); a standing chief running goals as department pieces (`service/src/chief`).
- **M6 to M8: files, onboarding, connectors, outputs.** Attachments and a Library; setup, tutorials and Help; shared and provider apps through the core's hub (`service/src/connectors`); `show_result` in a sandboxed viewer (`service/src/outputs`).
- **M9 to M10.5: packaging, providers, macOS.** Self-updating Windows installer and Linux AppImage, ad-hoc signed Mac .dmg betas (D-116), betas on every green merge; Codex, Muse, Copilot and Cursor; the Providers page; on a Mac the login shell read once and Claude's usage from its Keychain on Refresh (D-117), CI and a smoke job on a Mac runner.
- **After M10 and Phase 2.** OpenCode 1 and 2 (`harness/src/versions.ts`), sub-agents in a side panel, team recovery and mid-turn messages, `propose_change`, Scratch per task, Efficient mode with handovers (`team/handover.ts`), Milestones (`service/src/goal`), and the feedback, audit and design rounds (D-100 to D-114).

## Next

### M11 Unattended runs (D-120 to D-124)

Work keeps going, or comes back, without the user at the desk: after a close, a crash or a restart, and through sleep where the system allows it. No mockup (owner). Every task is the user's; task origin moves to M12.

- **A. Durable retries and the recovery gaps** (`team/results.ts`, `team/lead-stopped.ts`, `team/quiet-workers.ts`). The one retry stored for delegations and leads; a lead that fails after its retry gets the Needs you item Try again or Stop; a worker with no news for 30 minutes shows so and its open lead hears once; results the lead never got go first when it resumes.
- **B. Admission queue** (`service/src/queue`). One check shared with a person's start; stored entries, each wait and skip with its reason; two at a time, spaced; at most 100 waiting, 12 hours each. Only Resume all and Choose add entries in M11.
- **C. Resume after a restart.** The Home card "N tasks stopped when Office Town closed." with Resume all, Choose and close, through the queue; a chief goal is one row; paused tasks keep their pause; gone folders and accounts say so; a crash loop stops after 2 launches.
- **D. Keep awake.** `GET /keep-awake`, the shell's `powerSaveBlocker` while agents work, the Settings > Desktop switch.
- **E. Notifier** (`service/src/notify`). The core decides and stores notices, never with agent text, coalesced, kept 30 days and 500 at most; the window shows them; a switch per kind in Settings > Notifications.
- Out of scope: task origin and the quit warning (M12), the two message gaps (M13), an in-app list of notices.

### M12 to M15 (outline only)

- **M12 Automations.** Schedules, events and chains whose runs are ordinary tasks, through M11's queue; task origin; durable run keys; `propose_schedule` (D-118).
- **M13 Remote control.** A paired phone over Tailscale (D-119).
- **M14 Always-on host.** The same core on a machine the user owns (D-115, D-119).
- **M15 Ready-made teams.** Importable teams; independent of M11 to M14.

### Before the public release (owner's go-ahead)

- The owner has tested a beta and says release.
- Every vetted connector checked again (D-96): any with an advisory removed, the rest re-dated.
- Intro video, discussed with the owner first.
- Code signing through SignPath Foundation, wired in once approved; an Apple Developer ID for Mac signing and notarization (D-116).
- The final name (the app id stays, so a rename breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later (outline only)

- Swarms: discuss first a Decisions list (from send-back notes, `propose_change` answers and handovers) and a read-only goal file, and free workers picking up parts whose inputs are done.
- Deferred: agent memory across tasks (the harnesses keep their own), a sandbox environment for computer use.
