# Office Town (working name)

Open-source desktop app where a user describes a task and a team of AI agents plans, delegates and executes it, shown as a command center of departments and employees. Agents run on the user's own CLI harness subscriptions (Claude Code, Codex, Antigravity, OpenCode).

## Product principles

- No terminals in the app. We drive each vendor's unmodified CLI binary and render its structured output as a clean interface.
- Traceability: for every agent (employee) it is always clear what it is working on, which step it is on, and what it is blocked on.
- Cross-harness teams are the differentiator: a lead on one harness delegates to workers on another.
- Human in the loop is essential, never an afterthought.
- Reachable on free and low-cost models, not only premium subscriptions.

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
