import type { HarnessDescription, NewAgent } from "@office-town/contract";
import { Check, Info } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import type { Agent } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import dialog from "../../ui/Dialog.module.css";
import { profileSummary, taskTitle } from "../../ui/format.ts";
import { useLoaded } from "../../ui/use-loaded.ts";
import styles from "./ReviewDialog.module.css";

const SAME = "same";

// From what its harness can keep out (D-41).
function isolationLine(harness: HarnessDescription | undefined): string {
  switch (harness?.capabilities.isolation) {
    case "full":
      return "Fully isolated: none of your instruction files, memory, plugins or connectors are loaded.";
    case "partial":
      return `Isolated in part. ${harness.isolationNote ?? "Some of your own settings still load."}`;
    default:
      return "This AI app cannot isolate itself, so your own settings load. Instruction files in the project are still left out of the copy.";
  }
}

interface ReviewDialogProps {
  // The reviewer starts with this agent's harness, model and effort.
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // With the reviewer's agent id, so a team view can show its work.
  onStarted?: (agentId: string) => void;
}

// Ready to send as is, so a review is one click away.
const defaultBrief = (agent: Agent) =>
  `Check that this work does what was asked: "${taskTitle(agent.task.prompt)}". List anything wrong, missing or risky, most important first.`;

// Its answer is its own trace, beside the task's agents (D-18).
export function ReviewDialog({ agent, open, onOpenChange, onStarted }: ReviewDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const files = useLoaded(open ? `files:${agent.taskId}:${agent.id}` : undefined, () =>
    api.listTaskFiles(agent.taskId, agent.id),
  );
  const profiles = useLoaded(open ? "profiles" : undefined, api.listProfiles);
  const [brief, setBrief] = useState(() => defaultBrief(agent));
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [reviewer, setReviewer] = useState(SAME);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const { instructions: _, autonomy: __, ...settings } = agent.record.settings;
  const profile = profiles.value?.find((known) => known.id === reviewer);
  const chosenHarness = profile?.settings.harness ?? settings.harness;
  const isolation = harnesses.find((known) => known.harness === chosenHarness);
  const paths = (files.value ?? [])
    .filter((entry) => !unchecked.has(entry.name))
    .map((entry) => entry.name);
  const choices = [
    {
      value: SAME,
      label: `Like ${agent.name}`,
      description: profileSummary({ settings }, harnesses),
    },
    ...(profiles.value ?? []).map((known) => ({
      value: known.id,
      label: known.name,
      description: profileSummary(known, harnesses),
    })),
  ];

  const toggle = (name: string) => {
    const next = new Set(unchecked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setUnchecked(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setError(undefined);
    try {
      const chosen: NewAgent = profile === undefined ? { settings } : { profileId: profile.id };
      const started = await api.secondOpinion(agent.taskId, {
        brief: brief.trim(),
        paths,
        reviewer: chosen,
        agentId: agent.id,
      });
      await track(agent.taskId);
      onOpenChange(false);
      setBrief(defaultBrief(agent));
      navigate({ name: "task", taskId: agent.taskId });
      onStarted?.(started.agentId);
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
            A fresh agent that has never seen this work checks {agent.name}'s files and tells you
            what it finds. It works on a copy, so nothing in your project changes.
          </Dialog.Description>
          <form onSubmit={submit} className={dialog.form}>
            <label className={dialog.label}>
              What should the reviewer check?
              <textarea
                className={styles.brief}
                rows={3}
                value={brief}
                onChange={(change) => setBrief(change.target.value)}
                required
              />
            </label>
            <fieldset className={styles.files}>
              <legend className={styles.legend}>Files it gets a copy of</legend>
              {files.error !== undefined ? (
                <p className={dialog.error}>{files.error}</p>
              ) : files.value === undefined ? (
                <p className={styles.note}>Reading the workspace…</p>
              ) : files.value.length === 0 ? (
                <p className={styles.note}>The project has nothing to examine yet.</p>
              ) : (
                files.value.map((entry) => (
                  <label key={entry.name} className={styles.file}>
                    <input
                      type="checkbox"
                      checked={!unchecked.has(entry.name)}
                      onChange={() => toggle(entry.name)}
                    />
                    <span className={styles.name}>
                      {entry.name}
                      {entry.folder ? "/" : ""}
                    </span>
                  </label>
                ))
              )}
              <p className={styles.note}>
                Copied into a new folder, without instruction files such as CLAUDE.md or AGENTS.md.
              </p>
            </fieldset>
            <div className={styles.reviewer}>
              <ChoiceMenu
                label="Reviewer"
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
            <p className={styles.note}>
              The review shows up in this task under Reviewers, beside the team.
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
              <Button
                type="submit"
                variant="primary"
                disabled={starting || brief.trim() === "" || paths.length === 0}
              >
                Send for review
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
