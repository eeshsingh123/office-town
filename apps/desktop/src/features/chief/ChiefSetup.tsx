import { type AgentSettings, agentNameSchema, type RoleSettings } from "@office-town/contract";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { keepAgent } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { PointsField } from "../../ui/PointsField.tsx";
import { StepRail } from "../../ui/StepRail.tsx";
import steps from "../../ui/Steps.module.css";
import { DraftBox } from "../drafts/DraftBox.tsx";
import { useModelLine } from "../profiles/model-line.ts";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import { useOfferedHarnesses } from "../providers/providers.ts";
import styles from "./Chief.module.css";
import { DepartmentList } from "./DepartmentList.tsx";

const STEPS = ["Name", "Model", "Planning rules", "Departments"] as const;

const SUGGESTED_RULES = [
  "Prefer free models when you set up a new department.",
  "Keep each plan to 4 pieces or fewer.",
  "Ask me before creating a new department.",
  "Say in one line why each department gets its piece.",
];

// Names are handles such as "@ada"; this turns what was typed into one.
function toHandle(typed: string): string {
  const slug = typed
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `@${slug}`;
}

function Diagram() {
  return (
    <div className={styles.diagram} aria-hidden>
      <span className={styles.node}>You</span>
      <ArrowRight size={16} />
      <span className={`${styles.node} ${styles.nodeChief}`}>Chief</span>
      <ArrowRight size={16} />
      <span className={styles.stack}>
        <span className={styles.node}>Department</span>
        <span className={styles.node}>Department</span>
      </span>
    </div>
  );
}

