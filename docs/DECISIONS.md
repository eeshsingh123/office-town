# Decisions

The decisions that still shape the work, grouped by topic. Code cites them as `D-n`; a number is never reused. Each line says what was decided and, only where it still guides work, why. Details that only describe how something is built live in the code. Trimmed on 2026-11-19 (owner): numbers no longer cited and no longer guiding are in git history only. Audit after each milestone (RULES.md).

## Product and stack

- **D-1, D-2, D-4** A desktop app, since it drives CLIs on the user's machine. The core is its own local process; Electron is a thin shell.
- **D-3, D-12, D-19** TypeScript on Node 24: pnpm, Zod, `node:sqlite`, Electron, React, Vite, Zustand, Biome, Vitest. No build step in development; only the installer is built.
- **D-7** Open source. Free and low-cost models are first class.
- **D-8, D-9, D-11** A command center across harnesses; a harness's own sub-agents show as nested activity. Task agnostic, with connectors as plugins.
- **D-29** No per-agent budgets or dollar tracking; each provider's own limit is the truth.

## Harnesses

- **D-5, D-13, D-20** One contract, one adapter per wire format. Adapters only translate, do no I/O, and pass the same conformance tests against recordings of the real CLI.
- **D-6** Run the unmodified vendor binary through its official headless mode only, and never touch its credentials. No Google CLIs: their terms risk the user's account.
- **D-14, D-21, D-22** Where a harness runs (native, WSL) is an `Environment`, apart from which harness it is. The agent's own text is never rewritten.
- **D-26, D-28** Models and efforts come from a catalog query. A session resumes by the harness's own id, only in its original environment and folder.
- **D-41** Our tool server is attached and the CLI isolated with its own flags (Claude: `--mcp-config`, `--setting-sources ""`; never `--bare`, which breaks the subscription login). A WSL agent reaches the core through a stdio bridge; the token never goes on a command line.
- **D-76** Harnesses: Claude Code, OpenCode, Codex, Muse, Copilot and Cursor. Adapters declare sign-in, version, install and account folder, so the UI never names a harness. A new harness must not break the others; the app never installs a CLI unasked.
- **D-77, D-83** A message reaches an agent during its turn on every harness, at a tool end, never mid-tool. Conformance checks this on every harness.
- **D-97, D-98** OpenCode 1 and 2 under one harness, the installed version picking the adapter; 2.x side commands run `--standalone` so the app never touches the user's background service. What 2 adds (steering, sub-agent steps, questions, Code Mode for shared apps only) runs only on 2.
- **D-99** Sub-agents: adapters declare whether steps are shared and whether the CLI wakes the agent itself; otherwise the core sends a short notice once the last sub-agent ends, so the reply is a turn of its own.
- **D-92** One-off CLI queries run two at a time; sessions never wait. Why: each process start blocks the core's thread on Windows.

## Core: store, API, live state

- **D-15, D-30** Every event goes to one local SQLite file behind a synchronous store; state and replay are read from it. One core per data folder. Every index serves a named query; no full scans, no `OFFSET`. Migrations are never edited once merged, the file is copied first, and a newer file is refused.
- **D-31** Store, then publish. A shutdown records sessions as interrupted, so "stopped" means someone stopped it. If the store fails, the agent stops: work that cannot be recorded cannot be traced.
- **D-17, D-32, D-36** Commands are HTTP; events flow on one SSE stream resuming from `Last-Event-ID`. `127.0.0.1` only, a per-launch token that never reaches a page showing agent text. A preload is plain JS.
- **D-50** Every change to a record is published whole after its write. Task state is decided only in `team/task-state.ts`.
- **D-91** One status rule shared by core and app (`contract/task-status.ts`); the core searches and counts every task.
- **D-93** Provider status is a background job per provider; reads answer at once. Change only what measurements show is slow.

## Shell and packaging

- **D-34** Closing the window keeps agents running in the tray by default (the user can choose Quit, D-111); quitting with agents running asks first and records them as interrupted. The core runs on Electron's own Node and stops when its stdin closes. Why stdin: Windows cannot send a child SIGTERM.
- **D-75** A per-user Windows installer and a Linux AppImage, updated by electron-updater. Every green merge publishes a beta only the owner follows; a stable release only when the owner asks, never run by the agent. Bump the version after each release. Updates install on quit or Restart to update, never under a running agent. Dev runs as "Office Town Dev" on its own data folder. Never a one-line PowerShell installer from a hidden process.
- **D-89** The shell adds the usual text menu; app objects get their own menus that only repeat existing actions. Every Stop asks first.

