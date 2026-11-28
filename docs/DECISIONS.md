# Decisions

Decisions that still shape the work, grouped by topic. Code cites them as `D-n`; a number is never reused. A bullet says what was decided and, where it still guides work, why, in at most three lines. How a thing is built lives in the code and its PR; the full earlier text is in git history (`git log -p docs/DECISIONS.md`).

## Product and stack

- **D-1, D-2, D-4** A desktop app, since it drives CLIs on the user's machine. The core is its own local process; Electron is a thin shell.
- **D-3, D-12, D-19** TypeScript on Node 24: pnpm, Zod, `node:sqlite`, Electron, React, Vite, Zustand, Biome, Vitest. No build step in development; only the installer is built.
- **D-7** Open source. Free and low-cost models are first class.
- **D-8, D-9, D-11** A command center across harnesses, task agnostic, with connectors as plugins. A harness's own sub-agents show as nested activity.
- **D-29** No per-agent budgets or dollar tracking; each provider's own limit is the truth.
- **D-115** No Office Town cloud: "cloud" is an always-on machine the user owns running the same core, with no relay of ours. Computer use: a browser connector now; desktop control only in a future sandbox, never on the real desktop.

## Harnesses

- **D-5, D-13, D-20** One contract, one adapter per wire format. Adapters only translate, do no I/O, and pass the same conformance tests against recordings of the real CLI.
- **D-6** Only the unmodified vendor binary in its official headless mode; never touch its credentials. No Google CLIs: their terms risk the user's account.
- **D-14, D-21, D-22** Where a harness runs (native, WSL) is an `Environment`, apart from which harness it is. The agent's own text is never rewritten.
- **D-26, D-28** Models and efforts come from a catalog query. A session resumes by the harness's own id, only in its original environment and folder.
- **D-41** Our tool server is attached and the CLI isolated with its own flags (Claude: `--mcp-config`, `--setting-sources ""`; never `--bare`, which breaks the subscription login). The token never goes on a command line.
- **D-76** Claude Code, OpenCode, Codex, Muse, Copilot and Cursor. Adapters declare sign-in, version, install and account folder, so the UI never names a harness. A new harness must not break the others; the app never installs a CLI unasked.
- **D-77, D-83, D-134** A message reaches an agent during its turn at a tool end, never mid-tool, on every harness. Until the CLI takes it, it shows as waiting; one never read goes first in the next conversation.
- **D-97, D-98** OpenCode 1 and 2 under one harness, the installed version picking the adapter. 2.x side commands run `--standalone`, so the user's background service is never touched. The model list starts its own private server and asks until the models have loaded, as 2.4 answers before. 2.x sessions turn OpenCode's own automations off: their runs happen outside the app, unseen.
- **D-99** Adapters declare whether sub-agent steps are shared and whether the CLI wakes the agent itself; otherwise the core sends a notice once the last sub-agent ends.
- **D-92** One-off CLI queries run two at a time; sessions never wait. Why: each process start blocks the core's thread on Windows.
- **D-117** On a Mac the core reads the login shell's environment at start, so CLIs installed for Terminal are found. Claude's usage is read from its Keychain only on the user's Refresh, never logged or stored.

## Core: store, API, live state

