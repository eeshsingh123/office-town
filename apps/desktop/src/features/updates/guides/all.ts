import type { DestinationKind } from "@office-town/contract";
import { discord } from "./discord.tsx";
import { email } from "./email.tsx";
import type { ServiceGuide } from "./guide.ts";
import { slack } from "./slack.tsx";
import { telegram } from "./telegram.tsx";
import { webhook } from "./webhook.tsx";

// In the order offered: the chat apps first, then the ways for technical users.
export const GUIDES: { [K in DestinationKind]: ServiceGuide } = {
  slack,
  discord,
  telegram,
  email,
  webhook,
};
