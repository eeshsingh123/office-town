import { QUIET_AFTER_MS } from "@office-town/contract";
import type { SessionActivity } from "../registry/activity.ts";
import { isOpen, latestSession } from "./lead.ts";
import type { TeamContext } from "./members.ts";

const SWEEP_EVERY_MS = 60_000;
// A sweep this late means the computer slept or the clock moved, so every quiet clock starts again.
const LATE_MS = 2 * 60_000;
const QUIET_MINUTES = QUIET_AFTER_MS / 60_000;

// A worker whose open turn has sent nothing for a while, with no sub-agent at work and nothing
// asked of the user. Its open lead hears once a turn; nothing stops it, as stopping another agent
// needs the user (D-71, D-120). A long tool that prints nothing reads the same, hence "no news".
export class QuietWorkers {
  readonly #context: TeamContext;
  readonly #activity: SessionActivity;
  // Worker sessions whose lead heard in this turn.
  readonly #told = new Set<string>();
  readonly #timer: NodeJS.Timeout;
  #lastSweep = Date.now();
  // When the clocks last started again, after a sleep.
  #since = Date.now();

  constructor(context: TeamContext, activity: SessionActivity) {
    this.#context = context;
    this.#activity = activity;
    context.registry.subscribe(({ event }) => {
      if (event.type === "turn.started" || event.type === "session.ended") {
        this.#told.delete(event.sessionId);
      }
    });
    this.#timer = setInterval(() => this.#sweep(), SWEEP_EVERY_MS);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  // Minutes without news, or undefined while the session is not quiet.
  quietMinutes(sessionId: string, waiting: ReadonlySet<string>): number | undefined {
    const seen = this.#activity.of(sessionId);
    if (seen === undefined || !seen.turnOpen || seen.subAgents.size > 0) return undefined;
    if (waiting.has(sessionId)) return undefined;
    const quiet = Date.now() - Math.max(seen.lastActive, this.#since);
    return quiet < QUIET_AFTER_MS ? undefined : Math.floor(quiet / 60_000);
  }

  #sweep(): void {
    const now = Date.now();
    const late = now - this.#lastSweep > SWEEP_EVERY_MS + LATE_MS;
    this.#lastSweep = now;
    if (late) {
      this.#since = now;
      return;
    }
    const { store } = this.#context;
    const waiting = new Set(
      store.listPendingRequests().requests.map(({ event }) => event.sessionId),
    );
    for (const [sessionId] of this.#activity.entries()) {
      if (this.#told.has(sessionId)) continue;
      if (this.quietMinutes(sessionId, waiting) === undefined) continue;
      const delegation = store.workingDelegation(sessionId);
      if (delegation === undefined) continue;
      this.#told.add(sessionId);
      this.#tellLead(delegation.taskId, delegation.workerAgentId);
    }
  }

  // Only a lead that is open: a stopped one is never started again just for this.
  #tellLead(taskId: string, workerId: string): void {
    const { store, registry } = this.#context;
    const leadId = store.getTask(taskId)?.leadAgentId;
    const lead = leadId === undefined ? undefined : latestSession(this.#context, taskId, leadId);
    if (lead === undefined || !isOpen(lead) || !registry.isRunning(lead.id)) return;
    const name = store.getAgent(workerId)?.name ?? "A worker";
    registry
      .tell(lead.id, {
        text: `${name} has sent no news for ${QUIET_MINUTES} minutes on its piece. It may be on a long step, or stuck. You can wait, message it, or ask the user to stop it with stop_work.`,
        origin: { kind: "notice", summary: `${name}: no news for ${QUIET_MINUTES} minutes` },
      })
      .catch((error: unknown) => {
        console.error(`Could not tell the lead that ${name} is quiet.`, error);
      });
  }
}
