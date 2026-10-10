import type { AgentRecord, AgentSettings, Autonomy } from "@office-town/contract";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AsksFirst } from "../profiles/AsksFirst.tsx";
import { SaveTemplateDialog } from "../profiles/SaveTemplateDialog.tsx";
import { type ChipSettings, SettingsChips } from "../profiles/SettingsChips.tsx";
import { useYou } from "../you/you.ts";
import styles from "./AgentProfile.module.css";

interface Draft {
  name: string;
  colour: AgentRecord["colour"];
  job: string;
  notes: string;
  autonomy: Autonomy | undefined;
  settings: ChipSettings;
}

function draftOf(agent: AgentRecord): Draft {
  const { instructions = "", autonomy, ...settings } = agent.settings;
  return {
    name: agent.name,
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

function shorten(text: string): string {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

// Everything about one agent: who it is, what it does, its notes, its AI and how careful it is.
export function AgentProfile({ agent }: { agent: AgentRecord }) {
  const department = useApp((state) =>
    agent.departmentId === undefined ? undefined : state.departments[agent.departmentId],
  );
  const working = useApp((state) =>
    Object.values(state.sessions).some(
      (session) =>
        session.agentId === agent.id &&
        (session.status === "starting" || session.status === "running"),
    ),
  );
  const you = useYou();
  const leads = department?.leadAgentId === agent.id;
  const [draft, setDraft] = useState(() => draftOf(agent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savingTemplate, setSavingTemplate] = useState(false);
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const who = draft.name;
  const id = agent.id;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      if (draft.name !== agent.name) await api.renameAgent(id, draft.name);
      await api.updateAgent(id, {
        colour: draft.colour,
        purpose: draft.job,
        settings: settingsOf(draft),
      });
      showToast(`Saved. ${draft.name} will work this way from its next task.`);
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
      title: `Notes for ${who}`,
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
      {working ? (
        <p className={form.notice}>
          {who} is working on a task right now. Your changes start with {who}'s next task.
        </p>
      ) : null}
      <label className={form.field} htmlFor={`agent-name-${id}`}>
        <span className={form.label}>Name</span>
        <input
          id={`agent-name-${id}`}
          className={form.input}
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
        />
        <span className={form.hint}>
          Teammates use this name to hand {who} work. It starts with @ and uses lowercase letters,
          numbers and dashes.
        </span>
      </label>
      <div className={form.field}>
        <span className={form.label}>Colour</span>
        <ColourPicker label="Colour" value={draft.colour} onChange={(colour) => set({ colour })} />
        <p className={form.hint}>{who}'s colour in the office and in chats.</p>
      </div>
      <label className={form.field} htmlFor={`agent-job-${id}`}>
        <span className={form.label}>What {who} does</span>
        <input
          id={`agent-job-${id}`}
          className={form.input}
          value={draft.job}
          placeholder="For example: Builds pages, styles and forms"
          onChange={(event) => set({ job: event.target.value })}
        />
        <span className={form.hint}>
          {department === undefined || leads
            ? "One line, so you can tell your agents apart."
            : "One line. The team lead uses it to decide what to give them."}
        </span>
      </label>
      <label className={form.field} htmlFor={`agent-notes-${id}`}>
        <span className={form.label}>Notes for {who}</span>
        <textarea
          id={`agent-notes-${id}`}
          className={form.input}
          rows={4}
          value={draft.notes}
          onChange={(event) => set({ notes: event.target.value })}
        />
        <span className={form.hint}>
          {who} reads these before every task. Only {who} sees them.
        </span>
      </label>
      <div className={form.field}>
        <span className={form.label}>Which AI {who} uses</span>
        <div className={form.row}>
          <SettingsChips value={draft.settings} onChange={(settings) => set({ settings })} />
        </div>
      </div>
      <div className={form.field}>
        <span className={form.label}>When {who} asks you first</span>
        <AsksFirst
          name={`agent-asks-${id}`}
          base={department?.autonomy ?? agent.autonomy ?? "supervised"}
          baseName={department === undefined ? "when you started its task" : department.name}
          value={draft.autonomy}
          onChange={(autonomy) => set({ autonomy })}
        />
        <p className={form.hint}>
          {department === undefined
            ? `To let ${who} do more without asking, choose a higher setting when you start its next task.`
            : `To let ${who} do more without asking, change ${department.name}'s setting. That keeps everyone on one team working within the same limits.`}
        </p>
      </div>
      <details className={styles.reads} open>
        <summary>What {who} reads before each task</summary>
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
      <div className={form.actions}>
        <Button onClick={() => setSavingTemplate(true)}>Save as template</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save changes"}
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
          <AgentProfile agent={agent} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
