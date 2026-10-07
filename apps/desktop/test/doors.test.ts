import type { DepartmentRecord, PlanPiece, TaskRecord } from "@office-town/contract";
import { describe, expect, it } from "vitest";
import { departmentDoor } from "../src/features/office/doors.ts";

const department = (id: string, name: string) => ({ id, name }) as DepartmentRecord;
const task = (fields: Partial<TaskRecord>) =>
  ({
    id: "t",
    prompt: "",
    usage: [],
    createdAt: "2026-10-07T09:00:00.000Z",
    ...fields,
  }) as TaskRecord;
const piece = (fields: Partial<PlanPiece>) => ({ waitsOn: [], ...fields }) as PlanPiece;

describe("door chips", () => {
  it("shows at most two, most pressing first", () => {
    const web = department("web", "Web team");
    const qa = department("qa", "QA");
    const departments = { web, qa };
    const tasks = [
      task({ departmentId: "qa", state: "ended" }),
      task({ departmentId: "web", state: "working", createdAt: "2026-10-07T10:00:00.000Z" }),
    ];
    const pieces = [
      piece({ id: "w", departmentId: "web", status: "working" }),
      piece({ id: "q", departmentId: "qa", status: "waiting", waitsOn: ["w"] }),
    ];
    const door = (one: DepartmentRecord, needsYou: number) =>
      departmentDoor({ department: one, tasks, pieces, departments, needsYou });

    expect(door(web, 1)).toEqual([{ kind: "needs-you", count: 1 }, { kind: "working" }]);
    expect(door(qa, 0)).toEqual([{ kind: "review" }, { kind: "waits-on", department: "Web team" }]);
    expect(door(qa, 2)).toEqual([{ kind: "needs-you", count: 2 }, { kind: "review" }]);
  });
});
