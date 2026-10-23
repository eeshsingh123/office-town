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
- Checker: a fresh agent outside the team that checks finished work against a checklist the user approves, in a temporary sandbox (D-47, D-73).

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

`packages/service` is the long-running core. It runs many sessions at once, stores every event in SQLite before publishing it (D-15, D-30, D-31), and serves one localhost API with a per-launch token (D-17, D-32): tasks, sessions, commands, resume, results, workspaces, settings, harness catalog, store size, the blocked queue, and one event stream that does live updates, catch-up and replay alike. A session runs in a workspace: the user's own folders, or a new folder per task in Scratch (D-33, D-56). After a crash or restart, unfinished sessions are marked interrupted and can be resumed. `SessionRegistry` is the only thing that starts sessions; M4's team code drives it rather than starting harnesses itself.

### M3 Desktop shell, office and agent panels (done)

`apps/desktop` is the app. The Electron shell starts the core, keeps agents running in the tray (D-34) and forwards `/api` with the token (D-36). The UI has one API client, one Zustand store fed by a single live stream, and pure functions that turn events into a trace (D-37). The office (D-35; Home became the first screen in D-52): one open floor, an agent per task, walk-up, click and drag-select, and a side panel. Around it: New task, the trace view, the request card used in the trace and in Needs you, Tasks (history, replay, delete), light and dark themes. M4 builds on all of it: agent identity in `src/store/agents.ts`, the floor plan in `features/office/floor-plan.ts`, the request card in `features/requests`.

### M4 Orchestration (done)

Describe a goal and a team does it. A lead agent proposes a department (roles, and a harness, model and effort for each); the user edits and approves it in Needs you, and can change the team at any time from the department's settings. The lead hands work to workers on any harness through the core's own MCP tool server (D-39, D-43) and gets their results back as messages (D-44). Agents and profiles are stored records (D-42). One autonomy policy in the core guards every agent (D-45). In a git workspace each worker gets its own worktree and branch, which the lead merges (D-46). The user can send finished work to a checker outside the team (D-47, D-73). In the office each department is a room with its own panel (D-48). Team code lives in `packages/service/src/team`, `src/tools` and `src/autonomy` and starts agents only through `SessionRegistry`; the UI adds `features/departments`, `features/profiles` and the team task view. M5 grows the rooms into the command center; M7 attaches connectors through the tool server.


### M5 Command center (done)

The office runs several goals across departments at once. A standing chief (`packages/service/src/chief`) splits a goal into a plan of pieces per department; the user edits and approves it, and any re-plan, in Needs you. A scheduler starts a piece once what it waits on is done and its department is free, passes upstream results into the brief, and gives read-only access to upstream folders (D-51). Records reach the UI as `change` frames on the one stream, and the core keeps each task's state, usage and plan limits (D-50). The UI adds the board with To review, the plan card, the chief's page, plan links, door states and draggable rooms (`features/office`, `chat`, `work`, `board`, `plan`, `chief`).

### Feedback rounds (done)

Owner feedback after M5 reshaped the app without new modules: Home (D-52), creation flows and the Dusk look (D-53), review in the chat (D-54), your profile and templates (D-55), workspaces (D-56), Needs you (D-57), one composer (D-58), plain naming (D-59), Tasks (D-60), accounts and Usage with live plan usage (D-61), the side panel (D-62), Back/Forward and group tasks (D-63), building teams from words and the Team page (D-65).

### M6 Files and Library (D-64; done)

The user gives agents files, images and folders explicitly, and every one reaches the agent for real. Attachments: paperclip, drag and drop and paste in every composer; files are copied read-only, folders linked read-only; images go inline when the model can see them; the app marks each item Opened or Not opened. Library: each workspace keeps reference items given to Everyone, a department or one agent, listed in every matching task's prompt; `#` attaches one; agents add items through a team tool, and their changes go to Needs you. Code: `packages/service/src/attachments`, `src/library`, `features/attachments`, `features/library`.

Out of scope: indexing and search over file contents (later, on top of this), reading Office files for the agent, editing Library files in the app.

### M6.5 Onboarding and help (D-66; done)

