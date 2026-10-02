# Memory

Last updated: 2026-10-03

## State

- Phase: planning complete for M1 to M3. No application code yet.
- Roadmap is in [MODULES.md](MODULES.md). Next: the owner asks for module 1; follow the build protocol in AGENTS.md.
- D-1 to D-14 accepted. D-15 (storage) and D-16 (sandbox deferred) proposed. D-9 (interface) and D-11 (connectors) need their own design sessions.
- Repo: github.com/eeshsingh123/office-town, public. `main` only accepts PRs; the owner merges.
- Name: "Office Town" is a placeholder. "Bullpen" was rejected.

## Owner requirements not yet placed in a decision

- Trace: plan steps with nested sub-steps, everything auditable. Reasoning hidden by default, expandable.
- Model and effort selectable per employee.
- Human-in-the-loop UI starts simple but must extend without rewrites.
- Workspace: a chosen folder or files, or none; with none, ask where results go and remember it.
- Departments are created automatically from the user's description; incognito departments exist (meaning to be confirmed).
- The owner delegates well-scoped stories to other agents (OpenCode); this agent writes the briefs and verifies the results on request.

## Open questions for the owner

- What "incognito department" means: nothing stored, or isolated from other departments, or both.
- Should closing the window keep agents running in the background.
- M2 items: retention, raw-message audit copy, multi-folder workspaces.
- Interface design session (D-9), connector deep dive (D-11), final name.

## Environment (owner's machine, Windows 11)

- Present: git 2.34, Node 24, pnpm 8 (upgrade in M1.1), Bun 1.3, Python 3.14, uv, Claude Code 2.1.287 native (login by the owner pending), Claude Code in WSL Ubuntu.
- `gh` is at `C:\Program Files\GitHub CLI\gh.exe`, not on the tool shell's PATH; call it by full path.
- OpenCode CLI: the owner is installing it and logging in with a Go subscription. Missing: `codex`, `agy`.

## Risks

- M1.4: answering permission requests over the stock `claude` CLI's stream-json channel is not clearly documented. Spike first.
- Vendor billing and policy for third-party use of subscriptions is still changing (D-6).

## Reference notes

- Closest prior art: Munder Difflin, Pixel Agents, Claude Office Visualizer. All single-harness visualizers; none orchestrates across harnesses. That gap is the product.
- BridgeSpace (bridgemind.ai) is a PTY terminal grid. We render structured events, not terminals.
- Interface references from the owner: gather.town, Age of Empires style command view.
