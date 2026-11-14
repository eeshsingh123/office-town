# Audit a2: the people side (Office floor and Board, Team, departments, Chief, Templates, agent identity)

Method: read the code in `features/office`, `board`, `team`, `departments`, `chief`, `profiles`, and `sidebar/Departments.tsx`; captured about 30 screens (dark, light, 1000 px and 1920 px wide) in `shots/a2/`. The data has no working agent, no chief and no templates, so those states come from code and say so. Shots are named in each Evidence line. Paths are under `apps/desktop/src/`.

Decisions checked first: D-35/D-62 (floor), D-59 (handles stay in the office), D-66 (no explainer panels, no internal terms), D-101 (one task status, Board), D-102 (free members sleep, Overview tab). Findings below do not contradict them unless the finding says so.

## Office floor

### a2-1. A working agent's step is hidden until you point at it
- Where: Office, Floor, every desk
- Category: readability
- Severity: High
- What the user sees: A working agent shows a spinner in a 16 px badge and a token count. The line that says what it does ("Step 2 of 5 · Build the page") is invisible until the pointer is over that agent. Only an agent that needs you shows its line all the time (amber).
- Why it hurts: "What is each agent doing, which step, what blocks it" is the core principle. On a floor with several working agents the user must hover each one. D-102's own check in MEMORY.md expects a working member to "show its step bubble", and the code hides it.
- Fix: Show the work line for working agents all the time, one line, cut at 42 characters as today (`bubbleOf` already does this), in the empty desk face (see a2-8) or under the name tag. Sleeping agents stay quiet, so a floor with 20 departments only shows text where something moves. Keep the amber style for "needs you".
- Evidence: `features/office/Office.module.css:333-341` (`.bubbleWork { opacity: 0 }` until hover, focus or the player is near), `Floor.tsx:768`, `OfficeView.tsx:49-63`. Code only: no working agent in the test data.

### a2-2. The floor is fixed at 840 px wide; 20 departments mean 3,500 to 10,000 px of scrolling and there is no way to find one
- Where: Office, Floor
- Category: scalability
- Severity: High
- What the user sees: Rooms sit two per row (one per row once a department has three or more people) inside a floor that never grows past 840 px. At 1920 px there are about 280 px of empty floor on each side. The floor has no search or "jump to".
- Why it hurts: I ran the layout code: 6 departments of 2 people is 1,328 px tall (matches the screen); 20 departments of 2 people is 3,568 px; 20 of lead plus 3 workers is 6,768 px (about 8.5 screens); 20 of lead plus 6 workers is 10,368 px. Rooms are drawn full size even when nobody works in them. The Board has a search box; the floor does not, and Ctrl+K lists departments but not agents.
- Fix: Let the floor's room columns follow the pane width (3 to 4 rooms per row on a wide screen). Above about 8 departments, draw a room with nobody working as a compact row (sign, chips, one avatar per member) that opens to the full room when picked. Add one "Find" field to the Office top bar (departments and people) that scrolls to and opens the match. Reuse the Board's search box component style.
- Evidence: `features/office/floor-plan.ts:71` (`INNER_WIDTH = 780`), `Floor.tsx:324` (`Math.min(1, ...)`), my layout run (scratchpad `calc-a2/run.ts`), shots `office-dark`, `floor-bottom`, `office-1920`.

### a2-3. At 1000 px wide the floor is squeezed to a strip and the text is 6 px
- Where: Office, Floor at a narrow window
- Category: UI bug
- Severity: High
- What the user sees: The sidebar (205 px) and the side panel (360 px, one sentence in it) leave about 400 px for the floor. It scales to its 0.6 minimum, still does not fit, and scrolls sideways. The second column of rooms is cut off. Names and labels (10 to 11.5 px at full size) are about 6 px. "Chief's office" and "New department" sit on top of the Open floor sign.
- Why it hurts: The first screen of the product is not usable on a small laptop or a half-width window.
- Fix: Below about 1100 px window width, close the side panel by default and open it over the floor when something is picked (the panel is already a slide-in, `PanelFrame`). See a2-2 for columns. Raise the minimum scale only after the columns follow the width.
- Evidence: shot `office-1000`; `Floor.tsx:301` (`MIN_SCALE = 0.6`), `SidePanel.tsx:12` (`SIZE` 360, min 300), `Office.module.css:989-1038` (10 to 10.5 px labels).

### a2-4. The right panel takes a full column to say one sentence
- Where: Office, side panel with nothing selected
- Category: bad pattern
- Severity: Medium
- What the user sees: A 360 px column (about a quarter of the window at 1440 px, more than a third at 1000 px) holds "Select an agent or a room, double-click to chat, or drag to select several." and nothing else.
- Why it hurts: It wastes the space the floor needs (a2-2, a2-3). The sentence is also the only place that teaches double-click and drag-to-select, so deleting it alone loses that.
- Fix: Open the panel only when something is selected (`OpenOnSelect` already opens it on a pick; change the start value of `panelOpen` to false). Move the gestures to the Floor toggle's tooltip (it already says "Move with WASD or the arrow keys") and to Help. Remove the sentence.
- Evidence: `features/office/OfficePanel.tsx:22-29`, `office-state.ts:28`, shots `office-dark`, `office-1000`, `office-1920`.

