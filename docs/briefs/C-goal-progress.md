# Brief C: milestones, short check loops and one live progress view

Phase 2 of the performance work, part C. B (Efficient mode, D-94) is merged. Discussion and mockup are done, and the owner agreed every pick (2026-11-10), so this is ready to build. Mockup: https://claude.ai/artifact/TGn8XN8Gf2A4dyc7WRRH32. Branch `feat/goal-record`, cut from `main`, one PR.

## Read first

`AGENTS.md`, `docs/RULES.md`, `docs/MODULES.md`, `docs/MEMORY.md`, and in `docs/DECISIONS.md` D-94, D-49 and D-51, D-44, D-72, D-73, D-78, D-83, D-50, D-77, D-89.

## Why

A department (one lead, N workers) or a solo agent works from the user's ask. A vague ask can be built far from what the user meant, and a long run wastes tokens on it. C writes down what the user will get, in plain words the user sees and owns, checks each piece of work against it with a hard limit on retries, and shows progress live in one place.

## Owner decisions (settled)

- **Opt-in, off by default**, like Efficient mode. App default in a new **Settings** page; per task on the run card and the composer.
- **Plain words.** A milestone is one outcome sentence and one "How you'll see it" line, written for the user with nothing technical in it. Technical proof goes in the proof, which the user can fold. Never use "done when" or jargon.
- **The user has the final say.** The user can add, edit and remove goal milestones, a part's milestones and steps at any time. The agent is told, and the view shows when it has the change. There is no approval step: agents start at once.
- **No cap** on how many milestones there are. Past 12 on one goal, the tool's reply asks the agent to merge overlaps or move detail into parts; nothing is refused. Met milestones fold away in the view.
- **At least one milestone**, even on a small solo task.
- **Never an endless loop.** Milestones inform and never block: a task ends exactly as today (D-50), and unmet milestones show "Not met" at the end. A lead sends a part back **at most 2 times**, enforced by the core; after that it goes to Needs you.
- **Implicit accept.** A part whose worker reports every milestone met is done at once, with no lead step. The user gets a notice (toast, Activity line, New mark); "Got it" clears the mark and nothing waits on it.
- **D-73 changes:** with Milestones on, the lead may send a part back up to 2 times inside the team. The checker outside the team stays an offer, and the user stays its round limit.
- **Progress replaces the Steps column.** The office floor shows a progress bar per room and "n of m" per desk.
- **A Settings page** (new nav item above Help) holds Efficient mode, Milestones and Display. Help keeps Tutorials and What's new. Future settings go there.
- **Kept from before:** results are not batched, no budgets (D-72), no memory across tasks; the record is per goal.

## Mockup questions: all agreed by the owner as written

1. The "part done" notice never blocks; "Got it" only clears the mark.
2. A change to a person's part goes to that worker directly, with one line noted to the lead.
3. Steps the user adds or removes are a request to the agent ("Asked Ivy" until its list shows it); milestones apply at once.
4. Display moves from Help to Settings too.
5. Milestones can be turned on mid-task (the agent writes them at its next step). Turned off, the list stays visible and nothing is checked.
6. No cap, with a soft nudge past 12.
7. An agent may add milestones or make one clearer (marked "Changed by <name>"); dropping or weakening one goes through `propose_change` (D-78).

## Design

**Tree per goal:** goal milestones → parts (a chief's piece or a lead's delegation), each with its own milestones, status, owner, waits on and send-back count → that agent's steps (`plan.updated`, unchanged).

**Who writes milestones:**
- Chief: a `milestones` list on each piece in `propose_plan`, shown and editable on the plan card the user already approves. When a piece starts, its milestones become the department's goal milestones: the same rows, not a copy.
- Lead and solo agent: `set_milestones` as the first step.
- Lead to worker: `milestones` on `delegate` (at least one when Milestones is on).

