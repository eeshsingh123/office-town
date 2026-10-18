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

`packages/service` is the long-running core. It runs many sessions at once, stores every event in SQLite before publishing it (D-15, D-30, D-31), and serves one localhost API with a per-launch token (D-17, D-32): tasks, sessions, commands, resume, results, workspaces, settings, harness catalog, store size, the blocked queue, and one event stream that does live updates, catch-up and replay alike. A session runs in a workspace: the user's own folders, or a new folder per task in Scratch (D-33, D-56). After a crash or restart, unfinished sessions are marked interrupted and can be resumed. `SessionRegistry` is the only thing that starts sessions; M4's team code drives it rather than starting harnesses itself.

### M3 Desktop shell, office and agent panels (done)

`apps/desktop` is the app. The Electron shell starts the core, keeps agents running in the tray (D-34) and forwards `/api` with the token (D-36). The UI has one API client, one Zustand store fed by a single live stream, and pure functions that turn events into a trace (D-37). The office (D-35; Home became the first screen in D-52): one open floor, an agent per task, walk-up, click and drag-select, and a side panel. Around it: New task, the trace view, the request card used in the trace and in Needs you, Tasks (history, replay, delete), light and dark themes. M4 builds on all of it: agent identity in `src/store/agents.ts`, the floor plan in `features/office/floor-plan.ts`, the request card in `features/requests`.

### M4 Orchestration (done)

Describe a goal and a team does it. A lead agent proposes a department (roles, and a harness, model and effort for each); the user edits and approves it in Needs you, and can change the team at any time from the department's settings. The lead hands work to workers on any harness through the core's own MCP tool server (D-39, D-43) and gets their results back as messages (D-44). Agents and profiles are stored records (D-42). One autonomy policy in the core guards every agent (D-45). In a git workspace each worker gets its own worktree and branch, which the lead merges (D-46). A guest agent can be called in, by the lead or the user, for a second opinion on a copy of the work, isolated as far as its harness allows (D-47). In the office each department is a room with its own panel (D-48). Team code lives in `packages/service/src/team`, `src/tools` and `src/autonomy` and starts agents only through `SessionRegistry`; the UI adds `features/departments`, `features/profiles` and the team task view. M5 grows the rooms into the command center; M7 attaches connectors through the tool server.


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

---

## Next module

### M7 Connectors (D-67; branch `feat/connectors`)

The user connects an app once (Notion, GitHub, Blender…), chooses who may use it and how freely, and every agent given it can use it, on any harness. Decisions and their why: D-67. Approved mockup: https://claude.ai/artifact/AMEbojnd6kH9UExCAbFtti (private to the owner; this section is the full spec without it).

**How it works.** The core is the connector hub. It keeps one live MCP client link per connector (remote over Streamable HTTP, or a local program over stdio that the core starts once and shares) and re-serves each connector's tools on the existing tool server, one endpoint per connector. At the start of a conversation an agent's session gets the team server (as today), one endpoint per connector it may use, and the hub endpoint with two fixed tools. The CLI calls a connector tool like any MCP tool; the call goes core → connector and back, logged on the way. Sign-ins and keys never leave the core.

**Words the user reads.** Connectors (main nav, after Workspaces). Who can use it: Everyone, or departments and agents. Permissions: Read only, Ask me first (default), Don't ask. Official, by <maker>; Community. Signed out; Sign in again; Turn off; Disconnect. No internal terms (MCP, server, OAuth, token, tool) in UI copy, except "MCP server" inside "Add your own".

**Sub-modules, one commit series each, in order:**

