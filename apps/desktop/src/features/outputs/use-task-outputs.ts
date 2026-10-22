import type { OutputRecord, TaskOutputs } from "@office-town/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";

// Changed files and sites only show on a read, so one runs this often while agents work.
const REREAD_MS = 15_000;

// A task's results, newest first, from the live store.
export function useResults(taskId: string): OutputRecord[] {
  const outputs = useApp((state) => state.outputs);
  return useMemo(
    () =>
      Object.values(outputs)
        .filter((output) => output.taskId === taskId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [outputs, taskId],
  );
}

export function useTaskOutputs(taskId: string) {
  const results = useResults(taskId);
  const working = useApp((state) =>
    (state.tasks[taskId]?.sessionIds ?? []).some((id) => {
      const session = state.sessions[id];
      return session !== undefined && isOpen(session);
    }),
  );
  const [outputs, setOutputs] = useState<TaskOutputs>();
  const [failed, setFailed] = useState(false);
  const read = useCallback(() => {
    api
      .taskOutputs(taskId)
      .then((read) => {
        setOutputs(read);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [taskId]);
  // Again whenever a result is shown or changes.
  const shownAt = results[0]?.updatedAt;
  useEffect(() => {
    void shownAt;
    read();
  }, [read, shownAt]);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, REREAD_MS);
    return () => clearInterval(timer);
  }, [read, working]);
  return { results, outputs, failed, read };
}
