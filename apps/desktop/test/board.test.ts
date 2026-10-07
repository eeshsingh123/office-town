import type { PlanPiece, SessionRecord, TaskRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { boardColumns } from "../src/features/board/board.ts";
import type { TaskEntry } from "../src/store/records.ts";

let minute = 0;
function entry(id: string, fields: Partial<TaskRecord>, sessionIds: string[] = []): TaskEntry {
  minute += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 7, 10, minute)).toISOString();
  return { task: { id, prompt: id, createdAt, state: "ended", usage: [], ...fields }, sessionIds };
}

const piece = (id: string, fields: Partial<PlanPiece>): PlanPiece => ({
  id,
  taskId: "launch",
  key: id,
  title: id,
  brief: id,
  waitsOn: [],
  status: "waiting",
  createdAt: "2026-10-07T10:00:00.000Z",
  ...fields,
});

describe("board", () => {
  it("puts goals and unstarted pieces in their columns, and only whole goals in To review", () => {
    const tasks = {
      asking: entry("asking", { state: "waiting" }),
      launch: entry("launch", { state: "idle", leadAgentId: "chief" }),
      cut: entry("cut", { state: "idle", leadAgentId: "kai" }, ["s1"]),
      later: entry("later", { state: "queued", leadAgentId: "chief" }),
      research: entry("research", { parentTaskId: "launch" }),
      summary: entry("summary", {}),
      fixed: entry("fixed", { reviewedAt: "2026-10-07T11:00:00.000Z" }),
      build: entry("build", { state: "working", parentTaskId: "launch" }),
    };
    const sessions = { s1: { id: "s1", status: "interrupted" } as SessionRecord };
    const pieces = {
      compare: piece("compare", { status: "done", pieceTaskId: "research" }),
      build: piece("build", { status: "working", pieceTaskId: "build", waitsOn: ["compare"] }),
      test: piece("test", { waitsOn: ["build"] }),
    };

    const columns = boardColumns({ tasks, sessions, pieces });
    const ids = (column: keyof typeof columns) =>
      columns[column].map((card) => (card.kind === "task" ? card.task.id : card.piece.id));

    expect(ids("needs-you")).toEqual(["asking"]);
    expect(ids("working")).toEqual(["build"]);
    expect(ids("waiting")).toEqual(["later", "cut", "launch", "test"]);
    expect(ids("review")).toEqual(["summary"]);
    expect(ids("done")).toEqual(["fixed", "research"]);
    expect(columns.waiting.map((card) => card.note?.kind)).toEqual([
      "queued",
      "cut-off",
      "waits-on",
      "waits-on",
    ]);
    expect(columns.done[1]?.note).toEqual({ kind: "reported" });
  });
});
