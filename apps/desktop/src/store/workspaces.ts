import type { WorkspaceRecord, WorkspaceRequest, WorkspaceUsage } from "@office-town/contract";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.ts";
import type { AgentState } from "../trace/progress.ts";
import { type Agent, agentsInTask, stateOf, useWaitingSessions } from "./agents.ts";
import { useApp } from "./app-store.ts";
import { isOpen } from "./records.ts";

export const WORKSPACE_TIP =
  "The folders your agents can read and change. Departments and tasks can share a workspace.";

const byUse = (workspaces: WorkspaceRecord[]) =>
  workspaces.toSorted((a, b) => b.usedAt.localeCompare(a.usedAt));

let loading: Promise<void> | undefined;

export function loadWorkspaces(): Promise<void> {
  loading ??= api
    .listWorkspaces()
    .then((workspaces) => useApp.setState({ workspaces: byUse(workspaces) }))
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

// Loaded once, then kept up to date by the saves below.
export function useWorkspaces(): WorkspaceRecord[] | undefined {
  const workspaces = useApp((state) => state.workspaces);
  useEffect(() => {
    if (workspaces === undefined) void loadWorkspaces();
  }, [workspaces]);
  return workspaces;
}

export async function saveWorkspace(
  id: string | undefined,
  request: WorkspaceRequest,
): Promise<WorkspaceRecord> {
  const saved =
    id === undefined ? await api.createWorkspace(request) : await api.updateWorkspace(id, request);
  const others = (useApp.getState().workspaces ?? []).filter((known) => known.id !== saved.id);
  useApp.setState({ workspaces: byUse([saved, ...others]) });
  return saved;
}

// Only takes it off the list; its folders and files stay as they are.
export async function removeWorkspace(id: string): Promise<void> {
  await api.deleteWorkspace(id);
  const left = (useApp.getState().workspaces ?? []).filter((known) => known.id !== id);
  useApp.setState({ workspaces: left });
}

export interface WorkingAgent {
  agent: Agent;
  state: AgentState;
}

// Agents at work or asking, by workspace, from the live records; an open session that finished
// its turn is not at work.
export function useWorkingNow(): Record<string, WorkingAgent[]> {
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const traces = useApp((state) => state.traces);
  const asking = useWaitingSessions();
  return useMemo(() => {
    const working: Record<string, WorkingAgent[]> = {};
    for (const { task } of Object.values(tasks)) {
      if (task.workspaceId === undefined) continue;
      for (const agent of agentsInTask({ agents, tasks, sessions }, task.id)) {
        if (!isOpen(agent.latest)) continue;
        const state = stateOf(agent, traces, asking.has(agent.latest.id));
        if (state !== "starting" && state !== "working" && state !== "waiting") continue;
        working[task.workspaceId] = [...(working[task.workspaceId] ?? []), { agent, state }];
      }
    }
    return working;
  }, [agents, tasks, sessions, traces, asking]);
}

// The last answer, so a page opened again shows it while it reads afresh.
let lastUsage: Record<string, WorkspaceUsage> | undefined;

// Read again whenever an agent starts or stops, or the list changes.
export function useWorkspaceUsage(): Record<string, WorkspaceUsage> | undefined {
  const running = useApp((state) => Object.values(state.sessions).filter(isOpen).length);
  const workspaces = useApp((state) => state.workspaces);
  const [usage, setUsage] = useState(lastUsage);
  // biome-ignore lint/correctness/useExhaustiveDependencies: these say when to read again
  useEffect(() => {
    let current = true;
    api
      .listWorkspaceUsage()
      .then((list) => {
        lastUsage = Object.fromEntries(list.map((each) => [each.workspaceId, each]));
        if (current) setUsage(lastUsage);
      })
      .catch((error: unknown) => console.warn("Could not read what uses each workspace.", error));
    return () => {
      current = false;
    };
  }, [running, workspaces]);
  return usage;
}

// The one asked for if it still exists, else Scratch, else the most recently used.
export function defaultWorkspace(
  workspaces: WorkspaceRecord[],
  workspaceId: string | undefined,
): WorkspaceRecord | undefined {
  return (
    workspaces.find((known) => known.id === workspaceId) ??
    workspaces.find((known) => known.kind === "scratch") ??
    workspaces[0]
  );
}

export const mainPath = (workspace: WorkspaceRecord) => workspace.folders[0]?.path ?? "";

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
