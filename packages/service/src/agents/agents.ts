import type { AgentRecord, Autonomy, NewAgent } from "@office-town/contract";
import { RecordNotFoundError, type Store } from "../store/store.ts";
import { type Identity, randomIdentity } from "./names.ts";

// With 64 names and 10,000 numbers a free handle is found at once; this only ends a stuck loop.
const NAME_ATTEMPTS = 100;

export function freeIdentity(store: Store): Identity {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const identity = randomIdentity();
    if (!store.isNameTaken(identity.name)) return identity;
  }
  throw new Error("Could not find a free name for a new agent.");
}

export interface AgentPlace {
  // Given instead of the profile's name, such as a team's lead.
  role?: string;
  // The level it works at while it has no department.
  autonomy: Autonomy;
  guest?: true;
}

// One made from a template gets a copy of it, so a later edit of the template leaves it as it is.
export function createAgent(store: Store, agent: NewAgent, place: AgentPlace): AgentRecord {
  const identity = freeIdentity(store);
  const named = {
    autonomy: place.autonomy,
    ...(place.role === undefined ? {} : { role: place.role }),
    ...(place.guest ? { guest: place.guest } : {}),
  };
  const settings = "settings" in agent ? agent.settings : undefined;
  if (agent.profileId === undefined && settings !== undefined) {
    return store.createAgent({ ...identity, ...named, settings });
  }
  const profile = store.getProfile(agent.profileId ?? "");
  if (profile === undefined) throw new RecordNotFoundError("profile", agent.profileId ?? "");
  return store.createAgent({
    name: identity.name,
    colour: profile.colour,
    role: profile.name,
    ...(profile.role === "" ? {} : { purpose: profile.role }),
    ...named,
    profileId: profile.id,
    settings: settings ?? profile.settings,
  });
}
