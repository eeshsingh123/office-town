import type {
  AgentRecord,
  DelegationRecord,
  DepartmentRecord,
  HarnessDescription,
  HarnessLimits,
  PlanPiece,
  RoomPosition,
} from "@office-town/contract";
import { create } from "zustand";
import type { StreamStatus } from "../api/event-stream.ts";
import type { Trace } from "../trace/trace.ts";
import type { Records } from "./records.ts";

// The office may open with a department's room in view.
export type View =
  | { name: "office"; room?: string }
  | { name: "new-task" }
  | { name: "needs-you" }
  | { name: "tasks" }
  | { name: "profiles" }
  | { name: "department"; departmentId: string }
  | { name: "task"; taskId: string };

export interface AppState extends Records {
  connection: StreamStatus;
  harnesses: HarnessDescription[];
  agents: Record<string, AgentRecord>;
  departments: Record<string, DepartmentRecord>;
  // Of every team task that has not ended, and each one made since.
  delegations: Record<string, DelegationRecord>;
  // Of every chief goal that has not ended, and each piece made since.
  pieces: Record<string, PlanPiece>;
  // By harness.
  limits: Record<string, HarnessLimits>;
  // Loaded for every agent at work and for each session the user opens (D-37).
  traces: Record<string, Trace>;
  traceErrors: Record<string, string>;
  // The cursor of the next page of older tasks, while there is one.
  olderTasks: string | undefined;
  view: View;
  // Kept while the user looks at a trace.
  selection: string[];
  chiefId: string | undefined;
  // `at` makes a repeat count.
  focus: { agentId: string; at: number } | undefined;
  // By department id or "chief".
  roomPositions: Record<string, RoomPosition>;
}

export const useApp = create<AppState>(() => ({
  connection: "connecting",
  harnesses: [],
  agents: {},
  departments: {},
  delegations: {},
  pieces: {},
  limits: {},
  tasks: {},
  sessions: {},
  waiting: {},
  traces: {},
  traceErrors: {},
  olderTasks: undefined,
  view: { name: "office" },
  selection: [],
  chiefId: undefined,
  focus: undefined,
  roomPositions: {},
}));

export function focusAgent(agentId: string | undefined): void {
  useApp.setState({ focus: agentId === undefined ? undefined : { agentId, at: Date.now() } });
}

export function navigate(view: View): void {
  useApp.setState({ view });
}

export function select(selection: string[]): void {
  useApp.setState({ selection });
}

export function useHarnessName(harness: string): string {
  return useApp(
    (state) => state.harnesses.find((known) => known.harness === harness)?.name ?? harness,
  );
}
