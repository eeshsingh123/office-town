import type { PermissionMode, SessionOptions } from "@office-town/contract";
import type { HarnessCommand } from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";

type Rule = "ask" | "allow";

const PERMISSIONS: Record<PermissionMode, { edit: Rule; bash: Rule; webfetch: Rule }> = {
  ask: { edit: "ask", bash: "ask", webfetch: "ask" },
  acceptEdits: { edit: "allow", bash: "ask", webfetch: "ask" },
  bypass: { edit: "allow", bash: "allow", webfetch: "allow" },
};

function buildCommand(options: SessionOptions): HarnessCommand {
  // OpenCode merges this inline config over the user's own, so nothing on disk is touched.
  const config = {
    permission: PERMISSIONS[options.permissionMode],
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  return {
    binary: "opencode",
    args: ["acp"],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  };
}

export const opencodeAdapter = createAcpAdapter({
  harness: "opencode",
  capabilities: { reasoning: true, plan: true, effort: false, modelList: false, resume: false },
  buildCommand,
});
