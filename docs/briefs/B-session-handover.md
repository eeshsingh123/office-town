# Brief B: Efficient mode, long sessions carry on in a new session

Phase 2 of the performance work, part B. Agreed with the owner on 2026-11-09. Nothing is built yet. Part C (`C-goal-progress.md`) waits until B is merged and finished end to end.

## Read first

- `AGENTS.md`, `docs/RULES.md`, `docs/MODULES.md`, `docs/MEMORY.md`.
- `docs/DECISIONS.md`: D-72 (lean runs and today's handover), D-31 and D-44 (sessions, results, idle stop), D-71 (stop_work), D-73 (checker), D-74 (Outputs), D-77 (messages during a turn, retries), D-83 (queued briefs, Steps column), D-84 and D-86 (task end, Continue).
- Code: `packages/service/src/team/handover.ts`, which holds today's handover. Start there.

## Why

Every step an agent takes re-reads its whole conversation, so a session's cost grows with the square of its length. The cache already works: the owner's largest runs had 98 to 99.5% cache hits, and long gaps cost only 1 to 4M uncached tokens per run. The cost is volume: conversations grew to 400k to 860k tokens.

Measured on the owner's 12 largest DeepSeek runs on OpenCode (2026-11-09). 9 of the 12 were workers:

| Run | Role | Time | Steps | Peak context | Tokens read |
|---|---|---|---|---|---|
| Reverse Engineering Researcher | worker | 2.4 h | 439 | 858k | 225M |
| Developer | worker | 8.3 h | 471 (6 messages) | 659k | 184M |
| Developer | worker | 3.6 h | 398 | 486k | 124M |
| NFS 2 SE Multiplayer | lead | 1.4 h | 207 | 703k | 106M |
| NFS 2 SE Web Port | lead | 8.1 h | 186 | 402k | 43M |

On those runs, starting a new session whenever context passed about 250k would have read 40 to 65% fewer tokens, with 1 to 5 handovers per run. That is an upper bound, since a new session re-reads some files to get going. None of the runs ever compacted.

The owner accepts the DeepSeek numbers for the design. No Claude measurement run is needed.

## What exists today

- `hand_over` is a team tool for leads only. It works when the user asked, or when the user accepted the app's suggestion. The suggestion shows once per conversation, past 400k (`SUGGEST_AT_TOKENS`), and only while workers are still at work.
- The lead writes decisions with why, facts, the next step and files. `carryOver` starts the new session first and then stops the old one. The new session gets the lead brief, the handover, the records (the user's messages and answers, and every piece with its brief and result), and the earlier conversation as a file (`<data folder>/handovers/<taskId>/<sessionId>.md`) to search, not read whole.
- Context size reaches the core only at a turn's end (`turn.ended` usage `contextTokens`). Every adapter fills it: Claude, ACP, Codex and Muse.
- An agent idle for 10 minutes is stopped and resumed with the harness's own resume (D-44).

## Owner decisions (settled; do not reopen)

1. **Two modes.** One place (default) behaves exactly as today. Efficient is opt-in only.
2. **Where the mode is chosen:** an app-wide default in Settings, plus a per-task choice on the run card. The user may switch a running task to Efficient; it takes effect at the next size check.
3. **Who hands over:** workers, leads, the chief and solo agents. Workers matter most: they are the biggest spenders.
4. **Trigger in Efficient:** the context passes **350k**, or earlier if the AI app's own compaction would start first, so ours always comes first.
5. **No approval card in Efficient.** Choosing the mode is the approval: the handover happens in the background, and the user keeps one continuous chat.
6. **An agent that asks for a new session itself** (today `hand_over` refuses it) goes to **Needs you** as an approval, in both modes. The owner named the lead; check at the mockup whether every role gets the same.
7. **One place keeps today's suggestion**, with the threshold lowered from 400k to **300k**. Nothing else about it changes: leads only, work still out, once per conversation.
8. **The agent writes its own handover**, while its cache is warm. No cheaper model writes it.
9. **"Complete" means:** every record carried word for word (user messages, answers, briefs, results), plus the agent's written handover and the full earlier conversation as a searchable file. No summary replaces the records.
10. **The chat line reads exactly:** "Continued in a new session with complete handover". It should be simple and reassure the user that Efficient mode is safe.
11. **Handover files live in Outputs**, in their own section, on the task and on a department's task. Each one opens as readable Markdown with good layout. The user can clear them once the task is done, export one, or save one to the Library. Do not show sizes or storage totals.
12. **Out of scope** (owner, or the numbers): a new session for every message; handovers driven by idle gaps (the data shows little gain); batching results; budgets; anything from part C.

## How it behaves

### When it fires

- Never mid-tool. The core sends "write your handover now" with `registry.tell`, which reaches a busy agent at its next tool end (D-77). It reaches an idle one as a resume.
- Long turns are the common case for workers. The 184M Developer took 471 steps across only 6 messages, so a check that waits for a turn's end would almost never fire. The trigger needs the context size during a turn (see "Needs a contract change").
- Not while a Claude sub-agent of that session is still running: stopping the old process would kill it (D-71). Wait for it to end.
- Not while the task is paused for usage (D-72), and not after the user stopped the agent.
- At most once per check. If an agent ignores the request, ask again at most once more, then leave it running and log it. Never loop.

### Per role: nobody else spends a turn

| Who hands over | What must stay true |
|---|---|
| Worker | Its open piece moves to the new session in place: the same delegation, now pointing at the new session id. The lead is **not** told. `delegate` to that worker, queued briefs (`results.ts` `updates`, keyed by session id), `stop_work`, `resume_work` and `change_worker` all reach the new session. It runs in the same worktree or folder, so uncommitted work stays where it is. |
| Lead | Workers carry on. Results reach the new session through `tellLead` and `latestSession`. Keep today's order: start the new session, then stop the old one. |
| Chief | Departments carry on. Piece results reach the new chief session the same way. The chief has its own tools (`chief/`), so `hand_over` must be offered there too. |
| Solo | No one else is involved. |

The old session must never end in a way that reads as a failure: `results.ts` would retry the worker, and `recoverLeads` would retry the lead. Move the delegation before the old session stops. An idle-style stop (`registry.stop(id, true)`) is what `carryOver` uses today.

### What the agent writes

Keep today's fields: decisions with why, what it learned, where things stand and what comes next, and files with what each holds. Add:

- **where it is in its current piece or step list.** Today's step list (`TaskCreate`/`todowrite`) is lost in a new session (D-83). The handover carries it, and the new session writes it again first, so the Steps column never goes blank.
- **per role:** a worker writes what is done and left of its piece; the chief writes where each part of its plan stands.

Keep the note's shape close to these fields: part C later builds the handover from its goal record, and the same fields let it replace the note's source without rework.

### What the new session gets

Its usual brief (worker, lead, chief or solo), the handover, the records (as `recordsOf` builds them; for a worker, its piece's brief and any briefs since), and the earlier conversation's file. The file is a copy built from the stored events (`transcriptOf`), so clearing it loses nothing the store does not still hold.

### UI

- Mode: on the run card (per task) and in Settings (app default). Plain words, following the copy rules.
- Chat and trace: one quiet line, "Continued in a new session with complete handover", where the new session starts. The handover message must not show as "You asked…" in Activity (`apps/desktop/src/trace/activity.ts`, `startTitle`) or as a user bubble in the chat (`features/chat/chat-items.ts`).
- Outputs: a section for handover files (decision 11) in `features/outputs` (`OutputsPane`, `TaskTabs`, the Markdown viewer in `Viewer`). Clear is offered only once the task has ended.
- Tokens: an agent's and a task's totals already add up every session. Check that they still do across a handover.
- Needs you: only the agent-initiated ask (decision 6) and One place's suggestion (decision 7).

## Needs a contract change (do this first, as the architect)

1. **The mode:** an app-default field on `settingsSchema` (`packages/contract/src/api.ts`), plus a per-task field on the start requests (solo, team, group, chief goal) and on the task record, readable and changeable while the task runs.
2. **Context size during a turn**, so the trigger can fire inside a long turn. Today it arrives only on `turn.ended`. Check what each CLI reports per step: Claude's per-message `usage` (the translator already tracks `#contextTokens` per main-conversation message), ACP/OpenCode, Codex and Muse. Add one optional, unstored signal that every adapter can fill. Adapters that cannot fill it fall back to the turn's end. The conformance tests then cover it on every harness.
3. **Handover files as outputs** (a kind or section in `contract/src/outputs.ts`), plus the clear, export and save-to-Library actions.

## Where the work goes

- `packages/service/src/team/handover.ts`: roles, modes, triggers, the tool-end request, the agent-initiated approval, and moving a worker's piece. If it grows past one clear job, split it by job (trigger, carry-over), not by role.
- `team/briefs.ts`, `chief/briefs.ts`: `hand_over` and its brief lines for every role.
- `team/results.ts`, `store`: move an open delegation to a new session in place.
- `team/stop-work.ts`, `change-worker.ts`, `delegate.ts`: act on the worker's current session.
- `team/checks.ts`: the checker's "lead's conversation as a file" covers every session of the lead in the task.
- `team/usage-pause.ts`: no handover on a paused task.
- `packages/harness` adapters: the context signal from "Needs a contract change", item 2.
- `apps/desktop/src`: run card, Settings, chat and trace line, Activity, Outputs section.
- `apps/desktop/src/features/help/whats-new.ts`: an entry in the same PR (owner rule).

## Check before building (vendor facts: check on the web, official sources, latest)

- Each AI app's own compaction point, to set "earlier than 350k" per app: Claude Code (auto-compact window per model, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`), OpenCode (`compaction.buffer`), Codex (`model_auto_compact_token_limit`), Copilot, Cursor and Muse. Where the window is unknown, use 350k.
- Whether Claude Code's idle compaction (on by default from 2.1.290, for conversations of 200k or more on the one-hour cache) can run in our non-interactive sessions. Probe once on Haiku.
- Cache lifetime, for context: on a Claude subscription within plan usage, the main conversation (including `-p` and SDK) gets a 1-hour cache; sub-agents get 5 minutes; past the plan limit, everything gets 5 minutes. A resume reads the cache while it is warm. A summary written after the cache expired re-reads everything uncached, which is why the handover is written right away (https://code.claude.com/docs/en/prompt-caching.md).

## Edge cases

- A restart between `hand_over` and the turn's end: the pending handover is held in memory only. The session resumes as an interrupted one does today, and the next check asks again.
- A message or result arriving during the switch reaches the new session. That is why it starts before the old one stops.
- A worker handed a new brief while it writes its handover: the brief must reach the new session.
- The new session fails to start: tell the old one to carry on, as `carryOver` does today, and do not ask again for that conversation in this window.
- Switching between Efficient and One place while a handover is pending: finish the pending one.
- A conversation that starts above the threshold (a resumed one): never hand over twice in a row without new work in between.

## Build stages (AGENTS.md)

1. **Mockup** (an artifact, checked in dark and light): the mode on the run card and in Settings, the chat line, the Outputs section with Clear, Export and Save to Library, and the Needs you card for an agent's own ask. The open questions go on it. Wait for the owner.
2. **Build** on `feat/session-handover`, cut from an up-to-date `main` after the performance-phase PR (#83) is merged. Commit series in order: contract, adapters' context signal, core, UI, docs.
3. **Docs:** a new decision (next free number; D-93 is the latest), a MODULES.md line under Built, MEMORY.md state, What's new.

## Acceptance checks

- `pnpm check` passes. The repo holds at most 50 tests (count with vitest). Extend a flow test or replace a weaker one; do not add past the cap.
- Recordings or fakes:
  - a worker in Efficient mode passes the threshold mid-turn, gets the request at a tool end, writes its handover, and carries on in a new session in the same folder;
  - its piece stays the same piece, the lead gets no message, and the worker's result still reaches the lead once.
- A lead and a solo agent hand over the same way; results go to the new lead session.
- One place: nothing changes, except that the lead's suggestion now shows at 300k.
- An agent that calls `hand_over` unasked produces a Needs you approval; Deny keeps the session.
- The Steps column shows the step list again in the new session.
- The handover file shows in Outputs as Markdown; Clear (task done), Export and Save to Library work.
- The chat shows "Continued in a new session with complete handover", and no "You asked…".
- One live smoke run, on OpenCode's free model only (owner rule). Lower the threshold with a test-only core option so the run stays short; this is not a product setting.

State what was and was not verified, and, for every unchecked item, how to reach it, what should happen and what would be wrong.
