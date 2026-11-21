import { notificationsSchema, resumeTasksRequestSchema } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import type { StoppedTasks } from "../team/stopped-tasks.ts";
import type { Route } from "./routes.ts";

// What keeps work going while the user is away (M11).
export interface Unattended {
  stoppedLeads: StoppedLeads;
  stoppedTasks: StoppedTasks;
}

export function unattendedRoutes(store: Store, { stoppedTasks }: Unattended): Route[] {
  return [
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
