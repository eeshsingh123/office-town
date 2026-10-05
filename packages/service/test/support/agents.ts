import type { AgentRecord } from "@office-town/contract";
import type { Store } from "../../src/store/store.ts";

let count = 0;

export function addAgent(store: Store): AgentRecord {
  count += 1;
  return store.createAgent({
    name: `@test-${count}`,
    colour: "#B5602B",
    settings: { harness: "claude", environment: { kind: "native" } },
  });
}
