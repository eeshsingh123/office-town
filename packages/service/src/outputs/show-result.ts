import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { MAX_KEPT_VERSION_BYTES } from "@office-town/contract";
import { z } from "zod";
import type { TeamContext } from "../team/members.ts";
import { type Caller, defineTool, ToolError } from "../tools/tools.ts";
import { hostPathOf, rootOf, taskRoots, versionFile } from "./paths.ts";
import { siteAddress } from "./sites.ts";

// Shows a file or a running local site in the task's Outputs, where the user opens it (M8).
export function showResult({ store, dataFolder }: TeamContext) {
  return defineTool({
    name: "show_result",
    description:
      "Show the user something you made, so they can open it in the app: a page, mockup, image, " +
      "document, PDF, table or code file, or the local address of a site you are running. Call " +
      "it when it is ready to look at, and again after you change it, which adds a version. Only " +
      "for what the user should look at, not every file you touch.",
    input: z.object({
      title: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('A short name the user knows it by, such as "Pricing page mockup".'),
      path: z.string().min(1).optional().describe("The file to show. Give this or url."),
      url: z
        .string()
        .min(1)
        .optional()
        .describe("The local address of a site you are running, such as http://localhost:5173/."),
    }),
    offeredTo: () => true,
    call: async ({ title, path, url }, caller: Caller) => {
      if ((path === undefined) === (url === undefined)) {
        throw new ToolError("Give either path or url.");
      }
      const shown = { taskId: caller.taskId, agentId: caller.agentId, sessionId: caller.sessionId };
      if (url !== undefined) {
        const address = siteAddress(url);
        if (address === undefined) {
          throw new ToolError(
            "Only a local address with a port can be shown, such as http://localhost:5173/.",
          );
        }
        store.showOutput({ ...shown, title, target: { kind: "site", url: address }, kept: false });
        return `Shown to the user as "${title}". Keep its server running while they look.`;
      }
      const session = store.getSession(caller.sessionId);
      const file = session === undefined ? undefined : hostPathOf(session, path ?? "");
      const roots = taskRoots(store, caller.taskId);
      if (file === undefined || rootOf(roots, file) === undefined) {
        throw new ToolError("Show a file inside your workspace.");
      }
      const found = await stat(file).catch(() => undefined);
      if (found === undefined || !found.isFile()) throw new ToolError(`No file at ${path}.`);
      const kept = found.size <= MAX_KEPT_VERSION_BYTES;
      const output = store.showOutput({
        ...shown,
        title,
        target: { kind: "file", path: file },
        kept,
      });
      const version = output.versions.at(-1)?.number ?? 1;
      if (kept) {
        const copy = versionFile(dataFolder, output.id, version, file);
        await mkdir(dirname(copy), { recursive: true });
        await copyFile(file, copy);
      }
      return version === 1
        ? `Shown to the user as "${title}".`
        : `Shown to the user as version ${version} of "${title}".`;
    },
  });
}
