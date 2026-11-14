# a4: Connectors, end to end

Read first: D-67, D-68, D-96, D-98, D-100 (DECISIONS.md), RULES.md, all of `features/connectors`, and where connectors show elsewhere (department panel and settings, agent panel, composers, Needs you asks, Ctrl K, sidebar dot).
Captures are in `scratchpad/shots/a4/` (dark, light, 1000 px, Add sheet, app pages, audience menu, @ picker). The test data has 7 apps (1 Claude, 6 Codex), all given to Everyone, none shared through the hub, none needing renewal. States and screens the data cannot show are marked "from code".
One measurement came from a throwaway DOM test (cloning cards in the page, nothing saved): 7 apps give a 1,517 px page, 39 cards give 3,110 px.

---

## High

### a4-1. The apps page is a wall of big cards with no filter, sort or grouping
- Where: Connectors page, "Your apps" and "Suggested".
- Category: scalability
- Severity: High
- What the user sees: Seven apps already fill three rows of 280 x 160 cards. Each card holds a logo, a tiny provider circle, a name and "N actions", and most of the card is empty. With 39 cards the page is 3,110 px tall, about 3.7 screens. At 1000 px wide there are two columns, so 40 apps are 20 rows. The only tool is a name search. There is no filter by provider, by who has access, or by status, no sort other than "Needs renewing first, then A to Z", and no grouping. Eight more big "Suggested" cards always follow below the user's own apps. The column is capped at 880 px (Tasks uses about 1060), so the empty space inside each card cannot be reclaimed.
- Why it hurts: With 40 apps across 4 providers and 10 departments the user cannot answer "which apps does Codex have", "what needs renewing", or "what can Marketing use" without reading every card.
- Fix: Replace the grid with list rows and give the page the same structure as the Tasks page: tabs with counts (All, Needs you, Turned off), a search field, filter chips built with `menu.chip` (Provider, Who can use it, Permission) and a Group by menu, kept per session with `useKept`/`forSession` as `TasksView` does. Row layout is in "Proposed shape". Widen the column to the Tasks width.
- Evidence: ConnectorsView.tsx:125-132 (sort), 182-186 (grid), 190-228 (Suggested); Connectors.module.css:2-8 (880 px), 166-184 (`.grid` 240 px columns, `.card` 20 px padding, `height: 100%`); shots list-dark, list-1000-light, list-scroll-light; scroll heights measured in the page.

### a4-2. A card says nothing a user can act on: raw internal names, "N actions", no access, permission or status
- Where: Connectors page, each card in "Your apps".
- Category: readability
- Severity: High
- What the user sees: Three of seven cards are called `codex_app`, `cua_repl` and `node_repl`, with a grey "C" or "N" tile. Two more (Plugin Management, Search Service) have no logo either. The text under the name is "8 actions", "3 actions", "4 actions", or nothing at all (`codex_app`). Claude Docs shows "8 actions" while Hugging Face shows a description, so cards in the same grid carry different kinds of text. Nothing on the card says who can use the app, whether it asks first, or whether it is on or off. On the app page the same Codex servers are described as "Signed in through Codex", which is not true: they are servers from the user's own Codex settings and need no sign-in.
- Why it hurts: A user cannot tell `cua_repl` from `node_repl` or know that they are Codex's own tooling and not apps they connected. Every card looks identical apart from one word.
- Fix: Show per row: name (clean it for display: no underscores, capital first letter), one line of "what it does" or, if none, where it comes from ("From your Codex settings"), provider chips with names, who has access ("Everyone", or "Marketing, Support +1"), permission ("Ask me first"), status, last used. Put the Codex-settings servers in their own collapsed group so Codex's own tools do not sit among the apps the user connected; they stay reachable there (say so in the release note, since this moves an existing entry). On the app page, change "Signed in through Codex" to "From your Codex settings" for servers whose app id starts with `server:`.
- Evidence: ConnectorsView.tsx:49-52 (`description ?? "N actions"`), 33-65; ConnectorView.tsx:52-63 (`signedInText`); shots list-dark, app-cua_repl-dark.

### a4-3. One broken action name blanks the whole actions list and shows raw validation JSON in a toast
- Where: App page of `cua_repl` (3 actions), "What agents can do".
- Category: UI bug
- Severity: High
- What the user sees: Opening `cua_repl` shows the heading "What agents can do" with nothing under it, and a toast at the bottom containing raw JSON: `[{ "origin": "string", "code": "too_small", "minimum": 1, ... "path": ["tools", 0, "name"] ...`. The card on the list promised "3 actions".
- Why it hurts: It is a developer error shown to the user, the section looks broken, and the permission groups (Reads / Changes) cannot be checked for this app. One action with an empty name hides every action of the app, which is the wrong failure mode when a user has dozens of servers.
- Fix: In `useActions`, catch the schema failure, show a plain sentence in the section ("Could not read this app's actions") instead of a toast, and drop only the bad action instead of failing the whole list. Also show a quiet placeholder while loading so the heading never stands alone. Fix at the source too: the core should not send an action with an empty name.
- Evidence: ConnectorView.tsx:219-239 (`useActions`, toast with `errorText`), 360-362 (renders nothing while `actions` is undefined); contract `connectorActionSchema` `name: z.string().min(1)`; shot app-cua_repl-dark.

