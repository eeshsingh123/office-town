import type { AgentSettings } from "@office-town/contract";
import { Info } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { keepAgent } from "../../store/live.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { openChiefSettings, useOffice } from "../office/office-state.ts";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./Chief.module.css";

// Mounted at each opening, so it starts from the settings as saved.
function ChiefForm() {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const harnesses = useApp((state) => state.harnesses);
  const [draft, setDraft] = useState<AgentSettings>(
    () =>
      chief?.settings ?? {
        harness: harnesses[0]?.harness ?? "claude",
        environment: { kind: "native" },
      },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    const { instructions, ...rest } = draft;
    const trimmed = instructions?.trim();
    try {
      const saved = await api.saveChief(trimmed ? { ...rest, instructions: trimmed } : rest);
      keepAgent(saved);
      useApp.setState({ chiefId: saved.id });
      openChiefSettings(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog.Title className={dialog.title}>
        {chief === undefined ? "Set up the chief" : "Chief settings"}
      </Dialog.Title>
      <Dialog.Description className={dialog.description}>
        The chief splits a goal across departments and sets their order. Changes apply to its next
        goal; a goal in progress keeps its settings.
      </Dialog.Description>
      <form onSubmit={save} className={dialog.form}>
        <div className={styles.chips}>
          <SettingsChips
            value={{
              harness: draft.harness,
              environment: draft.environment,
              ...(draft.model === undefined ? {} : { model: draft.model }),
              ...(draft.effort === undefined ? {} : { effort: draft.effort }),
            }}
            onChange={(next) =>
              setDraft(
                draft.instructions === undefined
                  ? next
                  : { ...next, instructions: draft.instructions },
              )
            }
          />
        </div>
        <label className={dialog.label}>
          Instructions (optional)
          <textarea
            className={styles.instructions}
            rows={3}
            value={draft.instructions ?? ""}
            placeholder="For example: prefer free models for new departments. Keep plans to 4 pieces or fewer."
            onChange={(change) => setDraft({ ...draft, instructions: change.target.value })}
          />
        </label>
        <p className={styles.note}>
          <Info size={14} aria-hidden />
          The chief plans, passes results on and messages leads. It may read every department's
          workspace but changes none; anything else it tries asks you. A small model is usually
          enough.
        </p>
        {error === undefined ? null : (
          <p className={dialog.error} role="alert">
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button type="submit" variant="primary" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}

// The one standing chief's harness, model, effort and instructions (D-49).
export function ChiefSettingsDialog() {
  const open = useOffice((state) => state.chiefSettingsOpen);
  return (
    <Dialog.Root open={open} onOpenChange={openChiefSettings}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={dialog.content}>
          <ChiefForm />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
