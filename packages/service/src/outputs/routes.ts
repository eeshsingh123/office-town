import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  MAX_PICTURE_BYTES,
  MAX_PREVIEW_BYTES,
  type OutputRecord,
  outputFileQuerySchema,
  restartSiteRequestSchema,
  type TaskOutputs,
} from "@office-town/contract";
import { RequestError } from "../api/errors.ts";
import type { Route } from "../api/routes.ts";
import { canonicalPath } from "../autonomy/policy.ts";
import { RecordNotFoundError } from "../store/store.ts";
import { latestSession } from "../team/lead.ts";
import type { TeamContext } from "../team/members.ts";
import { git } from "../team/worktrees.ts";
import { contentTypeOf } from "./content-types.ts";
import { linkPath, pictureFile, rootOf, taskRoots, versionFile } from "./paths.ts";
import type { PreviewServer } from "./preview-server.ts";
import { restartSite } from "./restart.ts";
import { isAnswering, portOf } from "./sites.ts";
import type { TaskFiles } from "./task-files.ts";

const NATIVE = { kind: "native" } as const;

interface TaskFile {
  // What the user asked for, in its folder.
  path: string;
  root: string;
  // An older version's copy, served in its place.
  copy?: string;
}

export interface OutputServices {
  preview: PreviewServer;
  files: TaskFiles;
  // The core's own servers, never offered as a site.
  ownPorts: Set<number>;
}

function outputOf(context: TeamContext, outputId: string): OutputRecord {
  const output = context.store.getOutput(outputId);
  if (output === undefined) throw new RecordNotFoundError("output", outputId);
  return output;
}

// Only files in the task's own folders, so no path given here reaches anything else.
function taskFile(context: TeamContext, taskId: string, query: URLSearchParams | unknown) {
  const asked = outputFileQuerySchema.parse(
    query instanceof URLSearchParams ? Object.fromEntries(query) : query,
  );
  const roots = taskRoots(context.store, taskId);
  const missing = () => new RequestError(404, "not_found", "That file is not part of this task.");
  if ("path" in asked) {
    const root = rootOf(roots, asked.path);
    if (root === undefined) throw missing();
    return { path: asked.path, root } satisfies TaskFile;
  }
  const output = outputOf(context, asked.outputId);
  const version = output.versions.find((one) => one.number === asked.version);
  if (output.taskId !== taskId || output.target.kind !== "file" || version === undefined) {
    throw missing();
  }
  const { path } = output.target;
  const root = rootOf(roots, path);
  if (root === undefined) throw missing();
  // The latest version is the file as it is now.
  if (version.number === output.versions.at(-1)?.number) return { path, root } satisfies TaskFile;
  if (!version.kept) {
    throw new RequestError(404, "not_found", "That version was too large to keep a copy of.");
  }
  return {
    path,
    root,
    copy: versionFile(context.dataFolder, output.id, version.number, path),
  } satisfies TaskFile;
}

async function readStart(file: string, limit: number): Promise<{ bytes: Buffer; size: number }> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const bytes = Buffer.alloc(Math.min(size, limit));
    await handle.read(bytes, 0, bytes.length, 0);
    return { bytes, size };
  } finally {
    await handle.close();
  }
}

// Uncommitted changes, or else the file's latest commit; nothing outside git.
async function changesOf(path: string): Promise<string> {
  const folder = dirname(path);
  const run = (args: string[]) =>
    git(NATIVE, ["-C", folder, ...args, "--", path], "Could not read the file's changes").catch(
      () => "",
    );
  const open = await run(["diff", "--no-color", "HEAD"]);
  return open !== "" ? open : run(["log", "-1", "-p", "--no-color", "--format="]);
}