### a4-4. "Add your own" is the last thing in a 33-row list, hidden as "Advanced"
- Where: Add sheet (Add app).
- Category: bad pattern
- Severity: High (the owner asked for it to come first)
- What the user sees: The sheet opens to a search field and 33 apps in catalog order (Notion first, Playwright last). The way to add something that is not on the list is a small link at the very bottom, "Advanced: add by address or command". Its top edge sits about 2,600 px down in a sheet whose window is 835 px tall, so three screens of scrolling.
- Why it hurts: A user with their own server (the second most common need after picking from the list) cannot find the entry point, and the word "Advanced" tells most people it is not for them.
- Fix: Make the first row of the list "Add your own", above the search results, with a plug icon in the same `.connRow` layout and the line "An address or a program on this computer". Keep it visible while searching and when the search finds nothing. Same two-step screen as today behind it.
- Evidence: AddSheet.tsx:365-373 (the fold link after the list), 336-364; shot add-adv-dark (link measured at y = 2593 in an 835 px viewport); whats-new.ts:88 ("sits under Advanced").

### a4-5. Nowhere to see or change what a department can use: no Apps section in department settings
- Where: Team > department settings; Office > department side panel; agent side panel.
- Category: scalability (too many steps)
- Severity: High
- What the user sees: Department settings has About, Workspaces, Team, Team rules, Files and Permissions, and no Apps. Its only connector output is a hidden amber warning that appears when an app given to this department by name cannot be reached by any member. The Office floor's department panel has an "Apps" section, but only when at least one app was given to that department by name; apps given to Everyone never show. To give an app to a department the user must open the app, open "Who can use it", and tick the department. To learn what Marketing can use there is no screen: the user opens every app.
- Why it hurts: With 10 departments and 40 apps, the question "what can this team use, and can I change it" needs 40 page visits. Access is set from one side only.
- Fix: Add an "Apps" section to department settings, between Workspaces and Team, in the same pattern as `DepartmentWorkspaces`: a list of the apps this team can use (logo, name, provider chips, "Everyone" or "This team", status), an "Add an app for this team" menu over the user's existing apps, and the unreachable-by-provider warning inline per app. Make the Office panel's "Apps" section always show (count when it has more than a few). Keep `DepartmentApps` as the row component.
- Evidence: DepartmentSettings.tsx:247-263 (`DepartmentApps ... warnOnly`), headings dump of the page (About / Workspaces / Team / Permissions); DepartmentPanel.tsx:196-208 (shown only if an audience names the department); DepartmentApps.tsx:46-57; shot dept-settings-dark, agent-dark.

---

## Medium

### a4-6. An app that was never set up shows "Ready" and "Signed in" on its page
- Where: App page of a "Suggested" Claude app (Google Calendar, Gmail, Google Drive), reached from Ctrl K.
- Category: bad pattern
- Severity: Medium
- What the user sees: The list offers Google Calendar with a "Set up" button. Searching it with Ctrl K opens a page that says "Claude Code, Signed in on claude.ai, Ready" with a green check, the full Access panel ("Everyone"), and "Its actions show once an agent uses it."
- Why it hurts: The same app is "not set up" in one place and "Ready" in another. A user may think it works and give a task to an agent that cannot reach it.
- Fix: For an offer, the route row should say "Not set up" in grey with the same "Set up" button as the card, and the Access and actions sections should be replaced by one line pointing to the sign-in. `RouteRow` already knows `isOffer`.
- Evidence: ConnectorView.tsx:65-123 (status falls to "Ready" for any enabled, not failing route; `needsRenewing` excludes offers), connectors.ts:62-67; shot offer-page-dark.

### a4-7. App status colours and wording are not consistent, and several states cannot be seen on the list
- Where: Cards, app page "Works with", sidebar.
- Category: inconsistency
- Severity: Medium
- What the user sees (checked against code; the data only has "connected"):

  | State | Card | App page | Colour |
  | --- | --- | --- | --- |
  | Connected | nothing | "Ready" with a check | green |
  | Needs renewing | amber border, "Needs renewing", Renew (Claude only) | "Renew" button | amber; sidebar dot amber |
  | Not answering (failing) | nothing | "Not answering" with an alert icon | the icon is green, the words grey |
  | Turned off | nothing | "Turned off" | amber |
  | Not set up (offer) | "Set up" button in Suggested | "Ready" (a4-6) | primary button |
  | Provider not signed in | nothing | nothing | none |

  "Not answering" gets a green alert icon because one rule colours every icon inside the status green. "Turned off" is a deliberate user choice but is drawn in the amber that is reserved for "needs you". When a provider is signed out, its apps keep their last status because the refresh skips accounts without a sign-in, so the page keeps saying "Ready".
