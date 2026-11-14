# a3 findings: Tasks, task page, Needs you, status language

Shots are in `scratchpad/shots/a3/`. Live checks used the 6 team tasks in the test data (5 To review, 1 Done, none solo, no chief, nothing needing the user). Findings marked "code" come from reading the code only. Paths are under `apps/desktop/src/`.

## Findings

### a3-1. One finished task says its state seven different ways, and the header says none of them
- Where: Task page, team task (`Delegate one sub-agent to Worker`), whole screen.
- Category: inconsistency
- Severity: High
- What the user sees: The Tasks list says "To review". On the task page the header says "0 working" (a small grey count, not a status). The people column says "Done" twice (lead and worker, green check) and "1 done" in the Worker group line. The trace ends with "Finished · send a message to continue". The bar above the message box says "@iris-1382 finished" with a green "Mark done". The run card says "Done · lead". A Done task (`Delegate file-count brief to Worker`) shows the same header, "0 working".
- Why it hurts: The owner rule is one task status, shown once per screen. Here "Done" appears on a task that is not done, and the real status (To review) appears nowhere on the page. A user cannot tell whether the task is finished, waiting on them or closed. "Mark done" next to "Done" reads like a duplicate.
- Fix: Put one status pill in the header, next to the title, drawn by `TaskStatusIcon` with `STATUS_LABELS` (same icon, colour and word as the Tasks row). Remove the "N working / N waiting for you" chips from the header; the counts already sit in the people column heading ("2 people · 1 at work"). In people rows, run card and group summary, never use "Done" or "Finished" for a person while the task is not Done: use the activity words in the proposal below (Idle for a finished agent). Drop the trace end line "Finished · send a message to continue" for a finished agent (the message box placeholder already says "Send a message to continue"); keep end lines only for Stopped, Failed and Interrupted. Make the review bar text carry only facts the pill does not (for example "2 of 5 checks failed"); with no facts, show the buttons only.
- Evidence: `features/task/TeamTaskView.tsx:209-220` (chips count agents), `:241` (people heading), `:99-113` (group summary), `features/task/SessionTrace.tsx:52`, `features/task/ReviewBar.tsx:41-46`, `ui/StatusIcon.tsx:6-16` (`idle` and `done` both read "Done"), `features/task/RunCard.tsx:184`; shots `task1-dark`, `task-done`, `tasks-status`.

### a3-2. At the smallest window width the trace column is crushed to a sliver
- Where: Task page at 960 to 1100 px wide, with the sub-agent panel open (code: also with the Progress column open).
- Category: UI bug
- Severity: High
- What the user sees: At 1000 px, opening a sub-agent leaves the message trace about 110 px wide. Words break one letter per line, the message box is a thin tall strip, "Send for review" wraps onto three lines, and the Mark done bar is clipped with a horizontal scrollbar.
- Why it hurts: The window can be resized down to 960 px (`electron/window.ts` minWidth). Three columns (people 300 px fixed, trace, side panel 340 px) leave nothing for the trace. The page is unusable there, and the trace is the main thing.
- Fix: Give the trace a minimum width (about 420 px) and let the side panel open as an overlay on top of the trace (or collapse the people column to avatars) below about 1100 px. Reuse the existing `ResizeHandle`/pane sizes; the panel and the Progress column share the same slot, so one rule covers both. Check Progress at its 280 px minimum too.
- Evidence: `features/task/TeamTaskView.module.css:3-9` (`flex: 0 0 300px`), `features/task/ProgressColumn.tsx:21` (`SIZE` 340, min 280), `features/task/SubAgentPanel.tsx:22` (same 340/280 size), `features/task/TaskView.module.css:127-135` (the trace column has `min-width: 0` and no floor); shot `task1-worker-sub-1000` (and `task1-1000` for the lighter case).

