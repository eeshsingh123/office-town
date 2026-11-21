import { notificationsSchema } from "@office-town/contract";
import type { Store } from "../store/store.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import type { Route } from "./routes.ts";

// What keeps work going while the user is away (M11).
export interface Unattended {
  stoppedLeads: StoppedLeads;
}

export function unattendedRoutes(store: Store): Route[] {
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
  ];
}
