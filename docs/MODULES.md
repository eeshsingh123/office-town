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
- **M9 to M10.5: packaging, providers, macOS.** Self-updating Windows installer and Linux AppImage, ad-hoc signed Mac .dmg betas (D-116), betas on every merge (no CI until the public release, D-135); Codex, Muse, Copilot and Cursor; the Providers page; on a Mac the login shell read once and Claude's usage from its Keychain on Refresh (D-117).
- **After M10 and Phase 2.** OpenCode 1 and 2 (`harness/src/versions.ts`), sub-agents in a side panel, team recovery and mid-turn messages, `propose_change`, Scratch per task, Efficient mode with handovers (`team/handover.ts`), Milestones (`service/src/goal`), and the feedback, audit and design rounds (D-100 to D-114).
- **M11 Unattended runs (D-120 to D-124).** Stored retries, the stopped-lead item, quiet workers, owed results first; one admission queue for every start no person typed (`service/src/queue`); Home's card of tasks a close cut off; keep awake; the notifier (`service/src/notify`).
- **M12 Automations (D-125 to D-134).** A saved New task plus a When, every run an ordinary task through the queue (`service/src/automations`); four event sources behind one interface (`automations/sources/`); Updates to Slack, Discord, Telegram, email or a webhook through an outbox (`notify/`, `features/updates/`); Nothing new runs, notes across runs. Parked: OpenCode 2.4's own automations, MCP events as a source.
- **M15 Ready-made teams and recipes (D-136).** One click into the existing Describe steps (`features/ready-made/`), as data in the app.
- **M16 Feed (D-137 to D-141).** Posts projected by the core from tasks, asks, parts and milestones (`service/src/feed`, `store/feed-store.ts`), `post_update` with its cap, rule-based suggestions; the Feed page, its sidebar dot and Home line, floor bubbles (`features/feed/`). Opt-in progress updates in a task's own card with app-drawn charts and pictures (`feed/progress.ts`, `ProgressUpdate.tsx`).

## Next

### M13 and M14 (outline only, wait until real users ask)

- **M13 Remote control.** A paired phone over Tailscale (D-119); its plan is in the local `docs/briefs/autonomy/README.md`.
- **M14 Always-on host.** The same core on a machine the user owns (D-115, D-119).

### Before the public release (owner's go-ahead)

- The owner has tested a beta and says release.
- Every vetted connector checked again (D-96): any with an advisory removed, the rest re-dated.
- Intro video, discussed with the owner first.
- Code signing through SignPath Foundation, wired in once approved; an Apple Developer ID for Mac signing and notarization (D-116).
- The final name (the app id stays, so a rename breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later (outline only)

- Swarms: discuss first a Decisions list (from send-back notes, `propose_change` answers and handovers) and a read-only goal file, and free workers picking up parts whose inputs are done.
- Agent memory across tasks, after Feed (owner, 2026-11-27); it becomes one more source of Feed suggestions (D-139).
- Deferred: a sandbox environment for computer use.