First-run setup (AI app, where work goes, about you), tutorials that run real tasks on a free or cheap model, a self-ticking Getting started list on Home, a Help page (tutorials, Display settings, What's new), and tutorials in Ctrl+K. Code: `features/onboarding`, `features/help`.

Out of scope: running vendor installers from the app (setup shows the official command), an in-app terminal.

### M7 Connectors (D-67, D-68; done)

The user connects an app once and chooses who may use it and how freely. Key apps, programs on this computer and Add your own go through the core, which every harness reaches (`packages/service/src/connectors`): one MCP client link per connector (official SDK, client side only), re-served on the tool server at `/mcp/apps/<slug>`, plus the hub's `list_app_tools` and `use_app_tool` at `/mcp/apps` for apps granted mid-conversation. Keys stay in the OS credential store. Sign-in apps are the user's claude.ai connectors, used by Claude agents only (`connectors/claude-apps.ts`, harness `vendor-apps.ts`): the core reads them per Claude account, the harness blocks the ones an agent may not use, and the core decides each call. A conversation's apps are fixed at its first session (`connectorIds`, `vendorApps`). Every call is checked against access and the app's permission, logged (`connector_calls`), and goes ahead, waits in Needs you, or is refused. `request_app` asks the user for an app, or points to a teammate who has a Claude app. The UI adds `features/connectors`: the Connectors page with its Claude apps section, connect and Add your own sheets, the connector page with activity, asks in Needs you, logos in the trace and side panel.

Out of scope: running app sign-ins in the core, writing new MCP servers, the whole public registry, per-tool switches, two accounts per app, importing the CLIs' own MCP configs, send caps, MCP resources and prompts, per-workspace connectors, connectors for guests.

### After M7: feedback and optimization (done)

Feedback: several workspaces per department (D-69), lists of points for every rules and notes field, sub-teams on the floor, the team tree and the run card. Optimization, from a measured goal where the lead was ~60% of the spend: usage recounted after a session (D-70), a lead stopping its workers (D-71), lean team runs with handover and a usage pause (D-72), and a check loop outside the team (D-73). Code: `packages/service/src/team` (`stop-work.ts`, `handover.ts`, `usage-pause.ts`, `checks.ts`, `check-sandbox.ts`).

### M8 Outputs and preview (D-74; done)

See what agents made without leaving the app, on every harness: results agents mark with `show_result`, the files they changed, and local sites they run. A viewer shows pages and sites (sandboxed, with screen sizes and versions), images, Markdown, PDF, tables and code with its changes; anything else opens in its default app. Feedback goes back to the agent, with pictures of spots marked on the page. Code: `packages/service/src/outputs` (tool, preview server, routes), `features/outputs`.

Out of scope: editing outputs in the app, deploying or sharing them, starting a dev server for the agent, an app-wide Outputs page.

---

## Next module

### M9 Packaging (D-75)

An installed app the owner runs from its icon, updated by itself from beta builds, with the public release built and ready but run only when the owner asks. Sub-modules in order, one commit series each, all on `feat/packaging`:

1. **P1 Build and installer.** Bundle the shell, the core and the WSL tool bridge into plain JS with the repo's Vite (Node will not strip TypeScript in an installed app); `@napi-rs/keyring` and the tool bridge stay real files outside the archive. `electron/main.ts` alone learns where the core and UI live when packaged. electron-builder makes a per-user one-click NSIS installer (Windows) and an AppImage (Linux). `pnpm package` builds it locally. Done when the installed app starts from its icon on the default data folder, runs a haiku task, and runs a WSL task through the bridge.
2. **P2 Dev loop.** `pnpm dev:app` watches: the UI rebuilds and the window reloads, the core and shell restart on change. It runs as "Office Town Dev" with its own data folder, so it runs next to the installed app and never touches its data.
3. **P3 Updates and data safety.** electron-updater on the beta channel: check at start and every few hours, download in the background, install on quit or on "Restart to update", never while an agent runs. The core copies `store.db` before it runs a new migration.
4. **P4 Beta workflow.** CI builds Windows and Linux on every merge to `main` and publishes a beta (`x.y.z-beta.n`) that the owner's app picks up. The stable workflow is written and checked with a dry run (builds, publishes nothing); it runs only on the owner's word (D-75).
5. **P5 Install the AI apps from setup.** Setup's "not installed" step gets an Install button for Claude Code and OpenCode that runs the vendor's official installer, shows its progress, then goes on to sign-in as today. Native first; WSL when the distro has what the installer needs.

Out of scope until the owner asks for the release: publishing a stable version, a Download link in the README, code signing, the intro video.

### Before the public release (owner's go-ahead)

- The owner has tested the beta and says release.
- Intro video for marketing: discussed with the owner first.
- Code signing: unsigned with SignPath Foundation (free for open source) applied for, or a paid certificate.
- The final name (the app id `town.office.desktop` stays, so renaming breaks no updates or data).
- Then: run the stable workflow, add the README Download link.

## Later modules (outline only)

- **Deferred.** Agent memory (owner, 2026-10-23): the harnesses keep their own, so an app layer adds little; back only if the owner raises it. macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