- Why it hurts: Two of the five states cannot be told apart by colour, one uses the wrong colour, and the list hides everything except one state, so at 40 apps a broken app is only found by opening it.
- Fix: One legend: Ready green check; Needs renewing amber; Not answering red (`--bad`) with the alert icon; Turned off neutral grey; Not set up neutral with a secondary "Set up". Show the status once per row on the list and once in the app page header. Show "Provider not signed in" on the provider chip (dimmed, "Sign in to Codex" linking to Providers). Disagreement with D-96 ("The only alert is Needs renewing"), said once: "Not answering" is an alert the user must act on; "Turned off" needs only a neutral label.
- Evidence: Connectors.module.css:618-620 (`.routeStatus svg { color: var(--ok) }`) and 134-136 (`.warn`); ConnectorView.tsx:104-120; connectors.ts:62-67; provider-apps.ts:100-103 (accounts without a sign-in are skipped); Sidebar.tsx:118-125 (dot counts only `needsRenewing`; its comment says "or not answering").

### a4-8. Provider tags are small logo pills with a tooltip, and "All" next to a logo contradicts itself
- Where: Cards, Add list, department panel; app page header and ask card for comparison.
- Category: readability
- Severity: Medium
- What the user sees: On cards and in the Add list a provider is a 22 px pill with a 14 px logo and no text; the name is only in a hover tooltip. The same chip carries the name on the app page and in the ask card. In the Add list GitHub shows "All" plus a Codex logo, which reads as "all providers, including Codex" and then "Codex" again. The pill is a way in there (key for all, or sign-in through Codex) but on the cards the same pill means "who can use it". Nothing on a Gmail card says "not on Codex".
- Why it hurts: The main idea of D-96 (an app may be on Claude but not on Codex) is carried by an icon whose meaning needs hover, on a screen that is also used with a keyboard or touch. The two meanings of one chip confuse.
- Fix: Use named chips wherever there is room ("Claude Code", "Codex", "Any provider") and keep the logo-only version only in tight rows (department panel). In the Add list show ways in as text under the description ("Key, or sign in through Codex"), not as tags. Add a "Provider" filter so the meaning is learned by use.
- Evidence: ProviderTags.tsx:6-28 (`named` default false; `title` only); connectors.ts:115-126 (`entryTags` vs `tagsOf`); AddSheet.tsx:359; shots add-dark (GitHub row), zoom-tags, list-scroll-light.

### a4-9. The app page lists only where an app works, never where it does not, and offers no way to add it there
- Where: App page, "Works with".
- Category: bad pattern
- Severity: Medium
- What the user sees: Hugging Face works on Codex only. Its page shows one row, "Codex". It says nothing about Claude agents, although the catalog lists Hugging Face as an app anyone can use. To add it for Claude the user must go back to Add app, find Hugging Face and press "Set up in Claude Code". With 3 accounts on 2 providers the "Works with" list is 6 rows with no grouping by provider.
- Why it hurts: "Does Claude have this?" is the most common question behind D-96. The page answers only the opposite one.
- Fix: Replace "Works with" with "Providers": one row per installed provider, grouped, with accounts as sub-lines. Rows for providers that can get the app say "Not set up" and carry the same "Set up in <provider>" button the Add sheet has (`setUpThrough`). Use the catalog entry's `signIn` list as the source.
- Evidence: ConnectorView.tsx:300-309 (maps only `routes`); AddSheet.tsx:183-214 (`ProviderWays`); shot app-Hugging-Face-dark.

### a4-10. The app page shows one permission and one audience for an app that has several routes
- Where: App page, Access panel.
- Category: bad pattern
- Severity: Medium (human in the loop)
- What the user sees: Permission and "Who can use it" show the values of the first route only. A new Claude route starts on "Ask me first", a new OpenCode 1 route starts on "Don't ask", and every new provider app starts on Everyone. If the same app is on both, the page can show "Ask me first" while the other route runs unasked. The two only match after the user presses a control, which writes to every route.
- Why it hurts: The page states a safety setting that may be false.
- Fix: If routes differ, show "Mixed" on the control and list the differing providers in the "Providers" rows (a4-9) with their own value. Or reconcile on arrival: when a new route joins an existing app, copy the existing permission and audience.
- Evidence: ConnectorView.tsx:251, 326-327, 346; provider-apps.ts:44-49 (`startingPermission`), 248-249 (new app to everyone).

