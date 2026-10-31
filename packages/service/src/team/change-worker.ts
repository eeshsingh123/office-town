import { randomUUID } from "node:crypto";
import type { AgentRecord } from "@office-town/contract";
import { z } from "zod";
import { levelOf } from "../autonomy/policy.ts";
import { AnswerError } from "../registry/session-registry.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isLead, NOT_YET, teamOf } from "./delegate.ts";
import { noteLead } from "./direct-message.ts";
import { isOpen } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { checkedSettings } from "./propose-team.ts";
import { finishedWork } from "./team-tasks.ts";

// An agent between turns closes, so its next message resumes it on the new model. One at work is
// never cut off: it takes the model at its next start.
export async function applyModelChange({ store, registry }: TeamContext, agentId: string) {
  const [latest] = store.listAgentSessions(agentId, { limit: 1 }).sessions;
  if (latest === undefined || !isOpen(latest)) return;
  const waiting = new Set(store.listPendingRequests().requests.map(({ event }) => event.sessionId));
  if (!finishedWork(store, latest, waiting)) return;
  await registry.stop(latest.id, true);
}

function changed(worker: AgentRecord, model: string | undefined, effort: string | undefined) {
  const { model: _, effort: __, ...settings } = worker.settings;
  return {
    ...settings,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  };
}

// The user changed it, on the run card or in the agent's profile. The lead hears, as the worker is
// its to hand work to.
export async function modelChangedByUser(context: TeamContext, agent: AgentRecord) {
  await applyModelChange(context, agent.id);
  const [latest] = context.store.listAgentSessions(agent.id, { limit: 1 }).sessions;
  if (latest === undefined) return;
  const model = agent.settings.model ?? "its default model";
  await noteLead(
    context,
    agent,
    latest.taskId,
    `The user moved ${agent.name} to ${model}. If its last piece failed, call resume_work to have it carry on.`,
    `The user changed the model of ${agent.name}`,
  );
}

// It follows the department's level (D-77): a failed worker has no work to cut off, and Don't ask
// means the team fixes itself. The user can change it back on the run card.
export function changeWorker(context: TeamContext) {
  const { store, registry } = context;
  return defineTool({
    name: "change_worker",
    description:
      "Move a worker to another model or effort of the AI app it runs on, such as when its " +
      "model keeps refusing the work. Then have it carry on with resume_work. If the user must " +
      "approve it, it returns at once and their answer reaches you later as a message.",
    input: z.object({
      agent: z.string().min(1).describe("The worker's name, such as @ben-1042."),
      model: z.string().min(1).describe("A model of that worker's AI app."),
      effort: z.string().min(1).optional().describe("An effort value of that model."),
      reason: z.string().trim().min(1).describe("Why, in a sentence, for the user."),
    }),
    offeredTo: isLead(context),
    async call({ agent, model, effort, reason }, caller: Caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const worker = team.workers.find((member) => member.name === agent);
      if (worker === undefined) throw new ToolError(`${agent} is not on your team.`);
      const { harness, environment } = worker.settings;
      await checkedSettings(context, { harness, model, effort }, environment);
      const apply = async () => {
        const settings = changed(worker, model, effort);
        store.updateAgent(worker.id, { ...worker, settings });
        await applyModelChange(context, worker.id);
      };
      if (levelOf(store, caller.agentId) !== "supervised") {
        await apply();
        return `${worker.name} now runs on ${model}. Call resume_work to have it carry on.`;
      }
      const requestId = `change-${randomUUID()}`;
      registry.ask(
        caller.sessionId,
        {
          type: "permission.requested",
          payload: {
            requestId,
            title: `Move ${worker.name} to ${model}, asked by ${team.lead.name}. ${reason}`,
            input: { agent, model, effort, reason },
            options: [
              { optionId: "approve", label: "Change it", kind: "allow_once" },
              { optionId: "decline", label: "Keep it", kind: "reject_once" },
            ],
          },
        },
        (command) => {
          if (command.type !== "answerPermission") throw new AnswerError("This is an approval.");
          const approved = command.optionId === "approve";
          return {
            resolution: {
              type: "permission.resolved",
              payload: {
                requestId,
                outcome: approved ? "allowed" : "denied",
                optionId: command.optionId,
                answeredBy: "user",
              },
            },
            afterwards: async () => {
              if (approved) await apply();
              const text = approved
                ? `The user approved: ${worker.name} now runs on ${model}. Call resume_work to have it carry on.`
                : `The user kept ${worker.name} on its model.`;
              await registry.tell(caller.sessionId, {
                text,
                origin: {
                  kind: "notice",
                  summary: approved ? "You changed the model" : "You kept the model",
                },
              });
            },
          };
        },
      );
      return "Your request is with the user. Their answer will reach you as a message.";
    },
  });
}
