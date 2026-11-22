import {
  type AutomationTask,
  automationRequestSchema,
  scheduleSchema,
} from "@office-town/contract";
import { z } from "zod";
import { levelOf } from "../autonomy/policy.ts";
import { isChiefTask } from "../chief/chief.ts";
import type { TeamContext } from "../team/members.ts";
import { putQuestion } from "../tools/ask-user.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { problemWith } from "./checks.ts";
import type { Runner } from "./runner.ts";

const CREATE = "Create it";
const DECLINE = "Don't create it";

// The proposing team does the work: its department, the chief, or this assistant on its own
// settings, at the level it has now.
function taskFor({ store }: TeamContext, caller: Caller, prompt: string): AutomationTask {
  const task = store.getTask(caller.taskId);
  const agent = store.getAgent(caller.agentId);
  if (task === undefined || agent === undefined) throw new ToolError("Your task is gone.");
  if (isChiefTask(store, task.id)) return { kind: "chief", request: { goal: prompt } };
  if (task.departmentId !== undefined) {
    return {
      kind: "department",
      request: {
        goal: prompt,
        team: {
          departmentId: task.departmentId,
          ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
        },
      },
    };
  }
  if (task.workspaceId === undefined) throw new ToolError("Your task has no workspace.");
  return {
    kind: "assistant",
    request: {
      prompt,
      agent: { settings: agent.settings },
      autonomy: levelOf(store, agent.id),
      workspaceId: task.workspaceId,
    },
  };
}

// On `propose_change`'s pattern (D-78): an automation is never made without the user (D-118).
export function proposeSchedule(context: TeamContext, runner: Runner) {
  const { store, registry } = context;
  return defineTool({
    name: "propose_schedule",
    description:
      "Propose an automation: a task that starts on its own on a schedule, such as a weekly " +
      "report or a post at a set time. Use it instead of waiting, sleeping or polling. The " +
      "user approves it first; it returns at once and their answer reaches you as a message.",
    input: z.object({
      name: z.string().trim().min(1).max(80).describe("A short name, such as Weekly report."),
      schedule: scheduleSchema.describe(
        'When: {"repeat":"daily","time":"09:00"}, "weekdays", "weekly" with days (0 is Sunday), "monthly" with day, "hours" with every, from and until, or "once" with date and time.',
      ),
      prompt: z
        .string()
        .trim()
        .min(1)
        .describe("The task each run starts with, complete on its own. {date} is today's date."),
      why: z.string().trim().min(1).describe("Why it should run on its own, in a sentence."),
    }),
    offeredTo: (caller) => store.getTask(caller.taskId)?.origin?.kind !== "automation",
    call({ name, schedule, prompt, why }, caller: Caller) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const fields = automationRequestSchema.parse({
        name,
        task: taskFor(context, caller, prompt),
        trigger: { kind: "schedule", schedule, timeZone },
        rules: {},
      });
      const problem = problemWith(store, undefined, fields.trigger);
      if (problem !== undefined) throw new ToolError(problem);
      putQuestion(
        registry,
        caller.sessionId,
        {
          text: `New automation: ${name}\n\n${why}\n\nEach run: ${prompt}`,
          options: [
            { label: CREATE, description: "It starts on its own from its next time." },
            { label: DECLINE, description: "Nothing is created." },
          ],
          multiSelect: false,
        },
        (selected) => {
          if (selected.length !== 1 || selected[0] !== CREATE) {
            return `The user did not create the automation "${name}"${selected[0] === DECLINE ? "" : `; they said: ${selected.join(", ")}`}.`;
          }
          const created = store.automations.create(fields, []);
          runner.refreshNext(created.id);
          return `The user created the automation "${name}". It runs on its own from its next time; you need not do anything for it.`;
        },
      );
      return "Your automation is with the user. Their answer will reach you as a message.";
    },
  });
}