### a2-5. "Chief's office" and "New department" tiles float over rooms and agents
- Where: Office, Floor, bottom right
- Category: UI bug
- Severity: Medium
- What the user sees: Two dashed 128 x 72 px tiles stay fixed at the bottom right while the floor scrolls under them. They cover room signs, desks and name tags (the name "@hana-2238" is hidden behind one in the 1440 x 967 shot) and take the clicks meant for what is under them. They are drawn at 55% opacity, so their text is faint.
- Why it hurts: Overlap is a bug, and the faint text reads as disabled. "Chief's office" is also the wrong label: the tile sets a chief up, it is not an office yet. The same two actions exist in the sidebar "+" menu, the Team page header and Ctrl+K (see a2-22).
- Fix: Remove the tiles. Add "New department" as a normal `Button` at the right end of the Office top bar (next to the panel toggle). Chief setup stays in the sidebar menu and the Team page.
- Evidence: `features/office/OfficeView.tsx:400,417-437`, `Office.module.css:22-62`, shots `agent-profile` (name hidden), `office-dark`, `office-1000`.

### a2-6. The number above each head ("44k") has no unit and no label
- Where: Office, Floor
- Category: readability
- Severity: Medium
- What the user sees: A bold pill with "44k", "11k", "16k" above every avatar, including sleeping ones. The only explanation is a tooltip ("X used 44k tokens on this task").
- Why it hurts: It is the most prominent number on the floor and says nothing without hovering. It competes with the status line (a2-1) for the same spot, and tokens are the thing a non-technical user cares about least.
- Fix: Take the pill off the floor. The same number is already in the panel ("Runs on") and in the room sign when the room is open. If it stays, write "44k tokens" and show it only for agents that worked today.
- Evidence: `features/office/Floor.tsx:733-740`, `Office.module.css:762-776`, shot `office-dark`.

### a2-7. "LEAD 1 / WORKER 1" labels: the number means nothing
- Where: Office, Floor, foot of each sub-team box
- Category: readability
- Severity: Medium
- What the user sees: In a department with a lead and others, each group has a 10 px uppercase label and a round pill with a number ("LEAD 1", "WORKER 1"). The pill looks like an unread count.
- Why it hurts: The number is the count of desks in the group. For the lead it is always 1. You can see the desks already. The label is also a button ("Select everyone here") that only a tooltip explains. These groups only appear when a department has two or more roles, so some rooms have the labels and some do not.
- Fix: Show the role name only. Show a count only when it is more than 1 and write it as "Workers 3". Move "select this group" to the room's right-click menu (`departmentMenu`) and drop the hidden button.
- Evidence: `features/office/Floor.tsx:645-670`, `floor-plan.ts` (`placeTeams`), `Office.module.css:989-1038`, shot `office-dark`.

### a2-8. Every desk has an empty monitor shape that says nothing
- Where: Office, Floor, all desks
- Category: slop
- Severity: Low
- What the user sees: A grey box with a small bar on top under every avatar, empty for sleeping agents and for working agents without milestones.
- Why it hurts: Decoration with no job, repeated on every desk. It is also the one place on the floor that could hold the agent's status line (a2-1).
- Fix: Remove the bar. Use the desk face for the one-line status when the agent works (the milestone bar already uses the desk face this way). Keep empty desks plain.
- Evidence: `features/office/Office.module.css:233-249` (`.desk::after`), `Floor.tsx:743-757` (`deskCount`), shot `office-dark`.

### a2-9. Room signs and name tags never cut long text, so they run past the room
- Where: Office, Floor
- Category: scalability
- Severity: Medium
- What the user sees (from code; test names are short): A room sign is one line, as wide as its content: grip, department name, up to two door chips ("1 needs you", "Working"), and when the room is open the token total with each provider. A long department name or the open usage line runs past the room's edge into the next room's sign. A name tag under an avatar never shortens (a name can be 32 characters).
- Why it hurts: With 20 departments and real names ("Customer onboarding and support") signs collide.
- Fix: Give the sign a maximum width of the room minus its margin, cut the name with an ellipsis and keep the chips. Put the full name in the sign's title. Cut the name tag at the avatar's width.
- Evidence: `features/office/Office.module.css:129-146` (`width: max-content; white-space: nowrap`, the comment says it "runs past the room's edge"), `.nameTag` at `:298-306`.

### a2-10. The hover text on an agent shows the raw model id
- Where: Office, Floor, tooltip under an agent
- Category: inconsistency
- Severity: Medium
- What the user sees: "Claude Code · claude-haiku-5-5". Everywhere else it reads "Haiku 5.5".
- Why it hurts: D-66 says models are shown by display name, and `model-name.ts` is the only namer. Screen readers read the same text.
- Fix: Build `detail` with `useModelName`/`modelName` from `features/profiles/model-name.ts`, as the Team page does.
- Evidence: `features/office/Floor.tsx:284` (`detail` uses `options.model`), tooltip and `aria-label` read in capture `tooltip`.

### a2-11. The Open floor is always drawn as an empty room with jargon and an explainer
- Where: Office, Floor, bottom; its side panel
- Category: slop
- Severity: Low
- What the user sees: A large room with two bare desks and the label "Open floor / Assistants", even when no assistant exists, at the end of a long floor. Its panel says "An assistant works here on its own task, outside any department." above "New task for an assistant". The guest room is called "Review desk / Reviewers".
- Why it hurts: "Open floor" is an invented place name for "agents with no department". The panel sentence explains the label. The empty room costs a full row at 20 departments.
- Fix: Draw the Open floor only when an assistant is on it or was today. Name it "Assistants" (the word Home and the composer use). Drop the explanation sentence.
- Evidence: `features/office/OfficeView.tsx:177-180,248-251`, `OfficePanel.tsx:38-62`, shot `floor-bottom`.

