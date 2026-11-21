import type { StoppedLeads } from "../team/lead-stopped.ts";

// What keeps work going while the user is away (M11).
export interface Unattended {
  stoppedLeads: StoppedLeads;
}
