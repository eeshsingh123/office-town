import type { WorkspaceRecord, WorkspaceRequest, WorkspaceUsage } from "@office-town/contract";
import { useEffect, useState } from "react";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";
import { isOpen } from "./records.ts";

export const WORKSPACE_TIP =
  "A workspace is where your agents work: the folders they can open, read and change. Departments and tasks can share one.";

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

// Read again whenever an agent starts or stops, or the list changes; the last answer stays shown
// meanwhile.
export function useWorkspaceUsage(): Record<string, WorkspaceUsage> | undefined {
  const running = useApp((state) => Object.values(state.sessions).filter(isOpen).length);
  const workspaces = useApp((state) => state.workspaces);
  const [usage, setUsage] = useState<Record<string, WorkspaceUsage>>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: these say when to read again
  useEffect(() => {
    let current = true;
    api
      .listWorkspaceUsage()
      .then((list) => {
        if (current) setUsage(Object.fromEntries(list.map((each) => [each.workspaceId, each])));
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
