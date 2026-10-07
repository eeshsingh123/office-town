import type {
  PlanPiece,
  SessionRecord,
  StartTeamTaskRequest,
  TaskRecord,
} from "@office-town/contract";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { latestSession, tellLead } from "../team/lead.ts";
import { DepartmentBusyError, type TeamContext } from "../team/members.ts";
import { startTeamTask } from "../team/team-tasks.ts";
import { handOff } from "./briefs.ts";
import { isChiefTask } from "./chief.ts";
import { startQueuedGoal } from "./goals.ts";
import { departmentNameOf, readOnlyFolders } from "./piece-folders.ts";

type Ending = "done" | "failed" | "stopped";

const OPEN = new Set<PlanPiece["status"]>(["waiting", "queued", "working"]);

const REPLAN =
  "Pieces that wait on it are held. Propose a changed plan with propose_plan, or finish.";

function resultText(store: Store, piece: PlanPiece, ending: Ending, result: string): string {
  const name = departmentNameOf(store, piece);
  if (ending === "done") return `${name} finished "${piece.title}":\n${result}`;
  if (ending === "stopped") {
    return `${name} was stopped before it finished "${piece.title}".\n\n${REPLAN}`;
  }
  const words = result === "" ? "" : ` Its last words:\n${result}`;
  return `${name} could not finish "${piece.title}".${words}\n\n${REPLAN}`;
}

// A saved department, or the new one the chief proposed, whose lead first proposes its team.
function teamOf(piece: PlanPiece): StartTeamTaskRequest["team"] {
  if (piece.departmentId !== undefined) return { departmentId: piece.departmentId };
  if (piece.newDepartment === undefined) throw new RecordNotFoundError("department", piece.id);
  const { lead, workspaceId, autonomy } = piece.newDepartment;
  return { lead: { settings: lead }, workspaceId, autonomy };
}

// How the lead's latest session in the piece's task ended.
function endingOf(store: Store, lead: SessionRecord | undefined): Ending {
  if (lead === undefined || lead.status === "failed") return "failed";
  if (lead.status === "stopped") return "stopped";
  const outcome = store.latestTurn(lead.id)?.outcome;
  if (outcome === "failed") return "failed";
  return outcome === "interrupted" ? "stopped" : "done";
}

// The lead's last words in the task, from its latest session that said anything.
function lastWords(store: Store, task: TaskRecord): string {
  const sessions = store
    .listSessions(task.id)
    .filter((session) => session.agentId === task.leadAgentId)
    .reverse();
  for (const session of sessions) {
    const text = store.lastMessage(session.id);
    if (text !== undefined) return text;
  }
  return "";
}

// Starts what can start: the chief's next queued goal, and each piece of a plan whose pieces
// before it are done and whose department is free. Runs once at a time, so two triggers never
// start the same piece twice. A piece that ends hands its result to the chief.
export class Scheduler {
  readonly #context: TeamContext;
  #running: Promise<void> = Promise.resolve();

  constructor(context: TeamContext) {
    this.#context = context;
    context.store.subscribe((change) => {
      if (change.type === "task") this.#taskChanged(change.task);
      if (change.type === "task.deleted") void this.advance();
    });
  }

  advance(): Promise<void> {
    this.#running = this.#running
      .then(() => this.#advance())
      .catch((error: unknown) => console.error("Could not start the next work.", error));
    return this.#running;
  }

  #taskChanged(task: TaskRecord): void {
    const { store } = this.#context;
    const piece = task.parentTaskId === undefined ? undefined : store.pieceOfTask(task.id);
    // A new department's team was approved, so its piece now names it.
    if (
      piece !== undefined &&
      piece.departmentId === undefined &&
      task.departmentId !== undefined
    ) {
      store.updatePiece(piece.id, { departmentId: task.departmentId });
    }
    if (task.state !== "ended") return;
    if (piece?.status === "working") this.#finish(piece, task);
    if (isChiefTask(store, task.id)) this.#dropUnstarted(task.id);
    void this.advance();
  }

