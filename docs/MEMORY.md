# Memory

Last updated: 2026-10-02

## State

- Phase: foundation. No application code yet.
- D-1 to D-8 and D-10 accepted. D-9 (interface) and D-11 (connectors) accepted in direction, each needs its own design session.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.
- Next: grilling round 2 to scope module 1, then plan it. Do not start implementation before the owner agrees to the plan.

## Module order

1. Harness core: contract, process runner, Claude Code adapter, then OpenCode (ACP) adapter. No UI.
2. Shell and plain UI: window, task input, structured activity view.
3. Orchestration: recommend a team, spawn workers, cross-harness delegation, blocked queue.
4. Command center: departments, dependencies, panels.
5. Connectors: plugins, per-session injection, self-provisioning.

## Open questions for the owner

- Module 1 scope: see the round-2 questions in the conversation of 2026-10-02 (workspace folder, step granularity, history, WSL, OpenCode timing).
- Interface design session (D-9).
- Connector deep dive (D-11).
- Final product name.

## Environment (owner's machine, Windows 11)

- Present: git 2.34, Node 24, pnpm 8, Bun 1.3, Python 3.14, uv, Claude Code 2.1.287 (native Windows, not yet logged in), Claude Code in WSL Ubuntu.
- `gh` is installed at `C:\Program Files\GitHub CLI\gh.exe` but not on the tool shell's PATH; call it by full path.
- Missing: `codex`, `opencode`, `agy`.

## Reference notes

- Closest prior art: Munder Difflin (Electron, PixiJS, Claude hooks), Pixel Agents (VS Code extension), Claude Office Visualizer. All single-harness visualizers; none orchestrates across harnesses. That gap is the product.
- BridgeSpace (bridgemind.ai) is a PTY terminal grid, reportedly Tauri and Rust. We render structured events, not terminals.
- Interface references from the owner: gather.town, Age of Empires style command view.
