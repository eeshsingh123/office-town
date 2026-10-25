import { z } from "zod";
import type {
  AccountSupport,
  HarnessCommand,
  InstallSupport,
  LaunchOptions,
} from "../../adapter.ts";
import { createAcpAdapter } from "../acp/adapter.ts";
import { acpCatalog } from "../acp/catalog.ts";

// Its acp command takes no options: the model is chosen over ACP, and a permission it asks for
// under Bypass is answered by the core.
function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = ["acp"];
  return options.accountFolder === undefined
    ? { binary: "cursor-agent", args }
    : { binary: "cursor-agent", args, env: accounts.env(options.accountFolder) };
}

const statusSchema = z.looseObject({
  isAuthenticated: z.boolean(),
  email: z.string().optional(),
});

// CURSOR_CONFIG_DIR moves its config folder, as its own installer reads it.
const accounts: AccountSupport = {
  env: (folder) => ({ CURSOR_CONFIG_DIR: folder }),
  login: { binary: "cursor-agent", args: ["login"] },
  status: {
    command: { binary: "cursor-agent", args: ["status", "--format", "json"] },
    read(output) {
      const status = statusSchema.parse(JSON.parse(output.join("\n")));
      return {
        signedIn: status.isAuthenticated,
        ...(status.email === undefined ? {} : { email: status.email }),
      };
    },
  },
  home: ".cursor",
};

const install: InstallSupport = {
  version: { binary: "cursor-agent", args: ["--version"] },
  windows: "irm 'https://cursor.com/install?win32=true' | iex",
  unix: "curl https://cursor.com/install -fsS | bash",
  page: "https://cursor.com/cli",
  installers: {
    // Its one-line installer run from another app looks like a trojan to Defender (D-75).
    windows: [],
    unix: [
      {
        needs: "curl",
        command: { binary: "bash", args: ["-c", "curl https://cursor.com/install -fsS | bash"] },
      },
    ],
  },
  folders: ["AppData/Local/cursor-agent", ".local/bin"],
};

export const cursorAdapter = createAcpAdapter({
  harness: "cursor",
  name: "Cursor CLI",
  maker: "Cursor",
  summary: "Cursor's coding agent, with the models in your Cursor plan.",
  needs: "Needs a Cursor account",
  // Cursor serves other makers' models under their own names.
  priceLists: ["anthropic", "openai", "google", "xai"],
  capabilities: {
    reasoning: true,
    plan: true,
    effort: false,
    modelList: true,
    resume: true,
    usageLimits: false,
    images: true,
    isolation: "partial",
  },
  isolationNote: "Cursor's own rules and settings still load.",
  // Its tool calls name an MCP tool by its server, in one of these forms.
  toolPrefixes: (server) => [`${server}-`, `${server}/`, `${server}_`, `mcp_${server}_`],
  catalog: acpCatalog({ binary: "cursor-agent", args: ["acp"] }),
  accounts,
  install,
  buildCommand,
});
