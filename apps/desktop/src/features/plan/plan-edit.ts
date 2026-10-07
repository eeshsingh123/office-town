import type {
  ApprovedPiece,
  Autonomy,
  PlanPiece,
  ProposedPiece,
  RoleSettings,
} from "@office-town/contract";

// A department the chief proposed, as the user places it before approving.
export interface DraftDepartment {
  name: string;
  purpose: string;
  lead: RoleSettings;
  workspaceId?: string;
  autonomy: Autonomy;
}

// One piece while the user edits the plan; `waitsOn` names other pieces by key.
export interface PlanRow {
  key: string;
  title: string;
  brief: string;
  waitsOn: string[];
  department: { departmentId: string } | { newDepartment: DraftDepartment };
}

// A piece that stays when a changed plan is approved, which a new piece may build on.
export interface KeptPiece {
  key: string;
  title: string;
}

export function toRows(pieces: readonly ProposedPiece[]): PlanRow[] {
  return pieces.map(({ key, title, brief, waitsOn, department }) => ({
    key,
    title,
    brief,
    waitsOn,
    department:
      "departmentId" in department
        ? department
        : { newDepartment: { ...department.newDepartment, autonomy: "supervised" } },
  }));
}

// Whether `to` waits, directly or through others, on `from`.
function reaches(
  rows: readonly PlanRow[],
  to: string,
  from: string,
  seen = new Set<string>(),
): boolean {
  if (to === from) return true;
  if (seen.has(to)) return false;
  seen.add(to);
  const row = rows.find((one) => one.key === to);
  return row?.waitsOn.some((key) => reaches(rows, key, from, seen)) ?? false;
}

// Letting `from` wait on `to` would close a circle.
export function wouldCycle(rows: readonly PlanRow[], from: string, to: string): boolean {
  return reaches(rows, to, from);
}

const newDepartmentNames = (rows: readonly PlanRow[]) =>
  rows.flatMap(({ department }) =>
    "newDepartment" in department ? [department.newDepartment.name.trim()] : [],
  );

// What keeps the plan from being approved, in words for the user; undefined if nothing. It mirrors
// the core's checks, so the user is not sent an answer the core refuses.
export function planProblem(
  rows: readonly PlanRow[],
  kept: readonly KeptPiece[] = [],
  departmentNames: readonly string[] = [],
): string | undefined {
  if (rows.length === 0) return "Add a piece to approve the plan.";
  if (rows.some((row) => row.title.trim() === "" || row.brief.trim() === "")) {
    return "Every piece needs a title and a brief.";
  }
  const keys = rows.map((row) => row.key);
  if (keys.some((key, index) => keys.indexOf(key) !== index)) {
    return "Two pieces share a key; remove one and add it again.";
  }
  const known = new Set([...rows.map((row) => row.key), ...kept.map((piece) => piece.key)]);
  if (rows.some((row) => row.waitsOn.some((key) => !known.has(key)))) {
    return "A piece waits on one that is no longer in the plan.";
  }
  if (rows.some((row) => row.waitsOn.some((key) => reaches(rows, key, row.key)))) {
    return "The pieces wait on each other in a circle.";
  }
  for (const { department } of rows) {
    if (!("newDepartment" in department)) continue;
    const { name, workspaceId } = department.newDepartment;
    if (name.trim() === "") return "Name each new department to approve.";
    if (workspaceId === undefined) return `Choose a workspace for ${name.trim()} to approve.`;
  }
  const names = newDepartmentNames(rows);
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) {
    return `The new department ${twice} has two pieces. Give it one; it can take more in a changed plan once it exists.`;
  }
  const taken = names.find((name) => departmentNames.includes(name));
  if (taken !== undefined) return `A department called ${taken} exists already.`;
  return undefined;
}

// The plan as approved; call only once `planProblem` finds nothing.
export function toApproved(rows: readonly PlanRow[]): ApprovedPiece[] {
  return rows.map(({ key, title, brief, waitsOn, department }) => {
    const shared = { key, title: title.trim(), brief: brief.trim(), waitsOn };
    if ("departmentId" in department) return { ...shared, department };
    const { name, purpose, lead, workspaceId, autonomy } = department.newDepartment;
    return {
      ...shared,
      department: {
        newDepartment: {
          name: name.trim(),
          purpose,
          lead,
          workspaceId: workspaceId ?? "",
          autonomy,
        },
      },
    };
  });
}

interface Placed {
  name: string;
  autonomy: Autonomy;
}

function placedOf(row: PlanRow, departments: Record<string, Placed>): Placed | undefined {
  const { department } = row;
  return "departmentId" in department
    ? departments[department.departmentId]
    : department.newDepartment;
}

// Read-only upstream folders are enforced for file edits only: a downstream department on Full can
// still change them with a command, and on Bypass nothing guards them at all (MODULES M5).
export function guardWarnings(
  rows: readonly PlanRow[],
  departments: Record<string, Placed>,
): string[] {
  return rows.flatMap((row) => {
    const placed = placedOf(row, departments);
    if (placed === undefined || row.waitsOn.length === 0) return [];
    if (placed.autonomy !== "full" && placed.autonomy !== "bypass") return [];
    const upstream = row.waitsOn.flatMap((key) => {
      const before = rows.find((one) => one.key === key);
      const name = before === undefined ? undefined : placedOf(before, departments)?.name;
      return name === undefined || name === placed.name ? [] : [`${name}'s`];
    });
    if (upstream.length === 0) return [];
    const folders = `${[...new Set(upstream)].join(" or ")} folder`;
    return placed.autonomy === "bypass"
      ? [`${placed.name} runs in Bypass, so nothing guards it: it could change ${folders}.`]
      : [
          `${placed.name} runs in Full: read-only is enforced for file edits only; its commands could still change ${folders}.`,
        ];
  });
}

export interface PlanChanges {
  removed: PlanPiece[];
  added: ProposedPiece[];
  changed: ProposedPiece[];
  doneUnchanged: number;
}

const departmentKey = (department: ProposedPiece["department"]) =>
  "departmentId" in department ? department.departmentId : `new:${department.newDepartment.name}`;

// A changed plan against the plan as it is: the pieces it drops, adds and changes.
export function planChanges(current: readonly PlanPiece[], proposed: readonly ProposedPiece[]) {
  const live = current.filter((piece) => piece.status !== "dropped");
  const keyOf = new Map(live.map((piece) => [piece.id, piece.key]));
  const byKey = new Map(live.map((piece) => [piece.key, piece]));
  const keys = new Set(proposed.map((piece) => piece.key));
  const changes: PlanChanges = {
    removed: live.filter(
      (piece) => !keys.has(piece.key) && piece.status !== "done" && piece.status !== "working",
    ),
    added: proposed.filter((piece) => !byKey.has(piece.key)),
    changed: proposed.filter((piece) => {
      const before = byKey.get(piece.key);
      if (before === undefined) return false;
      const waits = before.waitsOn.map((id) => keyOf.get(id) ?? id).sort();
      return (
        before.title !== piece.title ||
        before.brief !== piece.brief ||
        waits.join() !== [...piece.waitsOn].sort().join() ||
        (before.departmentId ?? `new:${before.newDepartment?.name}`) !==
          departmentKey(piece.department)
      );
    }),
    doneUnchanged: live.filter((piece) => piece.status === "done" && !keys.has(piece.key)).length,
  };
  return changes;
}