## Human in the loop

- **D-10, D-25, D-33** One queue, Needs you, for permission requests and questions.
- **D-40, D-57** Permission levels: Manual and Auto, plus No safety checks behind a warning. Outward actions (push, PR, publish) only under Auto. New work starts at the Settings default, Auto unless the user picks Manual (D-111). Every team proposal and plan waits for the user at every level. Needs you groups by task; Approve all covers approvals only. "Always allow this" rules are parked; the owner wants them later.
- **D-24, D-45** Agents run in the harness's ask mode; one core policy answers each request, and anything it cannot read goes to the user.
- **D-51, D-64** In a read-only folder only reads go through, at every level. The core refuses an answer it did not offer.
- **D-82** A task shows its level once, in a chip that saves on the department or solo agent and applies at the next request.
- **D-71** An agent cutting off another needs the user's approval.
- **D-78** A lead that would change direction asks first with `propose_change`, at every level.

## Teams

- **D-40, D-42, D-55** A department is a standing team: one lead, workers, a room. Every session belongs to a stored agent. Settings flow department, role, agent; an agent may be more careful than its team, never less. A template is copied into the agent. Every agent reads, in order: About you, its team's rules, its own instructions, the task.
- **D-39, D-43** Team tools come from the core's own MCP server and return at once; outcomes reach the agent later as a message. Why: it works the same on every harness, and a tool that waits on a person hits timeouts.
- **D-44** A worker's result is its last message when its turn ends with nothing waiting and no sub-agent at work. No time limit; the user can stop it. An agent idle 10 minutes is stopped and resumed when needed.
- **D-46** A worker's worktree comes from the lead's branch, lives in the data folder, and is removed once merged.
- **D-72** The lead plans, merges and decides; workers build and report briefly with details in a file. Cost is context size times steps, so the lead's context is what to protect. Past 95% of an account's window, its tasks pause whole.
- **D-77** A failed turn gets one automatic retry, then the lead hears the real error. A lead never waits by sleeping or polling.
- **D-84, D-86, D-88** A department is free once its task ends. A new task starts every agent fresh; resume never crosses tasks. Progress is honest: after 25 actions with no plan change, the step gives way to the current action.
- **D-95** Milestones (opt-in): outcomes the user sees and owns, reported by the agent. They inform and never block; a lead may send a part back at most twice, then the user decides.

## Chief

- **D-49** One standing chief. A goal goes to it only when the user chooses. Its plan is one piece per department, and the user approves it and every change. It messages leads, never workers.

## Workspaces

- **D-56** A workspace is a named list of folders: the first is where agents work, others Can edit or Read only. Scratch (a new folder per task) is only the fallback for a department with no folder. Removing a workspace never touches files.

## Usage and long runs

- **D-61** An account is one login on one harness, in its own folder handed to the CLI. Automatic picks the signed-in account with the most room. Amber from 70%, red from 90%.
- **D-94** Long chats: a handover only when the user asks, or, with Efficient on, at the next tool end past a size, before the CLI's own compaction. The new session gets the brief, the handover and the records word for word.

## Checking work

- **D-73** Finished work is checked outside the team, as an offer, never automatically. A fresh checker in a sandbox reports pass, fail or not run with evidence on a list the user approved. The user is the round limit. Why: tester and developer loop without end.
- **D-101** One task status everywhere (`taskStatus`). Finished work is To review until the user marks it Done. Every "…" menu is the shared `MoreMenu`.

## Files, Library, outputs

- **D-64** Attachments go with a message; a workspace Library gives read-only items to Everyone, departments or agents. No indexed knowledge base: search hands agents fragments, where made-up answers start.
- **D-87** An image for a model that cannot see gets a description from a cheap model, never a paid plan.
- **D-74** An output is a file or a local site. An agent's page is untrusted: it loads from a separate preview port that never sees the app's token.

## Connectors

- **D-67** The core is the hub for key apps and local programs, so every harness reaches them. Keys live only in the OS credential store. Each app's permission (Read only, Ask me first, Don't ask) decides its calls; the core, not the CLI, decides each call. The tool list never changes inside a conversation, to keep the prompt cache.
- **D-68, D-96** Provider apps (claude.ai connectors, Codex's ChatGPT apps, OpenCode's servers) are signed in to and held by their provider; the app never runs a sign-in, holds an app token or edits a provider's files, only turns apps on and off per session. Shared apps are used first. Add searches a vetted list only.
- **D-104** One status per app, the worst of its routes; Needs renewing and Not answering are the alerts.

