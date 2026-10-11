import type { Agent } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { useModelName } from "../profiles/model-line.ts";

// A solo agent's handle means nothing to the user, so a task names who works on it by its
// department, the chief's chosen name, or "Assistant · Haiku 5.5".
export function WorkerName({ agent, others = 0 }: { agent: Agent; others?: number }) {
  const departmentId = agent.record.departmentId;
  const department = useApp((state) =>
    departmentId === undefined ? undefined : state.departments[departmentId]?.name,
  );
  const chief = useApp((state) => state.chiefId === agent.id);
  const model = useModelName(agent.latest.options, agent.latest.options.model);
  const name = chief ? agent.name : (department ?? `Assistant · ${model}`);
  return <>{others === 0 ? name : `${name} and ${others} more`}</>;
}
