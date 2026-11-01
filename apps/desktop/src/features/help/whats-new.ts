import {
  Bot,
  CircleHelp,
  Eye,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  PackageCheck,
  Paperclip,
  Plug,
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
    date: "2026-11-02",
    title: "Tidier task pages and departments",
    icon: LayoutGrid,
    changes: [
      "New department shows the team across the page: the lead on top, with people who share a role grouped together",
      "The task header is shorter and tidier, and the working and waiting counts stand out",
      "Stop team is red and asks you to confirm before it stops anyone",
      "The permission setting shows once, beside Send for review. Change it there and it applies to the whole department",
      'Chats no longer repeat "Allowed by your setting" on every action',
      "Each agent's chat stays where you left it when you switch between agents",
      "Scratch is only for a department with no folder. Adding a folder replaces it, and departments that had both no longer list Scratch",
      "Home greets you by name, with a different line now and then",
      "The office stays clear: what an agent is working on shows when you hover over it or walk up to it. Requests that need you stay visible",
      "A lead can now send an update to a busy agent. It waits with a queued icon and reaches the agent when its current tool call ends",
      'Agents are asked to keep their steps up to date, and one that stops no longer shows an old "Step 1 of 10": you see what it is doing now',
      "A Claude task you messaged mid-work now finishes on time, where it could stay working and hold its department for up to 10 minutes",
      "A department is free for a new task as soon as all its agents are done, with no 10 minute wait. The new task starts everyone in a fresh conversation",
      "A department stays busy while its finished work is being checked, and work is not checked while the department is on a new task",
      "After you send a message, the chat shows where it stands: Starting the AI app, Waiting for the model, then Thinking, with the thinking as it comes",
    ],
  },
  {
    date: "2026-11-01",
    title: "Teams that recover, and drafts",
    icon: LifeBuoy,
    changes: [
      "What you type stays as a draft when you change screens or restart: forms, the task box, every message box and your answers to requests",
      "In a dialog, Cancel throws the draft away; Esc or a click outside keeps it",
      "Your messages now reach an agent while it is working",
      "A failed agent is tried again once, then its lead sees the real error and can move the work on",
      "A lead asks you in Needs you before changing direction from your goal",
      "Change an agent's model and effort from its run card",
      "Scratch always exists, and comes back if it was removed",
    ],
  },
  {
    date: "2026-10-25",
    title: "More AI apps",
    icon: Bot,
    changes: [
      "Run agents on Codex, Muse Code, GitHub Copilot CLI and Cursor CLI",
      "The Providers page shows each app's status, and installs it, signs it in and manages its accounts",
      "Model pickers offer only apps that are ready, with Get more AI apps for the rest",
      "Where an app shares no plan usage, Usage shows an estimate at API prices",
      "A new app icon, faster walking in the office, and leaving a room closes its panel",
    ],
  },
  {
    date: "2026-10-23",
    title: "Install and updates",
    icon: PackageCheck,
    changes: [
      "Office Town installs like any app and updates itself",
      "Restart to update, in the sidebar, installs a new version right away",
      "Setup can install OpenCode for you, and Claude Code on Linux",
    ],
  },
  {
    date: "2026-10-22",
    title: "Outputs and preview",
    icon: Eye,
    changes: [
      "A task's Outputs tab shows what its agents made: pages, sites, images, documents, tables and code",
      "Preview a page or a local site at phone, tablet and desktop sizes, with every version kept",
      "Mark a spot on a page and send it to the agent with your feedback",
      "Results also show in the chat, on an agent's panel and on finished tasks",
      "Open a file in its default app, or show it in its folder",
    ],
  },
  {
    date: "2026-10-18",
    title: "Connectors",
    icon: Plug,
    changes: [
      "Connect an app once on the Connectors page: with a key, as a program on this computer, or your own",
      "Choose who can use each app, and set it to Ask me first, Don't ask or Read only",
      "Claude agents use the apps you connected in claude.ai, such as Gmail, Drive and Notion",
      "An agent that needs an app asks for it in Needs you",
      "Every call to an app is listed on that app's page",
    ],
  },
  {
    date: "2026-10-14",
    title: "Setup and help",
    icon: CircleHelp,
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
    title: "Files and usage",
    icon: Paperclip,
    changes: [
      "Usage reads your plan's numbers when you open it, not only after a task",
      "Library: give files to everyone, a department or one agent, once",
      "Attach files, images and folders to a task",
    ],
  },
  {
    date: "2026-10-11",
    title: "Tasks and accounts",
    icon: ListChecks,
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
