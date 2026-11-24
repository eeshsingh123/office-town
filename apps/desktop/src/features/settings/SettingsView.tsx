import type { Display, EverydayAutonomy } from "@office-town/contract";
import { type ReactNode, useEffect, useState } from "react";
import { type DesktopPreferences, shell, type UpdateStatus } from "../../shell.ts";
import { navigate, useApp } from "../../store/app-store.ts";
import { AUTONOMY } from "../../ui/autonomy.ts";
import { Button } from "../../ui/Button.tsx";
import { byteSize } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { Segments } from "../../ui/Segments.tsx";
import { SettingRow, SwitchRow } from "../../ui/Switch.tsx";
import { trayName } from "../../ui/system.ts";
import { showToast } from "../../ui/Toast.tsx";
import { chooseTheme, type ThemeChoice, useThemeChoice } from "../../ui/theme.ts";
import { saveDisplay } from "../onboarding/onboarding.ts";
import {
  saveDefaultLevel,
  saveTaskDefault,
  TASK_OPTIONS,
  useDefaultLevel,
  useTaskDefaults,
} from "../task/task-options.ts";
import { useStoreInfo } from "../tasks/store-size.ts";
import { UpdatesSettings } from "../updates/UpdatesSettings.tsx";
import styles from "./Settings.module.css";

// The groups in the order people come for them; Ctrl K opens each by its id (D-111).
export const SETTINGS_SECTIONS = [
  { id: "appearance", title: "Appearance", keywords: ["theme", "dark mode", "light mode", "size"] },
  {
    id: "updates",
    title: "Updates",
    keywords: ["notifications", "alerts", "slack", "telegram", "discord", "email", "webhook"],
  },
  { id: "new-tasks", title: "New tasks", keywords: ["permission", "manual", "auto", "efficient"] },
  {
    id: "accessibility",
    title: "Accessibility",
    keywords: ["contrast", "motion", "screen reader"],
  },
  { id: "desktop", title: "Desktop", keywords: ["tray", "menu bar", "close", "login", "startup"] },
  { id: "about", title: "Storage and About", keywords: ["version", "update", "data folder"] },
] as const;
type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

