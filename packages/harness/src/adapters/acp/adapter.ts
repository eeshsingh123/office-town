import type { Adapter } from "../../adapter.ts";
import { AcpTranslator } from "./translator.ts";

export type AcpHarness = Pick<
  Adapter,
  | "harness"
  | "name"
  | "maker"
  | "summary"
  | "needs"
  | "capabilities"
  | "priceLists"
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
};

// Any harness whose own binary speaks the Agent Client Protocol only has to say how to launch it.
export function createAcpAdapter({ toolPrefixes, ...harness }: AcpHarness): Adapter {
  return {
    ...harness,
    createTranslator: (options) => new AcpTranslator(options, toolPrefixes),
  };
}
