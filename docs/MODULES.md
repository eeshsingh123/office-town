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
- **M9, M10: packaging, more providers.** Self-updating Windows installer and Linux AppImage with betas on every green merge; Codex, Muse, Copilot and Cursor; the Providers page.
- **After M10 and Phase 2.** OpenCode 1 and 2 (`harness/src/versions.ts`), sub-agents in a side panel, team recovery and mid-turn messages, `propose_change`, Scratch per task, Efficient mode with handovers (`team/handover.ts`), Milestones (`service/src/goal`), and the feedback, audit and design rounds (D-100 to D-114).

## Next

### M10.5 macOS support (D-116, D-117)

Every existing feature on macOS 13+ on Apple silicon, checked in CI. No new architecture piece.

- **A. CI on macOS.** `macos-latest` in the CI matrix; tests pass on all three systems with the count unchanged.
- **B. Core and harness.** The login shell's environment read once at start (`harness/src/environment/login-shell.ts`) on a Mac, and on Linux outside a terminal; Homebrew folders on PATH; the data folder under `~/Library/Application Support`; paths compared in NFC, with case folded only on a volume that ignores case; connector keys in the Keychain; Claude's usage and sign-in read from its Keychain entry, read only; one account per provider where the Keychain entry is not per folder.
- **C. Shell.** The app menu (About, Settings ⌘,, Hide, Quit ⌘Q asking first, Edit, Window); the Dock reopening the window; a template menu bar icon; Move to Applications; the login item's approval state; updates that only tell while builds are unsigned; a plain message when macOS refuses a workspace folder.
- **D. Interface.** One shortcut label helper (⌘ on a Mac), ⌘[ and ⌘] for Back and Forward, Mac words (Terminal, Finder) in one place, a Mac section in Help, What's new.
- **E. Packaging.** An arm64 .dmg and .zip, ad-hoc signed and verified with `codesign` in CI; Mac betas; a Mac smoke job that installs the .dmg, opens the app to Home, saves a screenshot and quits through the menu.
- Out of scope: an Intel build, signing and notarization (before the public release), self-update on a Mac.

### M11 to M15 (outline only)

- **M11 Unattended runs.** Task origin, durable retries, an admission queue for every start not typed by a person, resume after a restart, staying awake while work runs, and a notifier in the core.
- **M12 Automations.** Schedules, events and chains whose runs are ordinary tasks, through M11's queue; durable run keys; `propose_schedule` (D-118).
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
