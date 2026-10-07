import type { AgentRecord, DepartmentRecord, HarnessLimits } from "@office-town/contract";
import { useMemo } from "react";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { type AppState, navigate, select, useApp } from "../../store/app-store.ts";
import { isOpen, type WaitingRequest } from "../../store/records.ts";
import { type AgentState, type Progress, progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { taskTitle } from "../../ui/format.ts";
import { BoardView } from "../board/BoardView.tsx";
import { usageByHarness, usageSummary } from "../departments/usage.ts";
import { Floor, type FloorAgent, type RoomSign } from "./Floor.tsx";
import { floorPlan, onTheFloor, type Point, type RoomSpec } from "./floor-plan.ts";
import styles from "./Office.module.css";
import { OfficePanel } from "./OfficePanel.tsx";
import { useOffice } from "./office-state.ts";
import { TopBar } from "./TopBar.tsx";
import { CHIEF_ROOM, useCommandFloor } from "./use-command-floor.ts";

const BUBBLE_LENGTH = 42;
const OPEN = "open";
const GUESTS = "guest";

function requestBubble(request: WaitingRequest): string {
  switch (request.event.type) {
    case "permission.requested":
      return "Needs your approval";
    case "question.requested":
      return "Has a question";
    case "proposal.requested":
      return "Proposes a team";
    case "plan.requested":
      return "Proposes a plan";
  }
}

// What shows above an agent's head: what it asks, or what it does now. Others stay quiet.
function bubbleOf(state: AgentState, request?: WaitingRequest, progress?: Progress) {
  let text: string | undefined;
  if (request !== undefined) {
    text = requestBubble(request);
  } else if (state === "working" && progress?.step !== undefined) {
    text = `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
  } else if (state === "working") {
    text = progress?.current?.title ?? "Working";
  }
  if (text === undefined) return {};
  return { bubble: text.length > BUBBLE_LENGTH ? `${text.slice(0, BUBBLE_LENGTH - 1)}…` : text };
}

// A department's members, lead first, then in the order they joined; each keeps its desk.
function membersOf(department: DepartmentRecord, agents: Record<string, AgentRecord>) {
  return Object.values(agents)
    .filter((agent) => agent.departmentId === department.id)
    .sort(
      (a, b) =>
        Number(b.id === department.leadAgentId) - Number(a.id === department.leadAgentId) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

type Known = Pick<AppState, "agents" | "tasks" | "sessions">;

// The department's latest goal, and its members' sessions in it; a guest is no member.
function goalOf(department: DepartmentRecord, state: Known) {
  const entry = Object.values(state.tasks)
    .filter(({ task }) => task.departmentId === department.id)
    .sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt))[0];
  const sessions = (entry?.sessionIds ?? [])
    .flatMap((id) => state.sessions[id] ?? [])
    .filter((session) => state.agents[session.agentId]?.guest !== true);
  return { task: entry?.task, sessions };
}

function roomOf(agent: Agent, departments: Record<string, DepartmentRecord>, chiefId?: string) {
  if (agent.id === chiefId) return CHIEF_ROOM;
  if (agent.record.guest) return GUESTS;
  const { departmentId } = agent.record;
  return departmentId !== undefined && departments[departmentId] !== undefined
    ? departmentId
    : OPEN;
}

interface Layout {
  agents: Agent[];
  traces: Record<string, Trace>;
  waiting: Record<string, WaitingRequest>;
  harnessName: (harness: string) => string;
  departments: DepartmentRecord[];
  limits: Record<string, HarnessLimits>;
  state: Known;
  chiefId: string | undefined;
  positions: Record<string, Point>;
}

// Every agent at work, or done today, at a desk: in its department's room, on the open floor if
// it works alone, or at the guest desk if it came for a second opinion (MODULES M4.9). The chief
// keeps its office whenever it is set up.
function layOut(layout: Layout) {
  const { agents, traces, waiting, harnessName, departments, limits, state, chiefId } = layout;
  const asking = new Map(
    Object.values(waiting).map((request) => [request.event.sessionId, request]),
  );
  const byId = Object.fromEntries(departments.map((department) => [department.id, department]));
  // Oldest first, so each agent keeps its desk as others arrive.
  const present = agents
    .filter(
      (agent) => agent.id === chiefId || onTheFloor(agent.latest, asking.has(agent.latest.id)),
    )
    .reverse();
  const inRoom = Map.groupBy(present, (agent) => roomOf(agent, byId, chiefId));
  const members = new Map(departments.map((one) => [one.id, membersOf(one, state.agents)]));
  const solo = inRoom.get(OPEN) ?? [];
  const guests = inRoom.get(GUESTS) ?? [];
  const specs: RoomSpec[] = [
    ...(chiefId === undefined ? [] : [{ id: CHIEF_ROOM, kind: "chief", desks: 1 } as const]),
    ...departments.map((one): RoomSpec => {
      const desks = Math.max(1, members.get(one.id)?.length ?? 0);
      return { id: one.id, kind: "department", desks };
    }),
    { id: OPEN, kind: "open", desks: Math.max(3, solo.length + 1) },
    ...(guests.length === 0 ? [] : [{ id: GUESTS, kind: "guest", desks: guests.length } as const]),
  ];
  const plan = floorPlan(specs, layout.positions);

  const floorAgents = present.map((agent): FloorAgent => {
    const roomId = roomOf(agent, byId, chiefId);
    const room = plan.rooms.find((one) => one.id === roomId);
    const seat =
      roomId === CHIEF_ROOM
        ? 0
        : roomId === OPEN
          ? solo.indexOf(agent)
          : roomId === GUESTS
            ? guests.indexOf(agent)
            : (members.get(roomId) ?? []).findIndex((member) => member.id === agent.id);
    const agentState = stateOf(agent, traces, asking.has(agent.latest.id));
    const trace = traces[agent.latest.id];
    return {
      agent,
      state: agentState,
      harness: harnessName(agent.latest.options.harness),
      position: room?.seats[seat]?.agent ?? plan.start,
      group:
        roomId === CHIEF_ROOM
          ? "Chief"
          : roomId === OPEN
            ? "Open floor"
            : roomId === GUESTS
              ? "Guests"
              : (byId[roomId]?.name ?? ""),
      ...bubbleOf(
        agentState,
        asking.get(agent.latest.id),
        trace === undefined ? undefined : progressOf(trace),
      ),
    };
  });

  const signs: Record<string, RoomSign> = {
    [OPEN]: { title: "Open floor", note: "agents working alone", lines: [] },
    [GUESTS]: { title: "Guest desk", note: "second opinions", lines: [] },
  };
  for (const department of departments) {
    const goal = goalOf(department, state);
    const usage = usageByHarness(goal.sessions, goal.task?.usage ?? [], limits)
      .map((one) => usageSummary(one, harnessName(one.harness)))
      .join(" · ");
    const working = goal.task !== undefined && goal.sessions.some(isOpen);
    signs[department.id] = {
      title: department.name,
      note: AUTONOMY[department.autonomy].label,
      lines: [
        working && goal.task !== undefined ? taskTitle(goal.task.prompt) : "No goal in progress",
        ...(usage === "" ? [] : [`${working ? "This goal" : "Last goal"} · ${usage}`]),
      ],
    };
  }
  return { plan, floorAgents, signs };
}

// The home screen (D-35): departments as rooms, the open floor and a guest desk.
export function OfficeView() {
  const agents = useAgents();
  const records = useApp((state) => state.agents);
  const departmentRecords = useApp((state) => state.departments);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const harnesses = useApp((state) => state.harnesses);
  const limits = useApp((state) => state.limits);
  const selection = useApp((state) => state.selection);
  const mode = useOffice((state) => state.mode);
  const view = useApp((state) => state.view);
  const chiefId = useApp((state) => state.chiefId);
  const positions = useApp((state) => state.roomPositions);
  const room = view.name === "office" ? view.room : undefined;

  // Oldest first, so a new or renamed department never moves the rooms already there.
  const departments = useMemo(
    () =>
      Object.values(departmentRecords).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [departmentRecords],
  );
  const { plan, floorAgents, signs } = useMemo(() => {
    const harnessName = (harness: string) =>
      harnesses.find((known) => known.harness === harness)?.name ?? harness;
    return layOut({
      agents,
      traces,
      waiting,
      harnessName,
      departments,
      limits,
      state: { agents: records, tasks, sessions },
      chiefId,
      positions,
    });
  }, [
    agents,
    traces,
    waiting,
    harnesses,
    departments,
    limits,
    records,
    tasks,
    sessions,
    chiefId,
    positions,
  ]);
  const { links, goalId, doors } = useCommandFloor(departments);

  const chosen = floorAgents.filter(({ agent }) => selection.includes(agent.id));
  const openRoom = room === undefined ? undefined : departmentRecords[room];
  const onSelect = (agentIds: string[]) => {
    select(agentIds);
    if (agentIds.length === 0 && room !== undefined) navigate({ name: "office" });
  };
  const onOpenRoom = (departmentId: string) => {
    select([]);
    navigate({ name: "office", room: departmentId });
  };

  return (
    <section aria-label="Office" className={styles.office}>
      <TopBar />
      {mode === "board" ? (
        <BoardView />
      ) : (
        <div className={styles.body}>
          <div className={styles.scroll}>
            <Floor
              plan={plan}
              agents={floorAgents}
              signs={signs}
              doors={doors}
              links={links}
              linksGoal={goalId}
              chief={chiefId === undefined ? undefined : records[chiefId]}
              selection={selection}
              room={chosen.length === 0 ? openRoom?.id : undefined}
              onSelect={onSelect}
              onOpenRoom={onOpenRoom}
            />
          </div>
          <OfficePanel
            selection={selection}
            chosen={chosen}
            room={openRoom}
            floorCount={floorAgents.length}
          />
        </div>
      )}
    </section>
  );
}
