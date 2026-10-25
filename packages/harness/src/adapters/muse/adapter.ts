import type {
  AccountSupport,
  Adapter,
  CatalogQuery,
  HarnessCommand,
  HarnessQuery,
  InstallSupport,
  LaunchOptions,
} from "../../adapter.ts";
import { answerIn } from "../../json-rpc.ts";
import { modelListSchema, type Subscription, subscriptionSchema } from "./messages.ts";
import { CLIENT_INFO, limitsOf, MuseTranslator } from "./translator.ts";

// Approval is chosen per session over the wire; the sandbox only on the command line.
function buildCommand(options: LaunchOptions): HarnessCommand {
  const args = ["serve", ...(options.permissionMode === "bypass" ? ["--disable-sandbox"] : [])];
  return options.accountFolder === undefined
    ? { binary: "muse", args }
    : { binary: "muse", args, env: accounts.env(options.accountFolder) };
}

// Its models are listed once signed in; before that the list is empty.
const catalog: CatalogQuery = {
  command: { binary: "muse", args: ["serve"] },
  server: true,
  input: [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: CLIENT_INFO },
    }),
    JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} }),
  ],
  read(output) {
    const answer = answerIn(output, 2);
    if (answer === undefined) return undefined;
    return {
      models: modelListSchema.parse(answer.result).models.map((model) => ({
        id: model.modelId,
        name: model.displayLabel,
        ...(model.description ? { description: model.description } : {}),
        efforts:
          model.reasoningEffortVariants?.map(({ tier }) => tier) ??
          (Array.isArray(model.variants) ? model.variants : []),
      })),
    };
  },
};

// `muse usage --json` prints the plan's allowance as one object, or says on stderr that it is not
// logged in.
function usageQuery<T>(read: (usage: Subscription | undefined) => T): HarnessQuery<T> {
  return {
    command: { binary: "muse", args: ["usage", "--json"] },
    read(output, stderr = "") {
      if (stderr.includes("not logged in")) return read(undefined);
      const text = output.join("\n");
      const json = text.slice(text.indexOf("{"));
      if (!json.startsWith("{")) return undefined;
      const parsed = JSON.parse(json) as { usage?: unknown };
      return read(subscriptionSchema.parse(parsed.usage ?? parsed));
    },
  };
}

// Its login is kept under the XDG config folder and its sessions under the data folder, which
// both move with an account (checked on Muse Code 1.4.13).
const accounts: AccountSupport = {
  env: (folder) => ({ XDG_CONFIG_HOME: folder, XDG_DATA_HOME: folder }),
  credentials: "muse/auth.json",
  // Shows a code to approve in the browser.
  login: { binary: "muse", args: ["login"] },
  status: usageQuery((usage) =>
    usage === undefined ? { signedIn: false } : { signedIn: true, plan: usage.tier },
  ),
  limits: usageQuery((usage) => (usage === undefined ? [] : limitsOf(usage))),
};

const install: InstallSupport = {
  version: { binary: "muse", args: ["--version"] },
  windows: "irm https://dev.meta.ai/install.ps1 | iex",
  unix: "curl -fsSL https://dev.meta.ai/install.sh | sh",
  page: "https://dev.meta.ai/docs/muse-code",
  installers: {
    // Its one-line installer run from another app looks like a trojan to Defender (D-75).
    windows: [],
    unix: [
      {
        needs: "curl",
        command: { binary: "sh", args: ["-c", "curl -fsSL https://dev.meta.ai/install.sh | sh"] },
      },
    ],
  },
  folders: ["AppData/Local/Programs/muse", ".local/bin"],
};

export const museAdapter: Adapter = {
  harness: "muse",
  name: "Muse Code",
  maker: "Meta",
  summary: "Meta's coding agent, with Meta's own models.",
  needs: "Needs a Meta account",
  priceLists: ["meta"],
  capabilities: {
    reasoning: true,
    plan: true,
    effort: true,
    modelList: true,
    resume: true,
    usageLimits: true,
    images: true,
    isolation: "partial",
  },
  isolationNote: "Your own Muse settings still load; the workspace's skills and rules do not.",
  catalog,
  accounts,
  install,
  buildCommand,
  createTranslator: (options) => new MuseTranslator(options),
};
