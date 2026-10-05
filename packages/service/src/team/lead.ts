import type { SessionRecord } from "@office-town/contract";
import { type Message, SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import type { TeamContext } from "./members.ts";

export const isOpen = (session: SessionRecord) =>
  session.status === "starting" || session.status === "running";

// An agent's latest session in a task, if it has worked on it.
export function latestSession(
  { store }: TeamContext,
  taskId: string,
  agentId: string,
): SessionRecord | undefined {
  return store.listSessions(taskId).findLast((session) => session.agentId === agentId);
}

// Hands a message to the task's lead: at once if it is at work, or by resuming it if it finished
// or was stopped for being idle. One the user stopped, or that failed, is left alone; what it
// missed waits in the delegation records.
export async function tellLead(
  context: TeamContext,
  taskId: string,
  message: Message,
): Promise<void> {
  const task = context.store.getTask(taskId);
  if (task?.leadAgentId === undefined) throw new RecordNotFoundError("task", taskId);
  // A second look, for a lead that was being stopped for being idle when the message came.
  for (let look = 0; look < 2; look += 1) {
    const session = latestSession(context, taskId, task.leadAgentId);
    if (session === undefined) return;
    if (!isOpen(session)) {
      if (session.status === "exited") await context.registry.resume(session.id, message);
      return;
    }
    try {
      await context.registry.tell(session.id, message);
      return;
    } catch (error) {
      if (!(error instanceof SessionNotRunningError)) throw error;
    }
  }
}
