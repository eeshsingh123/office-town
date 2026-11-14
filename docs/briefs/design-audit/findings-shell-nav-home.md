# Audit a1: app shell, navigation, Home, New task, Settings, Help, You, onboarding, shared UI

Method: read the code in `features/sidebar`, `command`, `home`, `new-task`, `settings`, `help`, `you`, `onboarding` and `ui/`; took 31 captures in `shots/a1/` (several are measurement runs whose numbers are quoted below) (dark, plus light for Home and New task; 1440x900, 1000x700 and the app's minimum window 960x600); measured page layout in the live DOM. Window minimum is 960x600 (`electron/window.ts:17`). Everything below is read-only; no data was changed. A line says "from code" when the state is not in the test data.

Capture names used below (all in `shots/a1/`): `home-dark`, `home-dark-mid`, `home-dark-bottom`, `home-light`, `newtask-dark`, `newtask-light`, `goes-menu`, `goes-menu-700`, `cmdk`, `cmdk-typed`, `plus-menu`, `ctx-dept`, `opts-popover`, `settings-dark`, `help-dark`, `you-dark`, `you-bottom`, `team-dark`, `tasks-dark`, `needs-dark`, `office-dark`, `home-1000`, `newtask-1000`, `home-960x600` (this one shows Tasks at 960x600), `rail` (taken mid-animation, so its width is not the final rail), `sidebar-20` (its extra rows were added in the DOM and removed again by the app before the image, so only its printed numbers count). `metrics`, `metrics2`, `btn-metrics` and `search-metrics` are measurement runs; their printed lines are quoted in the findings. Shots from the lead's folder (`providers`, `usage`, `templates`, `connectors`, `workspaces`) are in `shots/`.

---

## Click counts for the 10 most common jobs (sidebar start, 1440x900)

| Job | Clicks today | Route | Over 2? |
|---|---|---|---|
| Start a task for a department | 3 before typing (New task, "Assistant" chip, pick department), then Start | Right-click the department, "New task here" (2, hidden). The visible "Give it a goal" button in the Office drops the department (a1-8) | Yes |
| Find a running agent | 1 | Sidebar "Active" lists running tasks with the lead's name; Office floor is 1 click | No |
| Answer a needs-you ask | 2 | Needs you, then the answer button. Home banner "Open" is also 2 but lands on the Office panel | No |
| See an agent's current step | 0 for a solo agent (Active row says "step 3 of 5"); 2 for a team task (Active row shows only "Lead +1 . working", then Office, then the agent) | | Team tasks: yes (a1-22) |
| Check usage | 1 (Usage) or 0 (Home plan usage card) | | No |
| Connect an app | 3 to 4 (Connectors, Add app or a Suggested card, pick, Connect) | Ctrl+K has no "Add app" | Mostly inherent; shorter by 1 with a Ctrl+K entry (a1-7) |
| Change a member's model | 5 to 6 (Team, unfold department, member, model chip, pick, Save) or (department, desk, Profile tab, chip, pick, Save) | | Yes (a1-19) |
| Open a workspace's files | 3 (Workspaces, the card's "Open", "Open folder") | | Yes (a1-19) |
| See what's new | 1 (Help), but the card sits under the five tutorials; not in Ctrl+K | | No |
| Change theme | 2 (Settings, Light or Dark) | | No |

---

## Findings

### a1-1. The sidebar footer (Settings, Help, You) falls off the screen as soon as the team grows
- Where: Sidebar, whole column
- Category: scalability
- Severity: High
- What the user sees: Nav, "Add a chief" card, the department list and the Active tasks all sit in one column that scrolls as a whole. Settings, Help and the profile row are at the end of that column. At the smallest allowed window (960x600) the list already ends after one department row and the footer is out of view (`home-960x600`). At 1440x900 with 20 departments the column is 1117px tall in an 835px space, so the footer is 282px below the fold (measured). The collapsed rail hides the department list and Active tasks completely (`rail`).
- Why it hurts: Settings, Help and the profile are the only routes to Help, theme and profile; hiding them behind a scroll in a column of repeated "Smoke claude" rows is hard to find. The department list has no search and no cap, so it does not scale to 20.
- Fix: Make the sidebar three zones: fixed top (New task, Search, nav), a middle zone that is the only part that scrolls (departments, Active), fixed footer (Settings, Help, You). Cap "Active" at 5 with an "All N" link to Tasks. Show a small search field in the middle zone when there are more than 8 departments. Reuse the existing `.sidebar` flex column; give the middle `flex: 1; overflow-y: auto`.
- Evidence: `features/sidebar/Sidebar.module.css:19-31` (`overflow: hidden auto` on the whole column), `:311-317` (`.footer` only `margin-top: auto`), `Sidebar.tsx:240-252`; shots `home-960x600`, `sidebar-20` (numbers from the script).

