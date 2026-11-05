import { LayoutGrid, Pin, PinOff, Plus, Settings, Square } from "lucide-react";
import { navigate, useApp } from "../../store/app-store.ts";
import { teamAtWork } from "../../store/records.ts";
import { confirmed, type MenuAction, type MenuContent, MenuHeader } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { taskName } from "../../ui/format.ts";
import { selectRoom } from "../office/office-state.ts";
import { pin, unpin, usePins } from "../office/pins.ts";
import { stopTeamAsk } from "../task/stop-asks.ts";

// Read when the menu opens; Stop team asks first, as on the department's panel.
export function departmentMenu(departmentId: string): MenuContent | undefined {
  const { departments, agents, tasks, sessions } = useApp.getState();
  const department = departments[departmentId];
  if (department === undefined) return undefined;
  const members = Object.values(agents).filter((agent) => agent.departmentId === departmentId);
  const ids = members.map((agent) => agent.id);
  const pinned = usePins.getState().pinned;
  const allPinned = ids.length > 0 && ids.every((id) => pinned.includes(id));
  const latest = Object.values(tasks)
    .map((entry) => entry.task)
    .filter((task) => task.departmentId === departmentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const working =
    latest !== undefined &&
    teamAtWork(
      latest,
      (tasks[latest.id]?.sessionIds ?? []).flatMap((id) => sessions[id] ?? []),
    );

  const actions: MenuAction[] = [
    { label: "Open", icon: LayoutGrid, run: () => selectRoom(departmentId) },
    {
      label: "New task here",
      icon: Plus,
      run: () => navigate({ name: "new-task", who: "team", departmentId }),
    },
    {
      label: "Department settings",
      icon: Settings,
      run: () => navigate({ name: "department", departmentId }),
    },
  ];
  if (ids.length > 0) {
    actions.push({
      label: allPinned ? "Unpin its agents" : "Pin its agents",
      icon: allPinned ? PinOff : Pin,
      run: () => (allPinned ? unpin(ids) : pin(ids)),
    });
  }
  if (working) {
    actions.push(
      confirmed(
        { label: "Stop team", icon: Square },
        stopTeamAsk(latest.id, "Stop team", taskName(latest)),
      ),
    );
  }
  const lead = agents[department.leadAgentId];
  return {
    header: (
      <MenuHeader
        face={<Avatar name={department.name} colour={lead?.colour ?? "var(--text-3)"} size={22} />}
        title={department.name}
        detail={`${members.length} ${members.length === 1 ? "agent" : "agents"} · ${working ? "Working" : "Idle"}`}
      />
    ),
    actions,
  };
}
