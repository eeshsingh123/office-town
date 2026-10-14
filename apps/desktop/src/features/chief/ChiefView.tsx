import type { TaskState } from "@office-town/contract";
import { CircleHelp, Settings } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { track } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { taskTitle } from "../../ui/format.ts";
import { Guide, useGuideHidden } from "../../ui/Guide.tsx";
import page from "../../ui/Page.module.css";
import { useModelLine } from "../profiles/model-line.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { CHIEF_STEPS } from "../team/guides.tsx";
import styles from "./Chief.module.css";
import { ChiefSetup } from "./ChiefSetup.tsx";
import { DepartmentList } from "./DepartmentList.tsx";
import { useChief } from "./use-chief.ts";

const GOAL_STATE: Record<TaskState, string> = {
  queued: "Waiting its turn",
  working: "Working",
  waiting: "Needs you",
  idle: "Paused",
  ended: "Done",
};

function GoalBox({ name }: { name: string }) {
  const [goal, setGoal] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const give = async (event: FormEvent) => {
    event.preventDefault();
    const text = goal.trim();
    if (text === "" || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const { task } = await api.startChiefTask(text);
      await track(task.id);
      setGoal("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    setSending(false);
  };
  return (
    <form className={styles.goalBox} onSubmit={give} data-tour="chief-goal">
      <label htmlFor="chief-goal" className="visually-hidden">
        Give {name} a goal
      </label>
      <input
        id="chief-goal"
        className={styles.goalInput}
        value={goal}
        placeholder="Give it a goal, for example: launch a pricing page with the new plans"
        onChange={(change) => setGoal(change.target.value)}
      />
      <Button type="submit" variant="primary" disabled={goal.trim() === "" || sending}>
        {sending ? "Sending…" : `Give to ${name}`}
      </Button>
      {error === undefined ? null : (
        <p className={styles.goalError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function RemoveChief({ name, busy }: { name: string; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.danger} aria-labelledby="remove-chief-title">
      <div className={styles.dangerText}>
        <strong id="remove-chief-title">Remove chief</strong>
        <span className={page.hint}>
          {busy
            ? "Stop its goal first."
            : "Departments, their agents and past goals stay. You can set up a new chief later."}
        </span>
      </div>
      <Button onClick={() => setOpen(true)} disabled={busy}>
        Remove chief…
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove ${name}?`}
        description="Its past goals stay in Tasks and departments keep working. This cannot be undone."
        confirmLabel="Remove"
        onConfirm={async () => {
          await api.removeChief();
          useApp.setState({ chiefId: undefined });
          navigate({ name: "team" });
        }}
      />
    </section>
  );
}

function ChiefHome() {
  const chief = useChief();
  const [guideHidden, setGuideHidden] = useGuideHidden("chief");
  const summary = useModelLine(chief?.record.settings);
  const waiting = useApp((state) =>
    Object.values(state.waiting).find(
      ({ event }) => state.sessions[event.sessionId]?.agentId === chief?.record.id,
    ),
  );
  if (chief === undefined) return null;
  const { record, busy, current, queue } = chief;
  const rules = (record.settings.instructions ?? "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const status = waiting !== undefined ? "Needs you" : busy ? "Working" : "Ready";

  return (
    <section className={page.page} aria-labelledby="chief-title">
      <div className={styles.home}>
        <header className={styles.homeHead}>
          <Avatar name={record.name} colour={record.colour} size={56} />
          <div className={styles.homeName}>
            <div className={page.row}>
              <h1 id="chief-title" className={page.title}>
                {record.name}
              </h1>
              <span
                className={`${styles.status} ${waiting !== undefined ? styles.statusWaiting : ""}`}
              >
                {status}
              </span>
            </div>
            <span className={page.hint}>Chief</span>
          </div>
          {guideHidden ? (
            <Button variant="ghost" onClick={() => setGuideHidden(false)}>
              <CircleHelp size={14} aria-hidden />
              How your chief works
            </Button>
          ) : null}
          <Button onClick={() => navigate({ name: "chief", edit: true })}>
            <Settings size={14} aria-hidden />
            Settings
          </Button>
        </header>

        {guideHidden ? null : (
          <Guide
            id="chief-guide"
            title="How your chief works"
            intro="Use the chief when a goal needs more than one department. For one department's work, give the task to that department."
            steps={CHIEF_STEPS}
            onHide={() => setGuideHidden(true)}
          />
        )}

        <GoalBox name={record.name} />

        <div className={styles.homeGrid}>
          <div className={page.main}>
            <section
              className={`${page.panel} ${waiting !== undefined ? styles.needsYou : ""}`}
              aria-labelledby="now-title"
            >
              <span id="now-title" className={page.eyebrow}>
                {busy ? "Working on now" : current === undefined ? "Goals" : "Last goal"}
              </span>
              {current === undefined ? (
                <span className={page.hint}>No goals yet.</span>
              ) : (
                <>
                  <div className={styles.goalHead}>
                    <span className={page.panelTitle}>{taskTitle(current.prompt)}</span>
                    <span className={page.hint}>{GOAL_STATE[current.state]}</span>
                  </div>
                  {waiting === undefined ? null : (
                    <RequestCard key={waiting.event.id} event={waiting.event} />
                  )}
                  <div>
                    <Button onClick={() => navigate({ name: "task", taskId: current.id })}>
                      Open the goal
                    </Button>
                  </div>
                </>
              )}
            </section>
            {queue.length === 0 ? null : (
              <section className={page.panel} aria-labelledby="queue-title">
                <span id="queue-title" className={page.eyebrow}>
                  Up next · {queue.length === 1 ? "1 goal" : `${queue.length} goals`}
                </span>
                <ol className={styles.queue}>
                  {queue.map((task) => (
                    <li key={task.id}>
                      <span>{taskTitle(task.prompt)}</span>
                      <span className={page.hint}>Waiting its turn</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          <aside className={page.aside}>
            <section className={page.panel} aria-labelledby="departments-title">
              <span id="departments-title" className={page.eyebrow}>
                Departments it can use
              </span>
              <DepartmentList />
            </section>
            <section className={page.panel} aria-labelledby="rules-title">
              <div className={page.sectionHead}>
                <span id="rules-title" className={page.eyebrow}>
                  Planning rules
                </span>
                <button
                  type="button"
                  className={styles.edit}
                  onClick={() => navigate({ name: "chief", edit: true })}
                >
                  Edit
                </button>
              </div>
              {rules.length === 0 ? (
                <span className={page.hint}>None yet.</span>
              ) : (
                <ul className={styles.rulesList}>
                  {rules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              )}
              <span className={page.hint}>{summary}</span>
            </section>
          </aside>
        </div>
        <RemoveChief name={record.name} busy={busy || queue.length > 0} />
      </div>
    </section>
  );
}

export function ChiefView({ edit }: { edit: boolean }) {
  const chiefId = useApp((state) => state.chiefId);
  return chiefId === undefined || edit ? <ChiefSetup /> : <ChiefHome />;
}
