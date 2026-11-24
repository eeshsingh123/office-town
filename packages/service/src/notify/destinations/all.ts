import type { DestinationKind } from "@office-town/contract";
import type { Destination } from "./destination.ts";
import { discord } from "./discord.ts";
import { email } from "./email.ts";
import { ntfy } from "./ntfy.ts";
import { slack } from "./slack.ts";
import { telegram } from "./telegram.ts";
import { webhook } from "./webhook.ts";

// Every service results can go to; one more is a file of its own and a line here (D-130).
export const DESTINATIONS: { [K in DestinationKind]: Destination<K> } = {
  telegram,
  slack,
  discord,
  ntfy,
  email,
  webhook,
};
