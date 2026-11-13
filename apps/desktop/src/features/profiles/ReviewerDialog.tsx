import type { ReviewerRecord, RoleSettings } from "@office-town/contract";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { deleteReviewer, saveReviewer } from "../../store/reviewers.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import form from "../../ui/Form.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { SettingsChips } from "./SettingsChips.tsx";
import styles from "./Templates.module.css";

interface ReviewerDialogProps {
  // Editing one; none makes a new reviewer.
  reviewer: ReviewerRecord | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (reviewer: ReviewerRecord) => void;
}

export function ReviewerDialog({ reviewer, open, onOpenChange, onSaved }: ReviewerDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const [name, setName] = useState(reviewer?.name ?? "");
  const [description, setDescription] = useState(reviewer?.description ?? "");
  const [instructions, setInstructions] = useState(reviewer?.instructions ?? "");
  // None runs the reviewer on the reviewed agent's model.
  const [settings, setSettings] = useState<RoleSettings | undefined>(reviewer?.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const saved = await saveReviewer(reviewer?.id, {
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        ...(settings === undefined ? {} : { settings }),
      });
      showToast(`Saved “${saved.name}”.`);
      onSaved?.(saved);
    });
  };
  const remove = (known: ReviewerRecord) =>
    act(async () => {
      await deleteReviewer(known.id);
      showToast(`Deleted “${known.name}”.`);
    });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content
          className={`${dialog.content} ${styles.dialog}`}
          aria-describedby={undefined}
        >
          <Dialog.Title className={dialog.title}>
            {reviewer === undefined ? "New reviewer" : "Edit reviewer"}
          </Dialog.Title>
          <form className={form.form} onSubmit={save}>
            <label className={form.field} htmlFor="reviewer-name">
              <span className={form.label}>Name</span>
              <input
                id="reviewer-name"
                className={form.input}
                value={name}
                required
                placeholder="Accessibility reviewer"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={form.field} htmlFor="reviewer-description">
              <span className={form.label}>Description</span>
              <input
                id="reviewer-description"
                className={form.input}
                value={description}
                placeholder="Checks keyboard use, contrast and labels"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className={form.field} htmlFor="reviewer-instructions">
              <span className={form.label}>Instructions</span>
              <textarea
                id="reviewer-instructions"
                className={form.input}
                value={instructions}
                required
                placeholder="What to check and how to report it"
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            <div className={form.field}>
              <span className={form.label}>Model</span>
              <div className={form.row}>
                <SettingsChips
                  value={
                    settings ?? {
                      harness: harnesses[0]?.harness ?? "claude",
                      environment: { kind: "native" },
                    }
                  }
                  onChange={setSettings}
                  placeholder={settings === undefined ? "Same as the agent" : undefined}
                />
              </div>
            </div>
            {error === undefined ? null : (
              <p className={form.error} role="alert">
                {error}
              </p>
            )}
            <div className={form.actions}>
              {reviewer === undefined ? null : (
                <Button
                  variant="ghost"
                  className={styles.deleteAction}
                  disabled={busy}
                  onClick={() => void remove(reviewer)}
                >
                  Delete
                </Button>
              )}
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || name.trim() === "" || instructions.trim() === ""}
              >
                Save reviewer
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
