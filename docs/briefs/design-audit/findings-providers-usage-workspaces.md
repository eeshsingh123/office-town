# a5 audit: Providers, Usage, Workspaces, Library

Method: read the code and decisions (D-6, D-29, D-61, D-64, D-69, D-72, D-76, D-89, D-92, D-96, D-102), looked at the live screens (dark, light, 1000 px wide), opened a provider page, the Add account dialog, the New workspace sheet, the workspace picker and a task's run card (all closed again, nothing changed). Shots are in `scratchpad/shots/a5/`. Where a state is not in the test data (several accounts, an account at its limit, a provider not installed, a Library with files) the finding says "from code". One list was simulated by editing text in the page (no data changed), marked "simulated".

Numbers quoted from the real data: Claude 5-hour went from 15% to 63% during the audit because agents were running on the real account, so some shots show different percentages. That is not a bug.

---

## Providers and Usage

### a5-1. Providers and Usage show the same accounts twice, in different words
- Where: Providers list, provider page, Usage, Home.
- Category: duplication
- Severity: High
- What the user sees: A provider page has an "Accounts" section. It is the same account card that Usage shows (same component, same Rename / Sign in again / Remove menu). The Providers list shows a smaller third version ("Weekly 49%", "0 tokens this week"). Usage says "Weekly 49% used · resets Tue 6:29 PM" and "NO LIMIT DATA". Home has a fourth ("Claude Code · Default · 5-hour 63%"). Account actions are on the cards in both places, but Add account exists only on the provider page.
- Why it hurts: The user has to learn which page owns what. The same number is in four places with four wordings and sometimes a different window, so it looks like they disagree.
- Fix: Split the jobs. Providers = install, sign in, accounts (add, rename, remove, sign in again), shown as account rows without meters. Usage = read-only limits and what will stop. Both use one shared account label (name, email, plan, where it runs) and one limit line ("Weekly 49% used · resets Tue 6:29 PM"). See Proposed shape.
- Evidence: `ProviderView.tsx:148` and `UsageView.tsx:232` both render `AccountGrid`; `ProvidersView.tsx:28-59`; `PlanUsageCard.tsx:37-58`; shots providers-dark, provider-claude, usage-dark, home-plan.

