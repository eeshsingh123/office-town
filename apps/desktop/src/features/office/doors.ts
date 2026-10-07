import type { DepartmentRecord, PlanPiece, TaskRecord } from "@office-town/contract";

// A small chip after a room's name on its sign.
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
  // Every task the app holds.
  tasks: readonly TaskRecord[];
  // The pieces of the chief's current goal.
  pieces: readonly PlanPiece[];
  departments: Readonly<Record<string, DepartmentRecord>>;
  // Its agents' requests no one has answered yet.
  needsYou: number;
}

const newestFirst = (a: TaskRecord, b: TaskRecord) => b.createdAt.localeCompare(a.createdAt);

// What a department's door shows, most pressing first and at most two: its agents waiting for the
// user, its current goal at work, its latest own goal finished and not yet reviewed, its piece of
// the chief's plan queued, or waiting on an unfinished upstream department.
export function departmentDoor(door: DepartmentDoor): DoorChip[] {
  const { department, tasks, pieces, departments, needsYou } = door;
  const goals = tasks.filter((task) => task.departmentId === department.id).sort(newestFirst);
  const ownGoal = goals.find((task) => task.parentTaskId === undefined);
  const piece = pieces.find(
    (one) => one.departmentId === department.id && one.status !== "dropped",
  );
  const upstream = pieces.find(
    (one) =>
      piece?.status === "waiting" &&
      piece.waitsOn.includes(one.id) &&
      one.status !== "done" &&
      one.status !== "dropped",
  );
  const chips: (DoorChip | false)[] = [
    needsYou > 0 && { kind: "needs-you", count: needsYou },
    goals[0]?.state === "working" && { kind: "working" },
    ownGoal?.state === "ended" && ownGoal.reviewedAt === undefined && { kind: "review" },
    piece?.status === "queued" && { kind: "queued" },
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

// The chief's door: waiting for the user, at work on its goal, or idle.
export function chiefDoor(goal: TaskRecord | undefined, needsYou: number): DoorChip[] {
  const chips: DoorChip[] = [];
  if (needsYou > 0) chips.push({ kind: "needs-you", count: needsYou });
  if (goal?.state === "working") chips.push({ kind: "working" });
  return chips.length === 0 ? [{ kind: "idle" }] : chips;
}

// The chief's goal now: the one not ended, before any queued behind it.
export function chiefGoal(tasks: readonly TaskRecord[], chiefId: string): TaskRecord | undefined {
  return tasks
    .filter((task) => task.leadAgentId === chiefId && task.state !== "ended")
    .sort(
      (a, b) =>
        Number(a.state === "queued") - Number(b.state === "queued") ||
        a.createdAt.localeCompare(b.createdAt),
    )[0];
}
