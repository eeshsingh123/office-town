import type { AgentRecord, AgentSettings, NewAgent } from "@office-town/contract";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { type Identity, randomIdentity } from "./names.ts";

// With 64 names and 10,000 numbers a free handle is found at once; the limit only ends a loop
// that could not.
const NAME_ATTEMPTS = 100;

export function freeIdentity(store: Store): Identity {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const identity = randomIdentity();
    if (!store.isNameTaken(identity.name)) return identity;
  }
  throw new Error("Could not find a free name for a new agent.");
}

// A new agent's role is its profile's name, unless it is given one, such as a team's lead.
export function createAgent(store: Store, agent: NewAgent, role?: string): AgentRecord {
  const { name, colour } = freeIdentity(store);
  const named = role === undefined ? {} : { role };
  if ("settings" in agent) {
    return store.createAgent({ name, colour, ...named, settings: agent.settings });
  }
  const profile = store.getProfile(agent.profileId);
  if (profile === undefined) throw new RecordNotFoundError("profile", agent.profileId);
  return store.createAgent({
    name,
    colour: profile.colour,
    role: profile.name,
    ...named,
    profileId: profile.id,
    settings: profile.settings,
  });
}

// A profile's saved changes apply to the agents made from it at their next session.
export function settingsOf(store: Store, agent: AgentRecord): AgentSettings {
  if (agent.profileId === undefined) return agent.settings;
  return store.getProfile(agent.profileId)?.settings ?? agent.settings;
}
