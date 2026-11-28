import {
  CalendarClock,
  Gauge,
  Inbox,
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
    title: "Lighter and faster with long histories",
    icon: Gauge,
    changes: [
      "Your data takes far less disk space: the raw copy of every line a provider printed is no longer kept, and only the newest backup from an update stays",
      "Searching Tasks stays quick with thousands of tasks, and agents no longer pause while you type",
      "The window stays smooth and light while agents stream, even on long tasks or when left open for days",
      "What agents did in your apps stays in Connectors for 90 days, even after you delete the task, and an app's Recent use can show the last 30 or 90 days, grouped by day",
      "Removing a place from Updates also takes it off every automation that sent there",
      "A department you removed no longer stops you from removing its workspace",
    ],
  },
  {
    date: "2026-11-28",
    title: "Progress updates in Feed",
    icon: Rss,
    changes: [
      "Turn on Progress updates in a task's Options or on its run card, and the agent in charge posts what it found on the task's Feed card, with a chart or a picture",
      "Updates come at most every 30 minutes, each after a milestone, part or step, and say what earned it. Settings > Feed sets whether new tasks start with them",
      "A card with updates stays in Feed for 30 days, and its × deletes it sooner. Show all opens every earlier update",
      "The step bar on a working card now fits any number of steps",
      "Feed never shows the same heads-up or milestone twice, even after a restart, and every new question reaches it",
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
