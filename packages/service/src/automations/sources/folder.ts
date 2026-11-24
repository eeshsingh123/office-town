import { type Dirent, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { SeenEvent } from "../../store/automation-events-store.ts";
import { type EventSource, MINUTE_MS } from "./source.ts";

// A copy in progress settles before its files count; a steady stream still runs every 10 minutes.
const QUIET_MS = MINUTE_MS;
const MOST_WAIT_MS = 10 * MINUTE_MS;
const ALIVE_EVERY_MS = 5 * MINUTE_MS;
// What a look for files that came while Office Town was closed reads at most: never the whole tree.
const SCAN_MOST = 5_000;

const SKIPPED_FOLDERS = new Set([".git", "node_modules", "__pycache__", ".venv"]);
const SKIPPED_FILES = new Set(["thumbs.db", "desktop.ini"]);
const PARTIAL = /\.(tmp|temp|part|partial|crdownload|download|swp|lock)$/i;

interface FolderState {
  // When this source last knew the folder: files changed after it came while it was closed.
  aliveAt: number;
}

function skipped(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep);
  const name = basename(path).toLowerCase();
  return (
    parts.some((part) => part.startsWith(".") || SKIPPED_FOLDERS.has(part)) ||
    name.startsWith("~$") ||
    SKIPPED_FILES.has(name) ||
    PARTIAL.test(name)
  );
}

// A file is its path and when it was made, so an edit keeps its key and only new files count.
const keyOf = (name: string, bornAt: number) => `${name}|${Math.round(bornAt)}`;

const sizeText = (bytes: number) =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// A copy keeps its file's modified time on Windows and macOS; its creation or change time is when it
// arrived.
function arrivedAt(path: string): number {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats === undefined ? 0 : Math.max(stats.mtimeMs, stats.ctimeMs, stats.birthtimeMs);
}

// Files that arrived or changed since `since`, with when, breadth first, reading at most
// SCAN_MOST entries.
function changedSince(root: string, subfolders: boolean, since: number): [string, number][] {
  const found: [string, number][] = [];
  const folders = [root];
  let read = 0;
  while (folders.length > 0 && read < SCAN_MOST) {
    const folder = folders.shift() ?? root;
    let entries: Dirent[];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      // A folder removed or closed to us mid-look has nothing to add.
      continue;
    }
    for (const entry of entries) {
      read += 1;
      const path = join(folder, entry.name);
      if (skipped(root, path)) continue;
      if (entry.isDirectory()) {
        if (subfolders) folders.push(path);
      } else if (entry.isFile()) {
        const at = arrivedAt(path);
        if (at > since) found.push([path, at]);
      }
    }
  }
  return found;
}

function failureOf(error: NodeJS.ErrnoException, root: string): string {
  if (error.code === "ENOSPC") {
    return `There are too many folders inside ${root} to watch. Pick a smaller folder.`;
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return `Office Town can't open ${root} any more.`;
  }
  return `The folder ${root} is gone.`;
}

// A new file lands in a folder (D-128); edits to files already there don't count. Agents' own
// changes are known to the core: a file the automation's own runs made never starts it, and one
// another automation made counts as a step of a chain, so folders cannot loop.
export const folderSource: EventSource<"folder"> = {
  kind: "folder",
  start(config, context) {
    const root = resolve(config.path);
    if (statSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) {
      context.fail(`The folder ${root} is gone.`);
      return () => undefined;
    }
    const noted = new Map<string, number>();
    let firstAt: number | undefined;
    let timer: NodeJS.Timeout | undefined;

    const settle = () => {
      timer = undefined;
      firstAt = undefined;
      const events: SeenEvent[] = [];
      for (const path of noted.keys()) {
        const stats = statSync(path, { throwIfNoEntry: false });
        if (stats?.isFile() !== true) continue;
        const writer = context.writerOf(path);
        if (writer?.automationId === context.automation.id) continue;
        const name = relative(root, path);
        events.push({
          key: keyOf(name, stats.birthtimeMs),
          at: noted.get(path) ?? Date.now(),
          text: `A file in ${root}: ${name} (${sizeText(stats.size)}). Full path: ${path}`,
          ...(writer === undefined ? {} : { depth: writer.depth + 1 }),
        });
      }
      noted.clear();
      if (events.length > 0) context.seen(events);
      context.setState({ aliveAt: Date.now() } satisfies FolderState);
    };

    const note = (path: string, at = Date.now()) => {
      if (skipped(root, path)) return;
      const now = Date.now();
      noted.set(path, Math.round(at));
      firstAt ??= now;
      clearTimeout(timer);
      timer = setTimeout(settle, Math.min(QUIET_MS, firstAt + MOST_WAIT_MS - now));
      timer.unref();
    };

    const state = context.state<FolderState>();
    // The first watch notes the files already there, so changing one later never starts a run;
    // later watches pick up what came meanwhile.
    if (state === undefined) {
      const there = changedSince(root, config.subfolders, 0).flatMap(([path, at]) => {
        const stats = statSync(path, { throwIfNoEntry: false });
        return stats === undefined
          ? []
          : [{ key: keyOf(relative(root, path), stats.birthtimeMs), at, text: "" }];
      });
      context.seen(there, { startPoint: true });
      context.setState({ aliveAt: Date.now() } satisfies FolderState);
    } else {
      for (const [path, at] of changedSince(root, config.subfolders, state.aliveAt)) note(path, at);
    }

    let watcher: FSWatcher;
    try {
      // A file that lands is a "rename"; a "change" is an edit to one already there.
      watcher = watch(root, { recursive: config.subfolders, persistent: false }, (type, name) => {
        if (type === "rename" && name !== null) note(join(root, name));
      });
    } catch (error) {
      context.fail(failureOf(error as NodeJS.ErrnoException, root));
      return () => undefined;
    }
    watcher.on("error", (error: NodeJS.ErrnoException) => {
      context.fail(failureOf(error, root));
    });
    // Nothing noted and not yet settled is older than this, so a crash loses nothing.
    const alive = setInterval(() => {
      if (noted.size === 0) context.setState({ aliveAt: Date.now() } satisfies FolderState);
    }, ALIVE_EVERY_MS);
    alive.unref();
    return () => {
      clearInterval(alive);
      clearTimeout(timer);
      watcher.close();
    };
  },
};
