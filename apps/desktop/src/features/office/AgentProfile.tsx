import type { AgentRecord, AgentSettings, Autonomy } from "@office-town/contract";
import { BookmarkPlus } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { clearDrafts, SETTINGS_SHAPE, shaped, useDraft } from "../../store/drafts.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import dialog from "../../ui/Dialog.module.css";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { FilesSection } from "../library/FilesSection.tsx";
import { FieldGroup, JobFields, ModelField } from "../profiles/AgentFields.tsx";
import { AsksFirst } from "../profiles/AsksFirst.tsx";
import { SaveTemplateDialog } from "../profiles/SaveTemplateDialog.tsx";
import type { ChipSettings } from "../profiles/SettingsChips.tsx";
import { useYou } from "../you/you.ts";
import { toHandle } from "./AgentName.tsx";
import styles from "./AgentProfile.module.css";

interface Draft {
  name: string;
  colour: AgentRecord["colour"];
  job: string;
  notes: string;
  autonomy: Autonomy | undefined;
  settings: ChipSettings;
}

const DRAFT_SHAPE = { name: "", colour: "", job: "", notes: "", settings: SETTINGS_SHAPE };

// The name shows as typed text; the "@" handle is made from it on save.
function draftOf(agent: AgentRecord): Draft {
  const { instructions = "", autonomy, ...settings } = agent.settings;
  return {
    name: agent.name.replace(/^@/, ""),
    colour: agent.colour,
    job: agent.purpose ?? "",
    notes: instructions,
    autonomy,
    settings,
  };
}

function settingsOf(draft: Draft): AgentSettings {
  const notes = draft.notes.trim();
  return {
    ...draft.settings,
    ...(notes === "" ? {} : { instructions: notes }),
    ...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy }),
  };
}

// What Save would change; the name counts by the handle it makes.
const changesOf = (draft: Draft) =>
  JSON.stringify({
    handle: toHandle(draft.name),
    colour: draft.colour,
    job: draft.job.trim(),
    settings: settingsOf(draft),
  });

