import { randomUUID } from "node:crypto";
import type { ApprovedPiece, PlanPiece, ProposedPiece } from "@office-town/contract";
import { z } from "zod";
import { AnswerError, type CoreRequestHandler } from "../registry/session-registry.ts";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import type { TeamContext } from "../team/members.ts";
import { checkedSettings } from "../team/propose-team.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { isChiefCaller } from "./chief.ts";
import { orderByWaits } from "./plan-graph.ts";
import type { Scheduler } from "./scheduler.ts";

const pieceSchema = z.object({
  key: z.string().min(1).describe("A short name for the piece, unique in the plan, such as api."),
  title: z.string().min(1).describe("What the piece is, in a few words."),
  department: z
    .string()
    .min(1)
    .describe("The department that does it, by name; or the name of a new department."),
  brief: z
    .string()
    .min(1)
    .describe("What the department is to do and hand back. It knows nothing else of the goal."),
  waits_on: z
    .array(z.string().min(1))
    .optional()
    .describe("The keys of the pieces whose results this one needs before it starts."),
  new_department: z
    .object({
      purpose: z.string().min(1).describe("What the new department does, in a few words."),
      harness: z.string().min(1).describe('Its lead\'s harness, such as "claude" or "opencode".'),
      model: z.string().min(1).optional().describe("A model of that harness."),
      effort: z.string().min(1).optional().describe("An effort value of that model."),
    })
    .optional()
    .describe("Only for a department that does not exist yet: its lead's harness and model."),
});

const inputSchema = z.object({
  pieces: z.array(pieceSchema).min(1).describe("The whole plan, or the whole changed plan."),
  reason: z.string().optional().describe("Why this plan, in a sentence or two, for the user."),
});

type PlannedPiece = ProposedPiece | ApprovedPiece;

// Pieces that stay when a changed plan is approved; a new piece may wait on those still good.
const STAYS = new Set<PlanPiece["status"]>(["done", "working", "failed", "stopped"]);
const BUILDS_ON = new Set<PlanPiece["status"]>(["done", "working"]);

// What is wrong with a plan, checked the same for the chief's proposal and the user's edits;
// undefined if nothing.
function problemWith(store: Store, pieces: PlannedPiece[], kept: PlanPiece[]): string | undefined {
  const keys = pieces.map((piece) => piece.key);
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) return `Two pieces are called "${twice}"; give each a key of its own.`;
  const known = new Set([
    ...keys,
    ...kept.filter((piece) => BUILDS_ON.has(piece.status)).map((piece) => piece.key),
  ]);
  for (const piece of pieces) {
    const unknown = piece.waitsOn.find((key) => !known.has(key));
    if (unknown !== undefined) {
      return `"${piece.key}" waits on "${unknown}", which is not a piece it can build on. Those are: ${[...known].join(", ")}.`;
    }
    const { department } = piece;
    if (
      "departmentId" in department &&
      store.getDepartment(department.departmentId) === undefined
    ) {
      return `"${piece.key}" names a department that does not exist.`;
    }
    if (
      "newDepartment" in department &&
      "workspaceId" in department.newDepartment &&
      store.getWorkspace(department.newDepartment.workspaceId) === undefined
    ) {
      return `Choose a workspace for ${department.newDepartment.name}.`;
    }
  }
  const newNames = pieces.flatMap(({ department }) =>
    "newDepartment" in department ? [department.newDepartment.name] : [],
  );
  const shared = newNames.find((name, index) => newNames.indexOf(name) !== index);
  if (shared !== undefined) {
    return `The new department ${shared} has two pieces. Give it one; it can take more in a changed plan once it exists.`;
  }
  const departments = store.listDepartments();
  const taken = newNames.find((name) => departments.some((known) => known.name === name));
  if (taken !== undefined) return `A department called ${taken} exists already.`;
  if (orderByWaits(pieces) === undefined) return "The pieces wait on each other in a circle.";
  return undefined;
}

// The chief names departments; the request carries their ids, and a new one's checked settings.
async function resolvePieces(
  context: TeamContext,
  caller: Caller,
  pieces: z.infer<typeof pieceSchema>[],
): Promise<ProposedPiece[]> {
  const { store } = context;
  const environment = store.getSession(caller.sessionId)?.options.environment;
  if (environment === undefined) throw new RecordNotFoundError("session", caller.sessionId);
  const departments = store.listDepartments();
  const resolved: ProposedPiece[] = [];
  for (const piece of pieces) {
    const known = departments.find((department) => department.name === piece.department);
    const shared = { key: piece.key, title: piece.title, brief: piece.brief };
    const waitsOn = piece.waits_on ?? [];
    if (piece.new_department !== undefined) {
      const { purpose, ...lead } = piece.new_department;
      const settings = await checkedSettings(context, lead, environment);
      const newDepartment = { name: piece.department, purpose, lead: settings };
      resolved.push({ ...shared, waitsOn, department: { newDepartment } });
      continue;
    }
    if (known === undefined) {
      const names = departments.map((department) => department.name).join(", ") || "none yet";
      throw new ToolError(
        `"${piece.department}" is not a department. The departments: ${names}. To propose a new one, add new_department.`,
      );
    }
    resolved.push({ ...shared, waitsOn, department: { departmentId: known.id } });
  }
  return resolved;
}

