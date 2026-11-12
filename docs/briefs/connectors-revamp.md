# Connectors revamp: handover

Written 2026-11-12, at the end of the discussion stage with the owner. Two sessions follow, and each waits on the owner:

1. **Mockup session**: read this file, then build the mockup (section 9) and stop.
2. **Build session**: once the owner approves the mockup, build it (section 10).

Not committed yet. The mockup session commits this file on its own branch. Delete it once the module is built (MODULES.md).

## 1. Product context

Office Town is an open-source desktop app (Electron + a local Node core). The user describes a task, and a team of AI agents plans and carries it out. The agents run on the user's own CLI subscriptions: Claude Code, OpenCode, Codex, Muse Code, Copilot and Cursor ("providers" in the UI, "harnesses" in code). AGENTS.md has the principles: no terminals, traceability, cross-provider teams, a human in the loop, and usable on free models. Read `docs/RULES.md` before writing anything.

Connectors (M7, decisions D-67 and D-68) let agents use outside apps. The owner finds them hard to understand and plans modules that depend on them: schedulers, a Home feed, background agents, cloud agents and swarms. Each of those gets its own discussion later. **This module covers connectors only.**

## 2. What the owner wants

In one line: agents act in the user's real apps with as little setup as possible, everyone can see who may use which app, and connectors are a solid base the later modules plug into.

What the owner reported:
- The purpose of connectors is unclear.
- "Add your own" is a chat box that shows nothing about what you get.
- Each provider has its own plugins or connectors, and they need to be kept clearly apart to avoid overlap and confusion.

## 3. What exists today (do not rebuild it)

- **Contract** (`packages/contract/src/connectors.ts`):
  - Kinds: `remote`, `local` (the core's hub, usable by every provider) and `claude` (the user's claude.ai connectors, usable by Claude agents only).
  - Permissions: `read_only`, `ask`, `dont_ask`.
  - Statuses: `connected`, `signed_out`, `off`, `failing`.
  - `connectorTest` returns only a tool count.
  - `vendorApp` holds an app as a CLI reports it, with tools and `readOnly` markers.
  - `connectorCall` and `connectorActivity`: every call is stored, and this week's calls are read in pages, filtered by team or changes.
- **Hub** (`service/src/connectors/gateway.ts`, `hub.ts`):
  - One MCP server, `office-town-apps`, with two fixed tools, `list_app_tools` and `use_app_tool`.
  - Agent tool lists never change mid-conversation (prompt cache, D-67). The core decides each call.
  - Keys live only in the OS credential store.
- **Ask to connect** (`request-app.ts`, UI `ConnectorAsk.tsx`):
  - An agent missing an app calls `request_app`, and the ask lands in Needs you.
  - The core picks a hub app first, then a Claude app on the session's login, then another login. Otherwise it points the agent to a teammate who has the app.
- **Claude apps** (`claude-apps.ts`):
  - Read from Claude's `mcp_status`, fixed per conversation, every other server denied.
  - Each call asks, and the core answers by the app's permission (D-68).
  - Gmail, Drive and Calendar need `claude mcp login --no-browser "<app>"` in headless runs.
- **Catalog** (`catalog.ts`): 27 entries, mostly claude.ai tiles, plus GitHub (key) and Hugging Face.
- **UI** (`apps/desktop/src/features/connectors`):
  - `ConnectorsView` (the page), `ConnectorView` (one app), `ConnectSheet`, `AddOwnSheet` (the describe box plus a hand-filled form), `ConnectorAsk`, `AgentConnectors`, `SheetParts`.
- **Isolation** (D-41):
  - Claude runs with `--setting-sources ""`, so the user's own local Claude MCP servers are hidden.
  - OpenCode loads its global config, so its own MCP servers already load.
  - Codex receives our servers as `-c mcp_servers.*` overrides (`harness/src/adapters/codex/adapter.ts`), so its own config probably still loads. Verify this.
