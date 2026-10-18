import {
  type ConnectorDraftReply,
  type ConnectorDraftRequest,
  connectorSetupSchema,
} from "@office-town/contract";
import { z } from "zod";
import type { TeamContext } from "../team/members.ts";
import { askForJson } from "./run.ts";
import { ASKING, asked, numbered, writtenReplyShape } from "./written.ts";

// What the model writes; the core checks it is a setup it can try.
const writtenConnectorSchema = z.object({
  ...writtenReplyShape,
  connector: z
    .object({
      name: z.string().trim().min(1).max(60),
      maker: z.string().trim().min(1).optional(),
      official: z.boolean(),
      source: z.url(),
      kind: z.enum(["remote", "local"]),
      url: z.url().optional(),
      command: z.string().trim().min(1).optional(),
      args: z.array(z.string()).default([]),
      auth: z.enum(["sign-in", "key", "none"]),
      keys: z
        .array(
          z.object({ name: z.string().min(1), label: z.string().min(1), link: z.url().optional() }),
        )
        .default([]),
      install_first: z.string().optional(),
    })
    .optional(),
});

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 24) || "app";

const PROMPT = `You help a user of Office Town connect an app to their AI agents. Agents reach apps through MCP servers. Find an existing MCP server for what the user describes and fill in how to connect it. Never write server code: only find servers that already exist.

Look first at the maker's own docs for an official MCP server, then at the official MCP Registry (registry.modelcontextprotocol.io), then at the server's own repository. Use web search and fetch; read the setup steps, do not guess them.

Reply with one JSON object and nothing else:
{"questions":[{"question":"...","options":["..."]}],"suggestions":[],"connector":{"name":"...","maker":"...","official":true,"source":"https://...","kind":"remote","url":"https://...","command":"...","args":["..."],"auth":"sign-in","keys":[{"name":"...","label":"...","link":"https://..."}],"install_first":"..."}}

- name: the app's name as people know it, such as "Blender". maker: who made the server. official: true only when the app's own maker publishes it. source: the page you took the setup from.
- kind "remote": a server on the internet, reached at url (its Streamable HTTP address). kind "local": a program this computer runs, as command and args (such as "uvx" with ["blender-mcp"], or "npx" with ["-y", "package"]). Prefer remote when the maker offers both.
- auth: "sign-in" when a remote server signs users in through the browser (OAuth); "key" when it needs a pasted key or token; "none" otherwise. keys: for "key", each value it needs: name is the HTTP header for remote (use "Authorization" for a bearer token) or the environment variable for local; label is what to call it; link is the page where the user gets it. [] otherwise.
- install_first: what the user must install or do before it works, in one short sentence, such as "Blender and its MCP add-on". Leave it out when nothing is needed.
${ASKING}
- When nothing that exists fits, leave connector out and say so in a question with options.`;

export async function draftConnector(
  context: TeamContext,
  request: ConnectorDraftRequest,
): Promise<ConnectorDraftReply> {
  const prompt = `${PROMPT}\n\nWhat the user said, in order:\n${numbered(request.notes)}`;
  const written = await askForJson(context, request.drafter, prompt, writtenConnectorSchema, [
    "search",
    "fetch",
  ]);
  const found = written.connector;
  const setup =
    found === undefined
      ? undefined
      : connectorSetupSchema.safeParse({
          slug: slugOf(found.name),
          name: found.name,
          kind: found.kind,
          ...(found.maker === undefined ? {} : { maker: found.maker }),
          official: found.official,
          ...(found.kind === "remote"
            ? { url: found.url }
            : { command: found.command, args: found.args }),
          auth: found.auth,
          keys: found.auth === "key" ? found.keys : [],
        });
  return {
    ...asked(written),
    suggestions: [],
    ...(found === undefined || setup === undefined || !setup.success
      ? {}
      : {
          found: {
            setup: setup.data,
            source: found.source,
            ...(found.install_first?.trim() ? { installFirst: found.install_first.trim() } : {}),
          },
        }),
  };
}
