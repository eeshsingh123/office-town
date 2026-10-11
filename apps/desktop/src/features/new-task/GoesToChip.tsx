import { Check, ChevronDown, Network, Plus, User, Users, UsersRound } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { navigate, useApp } from "../../store/app-store.ts";
import { taskTitle } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { teamLine } from "../departments/team-line.ts";
import styles from "./Composer.module.css";
import { CHIEF, PROPOSE, SOLO } from "./targets.ts";
import { useBusyDepartments } from "./use-targets.ts";

export function targetIcon(target: string, size = 14): ReactNode {
  if (target === SOLO) return <User size={size} aria-hidden />;
  if (target === CHIEF) return <Network size={size} aria-hidden />;
  if (target === PROPOSE) return <UsersRound size={size} aria-hidden />;
  return <Users size={size} aria-hidden />;
}

interface GoesToChipProps {
  value: string;
  // Such as "Assistant" or the department's name.
  label: string;
  hasChief: boolean;
  onChange: (target: string) => void;
}

function Item(props: { value: string; title: string; note: string; disabled?: boolean }) {
  return (
    <DropdownMenu.RadioItem
      value={props.value}
      className={menu.item}
      disabled={props.disabled ?? false}
    >
      <span className={styles.itemIcon}>{targetIcon(props.value)}</span>
      <span className={menu.itemText}>
        {props.title}
        <span className={menu.itemDescription}>{props.note}</span>
      </span>
      <DropdownMenu.ItemIndicator>
        <Check size={14} className={menu.check} aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

// Who takes the task: one assistant, a department, a new team, or the chief.
export function GoesToChip({ value, label, hasChief, onChange }: GoesToChipProps) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const busy = useBusyDepartments();
  const sorted = Object.values(departments).toSorted((a, b) => a.name.localeCompare(b.name));
  // The lead is one of the department's agents.
  const workers = (departmentId: string) =>
    Object.values(agents).filter((agent) => agent.departmentId === departmentId).length - 1;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={styles.chip} aria-label={`Goes to: ${label}`}>
        {targetIcon(value)}
        <span className={styles.chipText}>{label}</span>
        <ChevronDown size={13} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${menu.surface} ${styles.menu}`}
          align="start"
          sideOffset={6}
        >
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            <Item value={SOLO} title="An assistant" note="One agent, for quick single jobs" />
            <DropdownMenu.Label className={styles.menuHeading}>Departments</DropdownMenu.Label>
            {sorted.map((department) => {
              const busyWith = busy.get(department.id);
              return (
                <Item
                  key={department.id}
                  value={department.id}
                  title={department.name}
                  note={
                    busyWith === undefined
                      ? teamLine(workers(department.id))
                      : `Busy with "${taskTitle(busyWith)}"`
                  }
                  disabled={busyWith !== undefined}
                />
              );
            })}
            <Item
              value={PROPOSE}
              title="A new team for this task"
              note="A lead suggests who to bring in. You approve the team first."
            />
            <DropdownMenu.Label className={styles.menuHeading}>
              Across departments
            </DropdownMenu.Label>
            <Item
              value={CHIEF}
              title="Chief"
              note={
                hasChief
                  ? "Plans big goals across departments. You approve the plan first."
                  : "Not set up yet"
              }
            />
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className={styles.separator} />
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => navigate({ name: "new-department" })}
          >
            <span className={styles.itemIcon}>
              <Plus size={14} aria-hidden />
            </span>
            Build a department
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
