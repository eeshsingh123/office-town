import type { Adapter } from "../../adapter.ts";
import { AcpTranslator, type PreferredModel } from "./translator.ts";

export type AcpHarness = Pick<
  Adapter,
  | "harness"
  | "name"
  | "maker"
  | "summary"
  | "needs"
  | "capabilities"
  | "priceLists"
  | "usagePage"
  | "isolationNote"
  | "catalog"
  | "accounts"
  | "install"
  | "recount"
  | "buildCommand"
> & {
  // The ways the harness may prefix a tool of an MCP server the core attached, as its tool call
  // titles show it, such as "office-town_delegate".
  toolPrefixes: (server: string) => string[];
  // Its command line cannot allow the core's tools, so their asks are allowed over ACP.
  allowOwnToolAsks?: boolean;
  // What a new session runs on when nothing is picked and the harness lists the model.
  preferred?: PreferredModel;
};

// Any harness whose own binary speaks the Agent Client Protocol only has to say how to launch it.
export function createAcpAdapter({
  toolPrefixes,
  allowOwnToolAsks = false,
  preferred,
  ...harness
}: AcpHarness): Adapter {
  return {
    ...harness,
    createTranslator: (options) =>
      new AcpTranslator(options, toolPrefixes, allowOwnToolAsks, preferred),
  };
}
