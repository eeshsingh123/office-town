import type {
  Account,
  AccountLimits,
  AgentRecord,
  DelegationRecord,
  DepartmentRecord,
  HarnessDescription,
  LibraryItem,
  PlanPiece,
  ProfileRecord,
  RoomPosition,
  UserProfile,
  WorkspaceRecord,
} from "@office-town/contract";
import { create } from "zustand";
import type { StreamStatus } from "../api/event-stream.ts";
import type { Trace } from "../trace/trace.ts";
import type { Records } from "./records.ts";

// The office may open with a department's room in view.
export type View =
  | { name: "home" }
  | { name: "office"; room?: string }
  // Home's composer hands over what was typed and who it was for.
  | {
      name: "new-task";
      prompt?: string;
      who?: "one" | "team" | "chief";
      departmentId?: string;
      // Fills the form in from this template.
      templateId?: string;
    }
  // Home's box hands over a description to draft at once.
  | { name: "new-department"; describe?: string }
  | { name: "team" }
  // Set up or edit the chief; once it exists, its page.
  | { name: "chief"; edit?: boolean }
  | { name: "needs-you" }
  | { name: "tasks" }
  | { name: "templates" }
  | { name: "workspaces" }
  | { name: "usage" }
  | { name: "workspace"; workspaceId: string; tab?: "library" }
  | { name: "you" }
  // `member` opens that agent in the team editor, or "new" adds one.
  | { name: "department"; departmentId: string; member?: string }
  | { name: "task"; taskId: string };

// A screen to go back to, with the office selection it had.
export interface Visit {
  view: View;
  selection: string[];
}

export interface AppState extends Records {
  connection: StreamStatus;
  harnesses: HarnessDescription[];
  agents: Record<string, AgentRecord>;
  departments: Record<string, DepartmentRecord>;
  // Of every team task that has not ended, and each one made since.
  delegations: Record<string, DelegationRecord>;
  // Of every chief goal that has not ended, and each piece made since.
  pieces: Record<string, PlanPiece>;
  // By account id.
  limits: Record<string, AccountLimits>;
  // The default logins first, then the ones the user added (D-61).
  accounts: Account[];
  // Loaded for every agent at work and for each session the user opens (D-37).
  traces: Record<string, Trace>;
  traceErrors: Record<string, string>;
  // The cursor of the next page of older tasks, while there is one.
  olderTasks: string | undefined;
  view: View;
  // Kept while the user looks at a trace.
  selection: string[];
  // Memory only: a restart starts on Home.
  back: Visit[];
  forward: Visit[];
  chiefId: string | undefined;
  // `at` makes a repeat count.
  focus: { agentId: string; at: number } | undefined;
  // By department id or "chief".
  roomPositions: Record<string, RoomPosition>;
  // The user's own profile; undefined until they save one.
  you: UserProfile | undefined;
  // Saved templates, by name; undefined until loaded.
  templates: ProfileRecord[] | undefined;
  // Most recently used first; undefined until loaded.
  workspaces: WorkspaceRecord[] | undefined;
  // Every workspace's reference files, by id.
  library: Record<string, LibraryItem>;
}

export const useApp = create<AppState>(() => ({
  connection: "connecting",
  harnesses: [],
  agents: {},
  departments: {},
  delegations: {},
  pieces: {},
  limits: {},
  accounts: [],
  tasks: {},
  sessions: {},
  waiting: {},
  traces: {},
  traceErrors: {},
  olderTasks: undefined,
  view: { name: "home" },
  selection: [],
  back: [],
  forward: [],
  chiefId: undefined,
  focus: undefined,
  roomPositions: {},
  you: undefined,
  templates: undefined,
  workspaces: undefined,
  library: {},
}));

export function focusAgent(agentId: string | undefined): void {
  useApp.setState({ focus: agentId === undefined ? undefined : { agentId, at: Date.now() } });
}

const HISTORY_LIMIT = 50;

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

// Like a browser: each new screen can be gone back to; going somewhere new drops what was ahead.
export function navigate(view: View): void {
  const { view: current, selection, back } = useApp.getState();
  if (sameView(current, view)) return;
  useApp.setState({
    view,
    back: [...back, { view: current, selection }].slice(-HISTORY_LIMIT),
    forward: [],
  });
}

export function goBack(): void {
  const { view, selection, back, forward } = useApp.getState();
  const to = back.at(-1);
  if (to === undefined) return;
  useApp.setState({
    ...to,
    back: back.slice(0, -1),
    forward: [{ view, selection }, ...forward],
  });
}

export function goForward(): void {
  const { view, selection, back, forward } = useApp.getState();
  const [to, ...rest] = forward;
  if (to === undefined) return;
  useApp.setState({ ...to, back: [...back, { view, selection }], forward: rest });
}

export function select(selection: string[]): void {
  useApp.setState({ selection });
}

export function useHarnessName(harness: string): string {
  return useApp(
    (state) => state.harnesses.find((known) => known.harness === harness)?.name ?? harness,
  );
}
