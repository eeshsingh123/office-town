import type { AgentRecord } from "@office-town/contract";
import { Eye, Pin, PinOff, Square, SquareArrowOutUpRight, UserRound } from "lucide-react";
import { api } from "../../api/client.ts";
import { agentOf, stateOf } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { isOpen } from "../../store/records.ts";
import { confirmed, type MenuAction, type MenuContent, MenuHeader } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { STATE_LABELS } from "../../ui/StatusIcon.tsx";
import { ReviewDialog } from "../task/ReviewDialog.tsx";
import { pin, unpin, usePins } from "./pins.ts";

// Shared with the agent's panel, so Stop asks the same way from both.
export const stopAgentAsk = (name: string, sessionId: string) => ({
  title: `Stop ${name}?`,
  description: `${name} stops right away, even in the middle of a step. Work already done stays. Send a message to carry on later.`,
  confirmLabel: "Stop",
  run: () => api.stop(sessionId),
});

// A member that has not worked yet has no task to open, only its profile.
function newMemberMenu(record: AgentRecord | undefined): MenuContent | undefined {
  const departmentId = record?.departmentId;
  if (record === undefined || departmentId === undefined) return undefined;
  return {
    header: (
      <MenuHeader
        face={<Avatar name={record.name} colour={record.colour} size={22} />}
        title={record.name}
        detail={[record.role, "Not started"].filter(Boolean).join(" · ")}
      />
    ),
    actions: [
      {
        label: "Open profile",
        icon: UserRound,
        run: () => navigate({ name: "department", departmentId, member: record.id }),
      },
    ],
  };
}

// The same actions as the agent's panel footer, read when the menu opens.
export function agentMenu(agentId: string): MenuContent | undefined {
  const known = useApp.getState();
  const agent = agentOf(known, agentId);
  if (agent === undefined) return newMemberMenu(known.agents[agentId]);
  const { latest, name } = agent;
  const trace = known.traces[latest.id];
  const asking = Object.values(known.waiting).some((one) => one.event.sessionId === latest.id);
  const state = stateOf(agent, trace === undefined ? {} : { [latest.id]: trace }, asking);
  const pinned = usePins.getState().pinned.includes(agentId);
  const actions: MenuAction[] = [
    {
      label: "Open task",
      icon: SquareArrowOutUpRight,
      run: () => navigate({ name: "task", taskId: agent.taskId }),
    },
  ];
  if (!agent.record.guest) {
    actions.push({
      label: "Send for review",
      icon: Eye,
      dialog: (props) => <ReviewDialog agent={agent} {...props} />,
    });
  }
  actions.push({
    label: pinned ? "Unpin" : "Pin",
    icon: pinned ? PinOff : Pin,
    run: () => (pinned ? unpin([agentId]) : pin([agentId])),
  });
  if (isOpen(latest)) {
    actions.push(confirmed({ label: "Stop", icon: Square }, stopAgentAsk(name, latest.id)));
  }
  return {
    header: (
      <MenuHeader
        face={<Avatar name={name} colour={agent.colour} size={22} />}
        title={name}
        detail={[agent.record.role, STATE_LABELS[state]].filter(Boolean).join(" · ")}
      />
    ),
    actions,
  };
}
