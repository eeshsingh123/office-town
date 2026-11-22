import type { AutomationRecord, AutomationRun } from "@office-town/contract";
import type { Store } from "../store/store.ts";

const safeName = (name: string) => name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Automation";

// A finished run's last words as a file in its workspace's Library, given to everyone there.
// A chief's goal has no workspace, so it keeps none.
export function saveResult(
  store: Store,
  automation: AutomationRecord,
  run: AutomationRun,
  result: string,
): void {
  if (result.trim() === "" || run.taskId === undefined) return;
  const workspaceId = store.getTask(run.taskId)?.workspaceId;
  if (workspaceId === undefined) return;
  const day = run.scheduledFor.slice(0, 10);
  const name = `${safeName(automation.name)} run ${run.number} ${day}.md`;
  const file = store.saveFile({ kind: "file", name, content: Buffer.from(`${result.trim()}\n`) });
  store.addLibraryItem({
    workspaceId,
    attachmentId: file.id,
    givenTo: { everyone: true, departmentIds: [], agentIds: [] },
  });
}
