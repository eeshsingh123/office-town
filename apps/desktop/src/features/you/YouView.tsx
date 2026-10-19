import type { UserProfile } from "@office-town/contract";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ColourPicker } from "../../ui/ColourPicker.tsx";
import form from "../../ui/Form.module.css";
import page from "../../ui/Page.module.css";
import { showToast } from "../../ui/Toast.tsx";
import { toggleTheme, useTheme } from "../../ui/theme.ts";
import styles from "./YouView.module.css";
import { ANSWER_PICKS, useYou, youPreview } from "./you.ts";

function Switch({
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
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={styles.switch}
        onClick={() => onChange(!on)}
      />
      <div>
        <strong>{label}</strong>
        {hint === undefined ? null : <p className={form.hint}>{hint}</p>}
      </div>
    </div>
  );
}

// Applies at once, apart from the profile's Save.
function Appearance() {
  const theme = useTheme();
  return (
    <div className={page.panel}>
      <span className={page.eyebrow}>Appearance</span>
      <fieldset className={`${form.row} ${form.group}`}>
        <legend className="visually-hidden">Theme</legend>
        {(["light", "dark"] as const).map((pick) => (
          <button
            key={pick}
            type="button"
            className={`${form.chip} ${styles.themeChip}`}
            aria-pressed={theme === pick}
            onClick={() => {
              if (theme !== pick) toggleTheme();
            }}
          >
            {pick === "light" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
            {pick === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

export function YouView() {
  const saved = useYou();
  const [draft, setDraft] = useState<UserProfile>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (change: Partial<UserProfile>) => setDraft({ ...draft, ...change });
  const preview = youPreview(draft);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const you = await api.saveYou(draft);
      useApp.setState({ you });
      showToast("Saved. Your agents will use this from their next task.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={page.page} aria-labelledby="you-title">
      <div className={page.layout}>
        <div className={page.main}>
          <header className={page.header}>
            <h1 id="you-title" className={page.title}>
              Your profile
            </h1>
            <p className={page.lead}>Every agent reads this before it starts a task.</p>
          </header>

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
              <label className={form.field} htmlFor="you-about">
                <span className={form.label}>About you</span>
                <textarea
                  id="you-about"
                  className={form.input}
                  rows={4}
                  value={draft.about}
                  placeholder="For example: I'm a backend developer. I know Python well and I'm new to TypeScript."
                  onChange={(event) => set({ about: event.target.value })}
                />
                <span className={form.hint}>
                  Your work, what you know well and what you're new to.
                </span>
              </label>
              <fieldset className={`${form.field} ${form.group}`}>
                <legend className={form.label}>How you like answers</legend>
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
                <textarea
                  className={form.input}
                  rows={2}
                  aria-label="Anything else about how you like answers"
                  value={draft.answerNotes}
                  placeholder="Anything else, in your own words"
                  onChange={(event) => set({ answerNotes: event.target.value })}
                />
                <p className={form.hint}>Pick any that fit, or write your own.</p>
              </fieldset>
            </section>

            <section className={`${page.panel} ${styles.card}`} aria-labelledby="you-notify">
              <div className={styles.sectionHead}>
                <h2 id="you-notify" className={page.sectionTitle}>
                  Notifications
                </h2>
                <p className={form.hint}>Shown while the app is in the background.</p>
              </div>
              <Switch
                label="When an agent needs you"
                on={draft.notifyNeedsYou}
                onChange={(notifyNeedsYou) => set({ notifyNeedsYou })}
              />
              <Switch
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
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>

        <aside className={page.aside}>
          <Appearance />
          <div className={page.panel}>
            <span className={page.eyebrow}>What your agents will read</span>
            <p className={styles.preview}>{preview === "" ? "Nothing yet." : preview}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