function Group({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SETTINGS_SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section
      id={`settings-${id}`}
      className={styles.group}
      aria-labelledby={`settings-${id}-title`}
    >
      <h2 id={`settings-${id}-title`} className={styles.groupTitle}>
        {title}
      </h2>
      <div className={styles.card}>{children}</div>
    </section>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// The same percentages as before, named by what they do: the whole interface grows.
const SIZES: { value: string; label: string }[] = [
  { value: "100", label: "Default" },
  { value: "115", label: "Large" },
  { value: "130", label: "Larger" },
];

function Appearance() {
  const theme = useThemeChoice();
  const size = useApp((state) => state.display.textSize ?? 100);
  return (
    <Group id="appearance">
      <SettingRow label="Theme" hint={theme === "system" ? "Follows your computer." : undefined}>
        <Segments label="Theme" value={theme} options={THEMES} onChange={chooseTheme} />
      </SettingRow>
      <SettingRow label="Interface size" hint="Text, icons and spacing grow together.">
        <Segments
          label="Interface size"
          value={String(size)}
          options={SIZES}
          onChange={(value) =>
            void saveDisplayOrSay({ textSize: Number(value) as NonNullable<Display["textSize"]> })
          }
        />
      </SettingRow>
    </Group>
  );
}

// Saved at once; put back with a note if the core refuses it.
async function saveDisplayOrSay(change: Partial<Display>): Promise<void> {
  const before = useApp.getState().display;
  try {
    await saveDisplay(change);
  } catch {
    useApp.setState({ display: before });
    showToast("The choice could not be saved.");
  }
}

const LEVELS: { value: EverydayAutonomy; label: string }[] = [
  { value: "supervised", label: AUTONOMY.supervised.label },
  { value: "full", label: AUTONOMY.full.label },
];

function NewTasks() {
  const defaults = useTaskDefaults();
  const level = useDefaultLevel();
  return (
    <Group id="new-tasks">
      <SettingRow
        label="Permissions"
        hint={`${AUTONOMY[level].description} New tasks, teams and departments start here; you can change it for each one.`}
      >
        <Segments label="Permissions" value={level} options={LEVELS} onChange={saveDefaultLevel} />
      </SettingRow>
      {TASK_OPTIONS.map((option) => (
        <SwitchRow
          key={option.key}
          label={option.label}
          hint={option.hint}
          on={defaults[option.key]}
          onChange={(on) => saveTaskDefault(option.key, on)}
        />
      ))}
    </Group>
  );
}

function Accessibility() {
  const display = useApp((state) => state.display);
  const toggles: { key: "moreContrast" | "lessMotion" | "announceRequests"; label: string }[] = [
    { key: "moreContrast", label: "Higher contrast" },
    { key: "lessMotion", label: "Less motion" },
    { key: "announceRequests", label: "Announce new requests to a screen reader" },
  ];
  return (
    <Group id="accessibility">
      {toggles.map(({ key, label }) => (
        <SwitchRow
          key={key}
          label={label}
          on={key === "announceRequests" ? display[key] !== false : display[key] === true}
          onChange={(on) => void saveDisplayOrSay({ [key]: on })}
        />
      ))}
    </Group>
  );
}

function useDesktopPreferences() {
  const [preferences, setPreferences] = useState<DesktopPreferences>();
  useEffect(() => {
    void shell?.desktopPreferences().then(setPreferences);
  }, []);
  return [preferences, setPreferences] as const;
}

// Only in the app; the browser mode has no window of its own.
function Desktop() {
  const [preferences, setPreferences] = useDesktopPreferences();
  if (shell === undefined || preferences === undefined) return null;
  const closeTo = preferences.closeToTray ? "tray" : "quit";
  return (
    <Group id="desktop">
      <SettingRow
        label="When I close the window"
        hint={
          preferences.closeToTray
            ? `Agents keep working. Quit from the ${trayName} icon.`
            : "The app quits, and asks first if agents are still working."
        }
      >
        <Segments
          label="When I close the window"
          value={closeTo}
          options={[
            { value: "tray", label: `Keep running in the ${trayName}` },
            { value: "quit", label: "Quit" },
          ]}
          onChange={(value) => {
            const closeToTray = value === "tray";
            setPreferences({ ...preferences, closeToTray });
            shell?.setCloseToTray(closeToTray).catch(() => {
              setPreferences({ ...preferences });
              showToast("The choice could not be saved.");
            });
          }}
        />
      </SettingRow>
      <SwitchRow
        label="Keep the computer awake while agents work"
        hint="Also on battery. The screen can still turn off."
        on={preferences.keepAwake}
        onChange={(keepAwake) => {
          setPreferences({ ...preferences, keepAwake });
          shell?.setKeepAwake(keepAwake).catch(() => {
            setPreferences({ ...preferences });
            showToast("The choice could not be saved.");
          });
        }}
      />
      {preferences.canOpenAtLogin ? (
        <SwitchRow
          label="Open at login"
          hint={
            preferences.openAtLoginNeedsApproval
              ? "Allow Office Town in System Settings > General > Login Items."
              : "Opens the app when you sign in to your computer."
          }
          on={preferences.openAtLogin}
          onChange={(on) =>
            void shell
              ?.setOpenAtLogin(on)
              .then((openAtLogin) => setPreferences({ ...preferences, openAtLogin }))
          }
        />
      ) : null}
    </Group>
  );
}

function useUpdates() {
  const [version, setVersion] = useState<string>();
  const [status, setStatus] = useState<UpdateStatus | null>();
  useEffect(() => {
    if (shell === undefined) return;
    void shell.appVersion().then(setVersion);
    void shell.updateStatus().then(setStatus);
    // Ready to install, or for a build that cannot install it, ready to download.
    return shell.onUpdateReady(() => void shell?.updateStatus().then(setStatus));
  }, []);
  return { version, status, setStatus };
}

function updateLine(status: UpdateStatus | null | undefined): string {
  if (status === null) return "The development app does not update itself.";
  switch (status?.state) {
    case "checking":
      return "Checking for updates";
    case "latest":
      return "Up to date.";
    case "downloading":
      return `Downloading version ${status.version}.`;
    case "ready":
      return `Version ${status.version} is ready. Restart to install it.`;
    case "available":
      return `Version ${status.version} is ready. Download it and replace this app.`;
    case "failed":
      return "Could not check for updates. Try again later.";
    default:
      return "Checks for updates every few hours.";
  }
}

const PROJECT = "https://github.com/eeshsingh123/office-town";

function StorageAndAbout() {
  const { bytes, folder } = useStoreInfo();
  const { version, status, setStatus } = useUpdates();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    setStatus({ state: "checking" });
    setStatus(await shell?.checkForUpdates());
    setChecking(false);
  };
  return (
    <Group id="about">
      <SettingRow
        label="Task history"
        hint={`${bytes === undefined ? "…" : byteSize(bytes)} on this computer. Deleting tasks frees it.`}
      >
        <span className={styles.actions}>
          <Button onClick={() => navigate({ name: "tasks" })}>Show tasks</Button>
          {shell === undefined || folder === undefined ? null : (
            <Button onClick={() => void shell?.openFolder(folder)}>Open data folder</Button>
          )}
        </span>
      </SettingRow>
      {shell === undefined ? null : (
        <SettingRow
          label={`Version ${version ?? ""}`.trim()}
          hint={`${version?.includes("-beta") ? "Beta channel. " : ""}${updateLine(status)}`}
        >
          {status === null ? null : status?.state === "ready" || status?.state === "available" ? (
            <Button variant="primary" onClick={() => void shell?.restartToUpdate()}>
              {status.state === "ready" ? "Restart to update" : "Download"}
            </Button>
          ) : (
            <Button busy={checking} onClick={() => void check()}>
              Check for updates
            </Button>
          )}
        </SettingRow>
      )}
      <SettingRow label="Source code" hint="Open source, on GitHub.">
        <a className={styles.link} href={PROJECT} target="_blank" rel="noreferrer">
          Open project page
        </a>
      </SettingRow>
    </Group>
  );
}

export function SettingsView() {
  const section = useApp((state) =>
    state.view.name === "settings" ? state.view.section : undefined,
  );
  useEffect(() => {
    if (section === undefined) return;
    document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);
  return (
    <section className={page.page} aria-labelledby="settings-title">
      <div className={page.form}>
        <PageHeader id="settings-title" title="Settings" />
        <Appearance />
        <Group id="updates">
          <UpdatesSettings />
        </Group>
        <NewTasks />
        <Accessibility />
        <Desktop />
        <StorageAndAbout />
      </div>
    </section>
  );
}
