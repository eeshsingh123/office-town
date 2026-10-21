# Memory

Last updated: 2026-10-21

## State

- M1 to M6.5 are built and merged to `main`, with the feedback rounds after M5 (PRs #31 to #52).
- M7 Connectors is merged (PR #53, D-67, D-68). Feedback fixes after it: PR #54, #55.
- Department workspaces (D-69), merged in PR #56: several workspaces per department with a Workspaces wizard step, editing in settings and the Office panel, a workspace pick per goal and per plan piece, a roster grouped by role for big teams, and "Last: <work> · <when>" or "Free" for members not on the goal. Checked live: a Haiku 5.5 goal for a department ran in its non-default workspace; Make default from the Office panel saved. Not checked: the plan card's workspace pick with a live chief, "Last:" lines with real history, light mode.
- Feedback after it, merged in PR #57 (2026-10-19): the floor's dashed add rooms show only on an empty office; after that two muted dashed boxes sit in the floor's bottom-right corner (the Board keeps them in its top bar); a team's title on the Team page opens it (gear removed); rules and instructions edit as a list of points (one per line in storage); "What it's for" wraps; numbered roles ("Developer 2") group with "Developer", and the drafter no longer numbers them. Checked in browser mode; the drafter change not checked live.
- Sticky Save merged in PR #58. Feedback round 2 on `feat/feedback-round-2` (2026-10-21): agent notes, template notes, chief planning rules, setup's About you and the You page edit as a list of points (`ui/PointsField`), and "What your agents will read" shows titled point lists; search lists were faded by cmdk's `data-disabled="false"` (fixed in `Menu.module.css`); a member's Remove from team is a visible button, Add another starts blank with only the role, and a new member's Files say to save first; the Board bar lost + Chief / + Department; your messages show your avatar, name and an accent bubble on the right (trace and chat). Checked in browser mode: search rows at full opacity, the You page lists and preview, Add another and Remove. Not checked: the agent profile and template dialogs, your message in a live trace, light and dark visually. Then: What-they-do fields wrap (`ui/LineField`); a member's "..." sits by the name, Start from template and Remove on their own row; OpenCode thinking tokens count as output. Then (D-70): a department room shows who used what on its goal in a strip under its desks (mockup C, https://claude.ai/artifact/MoH7DdemEVBnJ5Q6mboEQU); OpenCode usage is recounted from `opencode export` once a session ends and the missing part added as `usage.recounted`. Checked live: a Big Pickle task reported 14k input on its turn, the recount added 27.6k. Checked in browser mode: the strip on a room. Not checked: a sub-agent's tokens followed live, WSL recount, the strip on a room with many members.
- Next: agent memory, once discussed with the owner.
- Never checked live for M7: a Claude app's sign-in finished end to end (Sign in returns Claude's page; not opened), Refresh after connecting a new app on claude.ai, a second Claude account's apps, `request_app` routing to a teammate, a real key app (GitHub with a token), a WSL agent using a connector, a local program from the catalog flow such as Blender, the Windows "keys cannot be saved" path. Checked: refresh read 4 Claude apps in 3 s; a Haiku 5.5 agent's Claude Docs read was allowed by the app's setting and its change waited in Needs you and was declined; the Connectors page and the Connect in Claude sheet in browser mode; earlier, Claude and OpenCode read from the notes test app through the hub, an Ask me first change ran after Approve, `use_app_tool` for an app granted mid-task, describe-it found Blender's server.
- Codex can connect apps through its plugins (Gmail, Drive, Slack via /plugins); when the Codex harness lands, check headless use and add it as a second source of vendor apps (D-68).
- Mockups are checked at full size before they are shown: serve the HTML (`mockup` entry in `.claude/launch.json`, a static server on port 5190) and shoot it with `out/capture` in dark and light.
- Never checked by an agent, worth a click when touched: the plan card and re-plan view, next waiting with the in-place card, Mark reviewed and Follow up, hand-off motion, reduced motion and dark mode on the floor; the tray's Quit prompt, the Windows notification, the store size warning (over 1 GiB), "Show older tasks" (over 50); a WSL run from New task, a WSL Claude agent calling a team tool, WSL share-name folding in the read-only check, plan usage for a WSL or added account; drag and drop and Add folder (app only); a chief draft live, the chief and Library tutorials live, setup with an AI app that is not installed or not signed in; the empty Team page and the "No chief" slot, light mode on the newer pages.
- The "owes a turn" rule (D-50): a user message after a turn started counts; an answer counts only after the turn ended, since a harness's own question is answered inside its turn.
- Where things are: core `packages/service/src/main.ts` with `store`, `registry`, `api`, `team`, `tools`, `autonomy`, `chief`, `accounts`, `attachments`, `library`, `drafts`, `connectors`. API messages in `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`, `src/styles/tokens.css`. Default data folder: `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- Local only, outside git: `.claude/launch.json` (browser preview configs, excluded in `.git/info/exclude`), `out/capture` (off-screen Electron screenshots), `feedback_images/`.
- A test app for connectors: `node packages/service/test/support/notes-app.ts <port>` serves it over HTTP; with `--stdio` it is a local program.
- Mockups (private to the owner): M3 https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp, M4 https://claude.ai/artifact/Wuj5ihNNu4fVDGqxzLrQ4B, M5 https://claude.ai/artifact/2JtgLDazsmQeYH7hLuQuA3, creation flows https://claude.ai/artifact/PaPEMXnWXrc9gxQdGtTqsC, workspaces https://claude.ai/artifact/TAJNDntGi4PYmcExP6opUb, Library https://claude.ai/artifact/6TrVZrWjcnvXDWxGivLVgm, composer https://claude.ai/artifact/71RVoeMQkxza3Pq72eyxn9, team building https://claude.ai/artifact/WkgeYGyai2cMSCFoSMtTgp, team page https://claude.ai/artifact/FyPveyDNnv96N8SoAs4PFc, connectors https://claude.ai/artifact/AMEbojnd6kH9UExCAbFtti, department workspaces and big teams https://claude.ai/artifact/Dih5V7i4Z9Y5Efxrzi6EZz.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:app`: builds the UI and opens the desktop app on the default data folder. Only one core can hold a data folder, so close the app before browser mode uses the same one.
- `pnpm dev:web [--data-folder path]`: browser mode at http://localhost:5173, a core plus Vite forwarding `/api` with the token. The folder picker, Open folder and dropping folders need the app.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume harness-session-id]`
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: models and their effort values.
- `pnpm dev:core [--data-folder path] [--port n]`: the core. It prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`. `POST /tasks` needs a `workspaceId`.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before calling the core, or it rewrites `/tasks` into a Windows path. Windows arguments also lose doubled backslashes, so build JSON with Windows paths inside Node, not in the shell.
- Live checks use the cheapest models only (owner): `--model claude-haiku-5-5 --effort low` for Claude (never Haiku 4.5); OpenCode's free models (Big Pickle, `opencode-go/longcat-2.5-preview-free`). Space Bunny is no longer free.
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

- Agent memory: its own module after a design discussion (MODULES.md). Library agent writes may be reworked with it (D-64).
- "Always allow this" rules from a Needs you ask (e.g. always allow web search in a department), parked in D-57.
- Telling the user a CLI is out of date (D-58; needs a contract change).
- Pixel art and themes for characters, later, as a skin of `features/office/Character.tsx`.
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

- Where agent memory sits in the order; code signing for the installer; the final name.

## What the harnesses do

- Claude Code 2.1.287 (fixtures), 2.1.296 checked for sign-in and images, 2.1.302 for connectors. MCP tools are deferred behind its `ToolSearch` tool, so an agent first loads them, which shows in the trace. In `ask` mode a tool not in `--allowedTools` comes as `can_use_tool` with `tool_name` `mcp__<server>__<tool>`. Permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls; the model sometimes names their fields `title`, `id` or `task_id`, which the CLI accepts, so the adapter reads the CLI's own record in `tool_use_result`. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty. `AskUserQuestion` arrives as a permission request; the answer goes back as `answers` inside `updatedInput`. Its answer to an `initialize` control request lists models and effort levels, and it exits when stdin closes. `--include-partial-messages` adds `stream_event` lines with `text_delta`. `--resume <id>` keeps the same session id; an unknown id exits with code 1. `rate_limit_event` carries `unifiedWindows` (`five_hour`, `seven_day`) with `utilization` as a 0 to 1 share and `resetsAt` in epoch seconds; a refused turn has `status: "rejected"` and names the window in `rateLimitType`. Plan usage between runs comes from `/api/oauth/usage` (what the CLI's `/usage` calls) with the CLI's own token, never refreshed by us. `claude auth login` opens the browser and prints the page, then waits for a pasted code on stdin if the page shows one; `claude auth status --json` gives `loggedIn`, `email`, `subscriptionType`. `CLAUDE_CONFIG_DIR` moves the whole login. Claude apps (2.1.302): an `mcp_status` control request lists them with status, tools and `readOnly` markers, without a turn; `system/init` alone shows them still connecting. A permission request for one has `mcp_server.source: "claudeai"`. Gmail, Drive and Calendar show `needs-auth` in headless runs until `claude mcp login --no-browser "<app>"`, which prints Claude's page and exits.
- OpenCode 1.18.34 over ACP (1.19.3 checked for connectors). An `ask` rule on an MCP tool sends an ACP permission request with an empty `rawInput`; the input comes only after it is allowed (why the core decides connector calls, D-67). The todo list is a `todowrite` tool call. A sub-agent's inner steps are not forwarded. ACP has no way to ask the user a question. `session/new` returns the model list and an `effort` setting (category `thought_level`) for the current model only, changed with `session/set_config_option`. `opencode models --verbose` prints every model with its `variants` (effort values) and `capabilities.input`. `session/resume` continues without replaying; `session/load` replays the whole history. It reports context size and a dollar figure, no plan limit, and has no usage source. `opencode auth login --provider <id>` reads a key from stdin; `XDG_DATA_HOME` moves its keys and sessions.

## Environment (owner's machine, Windows 11)

- Present: git, Node 24.16, pnpm 12.8, Python 3.14, Claude Code and OpenCode logged in natively and in WSL Ubuntu (OpenCode on a Go subscription). `@napi-rs/keyring` works under Node 24 on Windows.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; call it by full path if it is not on PATH.
- Missing: `codex`, `agy`, Node inside WSL Ubuntu.
- The app's Terminal panel tab does not reach a prompt, so a real Ctrl+C cannot be sent from here.
- The browser pane does not draw while the Claude window is covered; `out/capture` is the fallback.

## Risks and known limits

- The CLIs' wire formats are not versioned. A CLI upgrade can break an adapter; re-record the fixtures when it happens.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- On Windows, if the harness's main process has already exited, anything it left running is not killed.
- `Session.send` and `SessionRegistry.send` trust their caller; the API validates first (`agentCommandSchema`).
- `costUsd` and `action.updated.title` are in the contract but never filled.
- A connector ask (Ask me first, request_app) lives as long as its agent's session, like a Library change; if the session ends first, the ask goes with it.
- The MCP SDK brings Express and Hono as dependencies of the core, unused by us.
- OpenCode gets extra folders through an `external_directory` rule, not ACP's `additionalDirectories`, which 1.18 does not offer. Switch when it does.
- OpenCode isolates only in part: its global config and instructions still load (D-41).
- Vendor policy on third-party use of subscriptions is still changing (D-6).
- `node:sqlite` is a release candidate in Node 24; an API change would touch `packages/service/src/store` only.
- A session already running in Bypass stays unguarded until it ends, even if its level is lowered (D-45). Under Bypass, Claude app calls run without the app's permission (D-68).
- A Claude agent's apps are read before each launch (1 to 2 s; up to 10 s before the run goes on with its apps off).
- Under Full a shell command, and under Bypass anything, could still change an upstream read-only folder; the plan card warns. One chief, one chief goal at a time.
- The app runs from the repository; the installer is the last module.

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) visualises one harness only. Interface references: gather.town, Age of Empires, squad.so.
- Command center research (2026-10-07): Gas Town (one "Mayor" agent you talk to), Paperclip (CEO agent, org chart, goals traced down), Cursor 3 "Needs Attention", Codex review queue, Vibe Kanban (cross-harness board), RimWorld and RTS (jump to the next waiting unit). Complaints to avoid: walls of live transcripts, waiting agents nobody notices, too many notifications.
