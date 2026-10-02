import type { PermissionMode, SessionOptions } from "@office-town/contract";
import type { Adapter, HarnessCommand } from "../../adapter.ts";
import { ClaudeTranslator } from "./translator.ts";

const PERMISSION_MODES: Record<PermissionMode, string> = {
  ask: "default",
  acceptEdits: "acceptEdits",
  bypass: "bypassPermissions",
};

function buildCommand(options: SessionOptions): HarnessCommand {
  const args = [
    "--print",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    // Routes permission prompts to us as control requests on stdout.
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    PERMISSION_MODES[options.permissionMode],
  ];
  if (options.model !== undefined) args.push("--model", options.model);
  if (options.effort !== undefined) args.push("--effort", options.effort);
  return { binary: "claude", args };
}

export const claudeAdapter: Adapter = {
  harness: "claude",
  capabilities: { reasoning: true, plan: true, effort: true, modelList: false, resume: false },
  buildCommand,
  createTranslator: () => new ClaudeTranslator(),
};
