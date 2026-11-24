import {
  type KeepAwake,
  notificationsSchema,
  resumeTasksRequestSchema,
} from "@office-town/contract";
import type { Runner } from "../automations/runner.ts";
import type { Delivery } from "../notify/destination-routes.ts";
import type { Store } from "../store/store.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import type { StoppedTasks } from "../team/stopped-tasks.ts";
import type { Route } from "./routes.ts";

const RUN_SOON_MS = 10 * 60_000;

export interface Unattended {
  stoppedLeads: StoppedLeads;
  stoppedTasks: StoppedTasks;
  runner: Runner;
  delivery: Delivery;
}

// A task at work, or one waiting on the user while its workers still work (D-123).
function agentsAtWork(store: Store): boolean {
  return store
    .listActiveTasks()
    .some(
      (task) =>
        task.state === "working" ||
        task.sessions.some(
          (session) =>
            session.status === "starting" ||
            (session.status === "running" && store.latestTurn(session.id)?.ended !== true),
        ),
    );
}

export function unattendedRoutes(store: Store, { stoppedTasks }: Unattended): Route[] {
  return [
    {
      method: "GET",
      path: "/keep-awake",
      reply: () => {
        // A run due soon counts too, so a sleep never swallows it (D-123).
        const next = store.automations.earliestNextRun();
        const due = next !== undefined && next - Date.now() <= RUN_SOON_MS;
        const answer: KeepAwake = { awake: due || agentsAtWork(store) };
        return { status: 200, json: answer };
      },
    },
    {
      method: "PUT",
      path: "/notifications",
      // Only the kinds given change.
      reply: async ({ body }) => {
        const given = notificationsSchema.parse(await body());
        const notifications = { ...store.readSettings().notifications, ...given };
        store.saveSettings({ notifications });
        return { status: 200, json: notifications };
      },
    },
    {
      method: "GET",
      path: "/stopped-tasks",
      reply: () => ({ status: 200, json: { tasks: stoppedTasks.list() } }),
    },
    {
      method: "POST",
      path: "/stopped-tasks/resume",
      reply: async ({ body }) => {
        const { taskIds } = resumeTasksRequestSchema.parse(await body());
        return { status: 200, json: { tasks: stoppedTasks.resume(taskIds) } };
      },
    },
    {
      method: "POST",
      path: "/stopped-tasks/close",
      reply: () => {
        stoppedTasks.close();
        return { status: 204 };
      },
    },
  ];
}
