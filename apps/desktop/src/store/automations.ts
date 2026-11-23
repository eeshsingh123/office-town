import type { AutomationRecord, AutomationRun } from "@office-town/contract";
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";
import { onChange } from "./live.ts";

interface Automations {
  // Undefined until read.
  byId: Record<string, AutomationRecord> | undefined;
  // The latest change to each run, so a run page updates live.
  runs: Record<string, AutomationRun>;
}

export const useAutomationStore = create<Automations>(() => ({ byId: undefined, runs: {} }));

let loading: Promise<void> | undefined;
let following = false;

function follow(): void {
  if (following) return;
  following = true;
  onChange((change) => {
    const { byId, runs } = useAutomationStore.getState();
    if (change.type === "automation" && byId !== undefined) {
      useAutomationStore.setState({ byId: { ...byId, [change.automation.id]: change.automation } });
    } else if (change.type === "automation.removed" && byId !== undefined) {
      const { [change.automationId]: _, ...rest } = byId;
      useAutomationStore.setState({ byId: rest });
    } else if (change.type === "run") {
      useAutomationStore.setState({ runs: { ...runs, [change.run.id]: change.run } });
    }
  });
}

export function loadAutomations(): Promise<void> {
  follow();
  loading ??= api
    .listAutomations()
    .then((list) =>
      useAutomationStore.setState({ byId: Object.fromEntries(list.map((one) => [one.id, one])) }),
    )
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

// Changes missed while the core was away are read again once it is back.
let stale = true;
useApp.subscribe((state) => {
  if (state.connection !== "live") stale = true;
});

// Read once the core is live, again after it comes back, then kept by its changes.
export function useAutomations(): AutomationRecord[] | undefined {
  const byId = useAutomationStore((state) => state.byId);
  const live = useApp((state) => state.connection === "live");
  useEffect(() => {
    if (!live || !stale) return;
    stale = false;
    loadAutomations().catch((failure: unknown) => {
      stale = true;
      console.error("Could not read the automations.", failure);
    });
  }, [live]);
  return byId === undefined
    ? undefined
    : Object.values(byId).toSorted((a, b) => a.name.localeCompare(b.name));
}

export function useAutomation(id: string): AutomationRecord | undefined {
  useAutomations();
  return useAutomationStore((state) => state.byId?.[id]);
}

export function keepAutomation(automation: AutomationRecord): void {
  const { byId } = useAutomationStore.getState();
  useAutomationStore.setState({ byId: { ...byId, [automation.id]: automation } });
}
