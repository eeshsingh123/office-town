import type { DelegationRecord, SessionEvent } from "@office-town/contract";
import { acceptIfMet, resultLine } from "../goal/record.ts";
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

function waitingText(name: string, titles: readonly string[]): string {
  const running =
    titles.length === 1
      ? "1 sub-agent is still running"
      : `${titles.length} sub-agents are still running`;
  const them = titles.length === 1 ? "it finishes" : "they finish";
  return `${name}'s turn ended; ${running} (${titles.join("; ")}). ${name}'s full result comes when ${them}. Nothing to do yet; do not hand this piece out again.`;
}

const takeInResults = (lead: string): Message => ({
  text: `Your sub-agents have finished. Take in what they found, finish your piece, then reply with your full result for ${lead}.`,
  origin: { kind: "notice", summary: "Your sub-agents finished" },
});

export function tryAgain(error: string | undefined): Message {
  const reason = error === undefined ? "Your last turn failed." : `Your last turn failed: ${error}`;
  return {
    text: `${reason}\nCarry on from where you left off.`,
    origin: { kind: "notice", summary: "Tried again after a failed turn" },
  };
}

// A worker's last message once its turn has ended with nothing waiting on the user and none of its
// sub-agents still at work; failures too. A failure is tried once more first, which costs the lead
// nothing if it was a passing one.
export function reportResults(
  context: TeamContext,
  activity: SessionActivity,
  handingOver: (sessionId: string) => boolean = () => false,
): void {
  const { store, registry } = context;
  const retried = new Set<string>();
  // Pieces whose worker ended a turn with sub-agents at work: the lead has heard, the result waits.
  const waiting = new Map<string, "sub-agents" | "follow-up">();

  const finish = (delegation: DelegationRecord, outcome: Outcome, result: string) => {
    waiting.delete(delegation.id);
    const worker = store.getAgent(delegation.workerAgentId);
    const name = worker?.name ?? "A worker";
    const part = outcome === "done" ? acceptIfMet(store, delegation) : delegation;
    const line = resultLine(store, part, name);
    // Told before the delegation ends, so the lead owes a turn and its goal never reads finished in between.
    const told = tellLead(context, delegation.taskId, {
      text: `${resultText(name, outcome, result)}${line === undefined ? "" : `\n\n${line}`}`,
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
    // A retry is not a send-back: the part goes on as it was (D-77).
    store.carryPart(delegation.id, moved.id);
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

  // A brief told to a busy worker. Taken mid-turn, it ends with that turn. One that missed the
  // turn starts its own, after the piece ended, and the lead is owed that result too.
  const updates = new Map<string, string>();

  const followUpdates = (event: SessionEvent) => {
    const { sessionId } = event;
    if (event.type === "message" && event.payload.role === "user") {
      const told = event.payload.origin?.kind === "brief";
      if (told && store.workingDelegation(sessionId) !== undefined) {
        updates.set(sessionId, event.payload.text);
      } else {
        updates.delete(sessionId);
      }
    } else if (event.type === "session.ended") {
      updates.delete(sessionId);
    } else if (event.type === "turn.started") {
      const brief = updates.get(sessionId);
      const session = store.getSession(sessionId);
      updates.delete(sessionId);
      if (brief === undefined || session === undefined) return;
      if (store.workingDelegation(sessionId) !== undefined) return;
      const { taskId, agentId } = session;
      store.createDelegation({ taskId, workerAgentId: agentId, workerSessionId: sessionId, brief });
    }
  };

  // Told once, so the lead neither waits in silence nor hands the piece out again. It wakes the
  // lead, which keeps its cache warm (owner).
  const tellWaiting = (delegation: DelegationRecord, titles: readonly string[]) => {
    const told = waiting.has(delegation.id);
    waiting.set(delegation.id, "sub-agents");
    if (told) return;
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    tellLead(context, delegation.taskId, {
      text: waitingText(name, titles),
      origin: { kind: "interim", delegationId: delegation.id, agentId: delegation.workerAgentId },
    }).catch((error: unknown) => {
      console.error(`Could not tell the lead that ${name} waits on its sub-agents.`, error);
    });
  };

  // A CLI that starts no turn of its own when its sub-agents end is asked to take them in, and
  // the turn that answers ends the piece.
  const followUp = (delegation: DelegationRecord, sessionId: string) => {
    const seen = activity.of(sessionId);
    if (waiting.get(delegation.id) !== "sub-agents" || seen === undefined) return;
    if (seen.turnOpen || seen.subAgents.size > 0) return;
    waiting.set(delegation.id, "follow-up");
    if (seen.wakes) return;
    const task = store.getTask(delegation.taskId);
    const lead = task?.leadAgentId === undefined ? undefined : store.getAgent(task.leadAgentId);
    registry.tell(sessionId, takeInResults(lead?.name ?? "your lead")).catch((error: unknown) => {
      console.error("Could not tell a worker its sub-agents finished.", error);
    });
  };

  const onEvent = (event: SessionEvent) => {
    followUpdates(event);
    if (event.type === "action.ended") {
      const delegation = store.workingDelegation(event.sessionId);
      if (delegation !== undefined) followUp(delegation, event.sessionId);
      return;
    }
    if (event.type !== "turn.ended" && event.type !== "session.ended") return;
    if (handingOver(event.sessionId)) return;
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
    const subAgents = [...(activity.of(event.sessionId)?.subAgents.values() ?? [])];
    if (outcome === "completed" && subAgents.length > 0) {
      tellWaiting(delegation, subAgents);
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
