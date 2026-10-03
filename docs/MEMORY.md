# Memory

Last updated: 2026-10-03

## State

- M1 (harness core) is on `main`, run live on Claude Code and OpenCode, natively and in WSL Ubuntu.
- M2.1 (store, D-15 and D-30) is on `main`. `packages/service/src/store`: `openStore(folder)` returns the `Store` interface.
- M2.2 (session registry, D-31) is on `main`. `packages/service/src/registry`: `new SessionRegistry(store)`. `defaultDataFolder()` gives `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- M2.3 (API, D-32) is built on `feat/m2.3-api` and waits for the owner's merge. `packages/service/src/main.ts` is the core process; `src/api` holds the server, routes and event stream. API messages are in `packages/contract/src/api.ts`. Run live with curl on Claude (haiku) and OpenCode (free model): task, permission answer, replay from `Last-Event-ID`, crash, interrupted, resume, large result, delete. Shutdown was run by calling the core's own SIGINT handler with an OpenCode agent running: exit 0 in 90 ms, session interrupted.
- Next: M2.4 (workspaces and pending approvals), on a new branch once the M2.3 PR is merged. Present the approach first.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--resume harness-session-id]`
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: models and their effort values.
- `pnpm dev:core [--data-folder path] [--port n]`: the core. It prints `{url, token}`; send `Authorization: Bearer <token>`. Stream: `curl -N -H "Authorization: Bearer <token>" "<url>/events?after=0"`.
- Live checks use the cheapest models only (owner): `--model haiku` for Claude, `opencode-go/space-bunny-free` or `opencode-go/longcat-2.5-preview-free` for OpenCode.
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

- Agent profile (stored once designed, M3.3 or M4; not in M2): one harness-neutral description of an agent, like a character creator. Role, purpose, harness, model, effort, permissions, memory; the list will grow. The lead and the workers of a department are set differently. Defaults flow department, then role, then agent. No per-provider logic outside an adapter. How agent memory works is undesigned.
- Model picker (M3.3): OpenCode lists 257 models, including providers the user is not logged in to. Put the popular, Go-plan and free ones at the top and add a filter. Show each harness's own effort values.
- Usage (D-29): show the provider's usage limit per agent and per department. Department view is M4.
- Resumability is a core feature (built in M2.2). For M3.4: an interrupted session's log ends with its open actions and turn unclosed; show them as interrupted.
- The app warns when the store grows large (M3); the store reports its size.
- Workspace: a chosen folder, several folders, or none; with none, ask where results go and remember it. A folder outside the workspace is reached by asking the user or under full autonomy, always behind guardrails. The guardrails are undesigned (M2.4, M4).
- A department works in one existing folder the user points it at. Direction for M4: one git worktree and branch per agent. An SDLC flow with GitHub is optional, only for code work.
- Departments are created automatically from the user's description.
- Trace: plan steps with nested sub-steps, everything auditable. Reasoning hidden by default, expandable.
- Human-in-the-loop UI starts simple but must extend without rewrites.
- The owner hands well-scoped stories to other agents (OpenCode); this agent writes the briefs and verifies the results on request.

## Open questions for the owner

- Agents must keep running with the window closed: tray, detached core, or OS service. Discuss before M3.1.
- Permissions per agent, set when the agent is created. Designed with the UI (M3.3, M4).
- Interface design session (D-9), connector deep dive (D-11), final name.

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
- Vendor policy on third-party use of subscriptions is still changing (D-6).
- `node:sqlite` is a release candidate in Node 24; an API change would touch `packages/service/src/store` only. The Node that runs the core under Electron (M3.1) must include it.

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) only visualises one harness. Orchestrating across harnesses is the product.
- Interface references from the owner: gather.town, Age of Empires style command view.
