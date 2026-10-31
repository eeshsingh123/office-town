import type { TaskRecord } from "@office-town/contract";
import { type AppState, navigate, useApp } from "../../store/app-store.ts";
import { writeDraft } from "../../store/drafts.ts";
import { defaultWorkspace } from "../../store/workspaces.ts";
import { DEFAULT_CHOICES, loadRemembered, remember } from "../new-task/choices.ts";
import { SOLO } from "../new-task/targets.ts";
import type { TutorialModel } from "./tutorial-model.ts";

export type TutorialId = "first-task" | "department" | "chief" | "library";

// What the app held when the tutorial started, so a step can tell what the user added since.
export interface TutorialRun {
  id: TutorialId;
  step: number;
  startedAt: string;
  departments: number;
  library: number;
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

const SAMPLE_TASK =
  "Write a one-page plan for a team lunch next Friday and save it as lunch-plan.md.";
const DRAFTER_KEY = "office-town.drafter";

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
    summary: "An assistant writes a short plan and asks you before saving it.",
    start(model) {
      const workspaces = useApp.getState().workspaces ?? [];
      const scratch = workspaces.find((workspace) => workspace.kind === "scratch");
      if (model !== undefined) {
        const { harness, environment, model: id, effort } = model.settings;
        const saved = loadRemembered().byHarness[harness] ?? DEFAULT_CHOICES;
        remember({
          harness,
          choices: {
            ...saved,
            environment,
            ...(id === undefined ? {} : { model: id }),
            ...(effort === undefined ? {} : { effort }),
            autonomy: "supervised",
          },
          target: SOLO,
          workspaceId: (scratch ?? defaultWorkspace(workspaces, undefined))?.id,
        });
      }
      navigate({ name: "new-task", prompt: SAMPLE_TASK, who: "one" });
    },
    steps: [
      {
        title: "Start the task",
        text: "Here is a sample task. Change it if you like, then press Start.",
        target: "composer",
        done: (state, run) => newTasks(state, run).length > 0,
      },
      {
        title: "Allow the file",
        text: "The assistant asks before it saves a file. Press Allow once when it does.",
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
        try {
          localStorage.setItem(DRAFTER_KEY, JSON.stringify(model.settings));
        } catch {
          // The draft then uses the model the user picked before.
        }
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
        text: "Use Given to if only one department or agent should see it.",
      },
    ],
  },
];

export const tutorialById = (id: TutorialId): Tutorial =>
  TUTORIALS.find((tutorial) => tutorial.id === id) ?? (TUTORIALS[0] as Tutorial);
