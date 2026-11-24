import type { ServiceGuide } from "./guide.ts";
import { Screen } from "./picture.tsx";

// Checked 2026-11-24 against Discord's "Intro to Webhooks" help article.
export const discord: ServiceGuide = {
  kind: "discord",
  label: "Discord",
  logo: "discord",
  steps: [
    { text: "In Discord, open the channel's settings and click Integrations." },
    { text: "Click Webhooks, then New Webhook." },
    {
      text: "Click Copy Webhook URL and paste it below.",
      picture: {
        draw: () => (
          <Screen
            title="Integrations › Webhooks"
            line="Captain Hook"
            press="Copy Webhook URL"
            below
          />
        ),
        alt: "Discord's Webhooks settings, with Copy Webhook URL under the new webhook",
      },
    },
  ],
  hint: "You need the Manage Webhooks permission on the server.",
  fields: [
    {
      key: "url",
      label: "The link Discord gave you",
      wrong: (value) =>
        /discord(app)?\.com\/channels\//.test(value)
          ? { say: "That's a link to a channel. Click Copy Webhook URL instead.", step: 2 }
          : {
              say: "That isn't a webhook link. It starts with https://discord.com/api/webhooks/.",
              step: 2,
            },
    },
  ],
};
