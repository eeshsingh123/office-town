import {
  CHECK_MINUTES,
  type EventSourceConfig,
  type EventSourceKind,
  eventSourceSchema,
} from "@office-town/contract";
import { shell } from "../../shell.ts";
import { navigate } from "../../store/app-store.ts";
import { Button } from "../../ui/Button.tsx";
import form from "../../ui/Form.module.css";
import { SwitchRow } from "../../ui/Switch.tsx";
import { useConnectors } from "../connectors/connectors.ts";
import styles from "./NewAutomation.module.css";
import { everyText, folderName } from "./words.ts";

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
  { value: "folder", label: "A file in a folder" },
  { value: "check", label: "An agent check" },
  { value: "github", label: "GitHub" },
  { value: "feed", label: "A feed" },
];

const CHECK_GAPS = [15, 30, 60, 120, 240, 480, 720, 1440];

const WATCHES: { value: Watch; label: string }[] = [
  { value: "issues", label: "issue" },
  { value: "pulls", label: "pull request" },
  { value: "both", label: "issue or pull request" },
];

export const useGitHubApp = () =>
  useConnectors().find((connector) => connector.setup.slug === "github");

function FolderFields({
  value,
  set,
}: {
  value: EventForm;
  set: (change: Partial<EventForm>) => void;
}) {
  const pick = async () => {
    const path = await shell?.pickFolder();
    if (path) set({ folder: path });
  };
  return (
    <>
      <p className={styles.rule}>
        When a file lands in{" "}
        <button type="button" className={styles.inline} onClick={() => void pick()}>
          {value.folder === undefined ? "choose a folder" : folderName(value.folder)}
        </button>
      </p>
      {value.folder === undefined ? null : <p className={styles.note}>{value.folder}</p>}
      <SwitchRow
        label="Include its subfolders"
        on={value.subfolders}
        onChange={(subfolders) => set({ subfolders })}
      />
      <p className={form.hint}>Files the automation's own runs write never start it.</p>
    </>
  );
}

function CheckFields({
  value,
  set,
}: {
  value: EventForm;
  set: (change: Partial<EventForm>) => void;
}) {
  return (
    <>
      <p className={styles.rule}>
        Look{" "}
        <select
          className={styles.inline}
          aria-label="How often to look"
          value={value.everyMinutes}
          onChange={(event) => set({ everyMinutes: Number(event.target.value) })}
        >
          {CHECK_GAPS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {everyText(minutes)}
            </option>
          ))}
        </select>{" "}
        for
      </p>
      <textarea
        className={form.input}
        aria-label="What to look for"
        rows={2}
        maxLength={2000}
        placeholder="New emails with an invoice attached"
        value={value.look}
        onChange={(event) => set({ look: event.target.value })}
      />
      <p className={form.hint}>
        Whoever does the task looks through its apps; a run starts only when something is new. Each
        look uses a little of their plan.
      </p>
    </>
  );
}

function GitHubFields({
  value,
  set,
}: {
  value: EventForm;
  set: (change: Partial<EventForm>) => void;
}) {
  const app = useGitHubApp();
  if (app === undefined) {
    return (
      <div className={styles.lines}>
        <p className={form.hint}>Add the GitHub app in Connectors first.</p>
        <div>
          <Button onClick={() => navigate({ name: "connectors" })}>Open Connectors</Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className={styles.rule}>
        When{" "}
        <input
          className={`${styles.count} ${styles.repo}`}
          aria-label="Repository"
          placeholder="owner/name"
          spellCheck={false}
          value={value.repo}
          onChange={(event) => set({ repo: event.target.value })}
        />{" "}
        gets a new{" "}
        <select
          className={styles.inline}
          aria-label="What to watch"
          value={value.watch}
          onChange={(event) => set({ watch: event.target.value as Watch })}
        >
          {WATCHES.map((watch) => (
            <option key={watch.value} value={watch.value}>
              {watch.label}
            </option>
          ))}
        </select>
      </p>
      <p className={form.hint}>
        Looked at every 5 minutes with the GitHub app's key. The first look only notes what is
        there.
      </p>
    </>
  );
}

function FeedFields({
  value,
  set,
}: {
  value: EventForm;
  set: (change: Partial<EventForm>) => void;
}) {
  return (
    <>
      <input
        className={form.input}
        type="url"
        aria-label="Feed address"
        placeholder="https://example.com/feed.xml"
        spellCheck={false}
        value={value.url}
        onChange={(event) => set({ url: event.target.value })}
      />
      <p className={form.hint}>
        An RSS or Atom feed, looked at every 15 minutes. The first look only notes what is there.
      </p>
    </>
  );
}

export function EventFields({
  value,
  onChange,
}: {
  value: EventForm;
  onChange: (next: EventForm) => void;
}) {
  const set = (change: Partial<EventForm>) => onChange({ ...value, ...change });
  return (
    <>
      <div className={styles.chipRow}>
        {SOURCES.map((source) => (
          <button
            key={source.value}
            type="button"
            className={form.chip}
            aria-pressed={value.source === source.value}
            onClick={() => set({ source: source.value })}
          >
            {source.label}
          </button>
        ))}
      </div>
      <div className={styles.lines}>
        {value.source === "folder" ? <FolderFields value={value} set={set} /> : null}
        {value.source === "check" ? <CheckFields value={value} set={set} /> : null}
        {value.source === "github" ? <GitHubFields value={value} set={set} /> : null}
        {value.source === "feed" ? <FeedFields value={value} set={set} /> : null}
      </div>
    </>
  );
}