1. **Hub.**
   - Contract (`packages/contract/src/connectors.ts`, additive): a connector record `{id, slug, name, kind: "remote" | "local", maker?, official, url? | command+args+env names?, auth: "sign-in" | "key" | "none", audience, permission: "read_only" | "ask" | "dont_ask", enabled, status: "connected" | "signed_out" | "off" | "failing", createdAt}`. `audience` reuses the Library's audience shape (move `libraryAudienceSchema` to a shared `audienceSchema`, keep the old name as an alias), app-wide, not per workspace. `slug` is the MCP server name: lowercase letters, digits and `-`, unique, never `office-town` or `office-town-apps`, short enough that `mcp__<slug>__<tool>` stays within 64 characters.
   - Store: tables `connectors` and `connector_calls` (connector, agent, task, session, tool, read or change, outcome: done, refused, failed, asked; at), by a new migration in `store/migrations.ts`. No secrets in SQLite.
   - `packages/service/src/connectors/`: the registry of live links (official TypeScript MCP SDK `@modelcontextprotocol/sdk` for the client side only; the tool server stays hand-written), lazy connect, reconnect with backoff, tool list cached per connector and refreshed on connect and `notifications/tools/list_changed`, local programs started on first use and stopped with the core. Read or change per tool comes from MCP annotations: `readOnlyHint: true` is a read, anything else a change.
   - Tool server (`tools/tool-server.ts`): serve `/mcp` (team, unchanged), `/mcp/apps` (hub) and `/mcp/apps/<slug>` per connector, all on the session's one token. A connector endpoint lists that connector's tools as they are and forwards calls; it refuses (as a tool error the agent reads) a call the agent may not make now: access removed, connector off, signed out, or a change under Read only.
   - Fixed tool list per conversation: the connectors an agent gets natively are chosen at its conversation's first session and stored in the session options (`connectorIds`, additive in `options.ts`); a resume reuses the stored list, never a fresh one, so the tool list never changes inside a conversation. The hub's two tools are offered to every agent session, always, with static descriptions: `list_app_tools({app?})` (no app: the apps this agent may use now, with their permission; with app: its tools and input schemas) and `use_app_tool({app, tool, arguments})`. They reach anything the agent may use now, including apps granted after the conversation started.
   - Trust per server: `ToolServer` gains `trusted: boolean`, passed through `environment.reach` (native and WSL). Team server: trusted, auto-allowed as today. Hub and connector servers: not trusted, so the CLI asks before every call (Claude: no `--allowedTools` entry; OpenCode: `"<slug>_*": "ask"` and `"office-town-apps_*": "ask"`). Do the spike first (step 0 below).
   - Permission: `permission.requested` gains optional `tool: {server, name}` (adapters fill it with `attachedTool`, as `action.started` does). The guard in `autonomy/policy.ts` decides connector calls before the department level: a read always goes through; a change goes through under Don't ask, waits for the user under Ask me first, and is refused under Read only. For `use_app_tool` the policy reads `app` and `tool` from the input. The department level still governs files and commands. `answeredBy` gains `{connector: id}` so the trace can say which setting allowed it. Bypass ("No safety checks") makes the CLI ask nothing, connectors included (existing warning covers it).
   - Briefs (`agents/briefs.ts`): a new conversation's first message lists the apps it may use, each with its permission, and says to use `list_app_tools` for apps added later and `request_app` for one it lacks.
   - API (`api/routes.ts`): `GET /connectors`, `POST /connectors` (custom or from the catalog), `PUT /connectors/:id` (audience, permission, enabled), `DELETE /connectors/:id` (also deletes its secret), `GET /connectors/:id/activity?team=&changes=&before=`, `GET /connectors/catalog`. Changes reach the UI as `change` frames (D-50).
   - Trace (`apps/desktop/src/trace/team-tools.ts` or a sibling rule): connector actions titled "Searched for "pricing"", with the app's logo; hub calls named by their `app` and `tool`, never "use_app_tool".
2. **Signing in and secrets.**
   - Sign-in apps: MCP authorization with the SDK's OAuth client provider (PKCE, dynamic client registration, or Client ID Metadata Documents where offered). The UI asks the core to start (`POST /connectors/:id/sign-in` returns the app's page), opens it in the system browser (Electron `shell.openExternal`, a new tab in browser mode), and the app redirects to a loopback callback on the core's API server (`/connectors/callback`, no bearer token, bound to the one-time `state`). Tokens refresh in the core; a failed refresh sets Signed out.
   - Key apps: one field, the header or env name it fills, a link to where the app shows the key.
   - Secrets in the OS credential store through `@napi-rs/keyring` (Windows Credential Manager; Secret Service on Linux). Where no credential store exists, a file in the data folder readable by the user only, and the connect sheet says so. Never in SQLite, prompts, command lines, events or logs.
   - Catalog: one data file (`packages/service/src/connectors/catalog.ts`) of about 25 official remote servers with slug, name, maker, category (Work and docs, Code, Messages, Sales, Design), one-line description of what agents can do, URL, auth kind and logo key. Verify every entry live before adding it (connects, signs in or takes a key, lists tools); drop any that fail. Candidates: Notion, Linear, GitHub, Atlassian (Jira, Confluence), Sentry, Asana, Stripe, HubSpot, Figma, Canva, Zapier, Slack, Google Drive, Gmail, Google Calendar, Vercel, Supabase, Cloudflare, PayPal, Square, Intercom, Box, monday.com, Webflow, Airtable. Logos: Simple Icons paths (CC0) in each brand's colour, near-black brands drawn in the text colour in dark mode.
