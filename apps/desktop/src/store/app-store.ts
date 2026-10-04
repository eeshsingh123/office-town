import { create } from "zustand";
import type { StreamStatus } from "../api/event-stream.ts";
import type { Trace } from "../trace/trace.ts";
import type { Records } from "./records.ts";

export type View =
  | { name: "office" }
  | { name: "new-task" }
  | { name: "needs-you" }
  | { name: "tasks" }
  | { name: "task"; taskId: string };

export interface AppState extends Records {
  connection: StreamStatus;
  // Loaded for every agent at work and for each session the user opens (D-37).
  traces: Record<string, Trace>;
  traceErrors: Record<string, string>;
  // The cursor of the next page of older tasks, while there is one.
  olderTasks: string | undefined;
  view: View;
}

export const useApp = create<AppState>(() => ({
  connection: "connecting",
  tasks: {},
  sessions: {},
  waiting: {},
  traces: {},
  traceErrors: {},
  olderTasks: undefined,
  view: { name: "office" },
}));

export function navigate(view: View): void {
  useApp.setState({ view });
}
