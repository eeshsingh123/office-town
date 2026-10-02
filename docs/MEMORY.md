# Memory

Last updated: 2026-10-02

## State

- M1 (harness core) is implemented and verified end to end: Claude Code and OpenCode, each natively and inside WSL Ubuntu. It is waiting for the owner's review as seven stacked PRs, #2 (M1.1) to #8 (M1.7). Merge in order; each PR's base is the one before it. The review fixes are one more PR on top of #9 (`fix/m1-review`).
- Next after merge: the M2 open items below, then M2.1. Follow the build protocol in AGENTS.md.
- D-1 to D-14 accepted. Proposed and awaiting the owner: D-15 (storage), D-16 (sandbox deferred), D-17 (HTTP plus SSE), D-19 (no build step), D-20 (replay-tested translators), D-21 (locations), D-22 (WSL kill by marker), D-24 (allow always is session-only). D-9, D-11 and D-18 need their own design sessions.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## How to run

- `pnpm check`: lint, typecheck, tests. No subscription needed; adapters are tested against recordings.
- `pnpm dev:run "<prompt>" [--harness claude|opencode] [--wsl Ubuntu] [--workspace path] [--model m] [--permission-mode ask|acceptEdits|bypass]`: the M1 demo.
- New recording for an adapter: capture the CLI's stdout lines and our commands into `packages/harness/test/fixtures/<harness>/<name>.jsonl` (`{"receive": <native message>}` and `{"send": <command>}` per line), with machine paths replaced.

## What M1 taught us about the harnesses

- Claude Code 2.1.287: permissions work over stdio (`--permission-prompt-tool stdio`). Every turn starts with `system/init`. The plan comes from `TaskCreate`/`TaskUpdate` calls. Sub-agents run in the background, so a turn can end before its sub-agent does and a new turn then starts without a prompt. Thinking text arrives empty, so no reasoning events yet. `total_cost_usd` is cumulative, so no per-turn cost. A question to the user (`AskUserQuestion`) arrives as a permission request marked `requires_user_interaction`, and the answer goes back as `answers` (question text to chosen label) inside `updatedInput`.
- OpenCode 1.18.34 over ACP: the todo list is a `todowrite` tool call, not a plan update. A sub-agent's inner steps are not forwarded; it appears as one `delegate` action. Model list and current model come back from `session/new`.

## Owner requirements not yet placed in a decision

- Trace: plan steps with nested sub-steps, everything auditable. Reasoning hidden by default, expandable.
- Model and effort selectable per employee.
- Human-in-the-loop UI starts simple but must extend without rewrites.
- Workspace: a chosen folder or files, or none; with none, ask where results go and remember it.
- Departments are created automatically from the user's description.
- A department works in one existing folder the user points it at, like opening Claude Code in a directory. Sharing the folder across the department's agents is expected. Agreed direction, to be designed at M4: one git worktree and branch per agent.
- SDLC cycle with GitHub pull and push is optional: only for departments doing code work in a repo. Not tested through the app yet.
- Agents must keep running with the window closed. How is undecided; discuss with the owner before building M3.1.
- The owner delegates well-scoped stories to other agents (OpenCode); this agent writes the briefs and verifies the results on request.

## Open questions for the owner

- Agent questions: the contract can only allow or deny, so a Claude question to the user is "allowed" with no answer. Confirmed on the live CLI. Needs a contract change (a question event and an answer command) before M2.1 stores events; the owner decides the shape.
- Permissions per agent: the owner wants an explicit way to set what an agent may do when it is created, designed with the UI (M3.3, M4). Until then "allow always" only makes session-long changes (D-24).
- Streaming: M1 emits whole messages only. Live text deltas would be an additive `message.delta` event; decide before M3.4.
- Model list and effort values: the capability flags say whether a harness supports them, but nothing returns the actual lists yet. M3.3 needs them before a session exists, so this is likely an M2 query, not an event.
- Resume: both harnesses can resume by their own session id; the `resume` capability is false until M2.2 adds the option.
- Background running: tray, detached core, or OS service (see MODULES.md, M2 open items).
- M2 items: retention, raw-message audit copy, multi-folder workspaces.
- macOS (D-23): parked tech debt, nothing verified on a Mac. Do not add Mac-specific code until it can be tested; the work list is in D-23.
- Interface design session (D-9), connector deep dive (D-11), final name.

## Environment (owner's machine, Windows 11)

- Present: git 2.34, Node 24.16, pnpm 12.8 (installed through npm; the old 8.3 binary is kept as `%LOCALAPPDATA%\pnpm\pnpm-8.3.1.exe.bak`), Bun 1.3, Python 3.14, uv, Claude Code and OpenCode 1.18 installed and logged in by the owner, both natively (npm `.cmd` shims) and in WSL Ubuntu (OpenCode on a Go subscription).
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`, not on the tool shell's PATH; call it by full path.
- Missing: `codex`, `agy`.

## Risks

- The CLIs' wire formats are not versioned contracts. A CLI upgrade can break an adapter; the recordings are the safety net and must be re-recorded when it happens.
- WSL path mapping assumes the default `/mnt/<drive>` automount root.
- Known limits, left as they are: on Windows, if the harness's main process has already exited, anything it left running is not killed (a real fix needs native code). Binary lookup may read a different `PATH` than the child gets when the environment has both `Path` and `PATH`; nothing overrides `PATH` today. `costUsd` and `action.updated.title` are in the contract but never filled. `Session.send` trusts its caller; M2's API must validate commands with `sessionCommandSchema`.
- Vendor billing and policy for third-party use of subscriptions is still changing (D-6).

## Reference notes

- Closest prior art: Munder Difflin, Pixel Agents, Claude Office Visualizer. All single-harness visualizers; none orchestrates across harnesses. That gap is the product.
- BridgeSpace (bridgemind.ai) is a PTY terminal grid. We render structured events, not terminals.
- Interface references from the owner: gather.town, Age of Empires style command view.
