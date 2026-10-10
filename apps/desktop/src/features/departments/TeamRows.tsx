import type { TeamRole } from "@office-town/contract";
import { CircleUser, Lock, Plus, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useMemo } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { profileSummary } from "../../ui/format.ts";
import menu from "../../ui/Menu.module.css";
import { useLoaded } from "../../ui/use-loaded.ts";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./TeamRows.module.css";

export interface TeamRow extends TeamRole {
  // Keeps the row's identity while it is edited.
  key: number;
}

export const toRows = (roles: readonly TeamRole[]): TeamRow[] =>
  roles.map((role, key) => ({ ...role, key }));

export const toRoles = (rows: readonly TeamRow[]): TeamRole[] =>
  rows.map(({ key: _, ...role }) => role);

interface TeamRowsProps {
  rows: TeamRow[];
  onChange: (rows: TeamRow[]) => void;
  lead: { id: string; name: string; colour: string; summary: string } | undefined;
  // So members left out show as leaving.
  departmentId: string | undefined;
  defaults: ChipSettings;
}

// A worker the team already has keeps its name. The lead's row is fixed.
export function TeamRows({ rows, onChange, lead, departmentId, defaults }: TeamRowsProps) {
  const agents = useApp((state) => state.agents);
  const harnesses = useApp((state) => state.harnesses);
  const profiles = useLoaded("profiles", api.listProfiles);

  const leaving = useMemo(() => {
    const kept = new Set(rows.flatMap((row) => row.agentId ?? []));
    return Object.values(agents).filter(
      (agent) =>
        departmentId !== undefined &&
        agent.departmentId === departmentId &&
        agent.id !== lead?.id &&
        !kept.has(agent.id),
    );
  }, [agents, rows, departmentId, lead?.id]);

  const update = (key: number, change: Partial<TeamRole>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const nextKey = () => Math.max(-1, ...rows.map((row) => row.key)) + 1;

  return (
    <>
      <ul className={styles.roles} aria-label="Team">
        {lead === undefined ? null : (
          <li className={styles.role}>
            <div className={styles.who}>
              <Avatar name={lead.name} colour={lead.colour} size={26} />
              <span>
                <strong>Lead</strong>
                <span className={styles.hint}>{lead.name}</span>
              </span>
            </div>
            <span className={styles.hint}>Plans, hands out the work, and puts it together</span>
            <span className={styles.locked}>
              {lead.summary}
              <Lock size={13} aria-label="The lead is fixed" />
            </span>
          </li>
        )}
        {rows.map((row) => {
          const member = row.agentId === undefined ? undefined : agents[row.agentId];
          const profile = profiles.value?.find((known) => known.id === row.profileId);
          return (
            <li key={row.key} className={styles.role}>
              <div className={styles.texts}>
                <input
                  className={styles.input}
                  aria-label="Role"
                  placeholder="Role"
                  value={row.role}
                  onChange={(change) => update(row.key, { role: change.target.value })}
                />
                <input
                  className={styles.input}
                  aria-label="What they do"
                  placeholder="What they do"
                  value={row.purpose}
                  onChange={(change) => update(row.key, { purpose: change.target.value })}
                />
                {member === undefined ? null : (
                  <span className={styles.hint}>Keeps {member.name}</span>
                )}
              </div>
              <div className={styles.chips}>
                {row.settings === undefined ? (
                  <span className={styles.hint}>
                    Saved assistant {profile?.name ?? ""}
                    {profile === undefined ? "" : ` · ${profileSummary(profile, harnesses)}`}
                  </span>
                ) : (
                  <SettingsChips
                    value={row.settings}
                    onChange={(settings) => update(row.key, { settings })}
                  />
                )}
              </div>
              <Button
                variant="ghost"
                icon
                aria-label={`Remove ${row.role || "this role"}`}
                onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
              >
                <X size={14} aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
      {leaving.length === 0 ? null : (
        <p className={styles.hint}>
          Leaves the team: {leaving.map((agent) => agent.name).join(", ")}
        </p>
      )}
      <div className={styles.add}>
        <Button
          onClick={() =>
            onChange([...rows, { key: nextKey(), role: "", purpose: "", settings: defaults }])
          }
        >
          <Plus size={14} aria-hidden />
          Add someone
        </Button>
        {(profiles.value ?? []).length === 0 ? null : (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button>
                <CircleUser size={14} aria-hidden />
                Add a saved assistant
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menu.surface} align="start" sideOffset={4}>
                {(profiles.value ?? []).map((profile) => (
                  <DropdownMenu.Item
                    key={profile.id}
                    className={menu.item}
                    onSelect={() =>
                      onChange([
                        ...rows,
                        {
                          key: nextKey(),
                          role: profile.name,
                          purpose: profile.role,
                          profileId: profile.id,
                        },
                      ])
                    }
                  >
                    <span className={menu.itemText}>
                      {profile.name}
                      <span className={menu.itemDescription}>
                        {profileSummary(profile, harnesses)}
                      </span>
                    </span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
        <span className={styles.hint}>Each person can use a different AI app and model.</span>
      </div>
    </>
  );
}
