import {
  CHECK_MINUTES,
  type EventSourceConfig,
  type EventSourceKind,
  eventSourceSchema,
} from "@office-town/contract";
import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { shell } from "../../shell.ts";
import { navigate } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { Segments } from "../../ui/Segments.tsx";
import { Switch } from "../../ui/Switch.tsx";
import { useConnectors } from "../connectors/connectors.ts";
import styles from "./NewAutomation.module.css";
import { everyText, folderName } from "./words.ts";

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Watch = Extract<EventSourceConfig, { kind: "github" }>["watch"];

export interface EventForm {
  source: EventSourceKind;
  folder: string | undefined;
  subfolders: boolean;
  look: string;
  everyMinutes: number;
  repo: string;
  watch: Watch;
  url: string;
}

export const blankEvent = (): EventForm => ({
  source: "folder",
  folder: undefined,
  subfolders: true,
  look: "",
  everyMinutes: CHECK_MINUTES.first,
  repo: "",
  watch: "issues",
  url: "",
});

export function eventOf(source: EventSourceConfig): EventForm {
  const blank = blankEvent();
  switch (source.kind) {
    case "folder":
      return { ...blank, source: "folder", folder: source.path, subfolders: source.subfolders };
    case "check":
      return { ...blank, source: "check", look: source.look, everyMinutes: source.everyMinutes };
    case "github":
      return { ...blank, source: "github", repo: source.repo, watch: source.watch };
    case "feed":
      return { ...blank, source: "feed", url: source.url };
  }
}

// Undefined until the chosen source has what it needs.
export function sourceOf(
  event: EventForm,
  githubId: string | undefined,
): EventSourceConfig | undefined {
  const config =
    event.source === "folder"
      ? { kind: "folder", path: event.folder, subfolders: event.subfolders }
      : event.source === "check"
        ? { kind: "check", look: event.look, everyMinutes: event.everyMinutes }
        : event.source === "github"
          ? { kind: "github", connectorId: githubId, repo: event.repo.trim(), watch: event.watch }
          : { kind: "feed", url: event.url.trim() };
  const parsed = eventSourceSchema.safeParse(config);
  return parsed.success ? parsed.data : undefined;
}

// What the chosen source still needs, in one sentence.
export function eventMissing(event: EventForm, githubId: string | undefined): string {
  switch (event.source) {
    case "folder":
      return "Choose the folder to watch.";
    case "check":
      return "Say what the check looks for.";
    case "github":
      return githubId === undefined
        ? "Add the GitHub app in Connectors first."
        : "Write the repository as owner/name.";
    case "feed":
      return "Write the feed's address, starting with https://.";
  }
}

const SOURCES: { value: EventSourceKind; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "check", label: "Agent check" },
  { value: "github", label: "GitHub" },
  { value: "feed", label: "RSS feed" },
];

const CHECK_GAPS = [15, 30, 60, 120, 240, 480, 720, 1440];

const WATCHES: { value: Watch; label: string }[] = [
  { value: "issues", label: "Issues" },
  { value: "pulls", label: "Pull requests" },
  { value: "both", label: "Both" },
];

export const useGitHubApp = () =>
  useConnectors().find((connector) => connector.setup.slug === "github");

// One row of a When panel: its label on the left, its values in a line on the right.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldValue}>{children}</div>
    </>
  );
}

type Set = (change: Partial<EventForm>) => void;

function FolderFields({ value, set }: { value: EventForm; set: Set }) {
  const pick = async () => {
    const path = await shell?.pickFolder();
    if (path) set({ folder: path });
  };
  return (
    <>
      <Field label="Folder">
        <button
          type="button"
          className={styles.inline}
          title={value.folder}
          onClick={() => void pick()}
        >
          <FolderOpen size={13} aria-hidden />
          {value.folder === undefined ? "Choose a folder" : folderName(value.folder)}
        </button>
        {value.folder === undefined ? null : <span className={styles.muted}>{value.folder}</span>}
      </Field>
      <Field label="Subfolders">
        <Switch
          label="Include subfolders"
          on={value.subfolders}
          onChange={(subfolders) => set({ subfolders })}
        />
        <span className={styles.muted}>Watch the folders inside it too</span>
      </Field>
    </>
  );
}

function CheckFields({ value, set }: { value: EventForm; set: Set }) {
  return (
    <>
      <Field label="Look for">
        <textarea
          className={`${form.input} ${styles.grow}`}
          aria-label="What to look for"
          rows={2}
          maxLength={2000}
          placeholder="New emails with an invoice attached"
          value={value.look}
          onChange={(event) => set({ look: event.target.value })}
        />
      </Field>
      <Field label="How often">
        <select
          className={styles.inline}
          aria-label="How often to look"
          value={value.everyMinutes}
          onChange={(event) => set({ everyMinutes: Number(event.target.value) })}
        >
          {CHECK_GAPS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {capitalized(everyText(minutes))}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function GitHubFields({ value, set }: { value: EventForm; set: Set }) {
  return (
    <>
      <Field label="Repository">
        <input
          className={`${form.input} ${styles.grow}`}
          aria-label="Repository"
          placeholder="owner/name"
          spellCheck={false}
          value={value.repo}
          onChange={(event) => set({ repo: event.target.value })}
        />
      </Field>
      <Field label="Watch">
        <Segments
          label="What to watch"
          value={value.watch}
          options={WATCHES}
          onChange={(watch) => set({ watch })}
        />
      </Field>
    </>
  );
}

function FeedFields({ value, set }: { value: EventForm; set: Set }) {
  return (
    <Field label="Address">
      <input
        className={`${form.input} ${styles.grow}`}
        type="url"
        aria-label="Feed address"
        placeholder="https://example.com/feed.xml"
        spellCheck={false}
        value={value.url}
        onChange={(event) => set({ url: event.target.value })}
      />
    </Field>
  );
}

// What each source does, in one line under its fields.
const NOTES: Record<EventSourceKind, string> = {
  folder: "Only new files start a run. Files this automation's runs make don't.",
  check:
    "Whoever does the task looks through their apps. A run starts only when something is new. Each look uses their plan.",
  github: "Checked every 5 minutes. Issues and pull requests already there don't start a run.",
  feed: "RSS or Atom, checked every 15 minutes. Posts already there don't start a run.",
};

export function EventFields({
  value,
  onChange,
}: {
  value: EventForm;
  onChange: (next: EventForm) => void;
}) {
  const set: Set = (change) => onChange({ ...value, ...change });
  const github = useGitHubApp();
  return (
    <>
      <Segments
        label="What arrives"
        value={value.source}
        options={SOURCES}
        onChange={(source) => set({ source })}
      />
      {value.source === "github" && github === undefined ? (
        <div className={styles.missing}>
          <span className={form.hint}>Add the GitHub app in Connectors first.</span>
          <Button onClick={() => navigate({ name: "connectors" })}>Open Connectors</Button>
        </div>
      ) : (
        <>
          <div className={styles.fields}>
            {value.source === "folder" ? <FolderFields value={value} set={set} /> : null}
            {value.source === "check" ? <CheckFields value={value} set={set} /> : null}
            {value.source === "github" ? <GitHubFields value={value} set={set} /> : null}
            {value.source === "feed" ? <FeedFields value={value} set={set} /> : null}
          </div>
          <p className={form.hint}>{NOTES[value.source]}</p>
        </>
      )}
    </>
  );
}
