import {
  Bot,
  CircleHelp,
  Eye,
  Gauge,
  History,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  MousePointerClick,
  PackageCheck,
  Paperclip,
  Plug,
  Search,
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
    date: "2026-11-12",
    title: "Connectors, simpler",
    icon: Plug,
    changes: [
      "One card per app. Small provider tags show who can use it: All, or Claude, Codex or OpenCode for an app that provider signs in to",
      "Codex's ChatGPT apps and OpenCode's own servers now show beside your Claude apps. Every call to them follows the app's permission, and its page lists each use",
      "The only alert left is Needs renewing, for a sign-in to renew",
      "Add searches a list of apps we checked, and shows what an app can read and change before you save it. An address or command sits under Advanced",
      "Ten more apps made by their own companies, such as Exa, Context7, Firecrawl and PostHog",
      "When an agent asks for an app, Needs you names the provider and sets it up in one click. It goes to the agent's department unless you pick otherwise",
      "An app given mid-task reaches the agent in a fresh conversation, so it carries on with it",
      "A department's panel lists its apps, and the team builder warns when no member can reach one",
      "A new walkthrough connects your first app",
    ],
  },
  {
    date: "2026-11-10",
    title: "Milestones and one Progress view",
    icon: ListChecks,
    changes: [
      "Turn on Milestones in Settings, in a new task's Options, or on a running task's run card. The team first writes down what you'll get, in plain words",
      "Progress takes the place of Steps: what you'll get, who is doing what, and each person's steps, all updated live",
      "Add, change or remove any milestone, or ask an agent to add or drop a step. The agent is told at its next step, and Progress shows when it has your change",
      "A part with every milestone met is done at once. You get a short notice, and nothing waits on you",
      "A lead can send a part back twice at most. After that, it comes to you in Needs you",
      "The office floor shows each department's progress, and each desk shows its person's part",
      "The chief's plan lists each part's milestones, and you can edit them before you approve",
      "Settings is a new page above Help. Display and the defaults for new tasks moved there",
      "An agent whose AI app closes after its work is done now shows as done, not failed",
    ],
  },
  {
    date: "2026-11-09",
    title: "Efficient mode for long chats",
    icon: MessagesSquare,
    changes: [
      "Pick Efficient in Help, or on a running task's run card: when an agent's chat grows long, it carries on in a new session with a complete handover, and uses fewer tokens",
      'You still see one chat, with the line "Continued in a new session with complete handover"',
      "Each handover shows in the task's Outputs as a readable document you can export, save to the Library for the agent that wrote it, or clear once the task is done",
      "Switching a chief's goal to Efficient switches its departments' parts too",
      "In One place, the lead suggests a new session sooner, at 300k tokens",
      "An agent that asks for a new session on its own now waits for your answer in Needs you",
    ],
  },
  {
    date: "2026-11-09",
    title: "Providers load faster",
    icon: Plug,
    changes: [
      "Providers, setup and New task show each provider as soon as it is checked, instead of waiting for all of them",
    ],
  },
  {
    date: "2026-11-09",
    title: "Quicker start",
    icon: Gauge,
    changes: [
      "Tasks shows your tasks as soon as you open it, even while the app is still starting",
      "The app stays quick while it checks your providers at start",
    ],
  },
  {
    date: "2026-11-08",
    title: "Long task histories",
    icon: Search,
    changes: [
      "Search, filters and counts on Tasks now cover every task you have, so an old task shows up without clicking Show older tasks first",
      "Ctrl+K searches all your tasks once you type, not only the recent ones",
      "A long run opens on its latest steps. Show earlier, at the top, brings back the rest",
      "The app keeps fewer finished runs in memory, so it stays quick as you open more tasks",
      "The app starts faster when you have run many tasks",
    ],
  },
  {
    date: "2026-11-08",
    title: "Back where you left off",
    icon: History,
    changes: [
      "Going back to Tasks or Needs you finds your filters, folded groups, ticked requests and place in the list as you left them, until you restart the app",
      "Searches on Connectors, Workspaces and the Team page stay when you come back to them",
      "A team task shows the member you were looking at when you come back to it",
      "Spots you marked on a page in Outputs, its screen size and the version you picked stay when you leave the task",
      "First-run setup picks up at the step you left, even after a restart",
    ],
  },
  {
    date: "2026-11-08",
    title: "Calmer office",
    icon: LayoutGrid,
    changes: [
      "The office no longer flickers on smaller or zoomed screens when a scrollbar appears",
      "A department's name tag shows just its name. Open the department or walk into it to see the tokens its task used",
      "Clicking anywhere inside a department opens it and keeps it open. Clicking outside the rooms keeps the department you stand in open. Only the department you are in is outlined",
      "Press Enter with a department open to chat with its lead",
      "Leaving the office and coming back keeps where you stood and the room you had open",
      "The open floor has two desks. Click it to start a task for an assistant",
      "Walking no longer jumps back a little when you start",
      "Dragging a side panel's edge to resize it no longer selects the text beside it",
    ],
  },
  {
    date: "2026-11-05",
    title: "Plainer words",
    icon: CircleHelp,
    changes: [
      "One name for each thing across the app: task, part, Idle, Provider, and Allow or Deny for requests",
      "Shorter hints, warnings and safety check text",
      "Errors say what happened in plain words, with no internal names",
    ],
  },
  {
    date: "2026-11-05",
    title: "Right-click menus",
    icon: MousePointerClick,
    changes: [
      "Right-click a text box to cut, copy, paste or select all. Right-click a misspelled word to see suggestions",
      "Right-click selected text or a link to copy it",
      "Right-click an agent to open its task, send it for review, pin it or stop it",
      "Right-click a department, in the sidebar or its room, to open it, give it a new task, change its settings, pin its agents or stop its team",
      "Right-click a task to open it, show it in the office, copy its title or delete it",
      "Right-click a message to copy it. Right-click a file to open it, show it in its folder or copy its path",
      "Every Stop button now asks you to confirm first",
    ],
  },
  {
    date: "2026-11-04",
    title: "Clearer chats and task names",
    icon: Eye,
    changes: [
      "Each task gets a short name that says what it is about. Until then, your first message is used as its name",
      "When you type your own answer to a question, the box grows as you type. Enter sends it, Shift+Enter adds a new line",
      "The team list shows which chat is open, so only one person looks selected",
      "An agent's thinking now scrolls smoothly as it comes in, with no cut-off words",
      "If Office Town restarts during a task, the department is free for a new task again. Its lead is told which work was stopped",
      "Stop team disappears once the team is done",
      "On a task page, you can add files, images, folders and Library files (#) to a message, just like in New task. A message to a team member is also sent to their lead",
      "Adding files or writing a long message no longer hides the latest lines of the chat",
      "If a model can't see images, another model describes your image in words first. The agent gets both",
      "In the Office, an agent's chat shows each task under its own heading. Earlier tasks fold into a card you can click to open. The line above the message box shows which task your message goes to",
    ],
  },
  {
    date: "2026-11-02",
    title: "Tidier task pages and departments",
    icon: LayoutGrid,
    changes: [
      "New department shows the whole team on one page: the lead at the top, people in the same role grouped together",
      "The task header is shorter and tidier, and the working and waiting counts stand out",
      "Stop team is red and asks you to confirm before it stops anyone",
      "The permission setting shows once, beside Send for review. Change it there and it applies to the whole department",
      'Chats no longer repeat "Allowed by your setting" on every action',
      "Each agent's chat stays where you left it when you switch between agents",
      "Scratch is only for a department with no folder. A department with its own folder no longer also lists Scratch",
      "Home greets you by name, with a different line now and then",
      "To keep the office tidy, an agent's current work shows only when you hover over it or walk up to it. Requests that need you always show",
      "A lead can now message an agent that is busy. The message shows as Queued until the agent can read it",
      "Agents keep their step list up to date. If an agent stops updating it, the Steps list says so instead of showing an old step",
      "Fixed: a chief's plan stopped if a department got its own folder before its work started",
      "Fixed: messaging a Claude agent during a task could keep its department busy for up to 10 minutes",
      "A department is free for a new task as soon as all its agents finish. Each new task starts every agent in a new chat",
      "A department stays busy while its work is being reviewed, so a new task can't start in the middle of a review",
      "After you send a message, the chat shows what is happening: Starting the provider, Waiting for the model, then Thinking",
    ],
  },
  {
    date: "2026-11-01",
    title: "Teams that recover, and drafts",
    icon: LifeBuoy,
    changes: [
      "What you type stays as a draft when you change screens or restart: forms, the task box, every message box and your answers to requests",
      "In a dialog, Cancel deletes your draft. Esc or clicking outside keeps it",
      "Your messages now reach an agent while it is working",
      "If an agent fails, it tries once more. If it fails again, its lead sees the error and decides what to do",
      "A lead asks you in Needs you before it changes what you asked for",
      "Change an agent's model and thinking level from Run details",
      "Scratch always exists, and comes back if it was removed",
    ],
  },
  {
    date: "2026-10-25",
    title: "More providers",
    icon: Bot,
    changes: [
      "Run agents on Codex, Muse Code, GitHub Copilot CLI and Cursor CLI",
      "The Providers page shows each app's status, and installs it, signs it in and manages its accounts",
      "The model menu lists only providers that are ready to use. Get more shows the rest",
      "If a provider doesn't report your plan usage, Usage shows an estimated cost instead",
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
      "Connect an app once on the Connectors page. Some need a key, some run on this computer, and you can add your own",
      "Choose who can use each app, and set it to Ask me first, Don't ask or Read only",
      "Claude agents use the apps you connected in claude.ai, such as Gmail, Drive and Notion",
      "An agent that needs an app asks for it in Needs you",
      "Each app's page lists every time an agent used it",
    ],
  },
  {
    date: "2026-10-14",
    title: "Setup and help",
    icon: CircleHelp,
    changes: [
      "A setup guide when you first open the app, and tutorials you can run any time from Help",
      "Help has settings for text size, higher contrast, less motion, and reading new requests aloud with a screen reader",
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
      "Usage shows your plan's numbers as soon as you open it",
      "Library: add a file once and give it to everyone, a department or one agent",
      "Attach files, images and folders to a task",
    ],
  },
  {
    date: "2026-10-11",
    title: "Tasks and accounts",
    icon: ListChecks,
    changes: [
      "Back and Forward between screens",
      "Several accounts per provider, and a Usage page",
      "Tasks grouped by team, with search and filters",
      "Home and New task use the same box to start a task",
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
