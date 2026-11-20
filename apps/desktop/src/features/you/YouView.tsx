import type { UserProfile } from "@office-town/contract";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { clearDrafts, useDraft } from "../../store/drafts.ts";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { PointsField } from "../../ui/PointsField.tsx";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./YouView.module.css";
import { ANSWER_LENGTHS, ANSWER_STYLES, useYou } from "./you.ts";

const DRAFT = "you";

// What this page saves; notifications are saved from Settings (a1-17).
const profileOf = ({ name, colour, about, answerStyle, answerNotes }: UserProfile) =>
  JSON.stringify({ name, colour, about, answerStyle, answerNotes });

function Picks({
  picks,
  chosen,
  onToggle,
}: {
  picks: readonly string[];
  chosen: readonly string[];
  onToggle: (pick: string, on: boolean) => void;
}) {
  return (
    <div className={form.row}>
      {picks.map((pick) => {
        const on = chosen.includes(pick);
        return (
          <button
            key={pick}
            type="button"
            className={form.chip}
            aria-pressed={on}
            onClick={() => onToggle(pick, !on)}
          >
            {pick}
          </button>
        );
      })}
    </div>
  );
}

export function YouView() {
  const saved = useYou();
  const [draft, setDraft] = useDraft<UserProfile>(DRAFT, saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (change: Partial<UserProfile>) => setDraft({ ...draft, ...change });
  const changed = profileOf(draft) !== profileOf(saved);

  // Picking a length drops the other one; styles add up.
  const toggle = (pick: string, on: boolean, only: readonly string[] = []) => {
    const rest = draft.answerStyle.filter((known) => known !== pick && !only.includes(known));
    set({ answerStyle: on ? [...rest, pick] : rest });
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const you = await api.saveYou({
        ...draft,
        notifyNeedsYou: saved.notifyNeedsYou,
        notifyFinished: saved.notifyFinished,
      });
      useApp.setState({ you });
      clearDrafts(DRAFT);
      showToast("Saved. Applies from the next task.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={page.page} aria-labelledby="you-title">
      <div className={styles.column}>
        <div className={page.main}>
          <PageHeader
            id="you-title"
            title="Your profile"
            lead="How you appear in the app, and what agents read about you before each task."
          />

          <div className={form.form}>
            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-appear">
              <h2 id="you-appear" className={page.sectionTitle}>
                How you appear
              </h2>
              <label className={form.field} htmlFor="you-name">
                <span className={form.label}>Name</span>
                <span className={form.hint}>What agents call you, and how Home greets you.</span>
                <input
                  id="you-name"
                  className={form.input}
                  value={draft.name}
                  maxLength={60}
                  onChange={(event) => set({ name: event.target.value })}
                />
              </label>
              <div className={form.field}>
                <span className={form.label}>Colour</span>
                <span className={form.hint}>Only for the app: your picture and your messages.</span>
                <ColourPicker
                  label="Your colour"
                  value={draft.colour}
                  onChange={(colour) => set({ colour })}
                />
              </div>
            </section>

            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-know">
              <h2 id="you-know" className={page.sectionTitle}>
                What agents should know
              </h2>
              <div className={form.field}>
                <span className={form.label}>About you</span>
                <span className={form.hint}>
                  Your work, what you know well and what you're new to.
                </span>
                <PointsField
                  label="About you"
                  value={draft.about}
                  placeholder="For example: I'm a backend developer"
                  addLabel="Add a point"
                  onChange={(about) => set({ about })}
                />
              </div>
              <fieldset className={`${form.field} ${form.group} ${styles.answers}`}>
                <legend className={form.label}>How you like answers</legend>
                <div className={styles.picks}>
                  <p className={form.hint}>Length: pick one, or neither.</p>
                  <Picks
                    picks={ANSWER_LENGTHS}
                    chosen={draft.answerStyle}
                    onToggle={(pick, on) => toggle(pick, on, ANSWER_LENGTHS)}
                  />
                </div>
                <div className={styles.picks}>
                  <p className={form.hint}>Style: pick any that fit.</p>
                  <Picks
                    picks={ANSWER_STYLES}
                    chosen={draft.answerStyle}
                    onToggle={(pick, on) => toggle(pick, on)}
                  />
                </div>
                <PointsField
                  label="Anything else about how you like answers"
                  value={draft.answerNotes}
                  placeholder="Anything else, in your own words"
                  addLabel="Add your own"
                  onChange={(answerNotes) => set({ answerNotes })}
                />
                <p className={form.hint}>
                  These are notes agents read. To make them wait for your OK before they act, set
                  Permission to Manual in{" "}
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={() => navigate({ name: "settings", section: "new-tasks" })}
                  >
                    Settings
                  </button>
                  .
                </p>
              </fieldset>
            </section>

            {error === undefined ? null : (
              <p className={form.error} role="alert">
                {error}
              </p>
            )}
            <div className={`${form.actions} ${form.sticky}`}>
              <DraftNote scope={DRAFT} editing />
              <Button
                variant="primary"
                disabled={!changed}
                busy={saving}
                onClick={() => void save()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
