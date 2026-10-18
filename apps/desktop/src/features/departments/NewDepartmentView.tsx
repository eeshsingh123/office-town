import type { Autonomy, RoleSettings } from "@office-town/contract";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { useWorkspaces } from "../../store/workspaces.ts";
import { AutonomyChoice } from "../../ui/AutonomyChoice.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { StepRail } from "../../ui/StepRail.tsx";
import steps from "../../ui/Steps.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { selectRoom } from "../office/office-state.ts";
import { WorkspacePicker } from "../workspaces/WorkspacePicker.tsx";
import { MemberEditor } from "./MemberEditor.tsx";
import styles from "./NewDepartment.module.css";
import { TeamCard } from "./TeamCard.tsx";
import {
  blankDepartment,
  type DepartmentForm,
  draftOfForm,
  formOfDraft,
  missingIn,
  teamOf,
} from "./team-form.ts";

const STEPS = ["Describe", "Team", "Rules and permissions", "Review"] as const;

// Departments from the user's words or built by hand; nothing is saved until Create.
export function NewDepartmentView({ describe, byHand }: { describe?: string; byHand: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useWorkspaces() ?? [];
  const defaults: RoleSettings = {
    harness: harnesses[0]?.harness ?? "claude",
    environment: { kind: "native" },
  };
  const [forms, setForms] = useState<DepartmentForm[]>(() => [blankDepartment(defaults)]);
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [step, setStep] = useState(byHand ? 1 : 0);
  const [reached, setReached] = useState(byHand ? 1 : 0);
  const [drafted, setDrafted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const current = forms[at] ?? forms[0];
  const workspaceOf = (one: DepartmentForm) =>
    workspaces.find((known) => known.id === (one.workspaceId ?? workspaces[0]?.id));
  const change = (next: Partial<DepartmentForm>) =>
    setForms(forms.map((one, index) => (index === at ? { ...one, ...next } : one)));
  const setAutonomy = (autonomy: Autonomy) => change({ autonomy });
  const gate = useBypassGate(
    current?.autonomy ?? "full",
    setAutonomy,
    current?.name.trim() || "the department",
  );
  const missing =
    forms.map(missingIn).find((reason) => reason !== undefined) ??
    (forms.some((one) => workspaceOf(one) === undefined)
      ? "Choose the workspace each department works in."
      : undefined);

  const go = (next: number) => {
    setStep(next);
    setReached(Math.max(reached, next));
  };

  const draft = async (notes: string[], drafter: RoleSettings) => {
    const reply = await api.draftDepartments({
      notes,
      drafter,
      ...(drafted ? { current: forms.map(draftOfForm) } : {}),
    });
    if (reply.departments.length > 0) {
      setForms(reply.departments.map((one, index) => formOfDraft(one, forms[index])));
      setAt(0);
      setSelected({});
      setDrafted(true);
      setReached(Math.max(reached, STEPS.length - 1));
    }
    return reply;
  };

  const create = async () => {
    if (missing !== undefined || saving) return;
    setSaving(true);
    setError(undefined);
    const left = [...forms];
    let first: string | undefined;
    try {
      while (left.length > 0) {
        const one = left[0];
        const workspace = one === undefined ? undefined : workspaceOf(one);
        if (one === undefined || workspace === undefined) break;
        const department = await api.createDepartment({
          team: teamOf(one),
          workspaceId: workspace.id,
          autonomy: one.autonomy,
          lead: {
            settings: one.lead.settings,
            ...(one.lead.profileId === undefined ? {} : { profileId: one.lead.profileId }),
          },
          purpose: one.purpose.trim(),
          rules: one.rules,
        });
        first ??= department.id;
        left.shift();
      }
      if (first !== undefined) selectRoom(first);
    } catch (failure) {
      // What was created stays created; only the rest is left to try again.
      setForms(left);
      setAt(0);
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  if (current === undefined) return null;
  const switcher =
    forms.length < 2 ? null : (
      <div className={styles.switcher}>
        {forms.map((one, index) => (
          <button
            key={one.key}
            type="button"
            className={form.chip}
            aria-pressed={index === at}
            onClick={() => setAt(index)}
          >
            {one.name.trim() || `Department ${index + 1}`}
          </button>
        ))}
      </div>
    );

  return (
    <section className={steps.setup} aria-label="New department">
      <StepRail
        back={{ label: "Back to Team", onClick: () => navigate({ name: "team" }) }}
        title="New department"
        steps={STEPS}
        step={step}
        reached={reached}
        onGo={go}
      />
      <div className={steps.setupBody}>
        <div className={page.main}>
          <header className={page.header}>
            <span className={steps.stepCount}>
              Step {step + 1} of {STEPS.length}
            </span>
            <h2 className={page.title}>
              {step === 0
                ? "Describe the team you need"
                : step === 1
                  ? "Who is on the team"
                  : step === 2
                    ? "Rules and permissions"
                    : forms.length > 1
                      ? `Review ${forms.length} departments`
                      : "Review and create"}
            </h2>
            <p className={page.lead}>
              {step === 0
                ? "Say who leads, who else is on the team and what each person does. You review everything before it's created."
                : step === 1
                  ? "The lead splits each task among the members. Pick a person to set their role, instructions and model."
                  : step === 2
                    ? "Where the team works, the rules every member follows, and what it may do without asking you."
                    : "Nothing is created until you press Create."}
            </p>
          </header>

          {step === 0 ? (
            <>
              <DraftBox
                label="Describe the team"
                placeholder="For example: I need a team of 3 to build landing pages. A lead on Opus plans the work, a developer on a free model writes the code, and a reviewer checks it."
                action="Draft team"
                drafted={drafted}
                {...(describe === undefined ? {} : { initial: describe })}
                run={draft}
              />
              {drafted ? (
                <div className={styles.drafts}>
                  {forms.map((one) => (
                    <TeamCard key={one.key} form={one} />
                  ))}
                </div>
              ) : null}
              <div className={page.row}>
                {drafted ? (
                  <Button variant="primary" onClick={() => go(1)}>
                    Review and edit
                    <ArrowRight size={15} aria-hidden />
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => go(1)}>
                    Build it by hand instead
                  </Button>
                )}
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              {switcher}
              <div className={styles.pair}>
                <label className={form.field}>
                  <span className={form.label}>Name</span>
                  <input
                    className={form.input}
                    value={current.name}
                    placeholder="For example: Website"
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </label>
                <label className={form.field}>
                  <span className={form.label}>What it's for</span>
                  <input
                    className={form.input}
                    value={current.purpose}
                    placeholder="One line; the chief reads it when it plans"
                    onChange={(event) => change({ purpose: event.target.value })}
                  />
                </label>
              </div>
              <MemberEditor
                team={current}
                onChange={(team) => change(team)}
                selected={selected[current.key] ?? current.lead.key}
                onSelect={(key) => setSelected({ ...selected, [current.key]: key })}
                defaults={current.lead.settings}
              />
            </>
          ) : null}

          {step === 2 ? (
            <>
              {switcher}
              <section className={page.section}>
                <WorkspacePicker
                  value={workspaceOf(current)?.id}
                  onChange={(workspaceId) => change({ workspaceId })}
                  warnShared
                />
              </section>
              <label className={form.field}>
                <span className={form.label}>Team rules</span>
                <span className={form.hint}>Every member follows these, on every task.</span>
                <textarea
                  className={form.input}
                  value={current.rules}
                  placeholder="For example: Use TypeScript. Write a test for each new page."
                  onChange={(event) => change({ rules: event.target.value })}
                />
              </label>
              <section className={page.section}>
                <h3 className={page.sectionTitle}>Permissions</h3>
                <AutonomyChoice
                  name="department-level"
                  value={current.autonomy}
                  onChoose={gate.choose}
                />
              </section>
            </>
          ) : null}

          {step === 3 ? (
            <div className={styles.drafts}>
              {forms.map((one) => (
                <TeamCard
                  key={one.key}
                  form={one}
                  footer={
                    <p className={styles.facts}>
                      {workspaceOf(one)?.name ?? "No workspace"} · {AUTONOMY[one.autonomy].label}
                      {one.rules.trim() === "" ? "" : " · Team rules set"}
                    </p>
                  }
                />
              ))}
            </div>
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
              {step < STEPS.length - 1 ? (
                <Button variant="primary" onClick={() => go(step + 1)}>
                  Continue
                  <ArrowRight size={15} aria-hidden />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={create}
                  disabled={missing !== undefined || saving}
                >
                  {saving
                    ? "Creating…"
                    : forms.length > 1
                      ? `Create ${forms.length} departments`
                      : `Create ${current.name.trim() || "department"}`}
                </Button>
              )}
              {step === STEPS.length - 1 && missing !== undefined ? (
                <span className={page.hint}>{missing}</span>
              ) : null}
            </div>
          )}
        </div>

        <aside className={page.aside}>
          {step === 0 || step === 3 ? null : <TeamCard form={current} />}
        </aside>
      </div>
      {gate.confirm}
    </section>
  );
}
