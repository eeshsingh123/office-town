import type { Display } from "@office-town/contract";
import { useApp } from "../../store/app-store.ts";
import form from "../../ui/Form.module.css";
import { SwitchRow } from "../../ui/Switch.tsx";
import page from "../help/Help.module.css";
import { saveDisplay } from "../onboarding/onboarding.ts";
import { saveTaskDefault, TASK_OPTIONS, useTaskDefaults } from "../task/task-options.ts";
import styles from "./Settings.module.css";

const TEXT_SIZES: NonNullable<Display["textSize"]>[] = [100, 115, 130];

// The app's defaults; a running task changes its own on its run card.
function NewTasks() {
  const defaults = useTaskDefaults();
  return (
    <section className={page.card} aria-labelledby="settings-new-tasks">
      <h2 id="settings-new-tasks" className={page.cardTitle}>
        New tasks
      </h2>
      <div className={styles.switches}>
        {TASK_OPTIONS.map((option) => (
          <SwitchRow
            key={option.key}
            label={option.label}
            hint={option.hint}
            on={defaults[option.key]}
            onChange={(on) => saveTaskDefault(option.key, on)}
          />
        ))}
      </div>
      <p className={styles.note}>
        A new task starts with these. You can change them for one task as you start it, or on its
        run card while it runs.
      </p>
    </section>
  );
}

function DisplaySettings() {
  const display = useApp((state) => state.display);
  const size = display.textSize ?? 100;
  const toggles: { key: "moreContrast" | "lessMotion" | "announceRequests"; label: string }[] = [
    { key: "moreContrast", label: "Higher contrast" },
    { key: "lessMotion", label: "Less motion" },
    { key: "announceRequests", label: "Read out new requests with a screen reader" },
  ];
  return (
    <section className={page.card} aria-labelledby="settings-display">
      <h2 id="settings-display" className={page.cardTitle}>
        Display
      </h2>
      <fieldset className={page.sizes}>
        <legend className={page.legend}>Text size</legend>
        {TEXT_SIZES.map((option) => (
          <button
            key={option}
            type="button"
            className={form.chip}
            aria-pressed={size === option}
            onClick={() => void saveDisplay({ textSize: option })}
          >
            {option}%
          </button>
        ))}
      </fieldset>
      {toggles.map(({ key, label }) => (
        <label key={key} className={page.toggle}>
          <input
            type="checkbox"
            checked={key === "announceRequests" ? display[key] !== false : display[key] === true}
            onChange={(change) => void saveDisplay({ [key]: change.target.checked })}
          />
          {label}
        </label>
      ))}
    </section>
  );
}

export function SettingsView() {
  return (
    <section className={page.page} aria-labelledby="settings-title">
      <div className={page.column}>
        <div className={page.head}>
          <h1 id="settings-title" className={page.title}>
            Settings
          </h1>
        </div>
        <NewTasks />
        <DisplaySettings />
      </div>
    </section>
  );
}
