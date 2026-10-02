import { parseArgs } from "node:util";
import { describeHarness } from "../src/index.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { harness: { type: "string", default: "claude" }, wsl: { type: "string" } },
  });
  const environment =
    values.wsl === undefined
      ? { kind: "native" as const }
      : { kind: "wsl" as const, distro: values.wsl };
  const { models } = await describeHarness(values.harness, environment);
  for (const model of models) {
    const efforts = model.efforts.length === 0 ? "no effort setting" : model.efforts.join(", ");
    console.log(`${model.id}  (${model.name})  effort: ${efforts}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
