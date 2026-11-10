import type { DelegationRecord, MilestoneRecord } from "@office-town/contract";
import { useEffect, useMemo } from "react";
import { api } from "../api/client.ts";
import { useApp } from "./app-store.ts";

const byId = <T extends { id: string }>(records: readonly T[]) =>
  Object.fromEntries(records.map((record) => [record.id, record]));

// Read once the task is shown; changes come on the live stream. An ended task's parts are not
// loaded at launch, so they are read here too.
export function useLoadProgress(taskId: string): void {
  useEffect(() => {
    api
      .listMilestones(taskId)
      .then((read) =>
        useApp.setState((state) => ({ milestones: { ...state.milestones, ...byId(read) } })),
      )
      .catch(() => {
        // Progress shows what it has until the next read works.
      });
    api
      .listDelegations(taskId)
      .then((read) =>
        useApp.setState((state) => ({ delegations: { ...state.delegations, ...byId(read) } })),
      )
      .catch(() => {
        // Progress shows what it has until the next read works.
      });
  }, [taskId]);
}

export function useMilestones(taskId: string): MilestoneRecord[] {
  const all = useApp((state) => state.milestones);
  return useMemo(
    () =>
      Object.values(all)
        .filter((milestone) => milestone.taskId === taskId)
        .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1))),
    [all, taskId],
  );
}

export function useParts(taskId: string): DelegationRecord[] {
  const all = useApp((state) => state.delegations);
  return useMemo(() => {
    const parts = Object.values(all)
      .filter((delegation) => delegation.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // A retry ends the failed part and carries it on in a new one (D-77): that one stands for it.
    return parts.filter(
      (part, index) =>
        part.status !== "failed" ||
        !parts
          .slice(index + 1)
          .some(
            (later) => later.workerAgentId === part.workerAgentId && later.brief === part.brief,
          ),
    );
  }, [all, taskId]);
}
