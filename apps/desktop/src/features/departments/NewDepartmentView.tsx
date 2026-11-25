import type { Autonomy, DraftPerson, RoleSettings } from "@office-town/contract";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { clearDrafts, ignoreDraft, readDraft, useDraft } from "../../store/drafts.ts";
import { defaultWorkspace, useWorkspaces } from "../../store/workspaces.ts";
import { AutonomyChoice } from "../../ui/AutonomyChoice.tsx";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { useBypassGate } from "../../ui/BypassDialog.tsx";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import { LineField } from "../../ui/LineField.tsx";
import page from "../../ui/Page.module.css";
import { PointsField } from "../../ui/PointsField.tsx";
import { StepRail } from "../../ui/StepRail.tsx";
import steps from "../../ui/Steps.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { NoProvider, useNoProvider } from "../new-task/NoProvider.tsx";
import { selectRoom } from "../office/office-state.ts";
import { powerSettings, useReadyHarnesses } from "../ready-made/models.ts";
import { ReadyCards } from "../ready-made/ReadyCards.tsx";
import { READY_TEAMS, type ReadyPerson } from "../ready-made/teams.ts";
import { defaultLevel } from "../task/task-options.ts";
import { DepartmentWorkspaces } from "./DepartmentWorkspaces.tsx";
import { MemberEditor } from "./MemberEditor.tsx";
import styles from "./NewDepartment.module.css";
import { TeamCard } from "./TeamCard.tsx";
import {
  blankDepartment,
  type DepartmentForm,
  draftOfForm,
  formOfDraft,
  keptDepartments,
  missingIn,
  teamOf,
} from "./team-form.ts";

const STEPS = ["Describe", "Team", "Workspaces", "Rules and permissions", "Review"] as const;
const WORKSPACES_STEP = 2;
const RULES_STEP = 3;
const DRAFT = "new-department";
const DRAFT_BOX = `${DRAFT}.box`;
const keptId = (saved: unknown) => (typeof saved === "string" ? saved : undefined);

