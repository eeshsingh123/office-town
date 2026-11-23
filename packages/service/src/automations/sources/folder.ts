import { type Dirent, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { SeenEvent } from "../../store/automation-events-store.ts";
import { type EventSource, MINUTES } from "./source.ts";

// A copy in progress settles before its files count; a steady stream still runs every 10 minutes.
const QUIET_MS = MINUTES;
const MOST_WAIT_MS = 10 * MINUTES;
const ALIVE_EVERY_MS = 5 * MINUTES;
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

// Files that arrived since `since`, with when, breadth first, reading at most SCAN_MOST entries.
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

// A file lands in a folder (D-128). Agents' own changes are known to the core; one the
// automation's own runs made never starts it, and one another automation made counts as a step of
// a chain, so folders cannot loop.
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
          key: `${name}|${stats.size}|${Math.round(stats.mtimeMs)}`,
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
    // The first watch starts from the folder as it is; later ones pick up what came meanwhile.
    if (state === undefined) context.setState({ aliveAt: Date.now() } satisfies FolderState);
    else
      for (const [path, at] of changedSince(root, config.subfolders, state.aliveAt)) note(path, at);

    let watcher: FSWatcher;
    try {
      watcher = watch(root, { recursive: config.subfolders, persistent: false }, (_, name) => {
        if (name !== null) note(join(root, name));
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