// The approved pieces join the plan; pieces that had not started give way to them. A new piece
// names those it waits on by key: the newest piece with that key, a new one first.
function savePlan(store: Store, taskId: string, approved: ApprovedPiece[]): void {
  const existing = store.listPieces(taskId);
  for (const piece of existing) {
    if (piece.status === "waiting" || piece.status === "queued") {
      store.updatePiece(piece.id, { status: "dropped" });
    }
  }
  const ids = new Map(
    existing.filter((piece) => BUILDS_ON.has(piece.status)).map((piece) => [piece.key, piece.id]),
  );
  for (const piece of orderByWaits(approved) ?? []) {
    const { key, title, brief, department } = piece;
    const created = store.createPiece({
      taskId,
      key,
      title,
      brief,
      waitsOn: piece.waitsOn.flatMap((upstream) => ids.get(upstream) ?? []),
      ...("departmentId" in department
        ? { departmentId: department.departmentId }
        : { newDepartment: department.newDepartment }),
    });
    ids.set(key, created.id);
  }
}

function answerPlan(
  context: TeamContext,
  scheduler: Scheduler,
  caller: Caller,
  requestId: string,
): CoreRequestHandler {
  const { store, registry } = context;
  const tell = (text: string, summary: string) => () =>
    registry.tell(caller.sessionId, { text, origin: { kind: "notice", summary } });
  return (command) => {
    if (command.type !== "answerPlan") throw new AnswerError("This is a plan.");
    const { answer } = command;
    if (answer.outcome === "approved") {
      const kept = store.listPieces(caller.taskId).filter((piece) => STAYS.has(piece.status));
      const problem = problemWith(store, answer.pieces, kept);
      if (problem !== undefined) throw new AnswerError(problem);
      savePlan(store, caller.taskId, answer.pieces);
      const count = answer.pieces.length;
      return {
        resolution: {
          type: "plan.resolved",
          payload: { requestId, outcome: "approved", pieces: answer.pieces },
        },
        afterwards: async () => {
          void scheduler.advance();
          await tell(
            `The user approved your plan, with ${count} pieces. Each starts once the pieces it waits on are done and its department is free; each result reaches you as a message.`,
            `You approved the plan: ${count} pieces`,
          )();
        },
      };
    }
    const resolution = {
      type: "plan.resolved",
      payload: {
        requestId,
        outcome: answer.outcome,
        ...(answer.note ? { note: answer.note } : {}),
      },
    } as const;
    if (answer.outcome === "revised") {
      return {
        resolution,
        afterwards: tell(
          `The user sent your plan back with this note: "${answer.note}". Propose again with propose_plan.`,
          "Your plan went back with a note",
        ),
      };
    }
    return {
      resolution,
      afterwards: tell(
        `The user declined the plan${answer.note ? `: "${answer.note}"` : ""}. Any plan already approved stays as it was.`,
        "You declined the plan",
      ),
    };
  };
}

// The chief's first step on a goal, and how it changes the plan later; the user approves,
// edits or sends back every plan in Needs you (D-49).
export function proposePlan(context: TeamContext, scheduler: Scheduler) {
  const { store, registry } = context;
  return defineTool({
    name: "propose_plan",
    description:
      "Propose your plan to the user: the pieces of the goal, each for one department, and " +
      "which pieces wait on which. To change the plan, propose the pieces still to do; pieces " +
      "done or at work stay. It returns at once; the user's answer reaches you later as a message.",
    input: inputSchema,
    offeredTo: (caller) => isChiefCaller(store, caller),
    async call({ pieces, reason }, caller) {
      const waiting = store
        .listPendingRequests()
        .requests.some(
          ({ event }) => event.sessionId === caller.sessionId && event.type === "plan.requested",
        );
      if (waiting) throw new ToolError("Your last plan is still with the user.");
      const proposed = await resolvePieces(context, caller, pieces);
      const existing = store.listPieces(caller.taskId);
      const kept = existing.filter((piece) => STAYS.has(piece.status));
      const problem = problemWith(store, proposed, kept);
      if (problem !== undefined) throw new ToolError(problem);
      const requestId = `plan-${randomUUID()}`;
      registry.ask(
        caller.sessionId,
        {
          type: "plan.requested",
          payload: {
            requestId,
            pieces: proposed,
            replan: existing.length > 0,
            ...(reason === undefined ? {} : { reason }),
          },
        },
        answerPlan(context, scheduler, caller, requestId),
      );
      return "Your plan is with the user. Their answer will reach you as a message.";
    },
  });
}
