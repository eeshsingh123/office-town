import { createContext, useContext } from "react";

// Lets a trace item open another member's trace in the team view: a delegation opens the worker,
// a worker's brief opens its lead. Outside a team view there is nowhere to go.
export const MemberLinks = createContext<((agentId: string) => void) | undefined>(undefined);

export function useMemberLinks() {
  return useContext(MemberLinks);
}
