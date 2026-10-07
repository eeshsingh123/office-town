import type { SessionRecord } from "@office-town/contract";
import type { Store } from "./store/store.ts";

// A task whose start failed would stay "working" and keep its department busy, so it goes.
export async function startFirstAgent(
  store: Store,
  taskId: string,
  start: () => Promise<SessionRecord>,
): Promise<SessionRecord> {
  try {
    return await start();
  } catch (error) {
    if (store.listSessions(taskId).length === 0) await store.deleteTask(taskId);
    throw error;
  }
}
