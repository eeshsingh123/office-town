import type { AgentRecord, ProfileRecord, RoleSettings } from "@office-town/contract";
import { MoreHorizontal, Plus, SwatchBook } from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import menu from "../../ui/Menu.module.css";
import { FilesSection } from "../library/FilesSection.tsx";
import { AgentProfileDialog } from "../office/AgentProfile.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import { SaveTemplateDialog, type TemplateSource } from "../profiles/SaveTemplateDialog.tsx";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import { TemplatePicker } from "../profiles/TemplatePicker.tsx";
import styles from "./MemberEditor.module.css";
import {
  blankPerson,
  LEAD_COLOUR,
  memberColour,
  type PersonForm,
  type TeamForm,
} from "./team-form.ts";

// Starting points; each stays editable once added.
const ROLE_STARTERS = [
  { role: "Researcher", purpose: "Finds and reads sources, then sums up what matters" },
  { role: "Writer", purpose: "Drafts and edits text" },
  { role: "Developer", purpose: "Writes and fixes code" },
  { role: "Reviewer", purpose: "Checks the work and points out problems" },
  { role: "Tester", purpose: "Tries the result and reports what breaks" },
];

type Opened =
  | { kind: "add" }
  | { kind: "template" }
  | { kind: "save"; source: TemplateSource }
  | { kind: "profile"; agent: AgentRecord }
  | undefined;

// The AI choices a template fills in; its notes go into the instructions box.
function fromTemplate(person: PersonForm, template: ProfileRecord): PersonForm {
  const { instructions, autonomy: _, ...settings } = template.settings;
  return {
    ...person,
    role: template.name,
    purpose: template.role,
    instructions: instructions ?? "",
    settings,
    profileId: template.id,
    modelGuessed: false,
  };
}

interface MemberEditorProps {
  team: TeamForm;
  onChange: (team: TeamForm) => void;
  selected: number;
  onSelect: (key: number) => void;
  // For a new member.
  defaults: RoleSettings;
  // Set for a department that exists, so its members' files show.
  departmentId?: string;
  workspaceId?: string;
}

