import type { AgentRecord, SessionRecord } from "@office-town/contract";
import { SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { isOpen, latestSession } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { claimDepartment } from "./team-tasks.ts";

export class NeverStartedError extends Error {
  constructor(name: string) {
    super(`${name} has not worked on anything yet, so there is nothing to message.`);
    this.name = "NeverStartedError";
  }
}

// The message reaches the agent at work at once; one that finished is resumed with it, in its
// latest task, once that task's department is free.
async function deliver(context: TeamContext, session: SessionRecord, text: string): Promise<void> {
  const { store, registry } = context;
  if (isOpen(session)) {
    try {
      await registry.tell(session.id, { text });
      return;
    } catch (error) {
      // It was being stopped for being idle: it is resumed instead.
      if (!(error instanceof SessionNotRunningError)) throw error;
    }
  }
  const departmentId = store.getTask(session.taskId)?.departmentId;
  await claimDepartment(context, departmentId, session.taskId, () =>
    registry.resume(session.id, { text }),
  );
}

// A worker's lead hears that the user spoke to the worker, if the lead is at work. One that is not
// is left alone: resuming it would spend a turn on a note, and it sees the worker's result anyway.
async function noteLead(
  context: TeamContext,
  agent: AgentRecord,
  taskId: string,
  text: string,
): Promise<void> {
  const leadId = context.store.getTask(taskId)?.leadAgentId;
  if (leadId === undefined || leadId === agent.id) return;
  const lead = latestSession(context, taskId, leadId);
  if (lead === undefined || !isOpen(lead)) return;
  try {
    await context.registry.tell(lead.id, {
      text: `The user told ${agent.name} directly: "${text}"`,
      origin: { kind: "notice", summary: `The user messaged ${agent.name}` },
    });
  } catch (error) {
    if (!(error instanceof SessionNotRunningError)) throw error;
  }
}

// The user's own words to any agent, in the given goal or else its latest conversation (D-49).
export async function messageAgent(
  context: TeamContext,
  agentId: string,
  text: string,
  taskId?: string,
): Promise<void> {
  const agent = context.store.getAgent(agentId);
  if (agent === undefined) throw new RecordNotFoundError("agent", agentId);
  const [latest] =
    taskId === undefined
      ? context.store.listAgentSessions(agentId, { limit: 1 }).sessions
      : [latestSession(context, taskId, agentId)];
  if (latest === undefined) throw new NeverStartedError(agent.name);
  await deliver(context, latest, text);
  await noteLead(context, agent, latest.taskId, text);
}
