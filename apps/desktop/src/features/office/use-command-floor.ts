import type { DepartmentRecord } from "@office-town/contract";
import { useMemo } from "react";
import { useApp } from "../../store/app-store.ts";
import { chiefDoor, chiefGoal, type DoorChip, departmentDoor } from "./doors.ts";
import { type Link, planLinks } from "./plan-links.ts";

// The chief's office, by room id.
export const CHIEF_ROOM = "chief";

// What the floor shows of the command center (M5.4): the links of the chief's current plan, that
// goal's id, and each room's door chips, by room id.
export function useCommandFloor(departments: readonly DepartmentRecord[]): {
  links: Link[];
  goalId: string | undefined;
  doors: Record<string, DoorChip[]>;
} {
  const tasks = useApp((state) => state.tasks);
  const pieces = useApp((state) => state.pieces);
  const chiefId = useApp((state) => state.chiefId);
  const waiting = useApp((state) => state.waiting);
  const sessions = useApp((state) => state.sessions);
  const agents = useApp((state) => state.agents);
  const departmentRecords = useApp((state) => state.departments);

  return useMemo(() => {
    const allTasks = Object.values(tasks).map(({ task }) => task);
    const goal = chiefId === undefined ? undefined : chiefGoal(allTasks, chiefId);
    const plan = Object.values(pieces).filter((piece) => piece.taskId === goal?.id);
    // Agents, not requests: one agent asking twice is one that needs you.
    const askers = [
      ...new Set(
        Object.values(waiting).flatMap(
          ({ event }) => agents[sessions[event.sessionId]?.agentId ?? ""] ?? [],
        ),
      ),
    ];
    const doors: Record<string, DoorChip[]> = {};
    for (const department of departments) {
      doors[department.id] = departmentDoor({
        department,
        tasks: allTasks,
        pieces: plan,
        departments: departmentRecords,
        needsYou: askers.filter((agent) => agent.departmentId === department.id).length,
      });
    }
    if (chiefId !== undefined) {
      doors[CHIEF_ROOM] = chiefDoor(goal, askers.filter((agent) => agent.id === chiefId).length);
    }
    return { links: planLinks(plan, CHIEF_ROOM), goalId: goal?.id, doors };
  }, [tasks, pieces, chiefId, waiting, sessions, agents, departments, departmentRecords]);
}
