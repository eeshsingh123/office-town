import type { DepartmentRecord } from "@office-town/contract";
import { User } from "lucide-react";
import { stateOf, useAgent, useWaitingSessions } from "../../store/agents.ts";
import { navigate, useApp, useHarnessName } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChiefFooter, ChiefHeader, ChiefNow } from "../chief/ChiefOverview.tsx";
import {
  DepartmentFooter,
  DepartmentHeader,
  DepartmentNow,
} from "../departments/DepartmentPanel.tsx";
import { AgentActivity, ChiefWork, DepartmentWork } from "../work/WorkTab.tsx";
import { AgentFooter, AgentHeader, AgentNow } from "./AgentPanel.tsx";
import { AgentProfile } from "./AgentProfile.tsx";
import type { FloorAgent } from "./Floor.tsx";
import { GroupPanel } from "./GroupPanel.tsx";
import styles from "./Office.module.css";
import sideStyles from "./SidePanel.module.css";
import { PanelFrame, PanelHeader, SidePanel } from "./SidePanel.tsx";

function EmptyPanel({ count }: { count: number }) {
  return (
    <aside className={styles.panel} aria-label="Office">
      <p className={styles.empty}>
        {count === 0
          ? "No agents at work yet."
          : "Select an agent or a room, double-click to chat, or drag to select several."}
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

// The open floor holds assistants that work alone, so it starts a task for one.
function OpenFloorPanel({ working }: { working: number }) {
  return (
    <aside className={sideStyles.panel} aria-label="Open floor">
      <PanelHeader
        picture={
          <span className={styles.openPicture} aria-hidden>
            <User size={18} />
          </span>
        }
        title="Open floor"
        subtitle={
          working === 0
            ? "No assistant here"
            : `${working === 1 ? "1 assistant" : `${working} assistants`} here`
        }
      />
      <div className={sideStyles.content}>
        <p className={styles.empty}>
          An assistant works here on its own task, outside any department.
        </p>
        <div>
          <Button variant="primary" onClick={() => navigate({ name: "new-task", who: "one" })}>
            New task for an assistant
          </Button>
        </div>
      </div>
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

// A department member that has never worked: who it is and its profile, until its first task.
function FreeMemberSide({ agentId }: { agentId: string }) {
  const record = useApp((state) => state.agents[agentId]);
  const department = useApp((state) =>
    record?.departmentId === undefined ? undefined : state.departments[record.departmentId],
  );
  const harness = useHarnessName(record?.settings.harness ?? "");
  if (record === undefined) return null;
  const lead = department?.leadAgentId === record.id;
  const role = `${lead ? "Lead" : (record.role ?? "Member")}${department === undefined ? "" : ` · ${department.name}`}`;
  return (
    <SidePanel
      kind="agent"
      label={`${record.name}, selected agent`}
      header={
        <PanelHeader
          picture={<Avatar name={record.name} colour={record.colour} size={36} />}
          title={record.name}
          subtitle={`${role} · ${harness}`}
        />
      }
      chatAgentId={agentId}
      now={
        <p className={styles.empty}>
          {lead
            ? "Free. Not on a task yet. Give the department a task and it starts."
            : "Free. Not on a task yet. It starts when its lead hands it work."}
        </p>
      }
      activity={<p className={styles.empty}>Nothing done yet.</p>}
      profile={<AgentProfile key={record.id} agent={record} />}
    />
  );
}

function AgentSide({ agentId, onFloor }: { agentId: string; onFloor: FloorAgent | undefined }) {
  const member = useMember(agentId, onFloor);
  if (member === undefined) return <FreeMemberSide agentId={agentId} />;
  return (
    <SidePanel
      kind="agent"
      label={`${member.agent.name}, selected agent`}
      header={<AgentHeader member={member} />}
      chatAgentId={agentId}
      now={<AgentNow member={member} />}
      activity={<AgentActivity agent={member.agent} />}
      footer={<AgentFooter member={member} />}
      profile={
        member.agent.record.guest ? undefined : (
          <AgentProfile key={member.agent.id} agent={member.agent.record} />
        )
      }
    />
  );
}

interface OfficePanelProps {
  selection: string[];
  chosen: FloorAgent[];
  room: DepartmentRecord | undefined;
  openFloor: boolean;
  // Those working alone on the open floor.
  assistants: number;
  floorCount: number;
}

export function OfficePanel(props: OfficePanelProps) {
  return (
    <PanelFrame>
      <PanelContent {...props} />
    </PanelFrame>
  );
}

function PanelContent(props: OfficePanelProps) {
  const { selection, chosen, room, openFloor, assistants, floorCount } = props;
  const chiefId = useApp((state) => state.chiefId);
  const [single] = selection;
  if (selection.length > 1) return <GroupPanel members={chosen} />;
  if (single !== undefined && single === chiefId) {
    return (
      <SidePanel
        key={single}
        kind="chief"
        label="Chief"
        header={<ChiefHeader chiefId={single} />}
        chatAgentId={single}
        now={<ChiefNow chiefId={single} />}
        activity={<ChiefWork chiefId={single} />}
        footer={<ChiefFooter chiefId={single} />}
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
        header={<DepartmentHeader department={room} />}
        chatAgentId={room.leadAgentId}
        now={<DepartmentNow department={room} />}
        activity={<DepartmentWork department={room} />}
        footer={<DepartmentFooter department={room} />}
      />
    );
  }
  if (openFloor) return <OpenFloorPanel working={assistants} />;
  return <EmptyPanel count={floorCount} />;
}
