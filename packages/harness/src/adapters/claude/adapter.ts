import type { PermissionMode } from "@office-town/contract";
import type {
  Adapter,
  AttachedToolServer,
  CatalogQuery,
  HarnessCommand,
  LaunchOptions,
} from "../../adapter.ts";
import { headerSchema, initializeResponseSchema } from "./messages.ts";
import { ClaudeTranslator } from "./translator.ts";

const STREAM_ARGS = [
  "--print",
  "--verbose",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
];

const PERMISSION_MODES: Record<PermissionMode, string> = {
  ask: "default",
  bypass: "bypassPermissions",
};

// The config is on the command line, which others can read, so it names a variable Claude fills in (D-41).
const tokenVariable = (index: number) => `OFFICE_TOWN_TOOL_TOKEN_${index}`;

function mcpConfigOf(server: AttachedToolServer, index: number) {
  const hidden = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value.replaceAll(server.token, `\${${tokenVariable(index)}}`),
      ]),
    );
  return server.transport === "http"
    ? { type: "http", url: server.url, headers: hidden(server.headers) }
    : { type: "stdio", command: server.command, args: server.args, env: hidden(server.env) };
}

function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = [
    ...STREAM_ARGS,
    // Adds the text of a reply as it is produced, ahead of the whole message.
    "--include-partial-messages",
    // Routes permission prompts to us as control requests on stdout.
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    PERMISSION_MODES[options.permissionMode],
  ];
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.effort !== undefined) args.push("--effort", options.effort);
  if (options.resumeSessionId !== undefined) args.push("--resume", options.resumeSessionId);
  if (options.toolServers.length > 0) {
    const servers = options.toolServers.map((server, index) => [
      server.name,
      mcpConfigOf(server, index),
    ]);
    args.push("--mcp-config", JSON.stringify({ mcpServers: Object.fromEntries(servers) }));
    // The core's own tools never ask: what they lead to is guarded where it happens.
    args.push("--allowedTools", ...options.toolServers.map((server) => `mcp__${server.name}`));
  }
  // --bare would isolate more, but takes only an API key, never the subscription login (D-41).
  if (options.isolated) {
    args.push("--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands");
  }
  for (const path of options.additionalPaths ?? []) args.push("--add-dir", path);
  if (options.toolServers.length === 0) return { binary: "claude", args };
  const env = Object.fromEntries(
    options.toolServers.map((server, index) => [tokenVariable(index), server.token]),
  );
  return { binary: "claude", args, env };
}

// The CLI describes itself in its answer to an initialize request, without starting a turn.
const catalog: CatalogQuery = {
  command: { binary: "claude", args: STREAM_ARGS },
  input: [
    JSON.stringify({
      type: "control_request",
      request_id: "catalog",
      request: { subtype: "initialize" },
    }),
  ],
  parse(output) {
    const answer = output
      .map((line): unknown => JSON.parse(line))
      .find((message) => headerSchema.parse(message).type === "control_response");
    const { models } = initializeResponseSchema.parse(answer).response.response;
    return {
      models: models.map((model) => ({
        id: model.value,
        name: model.displayName,
        ...(model.description === undefined ? {} : { description: model.description }),
        efforts: model.supportedEffortLevels ?? [],
      })),
    };
  },
};

export const claudeAdapter: Adapter = {
  harness: "claude",
  name: "Claude Code",
  // The CLI sends thinking blocks with their text left empty, so there is no reasoning to report.
  capabilities: {
    reasoning: false,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: true,
    isolation: "full",
  },
  catalog,
  buildCommand,
  createTranslator: (options) => new ClaudeTranslator(options.toolServers),
};
