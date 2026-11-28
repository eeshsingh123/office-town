import { Gauge, Inbox, type LucideIcon, Rss, Wrench } from "lucide-react";

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
    title: "Pictures in Feed",
    icon: Rss,
    changes: [
      "A result that made a page, site or image shows its picture on its Feed post. Click it to open it in Outputs",
      "Feed marks where it starts with Latest at the top, instead of a You're caught up line that could land between posts",
      "Coming back to Feed from a task or an output lands on the post you left, not at the top",
      "Empty pages show their message in the middle of the page",
    ],
  },
  {
    date: "2026-11-28",
    title: "OpenCode models list again",
    icon: Wrench,
    changes: [
      "The model picker lists OpenCode's models again with OpenCode 2.4, which had left the list empty",
      "The model picker shows each provider by name only, without notes or usage under it",
      "OpenCode agents can no longer set up OpenCode's own automations, which would run outside Office Town. Use Automations instead",
    ],
  },
  {
    date: "2026-11-28",
    title: "Clearer empty pages",
    icon: Inbox,
    changes: [
      "A page with nothing to show has an icon and a short line on what lands there, instead of a bare sentence",
      "When search or filters match nothing, Clear filters sits beside the filters only, no longer also in the list. Picking a Feed tab no longer counts as a filter",
      "Automations with none yet says so under its guide, and New automation stays at the top",
      "When Feed or Tasks cannot load, Try again shows under the message",
    ],
  },
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
