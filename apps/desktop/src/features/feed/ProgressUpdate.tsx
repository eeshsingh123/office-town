import type {
  FeedPost,
  ProgressChart,
  ProgressUpdate,
  ProgressUpdates,
} from "@office-town/contract";
import { ChevronDown, ChevronUp, CornerDownRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, updateImageAddress } from "../../api/client.ts";
import { Button } from "../../ui/Button.tsx";
import { ago } from "../../ui/format.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { useWidth } from "../../ui/use-width.ts";
import styles from "./ProgressUpdate.module.css";

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumSignificantDigits: 3,
});

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
            title={`${item.label}: ${item.shown ?? compact.format(item.value)}`}
          >
            <span className={styles.barName}>{item.label}</span>
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

// A round step, 1, 2 or 5 times a power of ten, so the axis reads in plain numbers.
function roundStep(span: number): number {
  const raw = span / 2;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

// A line fills its own range, so a change of a few percent still shows. Bars keep zero, as a bar
// cut short would overstate the change.
function lineScale(values: readonly number[]) {
  const least = Math.min(...values);
  const most = Math.max(...values);
  const flat = least === most;
  const step = roundStep(flat ? Math.abs(most) || 1 : most - least);
  const low = flat ? least - step : Math.floor(least / step) * step;
  const high = flat ? most + step : Math.ceil(most / step) * step;
  const ticks: number[] = [];
  for (let at = low; at <= high + step / 2; at += step) ticks.push(Number(at.toPrecision(12)));
  // Enough digits that no two ticks read the same.
  const digits = Math.ceil(Math.log10(Math.max(Math.abs(low), Math.abs(high)) / step + 1)) + 1;
  const format = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumSignificantDigits: Math.min(Math.max(digits, 1), 21),
  });
  return { low, high, ticks, tick: (value: number) => format.format(value) };
}

function Line({ chart }: { chart: Extract<ProgressChart, { kind: "line" }> }) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(useWidth(box), 200);
  const { low, high, ticks, tick } = lineScale(chart.points.map((point) => point.value));
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
  const end = chart.points[last];
  const shown = (point: (typeof chart.points)[number]) =>
    point.shown ?? compact.format(point.value);
  const words = chart.points.map((point) => `${point.label} ${shown(point)}`).join(", ");
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
        {ticks.map((value) => (
          <g key={value}>
            <line
              className={styles.grid}
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(value)}
              y2={y(value)}
            />
            <text className={styles.axis} x={LEFT - 8} y={y(value) + 4} textAnchor="end">
              {tick(value)}
            </text>
          </g>
        ))}
        <path className={styles.area} d={`${path} L${x(last)} ${y(low)} L${x(0)} ${y(low)} Z`} />
        <path className={styles.path} d={path} />
        {chart.points.map((point, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: points are in order and have no ids.
          <g key={index}>
            <title>{`${point.label}: ${shown(point)}`}</title>
            {/* A wider target than the dot, so its value is easy to hover. */}
            <circle className={styles.pointTarget} cx={x(index)} cy={y(point.value)} r={10} />
            <circle
              className={`${styles.point} ${index === last ? styles.pointEnd : ""}`}
              cx={x(index)}
              cy={y(point.value)}
              r={index === last ? 4.5 : 3.5}
            />
          </g>
        ))}
        {end === undefined ? null : (
          <text className={styles.value} x={x(last)} y={y(end.value) - 10} textAnchor="end">
            {shown(end)}
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
        <CornerDownRight size={13} aria-hidden className={styles.afterIcon} />
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

// Each page after the last one read, so a list that started again never takes an old page twice.
const joined = (shown: ProgressUpdates, page: ProgressUpdates): ProgressUpdates => {
  const have = new Set(shown.updates.map((update) => update.id));
  return {
    updates: [...shown.updates, ...page.updates.filter((update) => !have.has(update.id))],
    more: page.more,
  };
};

// The card's history, newest first: read from the newest when opened and when a new one arrives,
// and a page further each time its end scrolls into view.
function History({ post, now }: { post: FeedPost; now: number }) {
  const [read, setRead] = useState<ProgressUpdates>();
  const [failed, setFailed] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const end = useRef<HTMLLIElement>(null);
  const newest = post.update?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when a new update arrives
  useEffect(() => {
    let live = true;
    setFailed(false);
    api
      .progressUpdates(post.id)
      .then((page) => {
        if (live) setRead(page);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [post.id, newest]);
  const oldest = read?.updates.at(-1)?.id;
  const more = read?.more === true && !failed;
  useEffect(() => {
    const root = list.current;
    const sentinel = end.current;
    if (!more || oldest === undefined || root === null || sentinel === null) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        api
          .progressUpdates(post.id, oldest)
          .then((page) => {
            if (live) setRead((shown) => (shown === undefined ? page : joined(shown, page)));
          })
          .catch(() => {
            if (live) setFailed(true);
          });
      },
      { root },
    );
    observer.observe(sentinel);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [post.id, oldest, more]);
  if (read === undefined) {
    return (
      <p className={styles.earlier}>
        {failed ? "The earlier updates could not be read." : "Reading the updates…"}
      </p>
    );
  }
  return (
    <ol ref={list} className={styles.history} aria-label="Progress updates, newest first">
      {read.updates.map((update, index) => (
        <li key={update.id} className={styles.historyItem}>
          {/* The dot is centred on the update's first line; the stem runs on to the next one. */}
          <span className={styles.rail} aria-hidden>
            <span className={styles.knob}>
              <span className={`${styles.railDot} ${index === 0 ? styles.railDotNewest : ""}`} />
            </span>
            <span className={styles.stem} />
          </span>
          <div className={styles.historyBody}>
            <UpdateBody update={update} now={now} inList />
          </div>
        </li>
      ))}
      {more || failed ? (
        <li ref={end} className={styles.historyEnd}>
          {failed ? "The earlier updates could not be read." : "Reading earlier updates…"}
        </li>
      ) : null}
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
