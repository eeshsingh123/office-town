import { Gauge, LayoutGrid, type LucideIcon, Rss, Send } from "lucide-react";

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
      "Your data takes far less disk space",
      "Searching Tasks stays quick with thousands of tasks, and agents no longer pause while you type",
      "The window stays smooth while agents stream, even when left open for days",
      "What agents did in your apps stays in Connectors for 90 days, even after you delete the task, and an app's Recent use reaches back that far",
      "Removing a place from Updates also takes it off every automation that sent there",
    ],
  },
  {
    date: "2026-11-28",
    title: "Progress updates in Feed",
    icon: Rss,
    changes: [
      "Turn on Progress updates in a task's Options or on its run card, and the agent in charge posts what it found on the task's Feed card, with a chart or a picture",
      "Updates come at most every 30 minutes, each after a milestone, part or step. Settings > Feed sets whether new tasks start with them",
      "A card with updates stays in Feed for 30 days, and Show all opens every earlier update",
      "The step bar on a working card fits any number of steps",
      "Feed never shows the same heads-up or milestone twice, even after a restart",
    ],
  },
  {
    date: "2026-11-27",
    title: "Feed",
    icon: Rss,
    changes: [
      "Feed, under Home, shows what your team does as it happens: work in progress, results, asks, automation runs and your agents' heads-ups",
      "Answer an ask right in Feed, or reply on any post to message the agent in its task",
      "A dot on Feed and a line on Home tell you when there are new posts",
      "Feed can suggest an automation for a request you repeat. Set it up opens it filled in",
      "On the office floor, a new post shows over its agent for a few seconds",
    ],
  },
  {
    date: "2026-11-25",
    title: "Ready-made teams and recipes",
    icon: LayoutGrid,
    changes: [
      "New department starts with four team templates: Research desk, Content team, Code review team and Bug-fix team",
      "The lead gets your strongest model and the members a cheap or free one, all marked picked for you",
      "New automation starts with five recipes, such as Morning brief and Nightly test check. One click fills every step",
      "Recipes that read Gmail or Google Calendar run through Claude, and Review links to anything not set up yet",
      "In a setup with steps, the back link goes to the step before, and Start over begins again",
    ],
  },
  {
    date: "2026-11-24",
    title: "Updates in Slack, Discord or Telegram",
    icon: Send,
    changes: [
      "Connect Slack, Discord or Telegram once, with a short guide for each. A wrong paste tells you what to copy instead",
      "Settings > Updates sets what each app hears, such as only when an agent needs you or a task fails",
      "Turn on Send result to in a task's options, or pick places in an automation's Rules, and results go there once done",
      "A run with nothing new ends quietly: no message, nothing to review",
      "An automation keeps notes from run to run, which you can read, edit and clear on its page",
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
