import {
  CalendarClock,
  History,
  Inbox,
  Laptop,
  LayoutGrid,
  type LucideIcon,
  Rss,
  Send,
  SlidersHorizontal,
} from "lucide-react";

export interface Release {
  // YYYY-MM-DD, newest first.
  date: string;
  title: string;
  icon: LucideIcon;
  changes: string[];
}

export const RELEASES: Release[] = [
  {
    date: "2026-11-28",
    title: "Progress updates in Feed",
    icon: Rss,
    changes: [
      "Turn on Progress updates for a task, in its Options or on its run card, and the agent in charge posts what it found on the task's Feed card, with a chart or a picture when one shows it best",
      "Updates are at least 30 minutes apart, and only after something real happened, such as a milestone met or a part finished. Each says what earned it",
      "The card shows the newest update; Show all opens the earlier ones. A new update moves the card to the top, and the card keeps them once it becomes the result",
      "Settings > Feed sets whether new tasks start with updates. Tasks in Efficient mode start without them, and a card's menu turns them off",
      "With updates on, a working card also shows how many milestones are met and parts done",
      "The step bar on a working card now fits any number of steps",
    ],
  },
  {
    date: "2026-11-27",
    title: "Feed",
    icon: Rss,
    changes: [
      "Feed, under Home in the sidebar, shows what your team does as it happens: work in progress, results, what needs you, automation runs and what your agents want you to know",
      "Answer an ask right in Feed; it closes in Needs you too",
      "Reply on any post to send the agent a message in its task",
      "A dot on Feed and a line on Home say when there are new posts since you last looked",
      "Agents can post a heads-up when they find something you should know, a few an hour at most",
      "Feed can suggest an automation for a request you repeat, or a next task a lead names. Set it up opens it filled in, and Settings turns suggestions off",
      "On the office floor, a new post shows over its agent for a few seconds",
      "A long result opens in place",
      "Home, Needs you and Tasks show their counts as pills beside the words",
    ],
  },
  {
    date: "2026-11-25",
    title: "Tidier setup pages",
    icon: SlidersHorizontal,
    changes: [
      "In a setup with steps, the back link at the top goes to the step before. Only the first step leaves the page",
      "Start over is a button under the steps, and starts the setup again from the first step",
      "The team on Review is only as wide as its people, centred under the lead",
      "Workspaces, Permissions and Team rules on Review are tiles you click to change",
      "Numbers beside tabs and headings now look the same everywhere",
    ],
  },
  {
    date: "2026-11-25",
    title: "Ready-made teams and recipes",
    icon: LayoutGrid,
    changes: [
      "New department starts with four team templates: Research desk, Content team, Code review team and Bug-fix team. Each card says what it does, who is on it and what you get",
      "Pick one and it opens on the Team step to look over. The lead gets your strongest model and the members a cheap or free one, all marked picked for you. Code teams can't go past Workspaces until you choose the project folder",
      "New automation starts with five recipes: Morning brief, Inbox digest, Tomorrow's meetings, Summarise new files and Nightly test check. One click fills every step, then Save or Save and run now. Nightly test check asks for the project folder first",
      "Recipes that read Gmail or Google Calendar run through Claude and say so on the card. If the app or Claude Code isn't set up yet, Review links to it",
      "With no provider ready, both pages show how to set one up first. Once you start building one manually, the cards hide so a click never replaces your work",
      "Build it by hand, Set it up by hand and the chief's Answer step by step now say manually",
    ],
  },
  {
    date: "2026-11-24",
    title: "Updates in Slack, Discord or Telegram",
    icon: Send,
    changes: [
      "Connect apps such as Slack, Discord or Telegram once from Settings, Connectors, a task or an automation. Each has a short guide, and a wrong paste tells you what to copy instead",
      "Settings > Updates sets what each app hears, such as only when an agent needs you or a task fails. Your computer's notifications are there too",
      "Turn on Send result to in a task's options and its result goes to the apps you picked once it's done. If it fails, you get a short note there instead",
      "An automation's Rules pick where its results go, starting with your usual apps. Under a result you see where it was sent, or why it couldn't be",
      "Alerts use Office Town's own words, never an agent's. Things that look like keys or passwords are hidden before a result is sent",
      "A run with nothing new ends quietly: no message, nothing to review",
      "An automation keeps notes from run to run, which you can read, edit and clear on its page",
      "A message you send while an agent is in a long step now shows as waiting until it reads it",
      "What's new closes from the × at its top, so a long list needs no scrolling",
      "The message box and review bar now line up with the chat",
    ],
  },
  {
    date: "2026-11-23",
    title: "Automations that start when something arrives",
    icon: Inbox,
    changes: [
      "An automation can start when a new file lands in a folder, an RSS feed posts, or a GitHub repository gets a new issue or pull request",
      "An agent check looks through your apps as often as you choose, such as your email for invoices, and starts a run only when it finds something new",
      "Type @ in the task to add What started this run. Things that arrive together go to one run",
      "Edits to files already in the folder, and files the automation's own runs make, don't start it",
      "Things that arrived while Office Town was closed run when it opens, within the catch-up window",
      "Each automation shows when it last looked and what it found, and agent checks count in Usage",
      "The When step shows the three ways to start side by side, with the details underneath",
      "In Rules, pick apps whose changes go through without asking in that automation's runs, so a run at night doesn't wait for you. Other tasks still ask",
    ],
  },
  {
    date: "2026-11-22",
    title: "Automations: tasks that start on their own",
    icon: CalendarClock,
    changes: [
      "Automations, under Tasks, saves a task with when it runs: every day, on weekdays, weekly, monthly, every few hours or once",
      "Describe it in your own words and every step is drafted for you, or set it up by hand with the New task box",
      "Type @ in the task for today's date or the last run's result; files you attach stay with every run",
      "An automation can run after another one finishes, and Run now tries it at once",
      "Each run is an ordinary task: it waits if its team is busy, catches up after Office Town was closed, and says why when it skips",
      "Choose Auto to let a run decide on its own, end to end; permission asks still follow its level",
      "Tasks started by an automation show it beside their status, and Tasks can filter by who started them",
      "Agents can propose an automation for you to create, and quitting warns you when automations won't run",
      "If two agents change the same file, the later one is told to read it again, and its task shows it",
    ],
  },
  {
    date: "2026-11-21",
    title: "Picking work back up after a close",
    icon: History,
    changes: [
      "After Office Town closes or crashes, Home lists the tasks that stopped, with Resume all and Choose; nothing resumes until you say",
      "A lead that fails twice in a row waits in Needs you with Try again and Stop, even across a restart",
      "A worker with no news for 30 minutes says so in its trace, and its lead hears once",
      "Results a stopped lead missed reach it first when it carries on",
      "The computer stays awake while agents work, on battery too; turn it off in Settings > Desktop",
      "Notifications never show an agent's own words, and each kind has its own switch in Settings",
    ],
  },
  {
    date: "2026-11-21",
    title: "A first test version for the Mac",
    icon: Laptop,
    changes: [
      "Office Town runs on Macs with Apple silicon and macOS 13 or later, as a test version",
      "The Mac app has its own menu, quits with ⌘Q (asking first while agents work), and keeps running in the menu bar",
      "Providers you installed for Terminal are found when the app is opened from the Dock",
      "Claude's usage is read from your Keychain, read only, when you choose Refresh on Usage",
      "Shortcuts show ⌘ on a Mac, and ⌘[ and ⌘] go back and forward",
      "Help has a section on the Mac: opening it the first time, folders, usage and updates",
    ],
  },
  {
    date: "2026-11-21",
    title: "A cleaner Team and Workspaces",
    icon: LayoutGrid,
    changes: [
      "Agents and departments with nothing to do are Idle, with a green dot, instead of Free with a moon",
      "On Team, every person in a department sits on one grid: role, handle, model with its provider's logo, and status",
      "Add a chief and New department match, each with its icon",
      "A department's page has tabs: People, Settings, Workspaces and apps, and Files",
      "People lists the team in rows; pick one to edit them in the panel beside the list",
      "Save shows at the bottom only when something changed, with Discard beside it",
      "Change with words is now Describe a change",
      "Workspaces is a list you can sort by name or last used, with who uses each, its branch and who works there now",
      "A workspace's page shows its kind, branch, tasks and last use as labelled facts, and long folder paths wrap at each folder",
    ],
  },
];

// Several releases can share a day, so one is told apart by its title too.
export const releaseKey = ({ date, title }: Release) => `${date} ${title}`;

const newest = RELEASES[0];
export const LATEST = newest === undefined ? "" : releaseKey(newest);

// What came out since the user last looked; at most the newest few. A mark saved by an older
// version holds only a date, so that day's releases show again once.
export function unseen(seen: string | undefined): Release[] {
  const at = RELEASES.findIndex((release) => releaseKey(release) === seen);
  const fresh =
    seen === undefined
      ? RELEASES
      : at >= 0
        ? RELEASES.slice(0, at)
        : RELEASES.filter((release) => release.date >= seen.slice(0, 10));
  return fresh.slice(0, 2);
}
