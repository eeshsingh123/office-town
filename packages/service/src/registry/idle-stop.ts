import type { Store } from "../store/store.ts";
import type { SessionActivity } from "./activity.ts";
import type { SessionRegistry } from "./session-registry.ts";

const IDLE_MS = 10 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

// An idle harness process is held open for nothing; one waiting on the user is not idle.
export function stopIdleAgents(
  registry: SessionRegistry,
  store: Store,
  activity: SessionActivity,
  idleMs = IDLE_MS,
): () => void {
  const check = () => {
    const waiting = new Set(
      store.listPendingRequests().requests.map(({ event }) => event.sessionId),
    );
    const now = Date.now();
    for (const [sessionId, { turnOpen, lastActive }] of activity.entries()) {
      if (turnOpen || waiting.has(sessionId) || now - lastActive < idleMs) continue;
      if (!registry.isRunning(sessionId)) continue;
      registry.stop(sessionId, true).catch((error: unknown) => {
        console.error(`Could not stop the idle session ${sessionId}.`, error);
      });
    }
  };
  const timer = setInterval(check, Math.min(CHECK_EVERY_MS, idleMs));
  timer.unref();
  return () => clearInterval(timer);
}
