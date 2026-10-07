import { z } from "zod";
import { latestSession, tellLead } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { defineTool, ToolError } from "../tools/tools.ts";
import { isChiefCaller } from "./chief.ts";
import { departmentNameOf } from "./piece-folders.ts";

// Through the lead, never its workers (D-49).
export function messageLead(context: TeamContext) {
  const { store } = context;
  return defineTool({
    name: "message_lead",
    description:
      "Send a message to the lead of a department at work on a piece of your plan, such as to " +
      "steer its work. It returns at once; the lead's result still reaches you when it finishes.",
    input: z.object({
      department: z.string().min(1).describe("The department, by name."),
      message: z.string().min(1).describe("What to tell its lead."),
    }),
    offeredTo: (caller) => isChiefCaller(store, caller),
    async call({ department, message }, caller) {
      const working = store
        .listPieces(caller.taskId)
        .filter((piece) => piece.status === "working" && piece.pieceTaskId !== undefined);
      const piece = working.find((each) => departmentNameOf(store, each) === department);
      if (piece?.pieceTaskId === undefined) {
        const names = working.map((each) => departmentNameOf(store, each)).join(", ") || "none";
        throw new ToolError(`${department} has no piece at work. At work now: ${names}.`);
      }
      const chief = store.getAgent(caller.agentId);
      const told = await tellLead(context, piece.pieceTaskId, {
        text: `From the chief, ${chief?.name ?? "the chief"}:\n${message}`,
        origin: { kind: "message", from: caller.agentId },
      });
      if (!told) {
        const pieceTask = store.getTask(piece.pieceTaskId);
        const lead =
          pieceTask?.leadAgentId === undefined
            ? undefined
            : latestSession(context, piece.pieceTaskId, pieceTask.leadAgentId);
        throw new ToolError(
          `The lead of ${department} could not be reached: it is ${lead?.status ?? "not started"}.`,
        );
      }
      return `Your message is with the lead of ${department}.`;
    },
  });
}
