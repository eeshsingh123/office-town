import type { AgentRecord } from "@office-town/contract";
import { z } from "zod";
import type { SessionActivity } from "../registry/activity.ts";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isLead, type LedTeam, NOT_YET, startWork, teamOf } from "./delegate.ts";
import { busyAgents, isOpen, latestSession } from "./lead.ts";
import type { TeamContext } from "./members.ts";

const SHOWN_WORDS = 300;

function workersNamed(team: LedTeam, names: string[]): AgentRecord[] {
  return [...new Set(names)].map((name) => {
    const worker = team.workers.find((member) => member.name === name);
    if (worker === undefined) {
      const known = team.workers.map((member) => member.name).join(", ") || "none yet";
      throw new ToolError(`${name} is not on your team. Your workers: ${known}.`);
    }
    return worker;
  });
}

function lastWords(activity: SessionActivity, sessionId: string): string {
  const said = activity.of(sessionId)?.lastMessage?.trim() ?? "";
  if (said === "") return "";
  const shown = said.length > SHOWN_WORDS ? `${said.slice(0, SHOWN_WORDS)}…` : said;
  return ` Its last words:\n${shown}`;
}

// A worker with nothing handed out is stopped too: its own sub-agents may still be running.
// Its delegation ends first, so no "stopped" result wakes the lead for a turn it caused.
export function stopWork(context: TeamContext, activity: SessionActivity) {
  const { store, registry } = context;
  return defineTool({
    name: "stop_work",
    description:
      "Stop workers now, such as when they go beyond what you asked or spend too much. Each " +
      "ends its turn and its program closes, so nothing more runs or uses tokens. Its " +
      "conversation is kept: resume_work has it carry on where it stopped.",
    input: z.object({
      agents: z
        .array(z.string().min(1))
        .min(1)
        .describe("The workers to stop, by name, such as @ben-1042."),
      reason: z
        .string()
        .trim()
        .min(1)
        .describe("Why, in a sentence. The user reads it on the worker's trace."),
    }),
    offeredTo: isLead(context),
    async call({ agents, reason }, caller: Caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const workers = workersNamed(team, agents);
      const by = { agentId: caller.agentId, reason };
      const lines = await Promise.all(
        workers.map(async (worker) => {
          const session = latestSession(context, caller.taskId, worker.id);
          if (session === undefined || !isOpen(session))
            return `- ${worker.name}: was not running.`;
          const words = lastWords(activity, session.id);
          const working = store.workingDelegation(session.id);
          if (working !== undefined) store.endDelegation(working.id, "stopped");
          try {
            await registry.stop(session.id, false, by);
          } catch (error) {
            if (error instanceof SessionNotRunningError)
              return `- ${worker.name}: had already ended.`;
            return `- ${worker.name}: could not be stopped and may still be running.`;
          }
          return `- ${worker.name}: stopped.${words}`;
        }),
      );
      return `${lines.join("\n")}\n\nTo have one carry on where it stopped, call resume_work.`;
    },
  });
}

// The same piece, in the same conversation when the harness kept it.
export function resumeWork(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "resume_work",
    description:
      "Have a stopped worker carry on with the piece it was stopped on, from where it left " +
      "off, with its conversation kept. For new or changed work, use delegate instead.",
    input: z.object({
      agent: z.string().min(1).describe("The stopped worker's name, such as @ben-1042."),
    }),
    offeredTo: isLead(context),
    async call({ agent }, caller: Caller) {
      const team = teamOf(context, caller);
      if (team === undefined) throw new ToolError(NOT_YET);
      const [worker] = workersNamed(team, [agent]);
      if (worker === undefined) throw new ToolError(`${agent} is not on your team.`);
      const stopped = store
        .listDelegations(caller.taskId)
        .findLast((one) => one.workerAgentId === worker.id);
      if (stopped?.status !== "stopped") {
        throw new ToolError(
          `${worker.name} has no stopped piece to carry on. Use delegate to give it work.`,
        );
      }
      const earlier = latestSession(context, caller.taskId, worker.id);
      const here = earlier !== undefined && isOpen(earlier);
      if (!here && busyAgents(store, [worker.id]).length > 0) {
        throw new ToolError(`${worker.name} is busy on another task. Try again once it is free.`);
      }
      const work =
        "You were stopped before you finished. Carry on with the same piece from where you " +
        `left off. The piece, as briefed:\n${stopped.brief}`;
      const session = await startWork(context, team, caller, worker, work, []);
      if (!isOpen(session)) {
        throw new ToolError(`${worker.name} could not start. Its trace says why.`);
      }
      store.createDelegation({
        taskId: caller.taskId,
        workerAgentId: worker.id,
        workerSessionId: session.id,
        brief: stopped.brief,
      });
      return `${worker.name} is carrying on. Its result will reach you as a message when it finishes.`;
    },
  });
}
