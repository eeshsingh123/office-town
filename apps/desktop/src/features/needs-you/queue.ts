import type {
  AgentRecord,
  DepartmentRecord,
  SessionRecord,
  UserRequestEvent,
  WorkspaceRecord,
} from "@office-town/contract";
import type { TaskEntry, WaitingRequest } from "../../store/records.ts";
import { taskTitle } from "../../ui/format.ts";

export type AskKind = "plan" | "team" | "question" | "approval";
export type TypeFilter = "all" | "decisions" | "question" | "approval";
export type GroupBy = "task" | "department" | "workspace" | "agent" | "type";

export interface Ask {
  // The request's `waitingKey`.
  key: string;
  position: number;
  event: UserRequestEvent;
  kind: AskKind;
  title: string;
  detail: string | undefined;
  askedAt: number;
  taskId: string | undefined;
  taskName: string;
  agentId: string | undefined;
  agentName: string;
  agentColour: string | undefined;
  departmentId: string | undefined;
  departmentName: string;
  workspaceId: string | undefined;
  workspaceName: string;
  harness: string;
}

export interface QueueSources {
  waiting: Record<string, WaitingRequest>;
  sessions: Record<string, SessionRecord>;
  tasks: Record<string, TaskEntry>;
  agents: Record<string, AgentRecord>;
  departments: Record<string, DepartmentRecord>;
  workspaces: readonly WorkspaceRecord[] | undefined;
  harnessName: (harness: string) => string;
}

export interface Filters {
  type: TypeFilter;
  departmentId: string | undefined;
  workspaceId: string | undefined;
  harness: string | undefined;
  // Only asks made before this time, in milliseconds.
  askedBefore: number | undefined;
  query: string;
}

export const NO_FILTERS: Filters = {
  type: "all",
  departmentId: undefined,
  workspaceId: undefined,
  harness: undefined,
  askedBefore: undefined,
  query: "",
};

export interface Group {
  key: string;
  name: string;
  colour: string | undefined;
  // What its asks share, such as "Research · Scratch · OpenCode".
  meta: string;
  asks: Ask[];
  approvals: Ask[];
  oldestAt: number;
}

// Plans and team proposals hold a whole team back, so they come first; then questions.
const RANK: Record<AskKind, number> = { plan: 0, team: 0, question: 1, approval: 2 };

export const KIND_LABEL: Record<AskKind, string> = {
  plan: "Plan",
  team: "Team",
  question: "Question",
  approval: "Approval",
};

const TYPE_NAME: Record<AskKind, string> = {
  plan: "Plans and teams",
  team: "Plans and teams",
  question: "Questions",
  approval: "Approvals",
};

const NONE = "~none";

function kindOf(event: UserRequestEvent): AskKind {
  switch (event.type) {
    case "plan.requested":
      return "plan";
    case "proposal.requested":
      return "team";
    case "question.requested":
      return "question";
    case "permission.requested":
      return "approval";
  }
}

// The one line a person reads to decide: the command, else the file, else the address or search.
function inputLine(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const fields = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "url", "query", "pattern"]) {
    const value = fields[key];
    if (typeof value === "string") return value.split("\n")[0];
  }
  return undefined;
}

function describe(event: UserRequestEvent): { title: string; detail: string | undefined } {
  switch (event.type) {
    case "permission.requested": {
      const { title, input } = event.payload;
      const line = inputLine(input);
      // Some harnesses already put the search or file in the title.
      return { title, detail: line !== undefined && title.includes(line) ? undefined : line };
    }
    case "question.requested":
      return { title: "Has a question", detail: event.payload.questions[0]?.text };
    case "plan.requested": {
      const { pieces } = event.payload;
      return {
        title: `Plan with ${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"}`,
        detail: pieces.map((piece) => piece.title).join(", "),
      };
    }
    case "proposal.requested": {
      const { team, place } = event.payload;
      return {
        title: `Team "${team.name}"`,
        detail: `${team.roles.length + 1} people in ${place.workspaceName}`,
      };
    }
  }
}

const byUrgency = (a: Ask, b: Ask) => RANK[a.kind] - RANK[b.kind] || a.position - b.position;

