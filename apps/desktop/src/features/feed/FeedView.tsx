import type { FeedPost, FeedShow } from "@office-town/contract";
import {
  ArrowUp,
  CheckCheck,
  Clock,
  CloudOff,
  Lightbulb,
  LoaderCircle,
  type LucideIcon,
  Newspaper,
  PackageCheck,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client.ts";
import { useApp } from "../../store/app-store.ts";
import { forSession, readKept, useKept, writeKept } from "../../store/kept.ts";
import { Button } from "../../ui/Button.tsx";
import { ChoiceMenu } from "../../ui/ChoiceMenu.tsx";
import { ClearFilters } from "../../ui/ClearFilters.tsx";
import { EmptyState, NoMatch } from "../../ui/EmptyState.tsx";
import { Fact, Facts } from "../../ui/Facts.tsx";
import { sinceTime } from "../../ui/format.ts";
import page from "../../ui/Page.module.css";
import { PageHeader } from "../../ui/PageHeader.tsx";
import { SearchBox } from "../../ui/SearchBox.tsx";
import { TabRow } from "../../ui/TabRow.tsx";
import styles from "./Feed.module.css";
import { FeedItem, useAuthor } from "./FeedItem.tsx";
import {
  type FeedFilter,
  markSeen,
  NO_FILTER,
  newestFirst,
  newestShown,
  postsInView,
} from "./feed.ts";

const SHOW: { value: FeedShow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs-you", label: "Needs you" },
  { value: "results", label: "Results" },
  { value: "automations", label: "Automations" },
  { value: "suggested", label: "Suggested" },
];

// An empty tab with no search or department is not a failed search: say what lands there.
const EMPTY_TAB: Record<
  FeedShow,
  { icon: LucideIcon; title: string; hint: string; tone?: "good" }
> = {
  all: { icon: Newspaper, title: "No posts yet", hint: "Posts appear here as your agents work." },
  "needs-you": {
    icon: CheckCheck,
    title: "You're caught up",
    hint: "Questions and approvals from your agents show up here.",
    tone: "good",
  },
  results: { icon: PackageCheck, title: "No results yet", hint: "Finished work shows up here." },
  automations: {
    icon: Clock,
    title: "No automation posts yet",
    hint: "Posts from automation runs show up here.",
  },
  suggested: {
    icon: Lightbulb,
    title: "No suggestions yet",
    hint: "Ideas your agents spot while they work show up here.",
  },
};

const FILTER = forSession<FeedFilter>("feed.filter", NO_FILTER);
const HOLD_AFTER = forSession<string | undefined>("feed.hold-after", undefined);
// Scrolled further than this, new posts wait behind the pill instead of moving the list.
const AT_TOP = 120;
const SEARCH_WAIT_MS = 250;
const PILL_FACES = 3;

interface Cursor {
  // The oldest post read for this filter; the list shows nothing older, so no gap shows.
  oldest: FeedPost | undefined;
  more: boolean;
  loading: boolean;
  error: string | undefined;
}

const START: Cursor = { oldest: undefined, more: false, loading: true, error: undefined };

// How far down a filter was read, so coming back keeps the list as deep as the user left it.
interface Depth {
  query: string;
  oldest: FeedPost;
  more: boolean;
}
const DEPTH = forSession<Depth | undefined>("feed.depth", undefined);

// The post at the top of the view and how far into it, as pixels alone would land on another
// post while posts above are still at their stand-in height (`content-visibility`).
interface Place {
  postId: string;
  offset: number;
}
const PLACE = forSession<Place | undefined>("feed.place", undefined);

// Near the top it starts from the top, where new posts show.
function placeIn(scroller: HTMLElement): Place | undefined {
  if (scroller.scrollTop <= AT_TOP) return undefined;
  const top = scroller.getBoundingClientRect().top;
  for (const slot of scroller.querySelectorAll<HTMLElement>("[data-post]")) {
    const box = slot.firstElementChild?.getBoundingClientRect();
    if (box !== undefined && box.bottom > top && slot.dataset.post !== undefined) {
      return { postId: slot.dataset.post, offset: box.top - top };
    }
  }
  return undefined;
}

function scrollToPlace(scroller: HTMLElement, place: Place): void {
  const slot = scroller.querySelector(`[data-post="${CSS.escape(place.postId)}"]`);
  const box = slot?.firstElementChild?.getBoundingClientRect();
  if (box === undefined) return;
  scroller.scrollTop += box.top - scroller.getBoundingClientRect().top - place.offset;
}

function startFor(query: string): Cursor {
  const depth = readKept(DEPTH);
  return depth?.query === query ? { ...START, oldest: depth.oldest, more: depth.more } : START;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Reads pages of the core's feed for one filter, newest first, into the app's posts.
function usePages(filter: FeedFilter) {
  const [search, setSearch] = useState(filter.search);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filter.search), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [filter.search]);
  const query = useMemo(
    () => ({
      show: filter.show,
      ...(filter.departmentId === undefined ? {} : { departmentId: filter.departmentId }),
      ...(search.trim() === "" ? {} : { search: search.trim() }),
    }),
    [filter.show, filter.departmentId, search],
  );
  const key = JSON.stringify(query);
  const [cursor, setCursor] = useState(() => startFor(key));
  const read = async (before: FeedPost | undefined) => {
    setCursor((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const { posts, more } = await api.feed({
        ...query,
        ...(before === undefined ? {} : { before: before.id }),
      });
      useApp.setState((state) => ({
        feed: { ...state.feed, ...Object.fromEntries(posts.map((post) => [post.id, post])) },
      }));
      let next = { oldest: posts.at(-1) ?? before, more };
      // Reading the newest page again keeps what was read below it.
      const depth = readKept(DEPTH);
      const deeper =
        before === undefined &&
        depth?.query === key &&
        next.oldest !== undefined &&
        newestFirst(depth.oldest, next.oldest) > 0;
      if (deeper) next = { oldest: depth.oldest, more: depth.more };
      if (next.oldest !== undefined)
        writeKept(DEPTH, { query: key, oldest: next.oldest, more: next.more });
      setCursor({ ...next, loading: false, error: undefined });
    } catch {
      setCursor((current) => ({ ...current, loading: false, error: "Posts could not be read." }));
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts from the top.
  useEffect(() => {
    setCursor(startFor(key));
    void read(undefined);
  }, [query]);
  return {
    cursor,
    more: () => {
      if (!cursor.loading && cursor.more) void read(cursor.oldest);
    },
    again: () => void read(cursor.oldest),
  };
}

function Face({ post }: { post: FeedPost }) {
  return <>{useAuthor(post).face(26)}</>;
}

// Who posted, then how many wait above.
function NewPostsPill({ posts, onShow }: { posts: FeedPost[]; onShow: () => void }) {
  if (posts.length === 0) return null;
  const faces: FeedPost[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const who = post.by.kind === "agent" ? post.by.agentId : JSON.stringify(post.by);
    if (seen.has(who)) continue;
    seen.add(who);
    faces.push(post);
    if (faces.length === PILL_FACES) break;
  }
  return (
    <div className={styles.pillRow}>
      <button type="button" className={styles.pill} onClick={onShow}>
        <span className={styles.faces} aria-hidden>
          {faces.map((post) => (
            <Face key={post.id} post={post} />
          ))}
        </span>
        <ArrowUp size={14} aria-hidden />
        {plural(posts.length, "new post", "new posts")}
      </button>
    </div>
  );
}

function Lead({ since, posts }: { since: string | undefined; posts: FeedPost[] }) {
  const asks = useApp((state) => Object.keys(state.waiting).length);
  const working = posts.filter((post) => post.kind === "living" && post.state === "open").length;
  const fresh = since === undefined ? 0 : posts.filter((post) => post.createdAt > since).length;
  if (asks === 0 && working === 0 && since === undefined) return null;
  return (
    <Facts>
      {asks === 0 ? null : (
        <Fact count={asks} urgent>
          {asks === 1 ? "needs you" : "need you"}
        </Fact>
      )}
      {working === 0 ? null : <Fact count={working}>at work</Fact>}
      {since === undefined ? null : fresh === 0 ? (
        <Fact>Nothing new since {sinceTime(since)}</Fact>
      ) : (
        <Fact count={fresh}>new since {sinceTime(since)}</Fact>
      )}
    </Facts>
  );
}

export function FeedView() {
  const [filter, setFilter] = useKept(FILTER);
  const update = (change: Partial<FeedFilter>) => setFilter({ ...filter, ...change });
  const { cursor, more, again } = usePages(filter);
  const feed = useApp((state) => state.feed);
  const departments = useApp((state) => state.departments);
  const now = useNow();
  // When the user last looked, as it was on opening: posts from before it are dimmed.
  const [since] = useState(() => useApp.getState().feedSeenAt);
  const [openedAt] = useState(() => new Date().toISOString());
  const scroller = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const readMore = useRef(more);
  readMore.current = more;
  // Set while scrolled down: posts newer than this wait behind the pill. Kept with the scroll
  // place, so posts that came while the user was away do not push the list down.
  const [holdAfter, setHoldAfter] = useKept(HOLD_AFTER);

  const all = useMemo(() => postsInView(feed, filter, cursor.oldest), [feed, filter, cursor]);
  const held = holdAfter === undefined ? [] : all.filter((post) => post.createdAt > holdAfter);
  const shown = holdAfter === undefined ? all : all.filter((post) => post.createdAt <= holdAfter);
  const listed = all.length > 0;

  // Back where the user left: on that post, however far the posts above it have been laid out.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (restored.current || element === null || !listed) return;
    restored.current = true;
    const place = readKept(PLACE);
    if (place !== undefined) scrollToPlace(element, place);
  }, [listed]);
  useLayoutEffect(
    () => () => {
      const element = scroller.current;
      if (element !== null) writeKept(PLACE, placeIn(element));
    },
    [],
  );

  // Watched while the list is on the page; near its bottom, the next page is read.
  useEffect(() => {
    const target = sentinel.current;
    if (!listed || target === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) readMore.current();
      },
      { root: scroller.current, rootMargin: "600px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [listed]);
  const newest = all[0];
  // Any filter: opening Feed is a look at it, as the sidebar dot counts every new post.
  const newestAt = useMemo(() => newestShown(feed), [feed]);

  // At the top with the window in front, everything counts as seen.
  useEffect(() => {
    if (holdAfter !== undefined || newestAt === undefined || !document.hasFocus()) return;
    const timer = setTimeout(() => markSeen(newestAt), 1000);
    return () => clearTimeout(timer);
  }, [holdAfter, newestAt]);

  const onScroll = () => {
    const top = scroller.current?.scrollTop ?? 0;
    if (top <= AT_TOP && holdAfter !== undefined) setHoldAfter(undefined);
    if (top > AT_TOP && holdAfter === undefined) setHoldAfter(newest?.createdAt ?? openedAt);
  };
  const showHeld = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
    setHoldAfter(undefined);
  };

  // As on the other lists, the tab is not a filter and stays as it is.
  const filtering = filter.departmentId !== undefined || filter.search !== "";
  const departmentChoices = [
    { value: "", label: "All" },
    ...Object.values(departments)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((department) => ({ value: department.id, label: department.name })),
  ];

  let body: ReactNode;
  if (cursor.error !== undefined && all.length === 0) {
    body = (
      <EmptyState icon={CloudOff} title="Posts could not load" tone="bad">
        <Button onClick={again}>
          <RotateCcw size={14} aria-hidden />
          Try again
        </Button>
      </EmptyState>
    );
  } else if (all.length === 0 && cursor.loading) {
    body = (
      <p className={styles.loading}>
        <LoaderCircle size={14} className="spin" aria-hidden />
        Reading posts
      </p>
    );
  } else if (all.length === 0 && filtering) {
    body = <NoMatch />;
  } else if (all.length === 0) {
    body = <EmptyState {...EMPTY_TAB[filter.show]} />;
  } else {
    body = (
      <div className={styles.list}>
        <NewPostsPill posts={held} onShow={showHeld} />
        <p className={styles.latest}>Latest</p>
        {shown.map((post) => (
          <div key={post.id} className={styles.slot} data-post={post.id}>
            <FeedItem
              post={post}
              now={now}
              older={since !== undefined && post.createdAt <= since}
              arrived={post.createdAt > openedAt}
            />
          </div>
        ))}
        <div ref={sentinel} className={styles.sentinel} aria-hidden />
        {cursor.loading ? (
          <p className={styles.loading}>
            <LoaderCircle size={14} className="spin" aria-hidden />
            Reading older posts
          </p>
        ) : null}
        {cursor.error === undefined ? null : (
          <div className={styles.state}>
            <p>{cursor.error}</p>
            <Button onClick={again}>Try again</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      ref={scroller}
      onScroll={onScroll}
      className={`${page.page} ${styles.page}`}
      aria-labelledby="feed-title"
    >
      <div className={styles.column}>
        <PageHeader
          id="feed-title"
          title="Feed"
          lead={<Lead since={since} posts={Object.values(feed).sort(newestFirst)} />}
        />
        <div className={styles.tools}>
          <div className={styles.tabsRow}>
            <TabRow
              label="Show"
              tabs={SHOW}
              value={filter.show}
              onChange={(show) => update({ show })}
            />
          </div>
          <div className={styles.filters}>
            <SearchBox
              value={filter.search}
              onChange={(search) => update({ search })}
              label="Search posts"
            />
            {Object.keys(departments).length === 0 ? null : (
              <ChoiceMenu
                label="Department"
                value={filter.departmentId ?? ""}
                choices={departmentChoices}
                onChange={(chosen) => update({ departmentId: chosen === "" ? undefined : chosen })}
              />
            )}
            <ClearFilters
              shown={filtering}
              onClear={() => setFilter({ ...NO_FILTER, show: filter.show })}
            />
          </div>
        </div>
        {body}
      </div>
    </section>
  );
}
