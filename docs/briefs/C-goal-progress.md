# Brief C: one goal record, milestones and short check loops

Phase 2 of the performance work, part C. **Start only after part B (Efficient mode, D-94) is merged and finished end to end.** C is a new module, so it goes through discussion, mockup and build (AGENTS.md). This brief is the starting point for the discussion stage. It is not a build spec.

## Read first

`AGENTS.md`, `docs/RULES.md`, `docs/MODULES.md`, `docs/MEMORY.md`, and in `docs/DECISIONS.md` D-94 (Efficient mode), D-49 and D-51 (chief and plan pieces), D-44 (delegation and results), D-72 (lean runs), D-73 (checklist and checker), D-78 (`propose_change`), D-83 (Steps column).

## The idea, as discussed so far

One record per goal, which every agent reads instead of each other's conversations. It is written at milestones, never on every message.

- **The core fills in everything it already knows, at zero tokens:** status, who works on what, results, the user's messages and answers, approvals, failures, retries and tokens.
- **Agents write only what needs judgement:** decisions with why, what they learned, and where they are. They write only when something changes.

Today the split of work lives in three places: the chief's plan pieces, the lead's delegations, and each agent's own step list. C joins them into one tree per goal: the goal, its milestones, the parts (per department or worker), and their steps. Each part gets a status, an owner, what it waits on, and proof that it is finished.

Why it helps long runs and swarms:

- A worker reads the goal, its part and the decisions that touch it, not the lead's conversation.
- A lead reads the record instead of holding every result in its context, so its context grows more slowly.
- The chief reads each department's state instead of messaging leads.
- Every handover (part B) starts from the record, so it costs little. B's handover fields (decisions, facts, next step, files, current part) were kept in this shape on purpose.
- Later, free workers could pick up parts whose inputs are done.

It lives in the core's store, not in a file in the user's project: no clutter in their repo, no conflicts between parallel workers, exact facts from the records, it works on every AI app, and the UI can show it. Agents can get a read-only copy they can search.

Possible split into sub-modules (to confirm in discussion):

1. The record, with the core's facts and a view of it. No change to agents.
2. Milestones written when the work is split, and proof when a part ends.
3. The short check loops.
4. B's handover built from the record.

## Owner rules (settled)

- **B comes first.** C starts only once B is complete end to end.
- **Plain, readable words.** Do not use terms like "done when" or any jargon or wordplay. Every milestone is a clear, concrete outcome that a person and an agent read the same way, because vague wording makes check loops fail and the goal never ends.
- **Never an endless loop.** Milestones are actionable, and they get met as the build moves forward. Every loop has a limit.
- **A lead sends a part back at most 2 times.** After that, it goes to the user.
- **Progress is tracked live in the UI,** updated all the time while a solo agent or a department works, in a way that is easy for the user to follow. Discuss the design with the owner; keep the check and feedback loops simple.
- **C may be opt-in, like Efficient mode.** Decide in the C discussion, not before.
- **Keep earlier owner decisions:** checking by the checker is an offer and never automatic, and the user is the round limit (D-73); results are not batched; no budgets (D-72); agent memory across tasks stays deferred, and this record is per goal only.

## Check loops, as proposed (to refine with the owner)

1. **Part:** the worker checks its work against its part's milestones before reporting, then reports pass or fail for each, with proof, inside the short report it already writes.
2. **Team:** the lead checks each result against the same milestones. A fail goes back with only the failing items, at most 2 times, then to the user.
3. **Goal:** the goal's checklist exists from the start instead of only at the end. It is refined as the work goes on, and the checker (D-73) still runs it at the end as an offer.
4. **Direction:** each time a part ends, the lead or the chief compares where things stand with the goal, and uses `propose_change` (D-78) if the direction moves.

## Open questions for the discussion

- What a milestone is in plain words, and who writes it: the chief, the lead or the solo agent, when the work is split.
- How the user sees the milestones and changes them. The owner asked for a friendly, always-current view, not one more approval step. The plan card and the team proposal already exist as places to show them.
- How a solo task gets milestones, since it has no card today.
- Whether C is opt-in, and how it sits next to Efficient mode.
- What the core writes on its own, and what an agent must write, so that agents spend tokens only on judgement.
- How the record reaches each role (tool, brief, a read-only file) without adding tokens to every step.
- How the record, Steps, Activity and the office floor fit together, so the user sees one progress, not three.
