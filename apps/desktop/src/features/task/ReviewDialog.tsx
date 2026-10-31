import type { HarnessDescription, NewAgent } from "@office-town/contract";
import { Check, Info } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { approvedList, keepChecks, useChecks } from "../../store/checks.ts";
import { useDraft } from "../../store/drafts.ts";
import { track } from "../../store/live.ts";
import { useTemplates } from "../../store/templates.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import dialog from "../../ui/Dialog.module.css";
import { useModels } from "../profiles/model-line.ts";
import { modelLine } from "../profiles/model-name.ts";
import styles from "./ReviewDialog.module.css";

const SAME = "same";

// From what its harness can keep out (D-41).
function isolationLine(harness: HarnessDescription | undefined): string {
  switch (harness?.capabilities.isolation) {
    case "full":
      return "Your instruction files, memory, plugins and connectors are not loaded.";
    case "partial":
      return harness.isolationNote ?? "Some of your own settings still load.";
    default:
      return "This AI app loads your own settings.";
  }
}

interface ReviewDialogProps {
  // The checker starts with this agent's harness, model and effort.
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // With the checker's agent id, so a team view can show its work.
  onStarted?: (agentId: string) => void;
}

// What the checker starts from: the approved list, else the lead's checklist, else nothing (D-73).
function ListPreview({ agent }: { agent: Agent }) {
  const checks = useChecks(agent.taskId);
  const approved = approvedList(checks, agent.task);
  const written = agent.task.checklist;
  const items = approved?.items ?? (written?.agentId === agent.id ? written.items : []);
  const legend =
    approved !== undefined
      ? `Round ${approved.round + 1} runs the ${items.length} checks you approved`
      : items.length > 0
        ? `${agent.name}'s checklist: ${items.length} ${items.length === 1 ? "check" : "checks"}`
        : "Checklist";
  return (
    <fieldset className={styles.files}>
      <legend className={styles.legend}>{legend}</legend>
      {items.map((item) => (
        <p key={item.check} className={styles.file}>
          {item.check}
        </p>
      ))}
      <p className={styles.note}>
        {approved !== undefined
          ? "The list stays as you approved it, so every round is measured the same way."
          : items.length > 0
            ? "The checker adds edge cases and boundaries; you approve the whole list before it runs."
            : `${agent.name} wrote no checklist, so the checker writes one; you approve it before it runs.`}
      </p>
    </fieldset>
  );
}

// Its work is its own trace, beside the task's agents (D-18, D-73).
export function ReviewDialog({ agent, open, onOpenChange, onStarted }: ReviewDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const templates = useTemplates() ?? [];
  const [ask, setAsk] = useDraft(`review.${agent.id}`, "");
  const [reviewer, setReviewer] = useState(SAME);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const { instructions: _, autonomy: __, ...settings } = agent.record.settings;
  const profile = templates.find((known) => known.id === reviewer);
  const modelsOf = useModels([settings, ...templates.map((known) => known.settings)]);
  const chosenHarness = profile?.settings.harness ?? settings.harness;
  const isolation = harnesses.find((known) => known.harness === chosenHarness);
  const choices = [
    {
      value: SAME,
      label: `Like ${agent.name}`,
      description: modelLine(settings, harnesses, modelsOf(settings)),
    },
    ...templates.map((known) => ({
      value: known.id,
      label: known.name,
      description: modelLine(known.settings, harnesses, modelsOf(known.settings)),
    })),
  ];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setError(undefined);
    try {
      const chosen: NewAgent = profile === undefined ? { settings } : { profileId: profile.id };
      const started = await api.startCheck(agent.taskId, {
        reviewer: chosen,
        agentId: agent.id,
        ...(ask.trim() === "" ? {} : { ask: ask.trim() }),
      });
      keepChecks([started]);
      await track(agent.taskId);
      onOpenChange(false);
      setAsk("");
      navigate({ name: "task", taskId: agent.taskId });
      onStarted?.(started.checkerAgentId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.content}`}>
          <Dialog.Title className={dialog.title}>Send for review</Dialog.Title>
          <Dialog.Description className={dialog.description}>
            A fresh agent checks {agent.name}'s work on a temporary copy of the folder, removed when
            it finishes. Your files are not changed.
          </Dialog.Description>
          <form onSubmit={submit} className={dialog.form}>
            {open ? <ListPreview agent={agent} /> : null}
            <label className={dialog.label}>
              Anything else to check? (optional)
              <textarea
                className={styles.brief}
                rows={2}
                value={ask}
                placeholder="For example: try it with a slow network"
                onChange={(change) => setAsk(change.target.value)}
              />
            </label>
            <div className={styles.reviewer}>
              <ChoiceMenu
                label="Checker"
                value={reviewer}
                choices={choices}
                onChange={setReviewer}
              />
              <span className={styles.note}>
                {isolation?.capabilities.isolation === "full" ? (
                  <Check size={13} className={styles.ok} aria-hidden />
                ) : (
                  <Info size={13} aria-hidden />
                )}
                {isolationLine(isolation)}
              </span>
            </div>
            {error === undefined ? null : (
              <p className={dialog.error} role="alert">
                {error}
              </p>
            )}
            <div className={dialog.actions}>
              <Dialog.Close asChild>
                <Button variant="ghost" onClick={() => setAsk("")}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={starting}>
                Send for review
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
