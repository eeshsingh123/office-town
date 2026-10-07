import { createContext, useContext } from "react";

// Outside a team view there is nowhere to go.
export const MemberLinks = createContext<((agentId: string) => void) | undefined>(undefined);

export function useMemberLinks() {
  return useContext(MemberLinks);
}
