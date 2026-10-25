# Office Town (working name)

Open-source desktop app where a user describes a task and a team of AI agents plans, delegates and executes it, shown as a command center of departments and employees. Agents run on the user's own CLI harness subscriptions (Claude Code, OpenCode, Codex and others; no Google CLIs, whose terms risk the user's account).

## Product principles

- No terminals in the app. We drive each vendor's unmodified CLI binary and render its structured output as a clean interface.
- Traceability: for every agent (employee) it is always clear what it is working on, which step it is on, and what it is blocked on.
- Cross-harness teams are the differentiator: a lead on one harness delegates to workers on another.
- Human in the loop is essential, never an afterthought.
- Reachable on free and low-cost models, not only premium subscriptions.

## Source of truth

- [docs/MODULES.md](docs/MODULES.md): the roadmap and the scope of each module. Do not build outside it.
- [docs/RULES.md](docs/RULES.md): design, code and git rules. Read before writing code.
- [docs/DECISIONS.md](docs/DECISIONS.md): architecture decisions. Only those that still guide upcoming work keep their why; settled ones are compressed to one line under Done.
- [docs/MEMORY.md](docs/MEMORY.md): current state, active module, open questions. Update at the end of every work session.

Keep all four short. If a line would not change what the next session does, delete it.

## How we work

- The owner drives; the agent implements end to end and owns code quality.
- One module at a time, finished and verified before the next begins.
- Explain the why behind every non-trivial choice. Say so when there is a better way than what was asked.
- Ask when a requirement is ambiguous. Do not guess on product behaviour.
- Never break existing behaviour. A change that touches many modules is a design smell: stop and raise it.
- Before reporting done: run the checks, state what was and was not verified.

## Build protocol

A module earns its place only if it adds real value; cut anything that does not.

A new module goes through three stages, each waiting on the owner:
1. Discussion: understand the ask, research references, look at the app as it is, then present the approaches, an end-to-end plan, limits and tradeoffs. Push back where there is a better way.
2. Mockup: an artifact of how it looks in the app, with the open questions on it.
3. Build: re-read its scope in MODULES.md and RULES.md, implement on a feature branch, verify, open a PR. Ask when something comes up mid-build. Report what was added, why, and what is next.

Adding a module to MODULES.md also compresses the Built section, so it stays short as modules grow.

## Story briefs for other agents

The owner hands well-scoped stories to other agents. A brief must stand alone, with no access to this project's conversations:
- context: what the product is and where this piece sits;
- exact scope and explicit out-of-scope;
- files and packages to create or touch, and the contracts to implement against;
- acceptance checks that can be run;
- a pointer to RULES.md.

A story must not require changing an existing contract. If it would, the architect changes the contract first.

## Session limits

Session limits are tight; spend them on the work.

- No sub-agents unless the owner asks. When asked: `opus-medium` by default, `sonnet-xhigh` for fully specified work (`.claude/agents/`), with a brief that stands alone.
- No code review and no review fixes unless the owner asks for one in that session. Reviews happen in their own sessions.
- Read only the files the task needs. Checks: `pnpm check` before the PR, one live smoke run per module.