export function ChiefSetup() {
  const chief = useApp((state) =>
    state.chiefId === undefined ? undefined : state.agents[state.chiefId],
  );
  const harnesses = useApp((state) => state.harnesses);
  const departments = useApp((state) => Object.keys(state.departments).length);
  const editing = chief !== undefined;
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(editing ? STEPS.length - 1 : 0);
  const [name, setName] = useState(chief?.name.replace(/^@/, "") ?? "chief");
  const [draft, setDraft] = useState<AgentSettings>(
    () =>
      chief?.settings ?? {
        harness: harnesses[0]?.harness ?? "claude",
        environment: { kind: "native" },
      },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const offered = useOfferedHarnesses(draft.harness, draft.environment);
  const summary = useModelLine(draft);
  const handle = toHandle(name);
  const validName = agentNameSchema.safeParse(handle).success;
  const rules = draft.instructions ?? "";
  const last = step === STEPS.length - 1;
  const [describing, setDescribing] = useState(!editing);
  const [drafted, setDrafted] = useState(false);

  const describe = async (notes: string[], drafter: RoleSettings) => {
    const { instructions: _, autonomy: __, ...settings } = draft;
    const reply = await api.draftChief({
      notes,
      drafter,
      ...(drafted || editing ? { current: { name, rules, settings } } : {}),
    });
    if (reply.chief !== undefined) {
      setName(reply.chief.name);
      setDraft({ ...reply.chief.settings, instructions: reply.chief.rules });
      setDrafted(true);
      setReached(STEPS.length - 1);
    }
    return reply;
  };

  const go = (next: number) => {
    setStep(next);
    setReached(Math.max(reached, next));
  };

  const toggleRule = (rule: string) => {
    const lines = rules.split("\n").filter((line) => line.trim() !== "");
    const next = lines.includes(rule) ? lines.filter((line) => line !== rule) : [...lines, rule];
    setDraft({ ...draft, instructions: next.join("\n") });
  };

  const save = async () => {
    if (!validName || saving) return;
    setSaving(true);
    setError(undefined);
    const { instructions, ...rest } = draft;
    const trimmed = instructions?.trim();
    try {
      let saved = await api.saveChief(trimmed ? { ...rest, instructions: trimmed } : rest);
      if (saved.name !== handle) saved = await api.renameAgent(saved.id, handle);
      keepAgent(saved);
      useApp.setState({ chiefId: saved.id });
      navigate({ name: "chief" });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <section className={steps.setup} aria-label={editing ? "Chief settings" : "Set up your chief"}>
      <StepRail
        back={{
          label: editing ? "Back to your chief" : "Back to Home",
          onClick: () => navigate(editing ? { name: "chief" } : { name: "home" }),
        }}
        title={editing ? "Chief settings" : "Set up your chief"}
        note={
          editing ? <span className={page.hint}>Changes apply from its next goal.</span> : undefined
        }
        steps={STEPS}
        step={step}
        reached={reached}
        allDone={editing}
        onGo={go}
      />

      <div className={steps.setupBody}>
        <div className={page.main}>
          <header className={page.header}>
            <span className={steps.stepCount}>
              Step {step + 1} of {STEPS.length}
            </span>
            {step === 0 ? (
              <>
                <h2 className={page.title}>Name your chief</h2>
                <p className={page.lead}>
                  The chief splits a big goal into parts and gives each part to a department. You
                  approve the plan before any work starts.
                </p>
              </>
            ) : step === 1 ? (
              <>
                <h2 className={page.title}>Choose a model for {handle}</h2>
                <p className={page.lead}>
                  The chief only plans, so a small or free model is usually enough.
                </p>
              </>
            ) : step === 2 ? (
              <>
                <h2 className={page.title}>Planning rules</h2>
                <p className={page.lead}>
                  Optional rules {handle} follows when it plans. Departments don't see them.
                </p>
              </>
            ) : (
              <>
                <h2 className={page.title}>Departments</h2>
                <p className={page.lead}>
                  {handle} gives work to these departments. A plan can also add a new department.
                </p>
              </>
            )}
          </header>

          {step === 0 ? (
            <div className={page.row}>
              <button
                type="button"
                className={form.chip}
                aria-pressed={describing}
                onClick={() => setDescribing(true)}
              >
                Describe it
              </button>
              <button
                type="button"
                className={form.chip}
                aria-pressed={!describing}
                onClick={() => setDescribing(false)}
              >
                Answer step by step
              </button>
            </div>
          ) : null}

          {step === 0 && describing ? (
            <>
              <DraftBox
                label="Describe your chief"
                placeholder="For example: Call it Atlas. Use Opus 5.5. Keep plans short, prefer free models for routine work, and never create a new department without asking me."
                action="Draft chief"
                drafted={drafted}
                run={describe}
              />
              {drafted ? (
                <span className={page.hint}>
                  Drafted as {handle}. Check each step, or finish setup from the last one.
                </span>
              ) : null}
            </>
          ) : null}

          {step === 0 && !describing ? (
            <>
              <Diagram />
              <section className={page.section}>
                <label htmlFor="chief-name" className={page.sectionTitle}>
                  Name
                </label>
                <input
                  id="chief-name"
                  className={page.input}
                  value={name}
                  maxLength={32}
                  onChange={(change) => setName(change.target.value)}
                  // biome-ignore lint/a11y/noAutofocus: the step's one field
                  autoFocus
                />
                <span className={page.hint}>
                  {validName ? `Shown as ${handle}.` : "Use letters and numbers."}
                </span>
              </section>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <section className={page.section}>
                <h3 className={page.sectionTitle}>AI app</h3>
                <OptionRows
                  name="chief-harness"
                  label="AI app"
                  value={draft.harness}
                  wide
                  options={offered.map((known) => ({
                    value: known.harness,
                    title: known.name,
                  }))}
                  onChange={(harness) => {
                    const { model: _, effort: __, ...rest } = draft;
                    setDraft({ ...rest, harness });
                  }}
                />
              </section>
              <section className={page.section}>
                <h3 className={page.sectionTitle}>Model</h3>
                <div className={styles.chips}>
                  <SettingsChips
                    showHarness={false}
                    value={{
                      harness: draft.harness,
                      environment: draft.environment,
                      ...(draft.model === undefined ? {} : { model: draft.model }),
                      ...(draft.effort === undefined ? {} : { effort: draft.effort }),
                    }}
                    onChange={(next) => {
                      const { harness, environment, model, effort, ...others } = draft;
                      setDraft({ ...others, ...next });
                    }}
                  />
                </div>
              </section>
            </>
          ) : null}

          {step === 2 ? (
            <section className={page.section}>
              <div className={styles.suggestions}>
                {SUGGESTED_RULES.map((rule) => {
                  const on = rules.split("\n").includes(rule);
                  return (
                    <button
                      key={rule}
                      type="button"
                      className={styles.suggestion}
                      aria-pressed={on}
                      onClick={() => toggleRule(rule)}
                    >
                      {on ? <Check size={13} aria-hidden /> : "+"} {rule}
                    </button>
                  );
                })}
              </div>
              <PointsField
                label="Planning rules"
                value={rules}
                placeholder="For example: the Backend department always goes before Frontend."
                addLabel="Add a rule"
                onChange={(instructions) => setDraft({ ...draft, instructions })}
              />
            </section>
          ) : null}

          {step === 3 ? (
            <section className={page.section}>
              <DepartmentList />
              {departments === 0 ? (
                <span className={page.hint}>
                  No departments yet. You can build one after setup.
                </span>
              ) : null}
            </section>
          ) : null}

          {error === undefined ? null : (
            <p className={page.error} role="alert">
              {error}
            </p>
          )}
          <div className={page.row}>
            {step === 0 ? null : (
              <Button variant="ghost" onClick={() => go(step - 1)}>
                Back
              </Button>
            )}
            {last || editing ? (
              <Button variant="primary" onClick={save} disabled={!validName || saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Finish setup"}
              </Button>
            ) : null}
            {last ? null : (
              <Button
                variant={editing ? "secondary" : "primary"}
                onClick={() => go(step + 1)}
                disabled={step === 0 && !validName}
              >
                Continue
                <ArrowRight size={15} aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <aside className={page.aside}>
          <div className={`${page.panel} ${styles.preview}`}>
            <Avatar name={handle} colour={chief?.colour ?? "#4F5D75"} size={64} />
            <div className={styles.previewName}>
              <strong>{validName ? handle : "@…"}</strong>
              <span className={page.hint}>Your chief</span>
            </div>
            <dl className={styles.previewFacts}>
              <dt>Model</dt>
              <dd>{summary}</dd>
              <dt>Planning rules</dt>
              <dd>
                {rules.trim() === ""
                  ? "None yet"
                  : `${rules.split("\n").filter((line) => line.trim() !== "").length} set`}
              </dd>
              <dt>Departments</dt>
              <dd>{departments}</dd>
            </dl>
          </div>
          <p className={page.hint}>
            The chief can read department files but not change them. It asks you before anything
            else.
          </p>
        </aside>
      </div>
    </section>
  );
}