**New tools** (offered only when the task has Milestones on, through `offeredTo`):
- `set_milestones({ milestones: [{ id?, outcome, see }] })` for a lead or solo agent. A new item is added; an existing id is reworded and marked changed by the agent. Leaving an item out does not remove it.
- `report_milestone({ id, met, proof })` for whoever owns the milestone: a worker for its part's, a lead or solo agent for the goal's. A worker reports all of its part's before its final message.
- `send_back({ agent, milestones: [ids], note })`, lead only. The core sends the worker only the failing items and counts per part. A 3rd is refused, and the part goes to Needs you with **Send back once more** (raises that part's limit by one), **Accept as is**, or **Tell <lead> what to do** (free text).

**What the core writes at zero tokens:** parts, owner, status, waits on, start and end, send-backs, failures and retries, handovers, the user's messages, answers and edits. With each result, the lead's message gains one line: "Goal: 2 of 6 met · Ben's part done · 1 sent back (1 of 2)". The chief gets the same for a piece.

**When an agent skips the tools** (weak model): the part ends as today, its milestones show "Not reported", and the lead's message says so. Nothing loops.

**User edits:** API routes to add, edit and remove milestones and to ask for a step. An edit is stored at once and sent as a message through `registry.tell` (it folds in at the next tool end, D-77, D-83) with the exact wording. A goal edit goes to the lead or solo agent; a part edit goes to the worker (and is noted to the lead, pending question 2). A chief piece's edit goes to its department lead. The view shows "Telling Maya…", then "Maya has it" once the message is taken. **Check first** how the registry reports that a queued message was taken. Step requests show "Asked <name>" until the agent's next `plan.updated`.

**Statuses:** a milestone is stored as not started, met or not met. "Being worked on" is shown only for a part's milestones while its part is working.

**Checker:** with Milestones on, the checker's list starts from the goal's milestones (`from: "lead"`); the rest of D-73 is unchanged.

**Handover (C4):** with Milestones on, `hand_over` gets `progress` and `steps` filled in by the core from the record; the agent writes only decisions, facts and next.

## Contract and store

- Milestone schema and record: id, taskId, part (delegation id, piece id or none for the goal), position, outcome, see, status, proof, reportedBy, origin (agent or user), changedBy, delivery, createdAt, updatedAt. A `milestone` change frame (D-50).
- `milestones?: boolean` on the solo, team and chief start requests and on the task record; `milestonesByDefault` beside `efficientByDefault`; the task mode request takes either flag.
- `milestones` on a proposed piece; `sendBacks` on the delegation record.
- One migration: a `milestones` table indexed by task (D-15: the index serves a named query).

## Where the work goes

- Core: a new `packages/service/src/goal/` (the tools, the record, the summary line, user edits). Small changes in `team/delegate.ts`, `team/results.ts`, `team/briefs.ts`, `agents/briefs.ts`, `chief/propose-plan.ts`, `chief/briefs.ts`, `team/checks.ts`, `team/handover.ts`, `api/routes.ts`, `store`.
- Briefs: the lead brief's "Do not run rounds of testing and fixing" becomes the send-back rule when Milestones is on; worker, solo and chief briefs gain the milestone steps when on. Off, every brief stays word for word as today.
- UI: `features/task/StepsColumn.tsx` becomes Progress (steps only when Milestones is off), `features/plan` piece milestones, a Needs you card, the notice, `features/task/RunCard.tsx` "For this task" switches (Efficient mode moves from Segments to a switch), an Options chip in the composer, a new `features/settings` view (Display and the defaults move from `features/help/HelpView.tsx`), `features/office/Floor.tsx` room bar and desk counts, and What's new.
- Not touched: task-state (D-50), the registry, usage, Efficient mode's trigger.

## Sub-modules, in commit order

1. Settings page and task options (moves only, no behaviour change).
2. Record, contract, store and the Progress view from existing data.
3. Milestones written at the split, reports and user edits.
4. Send-back with its limit, the Needs you card, the notice and the summary line.
5. Office floor progress, plan card milestones, checker seed, handover from the record.

## Edge cases

- Handover mid-part: the delegation moves (D-94), so its milestones follow.
- A restart: everything is in the store; a message waiting to be delivered follows today's rules.
- `continueTeam` after the end: the list stays; the user may add to it.
- Old tasks and tasks with Milestones off: Progress shows steps only, as today.
- A failed or stopped part keeps its milestones as they stand. A retry (D-77) is not a send-back.
- Lists past 12: the reply nudges, the view folds met items.

## Acceptance checks

- `pnpm check` passes. The repo stays at 50 tests: extend the team flow test to cover milestones, implicit accept and the 2 send-back limit, rather than adding a test.
- With Milestones off, a team task and a solo task behave and read exactly as before (briefs unchanged, no new tools offered).
- One live smoke on the free OpenCode model, with Milestones on and a team task: the lead writes milestones, a worker reports them, a user edit reaches the agent and shows "has it", and Progress and the floor update live.
- Checked against the mockup in dark and light.

## Later (not in this build; discuss both with the owner when swarms are built)

- **Decisions with why.** Collect them at moments agents already act, instead of through a new optional tool that models skip: the note on `send_back`, `propose_change` answers (already stored), and the handover's decisions. Show them as a Decisions list in Progress. Add a `record_decision` tool only if a real run shows decisions missing.
- **A read-only goal file.** The core writes `goal.md` (the tree, as text) into the data folder and grants it read-only like a Library item, rewritten on change. Worth adding when swarms have many parts and workers ask the lead for context about other parts.
- Free workers picking up parts whose inputs are done.
