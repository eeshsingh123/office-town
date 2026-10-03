import type { PermissionMode } from "@office-town/contract";
import type { Adapter, CatalogQuery, HarnessCommand, LaunchOptions } from "../../adapter.ts";
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
  acceptEdits: "acceptEdits",
  bypass: "bypassPermissions",
};

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
  for (const path of options.additionalPaths ?? []) args.push("--add-dir", path);
  return { binary: "claude", args };
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
  // The CLI sends thinking blocks with their text left empty, so there is no reasoning to report.
  capabilities: {
    reasoning: false,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: true,
  },
  catalog,
  buildCommand,
  createTranslator: () => new ClaudeTranslator(),
};