function shorten(text: string): string {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

// Everything about one agent, in the field set every agent editor shares (D-111): Identity, Job,
// Runs on, then its files and what it reads.
// `fromDepartment`: opened over the department's own settings, where the role is edited already.
export function AgentProfile({
  agent,
  fromDepartment = false,
}: {
  agent: AgentRecord;
  fromDepartment?: boolean;
}) {
  const department = useApp((state) =>
    agent.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const you = useYou();
  const leads = department?.leadAgentId === agent.id;
  const scope = `agent.${agent.id}`;
  const [draft, setDraft] = useDraft<Draft>(scope, () => draftOf(agent), shaped(DRAFT_SHAPE));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savingTemplate, setSavingTemplate] = useState(false);
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const who = agent.name;
  const id = agent.id;
  const team = department?.name;
  const changed = changesOf(draft) !== changesOf(draftOf(agent));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const handle = toHandle(draft.name);
      if (handle !== agent.name) await api.renameAgent(id, handle);
      await api.updateAgent(id, {
        colour: draft.colour,
        purpose: draft.job,
        settings: settingsOf(draft),
      });
      clearDrafts(scope);
      showToast("Saved. Applies from the next task.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const reads = [
    {
      title: "About you",
      from: "from your profile",
      text: you.about.trim() === "" ? "Not filled in yet." : shorten(you.about),
      edit: () => navigate({ name: "you" }),
    },
    ...(department === undefined
      ? []
      : [
          {
            title: "Team rules",
            from: `from ${department.name}`,
            text: department.rules?.trim() ? shorten(department.rules) : "None written yet.",
            edit: () => navigate({ name: "department", departmentId: department.id }),
          },
        ]),
    {
      title: "Instructions",
      from: "above",
      text: draft.notes.trim() === "" ? "None written yet." : shorten(draft.notes),
      edit: undefined,
    },
    {
      title: "The task",
      from:
        department === undefined
          ? "from you"
          : leads
            ? "from you or your chief"
            : "from the team lead",
    },
  ];

  return (
    <div className={`${form.form} ${styles.profile}`}>
      <FieldGroup title="Identity">
        <label className={form.field} htmlFor={`agent-name-${id}`}>
          <span className={form.label}>Name</span>
          <input
            id={`agent-name-${id}`}
            className={form.input}
            value={draft.name}
            maxLength={40}
            onChange={(event) => set({ name: event.target.value })}
          />
          <span className={form.hint}>
            Teammates give work to <span className={styles.handle}>{toHandle(draft.name)}</span>
          </span>
        </label>
        <div className={form.field}>
          <span className={form.label}>Colour</span>
          <span className={form.hint}>
            {leads && team !== undefined
              ? `In the office and in chats. Also the colour of ${team}.`
              : "In the office and in chats."}
          </span>
          <div className={styles.colourRow}>
            <ColourPicker
              label="Colour"
              value={draft.colour}
              onChange={(colour) => set({ colour })}
            />
            <Avatar name={toHandle(draft.name)} colour={draft.colour} size={36} />
          </div>
        </div>
        {department === undefined || fromDepartment ? null : (
          <div className={form.field}>
            <span className={form.label}>Role</span>
            <span className={styles.role}>
              {agent.role ?? (leads ? "Lead" : "Member")}
              <button
                type="button"
                className={styles.edit}
                onClick={() => navigate({ name: "department", departmentId: department.id })}
              >
                Change in {department.name}
              </button>
            </span>
          </div>
        )}
      </FieldGroup>
      <FieldGroup title="Job">
        <JobFields
          id={`agent-${id}`}
          job={draft.job}
          notes={draft.notes}
          onJob={(job) => set({ job })}
          onNotes={(notes) => set({ notes })}
          jobHint={
            department === undefined || leads
              ? "One line to tell your agents apart."
              : "One line. The lead uses it to hand out work."
          }
          notesHint={`Only ${who} reads these, before every task.`}
        />
      </FieldGroup>
      <FieldGroup title="Runs on">
        <ModelField value={draft.settings} onChange={(settings) => set({ settings })} />
        <div className={form.field}>
          <span className={form.label}>Permissions</span>
          <AsksFirst
            name={`agent-asks-${id}`}
            base={department?.autonomy ?? agent.autonomy ?? "supervised"}
            baseName={department === undefined ? "the task" : department.name}
            value={draft.autonomy}
            onChange={(autonomy) => set({ autonomy })}
          />
          <p className={form.hint}>
            {department === undefined
              ? "To allow more, pick a different setting when you start the next task."
              : `To allow more, change ${department.name}'s permissions.`}
          </p>
        </div>
      </FieldGroup>
      {department === undefined ? null : (
        <FilesSection
          workspaceId={department.workspaceId}
          holder={{ departmentId: department.id, agentId: agent.id }}
          name={who}
        />
      )}
      <details className={styles.reads}>
        <summary>
          Reads before each task: your profile
          {team === undefined ? "" : `, ${team}'s rules`}, its instructions and the task
        </summary>
        <ol>
          {reads.map((part) => (
            <li key={part.title}>
              <span>
                <strong>{part.title}</strong> <span className={form.hint}>{part.from}</span>
                {part.text === undefined ? null : <q>{part.text}</q>}
              </span>
              {part.edit === undefined ? null : (
                <button type="button" className={styles.edit} onClick={part.edit}>
                  Edit
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>
      {error === undefined ? null : (
        <p className={form.error} role="alert">
          {error}
        </p>
      )}
      <div className={`${form.actions} ${form.sticky}`}>
        <DraftNote
          scope={scope}
          editing
          onDiscard={() => {
            setDraft(draftOf(agent));
            clearDrafts(scope);
          }}
        />
        <MoreMenu
          label={`More for ${who}`}
          menu={() => ({
            actions: [
              {
                label: "Save as template",
                icon: BookmarkPlus,
                run: () => setSavingTemplate(true),
              },
            ],
          })}
        />
        <Button variant="primary" disabled={!changed} busy={saving} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
      {savingTemplate ? (
        <SaveTemplateDialog
          source={{
            who,
            name: agent.role !== undefined && agent.role !== "Lead" ? agent.role : "",
            job: draft.job,
            colour: draft.colour,
            settings: settingsOf(draft),
          }}
          open
          onOpenChange={setSavingTemplate}
        />
      ) : null}
    </div>
  );
}

// The same profile, opened from a department's settings, for a member with no desk today.
export function AgentProfileDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.dialog}`}>
          <Dialog.Title className={dialog.title}>{agent.name}</Dialog.Title>
          <Dialog.Description className={dialog.description}>
            {agent.purpose ?? agent.role ?? "Agent profile"}
          </Dialog.Description>
          <AgentProfile agent={agent} fromDepartment />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
