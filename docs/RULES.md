# Rules

## Design

- Open/closed first: a new harness, connector, agent role or view is a new module implementing an existing interface. It must not require edits to the core.
- Dependencies point inward: UI and adapters depend on the core's contracts; the core depends on nothing outside itself.
- One reason to change per module. If a change request touches more than two modules, revisit the boundary before coding.
- Abstract only at real seams: an external boundary (harness, connector, storage, shell) or a second concrete implementation. No speculative interfaces, options or config.
- Reuse before writing. Delete before adding.

## Code

- No module docstrings and no file header comments.
- Comments explain a non-obvious why in one line. Never restate the code, never narrate history.
- Plain, conventional names. No clever, abbreviated or joke names; no `Manager`/`Helper`/`Utils` dumping grounds.
- Small functions, early returns, no dead code, no commented-out code.
- Types on every public boundary. Validate data at the edges, trust it inside.
- Errors are handled where something can be done about them; otherwise they propagate. No silent catches.
- Tests are few and focused: core behaviour at module boundaries and flows that cross layers. One test per rule, not per example. No tests for what the type checker or the schema library already proves, and none added only for coverage.

## Git

- `main` is protected. Work happens on `feat/`, `fix/`, `chore/`, `docs/` branches.
- One logical change per PR, small enough to review in one sitting.
- The owner reviews and merges every PR. The agent never merges.
- Commit messages: imperative subject under 72 chars, body only when the why is not obvious.

## Definition of done

1. The module works end to end and was actually run.
2. Lint, typecheck and tests pass.
3. The diff was re-read against this file.
4. DECISIONS.md and MEMORY.md reflect any new decision or state.