- **Tutorials**: `features/onboarding/tutorial-model.ts`, `TutorialCard.tsx`, the same system as the templates walkthrough.

## 4. Decisions taken with the owner (2026-11-12)

1. **Two families of apps:**
   - **Shared apps** live in Office Town (keys, local programs, servers added by address) and work for every provider.
   - **Provider apps** are signed in through a provider and work only for that provider's agents.
   - One card per app. Who can use it is shown as **provider tags** (a small logo chip per provider, and "All" for shared apps). Never a sentence like "Claude agents only".
2. **Agents use provider apps when the work needs them.** When an app is missing, the agent asks in Needs you to set it up. Nothing has to be set up in advance.
3. **Never edit a provider's config files.** The provider does the hard part, signing in and holding the token, itself. Office Town still never runs an OAuth sign-in or holds an app's token.
4. **Permissions:** the same three levels for every app. Where a provider hides a call's details (OpenCode asks with an empty input), Ask me first shows only the app and the action's name, and the app page says so.
5. **Apps only.** Plugins also carry skills (instructions), and those are out for now.
6. **Who gets an app connected through an ask:** the department by default. A lead or worker may suggest wider access, and the user picks. Don't scope it tightly.
7. **Recent use per app: yes**, but it must not clutter as it grows. Show a short list, then Show more, reusing `connectorActivity`.
8. **Sign-in health:** tell the user only when an app needs its sign-in renewed. No other alerts.
9. **What Add can find:** our curated list plus popular public MCP servers. List only verified servers that pass the checklist in section 7. No known vulnerabilities are tolerated.
10. **Onboarding:** a walkthrough like the templates one, for technical and non-technical users alike.
11. **Order:** independent pieces first, dependent ones after.
12. **Out of scope** (each gets its own discussion later): cloud agents, schedulers, watches, the feed, approval batching and background running (which will be opt-in). A tracker an automation keeps (for example, job applications) goes in a Library file.
13. **DeepSeek Harness** (`dsh`) is a planned provider, added as its own step, not in this module.

## 5. Scope

### Part A: one app list across sources (do first; nothing depends on it)

- Read provider apps, without writing anything:
  - **Claude:** already done (`mcp_status`).
  - **Codex:** `app/list`, `plugin/list` and `mcpServerStatus/list` on `codex app-server`. Checked on 0.167.2, the latest stable (section 8); read their shapes with `codex app-server generate-json-schema --out <dir>`. Codex apps are ChatGPT apps, so they need a ChatGPT sign-in in Codex: signed out, `app/list` and `plugin/list` come back empty, and the card shows nothing for Codex.
  - **OpenCode:** the MCP servers it has, with sign-in state (`opencode mcp auth list`, or a better read-only way found in the build).
  - **Copilot, Cursor and Muse:** no provider apps in this module. Their cards show the "All" route only.
- One card per app. Match the same app across sources by catalog slug or server address. Show every route an app has, each with its tags. When a shared route exists, agents use it first: the core sees every call in full there.
- Health per route. Surface only "needs renewing".
- Provider apps actually reach runs. Claude apps already do. For Codex and OpenCode, check what loads today (section 8) and let their apps through without loading the rest of the user's config.

### Part B: Add flow and walkthrough (after A, in parallel with C)

- Remove the describe chat box.
- Add is a search over the vetted list (section 7). Adding by address or command sits under an Advanced fold for technical users.
- Before anything is saved, show a preview:
  - it connects;
  - it lists the actions in plain words, grouped Reads and Changes;
  - it shows its provider tags.
- `connectorTest` must return the tool list, not just a count. That is a contract change, and it comes first.
- Write a walkthrough tutorial: connect one app, see what it can do, see an agent use it.

### Part C: ask to connect, and each department's apps (after A, in parallel with B)

