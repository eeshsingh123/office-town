import type { PlanPiece, SessionRecord, TaskRecord } from "@office-town/contract";
import type { TaskEntry } from "../../store/records.ts";

export type ColumnId = "needs-you" | "working" | "waiting" | "review" | "done";

// Why a card waits, or how it ended; the board puts it in words.
export type CardNote =
  | { kind: "waits-on"; pieces: PlanPiece[] }
  | { kind: "cut-off" }
  | { kind: "queued" }
  | { kind: "reported" }
  | { kind: "reviewed"; at: string };

export type BoardCard =
  | { kind: "task"; task: TaskRecord; note?: CardNote }
  | { kind: "piece"; piece: PlanPiece; note: CardNote };

export type Columns = Record<ColumnId, BoardCard[]>;

const DONE_SHOWN = 20;
const OPEN = new Set<PlanPiece["status"]>(["waiting", "queued", "working"]);

interface BoardInput {
  tasks: Record<string, TaskEntry>;
  sessions: Record<string, SessionRecord>;
  pieces: Record<string, PlanPiece>;
}

// What an idle goal waits on: a restart cut its agents off, or a chief's pieces still run.
function idleNote(entry: TaskEntry, input: BoardInput): CardNote | undefined {
  const last = input.sessions[entry.sessionIds.at(-1) ?? ""];
  if (last?.status === "interrupted") return { kind: "cut-off" };
  const open = Object.values(input.pieces).filter(
    (piece) => piece.taskId === entry.task.id && OPEN.has(piece.status),
  );
  if (open.length === 0) return undefined;
  const working = open.filter((piece) => piece.status === "working");
  return { kind: "waits-on", pieces: working.length > 0 ? working : open };
}

// A piece not started yet waits on the pieces before it that are not done, or on its department.
function pieceNote(piece: PlanPiece, pieces: Record<string, PlanPiece>): CardNote {
  if (piece.status === "queued") return { kind: "queued" };
  const before = piece.waitsOn.flatMap((id) => {
    const upstream = pieces[id];
    return upstream === undefined || upstream.status === "done" ? [] : [upstream];
  });
  return { kind: "waits-on", pieces: before };
}

function columnOf(task: TaskRecord): ColumnId {
  switch (task.state) {
    case "waiting":
      return "needs-you";
    case "working":
      return "working";
    case "queued":
    case "idle":
      return "waiting";
    case "ended":
      return task.reviewedAt === undefined && task.parentTaskId === undefined ? "review" : "done";
  }
}

function taskNote(entry: TaskEntry, column: ColumnId, input: BoardInput): CardNote | undefined {
  const { task } = entry;
  if (task.state === "queued") return { kind: "queued" };
  if (task.state === "idle") return idleNote(entry, input);
  if (column !== "done") return undefined;
  if (task.parentTaskId !== undefined) return { kind: "reported" };
  return task.reviewedAt === undefined ? undefined : { kind: "reviewed", at: task.reviewedAt };
}

// The goals the app holds and the pieces with no task yet, in the board's columns (D-49). A chief's
// piece reports to the chief, so only the chief's whole goal waits for review.
export function boardColumns(input: BoardInput): Columns {
  const columns: Columns = { "needs-you": [], working: [], waiting: [], review: [], done: [] };
  const entries = Object.values(input.tasks).sort((a, b) =>
    b.task.createdAt.localeCompare(a.task.createdAt),
  );
  for (const entry of entries) {
    const { task } = entry;
    const column = columnOf(task);
    const note = taskNote(entry, column, input);
    columns[column].push(
      note === undefined ? { kind: "task", task } : { kind: "task", task, note },
    );
  }
  for (const piece of Object.values(input.pieces)) {
    if (piece.pieceTaskId !== undefined) continue;
    if (piece.status !== "waiting" && piece.status !== "queued") continue;
    columns.waiting.push({ kind: "piece", piece, note: pieceNote(piece, input.pieces) });
  }
  columns.done = columns.done.slice(0, DONE_SHOWN);
  return columns;
}
