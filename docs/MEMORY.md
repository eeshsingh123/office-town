# Memory

Last updated: 2026-10-04

## State

- M1 (harness core) and M2 (core service) are done and on `main`. M2 was checked end to end on `main` through the API with Claude haiku: start refused without a folder, task in its own folder, permission listed in the blocked queue and answered, core killed mid-session then marked interrupted, replay after restart, resume joins the task, task deleted. M2.4 was also run on OpenCode, native and WSL.
- Where things are: `packages/service/src/main.ts` is the core process; `src/store` (`openStore(folder)`), `src/registry` (`SessionRegistry`), `src/api` (server, routes, event stream), `src/task-folders.ts`. API messages are in `packages/contract/src/api.ts`. Default data folder: `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- M3 (desktop app) is built on `feat/m3-desktop`, one PR with one commit series per sub-module, waiting for the owner's review. Checked in the real app and in browser mode with Claude haiku and OpenCode `space-bunny-free`: start from the New task form, live trace with plan steps, nested sub-agent work and a 19 KB result read in full, follow-up message, Stop, continue a stopped agent, permission and question answered from Needs you, notification raised for a request while the window is unfocused, delete from Tasks, the office with walking, E to talk, click and drag-select, Stop all and Message all, app protocol with the token, closing hides to the tray, a second launch shows the window, killing the app stops the core.
- After the owner's review (2026-10-04): browser mode refuses `/api` requests from other sites; agents no longer inherit `ELECTRON_RUN_AS_NODE`; the quit prompt counts open agents and still offers to quit when the core does not answer; a reconnect re-reads tasks the UI still holds as open; Docker's WSL distros are hidden; names are handles; the model list follows D-38.
- Not checked by the agent: the tray menu's Quit and its prompt (needs a click on the tray icon), how the Windows notification looks, the store size warning (shows above 1 GiB), "Show older tasks" (needs more than 50 tasks), a WSL run from the New task form.
- Where M3 is: `apps/desktop/electron` (main, core process, app protocol, window, tray, preload.cjs), `src/api` (client, event stream), `src/store` (Zustand app store, records, live stream batching, agents), `src/trace` (pure event-to-trace functions), `src/features` (office, task, new-task, needs-you, requests, tasks, sidebar), `src/ui` (shared parts), `src/styles/tokens.css`, `dev/web.ts` (browser mode).
- M3 design: mockups at https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp (private to the owner). The office's settled behaviour is in D-35 and D-37.
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

- Agent profile (M4, owner 2026-10-04; M3 only remembers the last choices per harness): one harness-neutral description of an agent, like a character creator. Role, purpose, harness, model, effort, permissions, memory; the list will grow. The lead and the workers of a department are set differently. Defaults flow department, then role, then agent. No per-provider logic outside an adapter. How agent memory works is undesigned.
- Agent names: renaming comes with profiles in M4 (owner). Pixel art and themes for characters come later as a skin of `features/office/Character.tsx`. "Approve all" is to be revisited with autonomy in M4.
- Usage (D-29): show the provider's usage limit per agent and per department. Department view is M4.
- Guardrails for folders outside a workspace are undesigned (M4). Until then only the harness's own permission request guards them, and `bypass` mode has none.
- Departments are created automatically from the user's description (M4).
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

- Permissions per agent, set when the agent is created (M4, with profiles).
- Connector deep dive (D-11), final name.

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
- Agent handles come from a hash of the first session id, so two can still match, about once in 640,000 pairs, until M4 stores names.
- A Claude session stays open after its turn ends ("Done" in the UI) until stopped, and a task with an open session cannot be deleted. Each one keeps a process running; M4 should stop agents left idle, since resuming is cheap.
- Logging in to a harness or provider from the app is deferred (owner, 2026-10-04): the user logs in with the CLI. Claude Code reports no model `access` yet (D-38).

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) only visualises one harness. Orchestrating across harnesses is the product.
- Interface references from the owner: gather.town, Age of Empires style command view.
