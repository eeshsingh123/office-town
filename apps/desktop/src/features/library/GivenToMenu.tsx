import type { Audience, LibraryItem } from "@office-town/contract";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import menu from "../../ui/Menu.module.css";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./Library.module.css";
import { audienceNames, EVERYONE, givenToSomeone, type Holder, withHolder } from "./library.ts";

// The departments that work in the workspace, or every one, each with its members.
export function useHolders(workspaceId?: string) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  return Object.values(departments)
    .filter(
      (department) => workspaceId === undefined || department.workspaceIds.includes(workspaceId),
    )
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

async function change(item: LibraryItem, givenTo: Audience): Promise<void> {
  try {
    await api.changeLibraryItem(item.id, { givenTo });
  } catch (failure) {
    showToast(failure instanceof Error ? failure.message : String(failure));
  }
}

export function GivenToMenu({ item }: { item: LibraryItem }) {
  const holders = useHolders(item.workspaceId);
  return (
    <AudienceMenu
      audience={item.givenTo}
      holders={holders}
      onChange={(givenTo) => void change(item, givenTo)}
      everyone="Every agent working in this workspace"
      empty="No department works in this workspace yet."
      label="Given to"
    />
  );
}

interface AudienceMenuProps {
  audience: Audience;
  holders: ReturnType<typeof useHolders>;
  onChange: (audience: Audience) => void;
  // What Everyone covers, and what shows when there is no one to pick.
  everyone: string;
  empty: string;
  label: string;
  // Shown on the chip in place of the names, such as "Mixed".
  summary?: string;
}

// "Everyone", one or two names, or how many of each.
function summaryOf(
  audience: Audience,
  departments: Record<string, { name: string }>,
  names: string,
) {
  if (audience.everyone) return "Everyone";
  const teams = audience.departmentIds.filter((id) => departments[id] !== undefined).length;
  const people = audience.agentIds.length;
  if (teams + people <= 2) return names;
  const parts = [
    teams === 0 ? "" : `${teams} ${teams === 1 ? "department" : "departments"}`,
    people === 0 ? "" : `${people} ${people === 1 ? "agent" : "agents"}`,
  ];
  return parts.filter((part) => part !== "").join(", ");
}

// Ticks stay open, so several can be given at once; the last one cannot be taken away. Members
// show under their department once searched for or picked, so a long team list stays short.
export function AudienceMenu({
  audience: givenTo,
  holders,
  onChange,
  everyone,
  empty,
  label: purpose,
  summary,
}: AudienceMenuProps) {
  const departments = useApp((state) => state.departments);
  const agents = useApp((state) => state.agents);
  const [query, setQuery] = useState("");
  const label =
    summary ?? summaryOf(givenTo, departments, audienceNames(givenTo, departments, agents));
  const toggle = (holder: Holder, on: boolean) => {
    const next = withHolder(givenTo, holder, on);
    if (givenToSomeone(next)) onChange(next);
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
      <span className={`${styles.box} ${checked ? styles.boxOn : ""}`} aria-hidden>
        {checked ? <Check size={11} /> : null}
      </span>
      {label}
    </DropdownMenu.CheckboxItem>
  );
  const searching = holders.length > 3;
  const words = query.trim().toLowerCase();
  const shown = holders.flatMap(({ department, members }) => {
    const teamMatches = department.name.toLowerCase().includes(words);
    const found = members.filter((agent) =>
      words === ""
        ? !searching || (!givenTo.everyone && givenTo.agentIds.includes(agent.id))
        : agent.name.toLowerCase().includes(words),
    );
    return teamMatches || found.length > 0 ? [{ department, members: found }] : [];
  });
  return (
    <DropdownMenu.Root onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <DropdownMenu.Trigger
        className={`${menu.chip} ${styles.givenTo}`}
        aria-label={`${purpose} ${label}. Change`}
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
          {searching ? (
            <input
              className={styles.menuSearch}
              type="search"
              value={query}
              placeholder="Search teams and agents"
              aria-label="Search teams and agents"
              onChange={(event) => setQuery(event.target.value)}
              // The menu's own letter keys would move the focus away from the box.
              onKeyDown={(event) => event.stopPropagation()}
            />
          ) : null}
          <DropdownMenu.CheckboxItem
            className={menu.item}
            checked={givenTo.everyone}
            disabled={givenTo.everyone}
            onCheckedChange={() => onChange(EVERYONE)}
          >
            <span className={`${styles.box} ${givenTo.everyone ? styles.boxOn : ""}`} aria-hidden>
              {givenTo.everyone ? <Check size={11} /> : null}
            </span>
            <span className={menu.itemText}>
              Everyone
              <span className={menu.itemDescription}>{everyone}</span>
            </span>
          </DropdownMenu.CheckboxItem>
          {shown.map(({ department, members }) => (
            <DropdownMenu.Group key={department.id}>
              {tick(
                department.id,
                { departmentId: department.id },
                !givenTo.everyone && givenTo.departmentIds.includes(department.id),
                <>
                  <Avatar
                    name={department.name}
                    colour={agents[department.leadAgentId]?.colour ?? "var(--text-3)"}
                    size={18}
                  />
                  <span className={menu.itemText}>{department.name}</span>
                </>,
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
          {holders.length === 0 ? <p className={styles.menuNote}>{empty}</p> : null}
          {holders.length > 0 && shown.length === 0 ? (
            <p className={styles.menuNote}>No team or agent matches.</p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