export function buildAsks(sources: QueueSources): Ask[] {
  const { sessions, tasks, agents, departments, workspaces, harnessName } = sources;
  return Object.entries(sources.waiting)
    .map(([key, { position, event }]) => {
      const session = sessions[event.sessionId];
      const task = session === undefined ? undefined : tasks[session.taskId]?.task;
      const agent = session === undefined ? undefined : agents[session.agentId];
      const departmentId = agent?.departmentId ?? task?.departmentId;
      const workspace = workspaces?.find((known) => known.id === task?.workspaceId);
      return {
        key,
        position,
        event,
        kind: kindOf(event),
        ...describe(event),
        askedAt: Date.parse(event.timestamp),
        taskId: session?.taskId,
        taskName: task === undefined ? "Unknown task" : taskTitle(task.prompt),
        agentId: agent?.id,
        agentName: agent?.name ?? "Unknown agent",
        agentColour: agent?.colour,
        departmentId,
        departmentName:
          (departmentId === undefined ? undefined : departments[departmentId]?.name) ??
          "No department",
        workspaceId: workspace?.id,
        workspaceName: workspace?.name ?? "No workspace",
        harness: session === undefined ? "Unknown AI app" : harnessName(session.options.harness),
      };
    })
    .sort(byUrgency);
}

function matchesType(kind: AskKind, type: TypeFilter): boolean {
  if (type === "all") return true;
  if (type === "decisions") return kind === "plan" || kind === "team";
  return kind === type;
}

// Every filter but the type, so the type chips can count what the others leave.
export function filterAsks(asks: readonly Ask[], filters: Filters): Ask[] {
  const query = filters.query.trim().toLowerCase();
  return asks.filter(
    (ask) =>
      (filters.departmentId === undefined || ask.departmentId === filters.departmentId) &&
      (filters.workspaceId === undefined || ask.workspaceId === filters.workspaceId) &&
      (filters.harness === undefined || ask.harness === filters.harness) &&
      (filters.askedBefore === undefined || ask.askedAt < filters.askedBefore) &&
      (query === "" ||
        [ask.title, ask.detail, ask.taskName, ask.agentName, ask.departmentName, ask.workspaceName]
          .join("\n")
          .toLowerCase()
          .includes(query)),
  );
}

export function ofType(asks: readonly Ask[], type: TypeFilter): Ask[] {
  return asks.filter((ask) => matchesType(ask.kind, type));
}

export function typeCounts(asks: readonly Ask[]): Record<TypeFilter, number> {
  const counts: Record<TypeFilter, number> = { all: 0, decisions: 0, question: 0, approval: 0 };
  for (const ask of asks) {
    counts.all += 1;
    counts[ask.kind === "plan" || ask.kind === "team" ? "decisions" : ask.kind] += 1;
  }
  return counts;
}

const KEYS: Record<GroupBy, (ask: Ask) => { key: string; name: string; colour?: string }> = {
  task: (ask) => ({ key: ask.taskId ?? NONE, name: ask.taskName }),
  department: (ask) => ({ key: ask.departmentId ?? NONE, name: ask.departmentName }),
  workspace: (ask) => ({ key: ask.workspaceId ?? NONE, name: ask.workspaceName }),
  agent: (ask) => ({
    key: ask.agentId ?? NONE,
    name: ask.agentName,
    ...(ask.agentColour === undefined ? {} : { colour: ask.agentColour }),
  }),
  type: (ask) => ({ key: TYPE_NAME[ask.kind], name: TYPE_NAME[ask.kind] }),
};

// What a group's asks share, leaving out what it is grouped by; more than one becomes a count.
function metaOf(asks: readonly Ask[], by: GroupBy): string {
  const parts: [GroupBy | undefined, (ask: Ask) => string, string][] = [
    ["department", (ask) => ask.departmentName, "departments"],
    ["workspace", (ask) => ask.workspaceName, "workspaces"],
    [undefined, (ask) => ask.harness, "AI apps"],
  ];
  return parts
    .filter(([dimension]) => dimension !== by)
    .map(([, read, plural]) => {
      const values = new Set(asks.map(read));
      return values.size === 1 ? [...values][0] : `${values.size} ${plural}`;
    })
    .join(" · ");
}

// Groups keep their asks in order of urgency; the group with the most urgent ask comes first.
export function groupAsks(asks: readonly Ask[], by: GroupBy): Group[] {
  const groups = new Map<string, Group>();
  for (const ask of [...asks].sort(byUrgency)) {
    const { key, name, colour } = KEYS[by](ask);
    const group = groups.get(key) ?? {
      key,
      name,
      colour,
      meta: "",
      asks: [],
      approvals: [],
      oldestAt: ask.askedAt,
    };
    group.asks.push(ask);
    if (ask.kind === "approval") group.approvals.push(ask);
    group.oldestAt = Math.min(group.oldestAt, ask.askedAt);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, meta: metaOf(group.asks, by) }));
}

// "4m", "1h 48m", "2d 3h".
export function waitedFor(askedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - askedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}
