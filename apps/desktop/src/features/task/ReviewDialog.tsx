import type { ReviewerRecord, RoleSettings } from "@office-town/contract";
import { ChevronRight, ListChecks, Plus } from "lucide-react";
import { Dialog } from "radix-ui";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../../api/client.ts";
import { type Agent, agentsInTask } from "../../store/agents.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { approvedList, keepChecks, useChecks } from "../../store/checks.ts";
import { useDraft } from "../../store/drafts.ts";
import { track } from "../../store/live.ts";
import { closeReview, saveReviewer, useReviewers, useReviewing } from "../../store/reviewers.ts";
import { Button } from "../../ui/Button.tsx";
import dialog from "../../ui/Dialog.module.css";
import { useModels } from "../profiles/model-line.ts";
import { modelLine } from "../profiles/model-name.ts";
import { ReviewerDialog } from "../profiles/ReviewerDialog.tsx";
import { NO_MODEL_YET } from "../profiles/ReviewersSection.tsx";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./ReviewDialog.module.css";

const SAME = "same";

interface ReviewDialogProps {
  // The agent whose work is reviewed; "Same as" starts with its harness, model and effort.
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // With the reviewer's agent id, so a team view can show its work.
  onStarted?: (agentId: string) => void;
}

// What the reviewer starts from: the approved list, else the agent's checklist, else nothing (D-73).
function WhatToCheck({ agent }: { agent: Agent }) {
  const checks = useChecks(agent.taskId);
  const approved = approvedList(checks, agent.task);
  const written = agent.task.checklist;
  const items = approved?.items ?? (written?.agentId === agent.id ? written.items : []);
  const [shown, setShown] = useState(false);
  const [opened, setOpened] = useState<number>();
  if (items.length === 0) {
    return (
      <p className={styles.hint}>
        {agent.name} wrote no checklist, so the reviewer writes one. You approve it before it runs.
      </p>
    );
  }
  return (
    <div className={styles.checks}>
      <div className={styles.fold}>
        <ListChecks size={16} aria-hidden />
        <span className={styles.foldText}>
          {items.length === 1 ? "1 check" : `${items.length} checks`}
          <span>
            {approved === undefined
              ? " · the reviewer adds tricky cases, you approve the list"
              : ` · approved, run again in round ${approved.round + 1}`}
          </span>
        </span>
        <button type="button" className={styles.link} onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {shown ? (
        <ul className={styles.list}>
          {items.map((item, index) => (
            <li key={item.check} className={styles.check}>
              <button
                type="button"
                className={styles.checkRow}
                aria-expanded={opened === index}
                onClick={() => setOpened(opened === index ? undefined : index)}
              >
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={opened === index ? styles.turned : undefined}
                />
                <span className={opened === index ? styles.whole : styles.oneLine}>
                  {item.check}
                </span>
              </button>
              {opened === index ? (
                <p className={styles.expected}>
                  <b>Expected</b> {item.expected}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Three parts: the reviewer and the buttons stay put while the checklist scrolls (D-73).
export function ReviewDialog({ agent, open, onOpenChange, onStarted }: ReviewDialogProps) {
  const harnesses = useApp((state) => state.harnesses);
  const reviewers = useReviewers() ?? [];
  const [ask, setAsk] = useDraft(`review.${agent.id}`, "");
  const [chosenId, setChosenId] = useState(SAME);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const { instructions: _, autonomy: __, ...own } = agent.record.settings;
  const chosen = reviewers.find((known) => known.id === chosenId);
  // A starter's model, picked here at its first use; it starts from the agent's.
  const [picked, setPicked] = useState<RoleSettings>(own);
  const modelsOf = useModels([own, ...reviewers.flatMap((known) => known.settings ?? [])]);
  const lineOf = (settings: RoleSettings) => modelLine(settings, harnesses, modelsOf(settings));

  const reviewerSettings = async (reviewer: ReviewerRecord): Promise<RoleSettings> => {
    if (reviewer.settings !== undefined) return reviewer.settings;
    const { id, createdAt: _at, ...request } = reviewer;
    await saveReviewer(id, { ...request, settings: picked });
    return picked;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setError(undefined);
    try {
      const settings =
        chosen === undefined
          ? own
          : { ...(await reviewerSettings(chosen)), instructions: chosen.instructions };
      const started = await api.startCheck(agent.taskId, {
        reviewer: { settings },
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

  const pick = (id: string, name: string, line: string) => (
    <button
      key={id}
      type="button"
      aria-pressed={chosenId === id}
      className={styles.pick}
      onClick={() => setChosenId(id)}
    >
      <strong>{name}</strong>
      <span>{line}</span>
    </button>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.content}`}>
          <form onSubmit={submit} className={styles.form}>
            <div className={styles.head}>
              <Dialog.Title className={dialog.title}>Send for review</Dialog.Title>
              <Dialog.Description className={styles.hint}>
                A reviewer agent tests {agent.name}'s work on a temporary copy of the folder. Your
                files are not changed.
              </Dialog.Description>
              <span id="review-reviewer" className={`${styles.label} ${styles.reviewerLabel}`}>
                Reviewer
              </span>
              <div className={styles.picks}>
                {pick(SAME, `Same as ${agent.name}`, lineOf(own))}
                {reviewers.map((known) =>
                  pick(
                    known.id,
                    known.name,
                    known.settings === undefined ? NO_MODEL_YET : lineOf(known.settings),
                  ),
                )}
                <button
                  type="button"
                  className={`${styles.pick} ${styles.newPick}`}
                  onClick={() => setCreating(true)}
                >
                  <Plus size={14} aria-hidden />
                  New reviewer
                </button>
              </div>
              {chosen !== undefined && chosen.settings === undefined ? (
                <div className={styles.firstUse}>
                  <span className={styles.hint}>Model for {chosen.name}, kept for next time</span>
                  <div className={styles.chips}>
                    <SettingsChips value={picked} onChange={setPicked} />
                  </div>
                </div>
              ) : null}
            </div>
            <div className={styles.middle}>
              <span className={styles.label}>What to check</span>
              <WhatToCheck agent={agent} />
              <label className={styles.label} htmlFor="review-ask">
                Anything else to check? <span className={styles.optional}>Optional</span>
              </label>
              <textarea
                id="review-ask"
                className={styles.brief}
                value={ask}
                placeholder="For example: try it with a slow network"
                onChange={(change) => setAsk(change.target.value)}
              />
            </div>
            <div className={styles.foot}>
              {error === undefined ? null : (
                <p className={`${dialog.error} ${styles.error}`} role="alert">
                  {error}
                </p>
              )}
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={starting}>
                Send for review
              </Button>
            </div>
          </form>
          {creating ? (
            <ReviewerDialog
              reviewer={undefined}
              open
              onOpenChange={setCreating}
              onSaved={(saved) => setChosenId(saved.id)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Opened from a task's menu anywhere: Tasks, the sidebar, the Board or the task's chat.
export function ReviewDialogHost() {
  const taskId = useReviewing();
  const agents = useApp((state) => state.agents);
  const tasks = useApp((state) => state.tasks);
  const sessions = useApp((state) => state.sessions);
  const owner = useMemo(
    () => (taskId === undefined ? undefined : agentsInTask({ agents, tasks, sessions }, taskId)[0]),
    [taskId, agents, tasks, sessions],
  );
  if (taskId === undefined || owner === undefined) return null;
  return (
    <ReviewDialog
      key={taskId}
      agent={owner}
      open
      onOpenChange={(next) => {
        if (!next) closeReview();
      }}
    />
  );
}
