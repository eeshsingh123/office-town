import type { DelegationRecord, SessionEvent, SessionRecord } from "@office-town/contract";
import { progressNudge } from "../feed/progress.ts";
import { acceptIfMet, resultLine } from "../goal/record.ts";
import type { SessionActivity } from "../registry/activity.ts";
import type { Message } from "../registry/session-registry.ts";
import type { DelegationEnd, Store } from "../store/store.ts";
import { isOpen, tellLead } from "./lead.ts";
import type { StoppedLeads } from "./lead-stopped.ts";
import type { TeamContext } from "./members.ts";

type Outcome = Exclude<DelegationEnd, "interrupted">;

export function resultText(name: string, outcome: Outcome, result: string): string {
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

// A worker owes its lead a result; anyone else carries on.
const takeInResults = (lead: string | undefined): Message => ({
  text:
    lead === undefined
      ? "Your sub-agents have finished. Take in what they found and carry on with your work."
      : `Your sub-agents have finished. Take in what they found, finish your piece, then reply with your full result for ${lead}.`,
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
// nothing if it was a passing one. The retry and the result owed are stored, so a restart neither
// repeats nor loses them (D-120).
export function reportResults(
  context: TeamContext,
  activity: SessionActivity,
  handingOver: (sessionId: string) => boolean = () => false,
): void {
  const { store, registry } = context;
  const { recovery } = store;
  // Pieces whose worker ended a turn with sub-agents at work: the lead has heard, the result waits.
  const waiting = new Set<string>();

  const finish = (delegation: DelegationRecord, outcome: Outcome, result: string) => {
    waiting.delete(delegation.id);
    const worker = store.getAgent(delegation.workerAgentId);
    const name = worker?.name ?? "A worker";
    const part = outcome === "done" ? acceptIfMet(store, delegation) : delegation;
    const line = resultLine(store, part, name);
    // Owed until the lead's session records it; a lead stopped or cut off hears it when it resumes.
    recovery.oweResult(delegation.id);
    // Told before the delegation ends, so the lead owes a turn and its goal never reads finished in between.
    const told = tellLead(context, delegation.taskId, {
      text: `${resultText(name, outcome, result)}${line === undefined ? "" : `\n\n${line}`}${outcome === "done" ? progressNudge(store, delegation.taskId) : ""}`,
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
  const retry = async (
    delegation: DelegationRecord,
    sessionId: string,
    message: Message,
    failure: string,
  ) => {
    const session = store.getSession(sessionId);
    if (session !== undefined && isOpen(session)) {
      await registry.tell(sessionId, message);
      return;
    }
    const resumed = await registry.resume(sessionId, message);
    // A Stop during the resume already ended the piece.
    if (store.workingDelegation(sessionId)?.id !== delegation.id) return;
    // A start that failed ended the new session before the piece could follow it.
    if (!isOpen(resumed)) {
      finish(delegation, "failed", failure);
      return;
    }
    const { taskId, workerAgentId, brief } = delegation;
    const moved = store.createDelegation({
      taskId,
      workerAgentId,
      workerSessionId: resumed.id,
      brief,
    });
    recovery.markDelegationRetried(moved.id);
    // A retry is not a send-back: the part goes on as it was (D-77).
    store.carryPart(delegation.id, moved.id);
    store.endDelegation(delegation.id, "failed", "Tried again in a new session.");
  };

  const fail = (delegation: DelegationRecord, sessionId: string) => {
    const seen = activity.of(sessionId);
    const failure = failureOf(seen?.lastError, seen?.lastMessage ?? "");
    if (recovery.delegationRetried(delegation.id)) {
      finish(delegation, "failed", failure);
      return;
    }
    recovery.markDelegationRetried(delegation.id);
    retry(delegation, sessionId, tryAgain(seen?.lastError), failure).catch(() => {
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
    if (waiting.has(delegation.id)) return;
    waiting.add(delegation.id);
    const name = store.getAgent(delegation.workerAgentId)?.name ?? "A worker";
    const count = titles.length === 1 ? "1 sub-agent" : `${titles.length} sub-agents`;
    tellLead(context, delegation.taskId, {
      text: waitingText(name, titles),
      origin: {
        kind: "interim",
        delegationId: delegation.id,
        agentId: delegation.workerAgentId,
        summary: `${name} is waiting on ${count}; its result follows`,
      },
    }).catch((error: unknown) => {
      console.error(`Could not tell the lead that ${name} waits on its sub-agents.`, error);
    });
  };

  const onEvent = (event: SessionEvent) => {
    followUpdates(event);
    if (event.type === "message" && event.payload.origin?.kind === "result") {
      recovery.resultDelivered(event.payload.origin.delegationId);
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

// A CLI that starts no turn of its own when its sub-agents end (D-99) is asked to take them in,
// once the last one ends after its turn: a worker's answering turn ends its piece, and a lead's or
// solo agent's reply is saved as a turn of its own. A turn the user interrupted stays stopped.
export function wakeAfterSubAgents(
  context: TeamContext,
  activity: SessionActivity,
  handingOver: (sessionId: string) => boolean = () => false,
): void {
  const { store, registry } = context;
  // Sessions whose last turn ended with sub-agents at work.
  const waiting = new Set<string>();

  registry.subscribe(({ event }) => {
    const { sessionId } = event;
    if (event.type === "session.ended") waiting.delete(sessionId);
    const seen = activity.of(sessionId);
    if (seen === undefined) return;
    if (event.type === "turn.ended") {
      if (event.payload.outcome === "completed" && seen.subAgents.size > 0) waiting.add(sessionId);
      else waiting.delete(sessionId);
      return;
    }
    if (event.type !== "action.ended" || !waiting.has(sessionId)) return;
    if (seen.turnOpen || seen.subAgents.size > 0) return;
    waiting.delete(sessionId);
    // A handover's new conversation starts from the record instead.
    if (seen.wakes || handingOver(sessionId)) return;
    const delegation = store.workingDelegation(sessionId);
    const task = delegation === undefined ? undefined : store.getTask(delegation.taskId);
    const lead = task?.leadAgentId === undefined ? undefined : store.getAgent(task.leadAgentId);
    const owed = delegation === undefined ? undefined : (lead?.name ?? "your lead");
    registry.tell(sessionId, takeInResults(owed)).catch((error: unknown) => {
      console.error("Could not tell an agent its sub-agents finished.", error);
    });
  });
}

// Whether this failure came from the lead's retry, not from the turn that was retried.
function afterRetry(store: Store, session: SessionRecord, retriedAt: number): boolean {
  const turnAt = store.latestTurn(session.id)?.at;
  return (
    Date.parse(session.createdAt) > retriedAt ||
    (turnAt !== undefined && Date.parse(turnAt) > retriedAt)
  );
}

// A lead has no one above it, so its failed turn is tried once more, and a second failure waits
// for the user (D-120). Listens before the task's state does, so the goal never reads finished in
// between.
export function recoverLeads(
  context: TeamContext,
  activity: SessionActivity,
  stoppedLeads: StoppedLeads,
): void {
  const { store, registry } = context;
  const { recovery } = store;

  const onEvent = (event: SessionEvent) => {
    const failedTurn = event.type === "turn.ended" && event.payload.outcome === "failed";
    const failedSession = event.type === "session.ended" && event.payload.reason === "failed";
    const done = event.type === "turn.ended" && event.payload.outcome === "completed";
    if (!failedTurn && !failedSession && !done) return;
    const session = store.getSession(event.sessionId);
    const taskId = session?.taskId;
    if (taskId === undefined || store.getTask(taskId)?.leadAgentId !== session?.agentId) return;
    if (done) {
      if (recovery.leadRetriedAt(taskId) !== undefined)
        recovery.setLeadRetriedAt(taskId, undefined);
      return;
    }
    // An idle stop after a failed turn already had its retry.
    if (event.type === "session.ended" && event.payload.idle === true) return;
    const error = activity.of(event.sessionId)?.lastError;
    const retriedAt = recovery.leadRetriedAt(taskId);
    if (retriedAt !== undefined) {
      if (session === undefined || !afterRetry(store, session, retriedAt)) return;
      stoppedLeads.raise(taskId, error).catch((failure: unknown) => {
        console.error("Could not ask the user about a stopped lead.", failure);
      });
      return;
    }
    recovery.setLeadRetriedAt(taskId, Date.now());
    // A retry that cannot start, such as when its folder is gone, waits for the user too.
    tellLead(context, taskId, tryAgain(error))
      .catch((failure: unknown) =>
        stoppedLeads.raise(taskId, failure instanceof Error ? failure.message : String(failure)),
      )
      .catch((failure: unknown) => {
        console.error("Could not ask the user about a stopped lead.", failure);
      });
  };

  registry.subscribe(({ event }) => onEvent(event));
}
