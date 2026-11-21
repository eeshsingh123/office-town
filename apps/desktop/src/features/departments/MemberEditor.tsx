import type { AgentRecord, ProfileRecord, RoleSettings } from "@office-town/contract";
import {
  BookmarkPlus,
  Copy,
  IdCard,
  Plus,
  Search,
  SwatchBook,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { useLiveState } from "../../store/agents.ts";
import { useApp } from "../../store/app-store.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import { StateTag } from "../../ui/StatusIcon.tsx";
import { FilesSection } from "../library/FilesSection.tsx";
import { AgentProfileDialog } from "../office/AgentProfile.tsx";
import { JobFields, ModelField } from "../profiles/AgentFields.tsx";
import { useModelLine, useModelName } from "../profiles/model-line.ts";
import { SaveTemplateDialog, type TemplateSource } from "../profiles/SaveTemplateDialog.tsx";
import { TemplatePicker } from "../profiles/TemplatePicker.tsx";
import { ProviderLogo } from "../providers/ProviderLogo.tsx";
import styles from "./MemberEditor.module.css";
import {
  baseRole,
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
  // Set while the lead is at work: its row is shown, not edited, with this note.
  leadLocked?: string;
}

function LockedLead({ person, note }: { person: PersonForm; note: string }) {
  const model = useModelLine(person.settings);
  return (
    <div className={form.field}>
      <span className={form.label}>Model</span>
      <span>{model}</span>
      <p className={form.hint}>{note}</p>
    </div>
  );
}

const roleOf = (person: PersonForm, lead = false) =>
  person.role.trim() || (lead ? "Lead" : "New member");

// Search and role filters only once the team is big enough to need them.
const SEARCH_FROM = 6;

function MemberState({ agentId }: { agentId: string }) {
  return <StateTag state={useLiveState(agentId)} />;
}

interface PersonRowProps {
  person: PersonForm;
  // The agent's name, once it exists.
  name: string | undefined;
  colour: string;
  selected: boolean;
  onSelect: () => void;
  // Set for a department that exists: saved members show their status, new ones say New.
  withState: boolean;
  lead?: boolean;
}

function PersonRow({
  person,
  name,
  colour,
  selected,
  onSelect,
  withState,
  lead = false,
}: PersonRowProps) {
  const model = useModelName(person.settings, person.settings.model);
  const role = roleOf(person, lead);
  return (
    <li>
      <button type="button" className={styles.row} aria-pressed={selected} onClick={onSelect}>
        <span className={styles.who}>
          <Avatar name={name ?? role} colour={colour} size={28} />
          <span className={styles.whoText}>
            <span className={styles.roleLine}>
              <strong title={role}>{role}</strong>
              {lead && role.toLowerCase() !== "lead" ? (
                <span className={styles.leadBadge}>Lead</span>
              ) : null}
            </span>
            {person.purpose.trim() === "" ? null : (
              <span className={styles.purpose} title={person.purpose}>
                {person.purpose}
              </span>
            )}
          </span>
        </span>
        <span className={styles.model} title={model}>
          <ProviderLogo harness={person.settings.harness} size="sm" />
          <span className={styles.modelName}>{model}</span>
        </span>
        {!withState ? null : person.agentId === undefined ? (
          <span className={styles.newTag}>New</span>
        ) : (
          <MemberState agentId={person.agentId} />
        )}
      </button>
    </li>
  );
}

// The team as a list, and everything about the picked person in a panel beside it.
export function MemberEditor({
  team,
  onChange,
  selected,
  onSelect,
  defaults,
  departmentId,
  workspaceId,
  leadLocked,
}: MemberEditorProps) {
  const agents = useApp((state) => state.agents);
  const [opened, setOpened] = useState<Opened>();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>();
  const isLead = selected === team.lead.key;
  const locked = isLead && leadLocked !== undefined;
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
  // A copy of someone in the role, with the same job, instructions and model.
  const duplicate = (like: PersonForm) =>
    add({
      ...blankPerson(like.settings, baseRole(like.role), like.purpose),
      instructions: like.instructions,
    });
  const closeDialog = (open: boolean) => {
    if (!open) setOpened(undefined);
  };

  const nameOf = (one: PersonForm) =>
    one.agentId === undefined ? undefined : agents[one.agentId]?.name;
  const colourOf = (one: PersonForm) => {
    const own = one.agentId === undefined ? undefined : agents[one.agentId]?.colour;
    return own ?? memberColour(team.members.indexOf(one));
  };
  const roles = [...new Set(team.members.map((one) => baseRole(roleOf(one))))];
  const big = team.members.length + 1 >= SEARCH_FROM;
  const words = query.trim().toLowerCase();
  const shown = team.members.filter(
    (one) =>
      (role === undefined || baseRole(roleOf(one)) === role) &&
      `${one.role} ${one.purpose} ${nameOf(one) ?? ""}`.toLowerCase().includes(words),
  );
  const withState = departmentId !== undefined;
  const title = person === undefined ? "" : roleOf(person, isLead);

  return (
    <div className={styles.frame}>
      <div className={styles.editor}>
        <div className={styles.roster}>
          <div className={styles.toolbar}>
            {big ? (
              <label className={styles.search}>
                <Search size={14} aria-hidden />
                <input
                  type="search"
                  value={query}
                  placeholder="Search people"
                  aria-label="Search people"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            ) : null}
            <Button className={styles.addMember} onClick={() => setOpened({ kind: "add" })}>
              <UserPlus size={14} aria-hidden />
              Add member
            </Button>
          </div>
          {big && roles.length > 1 ? (
            <div className={styles.filters}>
              <button
                type="button"
                className={form.chip}
                aria-pressed={role === undefined}
                onClick={() => setRole(undefined)}
              >
                All
              </button>
              {roles.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={form.chip}
                  aria-pressed={role === one}
                  onClick={() => setRole(role === one ? undefined : one)}
                >
                  {one}
                </button>
              ))}
            </div>
          ) : null}

          <div className={`${styles.list} ${withState ? styles.withState : ""}`}>
            <div className={styles.columns} aria-hidden>
              <span>Role</span>
              <span>Model</span>
              {withState ? <span>Status</span> : null}
            </div>
            <ul className={styles.rows}>
              <PersonRow
                person={team.lead}
                name={nameOf(team.lead)}
                colour={(team.lead.agentId && agents[team.lead.agentId]?.colour) || LEAD_COLOUR}
                lead
                withState={withState}
                selected={isLead}
                onSelect={() => onSelect(team.lead.key)}
              />
              {shown.map((member) => (
                <PersonRow
                  key={member.key}
                  person={member}
                  name={nameOf(member)}
                  colour={colourOf(member)}
                  withState={withState}
                  selected={member.key === selected}
                  onSelect={() => onSelect(member.key)}
                />
              ))}
            </ul>
          </div>
          {words !== "" && shown.length === 0 ? (
            <p className={form.hint}>Nobody on the team matches "{query.trim()}".</p>
          ) : null}
          {leaving.length === 0 ? null : (
            <p className={form.hint}>
              Leaves the team on Save: {leaving.map((one) => one.name).join(", ")}
            </p>
          )}
        </div>

        {person === undefined ? null : (
          <section className={styles.card} aria-label={title}>
            <header className={styles.head}>
              <Avatar name={agent?.name ?? title} colour={colour} size={40} />
              <div className={styles.headText}>
                <strong>{title}</strong>
                <span>
                  {isLead ? "Leads the team" : "Reports to the lead"}
                  {agent === undefined ? "" : ` · ${agent.name}`}
                </span>
              </div>
              <MoreMenu
                label={`More for ${title}`}
                menu={() => ({
                  actions: [
                    ...(agent === undefined
                      ? []
                      : [
                          {
                            label: "Open full profile",
                            icon: IdCard,
                            run: () => setOpened({ kind: "profile", agent }),
                          },
                        ]),
                    {
                      label: "Save as template",
                      icon: BookmarkPlus,
                      run: () =>
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
                        }),
                    },
                    ...(isLead
                      ? []
                      : [{ label: "Duplicate", icon: Copy, run: () => duplicate(person) }]),
                  ],
                })}
              />
            </header>

            <div className={styles.body}>
              {leadLocked !== undefined && locked ? (
                <LockedLead person={person} note={leadLocked} />
              ) : (
                <>
                  <div className={form.field}>
                    <label className={form.label} htmlFor={`member-role-${person.key}`}>
                      Role
                    </label>
                    <input
                      id={`member-role-${person.key}`}
                      className={form.input}
                      value={person.role}
                      placeholder={isLead ? "Lead" : "For example: Copywriter"}
                      onChange={(change) => update({ role: change.target.value })}
                    />
                  </div>
                  <JobFields
                    id={`member-${person.key}`}
                    job={person.purpose}
                    notes={person.instructions}
                    onJob={(purpose) => update({ purpose })}
                    onNotes={(instructions) => update({ instructions })}
                    jobHint={
                      isLead
                        ? "One line, shown on cards."
                        : "One line, shown on cards. The lead uses it to hand out work."
                    }
                    notesHint={
                      isLead
                        ? "How to split the work, and what to check before handing it back. Read before every task."
                        : "How they work, what to avoid and what to hand back. Read before every task."
                    }
                    notesPlaceholder={
                      isLead
                        ? "For example: Give each page to one developer"
                        : "For example: Write for small business owners"
                    }
                  />
                  <ModelField
                    value={person.settings}
                    onChange={(settings) => update({ settings, modelGuessed: false })}
                    note={
                      person.modelGuessed ? (
                        <span className={styles.guessed}>
                          Chosen by the draft. Make sure it fits the job.
                        </span>
                      ) : undefined
                    }
                  />
                </>
              )}

              {workspaceId === undefined || departmentId === undefined ? null : agent ===
                undefined ? (
                <div className={form.field}>
                  <span className={form.label}>Files</span>
                  <span className={form.hint}>Add files once the team is saved.</span>
                </div>
              ) : (
                <FilesSection
                  workspaceId={workspaceId}
                  holder={{ departmentId, agentId: agent.id }}
                  name={agent.name}
                />
              )}
            </div>

            {locked ? null : (
              <footer className={styles.foot}>
                <Button variant="ghost" onClick={() => setOpened({ kind: "template" })}>
                  <SwatchBook size={14} aria-hidden />
                  Start from template
                </Button>
                {isLead ? null : (
                  <Button variant="ghost" className={styles.remove} onClick={remove}>
                    <Trash2 size={14} aria-hidden />
                    Remove from team
                  </Button>
                )}
              </footer>
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
                Fills in the role, instructions and model.
              </Dialog.Description>
              <TemplatePicker
                chosen={person?.profileId}
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
    </div>
  );
}
