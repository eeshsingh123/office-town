import type {
  MilestoneRecord,
  MilestoneText,
  SessionEvent,
  StepRequest,
} from "@office-town/contract";
import { isChiefTask } from "../chief/chief.ts";
import type { Message } from "../registry/session-registry.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { deliver, noteLead } from "../team/direct-message.ts";
import { latestSession } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { TeamError } from "../team/members.ts";

const PAST: Record<Edit, string> = { added: "added", changed: "changed", removed: "removed" };

import { LEAD_CHECKS, leadMilestones, SOLO_MILESTONES } from "./briefs.ts";
import { goalMilestones, milestoneLines, milestonesOn, ownsGoal } from "./record.ts";

type Edit = "added" | "changed" | "removed";

// Who acts on a change: the worker while its part is at work, else whoever owns the goal.
function ownerOf(
  { store }: TeamContext,
  milestone: Pick<MilestoneRecord, "taskId" | "delegationId" | "pieceId">,
): { agentId: string; worker: boolean } | undefined {
  const task = store.getTask(milestone.taskId);
  if (task === undefined) return undefined;
  const part =
    milestone.delegationId === undefined
      ? undefined
      : store.listDelegations(task.id).find((one) => one.id === milestone.delegationId);
  if (part?.status === "working") return { agentId: part.workerAgentId, worker: true };
  // A chief's piece not started yet: its department's lead reads them in its brief.
  if (isChiefTask(store, task.id)) return undefined;
  const top = task.leadAgentId ?? store.listSessions(task.id)[0]?.agentId;
  return top === undefined ? undefined : { agentId: top, worker: false };
}

function editText(edit: Edit, milestone: MilestoneRecord, where: string): string {
  if (edit === "removed") {
    return `The user removed milestone ${milestone.key} from ${where}: "${milestone.outcome}". It no longer counts.`;
  }
  const verb = edit === "added" ? "added a milestone to" : `changed milestone ${milestone.key} of`;
  return `The user ${verb} ${where}. In their words:\n${milestoneLines([milestone])}\nWork it into what you do; report it with report_milestone like the others.`;
}

// Stored at once; the agent gets the exact words at its next tool end (D-77, D-83).
export class MilestoneEdits {
  readonly #context: TeamContext;
  // Sessions told a change that they have yet to take.
  readonly #told = new Set<string>();

