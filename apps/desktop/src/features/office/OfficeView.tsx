import type { AgentRecord, DepartmentRecord } from "@office-town/contract";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { type AppState, navigate, select, useApp } from "../../store/app-store.ts";
import { useTraces } from "../../store/live.ts";
import { teamAtWork, type WaitingRequest } from "../../store/records.ts";
import { type AgentState, isBusy, type Progress, progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { taskName } from "../../ui/format.ts";
import { stateLabel } from "../../ui/StatusIcon.tsx";
import { BoardView } from "../board/BoardView.tsx";
import { byRole } from "../departments/team-form.ts";
import { newTokens } from "../departments/usage.ts";
import { requestLabel } from "../needs-you/request-label.ts";
import { fraction, goalStatuses, partStatuses, pieceStatuses } from "../task/goal-progress.ts";
import { chiefGoal } from "./doors.ts";
import {
  Floor,
  type FloorAgent,
  type FreeMember,
  type RoomSign,
  scrollbarWidth,
} from "./Floor.tsx";
import { floorPlan, onTheFloor, type Point, type RoomSpec, SAMPLE_ROOM } from "./floor-plan.ts";
import styles from "./Office.module.css";
import { OfficePanel } from "./OfficePanel.tsx";
import {
  FOLD_AFTER,
  OPEN_FLOOR,
  openChat,
  type PanelKind,
  rememberRoom,
  reopenRoom,
  setPanelOpen,
  useOffice,
} from "./office-state.ts";
import { QuietRooms } from "./QuietRooms.tsx";
import { TopBar } from "./TopBar.tsx";
import { CHIEF_ROOM, useCommandFloor } from "./use-command-floor.ts";

const BUBBLE_LENGTH = 42;
const OPEN = OPEN_FLOOR;
const GUESTS = "guest";

// What it asks, or what it does now. Others stay quiet.
function bubbleOf(state: AgentState, request?: WaitingRequest, progress?: Progress) {
  let text: string | undefined;
  if (request !== undefined) {
    text = requestLabel(request);
  } else if (state === "working" && progress?.step !== undefined) {
    text = `Step ${progress.step.number} of ${progress.stepCount} · ${progress.step.title}`;
  } else if (state === "working") {
    text = progress?.current?.title ?? "Working";
  } else if (state === "background") {
    text = stateLabel(state, progress?.subAgents.length ?? 0);
  }
  if (text === undefined) return {};
  return { bubble: text.length > BUBBLE_LENGTH ? `${text.slice(0, BUBBLE_LENGTH - 1)}…` : text };
}

interface Team {
  label: string;
  members: AgentRecord[];
}

// The lead, then one sub-team per role, each in join order.
function teamsOf(department: DepartmentRecord, agents: Record<string, AgentRecord>): Team[] {
  const joined = Object.values(agents)
    .filter((agent) => agent.departmentId === department.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lead = joined.filter((agent) => agent.id === department.leadAgentId);
  const others = byRole(
    joined.filter((agent) => agent.id !== department.leadAgentId),
    (agent) => agent.role,
  );
  return [
    ...(lead.length === 0 ? [] : [{ label: "Lead", members: lead }]),
    ...others.map(({ role, people }) => ({ label: role || "Team", members: people })),
  ];
}

type Known = Pick<
  AppState,
  "agents" | "tasks" | "sessions" | "delegations" | "milestones" | "pieces"
>;

// A guest is no member.
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
  state: Known;
  chiefId: string | undefined;
  positions: Record<string, Point>;
  // Free departments folded into the strip under the floor; their members are not drawn.
  folded: ReadonlySet<string>;
  paneWidth: number;
}

// A department member that is not at work and not asking is free: it sleeps at its desk.
const freeAt = (state: AgentState) => !isBusy(state) && state !== "waiting";

// Every agent at work or done today, at a desk, and every department member, free or not. The
// chief keeps its office whenever it is set up.
function layOut(layout: Layout) {
  const { agents, traces, waiting, harnessName, departments, state, chiefId } = layout;
  const asking = new Map(
    Object.values(waiting).map((request) => [request.event.sessionId, request]),
  );
  const byId = Object.fromEntries(departments.map((department) => [department.id, department]));
  // Oldest first, so each agent keeps its desk as others arrive.
  const present = agents
    .filter(
      (agent) =>
        agent.id === chiefId ||
        onTheFloor(agent.latest, asking.has(agent.latest.id)) ||
        roomOf(agent, byId, chiefId) === agent.record.departmentId,
    )
    .filter(
      (agent) =>
        agent.id === chiefId ||
        agent.record.departmentId === undefined ||
        !layout.folded.has(agent.record.departmentId),
    )
    .reverse();
  const inRoom = Map.groupBy(present, (agent) => roomOf(agent, byId, chiefId));
  const teams = new Map(departments.map((one) => [one.id, teamsOf(one, state.agents)]));
  // Seats follow the teams' order.
  const members = new Map(
    [...teams].map(([id, list]) => [id, list.flatMap((team) => team.members)]),
  );
  const solo = inRoom.get(OPEN) ?? [];
  const guests = inRoom.get(GUESTS) ?? [];
  const specs: RoomSpec[] = [
    ...(chiefId === undefined ? [] : [{ id: CHIEF_ROOM, kind: "chief", desks: 1 } as const]),
    ...departments.map((one): RoomSpec => {
      const desks = Math.max(1, members.get(one.id)?.length ?? 0);
      const groups = (teams.get(one.id) ?? []).map(({ label, members: people }) => ({
        label,
        desks: people.length,
      }));
      return { id: one.id, kind: "department", desks, ...(groups.length > 1 ? { groups } : {}) };
    }),
    // Only an empty office shows what is coming; after that the top bar offers New department.
    ...(departments.length > 0 ? [] : [{ id: SAMPLE_ROOM, kind: "sample", desks: 1 } as const]),
    // Only while an assistant works alone today (design audit a2-11).
    ...(solo.length === 0 ? [] : [{ id: OPEN, kind: "open", desks: solo.length } as const]),
    ...(guests.length === 0 ? [] : [{ id: GUESTS, kind: "guest", desks: guests.length } as const]),
  ];
  const plan = floorPlan(specs, layout.positions, layout.paneWidth);

  // Each department's current or last goal; its sessions' traces give each desk its work line.
  const goals = new Map(departments.map((one) => [one.id, goalOf(one, state)]));
  const goalSessions = [...goals.values()].flatMap((goal) => goal.sessions.map((one) => one.id));

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
    const inDepartment = roomId === agent.record.departmentId;
    const lead = byId[roomId]?.leadAgentId === agent.id;
    const trace = traces[agent.latest.id];
    // Its part of the department's goal, or the goal itself at the lead's desk (D-95).
    const goalTask = inDepartment ? goals.get(roomId)?.task : undefined;
    const part =
      goalTask === undefined
        ? []
        : goalTask.leadAgentId === agent.id
          ? goalStatuses(state.milestones, goalTask.id, goalTask.state === "ended")
          : partStatuses(state.milestones, state.delegations, goalTask.id, agent.id);
    return {
      agent,
      state: agentState,
      harness: harnessName(agent.latest.options.harness),
      position: room?.seats[seat]?.agent ?? plan.start,
      group:
        roomId === CHIEF_ROOM
          ? "Chief"
          : roomId === OPEN
            ? "Assistants"
            : roomId === GUESTS
              ? "Reviewers"
              : (byId[roomId]?.name ?? ""),
      ...(inDepartment ? { role: lead ? "Lead" : (agent.record.role ?? "Member") } : {}),
      ...(part.length === 0 ? {} : { part }),
      // Today's outcome stays on its badge; an older one is no longer news.
      ...(inDepartment && freeAt(agentState)
        ? { free: onTheFloor(agent.latest, false) ? "today" : "before" }
        : {}),
      ...bubbleOf(
        agentState,
        asking.get(agent.latest.id),
        trace === undefined ? undefined : progressOf(trace),
      ),
    };
  });

  // Members that have never worked have no session to show, only a desk.
  const seatedIds = new Set(present.map((agent) => agent.id));
  const freeMembers = departments.flatMap((department) => {
    const room = plan.rooms.find((one) => one.id === department.id);
    const people = members.get(department.id) ?? [];
    return people.flatMap((record, seat): FreeMember[] => {
      if (seatedIds.has(record.id) || record.id === chiefId || record.guest) return [];
      return [
        {
          id: record.id,
          name: record.name,
          colour: record.colour,
          position: room?.seats[seat]?.agent ?? plan.start,
          detail: harnessName(record.settings.harness),
          where: `${record.id === department.leadAgentId ? "Lead" : (record.role ?? "Member")} · ${department.name}`,
        },
      ];
    });
  });

  const signs: Record<string, RoomSign> = {
    [OPEN]: { title: "Assistants", lines: [] },
    [GUESTS]: { title: "Reviewers", lines: [] },
  };
  for (const department of departments) {
    const goal = goals.get(department.id);
    const task = goal?.task;
    const working = task !== undefined && teamAtWork(task, goal?.sessions ?? []);
    const apps = (task?.usage ?? [])
      .map((one) => ({ name: harnessName(one.harness), tokens: newTokens(one) }))
      .filter((one) => one.tokens > 0);
    const statuses =
      task === undefined ? [] : goalStatuses(state.milestones, task.id, task.state === "ended");
    signs[department.id] = {
      title: department.name,
      lines:
        task === undefined
          ? ["No task yet"]
          : [working ? taskName(task) : `Last task · ${taskName(task)}`],
      ...(statuses.length === 0 ? {} : { progress: { statuses, label: fraction(statuses) } }),
      ...(apps.length === 0
        ? {}
        : { usage: { apps, total: apps.reduce((sum, one) => sum + one.tokens, 0) } }),
    };
  }
  // The chief counts its departments' pieces of the goal it runs.
  const goal =
    chiefId === undefined
      ? undefined
      : chiefGoal(
          Object.values(state.tasks).map(({ task }) => task),
          chiefId,
        );
  const pieces = pieceStatuses(
    Object.values(state.pieces).filter((piece) => piece.taskId === goal?.id),
  );
  if (pieces.length > 0) {
    signs[CHIEF_ROOM] = {
      title: "Chief",
      lines: [],
      progress: { statuses: pieces, label: `${fraction(pieces)} departments` },
    };
  }
  return { plan, floorAgents, freeMembers, signs, goalSessions, assistants: solo.length };
}

