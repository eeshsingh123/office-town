import {
  type AutomationDraft,
  type AutomationRecord,
  type AutomationRules,
  type AutomationTask,
  automationRulesSchema,
  type LibraryItem,
} from "@office-town/contract";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { shell } from "../../shell.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { keepAutomation, useAutomation, useAutomations } from "../../store/automations.ts";
import {
  clearDrafts,
  fits,
  ignoreDraft,
  readDraft,
  useDraft,
  writeDraft,
} from "../../store/drafts.ts";
import { Button } from "../../ui/Button.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { StepRail } from "../../ui/StepRail.tsx";
import steps from "../../ui/Steps.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { Composer } from "../new-task/Composer.tsx";
import { CHIEF, SOLO } from "../new-task/targets.ts";
import { PlaceTags } from "../updates/PlaceTag.tsx";
import { usePlaces } from "../updates/places.ts";
import { eventMissing, useGitHubApp } from "./EventFields.tsx";
import styles from "./NewAutomation.module.css";
import { useWhenText, useWho } from "./parts.tsx";
import { DEFAULT_RULES, hours, RulesStep, useAskingApps } from "./RulesStep.tsx";
import { blankWhen, triggerOf, usePreview, type WhenForm, WhenStep, whenOf } from "./WhenStep.tsx";
import { localZone, promptOf, runTime, whoKey } from "./words.ts";

const STEPS = ["Describe", "Task", "When", "Rules", "Review"] as const;
const TASK = 1;
const WHEN = 2;
const RULES = 3;
const REVIEW = 4;

const targetOf = (who: string) => (who === "assistant" ? SOLO : who === "chief" ? CHIEF : who);

// The New task box keeps its own drafts; an automation's task is written into them to edit it.
function writeTask(
  box: string,
  { task, files: kept }: AutomationRecord,
  library: Record<string, LibraryItem>,
): void {
  writeDraft(`${box}.prompt`, promptOf(task));
  writeDraft(`${box}.target`, targetOf(whoKey(task)));
  const { request } = task;
  const options = {
    ...(request.efficient === undefined ? {} : { efficient: request.efficient }),
    ...(request.milestones === undefined ? {} : { milestones: request.milestones }),
  };
  writeDraft(`${box}.options`, options);
  const shared = new Set(Object.values(library).map((item) => item.file.id));
  const files = kept.map((file) => ({
    key: file.id,
    name: file.name,
    kind: file.kind,
    attachment: file,
    ...(shared.has(file.id) ? { fromLibrary: true as const } : {}),
  }));
  writeDraft(`${box}.files`, files);
  if (task.kind === "department") {
    writeDraft(`${box}.departmentWorkspaceId`, task.request.team.workspaceId);
  }
  if (task.kind !== "assistant") return;
  const { agent, autonomy, workspaceId } = task.request;
  writeDraft(`${box}.workspaceId`, workspaceId);
  writeDraft(`${box}.level`, autonomy);
  if ("profileId" in agent && agent.profileId !== undefined)
    writeDraft(`${box}.profileId`, agent.profileId);
  if (!("settings" in agent)) return;
  const { harness, environment, model, effort } = agent.settings;
  writeDraft(`${box}.harness`, harness);
  writeDraft(`${box}.choices`, {
    environment,
    recentModels: [],
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  });
}

const keptWhen = (saved: unknown) =>
  fits(saved, { mode: "", preset: "", time: "", timeZone: "", ends: { kind: "" } })
    ? (saved as WhenForm)
    : undefined;

const newRules = (resultPlaces: string[]): AutomationRules =>
  resultPlaces.length === 0 ? DEFAULT_RULES : { ...DEFAULT_RULES, sendTo: resultPlaces };

const keptRules = (saved: unknown) => {
  const parsed = automationRulesSchema.safeParse(saved);
  return parsed.success ? parsed.data : undefined;
};

// Opened from the list, or straight from a link once the list is read.
export function NewAutomationView({ edit, describe }: { edit?: string; describe?: string }) {
  const automations = useAutomations();
  const existing = useAutomation(edit ?? "");
  const gone = edit !== undefined && automations !== undefined && existing === undefined;
  useEffect(() => {
    if (gone) navigate({ name: "automations" });
  }, [gone]);
  if (edit !== undefined && existing === undefined) return null;
  return <Setup existing={existing} {...(describe === undefined ? {} : { describe })} />;
}