### a4-11. Permission is one value per app, so "ask first for Marketing, never for Support" and per-action settings are not possible
- Where: App page, Access and "What agents can do".
- Category: scalability
- Severity: Medium (a design gap, not a defect; this is the owner's D-67)
- What the user sees: One Read only / Ask me first / Don't ask control per app. "Changes" in the actions list is a header that repeats that one value. Actions have no controls. Answer to "how many clicks to set Ask me first for one action for one department": it cannot be done. The nearest is the app-wide control: sidebar > Connectors > the app > the segment (3 clicks), which changes every action for every department and every provider.
- Why it hurts: With 10 departments, a lead wants Drive deletes to ask for everyone while Support may read-only. The only tool is the whole app on or off per department.
- Fix: Not to build now (D-67 sets it per app, and a story must not change a contract). If wanted later: keep the app-wide value as the default, and let each Change action show a small chip ("Default" or its own value), then an optional per-department row in the Access panel. The row layout in "Proposed shape" leaves room for it.
- Evidence: contract `connectorRecordSchema` (one `permission`); ConnectorView.tsx:316-339; ActionGroups.tsx:53-54; DECISIONS.md D-67.

### a4-12. "Who can use it" looks like plain text, and its menu is a long list with no search
- Where: App page, Access panel; Add sheet, "Only some".
- Category: bad pattern
- Severity: Medium
- What the user sees: On the Permission row there is a boxed segmented control. On the next row, "Who can use it", the value "Everyone" is a 12.5 px chip with a transparent border, so it reads as a label until hovered. Its menu is a single list of Everyone, then each department and each member. With 6 departments of 2 members it has 19 rows and shows about 7 at once (360 px max). Departments are tick rows that look like group headings, since an unticked row shows no box. Departments have no colour or avatar, so ten similar names are hard to tell apart. 10 departments of 5 members would be 61 rows.
- Why it hurts: This is the control that grants access to a third party's data, and it is the least visible one on the page.
- Fix: Give the chip a visible border and a summary ("Everyone", "2 departments, 1 agent"). Add a search field at the top of `AudienceMenu`, and show a department's tick with the same box style as members, with a colour dot as the sidebar uses. Collapse members under their department by default.
- Evidence: ConnectorView.tsx:340-352; GivenToMenu.tsx:115-172 (AudienceMenu); Library.module.css:184-203 (`.givenTo`, `.menu` 360 px); Menu.module.css:1-18 (`.chip` transparent border); shot audience-menu-dark, app-Claude-Docs-dark.

### a4-13. The actions list cannot be searched or folded, its order changes, and descriptions are hidden in a tooltip
- Where: App page "What agents can do"; Add sheet after Connect.
- Category: scalability
- Severity: Medium
- What the user sees: Every action is listed in two columns: Reads and Changes. Hugging Face has ten. Real servers have 50 to 100. The order is not alphabetical (the Hugging Face list was in a different order on two loads). Names are the tool name with underscores removed ("Hf sandbox fs", "Hf sandbox exec"). The description that would explain them is a hover tooltip on the row.
- Why it hurts: A user cannot find "delete" in a list of 90, cannot read what an action does without a mouse, and cannot compare two loads.
- Fix: Sort alphabetically inside each group; show the first 8 with "Show all 52"; add a small search field over 10 actions; show the description as a second line in muted text (the `.sub` style) instead of a `title`.
- Evidence: ActionGroups.tsx:33-56 (`title={action.description}`, no limit, order as received); Connectors.module.css:629-674; shots app-Hugging-Face-dark, app-hf-1000-light.

### a4-14. "Recent use" shows 5 rows and cannot be filtered, although the core can already filter it
- Where: App page, "Recent use".
- Category: scalability
- Severity: Medium
- What the user sees: The five newest calls of the week (action, agent, task, time), then "Show more" (10 at a time). To see which agents used the app the user scans the list. There is no filter by department or "changes only". The contract already returns department counts "for the chips" and accepts `team` and `changes` filters, but the page always asks with `{}`. Reaching the answer takes two clicks from the sidebar (Connectors, the app) plus a scroll to the bottom.
- Why it hurts: With heavy use the week has hundreds of calls; the user cannot ask "what did Support change in Drive".
- Fix: Add two chips above the list, `Team` (using `teams` from the response) and `Changes only`, built as `TeamFilter` in TasksView is. Add one line under the app name: "14 calls this week, last used 2 h ago".
- Evidence: ConnectorView.tsx:159-217 (`SHORT = 5`, `api.connectorActivity(id, {})`); contract `connectorActivityQuerySchema`, `connectorActivitySchema.teams` ("for the chips").

### a4-15. A provider's app cannot be removed, and the page does not say where to do it
- Where: App page, "..." menu.
- Category: bad pattern (dead end)
- Severity: Medium
- What the user sees: For a Claude, Codex or OpenCode app the menu holds one item, "Turn off". There is no "Disconnect" and no sentence about why. Only shared apps get it. For a needs-renewing app on Codex or OpenCode the card shows grey text "Sign in in Codex" with no button.
- Why it hurts: A user who wants Hugging Face gone has no route and no hint that it lives in Codex's settings. "Sign in in" repeats a word.
- Fix: Add a menu item "Remove in <provider>" that opens the provider's own page where known (`claudeConnectorsPage` for Claude), or one line under the header ("Managed in Codex. Remove it there."). Reword the hint to "Sign in through Codex".
- Evidence: ConnectorView.tsx:276-297 (Disconnect only when `shared.length > 0`); RenewAction.tsx:25-27.

### a4-16. The Add list is flat, truncated, and does not show what is already added
- Where: Add sheet, list step.
- Category: scalability
- Severity: Medium
- What the user sees: 33 apps in one list, in an order that mixes sign-in apps (Notion, Atlassian, monday.com) with key-based ones, 72 px per row, so 2,400 px of scrolling. Descriptions are cut to one line ("Search, read and write pages and ..."; with two tags even less room). Hugging Face is listed as addable although the user has it. Nothing is marked "Added". Eight apps (Close, Context7, Exa, Firecrawl, Tavily, Apify, PostHog, Playwright) show a letter tile. The catalog carries a category for every entry and the code has the category names, but the sheet uses neither.
- Why it hurts: The catalog is already 33 and will grow. The user cannot narrow by kind of app or see what they already have.
- Fix: Category chips under the search (use the existing `CATEGORIES`), allow two lines for the description, show "Added" (or the status) on apps already connected, sort the user's current picks first.
- Evidence: AddSheet.tsx:266-271 (no exclusion of known apps), 350-363; connectors.ts:26-32 (`CATEGORIES`, used nowhere else); shots add-dark, add-light, add-bottom list dump.

### a4-17. "See all 35 apps" opens 33, and Gmail, Google Calendar and Google Drive cannot be found in Add
- Where: Connectors page > "See all 35 apps"; Add sheet search.
- Category: inconsistency
- Severity: Medium
- What the user sees: The page promises 35 and the sheet lists 33. Typing "Gmail" in the sheet shows "No app matches", though Gmail is the first card in Suggested.
- Why it hurts: The user cannot reach the three most common apps from the place that is meant to hold every app, and the count is wrong.
- Fix: Build the Add list from the same set as "Suggested" (catalog entries plus provider offers) so the numbers match and search finds all. Offers show "Set up in Claude Code".
- Evidence: ConnectorsView.tsx:133-141, 223-227 (`matching.length + offers.length`); AddSheet.tsx:266-271 (entries only); shot add-gmail-dark (rows=33, "Gmail" gives 0).

### a4-18. The same app is shown in nine places, with different names, tags, details and icons
- Where: Connectors card, app page, department panel, agent panel, @ list, tag chip, ask card, Add row, Ctrl K.
- Category: duplication
- Severity: Medium
- What the user sees (code; the data has apps in only one provider):

  | Place | Name used | Logo | Provider | Permission | Status |
  | --- | --- | --- | --- | --- | --- |
  | Page card | catalog name ("Jira and Confluence") | yes | logo pills | no | renewing only |
  | App page | catalog name | yes | named chip + rows | yes | yes |
  | Department panel (Apps) | catalog name | yes | logo pills | no | no |
  | Agent panel (Connectors) | the route's own name ("Atlassian") | yes | no | yes (text) | no |
  | @ picker, composer tag, sent tag | the route's own name | yes | no | no | no |
  | Ask card | name in the sentence | yes | named chip | no | n/a |
  | Add row | catalog name | yes | ways in | no | no |
  | Ctrl K | the route's own name, one row per route | plug icon | no | no | no |

  An app can be called "Jira and Confluence" on the page and "Atlassian" in the agent panel and in `@Atlassian` (the user's own route name differs from the catalog name; the page uses the catalog's). Ctrl K shows one row per route, so an app on two providers appears twice and both rows open the same page, with a plug icon instead of its logo.
- Why it hurts: The user cannot be sure `@Atlassian` is the same thing as the card they set up. Duplicates in the palette add noise.
- Fix: One display name per app (the group's name) used by the agent panel, @ list and Ctrl K; the tag still writes the name the agent sees. Ctrl K lists one row per app with its logo and its provider chips. Show permission as a small grey word wherever the app is listed for an agent (already done in the agent panel).
- Evidence: connectors.ts:90-112 (group name from the catalog entry), AppTags.tsx:22-29 (route names), AgentConnectors.tsx:14-24, CommandMenu.tsx:232-243, DepartmentApps.tsx:63-80.

### a4-19. Only about half of a card can be clicked
- Where: Connectors page, each card.
- Category: UI bug
- Severity: Medium
- What the user sees: The card is 280 x 160. The button inside is 238 x 97 for a one-line card such as `node_repl`. Clicking the card's padding or its lower part does nothing, and the hover border only lights when the pointer is on the inner text.
- Why it hurts: The card looks like one target but is not. At the lower edge of a card a click is silently lost.
- Fix: Make the whole card the link: put the button on the card (a stretched `::after` over the `li`) and keep the Renew button above it. Rows (a4-1) fix this by design.
- Evidence: Connectors.module.css:175-184 (`.card` padding 20, `height: 100%`), 558-567 (`.appCard` padding 0), 574-576 (hover only on the inner button); ConnectorsView.tsx:40-53; measured with `elementFromPoint` (card 280x160, button 238x97), shot hit-dark.

### a4-20. The agent panel hides the apps an agent cannot reach, and does not say why
- Where: Office > agent panel > Connectors; Needs you asks.
- Category: bad pattern
- Severity: Medium
- What the user sees: The Connectors section lists only apps the agent may use now (Claude Docs, Ask me first). An app the agent's department has but its provider cannot reach (a Codex-only app for a Claude agent) is simply absent. The warning for it exists only in department settings, and only when no member can reach the app.
- Why it hurts: "What is this agent blocked on" is a product principle. A worker on Codex in a team whose lead is on Claude loses an app with no sign.
- Fix: Under the usable list, show the apps the agent's department has that its provider cannot use as dimmed rows with the reason ("Only on Claude Code") and a "Set up for Codex" action.
- Evidence: connectors.ts:152-168 (`usableBy` returns only reachable apps); AgentConnectors.tsx:9-27; DepartmentApps.tsx:49-54 (warning only when every route is unreachable); shot agent-dark.

### a4-21. One "Set up" label comes in two button styles in the same grid
- Where: Connectors page, "Suggested".
- Category: inconsistency
- Severity: Medium
- What the user sees: Gmail, Google Calendar and Google Drive have a filled blue "Set up". Notion, Jira, monday.com and the rest have an outlined "Set up". Both are in one grid. "Renew" on a card is filled too.
- Why it hurts: The row looks as if three apps are more urgent than the others, when they are the same state. A page that can hold many cards would show a column of competing main buttons.
- Fix: Use the secondary button for every "Set up" on a list or card and keep the filled style for "Add app" and for Renew on an item that needs the user. `RenewAction` takes the variant from its caller.
- Evidence: RenewAction.tsx:11-23 (`variant="primary"` for both labels); ConnectorsView.tsx:201, 210-215; shot list-scroll-light.

---

## Low

### a4-22. Add flow: shared and provider apps take different paths, and a few labels do not help
- Where: Add sheet, detail steps.
- Category: inconsistency
- Severity: Low
- What the user sees: A key app goes Connect (tests it), then shows permission and who, then Save. A sign-in app presses "Set up in Codex", the sheet closes at once, a browser tab opens, and the app later lands on Everyone with no question about permission or access, and no sign on the page that it is waiting. The key step shows a label "Account" above a field labelled "Personal access token". The footer button changes from Connect to Save in the same place. The sheet title is "Add an app" with "Not on our checked list" for custom apps but there is no warning that a local program runs on this computer.
- Why it hurts: Two ways of adding give two levels of control; the user cannot choose who gets a sign-in app in the same flow.
- Fix: After a provider setup, keep the sheet on "Waiting for Notion" with a Check again button (as the ask card already does) and then show the same permission and who fields. Drop the "Account" label. Keep the Connect then Save sequence but name the second step "Save" only after the test shows what the app can do (already so).
- Evidence: AddSheet.tsx:183-214 (`ProviderWays` calls `setUpThrough(...).then(onDone)`), 383-385, 306-334; ConnectorsView.tsx; shot add-github-dark, add-notion-dark.

### a4-23. Hints and sentences that restate the label, and sentences ending in "..."
- Where: App page Access and actions, Add sheet, Needs you ask.
- Category: slop
- Severity: Low
- What the user sees: "Reads never ask. Changes follow this." under Permission, and then again in the actions list as "Reads: Never ask" and "Changes: Ask me first". "The provider keeps the sign-in; only its agents use the app." under the provider buttons. "Its actions show once an agent uses it." For OpenCode-only apps a three-sentence note: "OpenCode doesn't say which actions only read: Ask me first asks before each one, and Read only blocks them all. OpenCode 1 shows only the action's name, OpenCode 2 also what it sends." Button "Connecting..." and the ask card line "Waiting for the sign-in in your browser...".
- Why it hurts: Each says what the control already shows. The OpenCode note is a wall of text with version numbers.
- Fix: Keep the group labels in the actions list, delete the line under Permission and the line under the provider buttons. For OpenCode: "OpenCode can't tell reads from changes, so Ask me first asks before every action." Use "Connecting" and "Waiting for the sign-in" without dots.
- Evidence: ConnectorView.tsx:333-337; ActionGroups.tsx:31, 53-54; AddSheet.tsx:211, 321; ConnectorAsk.tsx:125.

### a4-24. Wording splits: "Connectors" or "Apps", "Give it to" or "Who can use it", "approval" or "permission"
- Where: Sidebar, page titles, panels, ask cards.
- Category: inconsistency
- Severity: Low
- What the user sees: The sidebar and page title say "Connectors"; the lead, the search, the Add button, the section titles, the @ list and the Office department panel say "apps". The agent panel section is called "Connectors", the department panel's is called "Apps". The ask card says "Give it to"; the app page and Add sheet say "Who can use it"; the sheet calls the same menu "Can use it:" for screen readers. A connector call ask is headed "Asks your approval", any other permission ask "Asks your permission".
- Why it hurts: One thing, several names.
- Fix: Keep "Connectors" for the page and navigation, and use "Apps" everywhere that lists the things. Give both panels the title "Apps". Use "Who can use it" in the ask card. Use "Asks your permission" for every ask.
- Evidence: Sidebar.tsx:238; ConnectorsView.tsx:152-156; AgentConnectors.tsx:13; DepartmentPanel.tsx:204; ConnectorAsk.tsx:19-22, 105-107; RequestCard.tsx:242.

### a4-25. The "Works with" rows carry internal terms and a repeated line
- Where: App page, "Works with".
- Category: readability
- Severity: Low
- What the user sees: Each row has three lines: "Claude Code", "Signed in on claude.ai . Default", "In the app . In the background . In the cloud". Two of the three are identical for every route of one provider. "Default" after the dot is an account name but reads like a state. A shared app's row is called "Office Town", with "Used first", while its tag above says "All".
- Why it hurts: The one line that varies (the account) is the least clear, the line that repeats says nothing a user decides on, and "Office Town" is not a provider.
- Fix: Row: provider name, account (when the provider has several), status. Drop the places line. For shared apps call the row "Any provider" and keep "Used first" as the sub-line.
- Evidence: ConnectorView.tsx:50, 65-123; shots app-Claude-Docs-dark, app-Hugging-Face-dark.

### a4-26. "Suggested" repeats what Add already does, and takes as much room as the user's own apps
- Where: Connectors page, "Suggested".
- Category: duplication
- Severity: Low
- What the user sees: Under the user's apps, eight cards of apps they do not have, the three Claude offers first, then catalog apps, then "See all 35 apps". On the data above Suggested has more cards (8) than the user has apps (7). The Claude offers have no description and the others do, so cards in the same grid are different heights of content.
- Why it hurts: At 40 apps the useful half of the page is pushed to the bottom; at 7 apps it competes with them.
- Fix: Show Suggested only when the user has fewer than about 6 apps (first-time state), and otherwise leave discovery to Add app. Keep the "Set up" action on the card.
- Evidence: ConnectorsView.tsx:96-97, 138-141, 190-228; shot list-scroll-light.

### a4-27. In New task, the @ list puts apps after every department, each captioned only "App"
- Where: New task, @ list.
- Category: readability
- Severity: Low
- What the user sees: "@" opens "Who does it" first (An assistant, every department, A new department), then "Apps". With 6 departments the app is off screen; each app row's second line is only "App".
- Why it hurts: A user typing "@" to tag an app has to scroll or type; the caption states the heading again.
- Fix: When the user has typed something, rank by match (apps and people mixed); otherwise show the app's provider chips or its permission as the second line instead of "App".
- Evidence: new-task/Composer.tsx:386-391; shots at-new-task-dark, at-new-task-scrolled-dark.

### a4-28. The app list is re-read from every provider account on every window focus, with no sign on the page
- Where: Connectors page.
- Category: scalability
- Severity: Low (from code; cost not measured)
- What the user sees: Nothing. The page asks the core to read every signed-in account's apps when it opens and each time the window regains focus. With 6 providers and 3 accounts that is up to 18 reads at once. There is no "checking" or "last checked" state, so a stale list looks current.
- Why it hurts: D-92 limits one-off CLI queries to two at a time because each start blocks the core on Windows; this call starts one per account together. I did not check whether `listVendorApps` goes through that limit.
- Fix: Check that the refresh uses the two-at-a-time queue, and show a small "Checked 2 min ago" or a spinner in the header.
- Evidence: ConnectorsView.tsx:116-120; provider-apps.ts:96-113 (`Promise.all` over accounts); DECISIONS.md D-92.

---

## Answers to the seven questions

1. 40 apps, 4 providers, 10 departments: the page becomes a 3,000 px wall with no filters and one name search; access is set only from the app side (a4-1, a4-5). Fix: list rows plus Tasks-style tabs, chips and grouping.
2. A card should say who can use the app, its permission, its status and when it was last used, and not "N actions" or a raw server name (a4-2).
3. The provider tag is a logo-only pill with a tooltip. It is readable only to someone who already knows the logos, and "All" beside a logo contradicts itself. Nothing says "not on Codex" (a4-8, a4-9).
4. Per action, per department permission: not possible, permission is per app (a4-11). Give an app to one department: 4 clicks from the sidebar (Connectors, app, chip, tick). See who used it: 2 clicks plus a scroll, five rows, no filter (a4-14). Renew: one button for Claude, nothing for Codex or OpenCode. Remove: shared apps only (a4-15).
5. Add: the catalog is a flat list of 33, "Add your own" is last and hidden (a4-4), search misses the three most common apps (a4-17), no categories or "Added" (a4-16), the audience step only exists for key apps (a4-22).
6. The nine places are in a4-18. They disagree on name, logo, provider tag, permission and status.
7. States are in the table in a4-7. Two are visually the same (Not answering is nearly invisible), one has the wrong colour (Turned off in amber), one is wrong (offers say Ready, a4-6), one does not exist (provider not signed in).

---

## Cross-area notes

- Team > department settings opens with a four-step "How a department works" illustration panel above the form; this reads as an explainer panel (slop) and pushes the form down. For the Team auditor.
- The task trace shows an app's logo for an app call but the row does not link to the app's page (TraceItems.tsx:248-253). For the Task auditor.
- Department names in menus and in the @ list have no colour or avatar, while the sidebar draws a colour dot per department; six departments called the same are indistinguishable in every picker (test data, but names can repeat). For the Team/Office auditor.
- The Tasks page already has the filter-and-group header Connectors should copy (tabs with counts, `TeamFilter`, Group by, kept per session); its content column is wider (about 1060 px) than the 880 px of Connectors. For consistency of page widths.
- Sidebar comment on `ConnectorDot` says "signed out or not answering" but the dot counts needs-renewing only (Sidebar.tsx:117). For the Sidebar auditor.

## Keep

1. One card per app with provider tags (D-96), matched by name, so Claude's Notion and Codex's Notion are not two things.
2. Reads and Changes shown apart, with an eye and a pen icon, in plain words (Reads never ask).
3. The Read only / Ask me first / Don't ask control with these exact names, and the amber-only-for-renewing treatment (card border, label, sidebar dot).
4. The Add sheet's details: maker, "Checked <date>", "Where to find it" for keys, testing before saving, the action list before the user chooses permission and audience.
5. @ tags with the app's logo in the composer and in sent messages (D-100).

## Proposed shape

Connectors page, at 40 apps across 4 providers and 10 departments
- Header unchanged in place: "Connectors", the lead "Apps your agents can use.", "Add app" primary on the right (fixed place, never wraps). The search leaves the header and joins the toolbar.
- Tabs with counts, the same as Tasks: All 40, Needs you 3 (renewing and not answering), Turned off 2.
- Toolbar, the same as Tasks: search field, chips "Provider", "Who can use it" (Everyone, a department, an agent; with a search field inside), "Permission", and "Group by" (None by default, Provider, Status, Who). Chips and search are kept per session.
- A list, not cards, 72 px rows in the `.list` / `.connRow` style the Add sheet already uses; the whole row opens the app. Row: logo (md) | name and one muted line (what it does, or "From your Codex settings") | provider chips with names ("Claude Code", "Codex", "Any provider") | who ("Everyone" or "Marketing, Support +1") | permission ("Ask me first") | status (Ready green, Needs renewing amber with Renew, Not answering red, Turned off grey) | last used ("2 h ago") | `MoreMenu` (Open, Turn off, Disconnect or Remove in <provider>). Needs-you rows sort first with the existing amber border. Under 1000 px hide Permission and Last used; under 760 px stack the row.
- Codex-settings servers (`codex_app`, `cua_repl`, `node_repl`, Plugin Management, Search Service) sit in a collapsed group "From your Codex settings", with cleaned names.
- "Suggested" shows only for a new user (fewer than 6 apps). Otherwise discovery is the Add sheet. Empty search: "No app matches." with Clear filters.

App page
- Same crumbs. Header: logo (lg), name, one line of what it does, named provider chips, and the status once (Ready, Needs renewing with Renew, Not answering, Turned off with Turn on, Not set up with Set up), then "14 calls this week, last used 2 h ago". `MoreMenu` for Turn off and Disconnect or "Remove in <provider>".
- Access panel: Permission control as now (one sentence only for OpenCode), then "Who can use it" as a bordered chip with a summary ("2 departments, 1 agent"); its menu has a search field and department rows with the same tick box and colour dot as members.
- "Providers" replaces "Works with": a row per installed provider with accounts as sub-lines; rows for providers without the app say "Not set up" and carry "Set up in <provider>". Differing permission or audience per provider shows as "Mixed" with the values in the rows.
- "What agents can do": Reads and Changes as now, alphabetical, first 8 then "Show all 52", search above 10, one muted description line per action instead of a tooltip, an empty or failed read says so in words.
- "Recent use": chips Team and Changes only (the core already supports both), agent with department in each row.
- Offer (not set up) page: one line and one button; no Access or actions sections.

Elsewhere
- Department settings gets an "Apps" section (between Workspaces and Team): apps this team can use, with provider chips and status, "Add an app for this team", and the unreachable warning inline. The Office department panel's "Apps" always shows.
- Agent panel "Apps": usable apps (logo, group name, permission) plus a dimmed "Not available to this agent" group with the reason.
- One app name everywhere (the group name); Ctrl K lists one row per app with its logo.
- Add sheet: first row "Add your own", then search, category chips (existing `CATEGORIES`), the list including the Claude offers so counts match, "Added" on apps the user has, two-line descriptions, ways in as text. Provider setup stays in the sheet with a "Waiting for <app>" step and then the same permission and who fields.
- Ask cards: heading "Asks your permission"; "Who can use it" replaces "Give it to" and uses `AudienceMenu`'s wording; no trailing dots.
