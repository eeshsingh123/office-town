import type { DelegationRecord, SessionEvent } from "@office-town/contract";
import type { SessionActivity } from "../registry/activity.ts";
import type { DelegationEnd } from "../store/store.ts";
import { tellLead } from "./lead.ts";
import type { TeamContext } from "./members.ts";

type Outcome = Exclude<DelegationEnd, "interrupted">;

function resultText(name: string, outcome: Outcome, result: string): string {
  if (outcome === "done") return `${name} finished:\n${result}`;
  if (outcome === "stopped") return `${name} was stopped before it finished.`;
  return `${name} could not finish its work.${result === "" ? "" : ` Its last words:\n${result}`}`;
}

// When a worker's turn ends with nothing waiting on the user, its last message is its result,
// and the lead gets it as a message from the core. A worker that failed, was stopped or ended is
// reported the same way (MODULES M4.5).
export function reportResults(context: TeamContext, activity: SessionActivity): void {
  const { store, registry } = context;

  const finish = (delegation: DelegationRecord, outcome: Outcome, result: string) => {
    const worker = store.getAgent(delegation.workerAgentId);
    const name = worker?.name ?? "A worker";
    // Told before the delegation ends, so the lead owes a turn for it and its goal never reads
    // finished in between.
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

  const onEvent = (event: SessionEvent) => {
    if (event.type !== "turn.ended" && event.type !== "session.ended") return;
    const delegation = store.workingDelegation(event.sessionId);
    if (delegation === undefined) return;
    const result = activity.of(event.sessionId)?.lastMessage ?? "";
    if (event.type === "session.ended") {
      finish(delegation, event.payload.reason === "stopped" ? "stopped" : "failed", result);
      return;
    }
    // A worker that asked the user goes on once answered; its result comes at a later turn.
    const waiting = store
      .listPendingRequests()
      .requests.some(({ event: request }) => request.sessionId === event.sessionId);
    if (waiting) return;
    const { outcome } = event.payload;
    finish(
      delegation,
      outcome === "completed" ? "done" : outcome === "interrupted" ? "stopped" : "failed",
      result,
    );
  };

  registry.subscribe(({ event }) => onEvent(event));
}
