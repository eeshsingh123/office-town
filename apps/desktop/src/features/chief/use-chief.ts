import { useApp } from "../../store/app-store.ts";
import { useChiefGoals } from "../work/use-chief-goals.ts";

// The chief's record and what it is doing; nothing before it is set up.
export function useChief() {
  const chiefId = useApp((state) => state.chiefId);
  const record = useApp((state) => (chiefId === undefined ? undefined : state.agents[chiefId]));
  const { current, queue } = useChiefGoals(chiefId);
  if (record === undefined) return undefined;
  const busy = current !== undefined && current.state !== "ended";
  return { record, busy, current, queue };
}
