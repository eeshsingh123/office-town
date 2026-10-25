import type {
  AccountSupport,
  HarnessCommand,
  InstallSupport,
  LaunchOptions,
} from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";
import { acpCatalog } from "../acp/catalog.ts";

function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = ["--acp"];
  if (options.model !== undefined) args.push("--model", options.model);
  for (const path of options.additionalPaths ?? []) args.push("--add-dir", path);
  // The core's own tools never ask: what they lead to is guarded where it happens.
  for (const server of options.toolServers) args.push("--allow-tool", server.name);
  if (options.permissionMode === "bypass") args.push("--allow-all");
  return options.accountFolder === undefined
    ? { binary: "copilot", args }
    : { binary: "copilot", args, env: accounts.env(options.accountFolder) };
}

// COPILOT_HOME moves its whole config folder, which names the signed-in user; the token itself
// may sit in the system's credential store, so there is no sign-in file to look for.
const accounts: AccountSupport = {
  env: (folder) => ({ COPILOT_HOME: folder }),
  login: { binary: "copilot", args: ["login"] },
  home: ".copilot",
};

const install: InstallSupport = {
  version: { binary: "copilot", args: ["--version"] },
  windows: "npm install -g @github/copilot",
  unix: "curl -fsSL https://gh.io/copilot-install | bash",
  page: "https://github.com/features/copilot/cli",
  installers: {
    windows: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "@github/copilot"] },
      },
    ],
    unix: [
      {
        needs: "npm",
        named: "Node.js",
        command: { binary: "npm", args: ["install", "-g", "@github/copilot"] },
      },
      {
        needs: "curl",
        command: {
          binary: "bash",
          args: ["-c", "curl -fsSL https://gh.io/copilot-install | bash"],
        },
      },
    ],
  },
  folders: [".local/bin"],
};

export const copilotAdapter = createAcpAdapter({
  harness: "copilot",
  name: "GitHub Copilot CLI",
  maker: "GitHub",
  summary: "GitHub's coding agent. One sign-in gives models from several makers.",
  needs: "Works with any Copilot plan, Free included",
  capabilities: {
    reasoning: true,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: false,
    images: true,
    isolation: "partial",
  },
  isolationNote: "Copilot's own settings and instructions still load.",
  // Its tool calls name an MCP tool by its server, in one of these forms.
  toolPrefixes: (server) => [`${server}-`, `${server}/`, `${server}_`],
  catalog: acpCatalog({ binary: "copilot", args: ["--acp"] }),
  accounts,
  install,
  buildCommand,
});
