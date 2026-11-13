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
// Any number of checks open at once; Expand all opens or closes them together.
function WhatToCheck({ agent }: { agent: Agent }) {
  const checks = useChecks(agent.taskId);
  const approved = approvedList(checks, agent.task);
  const written = agent.task.checklist;
  const items = approved?.items ?? (written?.agentId === agent.id ? written.items : []);
  const [shown, setShown] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  if (items.length === 0) {
    return (
      <p className={styles.hint}>No checklist yet. The reviewer writes one for you to approve.</p>
    );
  }
  const allOpen = opened.size === items.length;
  const toggle = (index: number) => {
    const next = new Set(opened);
    if (!next.delete(index)) next.add(index);
    setOpened(next);
  };
  return (
    <div className={styles.checks}>
      <div className={styles.fold}>
        <ListChecks size={16} aria-hidden />
        <span className={styles.foldText}>
          {items.length === 1 ? "1 check" : `${items.length} checks`}
          {approved === undefined ? null : <span> · approved in round {approved.round}</span>}
        </span>
        {shown && items.length > 1 ? (
          <button
            type="button"
            className={styles.link}
            onClick={() => setOpened(allOpen ? new Set() : new Set(items.keys()))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
        <button type="button" className={styles.link} onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {shown ? (
        <ul className={styles.list}>
          {items.map((item, index) => {
            const open = opened.has(index);
            return (
              <li key={item.check} className={styles.check}>
                <button
                  type="button"
                  className={styles.checkRow}
                  aria-expanded={open}
                  onClick={() => toggle(index)}
                >
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className={open ? styles.turned : undefined}
                  />
                  <span className={open ? styles.whole : styles.oneLine}>{item.check}</span>
                </button>
                {open ? (
                  <p className={styles.expected}>
                    <b>Expected</b> {item.expected}
                  </p>
                ) : null}
              </li>
            );
          })}
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
  // Models changed here, saved to the reviewer when the check starts. A reviewer without a model
  // starts from the agent's.
  const [changed, setChanged] = useState<Record<string, RoleSettings>>({});
  const settingsOf = (reviewer: ReviewerRecord) => changed[reviewer.id] ?? reviewer.settings ?? own;
  const modelsOf = useModels([own, ...reviewers.map(settingsOf)]);
  const lineOf = (settings: RoleSettings) => modelLine(settings, harnesses, modelsOf(settings));

  const reviewerSettings = async (reviewer: ReviewerRecord): Promise<RoleSettings> => {
    const settings = settingsOf(reviewer);
    if (reviewer.settings !== undefined && changed[reviewer.id] === undefined) return settings;
    const { id, createdAt: _at, ...request } = reviewer;
    await saveReviewer(id, { ...request, settings });
    return settings;
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
        <Dialog.Content
          className={`${dialog.content} ${styles.content}`}
          aria-describedby={undefined}
        >
          <form onSubmit={submit} className={styles.form}>
            <div className={styles.head}>
              <Dialog.Title className={dialog.title}>Send for review</Dialog.Title>
              <span className={`${styles.label} ${styles.reviewerLabel}`}>Reviewer</span>
              <div className={styles.picks}>
                {pick(SAME, `Same as ${agent.name}`, lineOf(own))}
                {reviewers.map((known) => pick(known.id, known.name, lineOf(settingsOf(known))))}
                <button
                  type="button"
                  className={`${styles.pick} ${styles.newPick}`}
                  onClick={() => setCreating(true)}
                >
                  <Plus size={14} aria-hidden />
                  New reviewer
                </button>
              </div>
              {chosen === undefined ? null : (
                <div className={styles.chosen}>
                  <span className={styles.chosenText}>
                    {chosen.description === "" ? chosen.name : chosen.description}
                  </span>
                  <div className={styles.chips}>
                    <SettingsChips
                      value={settingsOf(chosen)}
                      onChange={(next) => setChanged({ ...changed, [chosen.id]: next })}
                    />
                  </div>
                </div>
              )}
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