### a3-3. Other screens still call a To review task "Done"
- Where: Home "Recent tasks", Chat tab goal headers, Home/Chief/Workspace goal chips, sidebar Active list.
- Category: inconsistency
- Severity: High
- What the user sees: Home shows "5 to review" in its tiles, and the Recent tasks list right below says "· Done" with a green check for the same five tasks. The Office side panel's Chat tab marks every earlier goal "Done" as soon as it ended. Home calls an ended goal "Done", the Chief page and a workspace page call a paused one "Paused" while Home calls it "Idle", and a queued one is "Queued" on Home but "Waiting its turn" on Chief and Workspaces.
- Why it hurts: Decision D-101 says one task status everywhere. These places read the agent state or the raw task state instead of `taskStatus`, so the same task changes name from screen to screen.
- Fix: Everywhere a task is shown with a status, read `statusOfTask` and draw `TaskStatusIcon` with `STATUS_LABELS`. Delete the three private maps `GOAL_STATE` (Home), `GOAL_STATE` (Chief) and `TASK_STATE` (Workspaces). Home Recent tasks and the sidebar Active list should use the task status, not `taskStateOf`.
- Evidence: `features/home/HomeView.tsx:265-291` (`STATE_LABELS[state]` of the agent), `:39-45`, `features/chief/ChiefView.tsx:22-28`, `features/workspaces/WorkspaceView.tsx:20-26`, `features/chat/ChatTab.tsx:170`, `features/sidebar/RunningAgents.tsx:28-37` (code); shot `home-dark` (page text "Smoke claude · 08:44 PM · Done").

### a3-4. "Waiting" means five different things
- Where: Tasks, Board, task page, Needs you, Chief, Workspaces.
- Category: inconsistency
- Severity: Medium
- What the user sees: On Tasks and the Board, "Waiting" means a task queued behind its department. In the task people column "Waiting for you" and the group line "1 waiting" mean it needs the user. A lead with sub-agents running says "Waiting on 2 sub-agents". A starting turn says "Waiting for the model". Needs you says "3 waiting · oldest 5 min" and "Waiting over 1h". The empty Needs you page says "No agent is waiting for you." The Chief and Workspaces pages say "Waiting its turn". The Board's "Waiting" column also holds Failed and Stopped tasks (D-101).
- Why it hurts: "Needs you" is the one amber status, and "Waiting" is used both next to it and instead of it. A user scanning cannot tell "waiting on the user" from "waiting in line".
- Fix: Use "Needs you" only for the user, and "Queued" for a task in line (Home tile, doors and the piece icon already say Queued), everywhere. Rename the Board column "Waiting" to "Queued" (its Failed and Stopped cards keep their own icon and word, as now). Reword the Needs you counts to "3 need you · oldest 5 min" and the empty state to "Nothing needs you." "Waiting on N sub-agents" becomes a sub-line under Working, not a status (see proposal).
- Evidence: `features/tasks/task-list.ts:34-42`, `features/board/BoardView.tsx:19`, `features/board/board.ts:9-17`, `features/task/TeamTaskView.tsx:60,99-105,215-220`, `features/needs-you/NeedsYouView.tsx:205,357`, `features/chief/ChiefView.tsx:23`, `ui/StatusIcon.tsx:8`; shot `needs-dark`. Owner choice in D-101 (Board "Waiting" column); I disagree because of the clash above.

### a3-5. Tasks tabs do not match the task statuses
- Where: Tasks page, tab bar.
- Category: inconsistency
- Severity: Medium
- What the user sees: Seven statuses exist, but there are five tabs. The "Working" tab also holds Waiting (queued) tasks, and "Failed or stopped" holds two statuses. A queued task has a "Waiting" clock in its row but there is no "Waiting" tab, and the row sits under "Working". "Group by Status" shows Failed and Stopped as two groups, while the tab calls them one.
- Why it hurts: Tab names, row icons and Status groups should use the same words. A user who sees a clock icon and clicks "Working" finds it, but cannot see why.
- Fix: Rename the tab "Working" to "In progress" (it holds Working and Queued), and keep "Failed or stopped" as the one tab that holds two statuses. Say the same merges once in `TAB_STATUSES` and use those two names in the Board and Home too.
- Evidence: `features/tasks/TasksView.tsx:38-45`, `packages/contract/src/task-status.ts:6-12`; shot `tasks-dark`.

### a3-6. An empty tab says "No tasks match" and offers "Clear filters" when no filter is set
- Where: Tasks, any tab with 0 tasks (Needs you, Working, Failed or stopped).
- Category: bad pattern
- Severity: Medium
- What the user sees: Clicking "Needs you 0" shows a dashed box: "No tasks match" and a "Clear filters" link, though search and filters are untouched.
- Why it hurts: It reads like an error, and the link only switches back to the All tab. The truthful message is that nothing needs the user, which is good news.
- Fix: When the tab itself is empty and no filter is set, show a one-line tab-specific text ("Nothing needs you", "Nothing is working") and no link. Keep "No tasks match / Clear filters" only when filters or search are set. Reuse the existing `.empty` block.
- Evidence: `features/tasks/TasksView.tsx:455-462`; shot `tasks-needs-tab`.