### a5-2. "Manage accounts" does not lead to accounts
- Where: Usage, header button.
- Category: too many steps
- Severity: High
- What the user sees: The button opens the Providers list (six providers). To add a second Claude account the user must then open Claude Code and press Add account. Usage → Manage accounts → Claude Code → Add account is 4 clicks to the Name field (3 from the sidebar's Providers).
- Why it hurts: The label promises accounts but delivers a list of providers. The page already lets the user rename and remove accounts on its cards, so "manage" is half true.
- Fix: Replace it with "Add account" that opens `AddAccountDialog` without a preset (it already starts at its Provider step). That is 2 clicks to the Name field from Usage. Providers gets an Add account on each provider block (preset), so 2 clicks from there too.
- Evidence: `UsageView.tsx:134` and comment `UsageView.tsx:18-19`; `ProviderView.tsx:141-146`; `AddAccountDialog.tsx:65-67`.

### a5-3. The Usage page does not scale: one card per account, one section per provider
- Where: Usage, account sections.
- Category: scalability
- Severity: High
- What the user sees: Each provider is its own section with a 3-column grid, and today each section has one account, so two thirds of every row is empty (usage-dark). At 1000 px wide the grid becomes one column and each card stretches to about 640 px for the same content (usage-1000). The Claude card is 302 px tall; with the heading a section is about 383 px.
- Why it hurts: 6 providers with 3 accounts each is 6 sections, about 2,300 px at 1440 wide and about 5,800 px at 1000 wide (estimate from the measured card height). The four tiles and filters already take the first 330 px. The user cannot compare accounts, sort them, or see at a glance which one stops first.
- Fix: Replace the sections of cards with one table of limit windows (one row per account window), sorted by soonest to run out, with provider as a column and a Provider filter. Accounts without limit data go in a second compact table. Details in Proposed shape.
- Evidence: `Usage.module.css:164-168` (`repeat(auto-fill, minmax(340px, 1fr))`), `UsageView.tsx:224-234`; shots usage-dark, usage-1000.

### a5-4. The warning that matters is the quietest line on the card
- Where: Usage and provider page, account card windows.
- Category: readability
- Severity: High
- What the user sees: At 48% of the 5-hour window the card says "At this pace, runs out 3:18 PM" in small grey text, while the window resets at 5:39 PM. That is more than two hours of being stopped, and it is the least visible text on the card. Under every healthy window, "Lasts until reset" is written in green, so a card with two windows has two green "all fine" lines.
- Why it hurts: The exception (will stop before reset) is grey and the normal case is coloured. At 3 accounts this is six repeated green lines and one easy-to-miss grey one. The run-out line only turns red once the window is already 70% used, which is too late for a 5-hour window.
- Fix: Drop "Lasts until reset" (no text means fine, the marker already shows pace). Put the forecast in its own sortable column, "Runs out", only when it is before the reset, in full-contrast text (red keeps its owner rule of over 90% used). Show it when it is first predicted, not from 70%.
- Evidence: `AccountCard.tsx:84-94` (the tone check on line 88), `Usage.module.css:283-294` (`.pace` grey, `.paceOk` green); shots usage-dark, usage-light, provider-claude.

### a5-5. The stat tiles are mostly noise, and the fourth is wrong-shaped
- Where: Usage, four tiles.
- Category: bad pattern
- Severity: Medium
- What the user sees: "0 at the limit", "0 over 90% used", "2 with usage left", and "Default · Codex · most usage left". In a calm state three of the four say nothing.
- Why it hurts: The user needs "what will stop soon and when it resets". "2 with usage left" is the complement of the other two. "Most usage left" compares accounts across providers and across different windows (a 1% monthly Codex window against a 5-hour Claude window), but accounts are not interchangeable across providers and Automatic only picks inside one provider (D-61). The tile also names the account "Default", so it reads "Default, Codex". At 1000 px it wraps to three lines.
- Fix: Remove the tiles. Show a banner row only when something is stopped, paused or over 90% (one line per account with the reset time), and let the sorted table answer "what is next". If a count is wanted, one line in the page lead, shown only when non-zero.
- Evidence: `UsageView.tsx:165-190`, `UsageView.tsx:64-67` (`roomiest` over all providers); shots usage-dark, usage-1000.

### a5-6. "Default" is not a meaningful account name
- Where: Usage cards and tile, Providers, Home, Office top bar, account picker, sign-in dialog.
- Category: bad pattern
- Severity: High
- What the user sees: Every provider's own login is called "Default": four "Default" cards under four different provider headings, "Claude Code · Default" on Home and in the Office top bar ("Claude Code · Default is at its limit"), "now Default" in the Account picker, and a dialog titled "Sign in to Default". The card sub-line says "Your Claude Code sign-in", which repeats the section heading above it. A default login cannot be renamed because the menu exists only for added accounts.
- Why it hurts: With three accounts the list reads Default, Work, Personal, and "Default" tells the user nothing about whose login it is. The real identity (email, plan) is known, but arrives late (see a5-7).
- Fix: Name an account by who it is. Show the email as the label when no own name is set, with the plan after it ("name@... · Pro"). Use "Default" only as a small tag on the CLI's own login, or drop it. Where an account name is needed in a sentence, use "Claude Code · name@...". This needs no contract change if the email is only displayed; renaming the default login would need the core to allow it.
- Evidence: `AccountCard.tsx:168`, `AccountCard.tsx:200-211`, `limits.ts:82-89` (`"Default"` fallback), `AddAccountDialog.tsx:201`, `TopBar.tsx:22-23`, `SettingsChips.tsx:41-52`; account list from the core shows every default named "Default"; shots usage-dark, usage-scroll, home-plan.

### a5-7. Account identity (email, plan) is fetched per card, uncached, 2 to 5 seconds each
- Where: Usage and provider page, account card header.
- Category: scalability
- Severity: Medium
- What the user sees: Every card opens with "Your Claude Code sign-in" and the email and plan appear several seconds later (in all my shots they had not arrived yet). I timed the core: Claude 4.8 s, Cursor 5.1 s, Codex 1.6 s, OpenCode 0.2 s, and the same call again 2.6 to 4.5 s, so nothing is cached.
- Why it hurts: Each card mount starts one CLI process. Six providers with three accounts is 18 processes each time Usage or a provider page opens, two at a time (D-92), so identities could take about 45 s to fill in, and the Providers, Usage and provider pages each repeat the work.
- Fix: Read each account's identity once in the core, like provider status (D-93), push it with the accounts list, and keep the last known email on the card while it is rechecked.
- Evidence: `AccountCard.tsx:150-160` (one `readAccountStatus` per card), `api/client.ts:443`; timings from `GET /api/accounts/<id>/status`; D-92, D-93.

### a5-8. One state, many names (limit reached, near limit, not signed in, window)
- Where: Usage, Providers, Home, Office top bar, account picker, Needs you.
- Category: inconsistency
- Severity: Medium
- What the user sees: "At the limit" (tile), "Limit reached" (card chip), "is at its weekly limit" (banner), "is at its limit" (top bar), "At its limit" (account picker), "hit its plan limit" (stopped agent). "Over 90% used" (tile), "Near limit" (card chip), no label from 70 to 90%. "Not signed in" is an amber sentence-case pill in the header of a provider page, a grey UPPERCASE chip on the card and "Installed · not signed in" in the Providers list. Windows read "5-hour", "Weekly", "Monthly" on Usage but "5-hour", "monthly" in lower case on Home.
- Why it hurts: One status should have one name, one style and one colour. The two chip systems (22 px pill, sentence case vs 10.5 px uppercase block) also look like two different apps in one screen.
- Fix: Pick one phrase per state ("At limit", "Over 90%", "Not signed in") and one chip component; use it on every page. Always capitalise the window name.
- Evidence: `UsageView.tsx:168-179`, `AccountCard.tsx:188-196`, `TopBar.tsx:74-77`, `SettingsChips.tsx:36`, `LimitStops.tsx:38`, `PlanUsageCard.tsx:43`; `Providers.module.css:86-108` vs `Usage.module.css:232-255`; shots provider-copilot, usage-dark.

### a5-9. "Paused near a plan limit" shows raw limit names
- Where: Home and Needs you, paused tasks.
- Category: inconsistency
- Severity: Medium
- What the user sees (from code): "Paused at 96% of the five hour limit", "seven day limit" or "month limit", while Usage names the same windows "5-hour", "Weekly", "Monthly".
- Why it hurts: Two names for one window on the screen where the user decides to resume.
- Fix: Print `windowLabel` of the window instead of the stored label.
- Evidence: `UsagePauses.tsx:66` prints `pause.window`; `service/src/team/usage-pause.ts:82` stores `limit.label`; the core's `/limits` returns labels "five hour", "seven day", "month".

### a5-10. "Not signed in" appears five times on one provider page
- Where: Provider page for a signed-out provider (Copilot).
- Category: duplication
- Severity: Medium
- What the user sees: A header chip "Not signed in", a header Sign in button, a card chip "NOT SIGNED IN", a full-width Sign in button inside the card, and "This PC: Not signed in" under Runs on. The Providers list adds "Installed · not signed in" and a Sign in button.
- Why it hurts: One status should be shown once per screen. Two Sign in buttons on one page do the same thing. "No agents yet" and "Counted by Office Town" fill the rest of the card.
- Fix: Show the state once in the header (chip plus one Sign in button). Account rows show it only if the provider is signed in and one account is not. Runs on lists environments only when there is more than This PC.
- Evidence: `ProviderView.tsx:109-130`, `ProviderView.tsx:46-52`, `AccountCard.tsx:188-189` and `AccountCard.tsx:214-217`; shots provider-copilot, provider-copilot-light.

### a5-11. A provider with no limit data says the same thing three times
- Where: Usage and provider page, cards of OpenCode, Cursor, Copilot.
- Category: slop
- Severity: Medium
- What the user sees: A chip "NO LIMIT DATA", a box "OpenCode doesn't share plan usage with other apps. See it on opencode.ai", a footer "Counted by Office Town", and two tiles "0 tokens today / 0 tokens this week". The Cursor card has the sentence but no link.
- Why it hurts: Three statements of one fact. "Other apps" clashes with Apps meaning connectors (D-96). "Counted by Office Town" is internal. Zero tiles are noise on an unused account. The dollar estimate (D-76) is dropped completely when any one model has no price, and hidden at 0 tokens.
- Fix: In the table one cell reads "Not reported" (muted) with the provider's usage link when known. Tokens this week and "About $x at API prices" are columns; an estimate with unpriced models shows "at least $x". Remove the footer and the zero tiles.
- Evidence: `AccountCard.tsx:194-196`, `AccountCard.tsx:228-252`, `AccountCard.tsx:270-275`; `AccountGrid.tsx:28-32` (`estimateOf`); shots usage-scroll, provider-cursor.

### a5-12. The user cannot see which agents use an account
- Where: Usage and provider page, card footer.
- Category: too many steps
- Severity: Medium
- What the user sees: Up to four coloured initials and "12 agents" ("H S A H"). Nothing is clickable and no name is available.
- Why it hurts: "Which agents use this account" has no route at all today: the only other place is each agent's profile, where the Account chip appears only when the provider has two accounts. With 100 agents the footer says "100 agents".
- Fix: Make the agents cell a button that opens a small list (name, team, working or free); each row opens the agent. 2 clicks from Usage.
- Evidence: `AccountCard.tsx:255-269`, `ui/Avatar.tsx` (aria-hidden initials only), `AccountGrid.tsx:49-60`; shot usage-dark.

### a5-13. An account's location (This PC or WSL) is invisible, and counts disagree
- Where: Usage cards, provider page, Providers list.
- Category: inconsistency
- Severity: Medium
- What the user sees (from code): Cards never say where the account runs. The provider page lists accounts of every environment, but the Providers list counts only This PC ("1 account"). The Add account dialog does let the user choose "Runs on" when WSL exists.
- Why it hurts: Two accounts both named "Work", one on Windows and one in WSL, look identical and are counted differently on two pages.
- Fix: Show a small "WSL · Ubuntu" tag on any account that is not on This PC, and count all environments in the Providers row.
- Evidence: `AccountCard.tsx` (no environment), `ProviderView.tsx:87` vs `ProvidersView.tsx:80-83`, `AddAccountDialog.tsx:256-273`.

### a5-14. Usage by team: same-named teams merge, and the table has no limit
- Where: Usage, last section.
- Category: scalability
- Severity: Medium
- What the user sees: The six departments named "Smoke claude" appear as one row (12 tasks, 193k tokens, 100%). The column "Share of the account's tokens" is long and the table has one row per team and account with no search, sort or "show more".
- Why it hurts: Department names are not unique, so rows are keyed by name and merge. With 20 teams and 3 accounts the table can reach 60 rows in arrival order of tokens.
- Fix: Key rows by department id, show the first 8 with "Show all", name the column "Share of account". The same table can then hold the per-account view once an account filter is chosen.
- Evidence: `UsageView.tsx:84-108` (key `${team}/${row.accountId}`), `UsageView.tsx:262`; shot usage-bottom.

### a5-15. The Providers row text is fixed at 180 px and breaks with more than one account
- Where: Providers list, right side of a row.
- Category: UI bug
- Severity: Medium
- What the user sees: With one account it reads "Weekly 49%". With two or more the label becomes "Weekly, account with the least left" and wraps to two lines, making that row taller than the others (simulated, shot providers-sim). It does not say which account, shows no reset time and no "used".
- Why it hurts: At 3 accounts per provider every row grows and the key fact (which account is low) is missing.
- Fix: Use the shared limit line from a5-1 ("Weekly 91% used · resets Tue 6:29 PM") with the account in the row below it. When several accounts are low, "2 of 3 accounts over 90%".
- Evidence: `ProvidersView.tsx:42-48`, `Providers.module.css:188-195` (`width: 180px`); shot providers-sim.

### a5-16. The same limit appears in five slices and wordings
- Where: Home "Plan usage", Providers list, Usage, account picker, Office top bar.
- Category: inconsistency
- Severity: Medium
- What the user sees: Home: "Claude Code · Default · 5-hour" with a bar and "63%", no reset time unless full, windows in lower case ("monthly"), and only five rows with no "more" hint. Providers: "Weekly 49%". Usage: "63% used · resets 5:39 PM". Account picker: "63% used" without naming the window. Top bar: "is at its limit".
- Why it hurts: Each place shows the fullest window but never says so the same way, so users can read "63%" and "49%" as a contradiction. Silent cut-off at five accounts hides the others.
- Fix: One `LimitLine` format everywhere (window, % used, reset), one "fullest window" rule, and "+N more" with a link on Home.
- Evidence: `PlanUsageCard.tsx:8`, `PlanUsageCard.tsx:43,55-57`, `ProvidersView.tsx:43-46`, `SettingsChips.tsx:34-37`; shots home-plan, providers-dark.

### a5-17. Meter details: the tick has no key, and Show Left leaves the bar on Used
- Where: Usage cards.
- Category: readability
- Severity: Low
- What the user sees: A faint tick on each bar (an even-pace marker) with no legend, tooltip or label. The filter "Show Used / Left" flips the words ("59% left") while the bar still fills by used, and its tone colours stay by used. "Show Used" reads like a filter for used accounts.
- Why it hurts: A marker nobody can name is decoration. A bar that fills the other way from its number is a trap.
- Fix: Label the tick through the table column "Runs out" instead of the marker (or give it a tooltip "Even pace"); if Show Left stays, fill the bar by what is left. Move it into the table header as a small "Used | Left" switch.
- Evidence: `AccountCard.tsx:59-61` (aria-hidden, no title), `AccountCard.tsx:70,83`, `UsageView.tsx:212-220`.

### a5-18. The Add account and sign-in dialog: unlabeled provider, long list, wrong title
- Where: Add account dialog (provider page), Sign in on the Providers list.
- Category: bad pattern
- Severity: Medium
- What the user sees: The dialog is called "Add account" and does not say which provider (the page behind is covered); its step bar (Name, Sign in, Use it for) is an underline strip, unlike the numbered pill steps of the Install sheet. The last step lists every team that uses the provider as one long single-choice list (six identical "Smoke claude" in this data); the dialog scrolls and Done scrolls out of sight. Pressing Sign in on the Providers list opens a dialog titled "Sign in to Default" and starts the browser sign-in at once. The waiting text reads "Finish signing in in your browser".
- Why it hurts: The user cannot confirm the provider. A team list with 20 teams has no search, and only one team can be picked.
- Fix: Title "Add Claude Code account" and "Sign in to GitHub Copilot CLI" (provider name, not the account name). Use the one step bar style from the Install sheet. In "Use it for" allow several teams with a search above 6, and keep the footer fixed.
- Evidence: `AddAccountDialog.tsx:200-202`, `AddAccountDialog.tsx:207-216`, `AddAccountDialog.tsx:363-394`, `AddAccountDialog.tsx:315`; `Usage.module.css:549-568` vs `Providers.module.css:323-367`; shot add-account (dark).

### a5-19. Install sheet and sign-in flow: five words to leave, and filler lines
- Where: Install sheet, Add account dialog.
- Category: inconsistency
- Severity: Low
- What the user sees: Leaving a step is "Cancel", "Close", "Later" or "Done" depending on the step. Ready step: "Pick it for an agent in the model menu, or in a template or team." Sign-in step: "This account stays separate from your other X sign-ins." Install step: "Runs X's own installer. It takes a minute or two." Page leads: "The providers your agents run on, and your accounts on them." and "Plan limits for each account your agents use."
- Why it hurts: These lines restate the screen or reassure; a real app labels and stops.
- Fix: Use Cancel on steps before the end and Done at the end ("Later" becomes Cancel). Remove the Ready hint, the "stays separate" line and the page leads.
- Evidence: `InstallSheet.tsx:108-134`, `InstallSheet.tsx:150-153`, `InstallSheet.tsx:179-181`, `AddAccountDialog.tsx:321-323`, `ProvidersView.tsx:96`, `UsageView.tsx:123`.

### a5-20. Providers list order and content
- Where: Providers list.
- Category: bad pattern
- Severity: Low
- What the user sees: Rows are in the core's fixed order, so a provider that needs a Sign in sits between two ready ones. The sub-line is "1 account · version 2.1.325" and "2026.10.22-27dcf5f".
- Why it hurts: The row that needs the user is not first, and a version string is the most prominent detail while the thing the user came for (is it ready, how much is left) is a small grey label.
- Fix: Sort providers that need a sign-in first, then ready ones. Move version to the provider page.
- Evidence: `ProvidersView.tsx:75-79`, `ProvidersView.tsx:21-25`; shot providers-dark.

### a5-21. Usage empty and paused states
- Where: Usage, first-run and 95 to 99% states.
- Category: bad pattern
- Severity: Medium
- What the user sees (from code): With no provider set up the page shows "No accounts match." and no next step. Past 95% of a window tasks are paused (D-72) but Usage shows only a "Near limit" chip; the Paused and Resume now actions live on Home and Needs you, and the red banner on Usage appears only at 100%.
- Why it hurts: "No accounts match" blames a filter that was never used. A user who goes to Usage to ask why tasks stopped gets no answer.
- Fix: Empty state: "No providers ready" with a Providers button. Add paused tasks to the Usage banner ("2 tasks paused at 96%, Resume now") using the existing `UsagePauses` list.
- Evidence: `UsageView.tsx:223`, `UsageView.tsx:138-163`, `UsagePauses.tsx`; D-72.

### a5-22. Usage filters are lost on leaving the page
- Where: Usage, search, Provider, Show and Period.
- Category: inconsistency
- Severity: Low
- What the user sees (from code): Workspaces, Tasks and Team keep their search and filters while the app runs; Usage resets them.
- Why it hurts: D-81 says where the user was on a screen is kept for the session.
- Fix: Use `forSession` with `useKept` as Workspaces does.
- Evidence: `UsageView.tsx:31-34` (`useState`) vs `WorkspacesView.tsx:151-158`; D-81.

### a5-23. Three page widths and three header patterns
- Where: Providers, Usage, Workspaces, workspace page.
- Category: inconsistency
- Severity: Low
- What the user sees: Providers and the provider page use an 880 px column, Usage 1120 px, Workspaces 1180 px, so the page title moves 106 px sideways between the Providers and Usage clicks (left edge x=382 vs x=276 at 1440). Providers and Usage have a lead under the title; Workspaces has an info icon; the workspace page has neither.
- Why it hurts: The title jumping between neighbouring sidebar pages feels like a different app; header patterns differ for the same kind of page.
- Fix: One max width for list pages (1120 px) and one header: title, optional lead, actions on the right.
- Evidence: `Providers.module.css:2-8`, `Usage.module.css:2-9`, `Workspaces.module.css:2-8`; shots providers-dark vs usage-dark.

### a5-24. Where the choice is made, usage is invisible
- Where: Model picker, run card, account picker.
- Category: bad pattern
- Severity: Medium
- What the user sees: The model picker (`ModelChip`) lists models by cost but shows no usage, so a user can pick Opus 5.5 on an account at 95% with no hint. The only usage in the choice is the Account chip, and it appears only when the provider has two or more accounts ("63% used" without saying which window). The run card of a running agent shows tokens and "Claude Code · Windows" but not the account it runs on.
- Why it hurts: The user learns about the limit when the task stops. D-72 pauses tasks past 95%, so a task can start and pause at once.
- Fix: In the picker's provider heading and the account list use the shared limit line ("Weekly 91% used · resets Tue"), and on the run card add the account to the provider row ("Claude Code · name@... · Windows").
- Evidence: `ModelChip.tsx`, `ModelList.tsx` (no limits), `SettingsChips.tsx:23-52`, `RunCard.tsx:187-199`; shot task-runcard.

### a5-25. Provider page: crowded header and a slow "Checking…"
- Where: Provider page.
- Category: readability
- Severity: Low
- What the user sees: One grey line carries "Official, by Anthropic · version 2.1.325 · Works with a Claude Pro, Max, Team or Enterprise plan", and a lead repeats the summary under it. "Runs on" shows "Ready" again beside This PC, and WSL stays on "Checking…" (I measured about 11 s for the WSL status read).
- Why it hurts: Three facts in one line and no progress for 11 seconds.
- Fix: Move "Works with…" into the Sign in step; show Runs on only when a second environment exists; show a spinner in the row.
- Evidence: `ProviderView.tsx:117-120`, `ProviderView.tsx:41-52`; shot provider-claude.

---

## Workspaces and Library

### a5-26. Workspace paths are cut at the end, hiding the folder name
- Where: Workspaces cards, workspace page Folders list.
- Category: readability
- Severity: Medium
- What the user sees: "C:/Users/<you>/AppData/Local/Temp/c…" on every card. The part that tells workspaces apart (the last folders) is the part that is cut off, and only a tooltip shows it.
- Why it hurts: Several projects live under the same parent, so all cards read the same. In the test data they are all named "Smoke" too, which makes the cards impossible to tell apart.
- Fix: Cut in the middle or from the start so the last two folders stay ("…/Temp/smoke-claude4"), with a copy action. Reuse one path component in the card, picker and Folders list.
- Evidence: `Workspaces.module.css:128-135` (`text-overflow: ellipsis`), `WorkspacesView.tsx:105-108`, `WorkspaceView.tsx:209`; shots workspaces-dark, workspace-page.

### a5-27. The workspace picker does not put the current pick first and loses the path
- Where: Composer workspace chip and the picker list.
- Category: bad pattern
- Severity: Medium
- What the user sees: The popover holds "Recently used" (the first three by last use) and "Others". The current pick ("Scratch") sat in Others, last in the list, marked only by a soft tint. Each option's second line is the team names if a team uses it, else the folder path, so two same-named workspaces used by the same team show the same two lines. Search appears only above four workspaces.
- Why it hurts: The brief's rule is that the current pick goes first in long lists. Without a path or a check mark the user cannot tell which of several "Smoke" entries is picked.
- Fix: List the current pick first with a check mark (as the other menus do). Always show the shortened folder name on the second line; put team names in a third small line or in the Workspaces page only.
- Evidence: `WorkspacePicker.tsx:85-91`, `WorkspacePicker.tsx:42-61`, `WorkspacePicker.tsx:145`, `Workspaces.module.css:365-367`; picker DOM captured in the audit (RECENTLY USED, then Smoke x3, OTHERS, Smoke x3, Scratch).

### a5-28. From a task there is no way to the workspace or its Library
- Where: Task page and run card.
- Category: too many steps
- Severity: Medium
- What the user sees: The task header says "Tasks / Smoke claude" and never names the workspace. The agent chip opens a run card with the model, "Claude Code · Windows" and a folder alias ("smoke-claude4") that opens Explorer. There is no link to the workspace page or its Library. To reach the workspace's Library from a task: sidebar Workspaces, find the card (the task does not say which one), Library tab = 3 clicks plus a guess.
- Why it hurts: The files an agent was given are the first thing a user wants to check when a task goes wrong.
- Fix: In the run card, name the workspace and make it a link ("Smoke · Library" opens the workspace's Library tab). 2 clicks from the task.
- Evidence: `RunCard.tsx:200-216`, `run-facts.ts:75-80`; `WorkspaceView.tsx` tab navigation; shots task-page, task-runcard.

### a5-29. A Library file's "…" menu is a different menu from its right-click menu
- Where: Workspace Library, item rows.
- Category: inconsistency
- Severity: Medium
- What the user sees (from code): The "…" menu is a hand-built dropdown with plain text rows (Show in folder, Replace with a new version, Remove from Library) and no icons. The right-click menu offers Open, Show in folder, Copy path. Clicking the row does nothing, and the only way to open the file is the right-click menu.
- Why it hurts: D-89 says the "…" and right-click menus come from one list so they never drift, and the app-wide menu is `MoreMenu` with icons. Here Replace and Remove exist only in one of them and Open only in the other.
- Fix: Build one `MenuContent` for a Library item (Open, Show in folder, Copy path, Replace with a new version, Remove from Library in red) and draw both menus from it with `MoreMenu`. Clicking the name opens the file.
- Evidence: `LibraryTab.tsx:37-90` (own `DropdownMenu`), `LibraryTab.tsx:104` (`fileMenu`), `ui/ActionMenu.tsx:21-26`, D-89.

### a5-30. "Given to" only lists teams whose default workspace this is
- Where: Library, Given to menu and filter, department Files section.
- Category: UI bug
- Severity: Medium
- What the user sees (from code): A department can work in several workspaces (D-69). The workspace page's "Used by" lists every one of them, but the Library's "Given to" menu and filter list only the departments whose default workspace this is. A department's own Files section also reads only its default workspace's Library.
- Why it hurts: A team that works here as a second workspace cannot be given a file from this Library, and the empty text "No department works in this workspace yet." is wrong.
- Fix: List departments whose `workspaceIds` include the workspace (the rule the workspace page already uses). In the department's Files section, add a workspace choice when it has more than one.
- Evidence: `GivenToMenu.tsx:13-18` (`department.workspaceId === workspaceId`) vs `service/src/workspace-usage.ts:54-57` (`workspaceIds.includes`); `DepartmentSettings.tsx:279`; contract `team.ts:50-53`.

### a5-31. The Library shows four dead filters when it is empty
- Where: Library tab with no files.
- Category: slop
- Severity: Low
- What the user sees: Search, "Given to All", and "All 0 / Files 0 / Images 0 / Folders 0" above an empty dashed box that says "No files yet".
- Why it hurts: Controls with nothing to act on and zeros are noise.
- Fix: Show the filters only once there are items (about 8 or more for search; chips only when two kinds exist), keep the Add buttons.
- Evidence: `LibraryTab.tsx:229-298` vs `LibraryTab.tsx:318-324`; shot workspace-library.

### a5-32. The "Given to" menu is one long checkbox list
- Where: Library item rows and the department Files section.
- Category: scalability
- Severity: Low
- What the user sees (from code): One menu with Everyone, then every department and every agent in it, no search. 10 departments of 5 agents is 60 rows.
- Why it hurts: Hard to find one agent; the trigger text joins all names with commas.
- Fix: Add a search above 12 rows, collapse each department's agents under it, and show "3 teams" instead of names beyond two.
- Evidence: `GivenToMenu.tsx:100-143`, `library.ts:52-62` (`audienceNames` joins every name).

### a5-33. Workspaces pages are tighter than the spacing rule
- Where: Workspaces list, workspace page.
- Category: UI bug
- Severity: Low
- What the user sees: 28 px between sections and columns (rule: 40 px) and 10 px inside a block (rule: 16 px). Providers and Usage use 40 px.
- Why it hurts: Same-looking pages breathe differently.
- Fix: Page gap 40 px, block gap 16 px, column gap 40 px.
- Evidence: `Workspaces.module.css:2-8`, `Workspaces.module.css:576-604`, `Workspaces.module.css:719-725`; `Usage.module.css:2-9`.

### a5-34. Workspaces list: two "New workspace" buttons and three ways to open a card
- Where: Workspaces list.
- Category: duplication
- Severity: Low
- What the user sees: A primary "New workspace" in the header and a dashed "New workspace" card at the end of the grid. Each card can be opened by clicking it, by its Open button, and by the "…" menu's Edit.
- Why it hurts: Same action, same label, twice; an Open button on a card that is already a button adds weight.
- Fix: Keep the header button (it does not move), drop the dashed card; drop the Open button and keep the card click.
- Evidence: `WorkspacesView.tsx:194-197`, `WorkspacesView.tsx:244-249`, `WorkspacesView.tsx:133-146`; shot workspaces-dark.

### a5-35. Reassurance and explainer lines in Workspaces
- Where: Workspaces list, workspace page, New workspace sheet, toasts.
- Category: slop
- Severity: Low
- What the user sees: Toast "Removed X from the list. Its folders and files are untouched." Card lines "No one working here now" and "Each task gets its own new folder". Sheet hints "Agents work in this folder." and "Other folders the agents need, read-only or editable." Page banner "Give one of them its own workspace if that is a problem." Section "Agents' own copies" with "merged by its lead".
- Why it hurts: These restate the label or reassure; "copies" and "merged" are internal terms.
- Fix: Toast "Removed X". Show the "working now" line only when someone is working. Keep the sheet's field labels and drop the hints. Keep the warning "Both edit this workspace" and cut the advice. Rename "Agents' own copies" to "Branches".
- Evidence: `WorkspacesView.tsx:29`, `WorkspacesView.tsx:116-127`, `WorkspaceSheet.tsx:165-169,176-178`, `WorkspaceView.tsx:117-127`, `WorkspaceView.tsx:254-266`.

### a5-36. Workspace page: recent tasks stop at five, and Edit twice
- Where: Workspace page.
- Category: scalability
- Severity: Low
- What the user sees: "Recent tasks" shows five (the header says, for example, "37 tasks") with no way to the rest. The header has an Edit button and a "…" menu that also contains Edit.
- Why it hurts: A busy workspace hides its history, though Tasks already filters by workspace. Edit twice in one place.
- Fix: Add "All 37 tasks" opening Tasks filtered to this workspace. Keep the "…" menu for Remove only.
- Evidence: `service/src/store/queries.ts:509` (`LIMIT 5`), `WorkspaceView.tsx:69-92`, `tasks/TasksView.tsx:259-287`.

---

## Cross-area notes
- Home: the Plan usage card sits below Getting started, so a stopped account shows after the checklist; the top bar chip appears only at 100% (Office).
- Home / Needs you: `UsagePauses` and `LimitStops` use their own row layout; they should share the Usage table's row for an account (task and team areas).
- Task run card: the "Efficient mode" and "Milestones" switches carry a two-line explainer each time the card opens, and a "Defaults for new tasks are in Settings" link (task area, possible slop).
- Departments: the Add account "Use it for" step and department Files section only know the default workspace (D-69).
- Dev data: every department is named "Smoke claude" and every workspace "Smoke", which hides name-based problems in the pickers; names that are not unique are possible in real use.

## Keep
- The Providers list rows: logo, one name, one short line and a clear Sign in where needed. A whole row is the click target.
- The Install sheet: Install, Sign in, Ready steps; the app runs the vendor installer, falls back to a copy-able command, and rechecks when the window returns.
- The pace forecast itself (runs out at X before the reset) and the honest fallbacks: tokens and a labelled estimate at API prices where a provider shares no plan usage (D-29, D-76). Only their emphasis changes.
- Stopped-agent recovery on Home and Needs you ("Continue on Work", "Resume at 5:39 PM") with a banner linking to it.
- The workspace picker's "Recently used" group with search above four, the Library's drop-anywhere upload and "Given to" model, and "Folder not found" on cards.

## Proposed shape

Split the jobs. Providers is where you get ready (install, sign in, accounts). Usage is where you see how much is left and what stops first. Both draw accounts the same way.

**Shared pieces (new, small)**
- One account label: nickname if set, else the email ("name@..."), then plan ("Pro"), then a small "WSL · Ubuntu" tag only if not on This PC. "Default" disappears as a name. Read once in the core and cached (a5-7).
- One limit line: "Weekly 91% used · resets Tue 6:29 PM" (window always capitalised). Used on Providers, Usage, Home, the model picker's provider heading and the Account chip.
- One status chip component (pill, sentence case): Ready, Not signed in, Not installed, At limit, Over 90%, Not reported. Each shown once per screen.

**Providers**
- One block per provider, ordered with "Not signed in" first, then ready. Block header: logo, name, one status chip, "Runs on This PC · WSL" in grey, and the one action that fits (Install, Sign in, or Add account when it is ready and keeps several accounts).
- Under the header, one 44 px row per account: label, email and plan, environment tag if needed, a one-line limit summary that links to that account on Usage, and the "…" menu (Rename, Sign in again, Remove). 6 providers with 3 accounts is about 24 rows, roughly 1,100 px; search appears above 8 accounts.
- The provider page stays for details (version, Runs on with the WSL commands) and reuses the same account rows. No meters on Providers.
- Dialogs titled by provider ("Add Claude Code account", "Sign in to GitHub Copilot CLI"), one step bar style (the Install sheet's), Cancel before the end, Done at the end.

**Usage**
- Header: title, "Refresh" with "Updated 2 min ago" beside it, and "Add account" (opens the Add account dialog at its Provider step) in place of "Manage accounts". No lead, no tiles.
- Banner area shows only when needed, one row per account: "Claude Code · Work: stopped at the weekly limit, 2 agents, resets Tue 6:29 PM [Open Needs you]" and "2 tasks paused at 96% [Resume now]". Nothing is shown when calm.
- Controls on one line: Search, Provider, Status (All / Over 90% / At limit / Not reported), and a small "Used | Left" switch at the table's right.
- Main "Limits" table, one row per account window, default sort "Runs out first" (others: Most used, Resets soonest, Provider). Columns: Account (logo + provider + label), Window, Used (meter and %), Resets ("5:39 PM · in 3 h 36 min"), Runs out (only when before the reset, full-contrast text), Agents (stack and count, opens a list). Rows are 44 px; provider shown as a muted group label so 6 providers with 3 accounts and two windows each is about 30 rows, roughly 1,300 px, against about 2,300 px of cards (5,800 px at 1000 px). At 1000 px the Runs out column merges into Resets and Agents hides; no horizontal scroll.
- Second compact table "Not reported by the provider" for OpenCode, Cursor, Copilot, Muse: Account, Tokens today, Tokens this week, "About $x at API prices", and the provider's usage link. One note above it, once. No zero tiles, no per-card sentence.
- "Usage by team" below: keyed by department id, first 8 rows with "Show all", column "Share of account".
- Filters and Period kept for the session (`useKept`).

**Home, picker, run card**
- Home "Plan usage": same limit line and rows, top 5 by soonest to run out, with "+N more" linking to Usage.
- Model picker: the provider heading carries the limit line of the account Automatic would pick; the Account chip lists accounts with the same line.
- Run card: provider row reads "Claude Code · name@... · Windows" and a workspace link ("Smoke · Library").

**Click counts, before → after**
- Add a second Claude account (to the Name field): 3 from Providers (Providers, Claude Code, Add account), 4 from Usage (Usage, Manage accounts, Claude Code, Add account) → 2 from Providers (Providers, Add account on the Claude block) or 2 from Usage (Add account, Next; Claude is preselected).
- See when Claude resets: 1 (Usage; first card, below four tiles) → 1 (Usage; first row), and 0 extra from Providers and Home because the limit line shows the reset.
- See which agents use an account: not possible today (four initials and a count) → 2 (Usage, agents cell opens the list).
- Sign in to Copilot: 2 (Providers, Sign in; browser opens at once; dialog titled "Sign in to Default") → 2 with the same flow and the title "Sign in to GitHub Copilot CLI".
- Open a workspace's Library from a task: 3 plus guessing which workspace (Workspaces, card, Library tab) → 2 (agent chip, workspace link).

**Workspaces and Library**
- List: header "New workspace" only (drop the dashed card); cards open by click, without an Open button; paths cut in the middle; spacing 40 and 16.
- Picker: current pick first with a check mark, shortened folder name always visible, search above four.
- Library: filters only once items exist; one `MenuContent` per item for both menus (Open, Show in folder, Copy path, Replace, Remove); name click opens the file; Given to lists every department that works in the workspace, with search above 12 rows.
- Workspace page: "All N tasks" link, one Edit, section gap 40.
