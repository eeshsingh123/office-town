import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord, AgentSettings } from "@office-town/contract";
import { freeIdentity } from "../agents/agents.ts";
import type { Store } from "../store/store.ts";
import type { Caller } from "../tools/tools.ts";

const CHIEF_NAME = "@chief";

export class NoChiefError extends Error {
  constructor() {
    super("Set up the chief before giving it a goal.");
    this.name = "NoChiefError";
  }
}

export function chiefOf(store: Store): AgentRecord | undefined {
  const id = store.readSettings().chiefAgentId;
  return id === undefined ? undefined : store.getAgent(id);
}

export function isChiefTask(store: Store, taskId: string): boolean {
  const id = store.readSettings().chiefAgentId;
  return id !== undefined && store.getTask(taskId)?.leadAgentId === id;
}

// Made once; later settings apply at its next session.
export function saveChief(store: Store, settings: AgentSettings): AgentRecord {
  const chief = chiefOf(store);
  if (chief !== undefined) {
    return store.updateAgent(chief.id, { role: chief.role, autonomy: chief.autonomy, settings });
  }
  const identity = freeIdentity(store);
  const created = store.createAgent({
    name: store.isNameTaken(CHIEF_NAME) ? identity.name : CHIEF_NAME,
    colour: identity.colour,
    role: "Chief",
    autonomy: "trusted",
    settings,
  });
  store.saveSettings({ chiefAgentId: created.id });
  return created;
}

export function chiefFolder(dataFolder: string): string {
  const folder = join(dataFolder, "chief");
  mkdirSync(folder, { recursive: true });
  return folder;
}

// Only the chief at work on one of its goals gets the chief's tools.
export function isChiefCaller(store: Store, caller: Caller): boolean {
  return (
    store.readSettings().chiefAgentId === caller.agentId &&
    store.getTask(caller.taskId)?.leadAgentId === caller.agentId
  );
}
