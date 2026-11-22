import {
  type AutomationFields,
  type AutomationPreview,
  type AutomationPreviewRequest,
  type AutomationRecord,
  type AutomationTask,
  automationPreviewRequestSchema,
  CHAIN_DEPTH,
  type Trigger,
} from "@office-town/contract";
import type { Store } from "../store/store.ts";
import { nextRuns } from "./clock.ts";

// "chief", "assistant" or the department's id.
export const whoOf = (task: AutomationTask) =>
  task.kind === "department" ? task.request.team.departmentId : task.kind;

// How many automations run in a row up to and including this one, through `after` links; a loop
// reads as past the limit.
function chainLength(byId: Map<string, Trigger>, id: string, after: string): number {
  const seen = new Set([id]);
  let length = 1;
  let current: string | undefined = after;
  while (current !== undefined) {
    if (seen.has(current)) return Number.POSITIVE_INFINITY;
    seen.add(current);
    length += 1;
    const trigger = byId.get(current);
    current = trigger?.kind === "after" ? trigger.automationId : undefined;
  }
  return length;
}

// The longest chain that runs through this automation, earlier ones and later ones together.
function longestThrough(byId: Map<string, Trigger>, id: string): number {
  const later = (from: string, seen: Set<string>): number => {
    let best = 0;
    for (const [other, trigger] of byId) {
      if (trigger.kind !== "after" || trigger.automationId !== from || seen.has(other)) continue;
      best = Math.max(best, 1 + later(other, new Set([...seen, other])));
    }
    return best;
  };
  const trigger = byId.get(id);
  const before = trigger?.kind === "after" ? chainLength(byId, id, trigger.automationId) : 1;
  return before + later(id, new Set([id]));
}

// What Save refuses, in one sentence; undefined when it can be saved.
export function problemWith(
  store: Store,
  id: string | undefined,
  trigger: Trigger,
  now = new Date(),
): string | undefined {
  if (trigger.kind === "schedule") {
    if (
      trigger.ends.kind === "on" &&
      trigger.starts !== undefined &&
      trigger.ends.date < trigger.starts
    ) {
      return "It ends before it starts.";
    }
    if (nextRuns(trigger, now, 1).length === 0) {
      return trigger.schedule.repeat === "once" ? "That time has passed." : "It would never run.";
    }
    return undefined;
  }
  const earlier = store.automations.get(trigger.automationId);
  if (earlier === undefined) return "The automation it follows was deleted.";
  const key = id ?? "new";
  const byId = new Map(store.automations.list().map((each) => [each.id, each.trigger]));
  byId.set(key, trigger);
  const length = longestThrough(byId, key);
  if (!Number.isFinite(length)) return `It would loop: ${earlier.name} already runs after it.`;
  if (length > CHAIN_DEPTH) {
    return `That makes ${length} automations in a row; the most is ${CHAIN_DEPTH}.`;
  }
  return undefined;
}

// Same who and the same schedule: both are allowed, but likely a mistake.
export function warningFor(
  store: Store,
  id: string | undefined,
  task: AutomationTask | undefined,
  trigger: Trigger,
): string | undefined {
  if (task === undefined || trigger.kind !== "schedule") return undefined;
  const same = store.automations
    .list()
    .find(
      (other: AutomationRecord) =>
        other.id !== id &&
        other.trigger.kind === "schedule" &&
        whoOf(other.task) === whoOf(task) &&
        JSON.stringify(other.trigger.schedule) === JSON.stringify(trigger.schedule),
    );
  return same === undefined ? undefined : `Same team and schedule as ${same.name}.`;
}

export function preview(store: Store, request: AutomationPreviewRequest): AutomationPreview {
  const { id, task, trigger } = automationPreviewRequestSchema.parse(request);
  const runs = id === undefined ? 0 : (store.automations.get(id)?.latestRun?.number ?? 0);
  const problem = problemWith(store, id, trigger);
  const warning = warningFor(store, id, task, trigger);
  return {
    nextRuns:
      trigger.kind === "schedule"
        ? nextRuns(trigger, new Date(), 3, runs).map((at) => at.toISOString())
        : [],
    ...(problem === undefined ? {} : { problem }),
    ...(warning === undefined ? {} : { warning }),
  };
}

// The files every run sends; an upload joins the workspace's Library so each run reads the same
// one (D-125).
export function keepFiles(store: Store, fields: AutomationFields): string[] {
  const { task } = fields;
  const ids = task.request.attachments ?? [];
  const workspaceId =
    task.kind === "assistant"
      ? task.request.workspaceId
      : task.kind === "department"
        ? (task.request.team.workspaceId ??
          store.getDepartment(task.request.team.departmentId)?.workspaceId)
        : undefined;
  if (workspaceId !== undefined) {
    for (const id of ids) {
      if (store.libraryItemOf(id) !== undefined || store.getAttachment(id) === undefined) continue;
      store.addLibraryItem({
        workspaceId,
        attachmentId: id,
        givenTo: { everyone: true, departmentIds: [], agentIds: [] },
      });
    }
  }
  return ids;
}
