import type { FeedPost, ProgressChart, ProgressUpdate } from "@office-town/contract";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, updateImageAddress } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { ago } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import styles from "./ProgressUpdate.module.css";

// The width an element is drawn at, followed as the window changes.
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function Numbers({ chart }: { chart: Extract<ProgressChart, { kind: "numbers" }> }) {
  return (
    <div className={styles.stats}>
      {chart.items.map((item) => (
        <div key={item.label} className={styles.stat}>
          <small className={styles.statLabel}>{item.label}</small>
          <b className={styles.statValue}>{item.value}</b>
          {item.from === undefined ? null : (
            <span className={styles.statFrom}>from {item.from}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// Past this share of the track, a value sits inside its bar's end, so it never leaves the track.
const INSIDE_PAST = 70;

function Bars({ chart }: { chart: Extract<ProgressChart, { kind: "bars" }> }) {
  const most = Math.max(...chart.items.map((item) => item.value));
  const words = chart.items
    .map((item) => `${item.label} ${item.shown ?? compact.format(item.value)}`)
    .join(", ");
  return (
    <div
      className={styles.bars}
      role="img"
      aria-label={`${chart.caption === undefined ? "" : `${chart.caption}: `}${words}`}
    >
      {chart.caption === undefined ? null : <span className={styles.caption}>{chart.caption}</span>}
      {chart.items.map((item, index) => {
        const share = most <= 0 ? 0 : (item.value / most) * 100;
        const inside = share > INSIDE_PAST;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: two bars may share a label.
            key={index}
            className={`${styles.barRow} ${item.highlight === true ? styles.barPicked : ""}`}
          >
            <span className={styles.barName} title={item.label}>
              {item.label}
            </span>
            <div className={styles.barTrack}>
              <i className={styles.barFill} style={{ width: `${share}%` }} />
              <em
                className={`${styles.barValue} ${inside ? styles.barValueIn : ""}`}
                style={inside ? { right: `${100 - share}%` } : { left: `${share}%` }}
              >
                {item.shown ?? compact.format(item.value)}
              </em>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const LINE_HEIGHT = 150;
const LEFT = 44;
const RIGHT = 16;
const TOP = 22;
const BOTTOM = 26;
// Room an x label needs, so labels are thinned rather than run together.
const LABEL_ROOM = 64;

function Line({ chart }: { chart: Extract<ProgressChart, { kind: "line" }> }) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(useWidth(box), 200);
  const values = chart.points.map((point) => point.value);
  const low = Math.min(0, ...values);
  let high = Math.max(...values);
  if (high === low) high = low + 1;
  const plotWidth = width - LEFT - RIGHT;
  const plotHeight = LINE_HEIGHT - TOP - BOTTOM;
  const last = chart.points.length - 1;
  const x = (index: number) => LEFT + (last === 0 ? 0 : (index / last) * plotWidth);
  const y = (value: number) => TOP + (1 - (value - low) / (high - low)) * plotHeight;
  const fit = Math.max(2, Math.floor(plotWidth / LABEL_ROOM));
  const every = Math.ceil(chart.points.length / fit);
  // The last label is always shown; one too close before it gives way.
  const labelled = (index: number) =>
    index === last || (index % every === 0 && last - index >= every);
  const path = chart.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(point.value)}`)
    .join(" ");
  const grid = [low, (low + high) / 2, high];
  const end = chart.points[last];
  const words = chart.points
    .map((point) => `${point.label} ${point.shown ?? compact.format(point.value)}`)
    .join(", ");
  return (
    <div className={styles.line} ref={box}>
      {chart.caption === undefined ? null : <span className={styles.caption}>{chart.caption}</span>}
      <svg
        width={width}
        height={LINE_HEIGHT}
        viewBox={`0 0 ${width} ${LINE_HEIGHT}`}
        role="img"
        aria-label={`${chart.caption === undefined ? "" : `${chart.caption}: `}${words}`}
      >
        {grid.map((value) => (
          <g key={value}>
            <line
              className={styles.grid}
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(value)}
              y2={y(value)}
            />
            <text className={styles.axis} x={LEFT - 8} y={y(value) + 4} textAnchor="end">
              {compact.format(value)}
            </text>
          </g>
        ))}
        <path className={styles.area} d={`${path} L${x(last)} ${y(low)} L${x(0)} ${y(low)} Z`} />
        <path className={styles.path} d={path} />
        {chart.points.map((point, index) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: points are in order and have no ids.
            key={index}
            className={`${styles.dot} ${index === last ? styles.dotEnd : ""}`}
            cx={x(index)}
            cy={y(point.value)}
            r={index === last ? 4.5 : 3.5}
          />
        ))}
        {end === undefined ? null : (
          <text className={styles.value} x={x(last)} y={y(end.value) - 10} textAnchor="end">
            {end.shown ?? compact.format(end.value)}
          </text>
        )}
        {chart.points.map((point, index) =>
          labelled(index) ? (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: points are in order and have no ids.
              key={index}
              className={styles.axis}
              x={x(index)}
              y={LINE_HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === last ? "end" : "middle"}
            >
              {point.label.length > 10 ? `${point.label.slice(0, 9)}…` : point.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function Chart({ chart }: { chart: ProgressChart }) {
  if (chart.kind === "numbers") return <Numbers chart={chart} />;
  if (chart.kind === "bars") return <Bars chart={chart} />;
  return <Line chart={chart} />;
}

// Never wider than the card; a tall one is cut until opened.
function Picture({ image }: { image: NonNullable<ProgressUpdate["image"]> }) {
  const [whole, setWhole] = useState(false);
  const label = whole ? "Show less of the picture" : "Show the whole picture";
  return (
    <figure className={styles.picture}>
      <button
        type="button"
        className={`${styles.pictureButton} ${whole ? "" : styles.pictureCut}`}
        aria-label={label}
        title={label}
        onClick={() => setWhole(!whole)}
      >
        <img
          className={styles.image}
          src={updateImageAddress(image.id)}
          alt={image.name}
          loading="lazy"
        />
      </button>
      <figcaption className={styles.pictureName} title={image.name}>
        {image.name}
      </figcaption>
    </figure>
  );
}

// In the history every entry is an update, so only the card's own block says so.
function UpdateHead({
  update,
  now,
  inList,
}: {
  update: ProgressUpdate;
  now: number;
  inList: boolean;
}) {
  return (
    <div className={styles.head}>
      {inList ? null : <span className={styles.label}>Update</span>}
      <time dateTime={update.at}>{ago(update.at, now)}</time>
      <span className={styles.after}>
        <Check size={13} aria-hidden className={styles.afterIcon} />
        <span className={styles.afterText} title={update.after}>
          {update.after}
        </span>
      </span>
    </div>
  );
}

function UpdateBody({
  update,
  now,
  inList = false,
}: {
  update: ProgressUpdate;
  now: number;
  inList?: boolean;
}) {
  return (
    <>
      <UpdateHead update={update} now={now} inList={inList} />
      <h4 className={styles.title}>{update.title}</h4>
      {update.chart === undefined ? null : <Chart chart={update.chart} />}
      {update.image === undefined ? null : <Picture image={update.image} />}
      {update.body === undefined ? null : (
        <div className={styles.body}>
          <Markdown text={update.body} />
        </div>
      )}
    </>
  );
}

// The card's history, newest first, read when opened and again when a new one arrives.
function History({ post, now }: { post: FeedPost; now: number }) {
  const [updates, setUpdates] = useState<ProgressUpdate[]>();
  const [failed, setFailed] = useState(false);
  const newest = post.update?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when a new update arrives
  useEffect(() => {
    let live = true;
    api
      .progressUpdates(post.id)
      .then((read) => {
        if (live) setUpdates(read.updates);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [post.id, newest]);
  if (failed) return <p className={styles.earlier}>The earlier updates could not be read.</p>;
  if (updates === undefined) return <p className={styles.earlier}>Reading the updates…</p>;
  return (
    <ol className={styles.history} aria-label="Progress updates, newest first">
      {updates.map((update, index) => (
        <li key={update.id} className={styles.historyItem}>
          {/* The dot is centred on the update's first line; the stem runs on to the next one. */}
          <span className={styles.rail} aria-hidden>
            <span className={styles.knob}>
              <span className={`${styles.dot} ${index === 0 ? styles.dotNewest : ""}`} />
            </span>
            <span className={styles.stem} />
          </span>
          <div className={styles.historyBody}>
            <UpdateBody update={update} now={now} inList />
          </div>
        </li>
      ))}
    </ol>
  );
}

// The newest progress update on a task's card, and its earlier ones behind Show all (D-141).
export function UpdateBlock({ post, now }: { post: FeedPost; now: number }) {
  const [open, setOpen] = useState(false);
  const update = post.update;
  if (update === undefined) return null;
  const earlier = (post.updates ?? 1) - 1;
  return (
    <section className={styles.update} aria-label="Progress update">
      {open ? <History post={post} now={now} /> : <UpdateBody update={update} now={now} />}
      {earlier <= 0 ? null : (
        <div className={styles.more}>
          {open ? null : (
            <span className={styles.earlier}>
              {earlier === 1 ? "1 earlier update" : `${earlier} earlier updates`}
            </span>
          )}
          <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Show less" : "Show all"}
            {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </Button>
        </div>
      )}
    </section>
  );
}
