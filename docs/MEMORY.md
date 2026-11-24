# Memory

Last updated: 2026-11-24

## State

- Merged to `main`: M1 to M12 PR 2 (PR #105), with every feedback, audit and design round. MODULES.md says what each built, DECISIONS.md why.
- Open: PR #106 on `feat/automation-delivery`, M12 PR 3, automations end to end (D-130 to D-134). Live smoke passed on 2026-11-24 (OpenCode free model, a local fake Slack): a schedule fired, its result was sent, notes were kept, a run with nothing new stayed quiet.
- Next, on the same branch: the Updates rework (owner, 2026-11-24). Results and alerts become Updates for tasks and automations, set up with no upkeep (no sign-ins, servers or vendor app registration), each service with a short picture guide; no WhatsApp. Build guide: `docs/briefs/updates/README.md` (local only). Then the owner reviews and merges PR #106.
- After M12: M15 Ready-made teams (D-115), discussed with the owner end to end first. Kickoff: `docs/briefs/ready-made-teams/README.md` (local only). M13 phone and M14 always-on wait until real users ask; M13's plan is in `docs/briefs/autonomy/README.md` (local only).
- Parked: OpenCode's own automations (MODULES, M12). OpenCode 2.4's HTTP API lists, pauses, resumes and deletes them (`/api/experimental/automation`, read with `opencode api --standalone`); its event stream has no automation events.
- Mac: checked by CI and a Mac smoke job only. The smoke job's OpenCode half waits on the owner allowing `@opencode/cli`'s install script (`--allow-scripts=@opencode/cli`).
- Owner's machine: the installed app on the beta channel; development on `OfficeTown Dev`. Codex is signed in (ChatGPT Free: only its default model runs); Copilot, Cursor and Muse are installed, not signed in. OpenCode 2.4 (npm `@opencode/cli`); its 1.x files are backed up in `~opencode-v1-backup-2026-11-13`. Logon tasks update the CLIs; the old `OpenCode Auto Update` task fails with EEXIST.

## Owner requirements not yet built

- OpenCode 2 left out (D-98): the background service (about 1.8 s per side command, but it ignores an account's folder and leaves a process running; `acp` never uses it); Code Mode for the user's own OpenCode servers (an ask from a script names only the script; would need their full configs copied with `codemode: false`). Already before D-97: an OpenCode session whose app list cannot be read leaves the user's servers on (blocking needs their names).
- A result told to a lead whose CLI dies before reading it counts as delivered (the core records a message when it sends it; D-120).
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

- Core: `packages/service/src` with `store`, `registry`, `api`, `team`, `tools`, `autonomy`, `chief`, `accounts`, `attachments`, `library`, `drafts`, `connectors`, `outputs`, `automations`, `queue`, `notify`. API messages: `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`, `src/styles/tokens.css`. App icon source: `apps/desktop/src/ui/app-icon.svg`.
- Data folders: installed `%LOCALAPPDATA%\OfficeTown`, development `%LOCALAPPDATA%\OfficeTown Dev` (Linux: `office-town` and `office-town-dev` under XDG data; Mac: `OfficeTown` and `OfficeTown Dev` under `~/Library/Application Support`).
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
