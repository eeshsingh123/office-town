import type { Onboarding, RoleSettings, TaskRecord } from "@office-town/contract";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import { writeDraft } from "../../store/drafts.ts";
import { type Keep, readKept, writeKept } from "../../store/kept.ts";
import { defaultWorkspace } from "../../store/workspaces.ts";
import { DRAFTER } from "../drafts/use-drafter.ts";
import {
  DEFAULT_CHOICES,
  loadRemembered,
  type Remembered,
  remember,
  restoreRemembered,
} from "../new-task/choices.ts";
import { SOLO } from "../new-task/targets.ts";
import type { TutorialModel } from "./tutorial-model.ts";

export type TutorialId = "first-task" | "department" | "chief" | "library" | "apps";

// What the app held when the tutorial started, so a step can tell what the user added since.
export interface TutorialRun {
  id: TutorialId;
  step: number;
  startedAt: string;
  departments: number;
  library: number;
  // Apps added in Office Town; a provider's own are listed without the user.
  apps: number;
}

export interface TutorialStep {
  title: string;
  text: string;
  // The `data-tour` value of the part of the screen this step is about.
  target?: string;
  // Moves on by itself once true; without it the user presses Next.
  done?: (state: AppState, run: TutorialRun) => boolean;
}

export interface Tutorial {
  id: TutorialId;
  title: string;
  summary: string;
  // Why it cannot start yet.
  blocked?: (state: AppState) => string | undefined;
  start: (model: TutorialModel | undefined) => void;
  steps: TutorialStep[];
}

export const sharedApps = (state: AppState) =>
  Object.values(state.connectors).filter(
    ({ setup }) => setup.kind === "remote" || setup.kind === "local",
  ).length;

// The first task matches what the user said they will use the app for in setup.
const SAMPLE_TASKS: Record<NonNullable<Onboarding["purpose"]>, string> = {
  software:
    "Write a short README for a to-do list app: what it does, how to install it and how to use it. Save it as README.md.",
  business:
    "Write a short welcome email for a new team member who starts next Monday and save it as welcome-email.md.",
  exploring: "Write a one-page plan for a team lunch next Friday and save it as lunch-plan.md.",
};

// What a tutorial replaced, put back when it ends. Saved, so a restart mid-tutorial puts it back.
interface Replaced {
  remembered?: Remembered;
  // Null when the user had not picked a drafting model.
  drafter?: RoleSettings | null;
}

const REPLACED: Keep<Replaced | undefined> = {
  name: "tutorial-replaced",
  lasts: "saved",
  start: undefined,
  parse: (saved) => (typeof saved === "object" && saved !== null ? (saved as Replaced) : undefined),
};

// Only the first save counts, so starting a tutorial twice keeps the user's own choices.
function keepBeforeTutorial(change: Replaced) {
  const replaced = readKept(REPLACED) ?? {};
  writeKept(REPLACED, { ...change, ...replaced });
}

export function restoreChoices(): void {
  const replaced = readKept(REPLACED);
  if (replaced === undefined) return;
  if (replaced.remembered !== undefined) restoreRemembered(replaced.remembered);
  if (replaced.drafter !== undefined) writeKept(DRAFTER, replaced.drafter ?? undefined);
  writeKept(REPLACED, undefined);
}

const newTasks = (state: AppState, run: TutorialRun): TaskRecord[] =>
  Object.values(state.tasks)
    .map((entry) => entry.task)
    .filter((task) => task.createdAt >= run.startedAt && task.parentTaskId === undefined);

const chiefGoal = (state: AppState, run: TutorialRun) =>
  newTasks(state, run).find((task) =>
    Object.values(state.sessions).some(
      (session) => session.taskId === task.id && session.agentId === state.chiefId,
    ),
  );

