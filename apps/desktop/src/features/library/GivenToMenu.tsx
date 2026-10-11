import type { LibraryAudience, LibraryItem } from "@office-town/contract";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import menu from "../../ui/Menu.module.css";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./Library.module.css";
import { audienceNames, EVERYONE, givenToSomeone, type Holder, withHolder } from "./library.ts";

// The departments that work in the workspace, each with its members.
export function useHolders(workspaceId: string) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  return Object.values(departments)
    .filter((department) => department.workspaceId === workspaceId)
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((department) => ({
      department,
      members: Object.values(agents)
        .filter((agent) => agent.departmentId === department.id)
        .toSorted((a, b) =>
          a.id === department.leadAgentId ? -1 : b.id === department.leadAgentId ? 1 : 0,
        ),
    }));
}

async function change(item: LibraryItem, givenTo: LibraryAudience): Promise<void> {
  try {
    await api.changeLibraryItem(item.id, { givenTo });
  } catch (failure) {
    showToast(failure instanceof Error ? failure.message : String(failure));
  }
}

// Ticks stay open, so several can be given at once; the last one cannot be taken away.
export function GivenToMenu({ item }: { item: LibraryItem }) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const holders = useHolders(item.workspaceId);
  const { givenTo } = item;
  const label = audienceNames(givenTo, departments, agents);
  const toggle = (holder: Holder, on: boolean) => {
    const next = withHolder(givenTo, holder, on);
    if (givenToSomeone(next)) void change(item, next);
  };
  const only = (checked: boolean) =>
    checked && !givenTo.everyone && givenTo.departmentIds.length + givenTo.agentIds.length === 1;
  const tick = (key: string, holder: Holder, checked: boolean, label: ReactNode) => (
    <DropdownMenu.CheckboxItem
      key={key}
      className={`${menu.item} ${holder.agentId === undefined ? "" : styles.member}`}
      checked={checked}
      disabled={only(checked)}
      onCheckedChange={(on) => toggle(holder, on)}
      onSelect={(event) => event.preventDefault()}
    >
      {label}
      <DropdownMenu.ItemIndicator>
        <Check size={14} className={menu.check} aria-hidden />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.CheckboxItem>
  );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={`${menu.chip} ${styles.givenTo}`}
        aria-label={`Given to ${label}. Change`}
      >
        <span className={styles.givenToText}>{label}</span>
        <ChevronDown size={13} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${menu.surface} ${styles.menu}`}
          align="start"
          sideOffset={4}
        >
          <DropdownMenu.CheckboxItem
            className={menu.item}
            checked={givenTo.everyone}
            disabled={givenTo.everyone}
            onCheckedChange={() => void change(item, EVERYONE)}
          >
            <span className={menu.itemText}>
              Everyone
              <span className={menu.itemDescription}>Every agent working in this workspace</span>
            </span>
            <DropdownMenu.ItemIndicator>
              <Check size={14} className={menu.check} aria-hidden />
            </DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
          {holders.map(({ department, members }) => (
            <DropdownMenu.Group key={department.id}>
              <DropdownMenu.Separator className={styles.separator} />
              {tick(
                department.id,
                { departmentId: department.id },
                !givenTo.everyone && givenTo.departmentIds.includes(department.id),
                <span className={menu.itemText}>{department.name}</span>,
              )}
              {members.map((agent) =>
                tick(
                  agent.id,
                  { departmentId: department.id, agentId: agent.id },
                  !givenTo.everyone && givenTo.agentIds.includes(agent.id),
                  <>
                    <Avatar name={agent.name} colour={agent.colour} size={18} />
                    <span className={menu.itemText}>
                      {agent.name}
                      {agent.role === undefined ? null : (
                        <span className={menu.itemDescription}>{agent.role}</span>
                      )}
                    </span>
                  </>,
                ),
              )}
            </DropdownMenu.Group>
          ))}
          {holders.length === 0 ? (
            <p className={styles.menuNote}>No department works in this workspace yet.</p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
