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
- **M11 Unattended runs (D-120 to D-124).** Stored retries and the stopped-lead item (`team/lead-stopped.ts`), quiet workers, owed results first; one admission queue for every start no person typed (`service/src/queue`); Home's card of tasks a close cut off; keep awake (`GET /keep-awake`); the notifier (`service/src/notify`).

## Next

### M12 Automations (D-125 to D-134)

An automation is a saved New task plus a When; every run is an ordinary task with its origin, through M11's queue. Mockup rejected (owner): the screens reuse the app's own parts.

- **PR 1, merged (#104).** Contract (automation, run, origin, run queue entries, Auto answers); store files `automations-store.ts` beside the M11 ones; the clock on croner (`automations/clock.ts`); the runner (`automations/runner.ts`, `run-task.ts`): run keys, one waiting run per automation, oldest first per department across the queue and the chief's pieces, chains set on the later one, depth 5, re-queue after a restart, three failures pause; Auto decisions (`auto-decisions.ts`); `propose_schedule`; the Describe drafter (`drafts/automations.ts`); New automation (Describe, Task in the New task box with fill-ins, When, Rules, Review), the Automations page, one automation with its runs, Home's card, the origin chip, Tasks' Started by filter, the quit question, Open at login offered once, a Settings row; the core's file-change notes between agents in one workspace (`team/shared-files.ts`, D-127).
- **PR 2, merged (#105).** Events (D-128): one source interface (`automations/sources/source.ts`), the watch that starts each automation's source (`watch.ts`), four sources (folder, feed, GitHub, agent check with `report_found`), `automation-events-store.ts` (seen keys, pending events, each source's place), event runs in the runner (one run a burst, joins a waiting run, waits for a working one), `{event}` as a data block, When something arrives in New automation; apps that act without asking in an automation's runs (D-129, `automationAllows` in `connectors/access.ts`).
- **PR 3, on `feat/automation-delivery`.** Automations end to end (owner, 2026-11-24; mockup waived), with Updates: places connected once through one Connect sheet with a guide per service, what each hears in Settings > Updates, Send result on a task, places in an automation's Rules, sent results shown under them (D-130: `notify/notifier.ts`, `notify/outbox.ts`, `notify/destinations/` one file per service, `notify/telegram-link.ts`, `features/updates/`); Nothing new runs (D-131, `automations/run-tools.ts`); notes across runs (D-133); the two message gaps closed (D-134, each adapter's `waiting()`).
- **Parked (owner, 2026-11-24).** OpenCode's own automations (2.4) made inside our tasks, shown and brought over as ours. First confirm live whether they fire in OpenCode's background service.
- **Later.** Answering from afar belongs to M13's phone; two-way Telegram, Slack (Socket Mode) or Discord (a bot on its Gateway) only if the owner asks for it after that; a team of people answering from a shared channel is its own module, discussed first. MCP events (SEP-3415, Beta) as one more source, once an app the owner uses offers them.

### M15 Ready-made teams, next after M12 (owner, 2026-11-24)

A new user picks a "Content team" or a "Code review team" and starts in a minute instead of designing one. Discussion first; kickoff in the local `docs/briefs/ready-made-teams/README.md`.

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
- Deferred: agent memory across tasks (the harnesses keep their own), a sandbox environment for computer use.
