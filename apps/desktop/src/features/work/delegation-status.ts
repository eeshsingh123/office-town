import type { DelegationRecord } from "@office-town/contract";
import type { ThreadState } from "../chat/chat-items.ts";

// How a delegation's status shows: its icon's state and its words. A cut-off one shows as stopped.
export const DELEGATION_STATUS: Record<
  DelegationRecord["status"],
  { state: ThreadState; label: string }
> = {
  working: { state: "working", label: "working" },
  done: { state: "done", label: "done" },
  failed: { state: "failed", label: "failed" },
  stopped: { state: "stopped", label: "stopped" },
  interrupted: { state: "stopped", label: "cut off" },
};