## Status words and actions

### a2-12. A finished agent and department get four different words
- Where: Floor, side panel, group panel, Team page
- Category: inconsistency
- Severity: High
- What the user sees: A lead that finished and waits for review shows "z z" on the floor, a "To review" chip on its room, "DONE" (capitals) in its panel header, "Done" in the department panel's member list, "idle" in the group panel summary (the cards beside it say Done for that state), and "Idle" on the Team page and in the department right-click menu.
- Why it hurts: One state, five words; "Idle" and "Done" are also the same internal state (`idle` is labelled "Done"). "Done" tells the user nothing is left to do, while Tasks says "To review" (D-101: finished work is To review until the user marks it Done).
- Fix: One word per state, taken from the shared task status where it is about finished work: "To review" until marked Done, then "Done". A member with no work is "Free" (D-102's word) in the chip, the group summary, the Team card and the menu. Drop "Idle". Make the panel chip use the same case as the other chips.
- Evidence: `ui/StatusIcon.tsx:10` (`idle: "Done"`), `features/office/GroupPanel.tsx:25`, `team/TeamView.tsx:119-121`, `departments/department-menu.tsx:65`, `office/DoorChips.tsx`, shots `agent-panel`, `room-panel`, `team-dark`.

### a2-13. Task states have three more maps with different words; the Chief page shows "Done" for work still To review
- Where: Chief page, Home's team list, Workspaces page, Board, Tasks
- Category: inconsistency
- Severity: Medium
- What the user sees: A goal that is waiting its turn reads "Waiting" (Tasks, Board), "Queued" (room chip, Home), "Waiting its turn" (Chief page, Workspaces). Working reads "Working" or "In progress" (Workspaces). Ended reads "Done" on the Chief page, Home and Workspaces, but "To review" in Tasks and on the Board. Paused reads "Idle" on Home and "Paused" elsewhere.
- Why it hurts: D-101 says one task status everywhere. Three screens keep their own tables and ignore it, so the owner's rule fails exactly where a chief goal finishes.
- Fix: Delete the three local maps and read `STATUS_LABELS`/`statusOfTask` from `features/tasks/task-list.ts`. Use "Waiting" for queued everywhere (it is what Tasks and the Board already say).
- Evidence: `features/chief/ChiefView.tsx:22-28`, `home/HomeView.tsx:39-45`, `workspaces/WorkspaceView.tsx:21-27`, `tasks/task-list.ts:37`, `office/DoorChips.tsx` ("Queued").

### a2-14. One action, five labels: "Open task", "Open goal", "Open the goal", "Review", "Give it a goal"
- Where: Agent panel, department panel, chief page and panel, agent cards
- Category: inconsistency
- Severity: Medium
- What the user sees: The button that opens a task reads "Open task" in an agent's panel, "Open goal" in a department's and the chief's panel, "Open the goal" on the chief page and "Review" on pinned and group cards. The room sign says "Last goal ·", the right-click menu says "New task here", the panel says "Give it a goal".
- Why it hurts: Users type a task; "goal" is the chief's word (D-49). Mixing them makes a department look like it works on something different from an agent.
- Fix: "Open task" for agents and departments, "Review" only where the status is To review. Use "goal" only for the chief. Change the sign line to "Last task ·".
- Evidence: `office/AgentPanel.tsx:158`, `departments/DepartmentPanel.tsx:307,314`, `chief/ChiefView.tsx:184`, `chief/ChiefOverview.tsx:106`, `office/AgentCard.tsx:124`, `office/OfficeView.tsx` (sign line "Last goal ·"), `departments/department-menu.tsx:34`.

### a2-15. "Give it a goal" on a department's panel starts the task for someone else
- Where: Department panel footer, when the department has no task yet
- Category: UI bug
- Severity: Medium
- What the user sees: The primary button opens New task without the department. The composer opens on whatever target was used last (an assistant, by default). The right-click menu entry "New task here" does it right.
- Why it hurts: The button promises a goal for this department and delivers an empty composer aimed elsewhere.
- Fix: `navigate({ name: "new-task", who: "team", departmentId })`, the same call the menu uses.
- Evidence: `features/departments/DepartmentPanel.tsx:306` versus `department-menu.tsx:36`; the composer reads `who` and `departmentId` in `new-task/Composer.tsx:73-79`. Code only: no department without a task in the data.

### a2-16. Picking a department in the sidebar while on the Board does nothing you can see
- Where: Sidebar department list and Ctrl+K, while the Office shows the Board
- Category: UI bug
- Severity: Medium
- What the user sees: The Board stays on screen and no panel opens. The room is opened in the background and appears when the user flips back to Floor.
- Why it hurts: A click with no visible result. I checked it: after the click the page still shows the five Board columns and no department panel.
- Fix: Use `selectRoom(id)` (it also switches to the Floor) in the sidebar and the command menu instead of `navigate({ name: "office", room })`.
- Evidence: `features/sidebar/Departments.tsx:150`, `command/CommandMenu.tsx:227`, `office/office-state.ts:70-74`; capture `board-then-sidebar`.

### a2-17. A finished agent's panel says "Working on" and "Last done" lists raw tool names
- Where: Agent panel, Overview
- Category: readability
- Severity: Medium
- What the user sees: The first section is titled "Working on" for an agent that finished yesterday. "Last done" lists "ToolSearch: select:mcp__office-t…" next to "Delegated to @dev-7810".
- Why it hurts: The title is wrong for most agents on the floor (all free members). The tool line is machine text (D-66: no internal terms).
- Fix: Title by state: "Working on" while busy, "Last task" otherwise. Pass every action title through the naming rule in `trace/team-tools.ts`; hide helper steps (tool search) from "Last done".
- Evidence: `features/office/AgentPanel.tsx:81-100,112-124`, shot `agent-panel`.

### a2-18. The department panel's Overview mixes live status with settings
- Where: Office, department panel, Overview tab
- Category: duplication
- Severity: Low
- What the user sees: After Working on and Members come an editable Workspaces list (with "Add workspace"), a Permissions block (label plus a three-line description plus "Change"), and usage. The Department settings page has the same Workspaces and Permissions sections, and the gear opens it.
- Why it hurts: The panel's job is to show what the team does now (a2-1). The Permissions description is a paragraph that repeats the label. The same list can be edited in two places, and the path in the workspace row is cut at the end ("C:/Users/<you>/AppData/Loc…"), which hides the folder name, the part that matters.
- Fix: Overview keeps Working on, Members (with each member's state and step), Handed out, Outputs. Settings sections stay on the Department page. Cut long paths in the middle.
- Evidence: `departments/DepartmentPanel.tsx:225-282`, `DepartmentWorkspaces.module.css:81`, shot `room-panel`.

## Departments: how they are shown and opened

### a2-19. A department is opened five ways with two destinations, in two orders, with four icons
- Where: Sidebar, Home, Team, Office, Chief page, Ctrl+K, Board
- Category: duplication
- Severity: Medium
- What the user sees: The same department name does different things. Sidebar row, Home row, Chief page row, Ctrl+K and Board card open its room in the Office. A department's name on the Team page (its tooltip says "Open Smoke claude") opens its settings page, and the "Open in office" button beside it opens the room. The panel gear, the Permissions "Change", the right-click "Department settings", the Workspaces page and Needs you all open settings. The Office lists rooms oldest first; sidebar, Team, Home, Chief page and Ctrl+K sort by name. A department is drawn as a dot (sidebar), a "users" icon (Home, panel header), a letter avatar in its lead's colour (Team, Chief page, menus) and a room (Office).
- Why it hurts: Same item, different result by screen; the user cannot predict where a click leads, and two lists of the same departments do not line up.
- Fix: One rule: the name opens the room in the Office (`selectRoom`), a gear opens Department settings. On the Team page, the card title opens the room and "Open in office" goes. One sort order everywhere (by name, since every list but the floor already uses it). One glyph: the letter avatar in the department's colour (see a2-27) in the sidebar, Home and the panel header.
- Evidence: `sidebar/Departments.tsx:114,150`, `team/TeamView.tsx:107-124,307`, `chief/DepartmentList.tsx:13,28`, `home/HomeView.tsx:181,229`, `command/CommandMenu.tsx:219-227`, `office/OfficeView.tsx:312-315`, `departments/DepartmentPanel.tsx:150-170`, shots `team-dark`, `room-panel`.

### a2-20. Six departments with the same name cannot be told apart, and nothing stops duplicates
- Where: Sidebar, Team, Chief page, Home, Ctrl+K
- Category: scalability
- Severity: Medium
- What the user sees: Six rows that all read "Smoke claude" in the sidebar, the Team page and the chief's list. Only the Office shows a second clue (the "Last goal" line). Creating or renaming a department to a name already used is accepted.
- Why it hurts: The chief plans by department name and the user picks departments from these lists. Two "Website" teams are easy to make.
- Fix: Reject a name already in use in the Name field (`missingIn` in `team-form.ts` and the server). Give every list a second line: the department's purpose, else its last task.
- Evidence: `departments/team-form.ts:289-296` (no unique check), `packages/service/src/team/departments.ts` (none), shots `team-dark`, `office-dark`.

### a2-21. The sidebar department list has no limit and a large promo card above it
- Where: Sidebar
- Category: scalability
- Severity: Medium
- What the user sees: Every department is a row, always open, with a bare number on the right ("2", the word "members" is hidden). Above them sits the "Add a chief" card (about 135 px tall) for as long as no chief exists.
- Why it hurts: At 20 departments the nav is a long scroll that pushes Settings and Help off screen on a laptop. The card is a nudge that stays for users who do not want a chief (the Team page itself calls it "Optional").
- Fix: Show working departments and the five most recent, then "All 20" opening the Team page. Give the list a fold like the Team page. Remove the card (the "+" menu already offers "Add a chief"). Write "2 people" or hide the number.
- Evidence: `sidebar/Departments.tsx:41-66,108-165`, `Sidebar.tsx:240-246`, shot `team-dark`.

### a2-22. "Add a chief" is offered in eight places under five names
- Where: Sidebar card, sidebar "+" menu, Team page, Office tile, empty-office room, Home, Ctrl+K, the task composer
- Category: duplication
- Severity: Medium
- What the user sees: "Add a chief", "Set up a chief", "Chief's office", "Set up your chief", "Create a chief and give it a goal". "New department" has the same spread: sidebar menu, sidebar card ("Build a department"), Team header, Team starter ("Draft department", "Build by hand"), Office tile, empty-office room, Home (twice), Chief page list, Ctrl+K.
- Why it hurts: Same action, many names; the screens stack up the same prompt. It reads as selling.
- Fix: Keep one place that stays on screen (the sidebar "+" menu), the Team page header button, and Ctrl+K. Home's Getting started step is onboarding and can stay. Remove the sidebar card, the Office tiles and the Team page's "No chief" explanation (a2-23). One label: "Set up a chief".
- Evidence: `sidebar/Departments.tsx:55-61,97`, `team/TeamView.tsx:216-224`, `office/OfficeView.tsx:423`, `office/Floor.tsx:881-882`, `home/HomeView.tsx:200,375`, `command/CommandMenu.tsx:192`, `new-task/Composer.tsx:691`, `onboarding/tutorials.ts:137`.

### a2-23. The Team page's tree draws departments under "No chief" and explains itself in a paragraph
- Where: Team page
- Category: bad pattern
- Severity: Medium
- What the user sees: A tree: You, then "No chief" (or the chief), then every department as its child. "No chief" is a card with the text "You give each department its own tasks. A chief takes one goal and splits it across your 6 departments." and an "Add a chief" button. "You" has the text "Give goals, approve plans".
- Why it hurts: The tree says departments report to the chief and, with none, to a missing node. The chief is optional (D-49): you can give tasks straight to a department. The two explanation lines are slop; the "You" node is decoration.
- Fix: A plain list of departments under the title, each with its state. Show the chief as the first row only when one exists; when none, the header offers "Set up a chief" next to "New department". Drop the "You" node and both sentences.
- Evidence: `team/TeamView.tsx:176-224,356-389`, shot `team-dark`.

### a2-24. Page start and width differ across Team, Templates, Department settings and the setup wizards
- Where: those pages
- Category: inconsistency
- Severity: Low
- What the user sees: The page title starts at x=404 on Team (centered 820 px column), x=276 on Templates (column up to 1180 px, so full width here), x=294 on Department settings (centered, up to 1040 px) and x=554 in the wizards. Sections are 28 px apart on Templates and 40 px apart on Department settings. "Back" is a crumb on the Department page ("Team / Smoke claude") and a small "← Back to Team" or "← Back to Home" in the wizards.
- Why it hurts: Moving between sibling pages makes the title jump sideways.
- Fix: One content column for list pages and one for form pages, both from `ui/Page.module.css`; one back control (`Crumbs`).
- Evidence: `team/Team.module.css:6`, `departments/DepartmentSettings.module.css:5`, `profiles/Templates.module.css:6`, `ui/CardPage.module.css:11-18`, shots `team-dark`, `templates`, `dept-settings`, `new-department`.

### a2-25. One count, five phrasings
- Where: sidebar, Home, Team, panel, menu, chief page
- Category: inconsistency
- Severity: Low
- What the user sees: For a department of two: "2" (sidebar), "2 members" (Home, panel), "2 people" (Team), "2 agents" (right-click menu), "A lead and 1 person" (chief page). People are also called members, workers, agents, teammates and "Lead + 1" (Tasks).
- Why it hurts: One name per thing is a rule; the chief's line even counts one fewer than the others.
- Fix: "2 people" in all five, from one helper (`team-line.ts`).
- Evidence: `sidebar/Departments.tsx:155`, `home/HomeView.tsx:218`, `departments/DepartmentPanel.tsx:147`, `team/TeamView.tsx:96`, `department-menu.tsx:65`, `departments/team-line.ts:1-4`.

## Agent identity

### a2-26. The same person is named five ways, and the "@" name is hard to read
- Where: Floor, panels, Team, member editor, Tasks, sidebar
- Category: inconsistency
- Severity: Medium
- What the user sees: One lead is "@quinn-7990" on the floor and in its panel (and inside sentences: "Delegated to @dev-7810", "Notes for @quinn-7990", "Teammates use this name to give @quinn-7990 work"), "Lead" with a "Q" avatar on the Team page, "@quinn-7990" in the member roster but "Lead" in the editor beside it, "Lead + 1" in Tasks, "Smoke claude and 1 more" in the sidebar's Active list, and "No. 2" while drafting a department.
- Why it hurts: Letters and four digits are noise to a non-technical user. With only 64 first names, 60 agents will share first names, so a short name alone would not be enough either. D-59 keeps handles in the office, so Tasks is right; but the Team page never shows the handle at all, so a user cannot match a Team row to a floor desk.
- Fix: One component for "a person" (like `model-name.ts` for models): avatar, role as the first line, "@name · department" as the second. Use it in the floor tooltip, panel header, Team rows, member roster, activity lines. Write sentences with the role ("Notes for the lead"), not the handle. D-59 stays as it is.
- Evidence: `features/office/Floor.tsx:775-790`, `office/AgentProfile.tsx:132-151`, `team/TeamView.tsx:52-70`, `departments/MemberEditor.tsx:97-104,327`, `tasks/TaskRow.tsx:60-70`, `tasks/WorkerName.tsx`, `departments/TeamCard.tsx:42`, `packages/service/src/agents/names.ts:5-12`.

### a2-27. Colour means nothing: random per person, not per team
- Where: Floor, Team, Board, department drafts
- Category: inconsistency
- Severity: Low
- What the user sees: In one room the lead is slate and the worker rose. A department's avatar silently takes its lead's colour (Team page, menus), and changes if the lead changes. The sidebar shows a grey dot. On the Board a coloured dot before the provider name is a hash of the provider's name from the same eight colours. When a department is drafted, its review step shows a fixed blue lead and index-based member colours; the agents created afterwards get random ones.
- Why it hurts: Colour could tell teams apart at a glance (6 identical names, a2-20), but today it is noise, and the preview shows colours the agents will not keep.
- Fix: One colour per department (the lead's, as now, stored on the department), used for its sign, sidebar dot and Team avatar; members take it at creation unless the user picks another in Profile. Show the provider's logo on the Board (as the model picker does), not a hashed dot. Make the draft preview use the colours that will be saved.
- Evidence: `service/src/agents/names.ts:30-36`, `team/members.ts:110`, `departments/team-form.ts:53-55`, `team/TeamView.tsx:111`, `board/BoardView.tsx:26-30`.

### a2-28. The Profile name field wants "@lowercase-letters" and fails after Save
- Where: Agent panel, Profile tab; member profile dialog
- Category: bad pattern
- Severity: Medium
- What the user sees: The Name field takes any text. A normal name ("Ben Smith") is sent as typed and the save fails with `Must start with "@" and contain only lowercase letters, digits and hyphens`. The hint above says "It starts with @ and uses lowercase letters, numbers and dashes." The pencil next to the name in the panel header does convert ("Ben Smith" becomes "@ben-smith").
- Why it hurts: Two ways to rename; one works on any name, the other punishes it, with a schema message. The hint teaches handle syntax to someone who just wants a name.
- Fix: Reuse the pencil's `toHandle` in the Profile field (show the result under the field) and drop the syntax sentence. Better still, remove the Name field from Profile and keep the pencil only.
- Evidence: `features/office/AgentProfile.tsx:98-100,155-168` versus `office/AgentName.tsx:9-19,28-33`, `packages/contract/src/agents.ts:22-27`, shot `agent-profile`.

### a2-29. The same fields have different labels in the profile, member editor, template and reviewer forms
- Where: Agent Profile tab, Department settings member editor, Template dialog, Reviewer dialog
- Category: inconsistency
- Severity: Medium
- What the user sees: What an agent reads before each task is "Notes for @quinn-7990" in the Profile and "Notes" in a template, but "Instructions" in the member editor and the reviewer form. The one line about the job is "What @quinn-7990 does", "What they do", "What it does", "Description" and "What it's for". The model is "Model" in forms, "Runs on" in the panel and "Which AI" in Save as template. The same person can be edited in three places: the Profile tab (name, colour, notes, model, permissions), the member editor (role name, what they do, instructions, model) and, from the editor's menu, the Profile dialog.
- Why it hurts: One setting, several names; users cannot tell that "Notes" and "Instructions" are the same box.
- Fix: One word per field in all four forms: "Instructions", "What it does", "Model". The member editor keeps team fields (role); the profile keeps person fields (name, colour). Link each to the other ("Open profile" is already in the editor's menu).
- Evidence: `office/AgentProfile.tsx:156-196`, `departments/MemberEditor.tsx:411-436`, `profiles/TemplateDialog.tsx` (labels), `profiles/ReviewerDialog.tsx:91-110`, `profiles/SaveTemplateDialog.tsx:79-86`, shots `agent-profile`, `template-dialog`.

### a2-30. Colour picker leaves one swatch alone on a second row in the side panel
- Where: Agent panel, Profile tab
- Category: UI bug
- Severity: Low
- What the user sees: Seven swatches in one row and the eighth (Slate) below it.
- Why it hurts: Looks broken; in the template dialog the same picker fits one row.
- Fix: Smaller gap in narrow containers (`form.swatches`) so eight fit, or a 4 x 2 grid.
- Evidence: shot `agent-profile`, `ui/ColourPicker.tsx`, `ui/Form.module.css` (`.swatches`).

## Department settings, setup and Chief

### a2-31. Three pages open with a four-step explainer panel
- Where: Department settings, Templates, Chief page
- Category: slop
- Severity: Medium
- What the user sees: "How a department works", "How templates work" and "How your chief works": a large card with four pictured steps ("You give a task", "The lead splits it" ...), taking about 420 px at the top. On Department settings it pushes the real form ("Change with words", "About") below the first screen. Once hidden, a "How ... works" button stays in the header.
- Why it hurts: D-66 says no explainer panels; onboarding may explain in one sentence. A user who returns daily to edit a team sees an explanation of what a department is first.
- Fix: Remove the three `Guide` panels and their header buttons. Keep the one-line page lead. Move the four-step picture to Help (it has the room).
- Evidence: `ui/Guide.tsx`, `departments/DepartmentSettings.tsx:395-401`, `profiles/TemplatesView.tsx:161`, `profiles/TemplatesGuide.tsx`, `chief/ChiefView.tsx:151`, `team/guides.tsx`, shots `dept-settings`, `templates`.

### a2-32. Department settings is one long form with repeated parts, and "Remove" sits in different places
- Where: Department settings, Chief page
- Category: bad pattern
- Severity: Medium
- What the user sees: Nine sections in one scroll (Change with words, About, Workspaces, Team, Team rules, Files, Permissions, Code, then Remove) with one Save at the bottom. "Files" with "Open Library / Add from Library / The Library is empty." appears twice: inside the member editor and again for the team. The word "Remove department" appears three times in the last block (title, hint, button). On the Chief page the red "Remove" button sits in the header next to "Settings".
- Why it hurts: The team (what most visits are for) is in the middle. A delete button next to Settings is one mis-click from a confirm dialog; at the bottom of a department page it is not.
- Fix: Order: About, Team, Team rules, Permissions, Workspaces, Code. "Change with words" becomes one header button that opens its box. Show Files once per level only when the Library has items, else a single "Add from Library" link. Put "Remove" last on both pages and write it once.
- Evidence: `departments/DepartmentSettings.tsx:48-75,195-370`, `departments/MemberEditor.tsx:492-505`, `chief/ChiefView.tsx:141-146`, shots `dept-settings`, `dept-members`.

### a2-33. Reassurance sentences on almost every form
- Where: department, template, profile and chief screens
- Category: slop
- Severity: Medium
- What the user sees: "Nothing is created until you press Create." (last step of New department). "Changes here won't change the template." (Add a member dialog). "Filled in from X. Changing this agent won't change the template." (template picker). "Deleted “X”. Agents made from it keep working as before." (toast). "What the template keeps ... Not kept: ..." (Save as template). "Changes apply from the next task." appears four times (department panel, twice on the department page, and the profile's save toast), plus "{name} is working on a task right now. Your changes start with {name}'s next task." on the Profile.
- Why it hurts: These are the "your files are not changed" kind of lines the owner rules out. The Save as template box is a list of what the form already shows.
- Fix: Delete them. Keep one short line only where the result would surprise: the Profile and Department Save toast "Saved. Applies from the next task." (one place, the toast).
- Evidence: `departments/NewDepartmentView.tsx:210`, `departments/MemberEditor.tsx:506`, `profiles/TemplatePicker.tsx:81-83`, `profiles/TemplatesView.tsx:73`, `profiles/SaveTemplateDialog.tsx:78-90`, `departments/DepartmentPanel.tsx:270`, `DepartmentSettings.tsx:185,236`, `office/AgentProfile.tsx:98,144`.

### a2-34. Setup wizards: heading, buttons and progress say different things
- Where: New department, Set up your chief
- Category: bad pattern
- Severity: Low
- What the user sees: Chief setup step 1 is titled "Name your chief" but opens on a "Describe your chief" box (placeholder "Call it Atlas. Use Opus 5.5 ..."), with two buttons that go forward ("Draft chief" in the box, "Continue" below). Progress is shown three times: the numbered rail, "Step 1 of 4" and a bar at the foot of the rail. In New department step 1 the right half of the page is empty.
- Why it hurts: A user cannot tell if "Continue" skips the draft. Three progress marks is one too many.
- Fix: Title step 1 by what it does ("Describe your chief"), keep one forward button per mode, keep the rail and drop "Step 1 of 4" and the bar.
- Evidence: `chief/ChiefSetup.tsx:135-225`, `departments/NewDepartmentView.tsx:170-206`, `ui/StepRail.tsx`, shots `chief-setup`, `new-department`.

## Templates

### a2-35. Templates page: controls over an empty list, four prompts for one action
- Where: Templates
- Category: slop
- Severity: Low
- What the user sees: With no template: the guide (a2-31) with its button "Make your first template", a search box, an "All" chip, Cards/List switch, a Sort menu, then "No templates yet. Use New template, or Save as template on any agent's profile.", and "New template" at the top right.
- Why it hurts: Search, filter, layout and sort control nothing. The same instruction is written twice (guide step 1 and the empty text), and three buttons do one thing.
- Fix: Show the tools row only with at least one template (search from 8, as Reviewers does). Empty state: one line and the page's "New template" button. Drop the Cards/List switch unless a user list passes about 20 (the card grid is enough for fewer).
- Evidence: `profiles/TemplatesView.tsx:150-168,170-238,243-251`, `profiles/ReviewersSection.tsx:16-18`, shot `templates`.

### a2-36. Deleting a template or a reviewer asks nothing
- Where: Templates cards and list, Reviewers list, Reviewer dialog
- Category: inconsistency
- Severity: Medium
- What the user sees: "Delete" in the "..." menu deletes at once and shows a toast. In the reviewer dialog a plain "Delete" ghost button next to Cancel deletes at once. Removing a department or a chief asks first with a confirm dialog, and every Stop asks (D-89).
- Why it hurts: Hand-written instructions are lost with one slip and there is no undo (D-57).
- Fix: Use the shared `ConfirmDialog` for Delete in all three places, in the same wording as Remove department.
- Evidence: `profiles/TemplatesView.tsx:64-77`, `profiles/ReviewersSection.tsx:48-56`, `profiles/ReviewerDialog.tsx:131-139`, `departments/DepartmentSettings.tsx:72-110`.

### a2-37. The template picker lists every template, with no search
- Where: Add a member dialog, Start from a template dialog, member editor
- Category: scalability
- Severity: Medium
- What the user sees (from code; none exist in the data): Every saved template as a button in a wrapping grid, then "Start blank". The Templates page has search, filter and sort; the picker has none.
- Why it hurts: At 30 templates the dialog is a wall, and the user's last pick is not first.
- Fix: Add the page's search box above the grid from 8 templates, and put the template the form was filled from first.
- Evidence: `profiles/TemplatePicker.tsx:58-88`, `departments/MemberEditor.tsx:454-523`.

## Board

### a2-38. Board columns: three empty columns, a cut-off fifth, and the team name cut to "Smoke cl..."
- Where: Office, Board
- Category: UI bug
- Severity: Medium
- What the user sees: Five fixed columns of at least 240 px. At 1440 px the Done column is cut and a sideways scroll bar appears. Needs you, Working and Waiting show a bare "0" over an empty tall box and take three fifths of the width. On a card the team name and the provider share one line, so the name shows as "Smoke cl..."; the title wraps to three lines. Page padding is 24 px, not the 48 px 56 px rule.
- Why it hurts: The width goes to nothing while the useful column is clipped.
- Fix: Let columns share the width and fold a column with no cards into a narrow strip (header and count only). Put the team name on its own line and show the provider as its logo. Use the page padding rule.
- Evidence: `board/Board.module.css:46-54,157-185`, `board/BoardView.tsx:129-135`, shot `board`.

## Pinned agents

### a2-39. Pinned cards leave out the department; Pin has no icon in its own panel
- Where: Pinned strip at the foot of every screen; agent panel footer
- Category: inconsistency
- Severity: Low
- What the user sees (from code): A pinned card shows "@quinn-7990" and its line, but not whose department. The group panel adds the department (`where`), the pinned strip does not. In the agent panel footer "Pin" is text only; in the group panel it has an icon.
- Why it hurts: With six "@" names and one department name repeated, a card cannot be placed. Watching running agents is already offered in the sidebar's Active list, Home and the floor.
- Fix: Pass `where` in the strip. Use the same icon button in both footers.
- Evidence: `office/PinnedStrip.tsx:19-21`, `office/GroupPanel.tsx:127-136`, `office/AgentPanel.tsx:158-176`.

## Spacing

### a2-40. The side panel uses 20 px side padding and 28 px between sections, under the rule
- Where: Office side panel (agent, department, chief, empty, profile)
- Category: inconsistency
- Severity: Low
- What the user sees: Tabs content is padded 24 px 20 px with 28 px between sections; the header 18 px 16 px 14 px 20 px. The rule is 24 px 28 px with 40 px between sections. Eight sections in the department Overview feel tight.
- Why it hurts: Cramped is a bug here; the panel is the screen's densest.
- Fix: 28 px side padding and 32 px between sections inside the existing panel tokens, and a default panel width of 400 px (`SIZE.initial`) to keep 340 px for the text. Fewer sections (a2-18) helps more than spacing.
- Evidence: `office/SidePanel.module.css:34,113,142`, `office/Office.module.css:435-443`, `office/SidePanel.tsx:12`.

## Cross-area notes
- Home: a "Your team" list repeats the sidebar's departments with a "users" icon and its own task-state table (`home/HomeView.tsx:39-45`); Home's Getting started card and "queued" count (the Board calls it "Waiting").
- Sidebar: the department list is sorted by name while the Office is by age; bare "2" with a hidden "members" (`sidebar/Departments.tsx:155`).
- Task and chat pages: the Chat tab text in the side panel is larger than the rest of the panel (shot `tab-Chat`); check the chat size scale.
- Trace titles: "ToolSearch: select:mcp__office-t..." reaches "Last done" untranslated (`trace/team-tools.ts` naming rule does not cover it).
- Command menu: lists departments only by name, with no second line, and has no "Board" entry; Board is reachable only from the Office toggle and Home's counts.
- Tasks list: "Lead + 1" and "Smoke claude and 1 more" come from two helpers (`tasks/TaskRow.tsx:60-70`, `tasks/WorkerName.tsx`); one helper would do.

## Keep
- The amber "needs you" line over an agent, the "N need you · Next" button in the top bar and the in-place answer card (`FocusCard`): the best answer to "what blocks it".
- The panel's "Working on" block with the live line, "Step n of m" and a bar (`AgentNow`), and its tabs Overview, Activity, Chat, Profile (D-102).
- Door chips on room signs: small icon chips, at most two, amber only for needs you.
- The Team page's search, fold after four departments, and the member editor's role groups with search from six people.
- Board's lane design (each column scrolls under a fixed header, Done capped at 20 with "See all in Tasks", search and team filter) and the Templates search/filter/sort that scale.

## Proposed shape
- Office top bar: Floor | Board on the left; "Find" field, "New department" button, "N need you · Next" and the panel toggle on the right. No floating tiles.
- Floor: room columns follow the pane width; rooms with nobody working fold to compact rows above about 8 departments; Open floor drawn only when used; desks carry the status line of a working agent (step, or current action); no token pill, no desk decoration; role labels without counts.
- Side panel: closed until something is picked, then a slide-in over the floor on narrow windows. Header: role first, then "@name · department", state chip using the shared words (Free, Working, Needs you, To review, Done, Failed, Stopped). Overview: Working on or Last task, Members with state and step, Handed out, Outputs. Settings leave the panel; the gear opens the Department page.
- One rule for departments: the name opens its room, the gear opens settings; one sort order; unique names; one glyph (letter avatar in the department colour); sidebar list shows working and recent ones with "All N" opening Team; no "Add a chief" card.
- Team page: a list of departments with state and an "Open" that goes to the room, a chief row only when one exists, "Set up a chief" and "New department" in the header.
- Department settings: no guide; About, Team, Rules, Permissions, Workspaces, Code; "Change with words" as a header button; Remove last, once. Same label set as Profile, Template and Reviewer forms ("Instructions", "What it does", "Model").
- Templates: no guide; tools shown with at least one template; confirm on delete; search in the picker.
- One status table (from `task-list.ts`) used by Chief page, Home, Workspaces, floor chips and panel chips; "Waiting" for queued everywhere; "task" for departments and agents, "goal" only for the chief.
- Board: columns share the width, empty ones fold to a strip, team name on its own line.
