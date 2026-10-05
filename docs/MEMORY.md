# Memory

Last updated: 2026-10-05

## State

- M1 (harness core), M2 (core service) and M3 (desktop app) are done and merged to `main` (M3 is PR #27).
- Active: M4 Orchestration on `feat/m4-orchestration` (not pushed). Owner accepted the mockups 2026-10-05. Committed: M4.1 spike (D-41), M4.2 agents and profiles, M4.3 tool server, M4.4 departments and proposals, M4.5 delegation, M4.6 autonomy, M4.7 worktrees, and M4.8's core (isolated adapters, `outsource` tool, `/tasks/:id/second-opinion`, `/tasks/:id/files`, guests leave when done). Live run 2026-10-05 (Claude haiku lead, OpenCode free and Claude haiku workers): proposal, approval and parallel delegation worked end to end.
- Left for M4: M4.8 UI (the "Get a second opinion" dialog, "Visiting" in the team view, guest's end line reading "Finished" not "stopped when idle"); M4.9 rooms in the office, the department panel and usage; the office bubble for a proposal says "Has a question" (should be "Proposes a team"); service test for outsourcing (copy leaves out instruction files, result reaches the lead, guest leaves); docs (MODULES M4 shrink, DECISIONS for M4.2 to M4.8); PR.
- Local only: `.claude/launch.json` (browser preview on a scratch data folder) is kept out of git through `.git/info/exclude`.
- Where things are: `packages/service/src/main.ts` is the core process; `src/store` (`openStore(folder)`), `src/registry` (`SessionRegistry`), `src/api` (server, routes, event stream), `src/task-folders.ts`. API messages are in `packages/contract/src/api.ts`. Default data folder: `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- Desktop: `apps/desktop/electron` (main, core process, app protocol, window, tray, preload.cjs), `src/api` (client, event stream), `src/store` (Zustand app store, records, live stream batching, agents), `src/trace` (pure event-to-trace functions), `src/features` (office, task, new-task, needs-you, requests, tasks, sidebar), `src/ui` (shared parts), `src/styles/tokens.css`, `dev/web.ts` (browser mode).
- Never checked by an agent, worth a click when touched: the tray menu's Quit and its prompt, how the Windows notification looks, the store size warning (above 1 GiB), "Show older tasks" (over 50 tasks), a WSL run from the New task form.
- M3 mockups: https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp (private to the owner). M4 mockups: https://claude.ai/artifact/Wuj5ihNNu4fVDGqxzLrQ4B (private to the owner), made 2026-10-05, waiting for the owner's review.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:app`: builds the UI and opens the desktop app on the default data folder. Only one core can hold a data folder, so close the app before browser mode uses the same one.
- `pnpm dev:web [--data-folder path]`: browser mode at http://localhost:5173, a core plus Vite forwarding `/api` with the token. The folder picker and Open folder need the app; in the browser the folder is typed.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume harness-session-id]`
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: models and their effort values.
- `pnpm dev:core [--data-folder path] [--port n]`: the core. It prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`. `POST /tasks` needs a `workspaceId` (from `POST /workspaces`) or an `outputFolder` until one is remembered.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before calling the core, or it rewrites `/tasks` into a Windows path. Windows arguments also lose doubled backslashes, so build JSON with Windows paths inside Node, not in the shell.
- Live checks use the cheapest models only (owner): `--model haiku` for Claude, `opencode-go/space-bunny-free` or `opencode-go/longcat-2.5-preview-free` for OpenCode.
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

Most are now M4 scope (profiles, stored names, departments, autonomy, usage per department). Still unplaced:
- Agent memory: out of M4, but the owner wants it as its own module after a detailed discussion of storage, recency and how relevant an old memory still is. Raise it when planning after M4.
- Pixel art and themes for characters, later, as a skin of `features/office/Character.tsx`.
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

- The M4 open questions were answered on 2026-10-05 (D-40).
- Where agent memory sits in the order; connector deep dive (D-11); final name.

## What the harnesses do

- Claude Code 2.1.287. Permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls; the model sometimes names their fields `title`, `id` or `task_id`, which the CLI accepts, so the adapter reads the CLI's own record in `tool_use_result`. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty. `AskUserQuestion` arrives as a permission request; the answer goes back as `answers` inside `updatedInput`. Its answer to an `initialize` control request lists models and effort levels, and it exits when stdin closes. `--include-partial-messages` adds `stream_event` lines with `text_delta`. `--resume <id>` keeps the same session id; an unknown id exits with code 1. `rate_limit_event` carries `unifiedWindows` (`five_hour`, `seven_day`) with `utilization` as a 0 to 1 share and `resetsAt` in epoch seconds.
- OpenCode 1.18.34 over ACP. The todo list is a `todowrite` tool call. A sub-agent's inner steps are not forwarded. ACP has no way to ask the user a question. `session/new` returns the model list and an `effort` setting (category `thought_level`) for the current model only, changed with `session/set_config_option`. `opencode models --verbose` prints every model with its `variants`, which are its effort values. `session/resume` continues without replaying; `session/load` replays the whole history. It reports context size and a dollar figure, no plan limit.

## Environment (owner's machine, Windows 11)

- Present: git, Node 24.16, pnpm 12.8, Python 3.14, Claude Code and OpenCode 1.18 logged in natively and in WSL Ubuntu (OpenCode on a Go subscription).
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; call it by full path if it is not on PATH.
- Missing: `codex`, `agy`, Node inside WSL Ubuntu.
- The app's Terminal panel tab does not reach a prompt (its shell integration script is missing), so a real Ctrl+C cannot be sent from here.
- The browser pane does not draw while the Claude window is covered, so visual checks used an off-screen Electron window (`out/capture`, ignored by git, local only).

## Risks and known limits

- The CLIs' wire formats are not versioned. A CLI upgrade can break an adapter; re-record the fixtures when it happens.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- On Windows, if the harness's main process has already exited, anything it left running is not killed.
- `Session.send` and `SessionRegistry.send` trust their caller; the API validates first (`agentCommandSchema`).
- `costUsd` and `action.updated.title` are in the contract but never filled.
- OpenCode gets extra folders through an `external_directory` rule, not ACP's `additionalDirectories`, which 1.18 does not offer. Switch when it does.
- Vendor policy on third-party use of subscriptions is still changing (D-6).
- `node:sqlite` is a release candidate in Node 24; an API change would touch `packages/service/src/store` only.
- The app runs from the repository: the shell starts the core from `packages/service/src/main.ts` and serves `apps/desktop/dist`. The installer is M5, Packaging and release (owner, 2026-10-04).
- Agent handles come from a hash of the first session id, so two can still match, about once in 640,000 pairs, until M4.2 stores names.
- A Claude session stays open after its turn ends ("Done" in the UI) until stopped, and a task with an open session cannot be deleted. M4.5 stops agents left idle.
- Logging in to a harness or provider from the app is deferred (owner, 2026-10-04): the user logs in with the CLI. Claude Code reports no model `access` yet (D-38).

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) only visualises one harness. Orchestrating across harnesses is the product.
- Interface references from the owner: gather.town, Age of Empires style command view.
