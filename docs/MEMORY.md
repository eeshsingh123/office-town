# Memory

Last updated: 2026-10-03

## State

- M1 (harness core) is merged to `main` (PRs #2 to #11) and verified end to end: Claude Code and OpenCode, each natively and inside WSL Ubuntu.
- Next: the pre-M2 work below (the owner gave the go-ahead on 2026-10-03), then M2.1. Follow the build protocol in AGENTS.md.
- D-1 to D-14 accepted. Proposed and awaiting the owner: D-15 (storage), D-16 (sandbox deferred), D-17 (HTTP plus SSE), D-19 (no build step; the owner left the choice to the agent, priority is performance), D-20 (replay-tested translators), D-21 (locations), D-22 (WSL kill by marker), D-24 (allow always is session-only), D-25 (agent questions). The owner asked what they are and was told on 2026-10-03; mark them accepted once the owner says so. D-9, D-11 and D-18 need their own design sessions.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## Pre-M2 work

- Agent profile: one harness-neutral description of an agent (role, purpose, harness, model, effort, permissions, memory; the list will grow). Adapters translate it; no per-provider logic outside an adapter. Defaults flow department, then role, then agent, each overridable by the user.
- Done in M1.8 (D-26): catalog query per adapter, and effort on OpenCode. Run live on both harnesses, natively and in WSL Ubuntu.
- Effort: the UI shows each harness's own values, with a popup explaining what effort means (M3.3). Neither CLI describes its effort values, so the popup text is ours.
- Done in M1.9: subscription limits as `limits.updated`. The owner dropped per-agent budgets and dollar tracking on 2026-10-03: usage limits are the single source of truth. Money tracking is parked until API-key use is supported.
- Usage display (M3): show the subscription's limit where the harness reports it, otherwise tokens. Only Claude Code reports one; OpenCode over ACP reports context size and cost, no plan limit.
- Done in M1.10 (D-28): resume by the harness's session id, and live text fragments. Run live on both harnesses (native). Resumability is a core feature for the owner: M2.2 must persist the harness session id and resume interrupted agents with it.
- All of the above join the shared conformance suite so every adapter must support them or declare that it cannot.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--effort e] [--permission-mode ask|acceptEdits|bypass] [--max-tokens n] [--max-cost dollars] [--resume harness-session-id]`: the M1 demo.
- `pnpm dev:catalog [--harness claude|opencode] [--wsl Ubuntu]`: the models a harness offers and each model's effort values.
- New recording for an adapter: capture the CLI's stdout lines and our commands into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": <native message>}` and `{"send": <command>}` per line), with machine paths replaced.

## What M1 taught us about the harnesses

- Claude Code 2.1.287: permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty, so no reasoning events yet. `total_cost_usd` is cumulative. `rate_limit_event` carries `unifiedWindows` (`five_hour`, `seven_day`), each with `utilization` as a 0 to 1 share (checked against the app's usage card) and `resetsAt` in epoch seconds. The first turn of a session writes about 35k tokens to the cache, which count toward a token budget. A question to the user (`AskUserQuestion`) arrives as a permission request marked `requires_user_interaction`, and the answer goes back as `answers` (question text to chosen label) inside `updatedInput`. Its answer to an `initialize` control request lists the models and their effort levels, and it exits by itself when stdin closes. `--include-partial-messages` adds `stream_event` lines with `text_delta` fragments; thinking fragments arrive empty. `--resume <id>` keeps the same session id; an unknown id makes the CLI exit with code 1.
- OpenCode 1.18.34 over ACP: the todo list is a `todowrite` tool call, not a plan update. A sub-agent's inner steps are not forwarded; it appears as one `delegate` action. ACP has no way for the agent to ask the user a question, so OpenCode never emits question events. Model list and current model come back from `session/new`, together with an `effort` setting (category `thought_level`) that lists only the current model's values and is changed with `session/set_config_option`. `opencode models --verbose` prints every model with its `variants`, which are its effort values. The list includes every provider OpenCode knows, not only the ones the user is logged in to. `session/resume` continues a session without replaying it and answers without a session id; `session/load` replays the whole history.

## Owner requirements not yet placed in a decision

- Trace: plan steps with nested sub-steps, everything auditable. Reasoning hidden by default, expandable.
- Agents are customisable like a character creator: memory, role, purpose, effort, model and more, per agent, with the lead and the workers of one department set differently. How agent memory works is undesigned.
- Human-in-the-loop UI starts simple but must extend without rewrites.
- Workspace: a chosen folder or files, or none; with none, ask where results go and remember it. A workspace can be several folders. Reaching a folder outside it works like Claude Code: the agent asks first, or it has been given full autonomy. Either way the access must be safe and guarded; the guardrails are undesigned (M2.4, M4).
- History is kept until the user deletes it, with a warning when the store grows large. The harness's raw native messages are stored too, for audit and re-translation.
- Departments are created automatically from the user's description.
- A department works in one existing folder the user points it at, like opening Claude Code in a directory. Sharing the folder across the department's agents is expected. Agreed direction, to be designed at M4: one git worktree and branch per agent.
- SDLC cycle with GitHub pull and push is optional: only for departments doing code work in a repo. Not tested through the app yet.
- Agents must keep running with the window closed. How is undecided; discuss with the owner before building M3.1.
- The owner delegates well-scoped stories to other agents (OpenCode); this agent writes the briefs and verifies the results on request.

## Open questions for the owner

- Permissions per agent: the owner wants an explicit way to set what an agent may do when it is created, designed with the UI (M3.3, M4). Until then "allow always" only makes session-long changes (D-24).
- Background running: tray, detached core, or OS service (see MODULES.md, M2 open items).
- macOS (D-23): parked tech debt, nothing verified on a Mac. Do not add Mac-specific code until it can be tested; the work list is in D-23.
- Interface design session (D-9), connector deep dive (D-11), final name.

## Environment (owner's machine, Windows 11)

- Present: git 2.34, Node 24.16, pnpm 12.8 (installed through npm; the old 8.3 binary is kept as `%LOCALAPPDATA%\pnpm\pnpm-8.3.1.exe.bak`), Bun 1.3, Python 3.14, uv, Claude Code and OpenCode 1.18 installed and logged in by the owner, both natively (npm `.cmd` shims) and in WSL Ubuntu (OpenCode on a Go subscription).
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`, not on the tool shell's PATH; call it by full path.
- Missing: `codex`, `agy`.

## Risks

- The CLIs' wire formats are not versioned contracts. A CLI upgrade can break an adapter; the recordings are the safety net and must be re-recorded when it happens.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- Known limits, left as they are: on Windows, if the harness's main process has already exited, anything it left running is not killed (a real fix needs native code). Binary lookup may read a different `PATH` than the child gets when the environment has both `Path` and `PATH`; nothing overrides `PATH` today. `action.updated.title` is in the contract but never filled. Dollar cost on a subscription is the CLI's estimate at list prices, not money charged, and is $0 on OpenCode's free models. `Session.send` trusts its caller; M2's API must validate commands with `sessionCommandSchema`.
- Vendor billing and policy for third-party use of subscriptions is still changing (D-6).

## Reference notes

- Closest prior art: Munder Difflin, Pixel Agents, Claude Office Visualizer. All single-harness visualizers; none orchestrates across harnesses. That gap is the product.
- BridgeSpace (bridgemind.ai) is a PTY terminal grid. We render structured events, not terminals.
- Interface references from the owner: gather.town, Age of Empires style command view.
