import type { Adapter } from "../../adapter.ts";
import { AcpTranslator } from "./translator.ts";

export type AcpHarness = Pick<
  Adapter,
  "harness" | "name" | "capabilities" | "isolationNote" | "catalog" | "buildCommand"
>;

// Any harness whose own binary speaks the Agent Client Protocol only has to say how to launch it.
export function createAcpAdapter(harness: AcpHarness): Adapter {
  return {
    ...harness,
    createTranslator: (options) => new AcpTranslator(options),
  };
}
