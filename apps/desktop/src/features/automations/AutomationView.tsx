import type {
  AutomationRecord,
  AutomationRun,
  RunPage,
  RunTab,
  Trigger,
} from "@office-town/contract";
import { CircleMinus, Clock, Eye, Pencil, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useAutomation } from "../../store/automations.ts";
import { onChange, track } from "../../store/live.ts";
import { MoreMenu } from "../../ui/ActionMenu.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { Crumbs } from "../../ui/Crumbs.tsx";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import icons from "../../ui/StatusIcon.module.css";
import { TabRow } from "../../ui/TabRow.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { TaskStatusIcon } from "../tasks/TaskStatusIcon.tsx";
import styles from "./Automations.module.css";
import {
  AutomationStatus,
  automationMenu,
  runNow,
  turn,
  useWhenText,
  useWho,
  WhoAvatar,
} from "./parts.tsx";
import { eventsText, RUN_LABELS, runTime } from "./words.ts";

const PAGE = 50;
const REREAD_MS = 300;

function RunStatus({ run }: { run: AutomationRun }) {
  const label = RUN_LABELS[run.status];
  const icon =
    run.status === "waiting" ? (
      <Clock size={14} aria-hidden className={`${icons.icon} ${icons.quiet}`} />
    ) : run.status === "skipped" ? (
      <CircleMinus size={14} aria-hidden className={`${icons.icon} ${icons.quiet}`} />
    ) : (
      <TaskStatusIcon status={run.status} />
    );
  return (
    <span className={`${styles.status} ${run.status === "needs" ? styles.needs : ""}`}>
      {icon}
      {label}
    </span>
  );
}

// What started an event run, when nothing else needs saying.
function noteOf(run: AutomationRun, trigger: Trigger): string | undefined {
  if (run.reason !== undefined) return run.reason;
  if (trigger.kind !== "event" || run.events === undefined) return undefined;
  return eventsText(trigger.source, run.events);
}

function RunRow({ run, trigger }: { run: AutomationRun; trigger: Trigger }) {
  const [cancelling, setCancelling] = useState(false);
  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancelRun(run.id);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : String(failure));
      setCancelling(false);
    }
  };
  const { taskId } = run;
  return (
    <li className={styles.runRow}>
      <span className={styles.number}>Run {run.number}</span>
      <span className={`${styles.line} ${styles.when}`}>{runTime(run.scheduledFor)}</span>
      <RunStatus run={run} />
      <span className={styles.reason} title={run.reason}>
        {noteOf(run, trigger)}
      </span>
      {run.status === "waiting" ? (
        <Button variant="ghost" onClick={cancel} busy={cancelling}>
          Cancel
        </Button>
      ) : taskId !== undefined ? (
        <Button
          variant="ghost"
          onClick={async () => {
            await track(taskId);
            navigate({ name: "task", taskId });
          }}
        >
          Open task
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}

// The first page is read again as runs change; "Show more" pages back by run number.
function useRuns(
  automationId: string,
  tab: RunTab,
): {
  page: RunPage | undefined;
  more: () => void;
} {
  const [loaded, setLoaded] = useState<RunPage>();
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Another tab or automation starts from its own first page.
    setLoaded(undefined);
    const read = () => {
      api
        .listRuns(automationId, { tab, limit: PAGE })
        .then((first) => {
          if (!current) return;
          // Pages loaded with Show more stay; only the newest page is read again.
          setLoaded((before) => {
            const last = first.runs.at(-1)?.number;
            const older = before?.runs.filter((run) => last !== undefined && run.number < last);
            if (before === undefined || older === undefined || older.length === 0) return first;
            return { ...first, runs: [...first.runs, ...older], next: before.next };
          });
        })
        .catch((failure: unknown) => console.error("Could not read the runs.", failure));
    };
    read();
    const stop = onChange((change) => {
      if (change.type !== "run" || change.run.automationId !== automationId) return;
      clearTimeout(timer);
      timer = setTimeout(read, REREAD_MS);
    });
    return () => {
      current = false;
      clearTimeout(timer);
      stop();
    };
  }, [automationId, tab]);
  const more = () => {
    if (loaded?.next === undefined) return;
    api
      .listRuns(automationId, { tab, limit: PAGE, before: loaded.next })
      .then((next) => setLoaded({ ...next, runs: [...loaded.runs, ...next.runs] }))
      .catch((failure: unknown) => showToast(String(failure)));
  };
  return { page: loaded, more };
}

