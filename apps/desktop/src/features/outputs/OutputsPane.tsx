import type { AgentRecord, ChangedFile, OutputRecord, SpottedSite } from "@office-town/contract";
import { ChevronDown, Globe } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store/app-store.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { ago } from "../../ui/format.ts";
import { fileName, KIND_LABELS, shownPath, viewKindOf } from "./kinds.ts";
import styles from "./Outputs.module.css";
import { KindIcon, Picture } from "./Picture.tsx";
import { useTaskOutputs } from "./use-task-outputs.ts";
import { type Shown, Viewer } from "./Viewer.tsx";

// Changed files start folded; this many show once opened, then "Show more".
const CHANGED_PAGE = 8;

function keyOf(shown: Shown): string {
  if (shown.kind === "result") return `result:${shown.output.id}`;
  if (shown.kind === "spotted") return `spotted:${shown.site.url}`;
  return `file:${shown.file.path}`;
}

export function OutputsPane({
  taskId,
  chosen,
  onChoose,
}: {
  taskId: string;
  // A result's id, from the view.
  chosen: string | undefined;
  onChoose: (outputId: string | undefined) => void;
}) {
  const { results, outputs, failed, read } = useTaskOutputs(taskId);
  const agents = useApp((state) => state.agents);
  const [picked, setPicked] = useState<Shown>();
  const [changedOpen, setChangedOpen] = useState(false);
  const [changedShown, setChangedShown] = useState(CHANGED_PAGE);
  const roots = outputs?.roots ?? [];
  const running = new Set(outputs?.running);
  // Someone else's page in browser mode is this one; it is never offered as a site.
  const spotted = (outputs?.spotted ?? []).filter(
    ({ url }) => new URL(url).origin !== window.location.origin,
  );
  const changed = outputs?.changed ?? [];

  const current = ((): Shown | undefined => {
    const viewed = results.find((output) => output.id === chosen);
    if (viewed !== undefined) return { kind: "result", output: viewed };
    if (picked !== undefined && picked.kind !== "result") return picked;
    const [latest] = results;
    return latest === undefined ? undefined : { kind: "result", output: latest };
  })();
  const choose = (shown: Shown) => {
    setPicked(shown);
    onChoose(shown.kind === "result" ? shown.output.id : undefined);
  };
  const currentKey = current === undefined ? undefined : keyOf(current);

  if (outputs === undefined && results.length === 0) {
    return (
      <div className={styles.empty}>
        <p>{failed ? "The outputs could not be read." : "Reading the outputs…"}</p>
      </div>
    );
  }
  if (results.length === 0 && changed.length === 0 && spotted.length === 0) {
    return (
      <div className={styles.empty}>
        <strong>Nothing to show yet</strong>
        <p>
          When an agent makes a page, image, document or site for you to look at, it shows up here.
          So do the files the agents change.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.pane}>
      <nav className={styles.list} aria-label="Outputs">
        {results.length === 0 ? null : (
          <section className={styles.group}>
            <h2 className={styles.groupLabel}>
              Results <span>{results.length}</span>
            </h2>
            <ul className={styles.items}>
              {results.map((output) => (
                <li key={output.id}>
                  <ResultItem
                    output={output}
                    agent={agents[output.agentId]}
                    live={output.target.kind === "site" && running.has(output.target.url)}
                    chosen={currentKey === `result:${output.id}`}
                    onChoose={() => choose({ kind: "result", output })}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {spotted.length === 0 ? null : (
          <section className={styles.group}>
            <h2 className={styles.groupLabel}>
              Spotted running <span>{spotted.length}</span>
            </h2>
            <ul className={styles.items}>
              {spotted.map((site) => (
                <li key={site.url}>
                  <SpottedItem
                    site={site}
                    agentName={agents[site.agentId]?.name}
                    chosen={currentKey === `spotted:${site.url}`}
                    onChoose={() => choose({ kind: "spotted", site })}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {changed.length === 0 ? null : (
          <section className={styles.changed}>
            <button
              type="button"
              className={styles.changedHead}
              aria-expanded={changedOpen}
              onClick={() => setChangedOpen(!changedOpen)}
            >
              <ChevronDown
                size={14}
                aria-hidden
                className={changedOpen ? styles.chevronOpen : styles.chevron}
              />
              {results.length === 0 ? "Changed files" : "Other changed files"}
              <span className={styles.count}>{changed.length}</span>
            </button>
            {changedOpen ? (
              <ul className={styles.files}>
                {changed.slice(0, changedShown).map((file) => (
                  <li key={file.path}>
                    <FileItem
                      file={file}
                      roots={roots}
                      chosen={currentKey === `file:${file.path}`}
                      onChoose={() => choose({ kind: "file", file })}
                    />
                  </li>
                ))}
                {changed.length > changedShown ? (
                  <li className={styles.more}>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => setChangedShown(changedShown + CHANGED_PAGE * 4)}
                    >
                      Show {Math.min(changed.length - changedShown, CHANGED_PAGE * 4)} more
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </section>
        )}
      </nav>
      {current === undefined ? (
        <div className={styles.empty}>
          <p>Pick something on the left to see it here.</p>
        </div>
      ) : (
        <Viewer
          key={currentKey}
          taskId={taskId}
          shown={current}
          roots={roots}
          running={
            current.kind === "spotted" ||
            (current.kind === "result" &&
              current.output.target.kind === "site" &&
              running.has(current.output.target.url))
          }
          contextTokens={outputs?.contextTokens ?? {}}
          onRestarted={read}
        />
      )}
    </div>
  );
}

function ResultItem({
  output,
  agent,
  live,
  chosen,
  onChoose,
}: {
  output: OutputRecord;
  agent: AgentRecord | undefined;
  live: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  const kind = viewKindOf(output.target);
  const state = kind === "site" ? (live ? "Running" : "Stopped") : ago(output.updatedAt);
  return (
    <button
      type="button"
      className={`${styles.item} ${chosen ? styles.chosen : ""}`}
      aria-current={chosen ? "true" : undefined}
      onClick={onChoose}
    >
      <Picture output={output} live={live} />
      <span className={styles.itemText}>
        <strong>{output.title}</strong>
        <span className={styles.meta}>
          {agent === undefined ? null : (
            <Avatar name={agent.name} colour={agent.colour} size={18} />
          )}
          <span>
            {[agent?.name, KIND_LABELS[kind], state]
              .filter((part) => part !== undefined)
              .join(" · ")}
          </span>
        </span>
      </span>
    </button>
  );
}

function SpottedItem({
  site,
  agentName,
  chosen,
  onChoose,
}: {
  site: SpottedSite;
  agentName: string | undefined;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.item} ${styles.spotted} ${chosen ? styles.chosen : ""}`}
      aria-current={chosen ? "true" : undefined}
      onClick={onChoose}
    >
      <span className={styles.picture}>
        <Globe size={18} aria-hidden />
        <span className={styles.liveDot} aria-hidden />
      </span>
      <span className={styles.itemText}>
        <strong>{new URL(site.url).host}</strong>
        <span className={styles.meta}>
          <span>{agentName === undefined ? "Seen running" : `In ${agentName}'s output`}</span>
        </span>
      </span>
    </button>
  );
}

function FileItem({
  file,
  roots,
  chosen,
  onChoose,
}: {
  file: ChangedFile;
  roots: readonly string[];
  chosen: boolean;
  onChoose: () => void;
}) {
  const path = shownPath(file.path, roots);
  return (
    <button
      type="button"
      className={`${styles.file} ${chosen ? styles.fileChosen : ""}`}
      aria-current={chosen ? "true" : undefined}
      title={path}
      onClick={onChoose}
    >
      <KindIcon kind={viewKindOf({ kind: "file", path: file.path })} size={14} />
      <span className={styles.filePath}>
        <span className={styles.fileDir}>{path.slice(0, path.length - fileName(path).length)}</span>
        {fileName(path)}
      </span>
      {file.deleted ? <span className={styles.deleted}>Deleted</span> : null}
    </button>
  );
}
