import type {
  AgentCommand,
  ApprovedPiece,
  ProposedPiece,
  SessionEvent,
  TaskRecord,
} from "@office-town/contract";
import type { Store } from "../store/store.ts";
import type { StoppedLeads } from "../team/lead-stopped.ts";
import { CORE_ASKS, type TeamContext } from "../team/members.ts";
import { AUTO_ANSWER } from "../tools/ask-user.ts";

// The core's own approvals that only decide how the work goes: stopping or moving a worker, a new
// session at a handover. Anything else asked for permission follows the level (D-126).
const DECISION_ASKS = Object.values(CORE_ASKS);

// What Auto answers; every other event passes without a read.
const DECIDES = new Set<SessionEvent["type"]>([
  "question.requested",
  "proposal.requested",
  "plan.requested",
  "permission.requested",
  "retry.requested",
]);

// An automation's run or check on Auto, or a part of a chief's goal that is one.
export function onAuto(store: Store, task: TaskRecord | undefined): boolean {
  if (task === undefined) return false;
  if (task.origin?.kind === "automation" || task.origin?.kind === "check") {
    return task.origin.auto === true;
  }
  const parent = task.parentTaskId === undefined ? undefined : store.getTask(task.parentTaskId);
  return parent?.origin?.kind === "automation" && parent.origin.auto === true;
}

// A new department in an Auto plan works in Scratch, at the Settings level, as the plan card
// would start it.
function placed(store: Store, pieces: readonly ProposedPiece[]): ApprovedPiece[] {
  const workspaces = store.listWorkspaces();
  const home = workspaces.find((workspace) => workspace.kind === "scratch") ?? workspaces[0];
  const autonomy = store.readSettings().autonomyByDefault ?? "full";
  return pieces.map((piece) => {
    if (!("newDepartment" in piece.department) || home === undefined) {
      return piece as ApprovedPiece;
    }
    return {
      ...piece,
      department: {
        newDepartment: { ...piece.department.newDepartment, workspaceId: home.id, autonomy },
      },
    };
  });
}

function answerOf(store: Store, event: SessionEvent): AgentCommand | undefined {
  switch (event.type) {
    case "question.requested":
      return {
        type: "answerQuestion",
        requestId: event.payload.requestId,
        answers: event.payload.questions.map((question) => ({
          questionId: question.questionId,
          selected: [AUTO_ANSWER],
        })),
      };
    case "proposal.requested":
      return {
        type: "answerProposal",
        requestId: event.payload.requestId,
        answer: { outcome: "approved", team: event.payload.team },
      };
    case "plan.requested":
      return {
        type: "answerPlan",
        requestId: event.payload.requestId,
        answer: { outcome: "approved", pieces: placed(store, event.payload.pieces) },
      };
    case "permission.requested": {
      const { requestId } = event.payload;
      if (!DECISION_ASKS.some((prefix) => requestId.startsWith(prefix))) return undefined;
      return { type: "answerPermission", requestId, optionId: "approve" };
    }
    default:
      return undefined;
  }
}

// An automation on Auto runs end to end: the core answers each decision in the user's place, and
// the trace reads "Decided by Auto" (D-126).
export function decideOnAuto(context: TeamContext, stoppedLeads: StoppedLeads): void {
  const { store, registry } = context;
  registry.subscribe(({ event }) => {
    if (!DECIDES.has(event.type)) return;
    const session = store.getSession(event.sessionId);
    if (session === undefined || !onAuto(store, store.getTask(session.taskId))) return;
    // After the ask is recorded and its tool has returned.
    setImmediate(() => {
      if (event.type === "retry.requested") {
        stoppedLeads
          .answer(event.sessionId, event.payload.requestId, "stop")
          .catch((error: unknown) => console.error("Auto could not stop a stopped lead.", error));
        return;
      }
      const answer = answerOf(store, event);
      if (answer === undefined) return;
      registry.send(event.sessionId, answer, "automation").catch((error: unknown) => {
        console.error(`Auto could not answer ${event.type}.`, error);
      });
    });
  });
}