// What waits on the user, as the one banner with its one fix.
function Banner({ automation }: { automation: AutomationRecord }) {
  const { paused } = automation;
  if (paused === undefined) return null;
  const fix =
    paused.fix === "turn-on" ? (
      <Button onClick={() => void turn(automation, true)}>Turn on again</Button>
    ) : paused.fix === "sign-in" ? (
      <Button onClick={() => navigate({ name: "providers" })}>Sign in</Button>
    ) : (
      <Button onClick={() => navigate({ name: "new-automation", edit: automation.id })}>
        Edit
      </Button>
    );
  return (
    <div className={styles.banner} role="status">
      <span>Paused. {paused.reason}</span>
      {fix}
    </div>
  );
}

function Chips({ automation }: { automation: AutomationRecord }) {
  const who = useWho(automation.task);
  const when = useWhenText(automation);
  const departments = useApp((state) => state.departments);
  const { task } = automation;
  const level =
    task.kind === "assistant"
      ? task.request.autonomy
      : task.kind === "department"
        ? departments[task.request.team.departmentId]?.autonomy
        : undefined;
  return (
    <div className={styles.chips}>
      <span className={styles.chip}>
        <WhoAvatar task={task} size={18} />
        {who.name}
      </span>
      <span className={styles.chip}>
        <Clock size={13} aria-hidden />
        {when}
      </span>
      {level === undefined ? null : (
        <span className={styles.chip}>
          <ShieldCheck size={13} aria-hidden />
          {AUTONOMY[level].label}
        </span>
      )}
      {automation.lastLook === undefined ? null : (
        <span className={styles.chip} title="Its last look for something new">
          <Eye size={13} aria-hidden />
          Looked {runTime(automation.lastLook.at).toLowerCase()}:{" "}
          {automation.lastLook.found === 0 ? "nothing new" : `${automation.lastLook.found} new`}
        </span>
      )}
      {automation.rules.decisions === "auto" ? (
        <span className={styles.chip} title="Decides on its own, end to end">
          <Sparkles size={13} aria-hidden />
          Decisions: Auto
        </span>
      ) : null}
    </div>
  );
}

export function AutomationView({ automationId }: { automationId: string }) {
  const automation = useAutomation(automationId);
  const [tab, setTab] = useState<RunTab>("all");
  const { page: runs, more } = useRuns(automationId, tab);
  if (automation === undefined) {
    return (
      <div className={page.page}>
        <section className={page.list}>
          <Crumbs items={[{ label: "Automations", view: { name: "automations" } }]} />
        </section>
      </div>
    );
  }
  const counts = runs?.counts;
  return (
    <div className={page.page}>
      <section className={page.list} aria-labelledby="automation-title">
        <PageHeader
          id="automation-title"
          above={<Crumbs items={[{ label: "Automations", view: { name: "automations" } }]} />}
          title={automation.name}
          lead={<AutomationStatus automation={automation} />}
          actions={
            <>
              <Button onClick={() => void runNow(automation)}>
                <Play size={14} aria-hidden />
                Run now
              </Button>
              <Button onClick={() => navigate({ name: "new-automation", edit: automation.id })}>
                <Pencil size={14} aria-hidden />
                Edit
              </Button>
              <MoreMenu
                label={`More for ${automation.name}`}
                menu={() => automationMenu(automation, true)}
              />
            </>
          }
        />
        <Chips automation={automation} />
        <Banner automation={automation} />
        <section className={page.section} aria-label="Runs">
          <TabRow
            label="Runs by status"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "all", label: "All", count: counts?.all },
              { value: "finished", label: "Finished", count: counts?.finished },
              { value: "failed", label: "Failed", count: counts?.failed },
              { value: "skipped", label: "Skipped", count: counts?.skipped },
            ]}
          />
          {runs === undefined ? null : runs.runs.length === 0 ? (
            <p className={styles.empty}>
              {tab === "all" ? "No runs yet. Run now to try it." : "None here."}
            </p>
          ) : (
            <ul className={styles.rows} aria-label="Runs">
              {runs.runs.map((run) => (
                <RunRow key={run.id} run={run} trigger={automation.trigger} />
              ))}
            </ul>
          )}
          {runs?.next === undefined ? null : (
            <div className={page.row}>
              <Button variant="ghost" onClick={more}>
                Show more
              </Button>
            </div>
          )}
          <div className={page.row}>
            <Button
              variant="ghost"
              onClick={() => navigate({ name: "tasks", startedBy: automation.id })}
            >
              See its tasks in Tasks
            </Button>
          </div>
        </section>
      </section>
    </div>
  );
}
