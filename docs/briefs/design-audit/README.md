# Design audit and revamp (2026-11-14): handover

Status: the owner approved the mockup and took every suggested pick below. Round 1 is built (D-103) on `fix/design-round-1`; rounds 2 to 7 are not. Delete this folder once the last round is merged; its decisions go to DECISIONS.md.

- Mockup and plan: https://claude.ai/artifact/B3LCNGtF35Z66FBkH6NqyN (tabs: Plan, Sidebar and Home, Task page and status, Office, Connectors, App page, Usage, Providers).
- Findings, with what the user sees, why it hurts, the fix and `file:line` evidence:
  - `findings-shell-nav-home.md` (a1: sidebar, Ctrl+K, Home, New task, Settings, Help, You, onboarding, page layout)
  - `findings-office-team-templates.md` (a2: floor, Board, side panel, Team, departments, chief, Templates)
  - `findings-tasks-taskpage-needsyou.md` (a3: Tasks, task page, Needs you, the full map of status words)
  - `findings-connectors.md` (a4)
  - `findings-providers-usage-workspaces.md` (a5: Providers, Usage, Workspaces, Library)
  - `research-reference-apps.md` (a6: squad.so, Codex, Claude, Muse, Grok Bot, Cursor, Copilot)
- Counts: 161 findings, 24 High, 88 Medium, 49 Low. Each file ends with Keep and Proposed shape.

## Rules for this work

Keep the Dusk colours, Plus Jakarta Sans, the sidebar and pages, and the Office floor. Only layout, wording and routes change. No slop: no explainer panels, reassurance lines, "…" endings, or hints that repeat a label. One name and one status per thing. Spacing from `ui/Page.module.css`. Follow the audit-phase way of working: understand each item, ask when unclear, fix without breaking, one sanity check, and update What's new.

## Decisions the owner must make first

1. The word for an agent that has finished and is free: "Free" (suggested, matches the sleeping desk) or "Idle". Agents never say "Done".
2. Rename the task status "Waiting" to "Queued", and give Failed and Stopped their own Board column (changes D-101).
3. Keep Usage as its own page with Providers for setup only (suggested), or make Usage a tab of Providers.
4. Connector permission per kind of action or per department (core change to D-67): now or a later round.
5. Templates how-it-works panel: keep, folded to one line once a template exists?
6. Department names must be unique?

Plus the open questions printed on each mockup tab (token count on desks, when idle rooms fold, Group by default on Connectors, "Mixed" permission on the app page, the Usage banner's move button, the name of a provider's own sign-in).

## Rounds

One branch and one PR per round, each cut from `main` after the previous PR merges (PR #88 on `fix/audit-round-1` must merge first). Finding ids point into the files above.

1. **Foundations and bugs.** One task status component (7 words: Needs you, Working, Queued, To review, Done, Failed, Stopped, one colour and icon each) and one agent word list (Working, Needs you, Free, Failed, Stopped). Delete the private status maps on Home, Chief, Workspaces and the chat headers (a3-1, a3-3, a3-4, a3-18, a2-12, a2-13, a1-3). Shared page header, three widths (760 forms, 1120 lists and Home, full for Office and the task page), one search box, one filter chip, one tab row in `ui/` (a1-5, a1-20, a5-23, a2-24). The 17 bugs in the Plan tab's table (a2-15, a1-2, a3-2, a2-3, a4-3, a4-6, a4-2, a4-17, a2-28, a2-16, a2-10, a5-9, a3-6, a3-9, a5-14, a5-30, a2-36, a1-32, a5-7). Start at `contract/task-status.ts`, `features/tasks/task-list.ts`, `TaskStatusIcon.tsx`, `features/work/delegation-status.ts`, `features/office/office-state.ts`.
2. **Connectors at scale.** Rows, tabs, filters, group by; Codex settings servers folded with clean names; "Add your own" first; department Apps section; app page with a row per provider (a4-1 to a4-21). `features/connectors/*`.
3. **Providers and Usage.** Providers for setup with account rows; Usage as one limits table sorted by what runs out first, banner only when needed, no tiles; accounts named by nickname or email plus plan; one limit line component; Add account direct; agents per account (a5-1 to a5-25). `features/providers/*`, `features/usage/*`.
4. **Sidebar, Home, composer, Ctrl+K.** Fixed top and footer, three nav groups, Needs you count, department rows with state and hover New task, no chief card; Home status line, Needs you, Working, To review first; no key hint row; menus that scroll and search; Ctrl+K reaches members, workspaces, apps (a1-1 to a1-31). `features/sidebar`, `home`, `new-task`, `command`.
5. **Tasks, task page, Needs you.** One header pill, agent words in people rows, one review bar on Work and Outputs, panels over the chat below 1100 px, tabs that match the statuses, Needs you with the same controls (a3-*).
6. **Office and Team.** Step always visible, floor follows the width, idle rooms fold, Find and Next, panel closed until a pick, no floating tiles, no "44k" or "LEAD 1", one route per department, unique names (a2-1 to a2-27, a2-38 to a2-40).
7. **Workspaces, Templates, Settings, Help, wording sweep** (a5-26 to a5-36, a2-29 to a2-37, a1-16 to a1-18, a1-24 to a1-28).

## How to look at the app

Browser mode on a copy of a data folder: `pnpm dev:web --data-folder <copy>` serves on 5173. The audit used the audit-round data; any copy with a few team tasks works. Screenshots: `out/capture` (off-screen Electron) with a script that clicks the sidebar by text. Each auditor had its own copy of `out/capture`, so several can run at once. Never press Start, Save, Connect or Sign in on a live data copy.