### a1-2. The "who does it" menu on the composer runs off the bottom of the window and cannot scroll
- Where: New task and Home composer, "Assistant" chip menu
- Category: UI bug
- Severity: High
- What the user sees: With only 6 departments in a 1000x700 window the menu is cut off at "A new department". "Chief" and "+ New department" at the bottom cannot be reached by mouse (`goes-menu-700`). At 1440x900 the 6 departments fill 500px (`goes-menu`). With 20 departments the list is about 1,100px long on any screen. The menu has no search.
- Why it hurts: This is the main control that picks who does the task. It breaks at a normal laptop window and at ordinary team sizes. (Typing `@` works because it filters, but a user who clicks cannot.)
- Fix: Give this menu a max height of the available space with its own scrollbar (as `ModelChip`'s popover already does with `--radix-popover-content-available-height`), and a search field at the top once there are more than 6 departments. Keep "An assistant" first and the user's current pick first.
- Evidence: `features/new-task/Composer.module.css:226-229` (`.menu` has width only), `Menu.module.css:25-35` (`.surface` has no max-height), `GoesToChip.tsx:86-110`; shots `goes-menu`, `goes-menu-700`.

### a1-3. Home says the same tasks are "Done" while Tasks and the tile say "To review"
- Where: Home, "Recent tasks" and "Right now"
- Category: inconsistency
- Severity: High
- What the user sees: The tile says "5 to review". Directly below, all 6 recent tasks show a green tick and "Done" (`home-dark-bottom`). On the Tasks page the same tasks are 5 "To review" and 1 "Done" (`tasks-dark`).
- Why it hurts: One status has two names and two icons on the first screen. It is also the owner's decision (D-101: one task status everywhere; Home's count already follows it). The "to review" tasks are the ones the user must act on, and Home hides that.
- Fix: Read the status from `taskStatus` (as `use-counts.ts` and Tasks already do) and draw it with the same icon and word as Tasks; reuse the Tasks row status component instead of `STATE_LABELS`.
- Evidence: `features/home/HomeView.tsx:277,291` (`taskStateOf` and `STATE_LABELS`), `features/office/use-counts.ts:40` (uses `statusOfTask`); shots `home-dark-bottom`, `tasks-dark`.

### a1-4. A returning user must scroll past setup content to reach their recent tasks
- Where: Home
- Category: bad pattern
- Severity: High
- What the user sees: Order is greeting, status line, composer, "Right now" tiles, "Getting started" (5 tutorials, 330px tall), "Plan usage", then "Your team" and "Recent tasks". Recent tasks start about 1,290px down a 1,805px page (`home-dark-mid`, `home-dark-bottom`). "Getting started" stays until all 5 tutorials are done or the user finds the small "Hide" (its text sits 5px lower than the card title, `home-dark`). Someone who never connects an app (step 5) sees it for good. The "Your team" card lists every department and every solo agent with no cap (from code); 20 departments make it 1,200px tall next to a 6-row Recent list.
- Why it hurts: Home is the first screen. What a returning user needs (what needs me, what is waiting for review, what is running, what I ran lately) is the lowest content on it, and the top is spent on the user's first week.
- Fix: Order: composer, Needs you block (already there when above 0), To review and running tasks (3 rows each, "All N" to Tasks), Recent tasks, Your team (6 rows, "All N" to Team), Plan usage, and last "Getting started" collapsed to one line "Getting started . 2 of 5" that unfolds. Reuse `.card`; reuse the Waiting block's row style.
- Evidence: `features/home/HomeView.tsx:473-495` (order), `:213-245` (no cap on departments or solo agents), `:405-454`; `Home.module.css:214-219` (`cardHead` aligns start; the 36px button sits lower than the 16px title).

