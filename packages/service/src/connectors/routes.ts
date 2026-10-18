import {
  type Audience,
  type ConnectorCatalog,
  connectorActivityQuerySchema,
  connectorChangeSchema,
  connectorTestRequestSchema,
  newConnectorRequestSchema,
} from "@office-town/contract";
import type { Route } from "../api/routes.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { catalog } from "./catalog.ts";
import type { ConnectorHub } from "./hub.ts";

const NO_CONTENT = { status: 204 } as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function requireAudience(store: Store, audience: Audience): void {
  for (const id of audience.departmentIds) {
    if (store.getDepartment(id) === undefined) throw new RecordNotFoundError("department", id);
  }
  for (const id of audience.agentIds) {
    if (store.getAgent(id) === undefined) throw new RecordNotFoundError("agent", id);
  }
}

export function connectorRoutes(store: Store, hub: ConnectorHub): Route[] {
  return [
    {
      method: "GET",
      path: "/connectors",
      reply: () => ({ status: 200, json: store.listConnectors() }),
    },
    {
      method: "GET",
      path: "/connectors/catalog",
      reply: () => {
        const json: ConnectorCatalog = { entries: catalog, keys: hub.secretsKind };
        return { status: 200, json };
      },
    },
    {
      method: "POST",
      path: "/connectors",
      reply: async ({ body }) => {
        const request = newConnectorRequestSchema.parse(await body());
        requireAudience(store, request.audience);
        return { status: 201, json: await hub.create(request) };
      },
    },
    {
      method: "POST",
      path: "/connectors/test",
      reply: async ({ body }) => {
        const tools = await hub.test(connectorTestRequestSchema.parse(await body()));
        return { status: 200, json: { tools } };
      },
    },
    {
      method: "PUT",
      path: "/connectors/:id",
      reply: async ({ param, body }) => {
        const change = connectorChangeSchema.parse(await body());
        if (change.audience !== undefined) requireAudience(store, change.audience);
        return { status: 200, json: await hub.change(param("id"), change) };
      },
    },
    {
      method: "DELETE",
      path: "/connectors/:id",
      reply: async ({ param }) => {
        await hub.remove(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/connectors/:id/sign-in",
      reply: async ({ param }) => {
        return { status: 200, json: { url: await hub.claudeApps.signInPage(param("id")) } };
      },
    },
    // Reads the Claude apps again, such as one just connected on claude.ai.
    {
      method: "POST",
      path: "/connectors/refresh",
      reply: async () => {
        await hub.claudeApps.refresh();
        return { status: 200, json: store.listConnectors() };
      },
    },
    {
      method: "GET",
      path: "/connectors/:id/activity",
      reply: ({ param, query }) => {
        const filters = connectorActivityQuerySchema.parse(Object.fromEntries(query));
        const since = new Date(Date.now() - WEEK_MS);
        return { status: 200, json: store.connectorActivity(param("id"), filters, since) };
      },
    },
  ];
}
