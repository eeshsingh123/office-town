import type { AgentColour, AgentSettings } from "@office-town/contract";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { navigate } from "../../store/app-store.ts";
import { saveTemplate } from "../../store/templates.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./Templates.module.css";

export interface TemplateSource {
  // Such as "@mae-0427", or a new team member's role.
  who: string;
  // A first guess at the template's name, such as the agent's role.
  name: string;
  job: string;
  colour: AgentColour;
  settings: AgentSettings;
}

interface SaveTemplateDialogProps {
  source: TemplateSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaveTemplateDialog({ source, open, onOpenChange }: SaveTemplateDialogProps) {
  const [name, setName] = useState(source.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { who } = source;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveTemplate(undefined, {
        name: name.trim(),
        role: source.job.trim(),
        colour: source.colour,
        settings: source.settings,
      });
      onOpenChange(false);
      showToast(`Saved “${saved.name}” as a template. You'll see it whenever you add an agent.`, {
        label: "See templates",
        run: () => navigate({ name: "templates" }),
      });
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
        <Dialog.Content className={dialog.content}>
          <Dialog.Title className={dialog.title}>Save {who} as a template</Dialog.Title>
          <Dialog.Description className={dialog.description}>
            Reuse this setup whenever you add an agent.
          </Dialog.Description>
          <form className={form.form} onSubmit={save}>
            <label className={form.field} htmlFor="save-template-name">
              <span className={form.label}>Template name</span>
              <input
                id="save-template-name"
                className={form.input}
                value={name}
                required
                placeholder="For example: Frontend builder"
                onChange={(event) => setName(event.target.value)}
              />
              <span className={form.hint}>Name it after the job, so it's easy to pick later.</span>
            </label>
            <div className={form.field}>
              <span className={form.label}>What the template keeps</span>
              <ul className={styles.kept}>
                <li>What {who} does</li>
                <li>Notes for {who}</li>
                <li>Which AI {who} uses</li>
                <li>When {who} asks you first</li>
              </ul>
              <p className={form.hint}>
                Not kept: {who}'s name, team and past work. Each agent made from it gets its own
                name.
              </p>
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
              <Button type="submit" variant="primary" disabled={saving || name.trim() === ""}>
                Save template
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
