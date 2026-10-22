import type { OutputRecord } from "@office-town/contract";
import { navigate, useApp } from "../../store/app-store.ts";
import type { ShownInput } from "../../trace/team-tools.ts";
import { Button } from "../../ui/Button.tsx";
import { ago } from "../../ui/format.ts";
import { KIND_LABELS, viewKindOf } from "./kinds.ts";
import styles from "./Outputs.module.css";
import { Picture, pictureSource } from "./Picture.tsx";
import { useResults } from "./use-task-outputs.ts";

export const openOutput = (output: OutputRecord) =>
  navigate({ name: "task", taskId: output.taskId, tab: "outputs", output: output.id });

function kindLine(output: OutputRecord): string {
  const kind = KIND_LABELS[viewKindOf(output.target)];
  const versions = output.versions.length;
  return versions > 1 ? `${kind} · Version ${versions}` : `${kind} · ${ago(output.updatedAt)}`;
}

// In the chat once an agent shows it, and in the side panel as its latest result.
export function ResultCard({
  output,
  primary = false,
}: {
  output: OutputRecord;
  primary?: boolean;
}) {
  // Without a picture yet, a row: a large empty frame says nothing.
  const pictured = pictureSource(output) !== undefined;
  return (
    <div className={`${styles.card} ${pictured ? "" : styles.cardRow}`}>
      <Picture output={output} large={pictured} />
      <div className={styles.cardBody}>
        <div className={styles.cardText}>
          <strong>{output.title}</strong>
          <span>{kindLine(output)}</span>
        </div>
        <Button variant={primary ? "primary" : "secondary"} onClick={() => openOutput(output)}>
          Open
        </Button>
      </div>
    </div>
  );
}

const folded = (path: string) => path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();

// By what was shown, since showing it again may rename it. A relative or WSL path is the end of
// the stored one; a site's host is stored as localhost.
function showedIt(output: OutputRecord, shows: ShownInput): boolean {
  const { target } = output;
  if (target.kind === "file") {
    if (shows.path === undefined) return false;
    const [stored, given] = [folded(target.path), folded(shows.path)];
    return stored === given || stored.endsWith(`/${given.replace(/^\//, "")}`);
  }
  if (shows.url === undefined || !URL.canParse(shows.url)) return false;
  const [stored, given] = [new URL(target.url), new URL(shows.url)];
  return stored.port === given.port && stored.pathname === given.pathname;
}

// Where an agent called show_result; a later version shows on the same card.
export function ShownResult({ sessionId, shows }: { sessionId: string; shows: ShownInput }) {
  const output = useApp((state) => {
    const taskId = state.sessions[sessionId]?.taskId;
    const ofTask = Object.values(state.outputs).filter((one) => one.taskId === taskId);
    const matching = ofTask.filter((one) => showedIt(one, shows));
    return (
      matching.find((one) => one.title === shows.title) ??
      matching[0] ??
      ofTask.find((one) => one.title === shows.title)
    );
  });
  return output === undefined ? null : <ResultCard output={output} primary />;
}

// Small pictures, as in the review card.
export function ResultStrip({ outputs }: { outputs: readonly OutputRecord[] }) {
  return (
    <div className={styles.strip}>
      {outputs.map((output) => (
        <button
          key={output.id}
          type="button"
          className={styles.stripItem}
          onClick={() => openOutput(output)}
        >
          <Picture output={output} />
          <span>{output.title}</span>
        </button>
      ))}
    </div>
  );
}

// Enough to look at the work before marking it reviewed.
const REVIEW_RESULTS = 3;

export function ReviewResults({ taskId }: { taskId: string }) {
  const results = useResults(taskId);
  if (results.length === 0) return null;
  return (
    <div className={styles.review}>
      <ResultStrip outputs={results.slice(0, REVIEW_RESULTS)} />
      <button
        type="button"
        className={styles.link}
        onClick={() => navigate({ name: "task", taskId, tab: "outputs" })}
      >
        {results.length > REVIEW_RESULTS ? `See all ${results.length} outputs` : "Open outputs"}
      </button>
    </div>
  );
}

// One line each, as in a department's panel.
export function ResultRows({ outputs }: { outputs: readonly OutputRecord[] }) {
  return (
    <ul className={styles.rows}>
      {outputs.map((output) => (
        <li key={output.id}>
          <button type="button" className={styles.row} onClick={() => openOutput(output)}>
            <Picture output={output} />
            <span className={styles.cardText}>
              <strong>{output.title}</strong>
              <span>{kindLine(output)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
