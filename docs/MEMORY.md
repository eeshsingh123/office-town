# Memory

Last updated: 2026-11-28

## State

- Merged to `main`: M1 to M12, M15, M16 Feed with progress updates, the store audit (D-142) and empty states (PR #114 last).
- Open: `fix/opencode-models`, awaiting review: OpenCode 2.4's model list (D-97) and provider names only in the model picker.
- Next (owner, 2026-11-27): agent memory across tasks, which then feeds Feed suggestions (D-139). M13 and M14 wait until real users ask.
- Parked: OpenCode's own automations. OpenCode 2.4's HTTP API lists, pauses, resumes and deletes them (`/api/experimental/automation`, via `opencode api --standalone`); its event stream has no automation events.
- No CI until the public release (D-135); nothing tests the Mac now. Before the release, bring back CI and the Mac smoke job (`.github/workflows/ci.yml` in git history).
- Owner's machine: the installed app on the beta channel; development on `OfficeTown Dev`. Codex signed in (ChatGPT Free: only its default model runs); Copilot, Cursor and Muse installed, not signed in. OpenCode 2.4 (npm `@opencode/cli`).

## Owner requirements not yet built

- OpenCode 2's background service (ignores an account's folder, leaves a process running) and Code Mode for the user's own OpenCode servers. An OpenCode session whose app list cannot be read leaves the user's servers on.
- A result told to a lead whose CLI dies before reading it counts as delivered (D-120).
- "Always allow this" rules (D-57).
- Telling the user a CLI is out of date (needs the CLI's version in the catalog: a contract change).
- Voice input, parked (plan on closed PR #68). Pixel art and character themes, later, as a skin of `features/office/Character.tsx`.

## Open questions for the owner

- Whether Whole department stays the run card's default (D-79).
- Apply to SignPath Foundation for signing (D-75).
- Before the release: the intro video (a discussion first) and the final name ("Bullpen" was rejected).

## How to run

- `pnpm check`: lint, typecheck, tests, with no subscription needed. Read the test count from vitest; the repo sits at the cap of 50.
- `pnpm dev:app`: "Office Town Dev" beside the installed app, on the `OfficeTown Dev` data folder unless given `--data-folder`.
- `pnpm dev:web [--data-folder path]`: browser mode at http://localhost:5173; folder pickers need the app.
- `pnpm package [--beta n | --stable]`: installers in `apps/desktop/out/package/installers`. Install silently with `<setup>.exe /S`.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume id]`; `pnpm dev:catalog` lists models and efforts.
- `pnpm dev:core [--data-folder path] [--port n]`: prints `{url, token}`; send `Authorization: Bearer <token>`; the stream is `<url>/events?after=0`. In Git Bash set `MSYS_NO_PATHCONV=1` and build JSON with Windows paths inside Node.
- Live checks use the cheapest models only: `--model claude-haiku-5-5 --effort low` for Claude; for OpenCode `opencode/deepseek-v4.1-flash-free`, `opencode-go/deepseek-v4.1-flash` or `opencode-go/muse-spark-1.3-contributor`. Never `gpt-5.4-nano` (refused) or Hugging Face models.
- New recording: `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}`), stripped of machine paths, account details and the user's skill lists.
- Mockups: the `mockup` entry in `.claude/launch.json` (port 5190), shot with `out/capture` in dark and light.

## Where things are

- Core: `packages/service/src`. API messages: `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`, `src/styles/tokens.css`.
- Data folders: `%LOCALAPPDATA%\OfficeTown` and `OfficeTown Dev` (Linux `office-town[-dev]` under XDG data; Mac under `~/Library/Application Support`).
- Local only, outside git: `.claude/launch.json`, `out/capture`, `out/burn.mjs` (a run's token spend from a store copy), `docs/briefs/`, `feedback_images/`.
- Test app for connectors: `node packages/service/test/support/notes-app.ts <port>` (`--stdio` for a local program).
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.

## What the harnesses do

Facts the fixtures do not show at a glance.

- Claude Code (2.1.287 fixtures). A message sent during a turn folds in at the next tool end; `--replay-user-messages` echoes it. MCP tools are deferred behind `ToolSearch`, so a tool an agent must use needs a brief line. Read the plan from `tool_use_result`, not the model's input. Background sub-agents outlive the turn and the CLI then starts a turn of its own. It refuses a standalone `sleep` (use `ping -n N 127.0.0.1`). `AskUserQuestion` comes as a permission request. `CLAUDE_CONFIG_DIR` moves the login. Gmail, Drive and Calendar need `claude mcp login --no-browser "<app>"` headless.
- OpenCode 1 (1.18.34) and 2 (2.3.0) over ACP, one adapter (D-97). 2.x: every command but `acp` uses a shared background service unless `--standalone`; Code Mode wraps MCP calls in a script unless the server has `codemode: false`; a finished background sub-agent wakes the agent with no end signal. 1.x: an `ask` rule on an MCP tool comes with an empty input (why the core decides connector calls); no sub-agent steps. Both wait for every MCP server in the user's global config before a session starts.
- Codex 0.167.2 (`codex app-server`): asks before every MCP call as an elicitation, ignoring `auto`, so the translator accepts the core's own. Its sub-agent results wait for the parent's next turn. ChatGPT apps are grouped by `_meta.connector_id`.
- Copilot 1.0.103 (`copilot --acp`), Cursor (`cursor-agent acp`), Muse 1.4.13 (`muse serve`); their sub-agents are unverified.

## Environment (owner's machine, Windows 11)

- Node 24.16, pnpm 12.8, Claude Code and OpenCode signed in natively and in WSL Ubuntu (no Node in WSL). `gh` at `C:\Program Files\GitHub CLI\gh.exe`. Git Bash does not see Cursor or Muse; PowerShell does.
- Commands from the Claude desktop app see a virtualized `%LOCALAPPDATA%`, so stores there read as stale. Read the real store from a process started through WMI, or a copy of a `store.db.bak-v*` with `immutable=1` in the scratchpad.
- Defender blocks a vendor's one-line `irm … | iex` installer run hidden; never run one hidden.
- The browser pane does not draw while the Claude window is covered; `out/capture` is the fallback. The Terminal panel cannot send a real Ctrl+C.

## Risks and known limits

- The CLIs' wire formats are not versioned; an upgrade can break an adapter.
- WSL path mapping assumes `/mnt/<drive>`. On Windows, children a harness leaves behind after it exits are not killed.
- `node:sqlite` is a release candidate in Node 24; a change touches `packages/service/src/store` only.
- A checker's worktree shares the user's `.git`; its brief forbids commits, pushes and branch changes.
- `costUsd` and `action.updated.title` are in the contract but never filled.
- Betas are unsigned, so SmartScreen warns on first install. Vendor policy on third-party use of subscriptions keeps changing.