function ListRow({
  person,
  colour,
  lead,
  selected,
  onSelect,
}: {
  person: PersonForm;
  colour: string;
  lead: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const model = useModelLine(person.settings);
  const role = person.role.trim() || (lead ? "Lead" : "New member");
  return (
    <li className={lead ? undefined : styles.reports}>
      <button type="button" className={styles.person} aria-pressed={selected} onClick={onSelect}>
        <Avatar name={role} colour={colour} size={30} />
        <span className={styles.personText}>
          <strong>{role}</strong>
          <span>{model}</span>
        </span>
      </button>
    </li>
  );
}

// The team as a small org chart on the left, and everything about the picked person beside it.
export function MemberEditor({
  team,
  onChange,
  selected,
  onSelect,
  defaults,
  departmentId,
  workspaceId,
}: MemberEditorProps) {
  const agents = useApp((state) => state.agents);
  const [opened, setOpened] = useState<Opened>();
  const isLead = selected === team.lead.key;
  const person = isLead ? team.lead : team.members.find((member) => member.key === selected);
  const index = team.members.findIndex((member) => member.key === selected);
  const agent = person?.agentId === undefined ? undefined : agents[person.agentId];
  const colour = agent?.colour ?? (isLead ? LEAD_COLOUR : memberColour(Math.max(0, index)));
  const kept = new Set(team.members.flatMap((member) => member.agentId ?? []));
  const leaving = Object.values(agents).filter(
    (one) =>
      departmentId !== undefined &&
      one.departmentId === departmentId &&
      one.id !== team.lead.agentId &&
      !kept.has(one.id),
  );

  const update = (change: Partial<PersonForm>) => {
    if (person === undefined) return;
    const next = { ...person, ...change };
    if (isLead) onChange({ ...team, lead: next });
    else
      onChange({
        ...team,
        members: team.members.map((one) => (one.key === selected ? next : one)),
      });
  };
  const add = (member: PersonForm) => {
    setOpened(undefined);
    onChange({ ...team, members: [...team.members, member] });
    onSelect(member.key);
  };
  const remove = () => {
    const rest = team.members.filter((member) => member.key !== selected);
    onChange({ ...team, members: rest });
    onSelect(rest[Math.max(0, index - 1)]?.key ?? team.lead.key);
  };
  const closeDialog = (open: boolean) => {
    if (!open) setOpened(undefined);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.list}>
        <span className={styles.eyebrow}>Team</span>
        <ul className={styles.people} aria-label="Team">
          <ListRow
            person={team.lead}
            colour={(team.lead.agentId && agents[team.lead.agentId]?.colour) || LEAD_COLOUR}
            lead
            selected={isLead}
            onSelect={() => onSelect(team.lead.key)}
          />
          {team.members.map((member, at) => (
            <ListRow
              key={member.key}
              person={member}
              colour={(member.agentId && agents[member.agentId]?.colour) || memberColour(at)}
              lead={false}
              selected={member.key === selected}
              onSelect={() => onSelect(member.key)}
            />
          ))}
        </ul>
        <Button onClick={() => setOpened({ kind: "add" })}>
          <Plus size={14} aria-hidden />
          Add a member
        </Button>
        {leaving.length === 0 ? null : (
          <p className={form.hint}>Leaves the team: {leaving.map((one) => one.name).join(", ")}</p>
        )}
      </div>

      {person === undefined ? null : (
        <section className={styles.card} aria-label={person.role || "Team member"}>
          <header className={styles.head}>
            <Avatar name={person.role || "?"} colour={colour} size={44} />
            <div className={styles.headText}>
              <strong>{person.role.trim() || (isLead ? "Lead" : "New member")}</strong>
              <span>
                {isLead ? "Leads the team" : "Reports to the lead"}
                {agent === undefined ? "" : ` · ${agent.name}`}
              </span>
            </div>
            <Button variant="ghost" onClick={() => setOpened({ kind: "template" })}>
              <SwatchBook size={14} aria-hidden />
              Start from template
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  icon
                  aria-label={`More for ${person.role || "this member"}`}
                >
                  <MoreHorizontal size={14} aria-hidden />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className={menu.surface} align="end" sideOffset={4}>
                  {agent === undefined ? null : (
                    <DropdownMenu.Item
                      className={menu.item}
                      onSelect={() => setOpened({ kind: "profile", agent })}
                    >
                      Open profile
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item
                    className={menu.item}
                    onSelect={() =>
                      setOpened({
                        kind: "save",
                        source: {
                          who: agent?.name ?? (person.role || "this team member"),
                          name: person.role,
                          job: person.purpose,
                          colour,
                          settings: {
                            ...person.settings,
                            ...(person.instructions.trim() === ""
                              ? {}
                              : { instructions: person.instructions.trim() }),
                          },
                        },
                      })
                    }
                  >
                    Save as template
                  </DropdownMenu.Item>
                  {isLead ? null : (
                    <DropdownMenu.Item className={menu.item} onSelect={remove}>
                      Remove from team
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </header>

          <div className={styles.pair}>
            <label className={form.field}>
              <span className={form.label}>Role name</span>
              <input
                className={form.input}
                value={person.role}
                placeholder={isLead ? "Lead" : "For example: Copywriter"}
                onChange={(change) => update({ role: change.target.value })}
              />
            </label>
            <label className={form.field}>
              <span className={form.label}>What they do</span>
              <input
                className={form.input}
                value={person.purpose}
                placeholder="One line, shown on cards and to the lead"
                onChange={(change) => update({ purpose: change.target.value })}
              />
            </label>
          </div>

          <label className={form.field}>
            <span className={form.label}>Instructions</span>
            <span className={form.hint}>
              {isLead
                ? "How to split the work, and what to check before handing it back. Read before every task."
                : "How they work, what to avoid, what to hand back. Read before every task."}
            </span>
            <textarea
              className={`${form.input} ${styles.instructions}`}
              value={person.instructions}
              placeholder={
                isLead
                  ? "For example: Give each page to one developer. Check the reviewer's notes before you hand the work back."
                  : "For example: Write for small business owners. Short sentences, no jargon."
              }
              onChange={(change) => update({ instructions: change.target.value })}
            />
          </label>

          <div className={form.field}>
            <span className={form.label}>Model</span>
            <div className={styles.chips}>
              <SettingsChips
                value={person.settings}
                onChange={(settings) => update({ settings, modelGuessed: false })}
              />
            </div>
            {person.modelGuessed ? (
              <span className={styles.guessed}>Picked by the draft. Check it suits the job.</span>
            ) : null}
          </div>

          {agent === undefined || workspaceId === undefined || departmentId === undefined ? null : (
            <FilesSection
              workspaceId={workspaceId}
              holder={{ departmentId, agentId: agent.id }}
              name={agent.name}
            />
          )}
        </section>
      )}

      <Dialog.Root open={opened?.kind === "add"} onOpenChange={closeDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialog.overlay} />
          <Dialog.Content className={`${dialog.content} ${styles.dialog}`}>
            <Dialog.Title className={dialog.title}>Add a member</Dialog.Title>
            <Dialog.Description className={dialog.description}>
              Start blank, from a common role, or from a template.
            </Dialog.Description>
            <div className={styles.starters}>
              <button
                type="button"
                className={styles.starter}
                onClick={() => add(blankPerson(defaults))}
              >
                <Plus size={13} aria-hidden />
                Blank
              </button>
              {ROLE_STARTERS.map((starter) => (
                <button
                  key={starter.role}
                  type="button"
                  className={styles.starter}
                  onClick={() => add(blankPerson(defaults, starter.role, starter.purpose))}
                >
                  <Plus size={13} aria-hidden />
                  {starter.role}
                </button>
              ))}
            </div>
            <TemplatePicker
              chosen={undefined}
              onPick={(template) =>
                add(
                  template === undefined
                    ? blankPerson(defaults)
                    : fromTemplate(blankPerson(defaults), template),
                )
              }
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={opened?.kind === "template"} onOpenChange={closeDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialog.overlay} />
          <Dialog.Content className={`${dialog.content} ${styles.dialog}`}>
            <Dialog.Title className={dialog.title}>Start from a template</Dialog.Title>
            <Dialog.Description className={dialog.description}>
              Fills in the role, instructions and model. Changes here won't change the template.
            </Dialog.Description>
            <TemplatePicker
              chosen={person?.profileId}
              who={isLead ? "the lead" : "this member"}
              onPick={(template) => {
                setOpened(undefined);
                if (template !== undefined && person !== undefined) {
                  update(fromTemplate(person, template));
                }
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {opened?.kind === "save" ? (
        <SaveTemplateDialog source={opened.source} open onOpenChange={closeDialog} />
      ) : null}
      {opened?.kind === "profile" ? (
        <AgentProfileDialog agent={opened.agent} open onOpenChange={closeDialog} />
      ) : null}
    </div>
  );
}
