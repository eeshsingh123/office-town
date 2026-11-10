import { useEffect } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { showToast } from "../../ui/Toast.tsx";

// A part with every milestone met is done at once; the user hears it here and nothing waits on
// them (owner). Only parts that become done while the app watches, so a restart repeats none.
export function usePartNotices(): void {
  useEffect(
    () =>
      useApp.subscribe((state, before) => {
        if (state.delegations === before.delegations) return;
        for (const part of Object.values(state.delegations)) {
          const earlier = before.delegations[part.id];
          // Read for a task just opened is not news.
          if (part.accepted !== "new" || earlier === undefined || earlier.accepted === "new") {
            continue;
          }
          const worker = state.agents[part.workerAgentId]?.name ?? "A worker";
          const count = Object.values(state.milestones).filter(
            (milestone) => milestone.delegationId === part.id,
          ).length;
          const what =
            part.title === undefined ? `${worker}'s part` : `${worker}'s "${part.title}"`;
          const met = count === 1 ? "its milestone is met" : `all ${count} milestones met`;
          showToast(`${what} is done: ${met}.`, {
            label: "Open",
            run: () => navigate({ name: "task", taskId: part.taskId }),
          });
        }
      }),
    [],
  );
}
