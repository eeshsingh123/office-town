import type { DepartmentRecord, PlanPiece, TaskRecord } from "@office-town/contract";

export type DoorChip =
  | { kind: "needs-you"; count: number }
  | { kind: "working" }
  | { kind: "review" }
  | { kind: "queued" }
  | { kind: "waits-on"; department: string }
  | { kind: "idle" };

const MAX_CHIPS = 2;

interface DepartmentDoor {
  department: DepartmentRecord;
  tasks: readonly TaskRecord[];
  pieces: readonly PlanPiece[];
  departments: Readonly<Record<string, DepartmentRecord>>;
  // Its agents' requests no one has answered yet.
  needsYou: number;
}

const newestFirst = (a: TaskRecord, b: TaskRecord) => b.createdAt.localeCompare(a.createdAt);

// Most pressing first, and at most two.
export function departmentDoor(door: DepartmentDoor): DoorChip[] {
  const { department, tasks, pieces, departments, needsYou } = door;
  const goals = tasks.filter((task) => task.departmentId === department.id).sort(newestFirst);
  const ownGoal = goals.find((task) => task.parentTaskId === undefined);
  const own = pieces.filter(
    (one) => one.departmentId === department.id && one.status !== "dropped",
  );
  const byId = new Map(pieces.map((one) => [one.id, one]));
  const upstream = own
    .filter((one) => one.status === "waiting")
    .flatMap((one) => one.waitsOn.flatMap((id) => byId.get(id) ?? []))
    .find((one) => one.status !== "done" && one.status !== "dropped");
  const chips: (DoorChip | false)[] = [
    needsYou > 0 && { kind: "needs-you", count: needsYou },
    goals[0]?.state === "working" && { kind: "working" },
    ownGoal?.state === "ended" && ownGoal.reviewedAt === undefined && { kind: "review" },
    own.some((one) => one.status === "queued") && { kind: "queued" },
    upstream !== undefined && {
      kind: "waits-on",
      department:
        (upstream.departmentId === undefined
          ? undefined
          : departments[upstream.departmentId]?.name) ??
        upstream.newDepartment?.name ??
        upstream.title,
    },
  ];
  return chips.filter((chip) => chip !== false).slice(0, MAX_CHIPS);
}

export function chiefDoor(goal: TaskRecord | undefined, needsYou: number): DoorChip[] {
  const chips: DoorChip[] = [];
  if (needsYou > 0) chips.push({ kind: "needs-you", count: needsYou });
  if (goal?.state === "working") chips.push({ kind: "working" });
  return chips.length === 0 ? [{ kind: "idle" }] : chips;
}

// The one not ended, before any queued behind it.
export function chiefGoal(tasks: readonly TaskRecord[], chiefId: string): TaskRecord | undefined {
  return tasks
    .filter((task) => task.leadAgentId === chiefId && task.state !== "ended")
    .sort(
      (a, b) =>
        Number(a.state === "queued") - Number(b.state === "queued") ||
        a.createdAt.localeCompare(b.createdAt),
    )[0];
}