- **D-15, D-30** Every event goes to one local SQLite file behind a synchronous store; state and replay are read from it. One core per data folder. Every index serves a named query; no full scans, no `OFFSET`. Merged migrations are never edited; the file is copied first and a newer file is refused.
- **D-31** Store, then publish. If the store fails, the agent stops: work that cannot be recorded cannot be traced. A shutdown records sessions as interrupted.
- **D-17, D-32, D-36** Commands are HTTP; events flow on one SSE stream resuming from `Last-Event-ID`. `127.0.0.1` only, with a per-launch token that never reaches a page showing agent text.
- **D-50** Every change to a record is published whole after its write. Task state is decided only in `team/task-state.ts`.
- **D-91, D-101** One task status everywhere, shared by core and app (`contract/task-status.ts`). Finished work is To review until the user marks it Done.
- **D-93** Provider status is a background job per provider; reads answer at once. Speed up only what measurements show is slow.
- **D-121** Every start no person typed goes through one stored admission queue (department free, the chief's one goal, the account below 95%, two unattended starts at a time). Every wait and skip says why in plain words.
- **D-142** Keep only what something reads: no raw CLI lines, one backup from before the latest migration. A call to an app is kept 90 days, past its task, as the record of what agents did in the user's accounts. A record is read again before it is written back after any wait.

## Shell and packaging

- **D-34** Closing the window keeps agents running in the tray by default; quitting with agents running asks first. The core stops when its stdin closes. Why: Windows cannot send a child SIGTERM.
- **D-75** A per-user Windows installer and a Linux AppImage, updated by electron-updater. Every merge publishes a beta only the owner follows; a stable release only when the owner asks, never by the agent; bump the version after each release. Updates never install under a running agent.
- **D-116** macOS 13 or later on Apple silicon, from the same code; ad-hoc signed betas until an Apple Developer ID is bought. Every module from M11 on works on Windows, Linux and macOS.
- **D-135** No CI until the public release: `pnpm check` before each PR is the check. Mac builds run apart so a Mac failure never holds back the others. Bring CI back, the Mac first, before the release.
- **D-89** The shell adds the usual text menu; app objects get menus that only repeat existing actions. Every Stop asks first.
- **D-123** While agents work, the shell keeps the app from being suspended (never the display), unless Settings turns it off. The app never promises to wake the computer.

## Human in the loop

- **D-10, D-25, D-33** One queue, Needs you, for permission requests and questions.
- **D-24, D-45** Agents run in the harness's ask mode; one core policy answers each request, and anything it cannot read goes to the user.
- **D-40, D-57** Levels: Manual, Auto, and No safety checks behind a warning. Outward actions (push, PR, publish) only under Auto. Every team proposal and plan waits for the user at every level. "Always allow this" rules are parked; the owner wants them later.
- **D-51, D-64** In a read-only folder only reads go through, at every level. The core refuses an answer it did not offer.
- **D-82** A task shows its level once, in a chip that saves on the department or solo agent.
- **D-71** An agent cutting off another needs the user's approval.
- **D-78** A lead that would change direction asks first with `propose_change`, at every level.
- **D-118** Automations start at the Settings default level; event-triggered ones never use No safety checks. `propose_schedule` always waits for the user. An unanswered ask ends a run after its automation's limit.
- **D-122** After a close or crash nothing the user started resumes on its own: Home lists what stopped, with Resume all and Choose. A task cut off while resuming twice in a row stays stopped with a reason.
- **D-124** The core decides what deserves an alert and stores it as a notice; the window shows it as an OS notification while not in front. A notice never carries an agent's own text; a burst folds into one.

## Teams

- **D-40, D-42, D-55** A department is a standing team: one lead, workers, a room. Every session belongs to a stored agent. Settings flow department, role, agent; an agent may be more careful than its team, never less. Every agent reads, in order: About you, its team's rules, its own instructions, the task.
- **D-39, D-43** Team tools come from the core's own MCP server and return at once; outcomes reach the agent later as a message. Why: it works the same on every harness, and a tool that waits on a person hits timeouts.
- **D-44** A worker's result is its last message when its turn ends with nothing waiting and no sub-agent at work. No time limit. An agent idle 10 minutes is stopped and resumed when needed.
- **D-46** A worker's worktree comes from the lead's branch, lives in the data folder, and is removed once merged.
- **D-72** The lead plans, merges and decides; workers build and report briefly with details in a file. Cost is context size times steps, so the lead's context is what to protect. Past 95% of an account's window, its tasks pause whole.
- **D-77, D-120** A failed turn gets one automatic retry, stored so a restart neither grants a second nor forgets one; then the lead hears the real error. A lead never waits by sleeping or polling. A quiet worker is flagged, never stopped.
- **D-84, D-86, D-88** A department is free once its task ends. A new task starts every agent fresh; resume never crosses tasks. Progress is honest: after 25 actions with no plan change, the step gives way to the current action.
- **D-95** Milestones (opt-in): outcomes the user sees and owns, reported by the agent. They inform and never block; a lead may send a part back at most twice, then the user decides.
- **D-49** One standing chief. A goal goes to it only when the user chooses. Its plan is one piece per department, and the user approves it and every change. It messages leads, never workers.
- **D-136** Ready-made teams and recipes: a few hand-picked starting points beside each Describe box, never a gallery. A pick fills the existing steps and never replaces the user's own work. Roles name only power (strong or cheap), mapped to what the user has.

## Workspaces, files, outputs

- **D-56** A workspace is a named list of folders: the first is where agents work, others Can edit or Read only. Scratch (a new folder per task) is only the fallback for a department with no folder. Removing a workspace never touches files.
- **D-127** A workspace and its Library are shared and nothing is locked. When an agent changes a file another agent changed since it last read it, the core tells it at once and both traces show it.
- **D-64** Attachments go with a message; a workspace Library gives read-only items to everyone, departments or agents. No indexed knowledge base: search hands agents fragments, where made-up answers start.
- **D-87** An image for a model that cannot see gets a description from a cheap model, never a paid plan.
- **D-74** An output is a file or a local site. An agent's page is untrusted: it loads from a separate preview port that never sees the app's token.

## Usage and long runs

- **D-61** An account is one login on one harness, in its own folder handed to the CLI. Automatic picks the signed-in account with the most room. Amber from 70%, red from 90%.
- **D-94** A handover only when the user asks, or, with Efficient on, at a tool end past a size, before the CLI's own compaction. The new session gets the brief, the handover and the records word for word.
- **D-73** Finished work is checked outside the team, as an offer, never automatically: a fresh checker in a sandbox reports pass, fail or not run on a list the user approved. The user is the round limit. Why: tester and developer loop without end.

## Connectors

- **D-67** The core is the hub for key apps and local programs, so every harness reaches them. Keys live only in the OS credential store. Each app's permission (Read only, Ask me first, Don't ask) is decided by the core, not the CLI. The tool list never changes inside a conversation, to keep the prompt cache.
- **D-68, D-96** Provider apps (claude.ai connectors, ChatGPT apps, OpenCode's servers) are signed in to and held by their provider; the app never runs a sign-in or holds their token, only turns apps on and off per session. Add searches a vetted list only.
- **D-104** One status per app, the worst of its routes.

## Automations

- **D-125** An automation is a saved New task plus a When: a schedule (at least an hour apart) or after another automation (at most 5 in a row). Every run is an ordinary task, written under its key before it starts, then through the admission queue. Missed runs while closed: one catch-up run, else one Skipped record.
- **D-126** Auto: a per-automation choice that runs end to end with no Needs you decisions; the core answers plans, proposals and stops in the run's place, and the trace says so. Permission asks still follow the level; Auto never means No safety checks.
- **D-128** Event sources, each a file behind one interface (`automations/sources/`): a new file in a folder, a feed, GitHub issues or pull requests, an agent check. Everything seen is stored under its key first, so nothing runs twice; an automation's own changes never start it, so it cannot loop.
- **D-129** An automation can let chosen apps act without asking in its own runs. Separate from Auto; neither the drafter nor `propose_schedule` can set it.
- **D-130** Updates: results and alerts go one way to Slack, Discord, Telegram, email or a webhook, connected once in Connectors by a pasted link or key (no sign-ins). Alerts use the core's words; a result goes only where asked. Every message goes through a stored outbox, and a failed send never fails the task.
- **D-131** A run with nothing new (`report_nothing_new`) sends nothing, makes no notice and skips review.
- **D-133** An automation keeps notes across runs, written by the agent in charge with `keep_notes`; the user reads, edits and clears them.

## Feed

- **D-137** Feed is the office's story in moments, not steps: results, asks, stops, runs, heads-ups, suggestions. An ask there is the Needs you card itself; a reply messages the agent in its task. Posts are kept for stated times under a cap.
- **D-138** Posts are a projection the core writes from what it already records, never per step; keys keep them single across a restart. Agents post with `post_update`, capped per task and across the app.
- **D-139** Suggestions never start anything; they open a filled-in form. At most 3 a day, none while something waits on the user, and one switch turns them off.
- **D-140** The floor's bubble shows a new post over its agent for a few seconds; a waiting ask's bubble wins.
- **D-141** Progress updates: opt-in per task, posted with `post_progress` only by the card's owner into its own card. The core refuses one sooner than 30 minutes after the last or with nothing new since. Off costs nothing: no tool, no brief line.

## Interface

- **D-37, D-53** React, Radix, CSS Modules with one tokens file, `react-markdown` (never raw HTML). Plus Jakarta Sans, warm greys, slate blue for actions, amber only for what needs the user; reduced motion respected.
- **D-55, D-59, D-66** One name per thing, plain words, labels and short hints only, no explainer panels. No internal terms in what the user reads (session, harness, turn, core). "Provider" for a harness; models by display name.
- **D-35, D-48, D-52, D-62** Home is the first screen. The office floor is a view: a room per department. One side panel shape for an agent, a department and the chief.
- **D-103** One status vocabulary (`TaskStatusIcon`) and one page frame (`PageHeader`, shared widths and gaps).
- **D-38, D-58, D-80** One composer starts every task. One model picker, ordered by cost to the user. With nothing picked, OpenCode's free model runs.
- **D-79** The run card changes the model for the whole department by default.
- **D-60, D-63, D-85** Tasks are grouped by team; open work stays on top. A task's title comes from a free or cheapest model, never a paid plan.
- **D-81, D-90** Typed text is a draft that survives a restart and never brings No safety checks back without its warning. App-wide choices live on Settings; a task's own on its run card.
- **D-111** Settings rows: label left, control right, saved at once and put back if refused. Every agent editor (profile, team member, template) shares one field set.
- **D-110, D-112** One way to do each thing: first run is two setup steps ending on a first task; a department is made only through New department.
- **D-113, D-114** Usage is one card per provider, a row per account; its warning shows only at a limit or when the pace reaches it. People show Working, Needs you or Idle, never "Free", which means a free model.

## Remote

- **D-119** For M13 and M14: Tailscale is the one supported path, the core stays on `127.0.0.1`, and every phone is paired with its own revocable key.
