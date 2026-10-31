import {
  type ChangedFile,
  MAX_PREVIEW_TEXT_BYTES,
  MAX_TABLE_ROWS,
  OPENS_SAFELY,
  type OutputFileQuery,
  type OutputRecord,
  type OutputTarget,
  type SpottedSite,
} from "@office-town/contract";
import {
  Crosshair,
  ExternalLink,
  FolderOpen,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  RotateCw,
  Send,
  Smartphone,
  SquareArrowOutUpRight,
  Tablet,
  X,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, fileAddress } from "../../api/client.ts";
import { type Area, shell } from "../../shell.ts";
import { useApp } from "../../store/app-store.ts";
import { useDraft } from "../../store/drafts.ts";
import { Avatar } from "../../ui/Avatar.tsx";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ago, byteSize, clockTime, compactCount } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { showToast } from "../../ui/Toast.tsx";
import {
  extensionOf,
  fileName,
  KIND_LABELS,
  parseTable,
  shownPath,
  type ViewKind,
  viewKindOf,
} from "./kinds.ts";
import styles from "./Outputs.module.css";
import { PICTURE_WIDTH, pictureIsCurrent, toBlob } from "./use-page-picture.ts";

export type Shown =
  | { kind: "result"; output: OutputRecord }
  | { kind: "spotted"; site: SpottedSite }
  | { kind: "file"; file: ChangedFile };

// Past this, continuing a conversation to start a server costs more than a fresh one (owner).
const FRESH_FROM_TOKENS = 100_000;
const SIZES = [
  { value: "desktop", label: "Desktop", width: undefined, Icon: Monitor },
  { value: "tablet", label: "Tablet", width: 768, Icon: Tablet },
  { value: "phone", label: "Phone", width: 390, Icon: Smartphone },
] as const;
type Size = (typeof SIZES)[number]["value"];
// Wide enough to read what the marked spot is.
const SPOT_AREA = { width: 520, height: 340 };
const PICTURE_DELAY_MS = 1500;
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

interface Spot {
  number: number;
  // In the stage, in page pixels.
  x: number;
  y: number;
  png?: Blob;
}

function targetOf(shown: Shown): OutputTarget {
  if (shown.kind === "result") return shown.output.target;
  if (shown.kind === "spotted") return { kind: "site", url: shown.site.url };
  return { kind: "file", path: shown.file.path };
}

function agentIdOf(shown: Shown): string {
  if (shown.kind === "result") return shown.output.agentId;
  if (shown.kind === "spotted") return shown.site.agentId;
  return shown.file.agentId;
}