export const TUTORIALS: Tutorial[] = [
  {
    id: "first-task",
    title: "Your first task",
    summary: "An assistant writes a short file for you and saves it.",
    start(model) {
      const { workspaces = [], onboarding } = useApp.getState();
      const scratch = workspaces.find((workspace) => workspace.kind === "scratch");
      if (model !== undefined) {
        keepBeforeTutorial({ remembered: loadRemembered() });
        const { harness, environment, model: id, effort } = model.settings;
        const saved = loadRemembered().byHarness[harness] ?? DEFAULT_CHOICES;
        remember({
          harness,
          choices: {
            ...saved,
            environment,
            ...(id === undefined ? {} : { model: id }),
            ...(effort === undefined ? {} : { effort }),
          },
          target: SOLO,
          workspaceId: (scratch ?? defaultWorkspace(workspaces, undefined))?.id,
        });
      }
      const prompt = SAMPLE_TASKS[onboarding?.purpose ?? "exploring"];
      navigate({ name: "new-task", prompt, who: "one" });
    },
    steps: [
      {
        title: "Start the task",
        text: "Here is a sample task. Change it if you like, then press Start.",
        target: "composer",
        done: (state, run) => newTasks(state, run).length > 0,
      },
      {
        title: "Let it work",
        text: "The assistant writes the file and saves it. On Manual it asks first: press Allow when it does.",
        done: (state, run) =>
          newTasks(state, run).some((task) => task.state === "idle" || task.state === "ended"),
      },
      {
        title: "Open the result",
        text: "Read its reply in the chat. The folder name under the chat opens the file.",
      },
    ],
  },
  {
    id: "department",
    title: "Build a department",
    summary: "Describe a team in your own words, check it, and create it.",
    start(model) {
      if (model !== undefined) {
        keepBeforeTutorial({ drafter: readKept(DRAFTER) ?? null });
        writeKept(DRAFTER, model.settings);
      }
      // Its first step points at the Describe box, wherever a draft was left.
      writeDraft("new-department.step", 0);
      navigate({ name: "new-department" });
    },
    steps: [
      {
        title: "Describe the team",
        text: "Say who you need, for example: a writer and an editor for a weekly newsletter. Then press Enter.",
        target: "draft",
      },
      {
        title: "Check the team",
        text: "Open each person to change their role, instructions or model.",
      },
      {
        title: "Create it",
        text: "Go to the last step and press Create.",
        done: (state, run) => Object.keys(state.departments).length > run.departments,
      },
    ],
  },
  {
    id: "chief",
    title: "Create a chief and give it a goal",
    summary: "Set up a chief, then hand it one goal to split across your departments.",
    blocked: (state) =>
      Object.keys(state.departments).length === 0 ? "Build a department first." : undefined,
    start() {
      navigate({ name: "chief" });
    },
    steps: [
      {
        title: "Set up the chief",
        text: "Name it and pick its AI. The defaults are fine.",
        done: (state) => state.chiefId !== undefined,
      },
      {
        title: "Give it a goal",
        text: "Write a goal that needs more than one department, then press Enter.",
        target: "chief-goal",
        done: (state, run) => chiefGoal(state, run) !== undefined,
      },
      {
        title: "Approve the plan",
        text: "The chief sends you a plan in Needs you. Check it and approve it.",
        done: (state, run) => {
          const goal = chiefGoal(state, run);
          return Object.values(state.pieces).some(
            (piece) => piece.taskId === goal?.id && piece.pieceTaskId !== undefined,
          );
        },
      },
    ],
  },
  {
    id: "library",
    title: "Give agents your files",
    summary: "Add a file once and every task in the workspace can use it.",
    start() {
      const workspaces = useApp.getState().workspaces ?? [];
      const workspace = defaultWorkspace(workspaces, loadRemembered().workspaceId);
      if (workspace === undefined) return navigate({ name: "workspaces" });
      navigate({ name: "workspace", workspaceId: workspace.id, tab: "library" });
    },
    steps: [
      {
        title: "Add a file",
        text: "Add something agents should know, like a style guide or a product brief.",
        target: "library-add",
        done: (state, run) => Object.keys(state.library).length > run.library,
      },
      {
        title: "Choose who gets it",
        text: "To share it with only one department or agent, use Given to.",
      },
    ],
  },
  {
    id: "apps",
    title: "Connect your first app",
    summary: "Connect an app, see what it can do, and watch an agent use it.",
    start() {
      navigate({ name: "connectors" });
    },
    steps: [
      {
        title: "Connect one app",
        text: "Press Add app and pick one. Exa and Context7 need no key, so they connect at once.",
        target: "connectors-add",
        done: (state, run) => sharedApps(state) > run.apps,
      },
      {
        title: "See what it can do",
        text: "Open the app. Its page lists what agents can read and change, and who may use it.",
      },
      {
        title: "Watch an agent use it",
        text: "Start a task that needs it, such as: find this week's AI news with Exa. The app's page shows each use under Recent use.",
      },
    ],
  },
];

export const tutorialById = (id: TutorialId): Tutorial =>
  TUTORIALS.find((tutorial) => tutorial.id === id) ?? (TUTORIALS[0] as Tutorial);
