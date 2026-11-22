import type { SessionRecord, StartTaskRequest, TaskOrigin } from "@office-town/contract";
import { createAgent } from "./agents/agents.ts";
import { instructionsFor, soloMessage } from "./agents/briefs.ts";
import { sessionOptionsFor } from "./agents/options.ts";
import { resolveAttachments } from "./attachments/attachments.ts";
import type { Store } from "./store/store.ts";
import { foldersForTask } from "./task-folders.ts";
import type { TeamContext } from "./team/members.ts";

// A task whose start failed would stay "working" and keep its department busy, so it goes.
export async function startFirstAgent(
  store: Store,
  taskId: string,
  start: () => Promise<SessionRecord>,
): Promise<SessionRecord> {
  try {
    return await start();
  } catch (error) {
    if (store.listSessions(taskId).length === 0) await store.deleteTask(taskId);
    throw error;
  }
}

// One assistant on a task of its own, as New task starts it or an automation's run.
export async function startSoloTask(
  { store, registry }: TeamContext,
  request: StartTaskRequest,
  origin?: TaskOrigin,
): Promise<SessionRecord> {
  const attachments = resolveAttachments(store, request.attachments);
  const folders = foldersForTask(store, request.workspaceId);
  const agent = createAgent(store, request.agent, { autonomy: request.autonomy });
  const task = store.createTask(request.prompt, undefined, {
    workspaceId: request.workspaceId,
    ...(request.efficient === undefined ? {} : { efficient: request.efficient }),
    ...(request.milestones === undefined ? {} : { milestones: request.milestones }),
    ...(origin === undefined ? {} : { origin }),
  });
  return startFirstAgent(store, task.id, () =>
    registry.start({
      taskId: task.id,
      agentId: agent.id,
      options: sessionOptionsFor(store, agent, folders),
      message: {
        ...soloMessage(
          request.prompt,
          instructionsFor(store, agent),
          folders.scratch,
          task.milestones === true,
        ),
        attachments,
      },
    }),
  );
}