## Interface

- **D-37, D-53** React, Radix, CSS Modules with one tokens file, `react-markdown` (never raw HTML). Plus Jakarta Sans, warm greys, slate blue for actions, amber only for what needs the user; reduced motion respected.
- **D-55, D-59, D-66** One name per thing, plain words, labels and short hints only, no explainer panels. No internal terms in what the user reads (session, harness, turn, handle, core). "Provider" for a harness; models by display name (`model-name.ts`).
- **D-35, D-48, D-52, D-62** Home is the first screen. The office floor is a view: a room per department. One side panel shape for an agent, a department and the chief.
- **D-103** One status vocabulary and one page frame: task statuses drawn only by `TaskStatusIcon`; pages use `PageHeader` and the shared widths and gaps.
- **D-38, D-58, D-80** One composer starts every task. One model picker, ordered by cost to the user. With nothing picked, OpenCode's free model runs.
- **D-79** The run card changes the model for the whole department by default, at each agent's next start.
- **D-60, D-63, D-85** Tasks are grouped by team; open work stays on top. A task's title comes from a free or cheapest model, never a paid plan.
- **D-81, D-90** Typed text is a draft that survives a restart and never brings No safety checks back without its warning. App-wide choices live on Settings; a task's own on its run card.
- **D-100 to D-109** The design audit rounds (2026-11-14): app tags, one status per screen, Providers and Usage, sidebar and Home, task page, Office and Team, the rest. Their specifics live in the code and What's new.
- **D-110** First run: two setup steps ending on a first task on the picked provider. A tutorial puts back what it replaced. Home shows one next step.
- **D-111** Settings, You and agent profiles (onboarding revamp round 2). Settings rows are label left, control right, saved at once and put back if refused, in this order: Appearance (System, Light, Dark; Interface size), Notifications (with a test), New tasks (the Permission default, stored in the core, read by solo, team, department and chief-plan starts; the composer's chip changes one task only), Accessibility, Desktop (close to tray or quit, open at login; kept by the shell), Storage and About. A Manual level the composer remembered before becomes the default once. Your profile splits how you appear from what agents read. Every agent editor (Profile, team member, template) shares one field set: Identity, Job, Runs on; Save only when changed.
- **D-112** One way to show the same thing (onboarding round 3). A department is made only through New department, and offered in one place: the empty Office's sample room. Home offers "Make this a department" only after a solo task finishes, with no department yet, drafting a team from that task. The chief is offered once a department exists. Providers are always "providers": with none ready, the composer says "No provider is ready yet." above the box, offers OpenCode's install and keeps Start off. The tutorial card sits beside its target (right, left, above, below), else in its corner.
- **D-113** Usage by provider (owner fix list, 2026-11-20). Usage is one card per provider, one row per account, its windows as columns shortest first; providers that share no limits get the same card with tokens counted here. Each provider links to its official usage page (`usagePage`). Search and Sort only past 4 accounts in a card. The limit warning is quiet, shows only at a limit or when the pace reaches it before the reset, and is dismissed until that window resets. Home shows the 4 most used accounts with the same window block. Providers lists signed-in first, then those to sign in in one card, then Get more. The Office side panel pushes in by its frame's width; the floor's size and scale follow the whole Office, panel included, so opening or closing it never lays the floor out again, and the open room or picked agent glides into view once the panel has settled. A press on a room sign sets no state until it drags. The panel's close button clears the pick. Every New task (button, Ctrl N, Ctrl K, a department's +, menu and panel) goes through `startNewTask`: it writes who does it into the box's draft, then fills the box in place on Home and New task or opens New task, so an open form follows the pick and keeps the text. Icon buttons with a fixed size set `padding: 0`, since the browser's 6px side padding pushed a wider icon off-centre.
- **D-114** Team and workspaces redesign (owner, 2026-11-21). An agent or department with nothing on is Idle (open dot, green), never "Free", which the model picker keeps for free models; lists of people show only Working, Needs you or Idle (`LiveState`), drawn by `StatePill` or `StateTag`. Lists of people and workspaces are rows on one column grid shared with their header. The department page has four tabs (People, Settings, Workspaces and apps, Files), one save bar shown only when something changed, and reopens on the saved team after Save. People is a list beside the picked member's panel, which drops below the list in a narrow space; the panel shows the D-111 fields without group headings. "Describe a change" edits a department in words. Page tabs share `PageTabs.module.css`.
