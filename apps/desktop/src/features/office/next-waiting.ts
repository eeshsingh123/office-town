import type { SessionRecord } from "@office-town/contract";
import type { WaitingRequest } from "../../store/records.ts";

// The one asking longest first.
export function waitingOrder(
  waiting: Record<string, WaitingRequest>,
  sessions: Record<string, SessionRecord>,
): string[] {
  const oldest = new Map<string, number>();
  for (const { position, event } of Object.values(waiting)) {
    const agentId = sessions[event.sessionId]?.agentId;
    if (agentId === undefined) continue;
    oldest.set(agentId, Math.min(position, oldest.get(agentId) ?? position));
  }
  return [...oldest].sort((a, b) => a[1] - b[1]).map(([agentId]) => agentId);
}

// The one after `current`, back to the first after the last; the first if `current` no longer waits.
export function nextWaiting(order: readonly string[], current: string | undefined) {
  if (order.length === 0) return undefined;
  const index = current === undefined ? -1 : order.indexOf(current);
  return order[(index + 1) % order.length];
}