### a3-7. Tasks at 1000 px: a tab is cut off and the who and time columns disappear
- Where: Tasks page at 1000 px wide.
- Category: UI bug
- Severity: Medium
- What the user sees: The tab "Failed or stopped" is cut ("Failed or stoppe") by the "5.3 MB" figure, with no scroll cue (the tab strip scrolls but hides its scrollbar). The filters wrap and leave "Started" alone on a second line. Rows lose the "Lead + 1" and "17 h ago" columns entirely.
- Why it hurts: The time is the sort key and the only sign of age, and a hidden tab hides tasks. The window can be this narrow.
- Fix: Let the tab row wrap the storage figure below the tabs, or hide the figure first (see a3-9). Keep the time column and drop the "who" column first, or show the time under the title. Fade the right edge of the tab strip when it scrolls.
- Evidence: `features/tasks/TasksView.module.css:23-40,450-459` (`@media (max-width: 1100px)` hides `.who` and `.when`); shot `tasks-1000`.

### a3-8. After a failed check the same actions appear twice with different names
- Where: Task page, bar above the message box and the check results card in the trace (code; needs a task with a finished check).
- Category: duplication
- Severity: Medium
- What the user sees: The bar says "2 of 5 checks failed", "Send fixes (2)" and "Accept". The results card just above says "Round 1 · 3 of 5 pass, 2 failed", "Send fixes to the team", "Check again" and "Accept as is". On a clean pass the bar says "Mark done" and the card says "Accept". So one action is called "Mark done", "Accept" and "Accept as is", and "Send fixes" has two names.
- Why it hurts: Two sets of buttons for one decision, at two places on the same screen, with different words.
- Fix: One place and one name. Keep the bar (fixed position, quiet) as the only home of Mark done / Accept and Send fixes, and have the card hold only "Check again" and "Read the check". Use "Mark done" always (the Tasks menu uses it), and "Send fixes".
- Evidence: `features/task/ReviewBar.tsx:41-46,52-67`, `features/task/ReviewOffer.tsx:149-169,192-215`.

### a3-9. Mark done is not reachable from the Outputs tab
- Where: Task page, Outputs tab, task To review.
- Category: too many steps
- Severity: Medium
- What the user sees: The Outputs tab is where a user looks at the result. It shows the files and nothing else: no status, no Mark done, no message box. To finish, the user goes back to the Work tab, or leaves to the Tasks list menu.
- Why it hurts: The natural flow is "look at the output, then accept it". It takes two extra clicks, and the status is invisible while the user decides.
- Fix: Show the header status pill (a3-1) on both tabs, and put the review bar (`ReviewBar`, same component) at the bottom of the Outputs pane while the task is To review.
- Evidence: `features/task/TeamTaskView.tsx:233-235`, `features/task/TaskView.tsx:136-138`; shot `task1-outputs`.

### a3-10. A running task's menu has no Stop, and Delete tells the user to find it
- Where: Tasks row menu, sidebar task menu (shared `taskMenu`).
- Category: bad pattern
- Severity: Low
- What the user sees: For a working task the menu has Open, Show in office, Copy title and a greyed "Delete task" with the note "Stop its agents first". There is no Stop in the menu.
- Why it hurts: The menu names the next step but does not offer it. The user must open the task first and leave the list.
- Fix: Add "Stop" (red, `Square` icon, with the existing `ConfirmButton` ask) to `taskMenu` while any agent is open. This repeats an existing action, which D-89 allows.
- Evidence: `features/tasks/task-menu.ts:46-95` (no Stop), `:80-90` (disabled Delete with note).

### a3-11. The run pill at the top right looks like an agent switcher, but is a details popover
- Where: Task page, top right of the trace ("@iris-1382 Haiku 5.5 · 1m 28s · 16k tokens ⌄").
- Category: bad pattern
- Severity: Medium
- What the user sees: An avatar, a name and a chevron: the shape of a dropdown that switches agent. It opens a popover with the agent's state, its model and provider, folder, time, tokens and the per-task switches (Efficient mode, Milestones). Changing agent is done in the people column on the left.
- Why it hurts: The chevron promises a switcher. The page's only way to turn Milestones (which creates the Progress column) or Efficient mode on or off is hidden in it. The same name and state are already in the highlighted people row.
- Fix: Keep the popover and its content. Label the pill for what it is: replace the chevron with an info or settings icon (or the word "Details"). Keep the avatar and name, since a solo task has no people column.
- Evidence: `features/task/RunCard.tsx:20-48,98-199`, `features/task/RunCard.module.css:1-50`; shots `task1-dark`, `task1-run`.

