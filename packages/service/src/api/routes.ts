import {
  agentCommandSchema,
  environmentSpecSchema,
  resumeSessionRequestSchema,
  startTaskRequestSchema,
  taskListQuerySchema,
  workspaceRequestSchema,
} from "@office-town/contract";
import { describeHarness, listHarnesses } from "@office-town/harness";
import { z } from "zod";
import type { SessionRegistry } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { chooseTaskFolders, requireFolders } from "../task-folders.ts";

export interface RouteRequest {
  // A path parameter; the router only calls a route when all of them are present.
  param(name: string): string;
  query: URLSearchParams;
  body(): Promise<unknown>;
}

export type Reply =
  | { status: 200 | 201; json: unknown }
  | { status: 200; text: string }
  | { status: 204 };

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  // Segments starting with ":" are parameters.
  path: string;
  reply(request: RouteRequest): Reply | Promise<Reply>;
}

const NO_CONTENT = { status: 204 } as const;

const sequenceSchema = z.coerce.number().int().positive();

export function apiRoutes(registry: SessionRegistry, store: Store): Route[] {
  return [
    {
      method: "POST",
      path: "/tasks",
      reply: async ({ body }) => {
        const request = startTaskRequestSchema.parse(await body());
        const options = { ...request.options, ...chooseTaskFolders(store, request) };
        return { status: 201, json: await registry.start(request.prompt, options) };
      },
    },
    {
      method: "GET",
      path: "/tasks",
      reply: ({ query }) => {
        const { limit, cursor, active } = taskListQuerySchema.parse(Object.fromEntries(query));
        if (active) return { status: 200, json: { tasks: store.listActiveTasks() } };
        return {
          status: 200,
          json: store.listTasks(cursor === undefined ? { limit } : { limit, cursor }),
        };
      },
    },
    {
      method: "GET",
      path: "/tasks/:id",
      reply: ({ param }) => {
        const id = param("id");
        const task = store.getTask(id);
        if (task === undefined) throw new RecordNotFoundError("task", id);
        return { status: 200, json: { task, sessions: store.listSessions(id) } };
      },
    },
    {
      method: "DELETE",
      path: "/tasks/:id",
      reply: async ({ param }) => {
        await store.deleteTask(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/sessions/:id",
      reply: ({ param }) => {
        const session = store.getSession(param("id"));
        if (session === undefined) throw new RecordNotFoundError("session", param("id"));
        return { status: 200, json: session };
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/resume",
      reply: async ({ param, body }) => {
        const { prompt } = resumeSessionRequestSchema.parse(await body());
        return { status: 201, json: await registry.resume(param("id"), prompt) };
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/commands",
      reply: async ({ param, body }) => {
        await registry.send(param("id"), agentCommandSchema.parse(await body()));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/sessions/:id/stop",
      reply: async ({ param }) => {
        await registry.stop(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/sessions/:id/results/:sequence",
      reply: ({ param }) => ({
        status: 200,
        text: store.readOverflow(param("id"), sequenceSchema.parse(param("sequence"))),
      }),
    },
    {
      method: "GET",
      path: "/pending-requests",
      reply: () => ({ status: 200, json: store.listPendingRequests() }),
    },
    {
      method: "POST",
      path: "/workspaces",
      reply: async ({ body }) => {
        const workspace = workspaceRequestSchema.parse(await body());
        requireFolders(workspace.folders);
        return { status: 201, json: store.createWorkspace(workspace) };
      },
    },
    {
      method: "GET",
      path: "/workspaces",
      reply: () => ({ status: 200, json: store.listWorkspaces() }),
    },
    {
      method: "PUT",
      path: "/workspaces/:id",
      reply: async ({ param, body }) => {
        const workspace = workspaceRequestSchema.parse(await body());
        requireFolders(workspace.folders);
        return { status: 200, json: store.updateWorkspace(param("id"), workspace) };
      },
    },
    {
      method: "DELETE",
      path: "/workspaces/:id",
      reply: ({ param }) => {
        store.deleteWorkspace(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "GET",
      path: "/settings",
      reply: () => ({ status: 200, json: store.readSettings() }),
    },
    {
      method: "GET",
      path: "/harnesses",
      reply: () => ({ status: 200, json: listHarnesses() }),
    },
    {
      method: "GET",
      path: "/harnesses/:harness/catalog",
      reply: async ({ param, query }) => {
        const environment = environmentSpecSchema.parse({
          kind: query.get("environment") ?? "native",
          distro: query.get("distro") ?? undefined,
        });
        return { status: 200, json: await describeHarness(param("harness"), environment) };
      },
    },
    {
      method: "GET",
      path: "/storage",
      reply: async () => ({ status: 200, json: await store.size() }),
    },
  ];
}