- `request_app` covers provider apps too. The ask names the provider and gives the right setup action:
  - **Codex:** set up in the app, with no terminal:
    - `plugin/install` returns `appsNeedingAuth`, each with an `installUrl`; we open it in the browser, and ChatGPT does the sign-in.
    - `mcpServer/oauth/login` returns an `authorizationUrl` to open in the same way.
    - Codex holds every token.
  - **Codex permissions:** Codex has its own approval setting per app (`auto`, `prompt`, `writes`, `approve`, plus `destructive_enabled`). Set it per session with `-c apps.<id>.…` overrides, as the adapter already does for our servers, never by editing `config.toml`. Map our three levels onto it, and check live how a `prompt` approval reaches the client and whether it carries the call's input.
  - **Claude:** open claude.ai's connectors page; for Google apps, run `claude mcp login`.
  - **OpenCode:** hand the server to OpenCode at the session's start, as we already do for our tool server, and let OpenCode do its own sign-in. Verify that it signs in to servers handed over this way.
- Agents need to know what can be connected, so they ask for the right app instead of guessing names. Prefer extending `list_app_tools` output over adding a new tool.
- A provider app connected mid-task only appears in the agent's next conversation. Either the agent carries on in a new conversation using the D-94 handover, or the lead hands the step to a teammate who already has the app. Pick one in the build and say why.
- The ask carries a suggested audience (department by default); the user picks.
- The department page shows its apps with their tags. The team builder flags an app the department needs that only a provider none of its members uses has.

### Part D: the "Where it works" label

