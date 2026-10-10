import {
  type AgentColour,
  type AgentSettings,
  type Autonomy,
  agentColours,
  type ProfileRecord,
} from "@office-town/contract";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { saveTemplate } from "../../store/templates.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { AsksFirst } from "./AsksFirst.tsx";
import { type ChipSettings, SettingsChips } from "./SettingsChips.tsx";
import styles from "./Templates.module.css";

export interface TemplateDraft {
  name: string;
  job: string;
  colour: AgentColour;
  notes: string;
  autonomy: Autonomy | undefined;
  settings: ChipSettings;
}

export function draftOf(template: ProfileRecord): TemplateDraft {
  const { instructions = "", autonomy, ...settings } = template.settings;
  return {
    name: template.name,
    job: template.role,
    colour: template.colour,
    notes: instructions,
    autonomy,
    settings,
  };
}

export function blankDraft(harness: string): TemplateDraft {
  return {
    name: "",
    job: "",
    colour: agentColours[0].value,
    notes: "",
    autonomy: undefined,
    settings: { harness, environment: { kind: "native" } },
  };
}

export function settingsOfDraft(draft: TemplateDraft): AgentSettings {
  const notes = draft.notes.trim();
  return {
    ...draft.settings,
    ...(notes === "" ? {} : { instructions: notes }),
    ...(draft.autonomy === undefined ? {} : { autonomy: draft.autonomy }),
  };
}

interface TemplateDialogProps {
  // Editing one; none makes a new template.
  template: ProfileRecord | undefined;
  // A new one's starting fields, such as a copy of another.
  start: TemplateDraft | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateDialog({ template, start, open, onOpenChange }: TemplateDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const [draft, setDraft] = useState<TemplateDraft>(
    () =>
      start ??
      (template === undefined ? blankDraft(harnesses[0]?.harness ?? "claude") : draftOf(template)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (change: Partial<TemplateDraft>) => setDraft({ ...draft, ...change });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveTemplate(template?.id, {
        name: draft.name.trim(),
        role: draft.job.trim(),
        colour: draft.colour,
        settings: settingsOfDraft(draft),
      });
      onOpenChange(false);
      showToast(
        template === undefined
          ? `Saved “${saved.name}” as a template. You'll see it whenever you add an agent.`
          : `Saved “${saved.name}”. Agents you make from it from now on use these settings.`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.dialog}`}>
          <Dialog.Title className={dialog.title}>
            {template === undefined ? "New template" : `Edit ${template.name}`}
          </Dialog.Title>
          <Dialog.Description className={dialog.description}>
            {template === undefined
              ? "A ready-made agent you can reuse whenever you add an agent."
              : "Changes apply to agents you make from it from now on. Agents already made from it keep their own settings."}
          </Dialog.Description>
          <form className={form.form} onSubmit={save}>
            <div className={styles.identity}>
              <Avatar name={draft.name.trim() || "?"} colour={draft.colour} size={40} />
              <label className={form.field} htmlFor="template-name">
                <span className={form.label}>Template name</span>
                <input
                  id="template-name"
                  className={form.input}
                  value={draft.name}
                  required
                  placeholder="For example: Frontend builder"
                  onChange={(event) => set({ name: event.target.value })}
                />
                <span className={form.hint}>
                  Name it after the job, so it's easy to pick later.
                </span>
              </label>
            </div>
            <div className={form.field}>
              <span className={form.label}>Colour</span>
              <ColourPicker
                label="Colour"
                value={draft.colour}
                onChange={(colour) => set({ colour })}
              />
            </div>
            <label className={form.field} htmlFor="template-job">
              <span className={form.label}>What it does</span>
              <input
                id="template-job"
                className={form.input}
                value={draft.job}
                placeholder="For example: Builds pages, styles and forms"
                onChange={(event) => set({ job: event.target.value })}
              />
            </label>
            <label className={form.field} htmlFor="template-notes">
              <span className={form.label}>Notes</span>
              <textarea
                id="template-notes"
                className={form.input}
                rows={4}
                value={draft.notes}
                onChange={(event) => set({ notes: event.target.value })}
              />
              <span className={form.hint}>
                Every agent made from this template reads these before each task.
              </span>
            </label>
            <div className={form.field}>
              <span className={form.label}>Which AI it uses</span>
              <div className={form.row}>
                <SettingsChips value={draft.settings} onChange={(settings) => set({ settings })} />
              </div>
            </div>
            <div className={form.field}>
              <span className={form.label}>When it asks you first</span>
              <AsksFirst
                name="template-asks"
                base={undefined}
                baseName="its team"
                value={draft.autonomy}
                onChange={(autonomy) => set({ autonomy })}
              />
            </div>
            {error === undefined ? null : (
              <p className={form.error} role="alert">
                {error}
              </p>
            )}
            <div className={form.actions}>
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving || draft.name.trim() === ""}>
                {template === undefined ? "Save template" : "Save changes"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