  constructor(context: TeamContext) {
    this.#context = context;
    context.registry.subscribe(({ event }) => this.#follow(event));
  }

  async add(taskId: string, text: MilestoneText, delegationId?: string): Promise<MilestoneRecord> {
    const { store } = this.#context;
    if (store.getTask(taskId) === undefined) throw new RecordNotFoundError("task");
    const owner = ownerOf(this.#context, { taskId, delegationId });
    const milestone = store.createMilestone({
      taskId,
      ...text,
      origin: "user",
      delegationId,
      ...(owner === undefined ? {} : { delivery: { agentId: owner.agentId, state: "telling" } }),
    });
    await this.#tell(milestone, "added");
    return store.getMilestone(milestone.id) ?? milestone;
  }

  async change(id: string, text: MilestoneText): Promise<MilestoneRecord> {
    const { store } = this.#context;
    const before = store.getMilestone(id);
    if (before === undefined) throw new RecordNotFoundError("milestone");
    if (before.outcome === text.outcome && before.see === text.see) return before;
    const owner = ownerOf(this.#context, before);
    // What the user wants now is new, so an earlier check no longer holds.
    const milestone = store.updateMilestone(id, {
      ...text,
      status: "not_started",
      proof: undefined,
      reportedBy: undefined,
      changedBy: "user",
      delivery: owner === undefined ? undefined : { agentId: owner.agentId, state: "telling" },
    });
    await this.#tell(milestone, "changed");
    return store.getMilestone(id) ?? milestone;
  }

  async remove(id: string): Promise<void> {
    const { store } = this.#context;
    const milestone = store.getMilestone(id);
    if (milestone === undefined) throw new RecordNotFoundError("milestone");
    store.removeMilestone(id);
    await this.#tell(milestone, "removed");
  }

  // Steps are the agent's own list in its AI app, so the user can only ask (owner).
  async askStep(taskId: string, { agentId, change, step }: StepRequest): Promise<void> {
    const session = latestSession(this.#context, taskId, agentId);
    if (session === undefined) throw new TeamError("This agent has not worked on this task.");
    const text =
      change === "add"
        ? `The user asks you to add a step to your todo list: "${step}". Add it to your list and work it in.`
        : `The user asks you to drop the step "${step}" from your todo list. Take it off your list and skip it.`;
    await this.#send(session.taskId, agentId, {
      text,
      origin: {
        kind: "milestones",
        summary: change === "add" ? "The user asked for a step" : "The user asked to drop a step",
      },
    });
  }

  async #tell(milestone: MilestoneRecord, edit: Edit): Promise<void> {
    const { store } = this.#context;
    const owner = ownerOf(this.#context, milestone);
    if (owner === undefined) return;
    await this.#send(milestone.taskId, owner.agentId, {
      text: editText(edit, milestone, owner.worker ? "your part" : "the goal"),
      origin: { kind: "milestones", summary: `The user ${PAST[edit]} a milestone` },
    });
    const worker = owner.worker ? store.getAgent(owner.agentId) : undefined;
    if (worker === undefined) return;
    // The worker has the change already, so the lead only reads one line (owner).
    await noteLead(
      this.#context,
      worker,
      milestone.taskId,
      `The user ${PAST[edit]} milestone ${milestone.key} of ${worker.name}'s part: "${milestone.outcome}". ${worker.name} has it.`,
      `The user changed ${worker.name}'s part`,
    );
  }

  async #send(taskId: string, agentId: string, message: Message): Promise<void> {
    const session = latestSession(this.#context, taskId, agentId);
    if (session === undefined) return;
    await deliver(this.#context, session, message);
  }

  // An AI app reads its tools once, so one turned on mid-task reaches an agent at its next
  // start; a lead or solo agent that has none to keep yet is told then (owner).
  #onStart(sessionId: string): void {
    const { store, registry } = this.#context;
    const session = store.getSession(sessionId);
    if (session === undefined || !milestonesOn(store, session.taskId)) return;
    const caller = { sessionId, agentId: session.agentId, taskId: session.taskId };
    if (!ownsGoal(store, caller) || goalMilestones(store, session.taskId).length > 0) return;
    const earlier = store
      .listSessions(session.taskId)
      .some((one) => one.agentId === session.agentId && one.id !== sessionId);
    if (!earlier) return;
    const lead = store.getTask(session.taskId)?.leadAgentId === session.agentId;
    const text = lead ? `${leadMilestones([])}\n\n${LEAD_CHECKS}` : SOLO_MILESTONES;
    registry
      .tell(sessionId, { text, origin: { kind: "notice", summary: "Milestones are on now" } })
      .catch((error: unknown) => {
        console.error("Could not tell the agent that milestones are on.", error);
      });
  }

  // Taken once the agent's next turn starts with it (D-77).
  #follow(event: SessionEvent): void {
    const { store } = this.#context;
    if (event.type === "session.started") {
      this.#onStart(event.sessionId);
      return;
    }
    if (event.type === "message" && event.payload.origin?.kind === "milestones") {
      this.#told.add(event.sessionId);
      return;
    }
    if (event.type !== "turn.started" || !this.#told.has(event.sessionId)) return;
    this.#told.delete(event.sessionId);
    const session = store.getSession(event.sessionId);
    if (session === undefined) return;
    for (const milestone of store.listMilestones(session.taskId)) {
      const { delivery } = milestone;
      if (delivery?.state === "telling" && delivery.agentId === session.agentId) {
        store.updateMilestone(milestone.id, { delivery: { ...delivery, state: "taken" } });
      }
    }
  }
}