// Departments from the user's words, a ready-made team or built manually; nothing is saved until
// Create, and what is entered is kept until then, one draft at a time.
export function NewDepartmentView({ describe, byHand }: { describe?: string; byHand: boolean }) {
  const harnesses = useApp((state) => state.harnesses);
  const workspaces = useWorkspaces() ?? [];
  const defaults: RoleSettings = {
    harness: harnesses[0]?.harness ?? "claude",
    environment: { kind: "native" },
  };
  const [forms, setForms] = useDraft<DepartmentForm[]>(
    `${DRAFT}.forms`,
    () => [blankDepartment(defaults)],
    keptDepartments,
  );
  const [at, setAt] = useDraft(`${DRAFT}.at`, 0);
  const [selected, setSelected] = useDraft<Record<number, number>>(`${DRAFT}.selected`, {});
  // A new description opens the Describe step, where it is drafted, wherever the draft was left.
  const [handedOver] = useState(
    () => describe !== undefined && describe !== readDraft(`${DRAFT_BOX}.handed`),
  );
  const [step, setStep] = useDraft<number>(
    `${DRAFT}.step`,
    byHand ? 1 : 0,
    handedOver ? ignoreDraft : undefined,
  );
  const [reached, setReached] = useDraft<number>(`${DRAFT}.reached`, byHand ? 1 : 0);
  const [drafted, setDrafted] = useDraft(`${DRAFT}.drafted`, false);
  // The ready-made team the forms were filled from, until the user drafts from words instead.
  const [readyMade, setReadyMade] = useDraft<string | undefined>(
    `${DRAFT}.readyMade`,
    undefined,
    keptId,
  );
  const [picking, setPicking] = useState<string>();
  const ready = useReadyHarnesses();
  const noProvider = useNoProvider(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const current = forms[at] ?? forms[0];
  const departments = useApp((state) => state.departments);
  const existingNames = Object.values(departments).map((one) => one.name);
  // With none picked it works in Scratch, unless it works on the user's own code. A kept draft can
  // name a workspace removed since.
  const chosenOf = (one: DepartmentForm) => {
    const chosen = one.workspaceIds.filter((id) => workspaces.some((known) => known.id === id));
    const scratch = one.needsProject ? undefined : defaultWorkspace(workspaces, undefined);
    return chosen.length > 0 || scratch === undefined ? chosen : [scratch.id];
  };
  const nameOf = (one: DepartmentForm | undefined, index: number) =>
    one?.name.trim() || `Department ${index + 1}`;
  const change = (next: Partial<DepartmentForm>) =>
    setForms(forms.map((one, index) => (index === at ? { ...one, ...next } : one)));
  const setAutonomy = (autonomy: Autonomy) => change({ autonomy });
  const gate = useBypassGate(
    current?.autonomy ?? defaultLevel(),
    setAutonomy,
    current?.name.trim() || "the department",
  );
  const unplaced = forms.findIndex((one) => chosenOf(one).length === 0);
  const missing =
    forms
      .map((one, index) =>
        missingIn(one, [
          ...existingNames,
          ...forms.filter((_, other) => other !== index).map((other) => other.name),
        ]),
      )
      .find((reason) => reason !== undefined) ??
    (unplaced === -1
      ? undefined
      : forms[unplaced]?.needsProject
        ? `Choose the project folder ${nameOf(forms[unplaced], unplaced)} works in.`
        : `Choose where ${nameOf(forms[unplaced], unplaced)} works.`);

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
      setReadyMade(undefined);
      setReached(Math.max(reached, STEPS.length - 1));
    }
    return reply;
  };

  // One click fills every step; a code team asks for its project folder first.
  const pick = async (id: string) => {
    const team = READY_TEAMS.find((one) => one.id === id);
    if (team === undefined) return;
    setPicking(id);
    const power = await powerSettings(ready, defaults.harness);
    const person = (one: ReadyPerson): DraftPerson => ({
      role: one.role,
      purpose: one.purpose,
      instructions: one.instructions,
      settings: power[one.power],
      modelGuessed: true,
    });
    let name = team.name;
    for (let count = 2; existingNames.includes(name); count += 1) name = `${team.name} ${count}`;
    const filled = formOfDraft({
      name,
      purpose: team.purpose,
      rules: team.rules,
      lead: person(team.lead),
      members: team.members.map(person),
    });
    setForms([team.needsProject ? { ...filled, needsProject: true } : filled]);
    setAt(0);
    setSelected({});
    setDrafted(true);
    setReadyMade(id);
    setPicking(undefined);
    setReached(STEPS.length - 1);
    setStep(team.needsProject ? WORKSPACES_STEP : STEPS.length - 1);
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
        if (one === undefined) break;
        const department = await api.createDepartment({
          team: teamOf(one),
          workspaceIds: chosenOf(one),
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
      clearDrafts(DRAFT);
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
  // The team card sits beside the steps that do not show the team themselves.
  const withCard = step === WORKSPACES_STEP || step === RULES_STEP;
  // A ready-made team stays one click away until the user builds one manually.
  const builtManually =
    !drafted &&
    (forms.length > 1 ||
      forms.some(
        (one) =>
          one.name.trim() !== "" ||
          one.purpose.trim() !== "" ||
          one.rules.trim() !== "" ||
          one.lead.instructions.trim() !== "" ||
          one.members.length > 0,
      ));
  // Describe with its ready-made teams, the team and the review use the whole width.
  const wide = step === 0 || step === 1 || step === STEPS.length - 1;
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
            {nameOf(one, index)}
          </button>
        ))}
      </div>
    );

  return (
    <section className={steps.setup} aria-label="New department">
      <StepRail
        back={{ label: "Back to Team", onClick: () => navigate({ name: "team" }) }}
        title="New department"
        note={<DraftNote scope={DRAFT} />}
        steps={STEPS}
        step={step}
        reached={reached}
        onGo={go}
      />
      <div className={`${steps.setupBody} ${wide ? steps.wide : ""}`}>
        <div className={page.main}>
          <header className={page.header}>
            <h2 className={page.title}>
              {step === 0
                ? "Describe the team you need"
                : step === 1
                  ? "Who is on the team"
                  : step === WORKSPACES_STEP
                    ? `Where does ${current.name.trim() || "this department"} work?`
                    : step === RULES_STEP
                      ? "Rules and permissions"
                      : forms.length > 1
                        ? `Review ${forms.length} departments`
                        : "Review and create"}
            </h2>
            {step === STEPS.length - 1 ? null : (
              <p className={page.lead}>
                {step === 0
                  ? "Say who leads, who else is on the team and what each person does."
                  : step === 1
                    ? "The lead splits each task among the members. Pick a person to set their role, instructions and model."
                    : step === WORKSPACES_STEP
                      ? "Choose the folders this team can edit. New tasks use the default. You can pick another when you start a task."
                      : step === RULES_STEP
                        ? "The rules every member follows, and what it may do without asking you."
                        : null}
              </p>
            )}
          </header>

          {step === 0 ? (
            <>
              {noProvider ? <NoProvider /> : null}
              <DraftBox
                name={DRAFT_BOX}
                label="Describe the team"
                placeholder="For example: I need a team of 3 to build landing pages. A lead on Opus plans the work, a developer on a free model writes the code, and a reviewer checks it."
                action="Draft team"
                drafted={drafted}
                {...(describe === undefined ? {} : { initial: describe })}
                run={draft}
              />
              {drafted && readyMade === undefined ? (
                <div className={styles.drafts}>
                  {forms.map((one) => (
                    <TeamCard key={one.key} form={one} chart />
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
                    Build it manually
                  </Button>
                )}
              </div>
              {(drafted && readyMade === undefined) || builtManually ? null : (
                <ReadyCards
                  title="Or start from a ready-made team"
                  cards={READY_TEAMS.map((team) => ({
                    id: team.id,
                    name: team.name,
                    description: team.does,
                    facts: [
                      { label: "Team", text: team.who },
                      { label: "You get", text: team.youGet },
                    ],
                    ...(team.needsProject ? { needs: { text: "Needs a project folder" } } : {}),
                  }))}
                  picked={readyMade}
                  disabled={noProvider}
                  busy={picking}
                  onPick={(id) => void pick(id)}
                />
              )}
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
                  <span className={form.label}>What it does</span>
                  <LineField
                    value={current.purpose}
                    placeholder="One line; the chief reads it when it plans"
                    onChange={(purpose) => change({ purpose })}
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

          {step === WORKSPACES_STEP ? (
            <>
              {switcher}
              <DepartmentWorkspaces
                value={chosenOf(current)}
                onChange={(workspaceIds) => change({ workspaceIds })}
                departmentName={current.name.trim() || "this department"}
              />
            </>
          ) : null}

          {step === RULES_STEP ? (
            <>
              {switcher}
              <div className={form.field}>
                <span className={form.label}>Team rules</span>
                <span className={form.hint}>Every member follows these, on every task.</span>
                <PointsField
                  key={current.key}
                  label="Team rules"
                  value={current.rules}
                  placeholder="For example: Use TypeScript"
                  addLabel="Add a rule"
                  onChange={(rules) => change({ rules })}
                />
              </div>
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

          {step === STEPS.length - 1 ? (
            <div className={styles.drafts}>
              {forms.map((one, index) => {
                const edit = (to: number) => () => {
                  setAt(index);
                  go(to);
                };
                const chosen = chosenOf(one).flatMap(
                  (id) => workspaces.find((known) => known.id === id)?.name ?? [],
                );
                const noRules = one.rules.trim() === "";
                return (
                  <TeamCard
                    key={one.key}
                    form={one}
                    chart
                    footer={
                      <dl className={styles.facts}>
                        <div>
                          <dt>Workspaces</dt>
                          <dd>
                            {chosen
                              .map((name, place) => (place === 0 ? `${name} (default)` : name))
                              .join(", ")}
                          </dd>
                          <Button variant="ghost" onClick={edit(WORKSPACES_STEP)}>
                            Change
                          </Button>
                        </div>
                        <div>
                          <dt>Permissions</dt>
                          <dd>{AUTONOMY[one.autonomy].label}</dd>
                          <Button variant="ghost" onClick={edit(RULES_STEP)}>
                            Change
                          </Button>
                        </div>
                        <div>
                          <dt>Team rules</dt>
                          <dd>{noRules ? "None" : "Set"}</dd>
                          <Button variant="ghost" onClick={edit(RULES_STEP)}>
                            {noRules ? "Add" : "Edit"}
                          </Button>
                        </div>
                      </dl>
                    }
                  />
                );
              })}
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
                  disabled={missing !== undefined}
                  busy={saving}
                >
                  {forms.length > 1
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

        {withCard ? (
          <aside className={page.aside}>
            <TeamCard form={current} />
          </aside>
        ) : null}
      </div>
      {gate.confirm}
    </section>
  );
}