### a1-5. Every page has its own left edge, header and spacing, so the title jumps on every click
- Where: All pages
- Category: inconsistency
- Severity: High
- What the user sees: Measured at 1440x900, the left edge of the page title is x = 305 (Home), 405 (Team), 282 (Needs you), 276 (Tasks, Templates, Workspaces, Usage), 382 (Providers), 375 (Connectors), 345 (New task), 435 (You, Help), 442 (Settings). Title weight is 600 on Home, Settings and Help and 700 on the others. The main button sits at y = 48 on Tasks, Templates, Workspaces, Usage; y = 50 on Help; y = 67 on Connectors; y = 79 on Team (below the title). Its right edge is at x = 1353, 1255, 1225 or 1195 depending on the page (`metrics`, `btn-metrics`, `team-dark`, `connectors`). Page padding is 48/48/64 on Home, Settings and Help and 48/56/72 elsewhere. Gaps between sections are 44 (Home), 40 (Team, Usage, Providers, Connectors), 32 (Needs you), 28 (Tasks, Templates, Workspaces), 24 (Settings, Help). The rule is 40.
- Why it hurts: The page frame moves with each click, the main button is not where it was, and "breathable spacing" is applied differently on each page. Each page copies its own header and column CSS (25 `h1`s in the code, three page frames: `Page`, `CardPage` and Home's own, and about 14 page-local column rules).
- Fix: One `PageHeader` component (title 28/700, optional one-line subtitle, actions slot top-right, never wrapping) and one page frame with three column tiers kept in `Page.module.css`: narrow 760 (Settings, Help, You), standard 1120 (every list page, Home), full (Office). Pages in a tier share one left edge. Put padding 48/56, section gap 40 and panel padding 24/28 into `tokens.css` and delete the local copies. Move Settings and Help from `CardPage.module.css` to `Page.module.css` and delete `CardPage.module.css`.
- Evidence: `ui/Page.module.css:6,16`, `ui/CardPage.module.css:1-45`, `home/Home.module.css:1-22,109-114`, `needs-you/NeedsYouView.module.css:9-10`, `tasks/TasksView.module.css:9`, `team/Team.module.css:6`, `connectors/Connectors.module.css:6`, `providers/Providers.module.css:6`; shots `metrics`, `btn-metrics` log lines in `capture-a1/capture.log`.

### a1-6. "Add a chief" is pitched in at least eight places, with four different verbs, and the sidebar card cannot be closed
- Where: Sidebar, Home, Team, Ctrl+K, composer, onboarding
- Category: duplication
- Severity: High
- What the user sees: Sidebar card "Add a chief / Set up a chief" (135px tall, always there until a chief exists), the sidebar "+" menu "Add a chief", Home "Getting started" step 3 "Create a chief and give it a goal", Home "Your team" row "Chief . SET UP", Home "Build your team" choice "Set up a chief" (when there is no team), the Team page "No chief . Add a chief", Ctrl+K "Set up your chief", the composer menu "Chief . Not set up yet" and the composer message "Set up your chief first", and Help and Setup tutorials. The verbs are Add, Set up, Set up your, Create (`home-dark`, `plus-menu`, `team-dark`, `goes-menu`).
- Why it hurts: One optional feature takes the most contested space in the sidebar for good, and reads as a nag. One name per thing is broken: "Add a chief" and "Set up a chief" sit in the same card.
- Fix: One name and verb everywhere: "Add a chief". Keep exactly three entry points: the Team page row, the "+" menu item in the sidebar, and the composer's "who" menu. Delete the sidebar card, Home's Team-card row and the Home Build-your-team choice (keep the describe box). If the owner wants the card, give it a close button that remembers.
- Evidence: `features/sidebar/Departments.tsx:44-66,90-100`, `features/home/HomeView.tsx:196-203,369-383`, `features/team/TeamView.tsx:213-232`, `features/command/CommandMenu.tsx:192`, `features/new-task/Composer.tsx:231`, `features/onboarding/tutorials.ts`.

### a1-7. The Ctrl+K menu opens on a long list of pages the sidebar already shows, and cannot reach what people look for
- Where: Command menu
- Category: bad pattern
- Severity: Medium
- What the user sees: Opening it lists Create (2), Go to (13), Learn (5 "Tutorial: ..." and Help), Departments (6 rows, all "Smoke claude"), Connectors, then "Recent tasks" last. The visible part is 14 rows, so Recent tasks need a scroll (`cmdk`). It cannot find a member by name (only tasks that mention an agent), a workspace, a template, a provider, a Needs-you request, "Add app", "What's new" or the theme. Typing a sentence shows one row "Start a task: ..." (works well, `cmdk-typed`).
- Why it hurts: The menu is a second sidebar. The shortcut people press it for (open the thing I used last, reach something deep) is the part it does worst. "Add app" and "open a workspace's folder" are 3 clicks away and not in the menu.
- Fix: Open on "Recent tasks" (8), then "Create", then "Go to". Show "Tutorial: ..." rows only when the text matches "tutorial" or "help"; otherwise one "Help". Add members (go to their desk in the Office), workspaces, templates, providers, and the actions "Add app", "What's new", "Switch theme". Reuse the existing `Row`.
- Evidence: `features/command/CommandMenu.tsx:153-270` (group order), `:197-216` (5 tutorials); shots `cmdk`, `cmdk-typed`.

### a1-8. A department's own "Give it a goal" button forgets the department, and "New task here" exists only on right-click
- Where: Office room panel, sidebar department rows
- Category: too many steps
- Severity: High
- What the user sees: Selecting a department in the Office shows "Give it a goal". It opens New task with whoever was used last (often "Assistant"), so the user must pick the department again in the chip. The correct hand-over (`who: "team"` with the department) exists only in the right-click menu on a sidebar department row (`ctx-dept`). That row has no "..." button, so nothing says the menu exists.
- Why it hurts: "Start a task for a department" is the product's main job and takes 3 clicks before typing. The visible button even sends the task to the wrong target if the user does not look at the chip.
- Fix: Make the button send `navigate({ name: "new-task", who: "team", departmentId })`. Add a hover "New task" icon on each sidebar department row (one click, and the same action as the menu item), and a "New task" button on each Team page department card.
- Evidence: `features/departments/DepartmentPanel.tsx:302-310` (no `who`), `features/departments/department-menu.tsx:33-37` (has it), `features/sidebar/Departments.tsx:146-162` (menu only), `features/new-task/Composer.tsx:70-77` (reads `who` and cites this button).

### a1-9. Ten flat sidebar items: pages that belong together are apart, and the urgent one is fourth
- Where: Sidebar nav
- Category: bad pattern
- Severity: Medium
- What the user sees: Home, Office, Team, Needs you, Tasks, Templates, Workspaces, Providers, Connectors, Usage, in one block with no groups, then a small label "Your team" with the department list (`home-dark`).
- Why it hurts: "Needs you" (the amber badge) is under Office and Team. "Team" and "Your team" are two things that mean the same, one line apart. "Providers" and "Usage" both list the providers' accounts (Providers shows the weekly bar per provider; Usage shows the same per account, with "Manage accounts"). Templates, Workspaces, Providers and Connectors are setup pages used rarely, yet they sit at the same weight as Tasks.
- Fix: Order: Home, Needs you, Tasks, Office. Then a divider and the setup pages: Workspaces, Templates, Providers (Usage becomes its second tab, and the red usage dot moves to Providers), Connectors. Make the "Your team" label the Team page link (rename it "Team", keep the "+"), which removes one row. Ctrl+K keeps "Usage". This drops the Usage and Team nav rows; both stay reachable as stated.
- Evidence: `features/sidebar/Sidebar.tsx:230-239`, `Departments.tsx:123-126`; shots `providers` and `usage` in `shots/`.

### a1-10. The app name is cut to "Offic..." because back and forward sit in the brand row
- Where: Sidebar top
- Category: UI bug
- Severity: Medium
- What the user sees: Logo, "Offic...", back, forward, collapse (`home-dark`). With a sidebar scrollbar (short window) it is "O..." (`home-1000`). Back and forward sit in three places: sidebar header, a thin row above the page when the sidebar is collapsed, and the Office top bar.
- Why it hurts: The product name is clipped on every screen; three places for one control.
- Fix: Brand row is logo, "Office Town" and the collapse button. Put back and forward in the thin row that already exists for the collapsed sidebar (`HistoryRow`) and show it in the same place on every page, Office included. Drop the Office top-bar copy.
- Evidence: `features/sidebar/Sidebar.tsx:194-212`, `HistoryButtons.tsx:113-124`, `features/office/TopBar.tsx:40`; 24+9+9+52+9+26=129px fixed leaves 51px for the name in a 180px row.

### a1-11. Sidebar departments are only grey dots and names: no colour, no selected state, no "needs you", a bare number
- Where: Sidebar, "Your team"
- Category: readability
- Severity: Medium
- What the user sees: Six rows "Smoke claude", each a 7px dot and a grey "2" at the right (`home-dark`). The dot is grey when idle and slate blue when at work, which are close. The right number is the member count, with its word hidden. A department the user is looking at in the Office is not highlighted (the chief row is). A department waiting on the user shows nothing (only the global badge). The chief spins while working; departments do not.
- Why it hurts: Elsewhere a department is a coloured avatar (Team, Tasks, the context menu header). Here two similar names cannot be told apart, the state "blocked on you" is not shown per department (a product principle), and a bare grey number reads like a count of waiting items next to the amber Needs you badge.
- Fix: Use the same coloured `Avatar` (the lead's colour, 18px) as Tasks and the menu header instead of the dot. Show a small amber dot when the department's task is waiting on the user, and the same spinner as the chief while working. Set `aria-current` on the open department. Replace the member count with nothing (it lives on Team).
- Evidence: `features/sidebar/Departments.tsx:115-120,141-164` (no current, working only), `:11-41` (chief has both); `features/departments/department-menu.tsx:73-77` (avatar in menu); shots `home-dark`, `ctx-dept`.

### a1-12. "Right now" shows the same counts four times on Home, and "working" means agents here and tasks on Tasks
- Where: Home
- Category: duplication
- Severity: Medium
- What the user sees: "No agents are working." under the title, a "Needs you" banner when above 0, four 92px tiles (0, 0, 0, 5), and "Your team" rows with status, all for the same numbers (`home-dark`). The same state is worded "No agents are working." (Home), "Nothing running." (Tasks), "No agent is waiting for you." (Needs you), "need you" (tile), "Needs you" (nav, Tasks), "N waiting for you" (summary), "N requests need you" (banner). "Working" on Home counts agents (a team of 3 working reads 3); the Tasks "Working" tab counts tasks (reads 1).
- Why it hurts: Three tiles at 0 take a whole row for no information. One word, two numbers.
- Fix: Drop the tiles. Make the subtitle the only status line: "2 working . 1 needs you . 5 to review", each part a link, zero parts hidden. Count tasks, not agents, so Home and Tasks agree. One wording for the zero state.
- Evidence: `features/home/HomeView.tsx:52-80,464-472`, `features/office/use-counts.ts:22-25` (counts agents) vs `features/tasks/TasksView.tsx` tab counts.

### a1-13. Under the composer, a row of seven key hints repeats the placeholder and the Start button
- Where: Home and New task composer
- Category: slop
- Severity: Medium
- What the user sees: Placeholder "Describe the task. Type @ to choose who does it or tag an app, / to use a template." Below the box: "@ who or app . # Library file . / template . Enter start . Shift Enter new line" with seven boxed keys (`home-dark`, `newtask-dark`). In the same row, on the left, the plan note ("You approve the plan before any work starts.") or the warning share the line, so at 1000px the row wraps (`home-1000`).
- Why it hurts: Two lines say the same thing about `@` and `/`; "Enter start" restates the Start button; "Shift Enter" is a convention. The row is always on, so after the first week it is noise next to the one line that matters (the warning or note).
- Fix: Delete the key row. Make the placeholder one short line: "Describe the task. @ picks who or an app, # a Library file, / a template." Put "Enter starts, Shift+Enter adds a line" in the Start button's tooltip. Add a "Keyboard shortcuts" card to Help (Ctrl N, Ctrl K, Ctrl B, Alt arrows, F1). Keep the left-hand note and warning, which carry information.
- Evidence: `features/new-task/Composer.tsx:536,679-700`; shots `home-dark`, `home-1000`.

### a1-14. The "Efficient & Milestones" chip never says they are off, and its notes repeat Settings
- Where: Composer chips, Options popover, Settings
- Category: readability
- Severity: Medium
- What the user sees: Both off (the default) the chip reads "Efficient & Milestones", which looks like both are on. On reads "Efficient & Milestones on" (`home-dark`). Its popover ends with "Starts from your defaults in Settings. A change here is for this task only." (`opts-popover`), and Settings ends its card with "A new task starts with these. You can change them for one task as you start it, or on its run card while it runs." (`settings-dark`). The chip is 170px wide, the widest on the line, for two options most tasks leave off.
- Why it hurts: State is not readable at a glance. The two notes explain where a switch applies, which the labels already imply.
- Fix: Say the state in the chip: "Efficient & Milestones: off" in the muted tone when both are off, and name only what is on when one is ("Efficient on"). Delete both notes. (The owner already moved the chip off a bare "Options"; this keeps the names.)
- Evidence: `features/new-task/OptionsChip.tsx:16-22,49-51`, `features/settings/SettingsView.tsx:30-33`.

### a1-15. Home and New task are one box on two screens, so the big "New task" button on Home goes to a near copy of where you are
- Where: Home, New task, sidebar
- Category: duplication
- Severity: Medium
- What the user sees: Home has the composer under the greeting. The primary sidebar button "New task" (and Ctrl N) opens "What do you need done?" with the same composer plus six sample-prompt cards (`newtask-dark`). They share one component and one draft, so the only differences are 2 rows against 3, autofocus, and the cards.
- Why it hurts: From Home the button appears to do nothing new. A user on Home types in either and may not know which to use.
- Fix: When the view is Home, "New task" and Ctrl N focus the Home composer (no navigation). From other pages keep the New task page, which is the one D-38 asks for. (If the owner prefers one screen: New task goes to Home with the box focused and the sample cards shown there until the first task; that would change D-38/D-58, so it is the owner's call.)
- Evidence: `features/sidebar/Sidebar.tsx:213-222`, `features/new-task/Composer.tsx:524,538,706`, `features/new-task/NewTaskView.tsx`.

### a1-16. Settings uses three different controls for on and off, and splits one idea into two cards
- Where: Settings (and the Options popover, You)
- Category: inconsistency
- Severity: Medium
- What the user sees: "New tasks" has switches at the right end of each row. "Display" has native checkboxes ("Higher contrast", "Less motion", "Read out new requests with a screen reader"). The profile page's Notifications has switches at the left start, with the label to their right (`settings-dark`, `you-bottom`). "Appearance" (Theme) and "Display" (Text size, contrast, motion) are two cards about how the app looks; Theme is two pills, Text size three pills.
- Why it hurts: Same job, three looks and two alignments.
- Fix: Use `SwitchRow` for every on and off (it is in `ui/Switch.tsx`); delete the local `NotifySwitch` in `YouView.tsx` and the checkboxes. Merge Appearance and Display into one "Appearance" card: Theme, Text size, then the three switches. Keep the pills for Theme and Text size (they pick one of several).
- Evidence: `features/settings/SettingsView.tsx:42-68,70-117` (checkbox at `:100`), `features/you/YouView.tsx:14-37`, `ui/Switch.tsx:25-35`.

### a1-17. Notifications live in the profile, and the profile saves differently from Settings
- Where: You (profile), Settings
- Category: inconsistency
- Severity: Medium
- What the user sees: The profile subtitle says "Every agent reads this before it starts a task", but its third card, Notifications, is an app preference that no agent reads. Settings changes apply at once; the profile needs the Save button at the bottom (always enabled, `you-bottom`). A moved or half-edited profile is held as a draft; a switch in Settings is not. The page header also differs from Settings and Help (subtitle and `Page` styles, against a bare `CardPage` title).
- Why it hurts: D-90 says app-wide choices live on Settings. A user looking for notifications will look there; one who toggles it on the profile and leaves has not saved it.
- Fix: Move the Notifications card to Settings (as switches, saved at once). The profile keeps name, colour, about and answer style with its Save. Disable Save until something has changed.
- Evidence: `features/you/YouView.tsx:155-174` (Notifications), `:178-183` (Save), `docs/DECISIONS.md` D-90.

### a1-18. The five tutorials are listed in four places in three layouts, and Help does not show which are done
- Where: Home "Getting started", Help "Tutorials", Setup "You're ready", Ctrl+K "Learn"
- Category: duplication
- Severity: Medium
- What the user sees: Home draws them as numbered steps with green ticks. Help draws the same titles and summaries as plain rows with "Start" and no done state (`help-dark`). The last Setup step draws them as bordered cards. Ctrl+K lists them as "Tutorial: ...". On Home the composer's "Start" and three tutorial "Start" buttons share a screen.
- Why it hurts: One list, four looks. A user who finished a tutorial sees it done in one place and offered again in another. Two different actions share a label.
- Fix: One `TutorialList` component with the Home look (tick when done), used by Home, Help and Setup. Tutorial buttons say "Start tutorial" or "Show me", not "Start". Ctrl+K: a single "Tutorials" entry to Help.
- Evidence: `features/home/HomeView.tsx:405-454`, `features/help/HelpView.tsx:15-45`, `features/onboarding/SetupView.tsx:236-262`, `features/command/CommandMenu.tsx:197-209`.

### a1-19. Changing a member's model takes 5 to 6 clicks; opening a workspace's folder takes 3
- Where: Team, Office, Workspaces
- Category: too many steps
- Severity: Medium
- What the user sees: Model change: Team, unfold the department (folded by default past 4 departments), click the member, click the model chip, pick, Save. A workspace's "Open" button on its card opens the workspace page; "Open folder" is a button one level down. The "..." menu on the card has no folder action.
- Why it hurts: Both are common jobs, and the model is already shown on each Team row, as plain text that does nothing.
- Fix: On a Team person row, make the model a `ModelChip` that saves in place (as the run card does for a running task): 3 clicks. Add "Open folder" to the workspace card's `MoreMenu` and a Ctrl+K entry "Workspace: name": 2 clicks.
- Evidence: `features/team/TeamView.tsx:45-69`, `features/team/team-folds.ts:4-14`, `features/office/AgentProfile.tsx:190-194`, `features/workspaces/WorkspaceView.tsx:84`.

### a1-20. Search boxes are built ten times with four heights and six widths
- Where: Tasks, Team, Templates, Workspaces, Connectors, Usage (and Library, Board, Needs you, member editor)
- Category: inconsistency
- Severity: Medium
- What the user sees: Measured heights are 36 (Tasks, Usage), 38 (Workspaces), 40 (Connectors) and 42 (Team, Templates); widths 412, 420, 380, 360, 211 and 841. Filters come in four patterns: underlined tabs with counts (Tasks), "Label Value" dropdowns (Tasks, Usage), pill chips (Workspaces, Templates), and a native-looking `<select>` for Sort (Templates, Needs you, connector asks). Connectors puts search in the header, other pages put it under it (`tasks-dark`, `team-dark`, `templates`, `workspaces`, `connectors`, `usage`).
- Why it hurts: The same component looks different on each page; there is no shared one to fix them together. Any list that can grow has to copy the whole CSS again.
- Fix: One `SearchBox` (40px high, full width of its column up to 420) and one `FilterMenu` (the "Label Value" dropdown) in `ui/`; pages choose where to put them, not how they look. Use pills only for a short fixed set (up to four).
- Evidence: `search` rule in 10 module files (`team/Team.module.css:18-30`, `tasks/TasksView.module.css:115-130`, `usage/Usage.module.css:113-128`, ...); measured with `search-metrics` capture.

### a1-21. Home's Recent tasks show a clock time without a date
- Where: Home, Recent tasks
- Category: inconsistency
- Severity: Medium
- What the user sees: "Smoke claude . 08:44 PM . Done". The same tasks on Tasks read "17 h ago" (`home-dark-bottom`, `tasks-dark`).
- Why it hurts: A task from last month reads exactly like one from today. Two time formats for the same fact.
- Fix: Use `ago()` as Tasks does.
- Evidence: `features/home/HomeView.tsx:290`, `ui/format.ts:70-72` (`clockTime` has no date), `ui/format.ts:58-68` (`ago`).

### a1-22. The "Active" list shows a step only for solo agents; a team task reads "Lead +1 . working"
- Where: Sidebar, "Active"
- Category: readability
- Severity: Low
- What the user sees: Solo task: "Quinn . step 3 of 5" (from code). Team task: "Quinn +1 . working", with no step.
- Why it hurts: The product principle is that the current step is always visible; for departments, the main case, the sidebar says only "working".
- Fix: For a team task show the lead's step (same `progressOf` call, same line).
- Evidence: `features/sidebar/RunningAgents.tsx:31-37` (`others.length === 0` only).

### a1-23. The composer shows "Choose a workspace" and "Default model" for a moment at start-up
- Where: Home composer on launch
- Category: UI bug
- Severity: Low
- What the user sees: Right after launch the chip reads "Choose a workspace", the model chip reads "Default model" and an amber "Choose a workspace." sits under the box, then they fill in (`home-1000` was caught in this state; `home-dark` a moment later shows "Scratch" and "Opus 5.5").
- Why it hurts: A false warning for a user who has done nothing wrong.
- Fix: Treat "workspaces not loaded" as loading: show the last known chip text, no warning.
- Evidence: `features/new-task/Composer.tsx:155` (`?? []`), `:228-242` (`missing` while undefined).

### a1-24. Slop in Home and the sidebar: random greetings, captions that restate labels
- Where: Home greeting, sidebar "You / Your profile", "Add a chief" card text, "+" menu hints
- Category: slop
- Severity: Low
- What the user sees: One in twelve greetings is a joke: "No meetings today", "The office is open", "Working the weekend?", "Still up?". The profile row reads "You" over "Your profile". The "Add a chief" card says "Give it one goal and it splits the work across your departments." The "+" menu says "New department / A lead and its people" and "Add a chief / Plans goals across departments". Home "Your team" repeats "Open Team" and "Templates" buttons that are in the sidebar.
- Why it hurts: Each is a caption that repeats its label or a decorative extra. The greeting is also the page's `h1`, so it changes the page title.
- Fix: "Good morning, Name" only. The profile row shows the name (or "You") with no caption. Remove the "+" menu hints and the Home "Open Team / Templates" buttons.
- Evidence: `features/home/greeting.ts:9-15`, `features/sidebar/Sidebar.tsx:174-177`, `Departments.tsx:57-59,86-89,96-99`, `features/home/HomeView.tsx:247-260`.

### a1-25. Loading and busy text ending in "..." in about 30 places
- Where: Setup, Providers, Templates, Workspaces, Outputs, buttons
- Category: slop
- Severity: Low
- What the user sees: "Checking this computer...", "Loading templates...", "Reading the models...", "Reading the outputs...", "Opening the site...", "Waiting for the sign-in in your browser...", and "Saving...", "Starting...", "Creating..." on buttons.
- Why it hurts: The brief calls sentences ending in "..." slop, and the app dropped trailing dots from menus (D-101). Several are status text that says nothing the spinner or the disabled button does not.
- Fix: Button busy states: keep the label and disable it, with the app's `spin` icon. Loading text: skeleton or nothing under 300ms; keep "Checking..." only where the wait is long and name what it waits for.
- Evidence: `ui/ConfirmDialog.tsx:94`, `features/onboarding/SetupView.tsx:114`, `features/providers/ProvidersView.tsx:100,157`, `features/new-task/ModelChip.tsx:146,169`, `features/new-task/Composer.tsx:674` (50 matches of the ellipsis character in `features` and `ui`).

### a1-26. Amber is used for things that are not "needs you"
- Where: Tutorial card, composer message
- Category: inconsistency
- Severity: Low
- What the user sees: The tutorial card's note "Runs on X, a free model. Its answers can be weaker than a paid model's." is on an amber panel. The composer's "Choose a workspace." text is amber. (Amber from 70% usage is the owner's rule, D-61, and Connectors' "needs renewing" is a sign-in need, so those stay.)
- Why it hurts: Amber is meant to mean "a person must act". A note about model quality or a form hint dilutes it.
- Fix: Use `--text-2` (quiet) for the tutorial note, and keep the composer message in the normal text colour with the field outlined, amber only if it blocks Start. Keep `--warn` for needs-you, usage and sign-in.
- Evidence: `features/onboarding/Tutorial.module.css:42-50`, `features/new-task/Composer.module.css:196-198`.

### a1-27. Setup is tighter than the spacing rule and the profile of other pages
- Where: First-run setup
- Category: inconsistency
- Severity: Low
- What the user sees: Page padding is 40px 24px. Step cards use 12px gaps and 16px 18px padding (`.ways`, `.tutorials`, `.way`), against the 20px+ rule for card grids and 24px 28px panels (code only; setup shows only on first run or after "Run setup again", which was not pressed).
- Why it hurts: The first screen a new user sees is the most cramped in the app.
- Fix: Use the page tokens from a1-5: gaps 20, panel padding 24/28, page padding 48/56.
- Evidence: `features/onboarding/Setup.module.css:1-9,78-88,121-141`.

### a1-28. Text below 12px is used for statuses, hints and kbd labels
- Where: Chips, sidebar labels, menu descriptions, kbd
- Category: readability
- Severity: Low
- What the user sees: `10.5px` uppercase chips ("SET UP"), kbd labels, `11.5px` in menu descriptions, "Your team" label, Active meta lines, in `--text-3` grey. The token file defines 7 sizes; the CSS uses 16 different font sizes (10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 18, 20, 22, 28) and radii of 6, 7, 9, 10 next to the two tokens (counts from a grep: 218 `--size-meta`, 89 `--size-small`, but 21 literal 12.5px, 15 literal 10.5px, 13 literal 13.5px; 35 literal 10px and 27 literal 6px radii).
- Why it hurts: Small grey text is hard to read at 100% and the sizes drift page by page.
- Fix: Raise 10.5 and 11 to `--size-small` (11.5) and use 12.5 for anything the user must read. Add a `--size-label` token for the uppercase chip and replace the literals; do the same for radii (`--radius-chip: 999px`, `--radius-small: 6px`).
- Evidence: `styles/tokens.css:42-48,56-57`; grep counts over `**/*.css`.

### a1-29. Default scrollbars with arrow buttons take 15px in the sidebar and the page
- Where: Sidebar and every scrolling page
- Category: UI bug
- Severity: Low
- What the user sees: Classic Windows scrollbars with up and down arrows in the sidebar and in the main area, in a design with soft cards (`home-1000`, `home-960x600`). When the sidebar scrolls, its scrollbar narrows the brand row further.
- Why it hurts: They look heavier than everything else, and they take width from the sidebar.
- Fix: One slim themed scrollbar rule in `global.css` (thin, `--border-strong` thumb, no arrows), same for sidebar and pages.
- Evidence: `styles/global.css` (no scrollbar rules), `Sidebar.module.css:19-31`.

### a1-30. One department, three destinations
- Where: Sidebar, Home, Ctrl+K, Team
- Category: inconsistency
- Severity: Low
- What the user sees: Clicking a department opens the Office room from the sidebar, from Home's Team card and from Ctrl+K. On the Team page the same card opens the department's settings, with a separate "Open in office" button. The right-click menu calls the first action "Open".
- Why it hurts: The same name leads to different pages with no label to say which.
- Fix: Keep the sidebar, Home and Ctrl+K as they are (a room, "Open"). On the Team page rename the card's click target hint to "Settings" with a visible "Settings" button, and keep "Open in office". No change to routes.
- Evidence: `features/sidebar/Departments.tsx:150`, `features/home/HomeView.tsx:229`, `features/team/TeamView.tsx:105-120`, `features/departments/department-menu.tsx:32-44`.

### a1-31. The composer chips "Auto" and "Assistant" have no visible label or tooltip
- Where: Composer chips
- Category: readability
- Severity: Low
- What the user sees: "Auto" with a shield icon and a caret. The words "Permissions" and "Goes to" exist only as screen-reader labels. In the menus the first row says "An assistant" while the chip says "Assistant".
- Why it hurts: A new user does not know what "Auto" is until they open it; one name differs by one article.
- Fix: Add a tooltip (title) "Permissions" and "Who does it". Use "Assistant" in both places.
- Evidence: `features/new-task/AskChip.tsx:34`, `GoesToChip.tsx:57,69`, `Composer.tsx:471-473`.

### a1-32. "Run setup again" replaces the whole app with no confirmation
- Where: Help header
- Category: bad pattern
- Severity: Low
- What the user sees: One click on "Run setup again" (top right of Help) swaps the app for the full-screen first-run wizard (from code; not pressed). Its first step has "Skip setup", which also records "what's new" as seen.
- Why it hurts: It is a destructive-looking button in the place where the page's main action sits, for a rare job.
- Fix: Move it to the bottom of the Tutorials card as a ghost "Run setup again", and let "Skip setup" return to where the user was without touching "what's new".
- Evidence: `features/help/HelpView.tsx:91`, `features/onboarding/SetupView.tsx:40-47,377`.

---

## Cross-area notes
- Office: the floor's "Chief's office" and "New department" placeholder tiles overlap the bottom-right room's "Last goal" line at 1440x900 (`office-dark`). The Office has no page title, unlike every other page.
- Office room panel "Give it a goal" drops the department (included above as a1-8).
- Templates: "How templates work" is a three-step illustrated explainer panel (slop), and the empty state shows two primary buttons for the same action ("New template" and "Make your first template", `templates`).
- Connectors: cards named with internal ids, "codex_app", "cua_repl", "node_repl" (`connectors`).- Workspaces: six cards all named "Smoke" with the same path, so they cannot be told apart; the card's "Open" opens the page, not the folder (`workspaces`).
- Tasks: at 960px wide the tab "Failed or stopped" is cut to "Failed c" and the storage size crowds it (`home-960x600`). Tasks subtitle says "Nothing running." while Home says "No agents are working."
- Providers and Usage list the same accounts twice with different layouts (a1-9 proposes merging them; the Usage page owner should confirm).
- Team page: the page's main button sits below the subtitle (y=79) while all others sit at y=48.

## Keep
- One `Composer` for Home and New task, with remembered chips and one shared draft. It keeps tasks to "type and Enter".
- Needs-you amber badge on the nav, and the Home banner that lists the three longest waiting with "See all". Amber stays rare.
- Ctrl+K's last row "Start a task: ..." and the core-side task search; it makes the menu worth opening.
- Collapse-to-rail with tooltips and Ctrl+B; breadcrumbs on detail pages; `MoreMenu` and the right-click menu sharing one action list (D-89).
- Settings being short and quiet, with Theme moved there (D-102); the Setup wizard's four steps with a skip on every step.

## Proposed shape
- **Sidebar.** Brand row: logo, "Office Town", collapse. Fixed top: New task, Search, Home, Needs you [amber count], Tasks, Office. A divider, then Workspaces, Templates, Providers [red dot, includes Usage as a second tab], Connectors [amber dot]. Middle (the only scrolling zone): "Team" header that opens the Team page with a "+" menu (New department, Add a chief while there is none); department rows with the lead's coloured avatar, a spinner while working, an amber dot while waiting on the user, a selected state, a hover "New task" icon, a search field past 8 departments; the chief row if one exists; "Active" capped at 5 with "All N" and a step line for team tasks too. Fixed footer: Settings, Help, You (name only). The "Add a chief" card is gone (or closable).
- **Back and forward.** One thin row above every page, Office included. The brand row no longer truncates.
- **Page frame.** One `PageHeader` and three widths (760 forms, 1120 lists and Home, full for Office), one left edge per width, padding 48/56, section gap 40, panels 24/28, in tokens. Main button always top-right at the title's top. One `SearchBox` (40px) and one `FilterMenu`.
- **Home.** Greeting with one status line ("2 working . 1 needs you . 5 to review", each a link, no tiles). Composer. Needs you list. To review and running tasks (3 rows each). Recent tasks with real statuses and "17 h ago". Your team (6 rows, "All N"). Plan usage. Getting started as a collapsed single line.
- **Composer.** No key-hint row. One placeholder line. The options chip says "off" or names what is on. Chip menus scroll and search. Tooltips on Auto and Assistant. A loading state with no warning. The Office "Give it a goal" and a hover "New task" on sidebar and Team departments pass the department.
- **Ctrl+K.** Opens on Recent tasks, then Create, then Go to. Adds members, workspaces, templates, providers, "Add app", "What's new", "Switch theme". Tutorials collapse to one entry.
- **Settings, Help, You.** Settings (760 column): New tasks, Notifications (moved from You), Appearance (Theme, Text size, three switches), all as `SwitchRow` or pills, saved at once. Help: Tutorials (one shared list with done ticks), What's new with the version, Keyboard shortcuts, "Run setup again" as a ghost link. You: name, colour, about, answer style, Save disabled until something changes.
- **Onboarding.** Same page tokens; the Ready step uses the shared tutorial list.
