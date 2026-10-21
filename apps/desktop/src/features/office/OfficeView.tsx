import type { AgentRecord, DepartmentRecord } from "@office-town/contract";
import { Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import { type Agent, stateOf, useAgents } from "../../store/agents.ts";
import { type AppState, navigate, select, useApp } from "../../store/app-store.ts";
import { loadTrace } from "../../store/live.ts";
import { isOpen, type WaitingRequest } from "../../store/records.ts";
import { type AgentState, type Progress, progressOf } from "../../trace/progress.ts";
import type { Trace } from "../../trace/trace.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { taskTitle } from "../../ui/format.ts";
import { BoardView } from "../board/BoardView.tsx";
import { newTokens, usageByPerson } from "../departments/usage.ts";
import { requestLabel } from "../needs-you/request-label.ts";
import { Floor, type FloorAgent, type RoomSign } from "./Floor.tsx";
import {
  ADD_CHIEF,
  ADD_DEPARTMENT,
  floorPlan,
  onTheFloor,
  type Point,
  type RoomSpec,
} from "./floor-plan.ts";
import styles from "./Office.module.css";
import { OfficePanel } from "./OfficePanel.tsx";
import { openChat, type PanelKind, setPanelOpen, useOffice } from "./office-state.ts";
import { TopBar } from "./TopBar.tsx";
import { CHIEF_ROOM, useCommandFloor } from "./use-command-floor.ts";

const BUBBLE_LENGTH = 42;
const OPEN = "open";
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
  }
  if (text === undefined) return {};
  return { bubble: text.length > BUBBLE_LENGTH ? `${text.slice(0, BUBBLE_LENGTH - 1)}…` : text };
}

// Lead first, then in join order, so each keeps its desk.
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
}

// Every agent at work or done today, at a desk. The chief keeps its office whenever it is set up.
function layOut(layout: Layout) {
  const { agents, traces, waiting, harnessName, departments, state, chiefId } = layout;
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
    // Only an empty office invites setup as rooms; after that the floor's corner offers it.
    ...(departments.length > 0 ? [] : [{ id: ADD_DEPARTMENT, kind: "add", desks: 1 } as const]),
    ...(departments.length > 0 || chiefId !== undefined
      ? []
      : [{ id: ADD_CHIEF, kind: "add", desks: 1 } as const]),
    { id: OPEN, kind: "open", desks: Math.max(3, solo.length + 1) },
    ...(guests.length === 0 ? [] : [{ id: GUESTS, kind: "guest", desks: guests.length } as const]),
  ];
  const plan = floorPlan(specs, layout.positions);

  // Each department's current or last goal, and what each member used on it once its traces are in.
  const goals = new Map(departments.map((one) => [one.id, goalOf(one, state)]));
  const memberTokens = new Map<string, number>();
  // Sessions whose traces the token counts still wait for.
  const unloaded: string[] = [];
  for (const goal of goals.values()) {
    const people = usageByPerson(goal.sessions, traces);
    if (people === undefined) {
      unloaded.push(...goal.sessions.flatMap((one) => (traces[one.id] ? [] : one.id)));
    }
    for (const person of people ?? []) memberTokens.set(person.agentId, person.tokens);
  }

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
    const tokens = roomId === agent.record.departmentId ? memberTokens.get(agent.id) : undefined;
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
      ...(tokens === undefined ? {} : { tokens }),
      ...bubbleOf(
        agentState,
        asking.get(agent.latest.id),
        trace === undefined ? undefined : progressOf(trace),
      ),
    };
  });

  const signs: Record<string, RoomSign> = {
    [OPEN]: { title: "Open floor", note: "Assistants", lines: [] },
    [GUESTS]: { title: "Review desk", note: "Reviewers", lines: [] },
  };
  for (const department of departments) {
    const goal = goals.get(department.id);
    const task = goal?.task;
    const working = task !== undefined && (goal?.sessions ?? []).some(isOpen);
    const apps = (task?.usage ?? [])
      .map((one) => ({ name: harnessName(one.harness), tokens: newTokens(one) }))
      .filter((one) => one.tokens > 0);
    signs[department.id] = {
      title: department.name,
      note: AUTONOMY[department.autonomy].short,
      lines:
        task === undefined
          ? ["No goal in progress"]
          : [working ? taskTitle(task.prompt) : `Last goal · ${taskTitle(task.prompt)}`],
      ...(apps.length === 0
        ? {}
        : { usage: { apps, total: apps.reduce((sum, one) => sum + one.tokens, 0) } }),
    };
  }
  return { plan, floorAgents, signs, unloaded };
}

// The home screen (D-35).
export function OfficeView() {
  const agents = useAgents();
  const records = useApp((state) => state.agents);
  const departmentRecords = useApp((state) => state.departments);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const traces = useApp((state) => state.traces);
  const waiting = useApp((state) => state.waiting);
  const harnesses = useApp((state) => state.harnesses);
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
  const { plan, floorAgents, signs, unloaded } = useMemo(() => {
    const harnessName = (harness: string) =>
      harnesses.find((known) => known.harness === harness)?.name ?? harness;
    return layOut({
      agents,
      traces,
      waiting,
      harnessName,
      departments,
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
    records,
    tasks,
    sessions,
    chiefId,
    positions,
  ]);
  useEffect(() => {
    for (const sessionId of unloaded) loadTrace(sessionId);
  }, [unloaded]);
  const { links, goalId, doors } = useCommandFloor(departments);

  const chosen = floorAgents.filter(({ agent }) => selection.includes(agent.id));
  const openRoom = room === undefined ? undefined : departmentRecords[room];
  const onSelect = (agentIds: string[]) => {
    if (agentIds.length === 0 && room !== undefined) navigate({ name: "office" });
    select(agentIds);
  };
  const onOpenRoom = (departmentId: string) => {
    navigate({ name: "office", room: departmentId });
    select([]);
  };
  const onOpenChat = (id: string, kind: PanelKind) => {
    if (kind === "department") onOpenRoom(id);
    else select([id]);
    openChat(kind);
  };

  return (
    <section aria-label="Office" className={styles.office}>
      <OpenOnSelect selection={selection} room={openRoom?.id} />
      <TopBar />
      {mode === "board" ? (
        <BoardView />
      ) : (
        <div className={styles.body}>
          <div className={styles.stage}>
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
                onOpenChat={onOpenChat}
              />
            </div>
            {departments.length === 0 ? null : <AddCorner chief={chiefId === undefined} />}
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

// Once the office has a team, setup waits quietly in the corner instead of taking floor space.
function AddCorner({ chief }: { chief: boolean }) {
  return (
    <div className={styles.addCorner}>
      {chief ? (
        <button type="button" className={styles.addBox} onClick={() => navigate({ name: "chief" })}>
          <Plus size={14} aria-hidden />
          Chief's office
        </button>
      ) : null}
      <button
        type="button"
        className={styles.addBox}
        onClick={() => navigate({ name: "new-department" })}
      >
        <Plus size={14} aria-hidden />
        New department
      </button>
    </div>
  );
}

// Picking someone or a room brings a hidden side panel back.
function OpenOnSelect({ selection, room }: { selection: string[]; room: string | undefined }) {
  const key = `${selection.join(",")}|${room ?? ""}`;
  useEffect(() => {
    if (key !== "|") setPanelOpen(true);
  }, [key]);
  return null;
}
