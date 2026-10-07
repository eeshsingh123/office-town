import type { SessionRecord } from "@office-town/contract";
import { isChiefTask } from "../chief/chief.ts";
import { type Message, SessionNotRunningError } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import type { Caller } from "../tools/tools.ts";
import type { TeamContext } from "./members.ts";

export const isOpen = (session: SessionRecord) =>
  session.status === "starting" || session.status === "running";

// The chief leads its task too, but has no team.
export function leadsTeam(store: Store, caller: Caller): boolean {
  return (
    store.getTask(caller.taskId)?.leadAgentId === caller.agentId &&
    !isChiefTask(store, caller.taskId)
  );
}

export function latestSession(
  { store }: TeamContext,
  taskId: string,
  agentId: string,
): SessionRecord | undefined {
  return store.listSessions(taskId).findLast((session) => session.agentId === agentId);
}

// A lead the user stopped, that failed or was cut off is left alone; what it missed waits in the records.
export async function tellLead(
  context: TeamContext,
  taskId: string,
  message: Message,
): Promise<boolean> {
  const task = context.store.getTask(taskId);
  if (task?.leadAgentId === undefined) throw new RecordNotFoundError("task", taskId);
  // A second look, for a lead that was being stopped for being idle when the message came.
  for (let look = 0; look < 2; look += 1) {
    const session = latestSession(context, taskId, task.leadAgentId);
    if (session === undefined) return false;
    if (!isOpen(session)) {
      if (session.status !== "exited") return false;
      await context.registry.resume(session.id, message);
      return true;
    }
    try {
      await context.registry.tell(session.id, message);
      return true;
    } catch (error) {
      if (!(error instanceof SessionNotRunningError)) throw error;
    }
  }
  return false;
}
