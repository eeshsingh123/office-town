# Memory

Last updated: 2026-10-02

## State

- Phase: foundation. No application code yet.
- Stack decisions D-1 to D-6 are proposed, awaiting the owner.
- Local git repo initialised. GitHub remote not created yet (`gh` CLI is not installed).

## Proposed module order

1. Harness core: drive one Claude Code session headless, emit normalized events. No UI.
2. Shell and plain UI: window, task input, structured (non-terminal) activity view.
3. Orchestration: recommend a team, spawn workers, delegate, track.
4. World: 2D office, agents as characters driven by the same events.
5. Connectors: MCP servers injected per session, with a connect UI.

## Open questions for the owner

- Personal tool or distributed product? Decides how much vendor-policy risk matters.
- Who orchestrates: the harness's native sub-agents, or the app spawning separate sessions (cross-harness teams)?
- Is the task domain coding only, or general knowledge work?
- Is the 2D world the primary interface or a view beside conventional panels?
- Repo visibility (branch protection on a private repo needs a paid GitHub plan).

## Environment (owner's machine, Windows 11)

- Present: git 2.34, Node 24, pnpm 8, Bun 1.3, Python 3.14, uv.
- Missing: `gh`, Rust toolchain, and `claude` / `codex` / `opencode` on PATH.

## Reference notes

- Closest prior art: Munder Difflin (Electron, PixiJS, Claude hooks), Pixel Agents (VS Code extension), Claude Office Visualizer. All single-harness visualizers; none orchestrates across harnesses.
- BridgeSpace (bridgemind.ai) is a PTY terminal grid, reportedly Tauri and Rust. We want structured events, not terminals.
- WorkAdventure (open source, Phaser, Tiled maps) is the best reference for a gather-style world.
