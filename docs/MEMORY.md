# Memory

Last updated: 2026-10-04

## State

- M1 (harness core) and M2 (core service) are done and on `main`. M2 was checked end to end on `main` through the API with Claude haiku: start refused without a folder, task in its own folder, permission listed in the blocked queue and answered, core killed mid-session then marked interrupted, replay after restart, resume joins the task, task deleted. M2.4 was also run on OpenCode, native and WSL.
- Where things are: `packages/service/src/main.ts` is the core process; `src/store` (`openStore(folder)`), `src/registry` (`SessionRegistry`), `src/api` (server, routes, event stream), `src/task-folders.ts`. API messages are in `packages/contract/src/api.ts`. Default data folder: `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- Next: build M3 on branch `feat/m3-desktop` (one PR, one commit series per sub-module, in order M3.1 to M3.7). The approach was agreed with the owner on 2026-10-04: D-34 to D-37, and the M3 scope in MODULES.md. Its first commit records these docs.
- M3 design: mockups at https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp (private to the owner): task trace, new task with model list, Needs you, tokens, office in M3, office with departments later. The owner accepted the look; tokens and colours are in the Tokens board.
- Checked before M3 (throwaway spike): Electron 44.5 has Node 24.21 and runs `packages/service/src/main.ts` unchanged with `ELECTRON_RUN_AS_NODE=1`; a `main.ts` Electron entry runs without a build; `protocol.handle` plus `net.fetch` streams SSE without buffering, with `privileges: { standard, secure, supportFetchAPI, stream }`.
- Planned layout of `apps/desktop`: `electron/` (main, core process, app protocol, tray, preload.cjs for folder picker and open folder), `src/api` (client, event stream reader), `src/store` (Zustand: connection, task and session summaries, pending requests, traces loaded on demand), `src/trace` (pure event-to-trace functions, tested), `src/features/*`, `src/ui` (Radix-based parts), `src/styles/tokens.css`, `dev/` (browser mode: start a core and Vite with an `/api` proxy). Root vitest projects gain `apps/*`.
- At the end of M3, give the owner a walkthrough: how to run the app and browser mode, and where to check each feature.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume harness-session-id]`
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: models and their effort values.
- `pnpm dev:core [--data-folder path] [--port n]`: the core. It prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`. `POST /tasks` needs a `workspaceId` (from `POST /workspaces`) or an `outputFolder` until one is remembered.
- In Git Bash, set `MSYS_NO_PATHCONV=1` before calling the core, or it rewrites `/tasks` into a Windows path. Windows arguments also lose doubled backslashes, so build JSON with Windows paths inside Node, not in the shell.
- Live checks use the cheapest models only (owner): `--model haiku` for Claude, `opencode-go/space-bunny-free` or `opencode-go/longcat-2.5-preview-free` for OpenCode.
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

- Agent profile (M4, owner 2026-10-04; M3 only remembers the last choices per harness): one harness-neutral description of an agent, like a character creator. Role, purpose, harness, model, effort, permissions, memory; the list will grow. The lead and the workers of a department are set differently. Defaults flow department, then role, then agent. No per-provider logic outside an adapter. How agent memory works is undesigned.
- Model picker (M3.3): OpenCode lists 257 models, including providers the user is not logged in to. Recent, free and plan models at the top, with a filter; no hand-made "popular" list. `opencode models --verbose` gives `providerID` and `cost` (all zero means free). Show each harness's own effort values.
- Office (M3.7, D-35), settled with the owner on 2026-10-04:
  - Characters are simple (coloured circle with initials), drawn by one component so pixel art and themes can come later as a skin.
  - Each agent gets a friendly name picked from a fixed list by its session id (no storage); hovering shows its harness. Users rename agents with profiles in M4.
  - The floor shows running and waiting agents and those finished today; older ones are under Tasks.
  - "Open full trace" switches the main area to the task view, with "Back to office".
  - Selection offers Stop all and Message all; no "Approve all" in M3 (revisit with autonomy in M4).
  - Arrow keys or WASD walk, E talks to the agent you stand next to; clicking an agent opens it directly; no click-to-walk.
  - Single-user; a shared office is not planned.
- Usage (D-29): show the provider's usage limit per agent and per department. Department view is M4.
- M3.4: an interrupted session's log ends with its open actions and turn unclosed; show them as interrupted. A large result arrives as a preview plus `overflow`; the full text is at `/sessions/:id/results/:sequence`.
- The app warns when the store grows large (M3); `GET /storage` reports its size.
- Guardrails for folders outside a workspace are undesigned (M4). Until then only the harness's own permission request guards them, and `bypass` mode has none.
- Departments are created automatically from the user's description (M4).
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

- Permissions per agent, set when the agent is created (M4, with profiles).
- Connector deep dive (D-11), final name.

## What the harnesses do

- Claude Code 2.1.287. Permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty. `AskUserQuestion` arrives as a permission request; the answer goes back as `answers` inside `updatedInput`. Its answer to an `initialize` control request lists models and effort levels, and it exits when stdin closes. `--include-partial-messages` adds `stream_event` lines with `text_delta`. `--resume <id>` keeps the same session id; an unknown id exits with code 1. `rate_limit_event` carries `unifiedWindows` (`five_hour`, `seven_day`) with `utilization` as a 0 to 1 share and `resetsAt` in epoch seconds.
- OpenCode 1.18.34 over ACP. The todo list is a `todowrite` tool call. A sub-agent's inner steps are not forwarded. ACP has no way to ask the user a question. `session/new` returns the model list and an `effort` setting (category `thought_level`) for the current model only, changed with `session/set_config_option`. `opencode models --verbose` prints every model with its `variants`, which are its effort values. `session/resume` continues without replaying; `session/load` replays the whole history. It reports context size and a dollar figure, no plan limit.

## Environment (owner's machine, Windows 11)

- Present: git, Node 24.16, pnpm 12.8, Python 3.14, Claude Code and OpenCode 1.18 logged in natively and in WSL Ubuntu (OpenCode on a Go subscription).
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`; call it by full path if it is not on PATH.
- Missing: `codex`, `agy`, Node inside WSL Ubuntu.
- The app's Terminal panel tab does not reach a prompt (its shell integration script is missing), so a real Ctrl+C cannot be sent from here.

## Risks and known limits

- The CLIs' wire formats are not versioned. A CLI upgrade can break an adapter; re-record the fixtures when it happens.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- On Windows, if the harness's main process has already exited, anything it left running is not killed.
- `Session.send` and `SessionRegistry.send` trust their caller; the API validates first (`agentCommandSchema`).
- `costUsd` and `action.updated.title` are in the contract but never filled.
- OpenCode gets extra folders through an `external_directory` rule, not ACP's `additionalDirectories`, which 1.18 does not offer. Switch when it does.
- Vendor policy on third-party use of subscriptions is still changing (D-6).
- `node:sqlite` is a release candidate in Node 24; an API change would touch `packages/service/src/store` only.

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) only visualises one harness. Orchestrating across harnesses is the product.
- Interface references from the owner: gather.town, Age of Empires style command view.
