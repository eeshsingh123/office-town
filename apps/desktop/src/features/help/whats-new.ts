export interface Release {
  // YYYY-MM-DD, newest first.
  date: string;
  changes: string[];
}

export const RELEASES: Release[] = [
  {
    date: "2026-10-14",
    changes: [
      "Setup when you first open the app, and tutorials you can run any time from Help",
      "Help: text size, higher contrast, less motion, and read-out of new requests",
      "Describe a department or the chief in your own words and get a draft to check",
      "Team page with you, the chief and every department",
      "Remove a department or the chief, keeping its past tasks if you want",
    ],
  },
  {
    date: "2026-10-12",
    changes: [
      "Usage reads your plan's numbers when you open it, not only after a task",
      "Library: give files to everyone, a department or one agent, once",
      "Attach files, images and folders to a task",
    ],
  },
  {
    date: "2026-10-11",
    changes: [
      "Back and Forward between screens",
      "Several accounts per AI app, and a Usage page",
      "Tasks grouped by team, with search and filters",
      "One box starts every task, on Home and New task",
    ],
  },
];

export const LATEST = RELEASES[0]?.date ?? "";

// What came out since the user last looked; at most the newest few.
export function unseen(seen: string | undefined): Release[] {
  return RELEASES.filter((release) => seen === undefined || release.date > seen).slice(0, 2);
}
