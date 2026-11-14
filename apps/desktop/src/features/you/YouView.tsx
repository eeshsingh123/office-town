import type { UserProfile } from "@office-town/contract";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { clearDrafts, useDraft } from "../../store/drafts.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import { DraftNote } from "../../ui/DraftNote.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { PointsField } from "../../ui/PointsField.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { showToast } from "../../ui/Toast.tsx";
import styles from "./YouView.module.css";
import { ANSWER_PICKS, useYou } from "./you.ts";

const DRAFT = "you";

function NotifySwitch({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={styles.switchRow}>
      <Switch label={label} on={on} onChange={onChange} />
      <div>
        <strong>{label}</strong>
        {hint === undefined ? null : <p className={form.hint}>{hint}</p>}
      </div>
    </div>
  );
}

export function YouView() {
  const saved = useYou();
  const [draft, setDraft] = useDraft<UserProfile>(DRAFT, saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (change: Partial<UserProfile>) => setDraft({ ...draft, ...change });

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const you = await api.saveYou(draft);
      useApp.setState({ you });
      clearDrafts(DRAFT);
      showToast("Saved. Your agents will use this from their next task.");
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
            lead="Every agent reads this before it starts a task."
          />

          <div className={form.form}>
            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-who">
              <h2 id="you-who" className={page.sectionTitle}>
                You
              </h2>
              <div className={styles.identity}>
                <Avatar name={draft.name.trim() || "?"} colour={draft.colour} size={56} />
                <label className={form.field} htmlFor="you-name">
                  <span className={form.label}>Your name</span>
                  <input
                    id="you-name"
                    className={form.input}
                    value={draft.name}
                    maxLength={60}
                    onChange={(event) => set({ name: event.target.value })}
                  />
                </label>
              </div>
              <div className={form.field}>
                <span className={form.label}>Your colour</span>
                <ColourPicker
                  label="Your colour"
                  value={draft.colour}
                  onChange={(colour) => set({ colour })}
                />
              </div>
            </section>

            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-work">
              <h2 id="you-work" className={page.sectionTitle}>
                How agents work with you
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
              <fieldset className={`${form.field} ${form.group}`}>
                <legend className={form.label}>How you like answers</legend>
                <p className={form.hint}>Pick any that fit, or add your own.</p>
                <div className={form.row}>
                  {ANSWER_PICKS.map((pick) => {
                    const on = draft.answerStyle.includes(pick);
                    return (
                      <button
                        key={pick}
                        type="button"
                        className={form.chip}
                        aria-pressed={on}
                        onClick={() =>
                          set({
                            answerStyle: on
                              ? draft.answerStyle.filter((known) => known !== pick)
                              : [...draft.answerStyle, pick],
                          })
                        }
                      >
                        {pick}
                      </button>
                    );
                  })}
                </div>
                <PointsField
                  label="Anything else about how you like answers"
                  value={draft.answerNotes}
                  placeholder="Anything else, in your own words"
                  addLabel="Add your own"
                  onChange={(answerNotes) => set({ answerNotes })}
                />
              </fieldset>
            </section>

            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-notify">
              <div className={styles.sectionHead}>
                <h2 id="you-notify" className={page.sectionTitle}>
                  Notifications
                </h2>
                <p className={form.hint}>Shown while the app is in the background.</p>
              </div>
              <NotifySwitch
                label="When an agent needs you"
                on={draft.notifyNeedsYou}
                onChange={(notifyNeedsYou) => set({ notifyNeedsYou })}
              />
              <NotifySwitch
                label="When a task is finished"
                on={draft.notifyFinished}
                onChange={(notifyFinished) => set({ notifyFinished })}
              />
            </section>
            {error === undefined ? null : (
              <p className={form.error} role="alert">
                {error}
              </p>
            )}
            <div className={`${form.actions} ${form.sticky}`}>
              <DraftNote scope={DRAFT} editing />
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
