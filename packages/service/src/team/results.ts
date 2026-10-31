import type { DelegationRecord, SessionEvent } from "@office-town/contract";
import type { SessionActivity } from "../registry/activity.ts";
import type { Message } from "../registry/session-registry.ts";
import type { DelegationEnd } from "../store/store.ts";
import { isOpen, tellLead } from "./lead.ts";
import type { TeamContext } from "./members.ts";

type Outcome = Exclude<DelegationEnd, "interrupted">;

function resultText(name: string, outcome: Outcome, result: string): string {
  if (outcome === "done") return `${name} finished:\n${result}`;
  if (outcome === "stopped") return `${name} was stopped before it finished.`;
  return `${name} could not finish its work, even after one automatic retry.${result === "" ? "" : `\n${result}`}`;
}

function failureOf(error: string | undefined, lastWords: string): string {
  const reason = error === undefined ? "" : `The error: ${error}`;
  const words = lastWords === "" ? "" : `Its last words:\n${lastWords}`;
  return [reason, words].filter((part) => part !== "").join("\n");
}

export function tryAgain(error: string | undefined): Message {
  const reason = error === undefined ? "Your last turn failed." : `Your last turn failed: ${error}`;
  return {
    text: `${reason}\nCarry on from where you left off.`,
    origin: { kind: "notice", summary: "Tried again after a failed turn" },
  };
}

// A worker's last message when its turn ends with nothing waiting on the user; failures too.
// A failure is tried once more first, which costs the lead nothing if it was a passing one.
export function reportResults(context: TeamContext, activity: SessionActivity): void {
  const { store, registry } = context;
  const retried = new Set<string>();

  const finish = (delegation: DelegationRecord, outcome: Outcome, result: string) => {
    const worker = store.getAgent(delegation.workerAgentId);
    const name = worker?.name ?? "A worker";
    // Told before the delegation ends, so the lead owes a turn and its goal never reads finished in between.
    const told = tellLead(context, delegation.taskId, {
      text: resultText(name, outcome, result),
      origin: {
        kind: "result",
        delegationId: delegation.id,
        agentId: delegation.workerAgentId,
        outcome,
      },
    });
    store.endDelegation(delegation.id, outcome, result);
    told.catch((error: unknown) => {
      console.error(`Could not give the lead the result of ${name}.`, error);
    });
  };

  // A worker whose process ended goes on in a new session, so its piece moves there too.
  const retry = async (delegation: DelegationRecord, sessionId: string, message: Message) => {
    const session = store.getSession(sessionId);
    if (session !== undefined && isOpen(session)) {
      await registry.tell(sessionId, message);
      return;
    }
    const resumed = await registry.resume(sessionId, message);
    const { taskId, workerAgentId, brief } = delegation;
    const moved = store.createDelegation({
      taskId,
      workerAgentId,
      workerSessionId: resumed.id,
      brief,
    });
    retried.add(moved.id);
    store.endDelegation(delegation.id, "failed", "Tried again in a new session.");
  };

  const fail = (delegation: DelegationRecord, sessionId: string) => {
    const seen = activity.of(sessionId);
    const failure = failureOf(seen?.lastError, seen?.lastMessage ?? "");
    if (retried.has(delegation.id)) {
      finish(delegation, "failed", failure);
      return;
    }
    retried.add(delegation.id);
    retry(delegation, sessionId, tryAgain(seen?.lastError)).catch(() => {
      finish(delegation, "failed", failure);
    });
  };

  const onEvent = (event: SessionEvent) => {
    if (event.type !== "turn.ended" && event.type !== "session.ended") return;
    const delegation = store.workingDelegation(event.sessionId);
    if (delegation === undefined) return;
    const result = activity.of(event.sessionId)?.lastMessage ?? "";
    if (event.type === "session.ended") {
      if (event.payload.reason === "stopped") finish(delegation, "stopped", result);
      else fail(delegation, event.sessionId);
      return;
    }
    // A worker that asked the user goes on once answered; its result comes at a later turn.
    const waiting = store
      .listPendingRequests()
      .requests.some(({ event: request }) => request.sessionId === event.sessionId);
    if (waiting) return;
    const { outcome } = event.payload;
    if (outcome === "failed") {
      fail(delegation, event.sessionId);
      return;
    }
    finish(delegation, outcome === "completed" ? "done" : "stopped", result);
  };

  registry.subscribe(({ event }) => onEvent(event));
}

// A lead has no one above it, so its failed turn is tried once more. Listens before the task's
// state does, so the goal never reads finished in between.
export function recoverLeads(context: TeamContext, activity: SessionActivity): void {
  const { store, registry } = context;
  const retried = new Set<string>();

  const onEvent = (event: SessionEvent) => {
    const failedTurn = event.type === "turn.ended" && event.payload.outcome === "failed";
    const failedSession = event.type === "session.ended" && event.payload.reason === "failed";
    const done = event.type === "turn.ended" && event.payload.outcome === "completed";
    if (!failedTurn && !failedSession && !done) return;
    const session = store.getSession(event.sessionId);
    const taskId = session?.taskId;
    if (taskId === undefined || store.getTask(taskId)?.leadAgentId !== session?.agentId) return;
    if (done) {
      retried.delete(taskId);
      return;
    }
    // An idle stop after a failed turn already had its retry.
    if (event.type === "session.ended" && event.payload.idle === true) return;
    if (retried.has(taskId)) return;
    retried.add(taskId);
    tellLead(context, taskId, tryAgain(activity.of(event.sessionId)?.lastError)).catch(
      (error: unknown) => {
        console.error("Could not try the lead again.", error);
      },
    );
  };

  registry.subscribe(({ event }) => onEvent(event));
}
