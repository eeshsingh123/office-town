import {
  type LibraryAudience,
  libraryItemChangeSchema,
  newLibraryItemRequestSchema,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";

const NO_CONTENT = { status: 204 } as const;

// Only departments of that workspace, and agents, can be given an item.
function requireAudience(store: Store, workspaceId: string, givenTo: LibraryAudience): void {
  for (const id of givenTo.departmentIds) {
    if (store.getDepartment(id)?.workspaceId !== workspaceId) {
      throw new RequestError(400, "invalid_request", `No department "${id}" in this workspace.`);
    }
  }
  for (const id of givenTo.agentIds) {
    if (store.getAgent(id) === undefined) throw new RecordNotFoundError("agent", id);
  }
}

// The user's own changes; an agent's go through Needs you (D-64).
export function libraryRoutes(store: Store): Route[] {
  return [
    {
      method: "GET",
      path: "/library",
      reply: () => ({ status: 200, json: store.listLibrary() }),
    },
    {
      method: "POST",
      path: "/workspaces/:id/library",
      reply: async ({ param, body }) => {
        const { attachmentId, givenTo } = newLibraryItemRequestSchema.parse(await body());
        requireAudience(store, param("id"), givenTo);
        const item = store.addLibraryItem({ workspaceId: param("id"), attachmentId, givenTo });
        return { status: 201, json: item };
      },
    },
    {
      method: "PUT",
      path: "/library/:id",
      reply: async ({ param, body }) => {
        const change = libraryItemChangeSchema.parse(await body());
        const item = store.getLibraryItem(param("id"));
        if (item === undefined) throw new RecordNotFoundError("library item", param("id"));
        if (change.givenTo !== undefined) requireAudience(store, item.workspaceId, change.givenTo);
        return { status: 200, json: await store.changeLibraryItem(item.id, change) };
      },
    },
    {
      method: "DELETE",
      path: "/library/:id",
      reply: async ({ param }) => {
        await store.removeLibraryItem(param("id"));
        return NO_CONTENT;
      },
    },
  ];
}
