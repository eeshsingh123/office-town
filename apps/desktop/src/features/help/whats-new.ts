import {
  CalendarClock,
  History,
  Inbox,
  Laptop,
  LayoutGrid,
  type LucideIcon,
  MousePointerClick,
  Rocket,
  Send,
  SlidersHorizontal,
  Sparkles,
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
    date: "2026-11-24",
    title: "Automation results where you already are",
    icon: Send,
    changes: [
      "Connectors has Send results to: paste a key once for Telegram, Slack, Discord, ntfy, email through Resend or a webhook, and send a test. Add lists them under Send results",
      "In Rules, pick where an automation sends its results, failed runs, pauses and asks. A long result goes as a file where the service takes files",
      "Things that look like keys or passwords are hidden before anything is sent. A send that fails says so on the run, and three in a row show on the automation",
      "Link Telegram once by sending your bot a code. It gets results and alerts like Slack and Discord, and you answer in Office Town",
      "A run with nothing new ends quietly: no message, nothing to review, and the next run still sees the last real result",
      "An automation keeps notes from run to run, which you can read, edit and clear on its page",
      "A message you send while an agent is in a long step now shows as waiting until it reads it, and one it never read goes with it when it carries on",
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
  {
    date: "2026-11-20",
    title: "A smoother Office, clearer Usage",
    icon: MousePointerClick,
    changes: [
      "Usage shows one card per provider and one row per account, with its 5-hour and weekly limits side by side",
      "Each provider links to its own usage page. Providers that share no limits show the tokens your agents used",
      "A provider with more than 4 accounts gets its own search and sort",
      "The warning that an account will reach a limit is quieter and can be dismissed until that limit resets",
      "Home's Plan usage shows your most used accounts as small cards, the same as Usage",
      "Providers lists signed-in providers first and the ones to sign in below, with their buttons lined up",
      "Opening or closing a department keeps the floor as it is: the side panel pushes in beside it and the room glides into view, with no zooming or jumping",
      "Clicking a room's sign redraws the floor once instead of three times, so rooms open without a stutter",
      "The panel's close button closes the department, so its sign opens it again",
      "A click anywhere around the floor, also below it, closes the department",
      "Lists with filters have a Clear filters button beside them while any filter is on",
      "Your profile is lighter: the name preview is gone and the groups have more room",
      "New task works from every page: on Home and on New task it puts the cursor in the box, elsewhere it opens New task",
      "A department's + picks that department in the task box, also on Home and on New task, and what you typed stays",
      "Small icon buttons, such as the sidebar's + and the fold arrows, have their icon centred",
      "Home names who is working, each name opening where it works, and says your team is ready for a new task when everyone is free",
    ],
  },
  {
    date: "2026-11-19",
    title: "A clearer start",
    icon: Sparkles,
    changes: [
      "Departments are made in one place, New department. Home, the sidebar and Team no longer have their own boxes for it",
      "Home stays on your task until one is done, then offers Make this a department, which drafts a team for work like it",
      "An empty Office shows a sample room with a New department button. Add a chief shows once you have a department",
      "The tutorial card sits beside what it points at instead of on top of it, and has a Stop tutorial button",
      "When no provider is ready, a line above the task box says so, with a button to install OpenCode, which has free models. Start stays off until a provider is ready",
    ],
  },
  {
    date: "2026-11-19",
    title: "Settings, your profile and agent profiles",
    icon: SlidersHorizontal,
    changes: [
      "Settings is in the order people look for things: Appearance, Notifications, New tasks, Accessibility, Desktop, then Storage and About. Every row has its control on the right and saves at once",
      "Theme can follow your computer again: System, Light or Dark. Text size is now Interface size, since it grows icons and spacing too",
      "New tasks has a default for Permissions, Manual or Auto (Auto unless you change it). New tasks, teams and departments start there, and the composer's chip changes one task only. If the composer was on Manual before, Manual becomes your default",
      "Notifications save at once and can send a test, and say when your computer blocks them",
      "Desktop: choose whether closing the window keeps agents running in the tray or quits, and open the app at login. The first time closing hides the window, a note says where it went",
      "Storage and About: open the data folder, see your version and channel, check for updates or restart to install one",
      "Ctrl , opens Settings, and Ctrl K finds each Settings group by name",
      "Your profile is split into How you appear, with a preview, and What agents should know. Answer length is one pick, short or detailed",
      "Colour pickers show a tick on the pick and its name",
      "An agent's Profile, a team member and a template share one set of fields in one order: Identity, Job, Runs on. Save lights up only when something changed, and Save as template is in the … menu",
      "A team member links to its full profile, and a lead's profile says its colour is also the team's",
    ],
  },
  {
    date: "2026-11-19",
    title: "A shorter first run",
    icon: Rocket,
    changes: [
      "Setup is two steps: what the app does, then the provider to start with. It ends on your first real task",
      "Ready providers come first and you pick one; OpenCode, which has free models, is picked unless you choose another. The rest fold under More providers",
      "Your first task matches what you said you will use the app for",
      "Whether you finish setup or skip it, new tasks run on Auto and save to a new folder each. Pick Manual on a task to have agents ask first",
      "Tutorials put your saved model and permission back when they end, even when you stop one",
      "Home shows one next step instead of the Getting started list. All tutorials are in Help",
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