Each route shows where it works: in the app, in the background, or in the cloud (claude.ai apps only, on Claude's own cloud). It is user-facing and useful now. Do not add per-run app lists or other hooks for modules not yet built; they come with the module that uses them.

### Out of scope

- Watches and triggers, schedulers, the feed, cloud and background running.
- Plugin skills.
- Copilot, Cursor, Muse and DeepSeek provider apps.
- Any sign-in handled by Office Town.
- Editing any provider config file.

## 6. Contracts

- Contract changes go in first, in their own commit: route and tags on a connector, the test returning tools, the provider-app setup action, a suggested audience on an ask.
- Keep existing behaviour: hub apps, Claude apps, permissions and activity work as they do now.
- Next decision number: **D-96**.

## 7. Checklist for listing a public server

The owner tolerates no vulnerabilities. No one can promise a third-party server has none. What we promise is these checks, plus the core's control over every call.

1. It is made by the app's own company, or it is listed in Anthropic's or OpenAI's connector directories.
2. It is a remote server over HTTPS, signed in with the vendor's own OAuth or a key, rather than a program run on the user's computer.
3. A local program is open source, pinned to an exact version (never `@latest`), installed from the official package, and its advisories were checked on GitHub Advisories and OSV on the day it was listed.
4. Its actions are listed. Every action that sends or changes something defaults to Ask me first.
5. Every entry is checked again at each release and removed on any advisory. Each catalog entry records when it was checked.
6. Prompt injection is a real risk for this kind of app. An agent that reads untrusted content (emails, web pages) and can also send data out can be tricked by that content. That is why sending defaults to Ask me first.

The public MCP Registry is still a preview. Its "verified" means only that the publisher owns the name, not that the server is safe. Use it only as a source of candidates, never as a live list in the app.

## 8. Facts checked on 2026-11-12, and what is still open

Checked:
- **Codex, latest stable 0.167.2** (npm `@openai/codex`; installed on the owner's machine on 2026-11-12, replacing 0.164). Its app-server has:
  - `plugin/list|read|install|uninstall`, `marketplace/add|remove|upgrade`;
  - `app/list|read|installed`, where `AppInfo` carries `isAccessible`, `isEnabled` and `installUrl`;
  - `mcpServerStatus/list`, with `authStatus` `notLoggedIn|bearerToken|oAuth|unsupported|unknown` and the tool list;
  - `mcpServer/oauth/login`, which returns an `authorizationUrl`, with `mcpServer/oauthLogin/completed` when done.

  The only method added since 0.164 is `thread/section/changed`, so the connector surface is the same. `mcpServer/elicitation/request` is MCP's own "the server asks the user for input", not a tool approval.
- Signed out, a live probe of `codex app-server` 0.167.2 returned `account: null` and empty `app/list`, `plugin/list` and `mcpServerStatus/list`.
- The Codex desktop app (Microsoft Store, 26.1106.6628.0, installed 2026-11-12) bundles its own `codex.exe` (0.167.0-alpha.4.1) and shares `~/.codex`. Office Town keeps driving the npm CLI. The desktop app is not needed, and its automations run only while it is open.
- Codex plugins (since March 2026) bundle skills, apps and MCP servers. Codex automations run only while the Codex app is open.
- Claude's Gmail connector can search, read, draft, send, reply and forward. It asks before each send by default and can't read attachment content (support.claude.com, article 10166901).
- Claude scheduled tasks (formerly "routines") run in Anthropic's cloud with only the user's claude.ai connectors, at most once an hour, and are a research preview (code.claude.com/docs/en/routines).
- OpenCode runs the OAuth sign-in for remote MCP servers itself (`opencode mcp auth`), and the token stays in OpenCode.
- MCP has no standard for push events yet: SEP-3415 is under review, and the 2026-07-28 spec has `subscriptions/listen` for resource changes only.
- DeepSeek Harness (secondary sources only): ACP through `dsh --profile acp`, an MCP client off by default, session logs uploaded by default on the official API, developer preview.

Still to check, in the build session:
- Codex with a real ChatGPT sign-in (the owner signs in first, in the Codex app or with `codex login`): what `plugin/list` and `app/list` return, one plugin installed through `installUrl`, and an app call under `prompt`. Also check that our recordings, made on 0.164, still pass on 0.167.2.
- What Codex agents load today. Do the user's plugins and apps already reach them, given we only add `-c` overrides?
- Whether OpenCode signs in to a server handed over through ACP `mcpServers`, and how to read its server list without editing anything.
- What Codex's `mcpServer/elicitation/request` carries, and whether the core can answer it by the app's permission.
- Whether Muse Code supports MCP at all. Sources disagree; check on the owner's machine.

## 9. Mockup session

Build one artifact showing these screens, in dark and light:
1. **The Connectors page:** app cards with provider tags, a search, and only "needs renewing" as an alert.
2. **One app's page:** actions grouped Reads and Changes, permission, who has it, where it works, and the recent-use list (short, then Show more).
3. **The Add flow:** search over the vetted list, the preview before saving, and the Advanced fold.
4. **A Needs you ask for a provider app:** a Codex app set up in the app, and a Claude app set up through the browser.
5. **A department's apps,** with the team builder's warning.
6. **The walkthrough's first step.**

Rules for the mockup:
- Follow RULES.md and D-55/59/66: plain words, labels and short hints only, no explainer panels, no internal terms.
- Use the app's tokens (`apps/desktop/src/styles/tokens.css`), Plus Jakarta Sans, and the existing connectors styles as the starting point.
- Before showing it, check it at full size with the `mockup` entry in `.claude/launch.json` and `out/capture`.
- Mark the open questions on the mockup, then stop for the owner.

## 10. Build session

1. Branch `feat/connectors-revamp` from `main`.
2. In MODULES.md, add the module and compress the Built section. Add D-96 to DECISIONS.md and an entry to What's new.
3. Contract first. Then Part A, then Parts B and C, then Part D, each its own commit series.
4. Run `pnpm check`. The repo sits at the cap of 50 tests: read the count from vitest, and replace tests rather than adding new ones.
5. Run one live smoke on the cheapest models only (Claude `claude-haiku-5-5` at low effort, OpenCode's free model):
   - a Claude agent asks for an app and gets it;
   - a Codex app is listed with its tags.
   - Codex is not signed in on the owner's machine, so ask the owner before that part.
6. Update docs/MEMORY.md, open a PR, and report what was and wasn't checked.
