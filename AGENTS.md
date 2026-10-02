# Bullpen (working name)

Desktop app where a user describes a task and a team of AI agents plans, delegates and executes it inside a shared 2D virtual office. Agents run on the user's own CLI harness subscriptions (Claude Code, Codex, Antigravity, OpenCode); the app replaces the terminal with a visual, interactive layer.

## Source of truth

- [docs/RULES.md](docs/RULES.md): design, code and git rules. Read before writing code.
- [docs/DECISIONS.md](docs/DECISIONS.md): architecture decisions and their why. Append only; supersede, never rewrite.
- [docs/MEMORY.md](docs/MEMORY.md): current state, active module, open questions. Update at the end of every work session.

Keep all three short. If a line would not change what the next session does, delete it.

## How we work

- The owner drives; the agent implements end to end and owns code quality.
- One module at a time, finished and verified before the next begins.
- Explain the why behind every non-trivial choice. Say so when there is a better way than what was asked.
- Ask when a requirement is ambiguous. Do not guess on product behaviour.
- Never break existing behaviour. A change that touches many modules is a design smell: stop and raise it.
- Before reporting done: run the checks, re-read the diff against RULES.md, state what was and was not verified.

## Sub-agent models

Exploration: Sonnet 5.5. Well-scoped implementation: Opus 5.5 (medium effort). Orchestration: Opus 5.5.
