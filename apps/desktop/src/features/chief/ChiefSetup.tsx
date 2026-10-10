import { type AgentSettings, agentNameSchema } from "@office-town/contract";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { keepAgent } from "../../store/live.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { OptionRows } from "../../ui/Choice.tsx";
import page from "../../ui/Page.module.css";
import { useAiSummary } from "../profiles/AiLine.tsx";
import { SettingsChips } from "../profiles/SettingsChips.tsx";
import styles from "./Chief.module.css";
import { DepartmentList } from "./DepartmentList.tsx";

const STEPS = [
  { title: "Meet your chief", hint: "What it does and its name" },
  { title: "Choose its AI", hint: "Which app and model it thinks with" },
  { title: "House rules", hint: "How it should plan" },
  { title: "Its departments", hint: "Who it can hand work to" },
] as const;

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
  const summary = useAiSummary(draft);
  const handle = toHandle(name);
  const validName = agentNameSchema.safeParse(handle).success;
  const rules = draft.instructions ?? "";
  const last = step === STEPS.length - 1;

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
    <section className={styles.setup} aria-labelledby="chief-setup-title">
      <nav className={styles.rail} aria-label="Setup steps">
        <button
          type="button"
          className={page.back}
          onClick={() => navigate(editing ? { name: "chief" } : { name: "home" })}
        >
          ← {editing ? "Back to your chief" : "Back to Home"}
        </button>
        <div className={styles.railHead}>
          <h1 id="chief-setup-title" className={styles.railTitle}>
            {editing ? "Chief settings" : "Set up your chief"}
          </h1>
          <span className={page.hint}>
            {editing
              ? "Changes apply to its next goal. A goal in progress keeps its settings."
              : "About two minutes. You can change all of it later."}
          </span>
        </div>
        <ol className={styles.stepList}>
          {STEPS.map((item, index) => {
            const done = index < step || (editing && index !== step);
            return (
              <li key={item.title}>
                <button
                  type="button"
                  className={styles.stepItem}
                  aria-current={index === step ? "step" : undefined}
                  disabled={index > reached}
                  onClick={() => go(index)}
                >
                  <span className={`${styles.stepDot} ${done ? styles.stepDone : ""}`}>
                    {done ? <Check size={13} aria-label="Done" /> : index + 1}
                  </span>
                  <span className={styles.stepText}>
                    <span className={styles.stepTitle}>{item.title}</span>
                    <span className={page.hint}>{item.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className={styles.progress} aria-hidden>
          <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </nav>

      <div className={styles.setupBody}>
        <div className={page.main}>
          <header className={page.header}>
            <span className={styles.stepCount}>
              Step {step + 1} of {STEPS.length}
            </span>
            {step === 0 ? (
              <>
                <h2 className={page.title}>Meet your chief</h2>
                <p className={page.lead}>
                  Your chief takes a big goal, splits it into pieces and gives each piece to the
                  right department, in the right order. It shows you the plan first, and nothing
                  starts until you approve it.
                </p>
              </>
            ) : step === 1 ? (
              <>
                <h2 className={page.title}>Which AI should {handle} think with?</h2>
                <p className={page.lead}>
                  The chief plans and coordinates; your departments do the actual work. A small,
                  low-cost model is usually enough here.
                </p>
              </>
            ) : step === 2 ? (
              <>
                <h2 className={page.title}>House rules</h2>
                <p className={page.lead}>
                  Anything {handle} should always keep in mind when it plans and hands out work.
                  Departments don't read these; give a department its own team rules for that.
                  Optional; tap a suggestion or write your own.
                </p>
              </>
            ) : (
              <>
                <h2 className={page.title}>Who can {handle} hand work to?</h2>
                <p className={page.lead}>
                  The chief gives work to your departments. It can also suggest a new department
                  when a goal needs one, which you approve with the plan.
                </p>
              </>
            )}
          </header>

          {step === 0 ? (
            <>
              <Diagram />
              <section className={page.section}>
                <label htmlFor="chief-name" className={page.sectionTitle}>
                  Give it a name
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
                  {validName
                    ? `It appears as ${handle} in the office and in its messages.`
                    : "Use letters and numbers, starting with a letter or a number."}
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
                  options={harnesses.map((known) => ({
                    value: known.harness,
                    title: known.name,
                    description: "Installed on this computer",
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
                <span className={page.hint}>
                  A fast model such as Haiku, or a free one, keeps the chief from using much of your
                  plan.
                </span>
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
              <label htmlFor="chief-rules" className="visually-hidden">
                House rules
              </label>
              <textarea
                id="chief-rules"
                className={`${page.input} ${styles.rules}`}
                rows={5}
                value={rules}
                placeholder="For example: the Backend department always goes before Frontend."
                onChange={(change) => setDraft({ ...draft, instructions: change.target.value })}
              />
            </section>
          ) : null}

          {step === 3 ? (
            <section className={page.section}>
              <DepartmentList />
              {departments === 0 ? (
                <span className={page.hint}>
                  You have no departments yet. Finish here, then build one from your chief's page.
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
              <dt>Thinks with</dt>
              <dd>{summary}</dd>
              <dt>House rules</dt>
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
            The chief can read every department's files but changes none. Anything else it tries
            comes to you first.
          </p>
        </aside>
      </div>
    </section>
  );
}