  // A goal that ended leaves the pieces it never started.
  #dropUnstarted(taskId: string): void {
    const { store } = this.#context;
    for (const piece of store.listPieces(taskId)) {
      if (piece.status === "waiting" || piece.status === "queued") {
        store.updatePiece(piece.id, { status: "dropped" });
      }
    }
  }

  #finish(piece: PlanPiece, task: TaskRecord): void {
    const { store } = this.#context;
    const lead =
      task.leadAgentId === undefined
        ? undefined
        : latestSession(this.#context, task.id, task.leadAgentId);
    this.#end(piece, endingOf(store, lead), lastWords(store, task));
  }

  // The chief hears each piece's end; once none is left open, that it is time to sum up.
  #end(piece: PlanPiece, ending: Ending, result: string): void {
    const { store } = this.#context;
    store.updatePiece(piece.id, { status: ending, result });
    const last =
      ending === "done" && !store.listPieces(piece.taskId).some((each) => OPEN.has(each.status));
    const summary = last
      ? "\n\nNo piece of the plan is left open. Give the user a short account of the whole goal."
      : "";
    tellLead(this.#context, piece.taskId, {
      text: `${resultText(store, piece, ending, result)}${summary}`,
      origin: { kind: "piece", pieceId: piece.id, outcome: ending },
    }).catch((error: unknown) => {
      console.error(`Could not give the chief the result of "${piece.title}".`, error);
    });
  }

  async #advance(): Promise<void> {
    const { store } = this.#context;
    await startQueuedGoal(this.#context);
    for (const { id } of store.listOpenPieces()) {
      const piece = store.getPiece(id);
      if (piece === undefined) continue;
      // Its task was deleted before it ended.
      if (piece.status === "working" && piece.pieceTaskId === undefined) {
        this.#end(piece, "stopped", "");
        continue;
      }
      if (piece.status !== "waiting" && piece.status !== "queued") continue;
      const goal = store.getTask(piece.taskId);
      if (goal === undefined || goal.state === "ended") continue;
      const pieces = store.listPieces(piece.taskId);
      const ready = piece.waitsOn.every(
        (upstream) => pieces.find((each) => each.id === upstream)?.status === "done",
      );
      if (!ready) continue;
      if (
        piece.departmentId !== undefined &&
        store.activeTaskOf(piece.departmentId) !== undefined
      ) {
        if (piece.status !== "queued") store.updatePiece(piece.id, { status: "queued" });
        continue;
      }
      await this.#start(piece, pieces, goal);
    }
  }

  async #start(piece: PlanPiece, pieces: PlanPiece[], goal: TaskRecord): Promise<void> {
    const { store } = this.#context;
    const chief = goal.leadAgentId === undefined ? undefined : store.getAgent(goal.leadAgentId);
    if (chief === undefined) throw new RecordNotFoundError("agent", goal.leadAgentId ?? "");
    const readOnlyPaths = readOnlyFolders(store, piece, pieces);
    const upstream = pieces.filter((each) => piece.waitsOn.includes(each.id));
    const text = handOff({
      chief: chief.name,
      chiefGoal: goal.prompt,
      title: piece.title,
      newDepartment: piece.newDepartment,
      upstream: upstream.map((each) => ({
        department: departmentNameOf(store, each),
        title: each.title,
        result: each.result ?? "",
      })),
      readOnly: readOnlyPaths,
    });
    store.updatePiece(piece.id, { status: "working" });
    try {
      await startTeamTask(
        this.#context,
        { goal: piece.brief, team: teamOf(piece) },
        {
          parentTaskId: goal.id,
          handOff: text,
          readOnlyPaths,
          onTaskCreated: (taskId) => store.updatePiece(piece.id, { pieceTaskId: taskId }),
        },
      );
    } catch (error) {
      // Someone gave the department a goal of its own meanwhile.
      if (error instanceof DepartmentBusyError) {
        store.updatePiece(piece.id, { status: "queued" });
        return;
      }
      const reason = error instanceof Error ? error.message : String(error);
      const current = store.getPiece(piece.id);
      if (current?.status === "working") {
        this.#end(current, "failed", `It could not start: ${reason}`);
      }
    }
  }
}