export function outputRoutes(context: TeamContext, services: OutputServices): Route[] {
  const { store } = context;
  const { preview, files, ownPorts } = services;
  const answering = async (urls: string[]) => {
    const open = urls.filter((url) => !ownPorts.has(portOf(url)));
    const answers = await Promise.all(open.map(isAnswering));
    return open.filter((_, index) => answers[index]);
  };
  return [
    {
      method: "GET",
      path: "/outputs",
      reply: () => ({ status: 200, json: store.listOutputs() }),
    },
    {
      method: "GET",
      path: "/tasks/:id/outputs",
      reply: async ({ param }) => {
        const taskId = param("id");
        const results = store.listOutputs(taskId);
        const roots = taskRoots(store, taskId);
        const { changed, seen } = files.read(taskId);
        const shown = new Set(
          results.flatMap(({ target }) =>
            target.kind === "file" ? [canonicalPath(target.path)] : [new URL(target.url).origin],
          ),
        );
        const sites = results.flatMap(({ target }) => (target.kind === "site" ? [target.url] : []));
        const spotted = seen.filter(({ url }) => !shown.has(new URL(url).origin));
        const [running, open] = await Promise.all([
          answering(sites),
          answering(spotted.map(({ url }) => url)),
        ]);
        const agentIds = new Set([...results, ...spotted].map(({ agentId }) => agentId));
        const contextTokens = Object.fromEntries(
          [...agentIds].flatMap((agentId) => {
            const latest = latestSession(context, taskId, agentId);
            const tokens = latest === undefined ? undefined : store.contextTokens(latest.id);
            return tokens === undefined ? [] : [[agentId, tokens]];
          }),
        );
        const outputs: TaskOutputs = {
          results,
          changed: changed
            .filter(({ path }) => !shown.has(canonicalPath(path)) && rootOf(roots, path))
            .sort((a, b) => b.at.localeCompare(a.at)),
          spotted: spotted.filter(({ url }) => open.includes(url)),
          running,
          roots,
          contextTokens,
        };
        return { status: 200, json: outputs };
      },
    },
    {
      method: "POST",
      path: "/tasks/:id/preview",
      reply: async ({ param, body }) => {
        const file = taskFile(context, param("id"), await body());
        const path = linkPath(file.root, file.path);
        const grant =
          file.copy === undefined
            ? { root: file.root }
            : { root: file.root, entry: { path, file: file.copy } };
        return { status: 200, json: { url: preview.grant(grant, path) } };
      },
    },
    {
      method: "GET",
      path: "/tasks/:id/file",
      reply: async ({ param, query }) => {
        const file = taskFile(context, param("id"), query);
        const read = file.copy ?? file.path;
        const asked = Number(query.get("limit") ?? MAX_PREVIEW_BYTES);
        const limit = Number.isFinite(asked) ? Math.max(0, Math.min(asked, MAX_PREVIEW_BYTES)) : 0;
        const found = await stat(read).catch(() => undefined);
        if (found === undefined || !found.isFile()) {
          throw new RequestError(404, "not_found", "The file is not there any more.");
        }
        if (found.size > MAX_PREVIEW_BYTES && query.get("limit") === null) {
          throw new RequestError(413, "too_large", "The file is too large to show here.");
        }
        const { bytes, size } = await readStart(read, limit);
        return {
          status: 200,
          bytes,
          type: contentTypeOf(file.path),
          headers: { "x-file-size": String(size) },
        };
      },
    },
    {
      method: "GET",
      path: "/tasks/:id/changes",
      reply: async ({ param, query }) => {
        const file = taskFile(context, param("id"), query);
        return { status: 200, text: await changesOf(file.path) };
      },
    },
    {
      method: "PUT",
      path: "/outputs/:id/picture",
      reply: async ({ param, bytes }) => {
        const output = outputOf(context, param("id"));
        const png = await bytes(MAX_PICTURE_BYTES);
        const file = pictureFile(context.dataFolder, output.id);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, png);
        return { status: 200, json: store.outputPictured(output.id) };
      },
    },
    {
      method: "GET",
      path: "/outputs/:id/picture",
      reply: async ({ param }) => {
        const output = outputOf(context, param("id"));
        const png = await readFile(pictureFile(context.dataFolder, output.id)).catch(() => {
          throw new RequestError(404, "not_found", "This result has no picture yet.");
        });
        return { status: 200, bytes: png, type: "image/png" };
      },
    },
    {
      method: "POST",
      path: "/outputs/:id/restart",
      reply: async ({ param, body }) => {
        const output = outputOf(context, param("id"));
        const { fresh } = restartSiteRequestSchema.parse(await body());
        if (output.target.kind !== "site") {
          throw new RequestError(409, "conflict", "Only a site can be started again.");
        }
        const command = files
          .read(output.taskId)
          .commands.get(`${new URL(output.target.url).origin}/`);
        await restartSite(context, output, fresh, command);
        return { status: 204 };
      },
    },
  ];
}
