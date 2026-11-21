import { randomUUID } from "node:crypto";
import type { PendingRequest } from "@office-town/contract";
import { isChiefTask } from "../chief/chief.ts";
import { stopChiefGoal } from "../chief/goals.ts";
import { AnswerError } from "../registry/session-registry.ts";
import { isOpen, latestSession, tellLead } from "./lead.ts";
import type { TeamContext } from "./members.ts";
import { tryAgain } from "./results.ts";
import { stopTeam } from "./team-tasks.ts";

const ERROR_LINE = 200;

// The error in one plain line.
function oneLine(error: string | undefined): string | undefined {
  const line = error
    ?.split("\n")
    .find((part) => part.trim() !== "")
    ?.trim();
  if (line === undefined) return undefined;
  return line.length > ERROR_LINE ? `${line.slice(0, ERROR_LINE)}…` : line;
}

// A lead that failed again after its one retry waits for the user: Try again or Stop (D-120). The
// item sits on the lead's ended session, which a restart leaves as it is, and the lead's next turn
// closes it, however that turn started.
export class StoppedLeads {
  readonly #context: TeamContext;
  // Tasks whose item is being raised, so a failed turn and the session's end raise it once.
  readonly #raising = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => {
      if (event.type !== "turn.started") return;
      const session = context.store.getSession(event.sessionId);
      if (session === undefined) return;
      if (context.store.getTask(session.taskId)?.leadAgentId !== session.agentId) return;
      this.close(session.taskId);
    });
  }

  // A lead still open after its failed turn ends as an idle one would, so the item outlives a restart.
  async raise(taskId: string, error: string | undefined): Promise<void> {
    if (this.#raising.has(taskId) || this.#waiting(taskId).length > 0) return;
    this.#raising.add(taskId);
    try {
      const { store, registry } = this.#context;
      const leadId = store.getTask(taskId)?.leadAgentId;
      if (leadId === undefined) return;
      const lead = latestSession(this.#context, taskId, leadId);
      if (lead === undefined) return;
      if (registry.isRunning(lead.id)) await registry.stop(lead.id, true);
      // Taken up again meanwhile, such as by a worker's result.
      const latest = latestSession(this.#context, taskId, leadId);
      if (latest?.id !== lead.id || isOpen(latest)) return;
      const line = oneLine(error);
      registry.appendToEnded(lead.id, {
        type: "retry.requested",
        payload: {
          requestId: `retry-${randomUUID()}`,
          ...(line === undefined ? {} : { error: line }),
        },
      });
    } finally {
      this.#raising.delete(taskId);
    }
  }

  async answer(sessionId: string, requestId: string, answer: "retry" | "stop"): Promise<void> {
    const request = this.#context.store
      .listPendingRequests()
      .requests.find(
        ({ event }) =>
          event.sessionId === sessionId &&
          event.type === "retry.requested" &&
          event.payload.requestId === requestId,
      );
    if (request?.event.type !== "retry.requested") {
      throw new AnswerError(`No request "${requestId}" is waiting.`);
    }
    const { registry } = this.#context;
    registry.appendToEnded(sessionId, {
      type: "retry.resolved",
      payload: { requestId, outcome: answer === "retry" ? "retried" : "stopped" },
    });
    if (answer === "stop") {
      // As the task's own Stop does.
      if (isChiefTask(this.#context.store, request.taskId)) {
        await stopChiefGoal(this.#context, request.taskId);
      } else {
        await stopTeam(this.#context, request.taskId);
      }
      return;
    }
    try {
      const told = await tellLead(
        this.#context,
        request.taskId,
        tryAgain(request.event.payload.error),
      );
      if (!told) throw new AnswerError("This lead can't be started again.");
    } catch (failure) {
      // The user can try again once the cause is fixed.
      await this.raise(
        request.taskId,
        failure instanceof Error ? failure.message : String(failure),
      );
      throw failure;
    }
  }

  // Such as when the task is stopped.
  close(taskId: string): void {
    for (const { event } of this.#waiting(taskId)) {
      this.#context.registry.appendToEnded(event.sessionId, {
        type: "retry.resolved",
        payload: { requestId: event.payload.requestId, outcome: "cancelled" },
      });
    }
  }

  #waiting(taskId: string): PendingRequest[] {
    return this.#context.store
      .listPendingRequests()
      .requests.filter(
        (request) => request.taskId === taskId && request.event.type === "retry.requested",
      );
  }
}