// The home screen (D-35).
export function OfficeView() {
  const agents = useAgents();
  const records = useApp((state) => state.agents);
  const departmentRecords = useApp((state) => state.departments);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const delegations = useApp((state) => state.delegations);
  const milestones = useApp((state) => state.milestones);
  const pieces = useApp((state) => state.pieces);
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const harnesses = useApp((state) => state.harnesses);
  const selection = useApp((state) => state.selection);
  const mode = useOffice((state) => state.mode);
  const view = useApp((state) => state.view);
  const chiefId = useApp((state) => state.chiefId);
  const positions = useApp((state) => state.roomPositions);
  const showAllRooms = useOffice((state) => state.showAllRooms);
  const room = view.name === "office" ? view.room : undefined;
  const scroll = useRef<HTMLDivElement>(null);
  const paneWidth = useWidthOf(scroll);

  // By name, as every other list of departments (design audit a2-19).
  const departments = useMemo(
    () => Object.values(departmentRecords).toSorted((a, b) => a.name.localeCompare(b.name)),
    [departmentRecords],
  );
  const { links, goalId, doors } = useCommandFloor(departments);
  // Past FOLD_AFTER departments, a room with nothing on its door folds, unless it is open or
  // holds someone picked (design audit a2-2).
  // Kept by its ids, so picking someone does not lay the floor out again.
  const foldedIds = useMemo(() => {
    if (departments.length <= FOLD_AFTER || showAllRooms) return "";
    const picked = new Set(selection.flatMap((id) => records[id]?.departmentId ?? []));
    const quiet = departments.filter(
      (one) => (doors[one.id] ?? []).length === 0 && one.id !== room && !picked.has(one.id),
    );
    return quiet.map((one) => one.id).join(" ");
  }, [departments, showAllRooms, doors, room, selection, records]);
  const folded = useMemo(() => new Set(foldedIds.split(" ").filter(Boolean)), [foldedIds]);
  const { plan, floorAgents, freeMembers, signs, goalSessions, assistants } = useMemo(() => {
    const harnessName = (harness: string) =>
      harnesses.find((known) => known.harness === harness)?.name ?? harness;
    return layOut({
      agents,
      traces,
      waiting,
      harnessName,
      departments: departments.filter((one) => !folded.has(one.id)),
      state: { agents: records, tasks, sessions, delegations, milestones, pieces },
      chiefId,
      positions,
      folded,
      paneWidth,
    });
  }, [
    agents,
    traces,
    waiting,
    harnesses,
    departments,
    records,
    tasks,
    sessions,
    delegations,
    milestones,
    pieces,
    chiefId,
    positions,
    folded,
    paneWidth,
  ]);
  useTraces(goalSessions);

  // Back from another screen, the room left open opens again.
  useEffect(() => {
    reopenRoom((id) => id === OPEN || useApp.getState().departments[id] !== undefined);
  }, []);
  useEffect(() => {
    if (useApp.getState().view.name === "office") rememberRoom(room);
  }, [room]);

  const chosen = floorAgents.filter(({ agent }) => selection.includes(agent.id));
  const openRoom = room === undefined ? undefined : departmentRecords[room];
  const openFloor = room === OPEN;
  const onSelect = (agentIds: string[]) => {
    if (agentIds.length === 0 && room !== undefined) navigate({ name: "office" });
    select(agentIds);
  };
  // Shows the panel too, when it was hidden with this room still open.
  const onOpenRoom = (departmentId: string) => {
    navigate({ name: "office", room: departmentId });
    select([]);
    setPanelOpen(true);
  };
  const onOpenChat = (id: string, kind: PanelKind) => {
    if (kind === "department") onOpenRoom(id);
    else select([id]);
    openChat(kind);
  };

  return (
    <section aria-label="Office" className={styles.office}>
      <OpenOnSelect selection={selection} room={openFloor ? OPEN : openRoom?.id} />
      <TopBar />
      {mode === "board" ? (
        <BoardView />
      ) : (
        <div className={styles.body}>
          <div className={styles.stage}>
            <div ref={scroll} className={styles.scroll}>
              <Floor
                plan={plan}
                agents={floorAgents}
                free={freeMembers}
                signs={signs}
                doors={doors}
                links={links}
                linksGoal={goalId}
                chief={chiefId === undefined ? undefined : records[chiefId]}
                selection={selection}
                room={chosen.length === 0 ? (openFloor ? OPEN : openRoom?.id) : undefined}
                onSelect={onSelect}
                onOpenRoom={onOpenRoom}
                onOpenChat={onOpenChat}
              />
              <QuietRooms
                folded={departments.filter((one) => folded.has(one.id))}
                foldable={departments.length > FOLD_AFTER}
                onOpenRoom={onOpenRoom}
              />
            </div>
          </div>
          <OfficePanel
            selection={selection}
            chosen={chosen}
            room={openRoom}
            openFloor={openFloor}
            assistants={assistants}
          />
        </div>
      )}
    </section>
  );
}

// Picking someone or a room opens the side panel; picking nothing closes it (design audit a2-4).
function OpenOnSelect({ selection, room }: { selection: string[]; room: string | undefined }) {
  const key = `${selection.join(",")}|${room ?? ""}`;
  useEffect(() => {
    setPanelOpen(key !== "|");
  }, [key]);
  return null;
}

// The pane's width less a scrollbar, in steps of 10 px so a small resize does not lay out again.
function useWidthOf(element: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    const bar = scrollbarWidth();
    const observer = new ResizeObserver(() => {
      setWidth(Math.floor((node.offsetWidth - bar) / 10) * 10);
    });
    observer.observe(node, { box: "border-box" });
    return () => observer.disconnect();
  }, [element]);
  return width;
}
