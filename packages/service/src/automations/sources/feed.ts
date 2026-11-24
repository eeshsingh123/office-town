import type { SeenEvent } from "../../store/automation-events-store.ts";
import { EVENTS_KEPT_MS } from "../../store/automation-events-store.ts";
import { type EventSource, lookEvery, MINUTE_MS, plainText } from "./source.ts";

const EVERY_MS = 15 * MINUTE_MS;
const TIMEOUT_MS = 20_000;
const MOST_BYTES = 2 * 1024 * 1024;
const SUMMARY_CHARS = 2_000;
const GONE = new Set([404, 410]);

interface FeedState {
  lookedAt: number;
  etag?: string;
  modified?: string;
}

export interface FeedItem {
  key: string;
  title: string;
  link: string;
  at: number | undefined;
  summary: string;
}

const unwrap = (value: string) => value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();

function field(block: string, ...names: string[]): string {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (match?.[1] !== undefined) return unwrap(match[1]);
  }
  return "";
}

// Atom gives its link as an attribute: the alternate one, else the first.
function linkOf(block: string): string {
  const text = field(block, "link");
  if (text !== "") return text;
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((match) => match[1] ?? "");
  const chosen = links.find((attrs) => !/rel=["'](?!alternate)/i.test(attrs)) ?? links[0] ?? "";
  return /href=["']([^"']+)["']/i.exec(chosen)?.[1] ?? "";
}

// RSS 2.0 items and Atom entries, enough for what a feed reader needs.
export function feedItems(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (match) => match[2] ?? "",
  );
  return blocks.flatMap((block) => {
    const title = plainText(field(block, "title"), 300);
    const link = linkOf(block);
    const key = field(block, "guid", "id") || link || title;
    if (key === "") return [];
    const when = Date.parse(field(block, "pubDate", "published", "updated", "dc:date"));
    const summary = plainText(
      field(block, "description", "summary", "content:encoded", "content"),
      SUMMARY_CHARS,
    );
    return [{ key, title, link, at: Number.isNaN(when) ? undefined : when, summary }];
  });
}

async function read(url: string, state: FeedState | undefined) {
  const response = await fetch(url, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      ...(state?.etag === undefined ? {} : { "if-none-match": state.etag }),
      ...(state?.modified === undefined ? {} : { "if-modified-since": state.modified }),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 304) return { status: 304 as const };
  if (!response.ok) return { status: response.status };
  if (Number(response.headers.get("content-length") ?? 0) > MOST_BYTES) {
    throw new Error("The feed is larger than 2 MB.");
  }
  const text = await response.text();
  if (text.length > MOST_BYTES) throw new Error("The feed is larger than 2 MB.");
  return {
    status: 200 as const,
    text,
    etag: response.headers.get("etag") ?? undefined,
    modified: response.headers.get("last-modified") ?? undefined,
  };
}

// New posts in an RSS or Atom feed (D-128), read every 15 minutes, asking only for what changed.
export const feedSource: EventSource<"feed"> = {
  kind: "feed",
  start(config, context) {
    let gone = 0;
    const look = async () => {
      const state = context.state<FeedState>();
      const answer = await read(config.url, state);
      if (answer.status === 304) {
        context.setState({ ...state, lookedAt: Date.now() });
        context.looked(0);
        return;
      }
      if (!("text" in answer)) {
        gone = GONE.has(answer.status) ? gone + 1 : 0;
        if (gone >= 3) context.fail(`The feed at ${config.url} is gone.`);
        throw new Error(`The feed answered ${answer.status}.`);
      }
      gone = 0;
      const now = Date.now();
      const events: SeenEvent[] = feedItems(answer.text)
        .filter((item) => item.at === undefined || now - item.at < EVENTS_KEPT_MS)
        .map((item) => ({
          key: item.key,
          at: Math.min(item.at ?? now, now),
          text: [item.title, item.link, item.summary].filter((part) => part !== "").join("\n"),
        }));
      const found = context.seen(events, { startPoint: state === undefined });
      context.looked(found);
      context.setState({
        lookedAt: now,
        ...(answer.etag === undefined ? {} : { etag: answer.etag }),
        ...(answer.modified === undefined ? {} : { modified: answer.modified }),
      } satisfies FeedState);
    };
    return lookEvery(EVERY_MS, context.state<FeedState>()?.lookedAt, look, (error, failures) => {
      if (failures === 1)
        console.error(`Could not read the feed of ${context.automation.name}.`, error);
    });
  },
};
