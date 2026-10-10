import type { AgentRecord, ProfileRecord, TeamRole } from "@office-town/contract";
import { Lock, MoreHorizontal, Plus, X } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { useMemo, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { useTemplates } from "../../store/templates.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import menu from "../../ui/Menu.module.css";
import { AgentProfileDialog } from "../office/AgentProfile.tsx";
import { SaveTemplateDialog, type TemplateSource } from "../profiles/SaveTemplateDialog.tsx";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import { TemplatePicker } from "../profiles/TemplatePicker.tsx";
import styles from "./TeamRows.module.css";

export interface TeamRow extends TeamRole {
  // Keeps the row's identity while it is edited.
  key: number;
}

export const toRows = (roles: readonly TeamRole[]): TeamRow[] =>
  roles.map((role, key) => ({ ...role, key }));

export const toRoles = (rows: readonly TeamRow[]): TeamRole[] =>
  rows.map(({ key: _, ...role }) => role);

// The AI choices a template fills in; its notes come with it through its id.
function chipsOf(template: ProfileRecord): ChipSettings {
  const { instructions: _, autonomy: __, ...settings } = template.settings;
  return settings;
}

interface TeamRowsProps {
  rows: TeamRow[];
  onChange: (rows: TeamRow[]) => void;
  lead: { id: string; name: string; colour: string; summary: string } | undefined;
  // So members left out show as leaving.
  departmentId: string | undefined;
  defaults: ChipSettings;
}

type Opened =
  | { kind: "profile"; agent: AgentRecord }
  | { kind: "template"; source: TemplateSource }
  | undefined;

function RowMenu({
  label,
  agent,
  onOpen,
  source,
}: {
  label: string;
  agent: AgentRecord | undefined;
  onOpen: (opened: Opened) => void;
  source: TemplateSource;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" icon aria-label={`More for ${label}`}>
          <MoreHorizontal size={14} aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
          {agent === undefined ? null : (
            <DropdownMenu.Item
              className={menu.item}
              onSelect={() => onOpen({ kind: "profile", agent })}
            >
              Open profile
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            className={menu.item}
            onSelect={() => onOpen({ kind: "template", source })}
          >
            Save as template
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// A worker the team already has keeps its name. The lead's row is fixed.
export function TeamRows({ rows, onChange, lead, departmentId, defaults }: TeamRowsProps) {
  const agents = useApp((state) => state.agents);
  const templates = useTemplates() ?? [];
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState<Opened>();

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
  const add = (template: ProfileRecord | undefined) => {
    setAdding(false);
    onChange([
      ...rows,
      template === undefined
        ? { key: nextKey(), role: "", purpose: "", settings: defaults }
        : {
            key: nextKey(),
            role: template.name,
            purpose: template.role,
            profileId: template.id,
            settings: chipsOf(template),
          },
    ]);
  };
  const sourceOf = (row: TeamRow, member: AgentRecord | undefined): TemplateSource => ({
    who: member?.name ?? (row.role || "this team member"),
    name: row.role,
    job: row.purpose,
    colour: member?.colour ?? "#3A6EA5",
    settings: {
      ...(member === undefined ? {} : member.settings),
      ...(row.settings ?? defaults),
    },
  });
  const leadAgent = lead === undefined ? undefined : agents[lead.id];

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
              <Lock size={13} aria-label="The lead stays the lead" />
              {leadAgent === undefined ? null : (
                <RowMenu
                  label={lead.name}
                  agent={leadAgent}
                  onOpen={setOpened}
                  source={{
                    who: leadAgent.name,
                    name: "",
                    job: leadAgent.purpose ?? "",
                    colour: leadAgent.colour,
                    settings: leadAgent.settings,
                  }}
                />
              )}
            </span>
          </li>
        )}
        {rows.map((row) => {
          const member = row.agentId === undefined ? undefined : agents[row.agentId];
          const template =
            row.agentId === undefined
              ? templates.find((known) => known.id === row.profileId)
              : undefined;
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
                {template === undefined ? null : (
                  <span className={styles.hint}>
                    Filled in from {template.name}. Changing this won't change the template.
                  </span>
                )}
              </div>
              <div className={styles.chips}>
                <SettingsChips
                  value={row.settings ?? defaults}
                  onChange={(settings) => update(row.key, { settings })}
                />
              </div>
              <div className={styles.rowActions}>
                <RowMenu
                  label={row.role || "this role"}
                  agent={member}
                  onOpen={setOpened}
                  source={sourceOf(row, member)}
                />
                <Button
                  variant="ghost"
                  icon
                  aria-label={`Remove ${row.role || "this role"}`}
                  onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                >
                  <X size={14} aria-hidden />
                </Button>
              </div>
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
        <Button onClick={() => (templates.length === 0 ? add(undefined) : setAdding(true))}>
          <Plus size={14} aria-hidden />
          Add someone
        </Button>
        <span className={styles.hint}>
          {templates.length === 0
            ? "Save time next time: save any agent as a template from its profile."
            : "Each person can use a different AI app and model."}
        </span>
      </div>
      <Dialog.Root open={adding} onOpenChange={setAdding}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialog.overlay} />
          <Dialog.Content className={`${dialog.content} ${styles.addDialog}`}>
            <Dialog.Title className={dialog.title}>Add someone to the team</Dialog.Title>
            <Dialog.Description className={dialog.description}>
              Start from a template to fill in their job and AI, or start blank. You can change
              everything after.
            </Dialog.Description>
            <TemplatePicker chosen={undefined} onPick={add} title="Start from a template" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {opened?.kind === "profile" ? (
        <AgentProfileDialog
          agent={opened.agent}
          open
          onOpenChange={(open) => {
            if (!open) setOpened(undefined);
          }}
        />
      ) : null}
      {opened?.kind === "template" ? (
        <SaveTemplateDialog
          source={opened.source}
          open
          onOpenChange={(open) => {
            if (!open) setOpened(undefined);
          }}
        />
      ) : null}
    </>
  );
}
