# Memory

Last updated: 2026-10-10

## State

- M1 to M5 are merged to `main` (M5 is PR #30). Feedback phase: one fix at a time; the first round is PR #31 (merged).
- Home (D-52) merged as PR #32; creation flows (D-53) as PR #33: New task, the chief page and setup, New department and the Dusk look (D-53). Checked in browser mode on a fresh data folder: the chief set up and renamed through all four steps, a project and a department built by hand, New task's three choices and their side panel. Not run live: a task started from the new New task page (same calls as before).
- `wsl.test.ts` ("kills even a detached child") fails on this machine on main too: the WSL distro does not answer in time.
- D-54 (Send for review in the chat) merged as PR #34.
- `feat/profiles` (D-55): Your profile, agent Profile tab, Templates page, team rules, pop-up switches; agents copy templates. Checked in browser mode on a copy of old smoke data (migration ran; profile saved and shown first in the preview; team rules saved; lead profile edited and saved as a template; Templates cards and list; Use fills New task; Add someone opens template cards). Not checked: the Profile tab inside the office side panel (same component as the dialog), the finished-task pop-up, a live run reading About you (covered by `api.test.ts`).
- M5 Live run (2026-10-08, through the API): a chief goal across a Claude and an OpenCode department, plan approved, the downstream piece started with the upstream result, the goal ended in To review. Not live-run: plan edits, a busy department's queue, a failed piece and a re-plan (all covered by `chief.test.ts`).
- The "owes a turn" rule (D-50): a user message after a turn started counts; an answer counts only after the turn ended, since a harness's own question is answered inside its turn.
- Never checked by an agent, worth a click when touched: M5's plan card and re-plan view, next waiting with the in-place card, Mark reviewed and Follow up, live chat updates, hand-off motion, reduced motion and dark mode on the floor; the tray's Quit prompt, the Windows notification, the store size warning (over 1 GiB), "Show older tasks" (over 50), a WSL run from New task, a drag selection grouped by room, Message lead and Stop team from the department panel, a WSL Claude agent calling a team tool, WSL share-name folding in the read-only check.
- `worktrees.test.ts` can time out under a full parallel run; it passes alone.
- Local only: `.claude/launch.json` (browser preview on a scratch data folder), kept out of git through `.git/info/exclude`.
- Where things are: core process `packages/service/src/main.ts`; `src/store`, `src/registry`, `src/api`, `src/team`, `src/tools`, `src/autonomy`, `src/chief`. API messages in `packages/contract/src/api.ts`. Desktop: `apps/desktop/electron` (shell), `src/api`, `src/store`, `src/trace`, `src/features`, `src/ui`. Default data folder: `%LOCALAPPDATA%\OfficeTown` (Linux: XDG data folder).
- Mockups (private to the owner): M3 https://claude.ai/artifact/EUBobEg5HWbUH74V8AsYLp, M4 https://claude.ai/artifact/Wuj5ihNNu4fVDGqxzLrQ4B, M5 https://claude.ai/artifact/2JtgLDazsmQeYH7hLuQuA3, creation flows and colour options https://claude.ai/artifact/PaPEMXnWXrc9gxQdGtTqsC.
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
- Live checks use the cheapest models only (owner): `--model haiku` for Claude, `opencode-go/longcat-2.5-preview-free` for OpenCode (Space Bunny is no longer free).
- New recording: the CLI's stdout lines and our commands go into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": ...}` and `{"send": ...}` per line). Remove machine paths, account details and the user's skill and command lists.

## Owner requirements not yet built

- Agent memory: its own module after a design discussion (see MODULES.md).
- Pixel art and themes for characters, later, as a skin of `features/office/Character.tsx`.
- Human-in-the-loop UI starts simple but must extend without rewrites.

## Open questions for the owner

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
- The app runs from the repository; the installer is the last module.
- A session already running in Bypass stays unguarded until it ends, even if its level is lowered (D-45).
- OpenCode isolates only in part: its global config and instructions still load (D-41); the dialog says so.
- Logging in to a harness or provider from the app is deferred (owner, 2026-10-04): the user logs in with the CLI. Claude Code reports no model `access` yet (D-38).

## Reference notes

- Prior art (Munder Difflin, Pixel Agents, Claude Office Visualizer) visualises one harness only. Interface references: gather.town, Age of Empires.
- Command center research (2026-10-07): Gas Town (one "Mayor" agent you talk to), Paperclip (CEO agent, org chart, goals traced down), Cursor 3 "Needs Attention", Codex review queue, Vibe Kanban (cross-harness board), RimWorld and RTS (jump to the next waiting unit). Complaints to avoid: walls of live transcripts, waiting agents nobody notices, too many notifications.
