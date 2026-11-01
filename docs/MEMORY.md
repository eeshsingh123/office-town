# Memory

Last updated: 2026-11-02

## State

- Built and merged to `main`: M1 to M9, the feedback rounds after M5 and after M7 (D-69, round 2), and the optimization phase (D-70 to D-73), up to PR #66 (2026-10-23).
- The optimization phase cut team spend: OpenCode usage is recounted after a session (D-70), a lead can ask to stop its workers (D-71), the lead manages while workers report short, with a user-asked handover and a pause past 95% of a usage window (D-72), and finished work is checked outside the team against a checklist the user approves (D-73). A solo task's prompt ends with a line asking for `write_checklist`, because Claude defers the tool and never looks.
- M8 Outputs and preview (D-74) mockup: https://claude.ai/artifact/KWcarQmWHFRReo2nb89asR.
- Built: M10 More AI apps (D-76), merged as PR #71. Live runs on Codex, Copilot, Cursor and Muse wait for the owner to sign in; all four are installed on the owner's machine, not signed in. Next: the public release steps in MODULES.md. New modules go discussion, mockup, build (AGENTS.md).
- Done: feedback after M9 (PR #67, merged): office walking speed, department focus, and the new app icon ("Late shift", picked by the owner from https://claude.ai/artifact/DQ2HJ96qVcEUAgqA15AikD). The icon's source is `apps/desktop/src/ui/app-icon.svg` (sidebar logo, browser tab); `electron/icon.png` (64 px, window and tray) and `packaging/icon.png` (512 px, installer) are rendered from it. Betas are for the owner only; the stable release runs only when the owner asks. Agent memory is deferred.
- The owner's machine runs the installed app (`%LOCALAPPDATA%\Programs\office-town`) on the default data folder and follows betas; development runs on `OfficeTown Dev`. Its store had lost Scratch; the next beta restores it (D-56).
- Mockups are checked at full size before they are shown: serve the HTML (`mockup` entry in `.claude/launch.json`, a static server on port 5190) and shoot it with `out/capture` in dark and light.

- Feedback on PR #72 (D-79): thinking before a model is picked, one id-named Scratch folder per task, documents opening in Outputs with nothing shown, the AI app on the run card. The two-pane picker (D-80) is on the same PR.
- Form drafts (D-81): what is typed outlives the screen and the app. New forms use `useDraft` in place of `useState`.
- Task page feedback (D-82): the org chart on Describe and Review (mockup https://claude.ai/artifact/15etZWBFsxzzJ4YTr5pCua), one permission chip under the message box, Scratch only for a department with no folder, a scroll place per chat, Stop team confirms.
- Honest progress (D-83), on the same PR: steps that stop moving give way to the current action, the floor's work bubble shows on hover or reach, a brief to a busy worker reaches it at its next tool end with a queued icon.

## Not checked yet

Worth a click when touched.

- D-83: the queue on a Claude, Codex or Muse worker (only OpenCode was run), a brief missing its turn live (tested on a fake session), the stale rule in a real long run (run on the trace code), the bubble in light mode, keyboard focus on an agent.
- D-82: real mouse scrolling between agents (the test pane was hidden, so scroll events were sent by hand), the permission chip on a solo agent in the app (only its API was run), a level change reaching an agent at work, a capped member's note, the chart in light mode, the Scratch clean-up on a real store (tested on a test store). A group the user opened folds back when they switch agents, so a place in a long chat can shift a little.
- D-81: a real drafter run (the reply was stubbed), drafts in the packaged app (`pnpm dev:web` only), the request cards with a live request, Add your own and the workspace sheet, reopening after a reload with attachments (a remount was run), Start over while a draft is running (a late reply fills the form again).
- D-80: OpenCode's preferred default in a real task from the app (only `dev:run` was run), switching Runs on to WSL from the picker, the left pane in a window under 640 px wide, a real pick on Codex, Copilot, Cursor or Muse (not signed in), the saved lists in the packaged app (only `pnpm dev:web` was run).
- D-79: moving a team with work in progress live (only a finished team was moved; a move to another AI app was run on one assistant, Claude Code from OpenCode), a lead's new conversation on another AI app, an OpenCode agent keeping to its Scratch folder (Claude did), Copilot and Cursor's Thinking row with no model picked.
- Change of direction (D-78): a Claude lead calling `propose_change` (its tools are deferred; only an OpenCode lead was run), a lead asked mid-run after real work, an answer in the user's own words live.
- Recovery (D-77): `turn/steer` live on Codex and Muse (schema only), the tool-boundary delivery on Copilot and Cursor (only OpenCode was run), a whole failing team live end to end, a model change on a resumed OpenCode session.
- M10 (D-76): every live run on Codex, Copilot, Cursor and Muse (recordings only; Codex's and three of Muse's follow the CLI's schema), their sign-in and Add account from the app, Codex and Muse meters live, the estimate on a real Copilot or Cursor run, Install through npm from the sheet, light mode on Providers, a resumed Muse session setting its approval mode and model again.
- Packaging (D-75): the Linux AppImage (built only in CI), an update from one real GitHub beta to the next (`v0.1.0-beta.1` is the first; the update was tested with a local feed), Restart to update with agents open, an installed app's WSL task from the UI (tested on the packaged core), the setup Install progress line live (the API was run end to end with OpenCode through npm), the install folders on Linux.
- Outputs (D-74): a team worker's result after its merge (tested in the core, not live), an OpenCode or WSL agent calling `show_result`, a PDF in the app's frame, a version's page loading its styles, a stopped site restarted fresh, Open with default app, light mode on the Outputs tab.
- Check loop (D-73): a team lead writing its checklist, Send fixes and round 2, a copy sandbox (no git), WSL.
- Lean runs (D-72): a real 95% pause (needs a nearly used window), the 400k handover suggestion.
- Usage (D-70): a sub-agent's tokens followed live, a WSL recount.
- Feedback round 2 and D-69: the plan card's workspace pick with a live chief, "Last:" lines with real history, the drafter no longer numbering roles, the agent profile and template point lists, your message in a live trace, pods with live bubbles and dragging a room with pods, several role groups in "Who works on this".
- M7: a Claude app's sign-in end to end, Refresh after connecting a new app on claude.ai, a second Claude account's apps, `request_app` routing to a teammate, a real key app (GitHub with a token), a WSL agent using a connector, a local program from the catalog such as Blender, the Windows "keys cannot be saved" path.
- Older: the plan card and re-plan view, next waiting with the in-place card, Mark reviewed and Follow up, hand-off motion, reduced motion and dark mode on the floor; the tray's Quit prompt, the Windows notification, the store size warning (over 1 GiB), "Show older tasks" (over 50); a WSL run from New task, a WSL Claude agent calling a team tool, WSL share-name folding in the read-only check, plan usage for a WSL or added account; drag and drop and Add folder (app only); a chief draft live, the chief and Library tutorials live, setup with an AI app that is not installed or not signed in; the empty Team page and the "No chief" slot.
- Light mode on the newer screens: workspaces, room tokens, the run card, pods, the pause card, the check card.

## Notes
- The "owes a turn" rule (D-50): a user message after a turn started counts; an answer counts only after the turn ended, since a harness's own question is answered inside its turn.
- Where things are: core `packages/service/src/main.ts` with `store`, `registry`, `api`, `team`, `tools`, `autonomy`, `chief`, `accounts`, `attachments`, `library`, `drafts`, `connectors`. API messages in `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`, `src/styles/tokens.css`. Data folders: the installed app `%LOCALAPPDATA%\OfficeTown`, development `%LOCALAPPDATA%\OfficeTown Dev` (Linux: `office-town` and `office-town-dev` in the XDG data folder).
- Local only, outside git: `.claude/launch.json` (browser preview configs, excluded in `.git/info/exclude`), `out/capture` (off-screen Electron screenshots), `out/burn.mjs` (a run's token spend from a copy of the store), `out/seed-pause.ts` (seeds a paused task), `feedback_images/`.
- A test app for connectors: `node packages/service/test/support/notes-app.ts <port>` serves it over HTTP; with `--stdio` it is a local program.
- Mockups (private to the owner): M3 https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp, M4 https://claude.ai/artifact/Wuj5ihNNu4fVDGqxzLrQ4B, M5 https://claude.ai/artifact/2JtgLDazsmQeYH7hLuQuA3, creation flows https://claude.ai/artifact/PaPEMXnWXrc9gxQdGtTqsC, workspaces https://claude.ai/artifact/TAJNDntGi4PYmcExP6opUb, Library https://claude.ai/artifact/6TrVZrWjcnvXDWxGivLVgm, composer https://claude.ai/artifact/71RVoeMQkxza3Pq72eyxn9, team building https://claude.ai/artifact/WkgeYGyai2cMSCFoSMtTgp, team page https://claude.ai/artifact/FyPveyDNnv96N8SoAs4PFc, connectors https://claude.ai/artifact/AMEbojnd6kH9UExCAbFtti, department workspaces and big teams https://claude.ai/artifact/Dih5V7i4Z9Y5Efxrzi6EZz.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:app`: "Office Town Dev", next to the installed app. The UI rebuilds and the window reloads; a change to the shell or the core restarts the app. Every dev command uses the `OfficeTown Dev` data folder unless given `--data-folder`.
- `pnpm dev:web [--data-folder path]`: browser mode at http://localhost:5173, a core plus Vite forwarding `/api` with the token. The folder picker, Open folder and dropping folders need the app.
- `pnpm package [--beta n | --stable]`: the installer for this OS in `apps/desktop/out/package/installers` (local builds are `-beta.0`). Install silently with `<setup>.exe /S`.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume harness-session-id]`
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: models and their effort values.
- `pnpm dev:core [--data-folder path] [--port n]`: the core. It prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`. `POST /tasks` needs a `workspaceId`.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before calling the core, or it rewrites `/tasks` into a Windows path. Windows arguments also lose doubled backslashes, so build JSON with Windows paths inside Node, not in the shell.
- Live checks use the cheapest models only (owner): `--model claude-haiku-5-5 --effort low` for Claude (never Haiku 4.5); OpenCode's free models (Big Pickle, `opencode-go/longcat-2.5-preview-free`). Space Bunny is no longer free. Beam Free refused a run with more than 128 tools (2026-11-01).
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

- Recovery gaps from D-77: a lead that fails twice has no Needs you card; a message waiting on one long tool shows as sent; a message still waiting when a session ends is lost; a hung worker is only visible as "last active N min ago"; results that end while a team lead is stopped are not replayed on resume.
- "Always allow this" rules from a Needs you ask (e.g. always allow web search in a department), parked in D-57.
- Telling the user a CLI is out of date (D-58; needs a contract change).
- Voice input, parked by the owner (2026-10-24): shipping it to users is too much work for now (a native speech engine in the installer, a model download of several hundred MB, mic permissions). The owner may add it later, for themself first. The plan (on-device sherpa-onnx with Parakeet) is on closed PR #68.
- Pixel art and themes for characters, later, as a skin of `features/office/Character.tsx`.
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

- Whether Whole department stays the run card's default (D-79).
- Apply to SignPath Foundation for signing now that P4 is built (D-75); reminded 2026-10-23.
- Before the release: the intro video (a discussion), the final name.

## What the harnesses do

- Claude Code 2.1.287 (fixtures), 2.1.296 checked for sign-in and images, 2.1.302 for connectors. A message sent during a turn folds into it at the next tool end, with no new `system/init` and one `result` (2.1.316). MCP tools are deferred behind its `ToolSearch` tool, so an agent first loads them, which shows in the trace. In `ask` mode a tool not in `--allowedTools` comes as `can_use_tool` with `tool_name` `mcp__<server>__<tool>`. Permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls; the model sometimes names their fields `title`, `id` or `task_id`, which the CLI accepts, so the adapter reads the CLI's own record in `tool_use_result`. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty. `AskUserQuestion` arrives as a permission request; the answer goes back as `answers` inside `updatedInput`. Its answer to an `initialize` control request lists models and effort levels, and it exits when stdin closes. `--include-partial-messages` adds `stream_event` lines with `text_delta`. `--resume <id>` keeps the same session id; an unknown id exits with code 1. `rate_limit_event` carries `unifiedWindows` (`five_hour`, `seven_day`) with `utilization` as a 0 to 1 share and `resetsAt` in epoch seconds; a refused turn has `status: "rejected"` and names the window in `rateLimitType`. Plan usage between runs comes from `/api/oauth/usage` (what the CLI's `/usage` calls) with the CLI's own token, never refreshed by us. `claude auth login` opens the browser and prints the page, then waits for a pasted code on stdin if the page shows one; `claude auth status --json` gives `loggedIn`, `email`, `subscriptionType`. `CLAUDE_CONFIG_DIR` moves the whole login. Claude apps (2.1.302): an `mcp_status` control request lists them with status, tools and `readOnly` markers, without a turn; `system/init` alone shows them still connecting. A permission request for one has `mcp_server.source: "claudeai"`. Gmail, Drive and Calendar show `needs-auth` in headless runs until `claude mcp login --no-browser "<app>"`, which prints Claude's page and exits.
- Codex 0.164 (`codex app-server`), Copilot 1.0.103 (`copilot --acp`), Cursor (`cursor-agent acp`), Muse 1.4.13 (`muse serve`): see D-76. Sign-in: `codex login` (browser; `--device-auth`, `--with-api-key`), `copilot login` (browser, token in the system's credential store), `cursor-agent login` (browser; `cursor-agent status --format json`), `muse login` (approve a code in the browser; `META_API_KEY` wins over it).
- OpenCode 1.18.34 over ACP (1.19.3 checked for connectors). An `ask` rule on an MCP tool sends an ACP permission request with an empty `rawInput`; the input comes only after it is allowed (why the core decides connector calls, D-67). The todo list is a `todowrite` tool call. A sub-agent's inner steps are not forwarded. ACP has no way to ask the user a question. `session/new` returns the model list and an `effort` setting (category `thought_level`) for the current model only, changed with `session/set_config_option`. `opencode models --verbose` prints every model with its `variants` (effort values) and `capabilities.input`. `session/resume` continues without replaying; `session/load` replays the whole history. It reports context size and a dollar figure, no plan limit, and has no usage source. `opencode auth login --provider <id>` reads a key from stdin; `XDG_DATA_HOME` moves its keys and sessions.

## Environment (owner's machine, Windows 11)

- Present: git, Node 24.16, pnpm 12.8, Python 3.14, Claude Code and OpenCode logged in natively and in WSL Ubuntu (OpenCode on a Go subscription). `@napi-rs/keyring` works under Node 24 on Windows.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; call it by full path if it is not on PATH.
- Installed, not signed in (2026-10-25): codex-cli 0.164.0, GitHub Copilot CLI 1.0.103 (npm), Cursor CLI (`%LOCALAPPDATA%\cursor-agent`), Muse Code 1.4.13 (`%LOCALAPPDATA%\Programs\muse`). Git Bash does not see the last two; PowerShell does.
- Missing: Node inside WSL Ubuntu.
- Explorer remembers a taskbar icon per app ID and does not re-read the window's. The dev app showed Electron's until its ID in `electron/main.ts` changed (2026-11-02).
- The app's Terminal panel tab does not reach a prompt, so a real Ctrl+C cannot be sent from here.
- The browser pane does not draw while the Claude window is covered; `out/capture` is the fallback.
- Defender flags PowerShell running `irm … | iex` from a hidden process (`Commando.A!ml`) and refuses the start (`spawn EPERM`). Never run a vendor's one-line installer hidden.
- Start an installed app or installer from here through `Win32_Process.Create` (WMI) so it uses the real `%LOCALAPPDATA%`; a window of it can be pressed through UI Automation (InvokePattern) without moving the mouse.
- Commands run from the Claude desktop app see a virtualized `%LOCALAPPDATA%` (its private copy lives in `Packages\Claude_*\LocalCache\Local`): `OfficeTown\store.db` there is an Oct 7 copy, so it reads as "malformed". The real store is fine; read it from a process started through `Win32_Process.Create` (WMI), which runs outside the package.

## Risks and known limits

- The CLIs' wire formats are not versioned. A CLI upgrade can break an adapter; re-record the fixtures when it happens.
- `owesTurn` counts a message after the latest `turn.started`, which Claude never sends for a folded one (D-83). By the code, a goal whose Claude lead took a message mid-turn reads working until the idle stop, about 10 minutes; not seen in the app.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- On Windows, if the harness's main process has already exited, anything it left running is not killed.
- `Session.send` and `SessionRegistry.send` trust their caller; the API validates first (`agentCommandSchema`).
- `costUsd` and `action.updated.title` are in the contract but never filled.
- A checker's worktree shares the user's `.git`, so a git command it runs could still change refs; its brief forbids commits, pushes and branch changes. A checker resumed after it ended finds its sandbox gone.
- A connector ask (Ask me first, request_app) lives as long as its agent's session, like a Library change; if the session ends first, the ask goes with it.
- The MCP SDK brings Express and Hono as dependencies of the core, unused by us.
- OpenCode gets extra folders through an `external_directory` rule, not ACP's `additionalDirectories`, which 1.18 does not offer. Switch when it does.
- OpenCode isolates only in part: its global config and instructions still load (D-41).
- Vendor policy on third-party use of subscriptions is still changing (D-6).
- `node:sqlite` is a release candidate in Node 24; an API change would touch `packages/service/src/store` only.
- A session already running in Bypass stays unguarded until it ends, even if its level is lowered (D-45). Under Bypass, Claude app calls run without the app's permission (D-68).
- A Claude agent's apps are read before each launch (1 to 2 s; up to 10 s before the run goes on with its apps off).
- Under Full a shell command, and under Bypass anything, could still change an upstream read-only folder; the plan card warns. One chief, one chief goal at a time.
- Betas and installers are unsigned, so Windows SmartScreen warns on first install (SignPath, D-75).

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) visualises one harness only. Interface references: gather.town, Age of Empires, squad.so.
- Command center research (2026-10-07): Gas Town (one "Mayor" agent you talk to), Paperclip (CEO agent, org chart, goals traced down), Cursor 3 "Needs Attention", Codex review queue, Vibe Kanban (cross-harness board), RimWorld and RTS (jump to the next waiting unit). Complaints to avoid: walls of live transcripts, waiting agents nobody notices, too many notifications.
