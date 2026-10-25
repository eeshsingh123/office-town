# Modules

The roadmap. Modules are built in order; each module is one branch and one PR, with one commit series per sub-module so it can be reviewed commit by commit. The next module is detailed once chosen; later ones stay an outline until their design session, and finished ones shrink to what later work builds on. A sub-module handed to another agent gets its own self-contained story brief (see AGENTS.md), written when it is assigned.

## Package layout

```
packages/contract   shared types and schemas: events, commands, API messages. No runtime dependencies except the schema library.
packages/harness    M1. Runs one agent session on one harness and emits contract events.
packages/service    M2. Long-running core: session registry, storage, HTTP and SSE API. M4 added teams, the tool server and autonomy.
apps/desktop        M3. Electron shell and React UI; later modules add pages under src/features.
```

Dependencies point one way: `desktop -> contract`, `service -> harness -> contract`. The UI never imports `harness` or `service`; it only speaks the API defined in `contract`.

## Vocabulary

- Harness: a vendor CLI (Claude Code, OpenCode, Codex and others). "AI app" in what the user reads.
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
- Checker: a fresh agent outside the team that checks finished work against a checklist the user approves, in a temporary sandbox (D-47, D-73).

---

## Built

Each line is what later work builds on; the why lives in DECISIONS.md.

- **M1 Harness core.** `packages/harness` runs one agent on one harness (Claude Code; OpenCode over ACP), natively or in WSL, as one event stream; lists models and efforts; resumes by the harness's id. Layers: environment (launch, paths, kill), process runner, JSON-RPC client, session (ids, sequence, errors, plan steps), adapter (command, native message -> events, outgoing commands). Every adapter passes the same conformance tests against recordings of the real CLI. `pnpm dev:run`, `pnpm dev:catalog`.
- **M2 Core service.** `packages/service`: many sessions, every event stored in SQLite before it is published, one localhost API with a per-launch token and one event stream for live, catch-up and replay (D-15, D-17, D-30 to D-32). Workspaces (D-33, D-56); interrupted sessions resume after a crash. `SessionRegistry` is the only thing that starts sessions.
- **M3 Desktop shell.** `apps/desktop`: Electron starts the core, keeps agents in the tray and forwards `/api` with the token (D-34, D-36). One API client, one Zustand store fed by one stream, pure event -> trace functions (D-37). The office floor (`features/office`), the trace, the request card (`features/requests`), Tasks, themes.
- **M4 Orchestration.** A lead proposes a department, the user approves it in Needs you, and the lead delegates to workers on any harness through the core's MCP tool server (D-39, D-43, D-44). Stored agents and templates (D-42, D-55), one autonomy policy (D-45), a worktree per worker (D-46), a room per department (D-48). Code: `service/src/team`, `tools`, `autonomy`.
- **M5 Command center.** A standing chief splits a goal into pieces per department; a scheduler runs them in order, passing results and read-only upstream folders (D-49, D-51). Records reach the UI as `change` frames; task state, usage and limits live in the core (D-50). `service/src/chief`; UI `board`, `plan`, `chief`, `work`.
- **Feedback rounds after M5.** Home, creation flows, the Dusk look, review in the chat, profiles and templates, workspaces, Needs you, one composer, plain naming, Tasks, accounts and Usage, team building (D-52 to D-63, D-65).
- **M6 Files and Library (D-64).** Attachments in every composer, copied or linked read-only, images inline when the model sees them, marked Opened or Not opened; a workspace Library given to Everyone, a department or an agent. `service/src/attachments`, `library`. Out: content search, reading Office files, editing Library files.
- **M6.5 Onboarding and help (D-66).** Setup (AI app, where work goes, about you), tutorials that run real tasks on cheap models, Getting started, Help. `features/onboarding`, `help`.
- **M7 Connectors (D-67, D-68).** Key apps, local programs and Add your own run through the core's hub and reach every harness (`service/src/connectors`, keys in the OS store); sign-in apps are the user's claude.ai connectors, Claude agents only. Every call is checked against access and permission and logged. `features/connectors`. Out: our own app sign-ins, the full registry, per-tool switches.
- **After M7: feedback and optimization.** Several workspaces per department (D-69); usage recount (D-70), a lead stopping workers (D-71), lean runs with handover and usage pause (D-72), the check loop outside the team (D-73).
- **M8 Outputs and preview (D-74).** `show_result`, changed files and local sites, viewed in a sandboxed viewer with feedback and marked spots. `service/src/outputs`, `features/outputs`.
- **M9 Packaging (D-75).** Self-updating installer (Windows) and AppImage (Linux), the Dev app beside it, a beta on every green merge, stable only on the owner's word, setup installing harnesses with the vendor's installer (`harness/src/install.ts`). Out until release: stable, Download link, signing, intro video.

## Next

### M10 More AI apps (D-76; mockup approved, build next)

Goal: more harnesses without breaking the two that work, a clean way to get each one installed and signed in, and one page that stays readable as the list grows. No Google CLIs (owner).

Scope (owner, 2026-10-25), approach pending the mockup:
- Codex through `codex app-server` and Muse Code through `muse serve`, one translator each; GitHub Copilot CLI and Cursor CLI as launch profiles on the existing ACP translator.
- Adapters declare what the UI now hard-codes per harness: how it signs in, its version, whether it asks before acting.
- An AI apps page in the main nav (status, install, sign-in, accounts, models, where it runs); Add account lives there; Usage keeps the meters, with an estimated API price where an app shares no plan usage; setup reuses the same cards.
- Install with the vendor's own installer when its prerequisite is here, else the copy command (D-75).
- Verified by recordings and conformance tests; live runs only when the owner says go.

Out of scope: Pi, Hermes, OpenClaw, Google CLIs, an unverified ACP-registry tier, WSL installs.

### Before the public release (owner's go-ahead)

- The owner has tested the beta and says release.
- Intro video for marketing: discussed with the owner first.
- Code signing through SignPath Foundation (D-75): the owner applies once P4 is done; signing is wired in when approved.
- The final name (the app id `town.office.desktop` stays, so renaming breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later modules (outline only)

- **Deferred.** Agent memory (owner, 2026-10-23): the harnesses keep their own, so an app layer adds little; back only if the owner raises it. macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation.