3. **Pages** (`apps/desktop/src/features/connectors`). As the mockup: Connectors page (Connected list: logo, name, one line "who · permission", a button only when something needs the user; Add a connector: search, category chips, cards with logo, name, "Official, by <maker>", one line, one Connect button, "Add your own" first). Connect sheet (Account, Who can use it with the Library's picker, Permissions as three choices; defaults Everyone and Ask me first). Connector page (Access: who and permissions, changed in place; Activity this week with chips All / each team with its count / Changes, rows linking to their task, Show more; ⋯ menu: Sign in again, Turn off, Disconnect with confirm). Side panel Now tab: a Connectors list per agent. Needs you: the new asks. Ctrl+K lists connectors. Amber dot on the nav item while any connector is Signed out or failing.
4. **Asks.**
   - Team tool `request_app({app, reason})`, offered to every agent: returns at once; a core ask in Needs you (registry `ask`, as `change_library` does) "<Agent> wants to use <App>" with the reason and Connect <App> (not connected; opens the connect sheet with the asker's team picked) or Give access (connected), and Decline. Approval adds the asker's department (the agent itself when it has none) to the audience; the agent is told by message (`registry.tell`, notice) that the app is ready through `use_app_tool`. Its tool list does not change (cache kept).
   - A call to a Signed out connector fails with a plain message, and one Sign in again ask appears on that task (not one per call).
   - A change under Ask me first shows what it will do from the call's input: for a mail-like call, To and Subject with Show email; otherwise the tool's name in words and its input.
5. **Describe it.**
   - "Add your own" opens a sheet with a describe box first ("What should your agents be able to use?") and "Enter details by hand" (address, or command and arguments, plus key fields) second.
   - `POST /drafts/connectors` reuses `drafts/run.ts` (D-65), but lets web search and web fetch through (`refuse` takes an allow list of action kinds `search` and `fetch`); everything else stays refused. The reply is JSON: name, maker, official or community, source link, kind, URL or command, auth, key fields with where to get them, what must be installed first, up to 3 questions only when they would change the result. The prompt points it at the maker's own docs first, then the official MCP Registry (`registry.modelcontextprotocol.io`).
   - Before saving, the core tests it: a remote one is connected and its tools listed; a local one runs only after the user saw the exact command and pressed Run and test. The sheet shows the source link, Official or Community, what to install first, and "Tested: N tools". It finds and configures existing servers only; it never writes server code.

**Step 0, a spike before sub-module 1** (record results in MEMORY.md): Claude Code in `ask` mode sends `can_use_tool` for an MCP tool not in `--allowedTools`, with `tool_name` `mcp__<server>__<tool>`; OpenCode 1.18 sends an ACP permission request for an MCP tool matched by an `ask` rule; a second attached HTTP server works through the WSL bridge; `@napi-rs/keyring` loads under Node 24 on Windows.

**Acceptance checks.**
- `pnpm check` passes. Few focused tests (RULES.md): the policy (read goes through, change asks under Ask me first, refused under Read only, goes under Don't ask, independent of the department level), the fixed per-conversation list on resume, the hub reaching an app granted mid-conversation, the gateway refusing after access is removed, `request_app` approval adding the audience, secrets never reaching SQLite or launch arguments. Use a small local MCP test server as a fixture, not a real app.
- One live smoke run (cheap models only: Haiku 5.5 low effort, an OpenCode free model): one Claude agent and one OpenCode agent each read from a connected app, one change waits in Needs you under Ask me first and runs after Approve, an app granted mid-task is used through `use_app_tool` in the same conversation, and the activity page shows all of it.
- Look at every new screen at full size in dark and light before the PR.

**Out of scope.** Writing new MCP servers; browsing the whole public registry; per-tool switches; two accounts of the same app (Change replaces the account); importing the CLIs' own MCP configs or Claude.ai connectors; send caps; MCP resources and prompts (tools only); per-workspace connectors; guests (outsourced reviewers) get no connectors.

## Later modules (outline only)

- **Agent memory.** What an agent remembers across tasks. Its own module, after a deep dive with the owner on storage, recency and how relevant an old memory still is; its place in the order is set then, before packaging. M4 profiles leave room for it.
- **Deferred.** macOS support (D-23): parked until it can be tested on a Mac. Sandbox or VM environment for computer use: a third `Environment` implementation. Codex and Antigravity adapters: one adapter each, when wanted.
- **Last: Packaging and release.** Built once every other module is done (owner, 2026-10-07). An installer people download and run, with no repository, Node or pnpm: Windows first, Linux packages next, macOS stays parked (D-23). The core and the built UI ship inside the app; the data folder does not move. Node will not strip TypeScript inside `node_modules`, so the core gets a build step for packaging only (D-19 still holds in development), and only `apps/desktop/electron/main.ts` changes where it finds the core and the UI. The WSL tool bridge (`packages/harness/src/environment/tool-bridge.ts`, run by the core's own Node through WSL interop) ships the same way. Code signing (unsigned installers get a SmartScreen warning; a certificate costs money, owner to decide), auto-update from GitHub Releases, and a release workflow in CI.