export function Viewer({
  taskId,
  shown,
  roots,
  running,
  contextTokens,
  freshOnly,
  movedTo,
  onRestarted,
}: {
  taskId: string;
  shown: Shown;
  roots: readonly string[];
  // A site that answered on the last read.
  running: boolean;
  contextTokens: Record<string, number>;
  freshOnly: readonly string[];
  movedTo: Record<string, string>;
  onRestarted: () => void;
}) {
  const agent = useApp((state) => state.agents[agentIdOf(shown)]);
  const target = targetOf(shown);
  const kind = viewKindOf(target);
  const output = shown.kind === "result" ? shown.output : undefined;
  const versions = output?.versions ?? [];
  const latest = versions.at(-1)?.number;
  // Follows each new version the agent shows, unless an older one was picked.
  const [picked, setPicked] = useState<number>();
  const version = picked ?? latest;
  const query: OutputFileQuery | undefined =
    target.kind === "site"
      ? undefined
      : output !== undefined && version !== undefined && version !== latest
        ? { outputId: output.id, version }
        : { path: target.path };
  const [size, setSize] = useState<Size>("desktop");
  const [full, setFull] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [marking, setMarking] = useState(false);
  const [reloads, setReloads] = useState(0);
  // A new version or a reload reads the file again; spots marked on the old one no longer fit.
  const changedAt = shown.kind === "file" ? shown.file.at : output?.updatedAt;
  const stamp = `${version}:${changedAt}:${reloads}`;
  const [stampSeen, setStampSeen] = useState(stamp);
  if (stampSeen !== stamp) {
    setStampSeen(stamp);
    setSpots([]);
    setMarking(false);
  }
  const deleted = shown.kind === "file" && shown.file.deleted;
  const framed = kind === "page" || kind === "pdf";
  const queryKey = JSON.stringify(query);

  // A page loads from the preview server, never the app's own origin (M8).
  useEffect(() => {
    setPreviewUrl(undefined);
    if (!framed || deleted || queryKey === undefined) return;
    let current = true;
    api
      .preview(taskId, JSON.parse(queryKey) as OutputFileQuery)
      .then(({ url }) => {
        if (current) setPreviewUrl(url);
      })
      .catch(() => showToast("The page could not be opened."));
    return () => {
      current = false;
    };
  }, [taskId, framed, deleted, queryKey]);

  useEffect(() => {
    if (!full) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [full]);

  const title =
    output?.title ?? (target.kind === "site" ? new URL(target.url).host : fileName(target.path));
  // Where the file is on disk now, for the shell to open.
  const filePath =
    target.kind === "file" ? ((output && movedTo[output.id]) ?? target.path) : undefined;
  const where = target.kind === "site" ? target.url : shownPath(target.path, roots);
  const when =
    shown.kind === "result"
      ? `showed it ${ago(shown.output.updatedAt)}`
      : shown.kind === "file"
        ? `${shown.file.deleted ? "deleted" : "changed"} it ${ago(shown.file.at)}`
        : "is running it";
  const openAddress = target.kind === "site" ? target.url : framed ? previewUrl : undefined;
  const markable = shell !== undefined && (kind === "page" || kind === "site");
  const reloadable = target.kind === "file" && !deleted;
  const stoppedSite = target.kind === "site" && !running;

  const tools: ReactNode[] = [];
  if (versions.length > 1 && version !== undefined) {
    tools.push(
      <ChoiceMenu
        key="version"
        label="Version"
        value={String(version)}
        choices={versions.map((one) => ({
          value: String(one.number),
          label: `${one.number} of ${versions.length}`,
          description:
            one.kept || one.number === latest ? clockTime(one.at) : "Not kept: too large",
        }))}
        onChange={(next) => setPicked(Number(next) === latest ? undefined : Number(next))}
      />,
    );
  }
  if ((kind === "page" || kind === "site") && !stoppedSite) {
    tools.push(
      <fieldset key="size" className={styles.segment}>
        <legend className="visually-hidden">Screen size</legend>
        {SIZES.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={size === value}
            onClick={() => {
              setSize(value);
              setSpots([]);
            }}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </fieldset>,
    );
  }

  return (
    <section className={`${styles.viewer} ${full ? styles.full : ""}`} aria-label={title}>
      <header className={styles.viewerHead}>
        <div className={styles.viewerTitle}>
          <h2>
            {title}
            <span className={styles.kindChip}>{KIND_LABELS[kind]}</span>
          </h2>
          <p className={styles.byLine}>
            {agent === undefined ? null : (
              <Avatar name={agent.name} colour={agent.colour} size={20} />
            )}
            <span>{agent === undefined ? when : `${agent.name} ${when}`}</span>
            <span className={styles.path} title={where}>
              {where}
            </span>
          </p>
        </div>
        <div className={styles.viewerActions}>
          {openAddress === undefined ? null : (
            <a
              className={styles.iconButton}
              href={openAddress}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in browser"
              title="Open in browser"
            >
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
          {reloadable ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Reload"
              title="Reload"
              onClick={() => setReloads(reloads + 1)}
            >
              <RotateCw size={16} aria-hidden />
            </button>
          ) : null}
          {shell === undefined || filePath === undefined || deleted ? null : (
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Show in folder"
              title="Show in folder"
              onClick={() =>
                void shell?.showFile(filePath).catch(() => showToast("The file is not there."))
              }
            >
              <FolderOpen size={16} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={full ? "Leave full screen" : "Full screen"}
            title={full ? "Leave full screen (Esc)" : "Full screen"}
            onClick={() => setFull(!full)}
          >
            {full ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
          </button>
        </div>
      </header>
      {tools.length === 0 && kind !== "page" ? null : (
        <div className={styles.tools}>
          <div className={styles.toolsStart}>{tools}</div>
          {kind === "page" ? (
            <span
              className={styles.sandboxed}
              title="It cannot reach the app, or files outside this task's folders"
            >
              <Lock size={13} aria-hidden />
              Sandboxed
            </span>
          ) : null}
        </div>
      )}

      <div className={styles.body} key={stamp}>
        {deleted ? (
          <Note title="This file was deleted" text="It is listed because an agent removed it." />
        ) : stoppedSite && target.kind === "site" ? (
          <StoppedSite
            output={output}
            agentName={agent?.name ?? "The agent"}
            tokens={contextTokens[agentIdOf(shown)]}
            freshOnly={freshOnly.includes(agentIdOf(shown))}
            onRestarted={onRestarted}
          />
        ) : kind === "page" || kind === "site" ? (
          <FrameStage
            src={target.kind === "site" ? target.url : previewUrl}
            site={target.kind === "site"}
            width={SIZES.find((one) => one.value === size)?.width}
            title={title}
            spots={spots}
            marking={marking}
            onSpot={(spot) => {
              setSpots((all) => [...all, spot]);
              setMarking(false);
            }}
            onSpotPicture={(number, png) =>
              setSpots((all) => all.map((one) => (one.number === number ? { ...one, png } : one)))
            }
            pictureOf={
              output !== undefined && version === latest && size === "desktop" ? output : undefined
            }
          />
        ) : kind === "pdf" ? (
          previewUrl === undefined ? null : (
            <iframe className={styles.pdf} src={previewUrl} title={title} />
          )
        ) : kind === "image" && query !== undefined ? (
          <ImageBody
            src={`${fileAddress(taskId, query)}&at=${encodeURIComponent(stamp)}`}
            title={title}
          />
        ) : kind === "other" || query === undefined ? (
          <NoPreview path={filePath} />
        ) : (
          <TextBody taskId={taskId} query={query} kind={kind} path={filePath ?? ""} />
        )}
      </div>

      {shown.kind === "spotted" || agent === undefined ? null : (
        <AskBox
          taskId={taskId}
          agentId={agent.id}
          agentName={agent.name}
          about={`"${title}" (${where}${versions.length > 1 ? `, version ${version}` : ""})`}
          spots={spots}
          markable={markable && !stoppedSite}
          marking={marking}
          onMark={() => setMarking(!marking)}
          onRemoveSpot={(number) => setSpots((all) => all.filter((one) => one.number !== number))}
          onSent={() => setSpots([])}
        />
      )}
    </section>
  );
}

function Note({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className={styles.note}>
      <strong>{title}</strong>
      <p>{text}</p>
      {children}
    </div>
  );
}

// The page or site, sized like the device picked; marked spots sit over it.
function FrameStage({
  src,
  site,
  width,
  title,
  spots,
  marking,
  onSpot,
  onSpotPicture,
  pictureOf,
}: {
  src: string | undefined;
  site: boolean;
  width: number | undefined;
  title: string;
  spots: Spot[];
  marking: boolean;
  onSpot: (spot: Spot) => void;
  onSpotPicture: (number: number, png: Blob) => void;
  // A result whose saved picture is older than it, taken once the page has loaded.
  pictureOf: OutputRecord | undefined;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pictured = useRef(false);
  const [reloads, setReloads] = useState(0);
  const origin = site && src !== undefined ? new URL(src).origin : undefined;
  const [path, setPath] = useState(site && src !== undefined ? new URL(src).pathname : "/");
  const [address, setAddress] = useState(src);
  const shown = site ? address : src;
  const frameKey = `${shown}:${reloads}`;
  // Until the frame has loaded, so a slow page is not mistaken for an empty one.
  const [loadedKey, setLoadedKey] = useState<string>();

  const capture = async (area: Area, max?: number) => {
    if (shell === undefined) return undefined;
    return toBlob(await shell.capture(area, max));
  };

  const takePicture = () => {
    const output = pictureOf;
    const box = frame.current?.getBoundingClientRect();
    if (output === undefined || box === undefined || pictured.current) return;
    if (pictureIsCurrent(output)) return;
    pictured.current = true;
    setTimeout(() => {
      const now = frame.current?.getBoundingClientRect();
      if (now === undefined || now.width === 0) return;
      const height = Math.min(now.height, now.width * 0.625);
      void capture({ x: now.left, y: now.top, width: now.width, height }, PICTURE_WIDTH)
        .then((png) => (png === undefined ? undefined : api.savePicture(output.id, png)))
        .catch(() => {
          // The list shows the kind's icon until a later look takes it.
        });
    }, PICTURE_DELAY_MS);
  };

  const mark = (event: MouseEvent<HTMLButtonElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (box === undefined) return;
    const number = (spots.at(-1)?.number ?? 0) + 1;
    const spot = { number, x: event.clientX - box.left, y: event.clientY - box.top };
    onSpot(spot);
    // After the dot is drawn, so the picture shows it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const left = Math.max(box.left, event.clientX - SPOT_AREA.width / 2);
        const top = Math.max(box.top, event.clientY - SPOT_AREA.height / 2);
        const area = {
          x: left,
          y: top,
          width: Math.min(SPOT_AREA.width, box.right - left),
          height: Math.min(SPOT_AREA.height, box.bottom - top),
        };
        void capture(area)
          .then((png) => (png === undefined ? undefined : onSpotPicture(number, png)))
          .catch(() => showToast("The spot's picture could not be taken."));
      }),
    );
  };

  return (
    <div className={styles.stageWrap}>
      {site && origin !== undefined ? (
        <form
          className={styles.addressBar}
          onSubmit={(event) => {
            event.preventDefault();
            const next = path.startsWith("/") ? path : `/${path}`;
            setAddress(`${origin}${next}`);
            setReloads(reloads + 1);
          }}
        >
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Reload"
            title="Reload"
            onClick={() => setReloads(reloads + 1)}
          >
            <RotateCw size={15} aria-hidden />
          </button>
          <label className={styles.address}>
            <span>{new URL(origin).host}</span>
            <input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              aria-label="Path on the site"
              spellCheck={false}
            />
          </label>
        </form>
      ) : null}
      <div className={styles.stage}>
        <div
          ref={stage}
          className={styles.device}
          style={width === undefined ? undefined : { maxWidth: width }}
        >
          {shown === undefined ? null : (
            <iframe
              key={frameKey}
              ref={frame}
              src={shown}
              title={title}
              sandbox={FRAME_SANDBOX}
              className={styles.frame}
              onLoad={() => {
                setLoadedKey(frameKey);
                takePicture();
              }}
            />
          )}
          {loadedKey === frameKey ? null : (
            <p className={styles.frameLoading}>
              {site ? "Opening the site…" : "Loading the page…"}
            </p>
          )}
          {spots.map((spot) => (
            <span
              key={spot.number}
              className={styles.spot}
              style={{ left: spot.x, top: spot.y }}
              aria-hidden
            >
              {spot.number}
            </span>
          ))}
          {marking ? (
            <button
              type="button"
              className={styles.markLayer}
              aria-label="Click the spot you mean"
              onClick={mark}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StoppedSite({
  output,
  agentName,
  tokens,
  freshOnly,
  onRestarted,
}: {
  output: OutputRecord | undefined;
  agentName: string;
  tokens: number | undefined;
  // Its folder was removed once its work was merged.
  freshOnly: boolean;
  onRestarted: () => void;
}) {
  const [asked, setAsked] = useState(false);
  const long = !freshOnly && tokens !== undefined && tokens >= FRESH_FROM_TOKENS;
  const restart = (fresh: boolean) => {
    if (output === undefined) return;
    api
      .restartSite(output.id, fresh)
      .then(() => {
        setAsked(true);
        onRestarted();
      })
      .catch((error: unknown) =>
        showToast(error instanceof Error ? error.message : "The agent could not be asked."),
      );
  };
  if (asked) {
    return (
      <Note
        title={`${agentName} is starting it`}
        text="It opens here once it answers. You can keep working in the meantime."
      />
    );
  }
  return (
    <Note
      title="This site is not running"
      text={
        freshOnly
          ? `${agentName}'s work was merged into the lead's folder, so ${agentName} starts it from there in a fresh conversation, told how it was started. It opens here once it answers.`
          : long
            ? `${agentName}'s conversation is ${compactCount(tokens ?? 0)} tokens long, and continuing it reads all of it again at every step. A fresh conversation starts small and is told how the site was started.`
            : `Ask ${agentName} to start it again. It opens here once it answers.`
      }
    >
      {output === undefined ? null : (
        <div className={styles.noteActions}>
          {long ? (
            <>
              <Button onClick={() => restart(false)}>Continue the conversation</Button>
              <Button variant="primary" onClick={() => restart(true)}>
                Start in a fresh conversation
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => restart(freshOnly)}>
              Ask {agentName} to start it
            </Button>
          )}
        </div>
      )}
    </Note>
  );
}

function ImageBody({ src, title }: { src: string; title: string }) {
  const [actual, setActual] = useState(false);
  const [broken, setBroken] = useState(false);
  if (broken) return <NoPreview path={undefined} failed />;
  return (
    <div className={styles.imageStage}>
      <div className={styles.imageTools}>
        <fieldset className={styles.segment}>
          <legend className="visually-hidden">Zoom</legend>
          <button type="button" aria-pressed={!actual} onClick={() => setActual(false)}>
            Fit
          </button>
          <button type="button" aria-pressed={actual} onClick={() => setActual(true)}>
            Actual size
          </button>
        </fieldset>
      </div>
      <div className={`${styles.imageScroll} ${actual ? styles.actual : ""}`}>
        <img src={src} alt={title} onError={() => setBroken(true)} />
      </div>
    </div>
  );
}

// A kind the viewer does not show, or a file it could not read.
function NoPreview({ path, failed = false }: { path: string | undefined; failed?: boolean }) {
  const extension = path === undefined ? "" : extensionOf(path);
  const opens = shell !== undefined && path !== undefined && OPENS_SAFELY.has(extension);
  const title = failed
    ? "The file could not be read"
    : extension === ""
      ? "No preview for this file"
      : `No preview for .${extension} files`;
  const text = failed
    ? "It may have been moved or removed since."
    : opens
      ? "Open it in the app your computer uses for this kind of file."
      : "Open it from its folder if you trust it: files like this can run when opened.";
  return (
    <Note
      title={title}
      text={shell === undefined ? "Open it from its folder on your computer." : text}
    >
      {shell === undefined || path === undefined || failed ? null : (
        <div className={styles.noteActions}>
          <Button
            variant="primary"
            onClick={() =>
              void (opens ? shell?.openFile(path) : shell?.showFile(path))?.catch(
                (error: unknown) =>
                  showToast(error instanceof Error ? error.message : "It could not be opened."),
              )
            }
          >
            {opens ? (
              <SquareArrowOutUpRight size={14} aria-hidden />
            ) : (
              <FolderOpen size={14} aria-hidden />
            )}
            {opens ? "Open with default app" : "Show in folder"}
          </Button>
        </div>
      )}
    </Note>
  );
}

function TextBody({
  taskId,
  query,
  kind,
  path,
}: {
  taskId: string;
  query: OutputFileQuery;
  kind: ViewKind;
  path: string;
}) {
  const [text, setText] = useState<{ body: string; size: number }>();
  const [failed, setFailed] = useState(false);
  const [formatted, setFormatted] = useState(true);
  const [changes, setChanges] = useState<string>();
  const [showChanges, setShowChanges] = useState(true);
  const queryKey = JSON.stringify(query);
  // An older version has no changes of its own to show.
  const older = "outputId" in query;

  useEffect(() => {
    let current = true;
    setText(undefined);
    fetch(fileAddress(taskId, JSON.parse(queryKey) as OutputFileQuery, MAX_PREVIEW_TEXT_BYTES))
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const size = Number(response.headers.get("x-file-size") ?? 0);
        const body = await response.text();
        if (current) setText({ body, size });
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [taskId, queryKey]);

  useEffect(() => {
    if (kind !== "code" || older) return;
    let current = true;
    api
      .changes(taskId, path)
      .then((diff) => {
        if (current) setChanges(diff);
      })
      .catch(() => {
        // Only the whole file shows.
      });
    return () => {
      current = false;
    };
  }, [kind, older, taskId, path]);

  if (failed) return <NoPreview path={path || undefined} failed />;
  if (text === undefined) return <p className={styles.loading}>Reading the file…</p>;
  const cut =
    text.size > MAX_PREVIEW_TEXT_BYTES
      ? `Showing the first ${byteSize(MAX_PREVIEW_TEXT_BYTES)} of ${byteSize(text.size)}.`
      : undefined;
  const diffShown = kind === "code" && changes !== undefined && changes !== "" && showChanges;

  return (
    <div className={styles.textStage}>
      {kind === "markdown" || (kind === "code" && changes !== undefined && changes !== "") ? (
        <div className={styles.imageTools}>
          <fieldset className={styles.segment}>
            <legend className="visually-hidden">Show</legend>
            {kind === "markdown" ? (
              <>
                <button type="button" aria-pressed={formatted} onClick={() => setFormatted(true)}>
                  Formatted
                </button>
                <button type="button" aria-pressed={!formatted} onClick={() => setFormatted(false)}>
                  Text
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-pressed={showChanges}
                  onClick={() => setShowChanges(true)}
                >
                  Changes
                </button>
                <button
                  type="button"
                  aria-pressed={!showChanges}
                  onClick={() => setShowChanges(false)}
                >
                  Whole file
                </button>
              </>
            )}
          </fieldset>
        </div>
      ) : null}
      <div className={styles.textScroll}>
        {kind === "markdown" && formatted ? (
          <div className={styles.document}>
            <Markdown text={text.body} />
          </div>
        ) : kind === "table" ? (
          <TableBody text={text.body} tabs={extensionOf(path) === "tsv"} />
        ) : diffShown ? (
          <Diff text={changes ?? ""} />
        ) : (
          <pre className={styles.code}>{text.body}</pre>
        )}
      </div>
      {cut === undefined ? null : <p className={styles.cut}>{cut}</p>}
    </div>
  );
}

function TableBody({ text, tabs }: { text: string; tabs: boolean }) {
  const rows = parseTable(text, tabs ? "\t" : ",", MAX_TABLE_ROWS + 2);
  const [head = [], ...body] = rows;
  const shown = body.slice(0, MAX_TABLE_ROWS);
  return (
    <>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((cell, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns have no other identity
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no other identity
            <tr key={at}>
              {row.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns have no other identity
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > MAX_TABLE_ROWS ? (
        <p className={styles.cut}>Showing the first {MAX_TABLE_ROWS.toLocaleString()} rows.</p>
      ) : null}
    </>
  );
}

function Diff({ text }: { text: string }) {
  return (
    <pre className={styles.diff}>
      {text.split("\n").map((line, index) => {
        const tone =
          line.startsWith("+++") || line.startsWith("---")
            ? styles.diffMeta
            : line.startsWith("+")
              ? styles.diffAdd
              : line.startsWith("-")
                ? styles.diffDel
                : line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")
                  ? styles.diffMeta
                  : undefined;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no other identity
          <span key={index} className={tone}>
            {line}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

// Feedback goes to the agent who made it as a chat message, pictures of marked spots attached.
function AskBox({
  taskId,
  agentId,
  agentName,
  about,
  spots,
  markable,
  marking,
  onMark,
  onRemoveSpot,
  onSent,
}: {
  taskId: string;
  agentId: string;
  agentName: string;
  about: string;
  spots: Spot[];
  markable: boolean;
  marking: boolean;
  onMark: () => void;
  onRemoveSpot: (number: number) => void;
  onSent: () => void;
}) {
  const [text, setText] = useDraft(`ask.${taskId}`, "");
  const [sending, setSending] = useState(false);
  const ready = text.trim() !== "" && spots.every((spot) => spot.png !== undefined);
  const send = async () => {
    setSending(true);
    try {
      const pictures = await Promise.all(
        spots.flatMap((spot) =>
          spot.png === undefined ? [] : [api.uploadFile(spot.png, `spot-${spot.number}.png`)],
        ),
      );
      const marked =
        pictures.length === 0
          ? ""
          : `\n\nThe attached pictures show the spots I marked, numbered ${spots.map((spot) => spot.number).join(", ")}.`;
      await api.messageAgent(
        agentId,
        `About ${about}:\n\n${text.trim()}${marked}`,
        taskId,
        pictures.map((picture) => picture.id),
      );
      setText("");
      onSent();
      showToast(`Sent to ${agentName}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The message could not be sent.");
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className={styles.ask}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !sending) void send();
      }}
    >
      <label className="visually-hidden" htmlFor="output-ask">
        Ask {agentName} for changes
      </label>
      <textarea
        id="output-ask"
        rows={1}
        value={text}
        placeholder={`Ask ${agentName} for changes${markable ? ". Mark a spot to point at it." : ""}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (ready && !sending) void send();
          }
        }}
      />
      <div className={styles.askActions}>
        {markable ? (
          <Button variant="ghost" aria-pressed={marking} onClick={onMark}>
            <Crosshair size={14} aria-hidden />
            {marking ? "Click the spot" : "Mark a spot"}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={!ready || sending}>
          <Send size={14} aria-hidden />
          Send to {agentName}
        </Button>
      </div>
      {spots.length === 0 ? null : (
        <div className={styles.askSpots}>
          {spots.map((spot) => (
            <span key={spot.number} className={styles.spotChip}>
              <span className={styles.spotNumber}>{spot.number}</span>
              {spot.png === undefined ? "Taking a picture" : "Spot"}
              <button
                type="button"
                aria-label={`Remove spot ${spot.number}`}
                onClick={() => onRemoveSpot(spot.number)}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </form>
  );
}
