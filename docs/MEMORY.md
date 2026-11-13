# Memory

Last updated: 2026-11-13

## State

- Built and merged to `main`: M1 to M10, the feedback and optimization rounds, and the performance phase (PR #83). MODULES.md lists what each built.
- Phase 2 B, Efficient mode (D-94), merged as PR #84. Live smoke: two solo OpenCode runs on the free model with `--hand-over-at`.
- Phase 2 C, Milestones (D-95), merged as PR #85.
- Connectors revamp (D-96) merged as PR #86.
- OpenCode 1 and 2 (D-97) built on `feat/opencode-2`, PR open. Live on 2.3.0 and on a private 1.19.5 copy (its own data folder): models, a free-model task writing a file, recount (2.x with a sub-agent), the user's servers, key sign-in into an account folder (fake key). Raw ACP probes on both: one inline config, Code Mode off, tools called by name, a blocked server gone; on 2.x an MCP ask carries its input. Providers shows "version 2.3.0". Mixed, in one process: Windows 2.3.0 and WSL Ubuntu 1.19.4 each list models with their own commands, and a WSL task ran.
- What OpenCode 2 adds (D-98), on the same branch and PR. Live on 2.3.0 through the harness with a notes app as team server and shared app: a Code Mode script with both app calls nested and the team tool direct, a message steered into the turn, a `question` answered, a background sub-agent's glob, read and reply nested with its call open past the turn, an OpenCode server ask under Ask me first naming the app with its input. Live on 1.19.5: no steering, no questions, no Code Mode, team tool as before.
- Sub-agents you can see (D-99), on the same branch and PR: one tracker of open sub-agents, one report per piece with an interim note to the lead, idle stop waiting, the "Waiting on N sub-agents" state, the card, team tree rows, side panel and office chip. Live, a lead and a worker each time: Claude haiku 4 runs (heads-up once, one result after Claude's own wake turn, 91 s and 158 s of quiet with `--idle-after 60` and no stop, panel live in dark and light); OpenCode 2 on `opencode-go/deepseek-v4.1-flash` (heads-up, the core's notice, one result, 100 s quiet with no stop).
- Next: the public release steps in MODULES.md, on the owner's go-ahead.
- The owner's machine runs the installed app (`%LOCALAPPDATA%\Programs\office-town`) on the beta channel; development runs on `OfficeTown Dev`. Codex 0.167.2 is signed in (ChatGPT Free: only its default model runs, `gpt-5.4-mini` is refused), with the Hugging Face plugin installed during the D-96 probe and its sign-in not finished; Copilot, Cursor and Muse are installed, not signed in. OpenCode is 2.3.0 (npm `@opencode/cli`, replacing 1.19.5); the 1.x config, `auth.json` and `opencode.db` are backed up in `~opencode-v1-backup-2026-11-13`. Logon tasks update the CLIs: `Claude Code Auto Update`, `OpenCode 2 Auto Update` (`@opencode/cli@latest`), and the old `OpenCode Auto Update` (`opencode-ai`), which now fails with EEXIST.

## Not checked yet

Each item: how to reach it, what should happen.

- D-97 in the app: an OpenCode agent on 2.x end to end (team tools, a plan from `todowrite`, Needs you asks with edits under Ask me first), a 1.x session resumed on 2.x, key sign-in from Add account, Install on a machine without OpenCode (should install `@opencode/cli`). Wrong if any shows `execute` as a step or a user's blocked server reaches the agent.
- D-98 in the app: an OpenCode 2 agent with a shared app (a Code Mode script should show its app calls nested, and an Ask me first app's change wait in Needs you), a message sent mid-turn (should be taken at the next tool end without the turn restarting), a `question` in Needs you, a sub-agent nested in the trace. Wrong if the lead's team tools show inside an `execute` script, or a sub-agent's call never ends.
- D-99 a lead on OpenCode 2 whose sub-agent ends after its turn: it should get "Your sub-agents finished" and reply in a turn of its own (checked live on a solo agent only). Wrong if its reply shows only after the next message.
- D-99 in the packaged app: the office card's "N sub-agents" chip should open the task with the panel open; a sub-agent's panel on OpenCode 2 should list its steps (the live OpenCode run predates the fix that reports 2.x as sharing steps). A worker with two sub-agents ending apart should still send one result. Codex, Muse, Copilot and Cursor sub-agents were not run: each should show a card and a panel with the prompt and the line that steps are not shared. Wrong if a Codex child that outlives the turn is missed (not tracked, D-99).
- D-96 Codex app connected through ChatGPT: press Set up in Codex on an ask, connect the app on the ChatGPT page, come back. It should show with the Codex tag and the ask answer itself; wrong if Codex lists it only once the plugin is installed (then `plugin/install` with the remote id from `plugin/read`).
- D-96 handover after a provider app is given mid-task: the agent should call `hand_over` and its new conversation have the app; wrong if it carries on without it or the handover waits in Needs you.
- D-96 a Codex app change under Ask me first: Plugin Management's uninstall should wait in Needs you with its input. Only reads ran live.
- D-96 OpenCode's own servers: an enabled one in `opencode.jsonc` should show with the OpenCode tag on Don't ask, run without asking, and its page list each action once used. The owner has none enabled. Handing a new server to OpenCode or Codex for their own sign-in is not built.
- D-96 Needs renewing: a Claude app signed out after use should show amber with Renew on its card and page, opening claude.ai; a Codex or OpenCode one shows "Sign in in Codex" instead. Only offers (never signed in) were seen.
- D-96 ask audience: on an ask for a shared app, pick Everyone, then Save in Add. The app should go to Everyone; wrong if it ends up with the department only.
- D-96 teammate first: in a department with a Claude member who has Gmail, a Codex member asking for Gmail should be told to hand the step over (or ask the lead), with no Needs you card.
- D-96 shared keys not connected live: Firecrawl, Tavily, Linear, Supabase, Neon, Stripe, Apify, PostHog (only Exa ran). Firecrawl and Tavily document the key in the address, so a header key may fail.
- D-96 screens not captured: the department Apps section, the team builder warning, the walkthrough card.

- D-95 send-back live (the flow test covers it): a lead's `send_back` twice, then a third should put a question in Needs you with the tries; Send back once more should start the worker again, Accept as is should tell the lead. Wrong if a third send-back reaches the worker.
- D-95 chief: a goal to the chief with Milestones on should show each piece's milestones on the plan card, editable; once a piece starts, they should be its department's goal milestones in Progress. The checker started on a Milestones task should list them first, marked from the lead. A handover on a Milestones task should carry progress and steps from the record.
- D-95 Milestones turned on mid-task: the run card says it applies at each agent's next start; a lead resumed after an idle stop should be told to write them. A Claude lead or worker (only OpenCode ran live), and "got it" on Codex or Muse (`turn/steer` may start no new turn, so it could stay at "Sending to").
- D-94 on Claude, Codex or Muse (only OpenCode ran live): start an Efficient task with the core on `--hand-over-at 5000` and a multi-step prompt. It should be asked mid-turn, call `hand_over` and go on in a new session; wrong if asked only at the turn's end, or never.
- D-94 in a live team: a worker past the size should go on with the same piece and the lead get one result; wrong if the lead hears "finished" for the old session. A lead or chief should go on with workers' results reaching the new session (tested on fakes only).
- D-94 without `--hand-over-at` on OpenCode's free model (200k window): a worker past about 160k should be asked before OpenCode compacts at 170k. A Claude worker whose background sub-agent is running: the switch should happen once the sub-agent ends, not at the idle stop.
- D-94 in the desktop app: Export should open a Save dialog, Save to Library should add the file to the workspace's Library. The Long chats card, run card row and Handovers in light mode.
- D-94, Claude's idle compaction (2.1.290+, one-hour cache): a session idle for an hour should not compact before our 10 minute idle stop closes it.
- D-93: five real Ctrl+C stops of `pnpm dev:app`, each printing the core stopping and leaving no electron.exe; the dev app's taskbar icon is the app's. The packaged app.
- D-92: WSL queries waiting their turn, in the packaged app.

Worth a click when the area is touched:

- D-91: counts while a live team task ends, a chief goal's parts in search, Show earlier on a live run, template use counts, a reconnect dropping a removed agent.
- D-90, D-81: Needs you kept with live requests, scroll place on a long list, setup after a restart mid-way, a real drafter run, drafts in the packaged app.
- D-89: the shell's text menu in the packaged app; menus in light mode.
- D-87, D-85: a description or title written by Claude's Haiku (only OpenCode's free model ran), a describer that fails or is slow.
- D-86: a real restart mid-task, then a message to the lead from its chat.
- D-84, D-83: a check holding a department in the app, the queue on a Codex or Muse worker, a brief missing its turn live, the stale-step rule in a real long run.
- D-82, D-80, D-79: the permission chip on a solo agent, a level change reaching an agent at work, Runs on WSL from the picker, moving a team with work in progress to another provider.
- D-78, D-77: a Claude lead calling `propose_change`; `turn/steer` live on Codex and Muse; tool-end delivery on Copilot and Cursor; a whole failing team end to end.
- D-76: every live run on Codex, Copilot, Cursor and Muse (recordings only), their sign-in and Add account, Codex and Muse meters, the estimate on a real run, Install through npm.
- D-75: the Linux AppImage, an update between two real GitHub betas, Restart to update with agents open, the setup install line live.
- D-74, D-73, D-72: a worker's result after its merge, `show_result` from OpenCode or WSL, a PDF in the frame; a team lead writing its checklist, Send fixes and round 2, a copy sandbox; a real 95% pause.
- D-67, D-68: a Claude app's sign-in end to end, a second Claude account's apps, `request_app` to a teammate, a real key app, a WSL agent using a connector, a local program such as Blender.
- Older: the plan card and re-plan view, the tray's Quit prompt, the store size warning, a WSL run from New task, chief and Library tutorials live, setup with a provider not installed or not signed in, light mode on workspaces, the run card, pause and check cards.

## Owner requirements not yet built

- OpenCode 2 left out (D-98): the background service (about 1.8 s per side command, but it ignores an account's folder and leaves a process running; `acp` never uses it); Code Mode for the user's own OpenCode servers (an ask from a script names only the script; would need their full configs copied with `codemode: false`). Already before D-97: an OpenCode session whose app list cannot be read leaves the user's servers on (blocking needs their names).

- Recovery gaps (D-77): a lead that fails twice has no Needs you card; a message waiting on one long tool shows as sent; a message still waiting when a session ends is lost; a hung worker shows only as "last active N min ago"; results that end while a lead is stopped are not replayed on resume.
- "Always allow this" rules from a Needs you ask, parked (D-57).
- Telling the user a CLI is out of date (needs the CLI's version in the catalog: a contract change).
- Voice input, parked by the owner (2026-10-24); the plan (on-device sherpa-onnx with Parakeet) is on closed PR #68.
- Pixel art and character themes, later, as a skin of `features/office/Character.tsx`.
- Agent memory across tasks, deferred (2026-10-23): the harnesses keep their own.

## Open questions for the owner

- Whether Whole department stays the run card's default (D-79).
- Apply to SignPath Foundation for signing (D-75); reminded 2026-10-23.
- Before the release: the intro video (a discussion first) and the final name ("Bullpen" was rejected).

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings. Read the test count from vitest; the repo sits at the cap of 50.
- `pnpm dev:app`: "Office Town Dev" beside the installed app. The UI reloads; a change to the shell or core restarts the app. Every dev command uses the `OfficeTown Dev` data folder unless given `--data-folder`.
- `pnpm dev:web [--data-folder path]`: browser mode at http://localhost:5173. The folder picker, Open folder and dropping folders need the app.
- `pnpm package [--beta n | --stable]`: the installer in `apps/desktop/out/package/installers` (local builds are `-beta.0`). Install silently with `<setup>.exe /S`.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume id]`; `pnpm dev:catalog [--harness ...]` lists models and efforts.
- `pnpm dev:core [--data-folder path] [--port n] [--hand-over-at tokens] [--idle-after seconds]`: prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`. `POST /tasks` needs a `workspaceId`.
- Git Bash: set `MSYS_NO_PATHCONV=1` before calling the core, and build JSON with Windows paths inside Node, not the shell.
- Live checks use the cheapest models only: `--model claude-haiku-5-5 --effort low` for Claude; for OpenCode `opencode/deepseek-v4.1-flash-free`, `opencode-go/deepseek-v4.1-flash` or `opencode-go/muse-spark-1.3-contributor`; never `gpt-5.4-nano` (refused) or Hugging Face models. Beam Free refuses runs with over 128 tools.
- New recording: CLI stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}`). Strip machine paths, account details and the user's skill and command lists.
- Mockups are checked at full size before they are shown: the `mockup` entry in `.claude/launch.json` (static server, port 5190), shot with `out/capture` in dark and light.

## Where things are

- Core: `packages/service/src` with `store`, `registry`, `api`, `team`, `tools`, `autonomy`, `chief`, `accounts`, `attachments`, `library`, `drafts`, `connectors`, `outputs`. API messages: `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`, `src/styles/tokens.css`. App icon source: `apps/desktop/src/ui/app-icon.svg`.
- Data folders: installed `%LOCALAPPDATA%\OfficeTown`, development `%LOCALAPPDATA%\OfficeTown Dev` (Linux: `office-town` and `office-town-dev` under XDG data).
- Local only, outside git: `.claude/launch.json`, `out/capture` (off-screen Electron screenshots), `out/burn.mjs` (a run's token spend from a store copy), `out/seed-pause.ts`, `feedback_images/`.
- Test app for connectors: `node packages/service/test/support/notes-app.ts <port>` (HTTP), `--stdio` for a local program.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.

## What the harnesses do

- Claude Code (2.1.287 fixtures; 2.1.316 latest probed). Every turn starts with `system/init`. A message sent during a turn folds into it at the next tool end, with no new `system/init`; `--replay-user-messages` echoes it when taken. MCP tools are deferred behind `ToolSearch`. In `ask` mode a tool not in `--allowedTools` comes as `can_use_tool`. The plan comes from `TaskCreate`/`TaskUpdate`; read the CLI's own record in `tool_use_result`, since the model names fields loosely. Sub-agents run in the background, so a turn can end before its sub-agent; once it ends the CLI starts a turn of its own. It refuses a standalone `sleep` (use `ping -n N 127.0.0.1` for a slow live check). Thinking text arrives empty. `AskUserQuestion` comes as a permission request; answer with `answers` in `updatedInput`. `initialize` lists models and efforts. `--resume <id>` keeps the id. `rate_limit_event` carries `five_hour` and `seven_day` utilisation (0 to 1) and `resetsAt`; a refused turn has `status: "rejected"`. `claude auth status --json` gives `loggedIn`, `email`, `subscriptionType`. `CLAUDE_CONFIG_DIR` moves the login. `mcp_status` lists claude.ai apps with `readOnly` markers without a turn; Gmail, Drive and Calendar need `claude mcp login --no-browser "<app>"` in headless runs.
- OpenCode 1 (1.18.34 fixtures, 1.19.5 probed) and 2 (2.3.0, `team-tool-2` fixture) over ACP, one adapter (D-97). 2.x: every command but `acp` uses a shared background service unless `--standalone` (`acp` starts its own); `opencode2` is an alias; config sources print from `debug config`; Code Mode wraps MCP calls in an `execute` script unless `execute` is denied or the server has `codemode: false`; ACP-attached servers always get it. A finished background sub-agent wakes the agent with no end signal; a prompt sent right then runs as a normal turn. `OPENCODE_CONFIG` pointing at a file with `small_model` sets the title model (2 maps it to `agents.title`). `features-2` and `subagent-2` fixtures (D-98). 1.x: An `ask` rule on an MCP tool asks with an empty `rawInput` (why the core decides connector calls). The todo list is `todowrite`. Sub-agents' steps are not forwarded. ACP cannot ask the user a question on 1. `session/new` gives models and the current model's `effort`; `opencode models --verbose` lists every model's variants, inputs and window. Reports context size as a prompt ends, no plan limit. It waits for every MCP server in the user's global config before `session/new` answers: an `npx` server cost 14 s per start, so the owner's `rea` server is disabled in `~/.config/opencode/opencode.jsonc`. It calls `fs/write_text_file` although the client says it cannot; refused, it writes the file itself, and once its idle process later exited on that refusal (code 1, D-77).
- Sub-agents (2026-11-13, D-99). Claude Code 2.1.323: `Agent`/`Task`, `run_in_background` outlives the turn, every step reaches us, and once it ends the CLI starts a turn of its own (`system/init`, reply, `result`). OpenCode 2.3.0: `subagent` always runs in the background, steps through `child_update`, and wakes the agent with no turn events after each round of the child's work. OpenCode 1: `task` ends inside the turn, no steps. Codex (source): `spawnAgent` returns at once and a child's result waits for the parent's next turn (`trigger_turn: false`); its threads are not followed. Muse: `subagent` items with an `objective` (its prompt), no steps; outliving a turn unverified. Copilot (`/fleet`) over ACP unverified; Cursor's `is_background` blocks in CLI and ACP (Cursor staff, 2026-04).
- Codex 0.167.2 (`codex app-server`; the 0.164 fixtures still pass). It reports a user message as an item with object parts, and asks before every MCP call as `mcpServer/elicitation/request` (`_meta.codex_approval_kind: "mcp_tool_call"` with the tool, connector id and input), ignoring an `auto` approval mode, so the translator accepts the core's own. ChatGPT apps are the `codex_apps` server's tools grouped by `_meta.connector_id` (not always `connector_*`). Copilot 1.0.103 (`copilot --acp`), Cursor (`cursor-agent acp`), Muse 1.4.13 (`muse serve`). Sign-in: `codex login`, `copilot login` (token in the OS store), `cursor-agent login`, `muse login` (`META_API_KEY` wins).
- DeepSeek V4.1 Flash on OpenCode Go: first token 1 to 3 s on a cache hit, up to 55 s on a miss at 370k. Misses are the provider's.

## Environment (owner's machine, Windows 11)

- git, Node 24.16, pnpm 12.8, Python 3.14, Claude Code and OpenCode signed in natively and in WSL Ubuntu (no Node in WSL). `gh` at `C:\Program Files\GitHub CLI\gh.exe`. Git Bash does not see Cursor or Muse; PowerShell does.
- Commands run from the Claude desktop app see a virtualized `%LOCALAPPDATA%`, so the stores there read as stale or "malformed". The real store is fine: read it from a process started through `Win32_Process.Create` (WMI), or measure on a copy of a `store.db.bak-v*` with `immutable=1` in the scratchpad.
- Defender refuses `irm … | iex` run from a hidden process (`Commando.A!ml`). Never run a vendor's one-line installer hidden.
- The browser pane does not draw while the Claude window is covered; `out/capture` is the fallback. The Terminal panel cannot send a real Ctrl+C.
- Explorer remembers a taskbar icon per app ID; the dev window names its own `.ico`.

## Risks and known limits

- The CLIs' wire formats are not versioned; an upgrade can break an adapter.
- WSL path mapping assumes the default `/mnt/<drive>` root. On Windows, children a harness left behind after its main process exited are not killed.
- `node:sqlite` is a release candidate in Node 24; a change touches `packages/service/src/store` only.
- A checker's worktree shares the user's `.git`; its brief forbids commits, pushes and branch changes.
- A connector ask or Library change lives as long as its agent's session.
- A `harness` change sent while the event stream reconnects is lost until the next check. `/workspaces/usage` is read about 9 times at launch.
- `costUsd` and `action.updated.title` are in the contract but never filled. The MCP SDK brings Express and Hono, unused.
- Betas are unsigned, so SmartScreen warns on first install. Vendor policy on third-party use of subscriptions keeps changing.

## References

- Prior art visualises one harness only (Munder Difflin, Pixel Agents, Claude Office Visualizer). Interface references: gather.town, squad.so, Paperclip (CEO agent, org chart), Cursor's Needs Attention, RTS "jump to the next waiting unit". Avoid walls of live transcripts, waiting agents nobody notices, too many notifications.
