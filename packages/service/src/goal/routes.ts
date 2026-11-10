import {
  milestoneEditRequestSchema,
  newMilestoneRequestSchema,
  stepRequestSchema,
} from "@office-town/contract";
import type { Route } from "../api/routes.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import type { MilestoneEdits } from "./edits.ts";

const NO_CONTENT = { status: 204 } as const;

// The user has the final say on every milestone; each change reaches the agent that owns it.
export function goalRoutes(store: Store, edits: MilestoneEdits): Route[] {
  return [
    {
      method: "GET",
      path: "/tasks/:id/milestones",
      // A chief's goal brings its pieces' along, which live in their departments' tasks.
      reply: ({ param }) => {
        const taskId = param("id");
        if (store.getTask(taskId) === undefined) throw new RecordNotFoundError("task");
        const pieces = store.listPieces(taskId).flatMap((piece) => piece.pieceTaskId ?? []);
        return {
          status: 200,
          json: [taskId, ...pieces].flatMap((id) => store.listMilestones(id)),
        };
      },
    },
    {
      method: "POST",
      path: "/tasks/:id/milestones",
      reply: async ({ param, body }) => {
        const { delegationId, ...text } = newMilestoneRequestSchema.parse(await body());
        return { status: 201, json: await edits.add(param("id"), text, delegationId) };
      },
    },
    {
      method: "PUT",
      path: "/milestones/:id",
      reply: async ({ param, body }) => {
        const text = milestoneEditRequestSchema.parse(await body());
        return { status: 200, json: await edits.change(param("id"), text) };
      },
    },
    {
      method: "DELETE",
      path: "/milestones/:id",
      reply: async ({ param }) => {
        await edits.remove(param("id"));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/tasks/:id/steps",
      reply: async ({ param, body }) => {
        await edits.askStep(param("id"), stepRequestSchema.parse(await body()));
        return NO_CONTENT;
      },
    },
    {
      method: "POST",
      path: "/delegations/:id/seen",
      reply: ({ param }) => ({
        status: 200,
        json: store.setDelegationAccepted(param("id"), "seen"),
      }),
    },
  ];
}
