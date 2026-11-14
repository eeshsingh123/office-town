import type { Display } from "@office-town/contract";
import { Moon, Sun } from "lucide-react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import form from "../../ui/Form.module.css";
import { byteSize } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SwitchRow } from "../../ui/Switch.tsx";
import { showToast } from "../../ui/Toast.tsx";
import { toggleTheme, useTheme } from "../../ui/theme.ts";
import { saveDisplay } from "../onboarding/onboarding.ts";
import { saveTaskDefault, TASK_OPTIONS, useTaskDefaults } from "../task/task-options.ts";
import { useStoreSize } from "../tasks/store-size.ts";
import { useYou } from "../you/you.ts";
import styles from "./Settings.module.css";

const TEXT_SIZES: NonNullable<Display["textSize"]>[] = [100, 115, 130];

// The app's defaults; a running task changes its own under Details on its page.
function NewTasks() {
  const defaults = useTaskDefaults();
  return (
    <section className={page.panel} aria-labelledby="settings-new-tasks">
      <h2 id="settings-new-tasks" className={page.sectionTitle}>
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
    </section>
  );
}

// Kept with the profile in the core, but an app choice, so it lives here and saves at once (a1-17).
function Notifications() {
  const you = useYou();
  const set = (change: { notifyNeedsYou?: boolean; notifyFinished?: boolean }) =>
    api.saveYou({ ...you, ...change }).then(
      (saved) => useApp.setState({ you: saved }),
      (failure: unknown) => showToast(failure instanceof Error ? failure.message : String(failure)),
    );
  return (
    <section className={page.panel} aria-labelledby="settings-notify">
      <div>
        <h2 id="settings-notify" className={page.sectionTitle}>
          Notifications
        </h2>
        <p className={form.hint}>Shown while the app is in the background.</p>
      </div>
      <div className={styles.switches}>
        <SwitchRow
          label="When an agent needs you"
          on={you.notifyNeedsYou}
          onChange={(notifyNeedsYou) => void set({ notifyNeedsYou })}
        />
        <SwitchRow
          label="When a task is finished"
          on={you.notifyFinished}
          onChange={(notifyFinished) => void set({ notifyFinished })}
        />
      </div>
    </section>
  );
}

// Theme is kept on this computer (ui/theme.ts); the rest with the display settings. Applied at once.
function Appearance() {
  const theme = useTheme();
  const display = useApp((state) => state.display);
  const size = display.textSize ?? 100;
  const toggles: { key: "moreContrast" | "lessMotion" | "announceRequests"; label: string }[] = [
    { key: "moreContrast", label: "Higher contrast" },
    { key: "lessMotion", label: "Less motion" },
    { key: "announceRequests", label: "Read out new requests with a screen reader" },
  ];
  return (
    <section className={page.panel} aria-labelledby="settings-appearance">
      <h2 id="settings-appearance" className={page.sectionTitle}>
        Appearance
      </h2>
      <fieldset className={styles.sizes}>
        <legend className={styles.legend}>Theme</legend>
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
      <fieldset className={styles.sizes}>
        <legend className={styles.legend}>Text size</legend>
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
      <div className={styles.switches}>
        {toggles.map(({ key, label }) => (
          <SwitchRow
            key={key}
            label={label}
            on={key === "announceRequests" ? display[key] !== false : display[key] === true}
            onChange={(on) => void saveDisplay({ [key]: on })}
          />
        ))}
      </div>
    </section>
  );
}

// Always here; Tasks shows it only once it is large (a3-19).
function Storage() {
  const bytes = useStoreSize();
  return (
    <section className={page.panel} aria-labelledby="settings-storage">
      <h2 id="settings-storage" className={page.sectionTitle}>
        Storage
      </h2>
      <p className={styles.storage}>
        Task history on this computer
        <span>{bytes === undefined ? "" : byteSize(bytes)}</span>
      </p>
    </section>
  );
}

export function SettingsView() {
  return (
    <section className={page.page} aria-labelledby="settings-title">
      <div className={page.form}>
        <PageHeader id="settings-title" title="Settings" />
        <NewTasks />
        <Notifications />
        <Appearance />
        <Storage />
      </div>
    </section>
  );
}