### a3-12. Solo, team and chief task pages have three different headers
- Where: Task page header.
- Category: inconsistency
- Severity: Medium
- What the user sees: A solo task shows a status pill from the agent state ("Done", "Working", "Needs your approval", "Waiting for you", a "Jump to it" link) and a plain "Stop" button. A team task shows the count chips ("0 working", "N waiting for you") and "Stop team". A chief goal (code; the chief's goal has no department) shows the chip "Proposing a team", because the chip's rule only checks "has a lead, no department, no group", plus "Stop team". A task with no lead shows "Stop all". The solo view has no people column; the chief goal page shows only the chief and not the parts it planned (the Tasks list does show them).
- Why it hurts: The same kind of page answers "what is going on" three ways. "Proposing a team" on a chief's goal is a wrong label.
- Fix: One header for all: breadcrumb, title, the one status pill (a3-1), Progress button, Work/Outputs, a single "Stop" button whose confirm text names the scope ("Stop the team?"). The "Jump to it" link moves into the pill's row for any task that needs the user. Show "Proposing a team" only for a lead that has actually asked (`proposal.requested` open). For a chief goal, add its parts (or a link to its plan on the Chief page), since the page shows only the chief.
- Evidence: `features/task/TaskView.tsx:105-129,133`, `features/task/TeamTaskView.tsx:198-231` (chip rule `:200-208`, labels `:229`), `features/task/ProgressColumn.tsx:64`.

### a3-13. The same words count different things
- Where: Home tiles, Office door chips, sidebar badge, Tasks tabs, task header, Needs you page.
- Category: inconsistency
- Severity: Medium
- What the user sees: "working" is a count of agents on Home and in the task header, but a count of tasks on the Tasks page (a task with a lead and three workers is "4 working" on Home and "1 working" in Tasks). "Needs you" is requests in the sidebar badge and the Needs you page ("5 waiting across 2 tasks"), tasks in the Tasks tab (2), and agents on Home and the door chips (code: "one agent asking twice is one that needs you").
- Why it hurts: One situation can show 5, 2 and 3 under the same label, so numbers do not match when the user moves between screens.
- Fix: Pick units: statuses and tab counts count tasks; the sidebar badge and the Needs you page count requests and say so ("5 requests"). Home tiles link to the Tasks tab with the same label and the same count. Keep agent counts for rooms only ("2 at work" in a room).
- Evidence: `features/office/use-counts.ts:20-28`, `features/sidebar/Sidebar.tsx:96-105`, `features/office/use-command-floor.ts:27-33`, `features/needs-you/NeedsYouView.tsx:357-367`, `features/tasks/TasksView.tsx:273-280`.

### a3-14. Grouping by team scales badly: single-task groups, repeated model line, alphabetical order
- Where: Tasks, Group by Team (the default).
- Category: scalability
- Severity: Medium
- What the user sees: With six departments of one task each, the page is six groups, each with a big header (avatar, bold name, "Haiku 5.5 · Claude Code · Low effort") that takes nearly as much room as the one row under it. The model line is repeated in every header. The groups sit in alphabetical order, so with 20 departments the one that needs the user may be 15 screens down.
- Why it hurts: With 100 or 200 tasks over 20 teams the page is mostly headers. The team's model is team information, not task information. Urgency inside a group is handled (open work first) but not between groups.
- Fix: Order groups by urgency first (a group with Needs you, then Working, then newest activity), then name. Show the model line only on hover or on the Team page. Add "Collapse all / Expand all" to the group header row (one `ChoiceMenu` item or a small ghost button). Add a search field to the Team filter menu when there are more than about 8 teams. A group with one row can use a compact header.
- Evidence: `features/tasks/TasksView.tsx:93-104,178-183,330-349`, `features/tasks/task-list.ts:428-431` (`teamOrder`), `features/tasks/TasksView.module.css:179-200`; shots `tasks-dark`, `tasks-1000`. Server side paging (50 at a time) is fine (see Keep).

### a3-15. Needs you uses different controls from Tasks and shows a heavy panel for a few requests
- Where: Needs you page (code; needs requests to see it).
- Category: inconsistency
- Severity: Medium
- What the user sees: Needs you has a segmented "Group by" row (Task | Department | Workspace | Agent | Type), type chips with counts, three native `<select>` dropdowns (Workspace, Department, Provider) and a "Waiting over 1h" chip, all in a bordered panel with search. Tasks has tabs, a "Group by" menu chip and menu chips for Team, Workspace and Started. The panel appears even for a single request. The page column is 1080 px wide against 1120 px on Tasks, so titles sit a few pixels off (282 vs 276 px in the shots).
- Why it hurts: Two sibling list pages with different controls for the same job (filter by type, workspace, department, group). The panel dwarfs one or two requests.
- Fix: Reuse the Tasks controls: type as tabs or the same chip row, "Group by" as `ChoiceMenu`, Workspace and Department as `ChoiceMenu` (the native selects are the odd ones out). Show the tools panel only from about 6 requests, and always keep search. Use the same column width.
- Evidence: `features/needs-you/NeedsYouView.tsx:387-483,569-594`, `features/needs-you/NeedsYouView.module.css:9-13,120-134`, `features/tasks/TasksView.tsx:401-433`; shots `needs-dark`, `tasks-dark`.

### a3-16. The same decision is worded differently on each request card
- Where: Plan card, team proposal card, checklist card, permission card (code).
- Category: inconsistency
- Severity: Medium
- What the user sees: Plan: "Approve plan" or "Approve change", "Edit", "Send back" or "Send back with my note", "Decline". Team proposal: "Approve team" or "Approve the change", "Send back with my note", "Decline" or "Stop the task". Checklist: "Approve and run 5 checks", "Decline". A permission card prints the option labels that come with the request. Bulk: "Allow all" and "Deny all". Cards say "Asks your permission" / "Asks you a question" and "waiting 4 min" while the row that opens them already shows the kind and the age.
- Why it hurts: "Approve change" and "Approve the change" are the same action under two spellings. One decision, several verbs.
- Fix: One verb set: Approve / Send back / Decline, and the same label whether or not the user has typed a note. Name the object only in the card title, not on the button ("Approve" not "Approve team"). Remove the age and kind line from a card shown inside a Needs you row.
- Evidence: `features/plan/PlanCard.tsx:165,176`, `features/requests/ProposalCard.tsx:144,156,176-184`, `features/checks/ChecklistCard.tsx:134`, `features/requests/RequestCard.tsx:213-257`, `features/needs-you/NeedsYouView.tsx:132-147,149-160`.

### a3-17. Explanatory sentences that restate the label
- Where: Run card, Progress column, check cards, Needs you, Outputs empty state, review dialog.
- Category: slop
- Severity: Medium
- What the user sees: "A change to Milestones applies when each agent next starts." (run card). "None yet. @iris-1382 writes them first, and you can add your own." and "Milestones are off for this task, so nothing is checked against these." (Progress). "Edit the checks, then approve. The checker runs all of them, every round." (checklist). "The results will appear here." and "You approve it here before anything runs." (review card while a check runs). "Checked by X on a temporary copy." (results). "N approvals match these filters. Questions and plans are left out; answer them one by one." (Needs you). `Permissions are set to "Manual". Change` on every permission request under Manual. "When an agent makes a page, image, document or site for you to look at, it shows up here. So do the files the agents change." (empty Outputs). "No checklist yet. The reviewer writes one for you to approve." (review dialog).
- Why it hurts: The brief's rule: label things and stop. Each is a second sentence that the label or the layout already says.
- Fix: Delete them. Keep one short empty label ("No outputs yet", "No milestones yet"). Keep the permission note only as a link ("Permissions: Manual") if the owner wants the shortcut to the department.
- Evidence: `features/task/RunCard.tsx:155-157`, `features/task/ProgressColumn.tsx:244-247,328-332`, `features/checks/ChecklistCard.tsx:81-83`, `features/task/ReviewOffer.tsx:168,260-263`, `features/needs-you/NeedsYouView.tsx:92-100,457-462`, `features/outputs/OutputsPane.tsx:106-111`, `features/task/ReviewDialog.tsx:42`.

### a3-18. Statuses share colours, and To review changes colour between screens
- Where: Tasks, Board, task page, Office door chips.
- Category: inconsistency
- Severity: Medium
- What the user sees: On Tasks, Waiting (clock) and Stopped (minus circle) are the same grey. Piece icons make Waiting, Queued, Stopped and Dropped one grey. An agent "Waiting on sub-agents" uses the same blue as "Working". To review is a violet half circle on Tasks and the Board, but a green eye on the Office door chips. The people column shows a green check for an agent that is not done.
- Why it hurts: The rule is one colour per status. Grey for both "in line" and "cut off" hides a difference that matters (one will start by itself, the other needs the user).
- Fix: Keep the tokens: Needs you amber, Working blue, To review violet (`--review`), Done green, Failed red. Queued stays grey with the clock. Stopped: use the red family at a quieter weight beside Failed (same group as the "Failed or stopped" tab), or ask the owner. Door chip "To review" uses the violet half circle. Agent "Idle" is grey and has no check.
- Evidence: `features/tasks/TaskStatusIcon.tsx:40-50`, `features/work/PieceIcon.tsx:14-38`, `ui/StatusIcon.tsx:34-61`, `features/office/DoorChips.tsx:24`, `styles/tokens.css:23-30`.

### a3-19. The "5.3 MB" figure in the tab row is unlabeled
- Where: Tasks page, right end of the tab row.
- Category: readability
- Severity: Low
- What the user sees: A small grey database icon and "5.3 MB" with no label. The only explanation is a tooltip ("Task history on this computer"). It turns amber only at 1 GB.
- Why it hurts: Most of the time it is noise on the main task page; a user cannot guess what it measures. At 1000 px it pushes the last tab off (a3-7).
- Fix: Show it only once it is large (it already turns amber at 1 GB), with the word "History" before the size, and put the always-on figure in Settings. Keep the tooltip text.
- Evidence: `features/tasks/TasksView.tsx:116-134,399`; shots `tasks-dark`, `tasks-1000`.

### a3-20. The "who" column has four formats, and rows reserve blank space
- Where: Tasks rows.
- Category: inconsistency
- Severity: Low
- What the user sees: Department tasks show two overlapping faces and "Lead + 1". Group tasks show faces and "3 agents". Chief goals show the chief's name. Solo tasks show the model name. Under Group by Status or Day the column shows the team name instead. For most rows (finished, To review) the progress column and the buttons column are empty: about 220 px of blank space, so a long title is cut while the row is half empty.
- Why it hurts: "Lead + 1" is cryptic (lead plus one worker). Nothing in the row explains it.
- Fix: One format: faces and "2 agents" for every team task. Let the title use the empty progress and button space (grid columns that collapse when empty, or `minmax` instead of fixed 110 and 112 px).
- Evidence: `features/tasks/TaskRow.tsx:23-73`, `features/tasks/TasksView.module.css:274-282,365-375`; shots `tasks-dark`, `tasks-status`.

### a3-21. Status icons in rows have no visible tooltip
- Where: Tasks rows, Board cards.
- Category: readability
- Severity: Low
- What the user sees: Seven icon-only statuses (dot, spinner, clock, half circle, check, minus, x). Hovering shows nothing; the word exists only as an accessibility label.
- Why it hurts: A half circle for To review is not self-evident; the user learns it only from group headings.
- Fix: Add a `title` with the status word to `TaskStatusIcon` (cheap), and keep the group counts as they are.
- Evidence: `features/tasks/TaskStatusIcon.tsx:27-55`.

### a3-22. "Loading…" and other texts ending in "…"
- Where: Show older tasks button, trace, run card, outputs, chat, attachments.
- Category: slop
- Severity: Low
- What the user sees: "Loading…" (button and trace and chat), "Loading the task…", "Counting…" (tokens), "Reading the outputs…", "Opening the site…", "Loading the page…", "Reading the file…", "Adding…", "Sending to X…".
- Why it hurts: The brief lists text ending in "…" as slop.
- Fix: Drop the ellipsis ("Loading", "Counting"), or show a spinner with no text.
- Evidence: `features/tasks/TasksView.tsx:551`, `features/task/SessionTrace.tsx:153`, `features/task/RunCard.tsx:227`, `features/task/TaskView.tsx:84`, `features/outputs/OutputsPane.tsx:95`, `features/outputs/Viewer.tsx:626,842`, `features/chat/ChatTab.tsx:179`, `features/attachments/PickedFiles.tsx:16`.

### a3-23. A sub-agent is titled "Sub-agent: Agent: …" and cut off in the people column
- Where: Task page, trace card, sub-agent panel and people column.
- Category: readability
- Severity: Low
- What the user sees: The card in the trace reads "Sub-agent: Agent: Sleep then count files" (two prefixes). In the people column the same sub-agent is "Agent: Sleep then c…", cut off after about 14 characters, and its only status is a tiny check.
- Why it hurts: The key part of the name is cut, and the prefix says it twice.
- Fix: Strip a leading "Agent:" from the title once, in one place. Let the row title wrap to two lines.
- Evidence: `features/task/SubAgentCard.tsx:55,118-123`; shots `task1-worker`, `task1-worker-sub`.

### a3-24. The message box has two wordings, and one shows a generic "the agent"
- Where: Task page message box and the Office Chat tab composer.
- Category: inconsistency
- Severity: Low
- What the user sees: The task message box says "Message the agent" while running and "Send a message to continue" when finished. The same send action in the Office Chat tab says "Message @iris-1382". The task page already names the person in the row above.
- Why it hurts: One input, two placeholders. "The agent" is vague on a page with four agents (it goes to the one selected).
- Fix: "Message @iris-1382" in both, and keep "Send a message to continue" only when the session is closed and the box resumes it.
- Evidence: `features/task/MessageBox.tsx:96-101`, `features/chat/Composer.tsx:149`.

### a3-25. The Tasks subtitle skips To review
- Where: Tasks header line.
- Category: readability
- Severity: Low
- What the user sees: "Nothing running." while five tasks wait for review. The line lists running, need you and done today only.
- Why it hurts: To review is the state with the most work for the user, and it is the only one missing; the subtitle reads as "nothing to do".
- Fix: Add "N to review" to the line ("5 to review"), in the same order as Home's tiles.
- Evidence: `features/tasks/TasksView.tsx:298-309,364-366`; shot `tasks-dark`.

## Status language map and proposal

### Every status word in use

Task level (contract `taskStatus`, 7): Needs you, Working, Waiting, To review, Done, Failed, Stopped.
- Shows in: Tasks row icons, tabs (with merges, see a3-5), Status group headings, group counts ("N need you", "N working", "N done"), Tasks subtitle, Board columns (Waiting also holds Failed and Stopped), task menu (by status), Office card "Review" button, door chips (Needs you, Working, To review with a green eye, Queued, "Waits on X", Idle), Home tiles (working, need you, **queued**, to review).

Raw task state (contract `TaskState`, 5: queued, working, waiting, idle, ended), shown with three private maps:
- Home goal chip: Queued / Working / Needs you / Idle / **Done**. Chief page: Waiting its turn / Working / Needs you / **Paused** / **Done**. Workspace page: Waiting its turn / In progress / Needs you / Paused / Done. Chat tab goal header: "Done" when ended.

Agent state (`AgentState`, 9) with `STATE_LABELS`:
- Starting, Working, Waiting on sub-agents, Needs you, **Done (for both idle and done)**, Failed, Stopped, Interrupted.
- Shows in: people rows, run card, solo header pill, Home recent tasks and agent chips, sidebar Active list, Office cards, floor labels, side panel chip, department panel, workspace page, team summary lines.
- Solo header pill adds: "Needs your approval", "Has a question for you", "Waiting for you", plus the stages "Starting the provider", "Waiting for the model", "Thinking".
- Two different summaries of the same grouping: task people tree "N waiting · at work · done · failed · stopped"; Office group "N needs you · working · failed · done · stopped · idle".

Trace and cards: "Finished · send a message to continue", "Finished", "Stopped", "Stopped by X: reason", "Failed with exit code N", "Interrupted · send a message to continue"; review bar "X finished", "X finished and wrote N checks", "N of M checks failed"; result card "X finished / was stopped / could not finish"; delegation thread working / done / failed / stopped / "cut off"; part pills New, Working, Sent back n of 2, Done, Failed, Stopped; sub-agent card "Running for…", "Interrupted", "Finished in…", "Failed in…"; piece icons Waiting, Queued, Working, Done, Failed, Stopped, Dropped; milestone Met / Not met / Being worked on / Not reported / Not started; check outcome pass / fail / not run.

### Minimal consistent set

1. Task status, 7 words, one colour and icon each, shown by `TaskStatusIcon` everywhere a task appears (list, Board, Home, doors, Chief, Workspaces, chat headers, task page header pill): **Needs you** (amber dot), **Working** (blue spinner), **Queued** (grey clock; rename from Waiting), **To review** (violet half circle), **Done** (green check), **Failed** (red x), **Stopped** (see a3-18). Delete the three raw-state maps and the Done-for-ended rule.
2. Agent activity, only on people, 5 words: **Working** (includes Starting; stage words like "Thinking" stay as the sub-line), **Needs you**, **Idle** (finished its turn, quiet grey, no check), **Failed**, **Stopped** (includes Interrupted, with "when the app closed" as the sub-line). An agent never says Done, Finished or To review; "Waiting on N sub-agents" becomes a sub-line under Working.
3. Part outcome (a delegation, in the Progress column and chat cards only): Working, Done, Failed, Stopped, plus the "Sent back n of 2" note. This is the only place a worker is "Done".
4. Keep the other vocabularies separate and local (milestones, checks, sub-agent steps); they describe different things.
5. One status per screen: the header pill is the task status; people rows show activity; the bar shows facts and actions, not a status.

## Cross-area notes

- Sidebar: the "Active" list names each task's state from the agent state, not the task status (a3-3), and reuses `taskMenu` (a3-10). "Your team" shows six identical "Smoke claude 2" rows, which is test data.
- Home "Right now" tile labels are lower case ("need you", "to review") while Tasks tabs are capitalised; Home counts agents for "working" (a3-13).
- Board: the "Waiting" column holds Queued, Failed and Stopped (D-101); see a3-4.
- Office door chips: "To review" uses a green eye instead of the violet half circle (a3-18).
- The lead in `Delegate one sub-agent to Worker` ends with a plain-text question ("Which should I take?"), yet the task is To review with a Mark done bar and nothing in Needs you. A user can miss the question. This is agent behaviour, not UI, but a bar saying "finished" makes it worse.
- Sub-agent panel and Progress column share one slot at the right; both need the narrow-width rule in a3-2.
- Needs you and Tasks "Answer" buttons both open the task; Needs you answers inline. Fine, but the page titles are not aligned (a3-15).

## Keep

- Tasks list paging and counts come from the core (50 at a time, "Show older tasks", counts for every tab, filters and scroll kept per session). It scales to hundreds of tasks.
- Inside each group open work stays on top, and a task that needs the user has the amber row with one "Answer" button.
- The "Who works on this" tree: lead card, role groups, sub-agents nested under the agent that started them, the chosen row highlighted and remembered.
- The review bar above the message box (same width, quiet, one green primary) and "Send for review" under the box, as one place each (D-101).
- Needs you grouped by task with the confirm dialog that breaks a bulk Allow or Deny into kinds of action (D-57).

## Proposed shape

- Task page header: breadcrumb, title, one status pill (same component as the Tasks row), then Progress button, Work/Outputs, and one "Stop" (confirm names the scope). No count chips. "Jump to it" sits beside the pill when the task needs the user. Same for solo, team and chief goal.
- People column heading carries the counts ("2 people · 1 at work"). Rows show activity words (Working, Needs you, Idle, Failed, Stopped) with the stage or "waiting on 2 sub-agents" as the sub-line. Chief goals list their parts here.
- Trace: no "Finished · send a message to continue" line. The run card stays but the pill is labelled "Details" with the chevron removed. The sub-agent title loses the double prefix.
- Review: one bar for review actions (Mark done, Send fixes, Send for review), shown on Work and Outputs. The results card keeps outcomes, "Check again", "Read the check" only. One name per action.
- Narrow width: the right-hand panel (Progress or sub-agent) opens over the trace below about 1100 px; the trace has a minimum width.
- Tasks: tabs named like the statuses, "Queued" for the old Waiting, empty-tab texts that say what is empty, no filter link unless filters are set; header line includes "N to review". The storage figure moves to Settings and shows on Tasks only when large and labelled. Team groups order by urgency, with Collapse all, a compact one-row header and no repeated model line; one "who" format ("2 agents"); empty columns collapse; status icons get tooltips.
- Task menu gains Stop for running tasks.
- Needs you: the same control components as Tasks (tabs or chips for type, `ChoiceMenu` for group and filters), tools panel only from about 6 requests, the same column width, "N need you" wording, no explainer sentences. Request cards share one verb set (Approve, Send back, Decline).
- Home, Chief, Workspaces, chat headers and sidebar Active: read the task status and draw `TaskStatusIcon`; delete the private state maps.
