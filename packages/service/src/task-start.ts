import type { SessionRecord } from "@office-town/contract";
import type { Store } from "./store/store.ts";

// A task is made to start its first agent at once. One whose start failed would stay "working"
// with nobody at work, keeping its department busy, so it goes; the error still reaches the caller.
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
