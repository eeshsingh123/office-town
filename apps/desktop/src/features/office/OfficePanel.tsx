import type { DepartmentRecord } from "@office-town/contract";
import { stateOf, useAgent, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ChiefOverview } from "../chief/ChiefOverview.tsx";
import { DepartmentPanel } from "../departments/DepartmentPanel.tsx";
import { AgentWork, ChiefWork, DepartmentWork } from "../work/WorkTab.tsx";
import { AgentPanel } from "./AgentPanel.tsx";
import type { FloorAgent } from "./Floor.tsx";
import { GroupPanel } from "./GroupPanel.tsx";
import styles from "./Office.module.css";
import { SidePanel } from "./SidePanel.tsx";

function EmptyPanel({ count }: { count: number }) {
  return (
    <aside className={styles.panel} aria-label="Office">
      <p className={styles.empty}>
        {count === 0
          ? "No agent is at work today. Start a task and its agent takes a desk here."
          : "Click an agent or a room's sign, walk up to one and press E, or drag a box around several."}
      </p>
      {count === 0 ? (
        <div>
          <Button variant="primary" onClick={() => navigate({ name: "new-task" })}>
            New task
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

// An agent picked away from the floor, such as from the board, whose desk is not shown today.
function useMember(agentId: string, onFloor: FloorAgent | undefined): FloorAgent | undefined {
  const agent = useAgent(agentId);
  const traces = useApp((state) => state.traces);
  const waiting = useWaitingSessions();
  const harness = useHarnessName(agent?.latest.options.harness ?? "");
  if (onFloor !== undefined || agent === undefined) return onFloor;
  const state = stateOf(agent, traces, waiting.has(agent.latest.id));
  return { agent, state, harness, position: { x: 0, y: 0 }, group: "" };
}

function AgentSide({ agentId, onFloor }: { agentId: string; onFloor: FloorAgent | undefined }) {
  const member = useMember(agentId, onFloor);
  if (member === undefined) return null;
  return (
    <SidePanel
      kind="agent"
      label={`${member.agent.name}, selected agent`}
      chatAgentId={agentId}
      overview={<AgentPanel member={member} />}
      work={<AgentWork agent={member.agent} />}
    />
  );
}

interface OfficePanelProps {
  selection: string[];
  // The selected agents that sit on the floor.
  chosen: FloorAgent[];
  room: DepartmentRecord | undefined;
  floorCount: number;
}

// The right panel for what is selected: the chief, an agent, several agents or a room (D-49).
export function OfficePanel({ selection, chosen, room, floorCount }: OfficePanelProps) {
  const chiefId = useApp((state) => state.chiefId);
  const [single] = selection;
  if (selection.length > 1) return <GroupPanel members={chosen} />;
  if (single !== undefined && single === chiefId) {
    return (
      <SidePanel
        key={single}
        kind="chief"
        label="Chief"
        chatAgentId={single}
        overview={<ChiefOverview chiefId={single} />}
        work={<ChiefWork chiefId={single} />}
      />
    );
  }
  if (single !== undefined) return <AgentSide key={single} agentId={single} onFloor={chosen[0]} />;
  if (room !== undefined) {
    return (
      <SidePanel
        key={room.id}
        kind="department"
        label={`${room.name}, department`}
        chatAgentId={room.leadAgentId}
        overview={<DepartmentPanel department={room} />}
        work={<DepartmentWork department={room} />}
      />
    );
  }
  return <EmptyPanel count={floorCount} />;
}
