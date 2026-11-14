import { DropdownMenu } from "radix-ui";
import { type Agent, stateOf } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import menu from "../../ui/Menu.module.css";
import { STATE_LABELS, StatusIcon } from "../../ui/StatusIcon.tsx";
import { selectAgent } from "../office/office-state.ts";
import styles from "./Usage.module.css";

const STACKED = 3;

// Who uses an account: a few faces and a count, opening the list; each row opens the agent.
export function AgentsCell({
  users,
  label,
  asButton = false,
}: {
  users: readonly Agent[];
  label: string;
  // A banner's button, "2 agents", instead of the table's faces.
  asButton?: boolean;
}) {
  const traces = useApp((state) => state.traces);
  const departments = useApp((state) => state.departments);
  if (users.length === 0) return <span className={styles.muted}>None</span>;
  const count = users.length === 1 ? "1 agent" : `${users.length} agents`;
  return (
    <DropdownMenu.Root>
      {asButton ? (
        <DropdownMenu.Trigger asChild>
          <Button>Show {count}</Button>
        </DropdownMenu.Trigger>
      ) : (
        <DropdownMenu.Trigger className={styles.agents} aria-label={`${count} on ${label}`}>
          <span className={styles.stack}>
            {users.slice(0, STACKED).map((agent) => (
              <Avatar key={agent.id} name={agent.name} colour={agent.colour} size={22} />
            ))}
          </span>
          {users.length > STACKED ? `+${users.length - STACKED}` : null}
        </DropdownMenu.Trigger>
      )}
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={`${menu.surface} ${styles.agentList}`} align="end">
          <DropdownMenu.Label className={menu.label}>{label}</DropdownMenu.Label>
          {users.map((agent) => {
            const state = stateOf(agent, traces, false);
            const departmentId = agent.record.departmentId;
            const team =
              departmentId === undefined
                ? "Assistant"
                : (departments[departmentId]?.name ?? "A team");
            return (
              <DropdownMenu.Item
                key={agent.id}
                className={menu.item}
                onSelect={() => selectAgent(agent.id)}
              >
                <Avatar name={agent.name} colour={agent.colour} size={22} />
                <span className={menu.itemText}>
                  {agent.name}
                  <span className={menu.itemDescription}>{team}</span>
                </span>
                <span className={styles.agentState}>
                  <StatusIcon state={state} size={12} />
                  {STATE_LABELS[state]}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