function Setup({
  existing,
  describe,
}: {
  existing: AutomationRecord | undefined;
  describe?: string;
}) {
  const scope = existing === undefined ? "new-automation" : `edit-automation.${existing.id}`;
  const box = `${scope}.task`;
  const library = useApp((state) => state.library);
  const harnesses = useApp((state) => state.harnesses);
  const limits = useApp((state) => state.limits);
  // An edit starts from the saved automation, once, before the box first reads its drafts.
  useState(() => {
    if (existing === undefined || readDraft(`${scope}.seeded`) === true) return;
    writeTask(box, existing, library);
    writeDraft(`${scope}.seeded`, true);
  });
  const [name, setName] = useDraft(`${scope}.name`, existing?.name ?? "");
  const [step, setStep] = useDraft<number>(
    `${scope}.step`,
    existing === undefined ? 0 : REVIEW,
    describe === undefined ? undefined : ignoreDraft,
  );
  const [reached, setReached] = useDraft<number>(
    `${scope}.reached`,
    existing === undefined ? 0 : REVIEW,
  );
  const [drafted, setDrafted] = useDraft(`${scope}.drafted`, existing !== undefined);
  const [when, setWhen] = useDraft<WhenForm>(
    `${scope}.when`,
    () => (existing === undefined ? blankWhen() : whenOf(existing.trigger)),
    keptWhen,
  );
  const [rules, setRules] = useDraft<AutomationRules>(
    `${scope}.rules`,
    // A new one sends to the usual result places, as a task's Send result does.
    () => existing?.rules ?? newRules(useApp.getState().updates.resultPlaces),
    keptRules,
  );
  const [task, setTask] = useState<AutomationTask>();
  const [taskMissing, setTaskMissing] = useState<string>();
  const [saving, setSaving] = useState<"save" | "run">();
  const [error, setError] = useState<string>();
  const [offer, setOffer] = useState<string>();
  // The box is only on its own step, so what it last handed over stands for it elsewhere.
  const [lastTask, setLastTask] = useDraft<AutomationTask | undefined>(
    `${scope}.built`,
    existing?.task,
  );
  const current = task ?? lastTask;
  const githubId = useGitHubApp()?.id;
  const trigger = triggerOf(when, githubId);
  const preview = usePreview(existing?.id, current, trigger);

  const go = (next: number) => {
    setStep(next);
    setReached(Math.max(reached, next));
  };

  const draft = async (
    notes: string[],
    drafter: Parameters<typeof api.draftAutomation>[0]["drafter"],
  ) => {
    const currentDraft: AutomationDraft | undefined =
      drafted && current !== undefined
        ? {
            name: name.trim() || "Automation",
            prompt: promptOf(current),
            who: whoKey(current),
            ...(trigger === undefined ? {} : { trigger }),
            rules,
          }
        : undefined;
    const reply = await api.draftAutomation({
      notes,
      drafter,
      timeZone: localZone(),
      ...(currentDraft === undefined ? {} : { current: currentDraft }),
    });
    const drafted_ = reply.automation;
    if (drafted_ !== undefined) {
      setName(drafted_.name);
      writeDraft(`${box}.prompt`, drafted_.prompt);
      writeDraft(`${box}.target`, targetOf(drafted_.who));
      if (drafted_.trigger !== undefined) setWhen(whenOf(drafted_.trigger));
      setRules(automationRulesSchema.parse({ ...rules, ...drafted_.rules }));
      setDrafted(true);
      setReached(REVIEW);
    }
    return reply;
  };

  const reader =
    current?.kind === "assistant" && "settings" in current.request.agent
      ? current.request.agent.settings.harness
      : undefined;
  const sharesLimits = Object.keys(limits).some(
    (accountId) => reader === undefined || accountId.startsWith(reader),
  );
  const missing =
    name.trim() === ""
      ? "Give it a name."
      : current === undefined
        ? (taskMissing ?? "Write the task each run starts with.")
        : trigger === undefined
          ? when.mode === "event"
            ? eventMissing(when.event, githubId)
            : "Choose the automation it runs after."
          : preview?.problem;

  const save = async (run: boolean) => {
    if (missing !== undefined || current === undefined || trigger === undefined) return;
    setSaving(run ? "run" : "save");
    setError(undefined);
    try {
      const request = {
        name: name.trim(),
        enabled: existing?.enabled ?? true,
        task: current,
        trigger,
        rules,
      };
      const saved =
        existing === undefined
          ? await api.createAutomation(request)
          : await api.updateAutomation(existing.id, request);
      keepAutomation(saved);
      if (run) await api.runAutomation(saved.id);
      clearDrafts(scope);
      const settings = await api.readSettings();
      const preferences = await shell?.desktopPreferences();
      if (
        existing === undefined &&
        settings.loginOffered !== true &&
        preferences?.canOpenAtLogin === true &&
        !preferences.openAtLogin
      ) {
        await api.markLoginOffered();
        setOffer(saved.id);
        return;
      }
      navigate({ name: "automation", automationId: saved.id });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(undefined);
    }
  };

  return (
    <section
      className={steps.setup}
      aria-label={existing === undefined ? "New automation" : "Edit automation"}
    >
      <StepRail
        back={{ label: "Back to Automations", onClick: () => navigate({ name: "automations" }) }}
        title={existing === undefined ? "New automation" : existing.name}
        note={<DraftNote scope={scope} />}
        steps={STEPS}
        step={step}
        reached={reached}
        allDone={existing !== undefined}
        onGo={go}
      />
      <div className={`${steps.setupBody} ${steps.wide}`}>
        <div className={`${page.main} ${styles.column}`}>
          <header className={page.header}>
            <h2 className={page.title}>
              {step === 0
                ? "Describe what should happen and when"
                : step === TASK
                  ? "The task each run starts"
                  : step === WHEN
                    ? "When it runs"
                    : step === RULES
                      ? "Rules"
                      : existing === undefined
                        ? "Review and save"
                        : "Review and save changes"}
            </h2>
            {step === REVIEW ? null : (
              <p className={page.lead}>
                {step === 0
                  ? "Say what each run does, who does it and when. It fills in every later step."
                  : step === TASK
                    ? "The same box as New task. Type @ for who does it, an app, or a fill-in such as today's date."
                    : step === WHEN
                      ? "Pick what starts each run."
                      : "What a run does when its team is busy, Office Town was closed, or it waits for you."}
              </p>
            )}
          </header>

          {step === 0 ? (
            <>
              <DraftBox
                name={`${scope}.box`}
                label="Describe the automation"
                placeholder="For example: every Monday at 9:00, the Content team plans the week's posts from last week's results."
                action="Draft it"
                drafted={drafted}
                changePlaceholder="Change something, for example: run it at 8:00 instead"
                {...(describe === undefined ? {} : { initial: describe })}
                run={draft}
              />
              {drafted && current !== undefined && trigger !== undefined ? (
                <Summary name={name} task={current} trigger={trigger} />
              ) : null}
              <div className={page.row}>
                {drafted ? (
                  <Button variant="primary" onClick={() => go(REVIEW)}>
                    Review
                    <ArrowRight size={15} aria-hidden />
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => go(TASK)}>
                    Set it up by hand instead
                  </Button>
                )}
              </div>
            </>
          ) : null}

          {step === TASK ? (
            <>
              <label className={form.field}>
                <span className={form.label}>Name</span>
                <input
                  className={form.input}
                  value={name}
                  maxLength={80}
                  placeholder="For example: Weekly posts plan"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <Composer
                automation={{
                  draft: box,
                  onChange: (built, problem) => {
                    setTask(built);
                    setTaskMissing(problem);
                    if (built !== undefined) setLastTask(built);
                  },
                }}
              />
            </>
          ) : null}

          {step === WHEN ? (
            <WhenStep id={existing?.id} value={when} onChange={setWhen} task={current} />
          ) : null}

          {step === RULES ? (
            <RulesStep
              value={rules}
              onChange={setRules}
              sharesLimits={sharesLimits && harnesses.length > 0}
              savesResult={current?.kind !== "chief"}
            />
          ) : null}

          {step === REVIEW ? (
            <Review
              name={name}
              task={current}
              rules={rules}
              trigger={trigger}
              nextRuns={preview?.nextRuns ?? []}
              warning={preview?.warning}
              onEdit={go}
            />
          ) : null}

          {error === undefined ? null : (
            <p className={page.error} role="alert">
              {error}
            </p>
          )}
          {step === 0 ? null : (
            <div className={page.row}>
              <Button variant="ghost" onClick={() => go(step - 1)}>
                Back
              </Button>
              {step < REVIEW ? (
                <Button variant="primary" onClick={() => go(step + 1)}>
                  Continue
                  <ArrowRight size={15} aria-hidden />
                </Button>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={() => void save(false)}
                    disabled={missing !== undefined || saving !== undefined}
                    busy={saving === "save"}
                  >
                    {existing === undefined ? "Save" : "Save changes"}
                  </Button>
                  <Button
                    onClick={() => void save(true)}
                    disabled={missing !== undefined || saving !== undefined}
                    busy={saving === "run"}
                  >
                    Save and run now
                  </Button>
                </>
              )}
              {step === REVIEW && missing !== undefined ? (
                <span className={page.hint}>{missing}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={offer !== undefined}
        onOpenChange={(open) => {
          if (open || offer === undefined) return;
          const automationId = offer;
          setOffer(undefined);
          navigate({ name: "automation", automationId });
        }}
        title="Open Office Town when you sign in?"
        description="Automations run only while Office Town is open. Opening it at sign-in keeps them running after a restart. You can change this in Settings."
        confirmLabel="Open at sign-in"
        onConfirm={async () => {
          await shell?.setOpenAtLogin(true);
        }}
      />
    </section>
  );
}

function Summary({
  name,
  task,
  trigger,
}: {
  name: string;
  task: AutomationTask;
  trigger: NonNullable<ReturnType<typeof triggerOf>>;
}) {
  const who = useWho(task);
  const when = useWhenText({ trigger });
  return (
    <div className={styles.block}>
      <strong>{name || "Automation"}</strong>
      <span className={styles.meta}>
        {who.name} · {when}
      </span>
      <p className={styles.prompt}>{promptOf(task)}</p>
    </div>
  );
}

function Review({
  name,
  task,
  rules,
  trigger,
  nextRuns,
  warning,
  onEdit,
}: {
  name: string;
  task: AutomationTask | undefined;
  rules: AutomationRules;
  trigger: ReturnType<typeof triggerOf>;
  nextRuns: string[];
  warning: string | undefined;
  onEdit: (step: number) => void;
}) {
  const who = useWho(task ?? { kind: "chief", request: { goal: "" } });
  const when = useWhenText({
    trigger: trigger ?? { kind: "after", automationId: "", outcome: "done" },
  });
  const answer = rules.answerWithinHours;
  const allowed = rules.appsWithoutAsking ?? [];
  const freeApps = useAskingApps(allowed)
    .filter(({ key }) => allowed.includes(key))
    .map(({ name }) => name);
  const sendTo = (usePlaces() ?? []).filter((place) => rules.sendTo?.includes(place.id) === true);
  return (
    <div className={styles.review}>
      <p className={styles.sentence}>
        <strong>{name.trim() || "This automation"}</strong>
        <span>
          {task === undefined ? "No task yet" : who.name} ·{" "}
          {trigger === undefined ? "No time yet" : when}
        </span>
      </p>
      {warning === undefined ? null : (
        <p className={styles.warning} role="status">
          {warning} Both can be saved.
        </p>
      )}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <strong>Task</strong>
          <Button variant="ghost" onClick={() => onEdit(TASK)}>
            Edit
          </Button>
        </div>
        <p className={styles.prompt}>{task === undefined ? "Not written yet." : promptOf(task)}</p>
      </div>
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <strong>When</strong>
          <Button variant="ghost" onClick={() => onEdit(WHEN)}>
            Edit
          </Button>
        </div>
        <span>{trigger === undefined ? "Not set yet." : when}</span>
        {nextRuns.length === 0 ? null : (
          <span className={styles.meta}>Next: {nextRuns.map((at) => runTime(at)).join(", ")}</span>
        )}
      </div>
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <strong>Rules</strong>
          <Button variant="ghost" onClick={() => onEdit(RULES)}>
            Edit
          </Button>
        </div>
        <ul className={styles.facts}>
          <li>
            {rules.decisions === "auto"
              ? "Auto decides, without asking you"
              : "Asks you in Needs you"}
          </li>
          <li>Waits up to {hours(rules.waitHours)} for a busy team</li>
          <li>
            {rules.catchUpHours === 0
              ? "Skips a run missed while closed"
              : `Catches up within ${hours(rules.catchUpHours)} after a close`}
          </li>
          <li>
            {answer === null
              ? "Waits for an answer as long as it takes"
              : `Ends a run after ${hours(answer)} without an answer`}
          </li>
          {freeApps.length === 0 ? null : (
            <li>
              Changes in {new Intl.ListFormat("en").format(freeApps)} go through without asking
            </li>
          )}
          {sendTo.length === 0 ? null : (
            <li>
              Sends results to <PlaceTags places={sendTo} />
            </li>
          )}
          <li>{rules.review ? "You review each run" : "A finished run counts as Done"}</li>
          {rules.saveResult && task?.kind !== "chief" ? (
            <li>Saves each result to the Library</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
